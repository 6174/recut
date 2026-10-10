"""
[INPUT]: 仅标准库 + numpy/PIL（纯函数部分）；可选 cv2（人脸检测）、onnxruntime-gpu（CodeFormer 修复）、av（视频解复用/重编码）；
          modal_app.py 传入选定的档位参数与（可缺的）人脸模型目录
[OUTPUT]: refine_video_bytes(data, params, detector=None, restorer=None, log=print) → (mp4 bytes, report dict)：
          「逐帧人脸检测 → 跨帧跟踪 → 归一化裁剪 → 专用人脸修复 → 羽化缝合 → 原音轨原样 copy 重封装」的后处理阶段；
          build_reference_sheet(images, detector, log) → PNG bytes：把参考图里的人脸裁出放大拼成「角色参考组」；
          纯函数（choose_profile/expand_box/feather_weights/iou/group_tracks/plan_refine）可脱离 GPU/av 单测（见 --selftest）
[POS]: minimax-h3-ref 预设包的人脸保持层（L1 参考组增强 + L4 像素域修复）；与检测/修复模型解耦：模型缺失 →
        优雅降级为「不修复但照常交付」（report.applied=false + reason），绝不因修复失败而连坐生成
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import io
import json
import time
from dataclasses import dataclass, replace
from typing import Optional, Protocol

import numpy as np

# 社区实测区间：源脸高 < 40px 走远景档（把放大倍数从 ~9-13x 降到 ~5-7x，并降强度避免塑料感/独眼）。
LONGSHOT_FACE_PX = 40
# 修复强度：CodeFormer 的保真度 w —— 越大越清晰、越小越像原脸（官方建议对齐脸 0.5 / 整图 0.7）。
DEFAULT_FIDELITY = 0.6
LONGSHOT_FIDELITY = 0.45
DEFAULT_CROP_FACTOR = 2.5
LONGSHOT_CROP_FACTOR = 3.5
DEFAULT_CANVAS = 768
LONGSHOT_CANVAS = 512
# 保真度标量输入的候选名（不同 ONNX 导出命名不一；另按 "...weight" 后缀兜底匹配）。
FIDELITY_INPUT_NAMES = frozenset({"w", "weight", "fidelity", "fidelity_weight", "cf_weight",
                                  "codeformer_weight", "alpha", "strength"})


def onnx_scalar_dtype(type_name) -> type:
    """ONNX 声明的元素类型 → numpy dtype。FaceFusion 的 codeformer 把保真度输入声明为 **double**，
    喂 float32 会被 onnxruntime 以 INVALID_ARGUMENT 拒绝，所以按声明类型构造标量。"""
    return {"tensor(double)": np.float64, "tensor(float)": np.float32,
            "tensor(float16)": np.float16}.get(str(type_name or "").lower(), np.float32)


@dataclass(frozen=True)
class RefineParams:
    model: str = "codeformer"        # codeformer | gfpgan | off
    fidelity: float = DEFAULT_FIDELITY
    crop_factor: float = DEFAULT_CROP_FACTOR
    canvas: int = DEFAULT_CANVAS
    person_fallback: bool = False
    longshot: bool = True            # 允许按源脸高自动切远景档
    feather: float = 0.15
    sheet_prompt: bool = True        # 参考组增强后是否在提示词尾部补一句说明

    @staticmethod
    def from_mapping(raw: dict) -> "RefineParams":
        raw = raw or {}
        params = RefineParams()
        model = str(raw.get("faceRefine") or raw.get("model") or params.model)
        if model not in ("codeformer", "gfpgan", "off"):
            model = params.model
        return replace(
            params,
            model=model,
            fidelity=_clamp_float(raw.get("faceFidelity"), params.fidelity, 0.0, 1.0),
            crop_factor=_clamp_float(raw.get("faceCropFactor"), params.crop_factor, 1.0, 6.0),
            canvas=int(_clamp_float(raw.get("faceCanvasSize"), params.canvas, 256, 1024)),
            person_fallback=bool(raw.get("facePersonFallback", params.person_fallback)),
        )


def _clamp_float(value, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number:  # NaN
        return default
    return max(low, min(high, number))


# ---------------------- 纯函数：几何 / 跟踪 / 档位（可单测） ----------------------


def expand_box(box, factor: float, width: int, height: int):
    """以人脸框为中心按 factor 外扩并夹到画面内（给头发/动作留余量）。box = (x, y, w, h)。

    框可能部分/全部落在画面外；夹取后若与画面无交集则返回零尺寸框（调用方按 w/h 过小跳过），
    绝不返回 `right < left` 这类非法矩形。
    """
    x, y, w, h = (float(v) for v in box)
    if w <= 0 or h <= 0:
        return (0.0, 0.0, float(width), float(height))
    cx, cy = x + w / 2.0, y + h / 2.0
    half_w, half_h = w * factor / 2.0, h * factor / 2.0
    left = min(max(0.0, cx - half_w), float(width))
    right = min(max(0.0, cx + half_w), float(width))
    top = min(max(0.0, cy - half_h), float(height))
    bottom = min(max(0.0, cy + half_h), float(height))
    return (round(left, 2), round(top, 2), round(max(0.0, right - left), 2), round(max(0.0, bottom - top), 2))


def iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return float(inter / union) if union > 0 else 0.0


def feather_weights(size: int, feather: float = 0.15) -> np.ndarray:
    """方形羽化权重（0..1）：边缘 feather 比例内线性过渡，用于缝合时消除硬边/脉动。"""
    return feather_alpha(size, size, feather)


def feather_alpha(width: int, height: int, feather: float = 0.15) -> np.ndarray:
    """非方形羽化权重：两轴各自的线性边缘坡相乘（`size` 版本是它的方形特例）。"""
    return _axis_ramp(width, feather)[None, :] * _axis_ramp(height, feather)[:, None]


def _axis_ramp(length: int, feather: float) -> np.ndarray:
    length = max(2, int(length))
    band = max(1, min(length // 2, int(round(length * max(0.01, min(0.49, feather))))))
    ramp = np.ones(length, dtype=np.float32)
    edge = np.linspace(0.0, 1.0, band, dtype=np.float32)
    ramp[:band] = edge
    ramp[-band:] = edge[::-1]
    return ramp


def group_tracks(faces_per_frame: list, iou_thresh: float = 0.3, max_gap: int = 12) -> list:
    """把逐帧人脸框归并成轨迹：按 IoU 贪心匹配最近轨迹，超过 max_gap 帧未命中则开新轨迹。

    轨迹 = {indexes: [帧号...], boxes: [框...], min_h: 最小框高}。轻量实现（不引入重跟踪依赖），
    多人场景下按框位置区分；同帧多脸按框面积从大到小处理，优先稳住主脸。
    """
    tracks: list = []
    active: list = []  # [(track, last_frame)]
    for frame_index, faces in enumerate(faces_per_frame):
        boxes = sorted(faces or [], key=lambda b: b[2] * b[3], reverse=True)
        used = set()
        for box in boxes:
            best, best_score = None, iou_thresh
            for track, last_frame in active:
                if frame_index - last_frame > max_gap or id(track) in used:
                    continue
                score = iou(box, track["boxes"][-1])
                if score >= best_score:
                    best, best_score = track, score
            if best is None:
                best = {"indexes": [], "boxes": [], "min_h": float("inf")}
                tracks.append(best)
            best["indexes"].append(frame_index)
            best["boxes"].append(tuple(float(v) for v in box))
            best["min_h"] = min(best["min_h"], float(box[3]))
            used.add(id(best))
            active = [(t, frame_index if t is best else lf) for t, lf in active if t is not None]
            if not any(t is best for t, _ in active):
                active.append((best, frame_index))
        active = [(t, lf) for t, lf in active if frame_index - lf <= max_gap]
    return tracks


def choose_profile(min_face_h: float, params: RefineParams):
    """按最小源脸高选档位：< 40px 且允许时走远景档（更小的放大倍数 + 更低强度）。"""
    if params.longshot and min_face_h < LONGSHOT_FACE_PX:
        return "longshot", LONGSHOT_CANVAS, LONGSHOT_CROP_FACTOR, LONGSHOT_FIDELITY
    return "default", params.canvas, params.crop_factor, params.fidelity


def plan_refine(faces_per_frame: list, params: RefineParams, log=print) -> dict:
    """核心规划（可单测）：给定逐帧人脸框，输出轨迹、档位与每个「帧×脸」的裁剪任务。"""
    tracks = [t for t in group_tracks(faces_per_frame) if t["indexes"]]
    if not tracks:
        return {"tracks": [], "profile": "none", "minFacePx": 0, "tasks": [], "canvas": params.canvas,
                "cropFactor": params.crop_factor, "fidelity": params.fidelity}
    min_face_h = min(t["min_h"] for t in tracks)
    profile, canvas, crop_factor, fidelity = choose_profile(min_face_h, params)
    tasks = [{"track": index, "frame": frame_index, "box": track["boxes"][position]}
             for index, track in enumerate(tracks)
             for position, frame_index in enumerate(track["indexes"])]
    if log:
        log(f"[face] 规划：{len(tracks)} 条轨迹 / {len(tasks)} 个裁剪；最小源脸 {round(min_face_h, 1)}px → "
            f"{profile} 档（canvas {canvas}，crop {crop_factor}，fidelity {fidelity}）")
    return {"tracks": tracks, "profile": profile, "minFacePx": round(min_face_h, 1), "tasks": tasks,
            "canvas": canvas, "cropFactor": crop_factor, "fidelity": fidelity}


# ---------------------- 检测/修复接口（可注入，便于本地单测） ----------------------


class FaceDetector(Protocol):
    def detect(self, frame: np.ndarray) -> list:
        """返回 [(x, y, w, h), ...]（像素坐标）。"""


class FaceRestorer(Protocol):
    def restore(self, crop: np.ndarray, fidelity: float) -> np.ndarray:
        """输入/输出均为 HxWx3 uint8 RGB；同一输入必须给同一输出（确定性）。"""


class StubDetector:
    """本地单测用：按给定框返回，不依赖任何模型；`boxes=[]` 表示「没有脸」。"""

    def __init__(self, boxes=None):
        self._boxes = list(boxes) if boxes is not None else [(100.0, 80.0, 24.0, 24.0)]

    def detect(self, frame):  # noqa: D102
        return list(self._boxes)


class StubRestorer:
    """本地单测用：恒等（放大后原样返回），验证的是链路而非画质。"""

    def restore(self, crop, fidelity):  # noqa: D102
        return crop


def load_detector(model_dir: str, log=print) -> Optional[FaceDetector]:
    """加载 ONNX 人脸检测器（YuNet）。模型缺失/依赖缺失返回 None（调用方降级）。"""
    from pathlib import Path

    path = Path(model_dir) / "face_detection_yunet.onnx"
    if not path.is_file():
        if log:
            log(f"[face] 未找到检测模型 {path}（将跳过人脸阶段）")
        return None
    try:
        import cv2
    except Exception as error:  # noqa: BLE001
        if log:
            log(f"[face] cv2 不可用：{error}")
        return None

    class _YuNet:
        def __init__(self, source: str):
            self._detector = cv2.FaceDetectorYN.create(source, "", (320, 320), 0.35, 0.3, 5000)

        def detect(self, frame):  # noqa: D102
            height, width = frame.shape[:2]
            self._detector.setInputSize((width, height))
            _, faces = self._detector.detect(frame)
            if faces is None:
                return []
            return [(float(f[0]), float(f[1]), float(f[2]), float(f[3])) for f in faces]

    return _YuNet(str(path))


def load_restorer(model_dir: str, model: str, log=print) -> Optional[FaceRestorer]:
    """加载 ONNX 人脸修复器（CodeFormer/GFPGAN）。模型缺失/依赖缺失返回 None（调用方降级为不修复）。

    **自适应 I/O**：不同导出对输入/输出的命名与形状并不统一（FaceFusion 的 codeformer.onnx 用
    `input` + `weight`；另一些导出用 `w`/`fidelity`，或干脆没有保真度输入）。这里在加载时读一遍
    session 的输入清单再决定怎么喂，而不是写死名字——避免「填了 URL 却因为名字不匹配而静默坏掉」。
    """
    from pathlib import Path

    names = {"codeformer": "codeformer.onnx", "gfpgan": "gfpgan.onnx"}
    filename = names.get(model)
    if not filename:
        return None
    path = Path(model_dir) / filename
    if not path.is_file():
        if log:
            log(f"[face] 未找到修复模型 {path}（将跳过修复）")
        return None
    try:
        import onnxruntime as ort
    except Exception as error:  # noqa: BLE001
        if log:
            log(f"[face] onnxruntime 不可用：{error}")
        return None

    class _OnnxRestorer:
        def __init__(self, source: str):
            providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
                         if p in ort.get_available_providers()]
            self._session = ort.InferenceSession(source, providers=providers or None)
            inputs = self._session.get_inputs()
            # 图像输入 = 形状为 4 维的那个（否则取第一个）；尺寸取最后一维的静态值，动态维回落 512。
            image = next((item for item in inputs if len(item.shape) == 4), inputs[0])
            self._image_input = image.name
            self._size = 512
            for dim in reversed(list(image.shape)):
                if isinstance(dim, int) and dim > 1:
                    self._size = int(dim)
                    break
            # 保真度输入 = 名字命中候选词、或以 "weight" 结尾的那个；没有就只喂图像。
            self._fidelity_input = ""
            self._fidelity_dtype = np.float32
            for item in inputs:
                if item is image:
                    continue
                lowered = item.name.lower()
                if lowered in FIDELITY_INPUT_NAMES or lowered.endswith("weight"):
                    self._fidelity_input = item.name
                    self._fidelity_dtype = onnx_scalar_dtype(item.type)
                    break
            if log:
                log(f"[face] ONNX 修复器就绪：image_input={self._image_input!r} size={self._size} "
                    f"fidelity_input={self._fidelity_input or '<无>'}({np.dtype(self._fidelity_dtype).name}) "
                    f"outputs={[out.name for out in self._session.get_outputs()]}")

        def restore(self, crop, fidelity):  # noqa: D102
            import cv2

            resized = cv2.resize(crop, (self._size, self._size), interpolation=cv2.INTER_LINEAR)
            tensor = (resized.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
            feeds = {self._image_input: tensor}
            if self._fidelity_input:
                feeds[self._fidelity_input] = np.array([[float(fidelity)]], dtype=self._fidelity_dtype)
            output = np.asarray(self._session.run(None, feeds)[0])[0]
            if output.shape[0] == 3:      # [3,H,W] → [H,W,3]
                output = output.transpose(1, 2, 0)
            restored = np.clip(output, 0.0, 1.0) * 255.0
            return restored.astype(np.uint8)

    return _OnnxRestorer(str(path))


# ---------------------- 参考组增强（L1） ----------------------


def build_reference_sheet(images: list, detector: Optional[FaceDetector], log=print, max_faces: int = 4,
                          tile: int = 512) -> Optional[bytes]:
    """把参考图里的人脸裁出、放大、拼成一张「角色参考组」（PNG bytes）。

    社区共识：清晰的正/四分之三脸特写是身份锚定的关键；把散落在多张参考图里的人脸集中放大，
    能让 H3 在输出人脸很小时仍有足够的身份信号。检测不到脸或没有可用图时返回 None（不干预）。
    """
    from PIL import Image

    if not images:
        return None
    faces = []
    for raw in images:
        try:
            image = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:  # noqa: BLE001
            continue
        frame = np.asarray(image)
        boxes = []
        if detector is not None:
            try:
                boxes = detector.detect(frame)
            except Exception:  # noqa: BLE001
                boxes = []
        if not boxes:
            continue
        box = max(boxes, key=lambda b: b[2] * b[3])
        x, y, w, h = expand_box(box, 2.2, image.width, image.height)
        if w < 8 or h < 8:
            continue
        crop = image.crop((int(x), int(y), int(x + w), int(y + h))).resize((tile, tile), Image.LANCZOS)
        faces.append(crop)
        if len(faces) >= max_faces:
            break
    if not faces:
        if log:
            log("[face] 参考图未检出人脸，不做参考组增强")
        return None
    columns = min(len(faces), 2)
    rows = (len(faces) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * tile, rows * tile), (32, 32, 32))
    for index, face in enumerate(faces):
        sheet.paste(face, ((index % columns) * tile, (index // columns) * tile))
    buffer = io.BytesIO()
    sheet.save(buffer, format="PNG")
    if log:
        log(f"[face] 参考组增强：从 {len(images)} 张参考图裁出 {len(faces)} 张人脸 → {sheet.width}x{sheet.height}")
    return buffer.getvalue()


# ---------------------- 视频后处理（av 解码/重编码 + 原音轨 copy） ----------------------


def _decode(data: bytes):
    """解码为帧列表 + 原音频包 + 音频流模板（+ 保持打开的输入容器）；调用方负责在重编码后关闭容器。

    保留容器不关：`add_stream_from_template` 需要输入音频流的编解码参数仍然有效，提前 close 会使其失效。
    """
    import av

    container = av.open(io.BytesIO(data))
    video = container.streams.video[0]
    fps = float(video.average_rate or 24)
    audio = container.streams.audio[0] if container.streams.audio else None
    video_packets, audio_packets = [], []
    for packet in container.demux():
        if packet.size == 0:
            continue
        if packet.stream.type == "video":
            video_packets.append(packet)
        elif audio is not None and packet.stream.index == audio.index:
            audio_packets.append(packet)
    frames = [frame.to_ndarray(format="rgb24") for packet in video_packets for frame in packet.decode()]
    size = (frames[0].shape[1], frames[0].shape[0]) if frames else (0, 0)
    return frames, fps, size, audio_packets, audio, container


def _encode(frames, fps: float, size, audio_packets, audio_template, log=print) -> bytes:
    """重编码视频并**原样 copy** 音频流（不重编码音频，保住 H3 的原生立体声）。"""
    import av

    buffer = io.BytesIO()
    output = av.open(buffer, mode="w", format="mp4")
    stream = output.add_stream("libx264", rate=int(round(fps)), options={"crf": "16", "preset": "veryfast"})
    stream.width, stream.height = int(size[0]), int(size[1])
    stream.pix_fmt = "yuv420p"
    audio_out = None
    if audio_packets and audio_template is not None:
        audio_out = output.add_stream_from_template(audio_template)
    for array in frames:
        frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(array), format="rgb24")
        for packet in stream.encode(frame):
            output.mux(packet)
    for packet in stream.encode():
        output.mux(packet)
    if audio_out is not None:
        for packet in audio_packets:
            packet.stream = audio_out
            output.mux(packet)
    output.close()
    return buffer.getvalue()


def refine_video_bytes(data: bytes, params: RefineParams, model_dir: str = "", detector: Optional[FaceDetector] = None,
                       restorer: Optional[FaceRestorer] = None, log=print) -> tuple:
    """对已生成的 mp4 做「检测→跟踪→裁剪→修复→羽化缝合」，音轨原样保留。

    返回 (bytes, report)。任何一步失败都**不抛给调用方**：记录 report.applied=false + reason，并原样返回输入，
    保证「修复失败不连坐生成」。确定性：同一输入 + 同一模型 → 同一输出。
    """
    report = {"requested": params.model, "applied": False, "reason": "", "faces": 0, "minFacePx": 0,
              "profile": "none", "fidelity": params.fidelity, "cropFactor": params.crop_factor,
              "canvas": params.canvas}
    log = log or (lambda *args, **kwargs: None)
    started = time.time()
    if params.model == "off" or not data:
        report["reason"] = "disabled"
        return data, report
    try:
        import cv2
    except Exception as error:  # noqa: BLE001
        report["reason"] = f"cv2 unavailable: {error}"
        return data, report
    if detector is None and model_dir:
        detector = load_detector(model_dir, log=log)
    if restorer is None and model_dir:
        restorer = load_restorer(model_dir, params.model, log=log)
    if detector is None or restorer is None:
        report["reason"] = "models unavailable"
        log("[face] 检测/修复模型不可用，跳过人脸阶段（照常交付原始产物）")
        return data, report
    container = None
    try:
        frames, fps, size, audio_packets, audio_template, container = _decode(data)
        if not frames:
            report["reason"] = "no frames"
            return data, report
        faces_per_frame = []
        for frame in frames:
            try:
                faces_per_frame.append(detector.detect(frame))
            except Exception:  # noqa: BLE001
                faces_per_frame.append([])
        plan = plan_refine(faces_per_frame, params, log=log)
        report.update({"faces": len(plan["tracks"]), "minFacePx": plan["minFacePx"], "profile": plan["profile"],
                       "canvas": plan["canvas"], "cropFactor": plan["cropFactor"], "fidelity": plan["fidelity"]})
        if not plan["tasks"]:
            report["reason"] = "no faces"
            return data, report
        restored = [frame.copy() for frame in frames]
        for task in plan["tasks"]:
            frame, box = frames[task["frame"]], task["box"]
            x, y, w, h = expand_box(box, plan["cropFactor"], size[0], size[1])
            x, y, w, h = int(x), int(y), int(w), int(h)
            if w < 8 or h < 8:
                continue
            crop = frame[y:y + h, x:x + w]
            fixed = restorer.restore(crop, plan["fidelity"])
            if fixed is None or fixed.shape[0] < 2:
                continue
            fixed = cv2.resize(fixed, (w, h), interpolation=cv2.INTER_LANCZOS4)
            alpha = feather_alpha(w, h, params.feather)
            region = restored[task["frame"]][y:y + h, x:x + w].astype(np.float32)
            blended = region * (1.0 - alpha[..., None]) + fixed.astype(np.float32) * alpha[..., None]
            restored[task["frame"]][y:y + h, x:x + w] = np.clip(blended, 0, 255).astype(np.uint8)
        output = _encode(restored, fps, size, audio_packets, audio_template, log=log)
        report["applied"] = True
        report["elapsedSec"] = round(time.time() - started, 1)
        log(f"[face] 完成：修复 {report['faces']} 张脸（{report['profile']} 档），"
            f"用时 {report['elapsedSec']}s，音轨原样保留")
        return output, report
    except Exception as error:  # noqa: BLE001
        report["reason"] = f"{type(error).__name__}: {error}"
        report["elapsedSec"] = round(time.time() - started, 1)
        log(f"[face] 人脸阶段失败（照常交付原始产物）：{report['reason']}")
        return data, report
    finally:
        try:
            if container is not None:
                container.close()
        except Exception:  # noqa: BLE001
            pass


# ---------------------- 自检（无 GPU / 无模型 / 无 av） ----------------------


def _selftest() -> int:
    failures = []

    def check(name, run):
        try:
            run()
            print(f"PASS  {name}")
        except Exception as error:  # noqa: BLE001
            failures.append(name)
            print(f"FAIL  {name}: {error}")

    check("expand_box 外扩并夹到画面内", lambda: (
        _assert(expand_box((100, 100, 20, 20), 2.5, 200, 200) == (85.0, 85.0, 50.0, 50.0),
                expand_box((100, 100, 20, 20), 2.5, 200, 200)),
        _assert(expand_box((0, 0, 20, 20), 3.0, 100, 100)[0] == 0.0),
        _assert(expand_box((0, 0, 20, 20), 3.0, 100, 100)[2] <= 100.0),
        _assert(expand_box((500, 500, 20, 20), 2.5, 100, 100)[2] == 0.0),  # 完全在画面外 → 零尺寸
    ))

    def feather():
        mask = feather_weights(64, 0.2)
        _assert(mask.shape == (64, 64))
        _assert(0.0 <= float(mask.min()) and float(mask.max()) <= 1.0)
        _assert(float(mask[0, 0]) < 0.2 and float(mask[32, 32]) > 0.9)

    check("feather_weights 边缘过渡/中心满值", feather)

    def profiles():
        params = RefineParams()
        profile, canvas, crop, fidelity = choose_profile(20, params)
        _assert((profile, canvas, crop) == ("longshot", LONGSHOT_CANVAS, LONGSHOT_CROP_FACTOR), (profile, canvas, crop))
        _assert(fidelity < params.fidelity)
        profile2, canvas2, crop2, fidelity2 = choose_profile(120, params)
        _assert((profile2, canvas2, crop2, fidelity2) == ("default", params.canvas, params.crop_factor, params.fidelity))
        _assert(choose_profile(10, replace(params, longshot=False))[0] == "default")

    check("choose_profile 远景档阈值与关闭开关", profiles)

    def tracking():
        # 两帧同一张脸 → 1 条轨迹；第三帧换位置过远 → 新轨迹
        faces = [[(10.0, 10.0, 8.0, 8.0)], [(11.0, 10.0, 8.0, 8.0)], [(90.0, 90.0, 8.0, 8.0)]]
        tracks = group_tracks(faces, iou_thresh=0.3, max_gap=1)
        _assert(len(tracks) == 2, [t["indexes"] for t in tracks])
        _assert(tracks[0]["indexes"] == [0, 1], tracks[0]["indexes"])

    check("group_tracks 按 IoU 归并", tracking)

    def planning():
        faces = [[(10.0, 10.0, 6.0, 6.0)], [(10.0, 10.0, 6.0, 6.0)]]
        plan = plan_refine(faces, RefineParams(), log=None)
        _assert(len(plan["tasks"]) == 2 and plan["profile"] == "longshot", plan)
        empty = plan_refine([[], []], RefineParams(), log=None)
        _assert(empty["tasks"] == [] and empty["profile"] == "none", empty)

    check("plan_refine 任务/空输入", planning)

    def mapping():
        params = RefineParams.from_mapping({"faceRefine": "gfpgan", "faceFidelity": 2, "faceCropFactor": -1,
                                            "faceCanvasSize": "512"})
        _assert(params.model == "gfpgan" and params.fidelity == 1.0 and params.crop_factor == 1.0 and params.canvas == 512,
                params)
        _assert(RefineParams.from_mapping({"faceRefine": "bogus"}).model == "codeformer")

    check("RefineParams.from_mapping 归一/夹取", mapping)

    check("onnx_scalar_dtype 按声明类型构造标量", lambda: (
        _assert(onnx_scalar_dtype("tensor(double)") is np.float64),
        _assert(onnx_scalar_dtype("tensor(float)") is np.float32),
        _assert(onnx_scalar_dtype("tensor(float16)") is np.float16),
        _assert(onnx_scalar_dtype(None) is np.float32),
    ))

    def sheet_skips_without_faces():
        from PIL import Image
        buffer = io.BytesIO()
        Image.new("RGB", (64, 64), (10, 20, 30)).save(buffer, format="PNG")
        _assert(build_reference_sheet([buffer.getvalue()], StubDetector(boxes=[]), log=None) is None)

    check("参考组：无人脸则不干预", sheet_skips_without_faces)

    def sheet_builds():
        from PIL import Image
        buffer = io.BytesIO()
        Image.new("RGB", (128, 128), (200, 100, 50)).save(buffer, format="PNG")
        sheet = build_reference_sheet([buffer.getvalue()], StubDetector(boxes=[(40, 40, 40, 40)]), log=None, tile=64)
        _assert(sheet and sheet[:8] == b"\x89PNG\r\n\x1a\n", sheet[:8] if sheet else None)
        _assert(Image.open(io.BytesIO(sheet)).size == (64, 64))

    check("参考组：有脸则拼出 PNG", sheet_builds)

    def refine_degrades_without_models():
        out, report = refine_video_bytes(b"not-a-video", RefineParams(), model_dir="", log=None)
        _assert(out == b"not-a-video" and report["applied"] is False, report)

    check("无模型时优雅降级（不连坐）", refine_degrades_without_models)

    if failures:
        print(f"\n{len(failures)} 项失败：{', '.join(failures)}")
        return 1
    print("\n全部通过：人脸保持层（几何/跟踪/档位/参考组/降级）在本地单测通过。")
    return 0


def _assert(condition, detail=""):
    if not condition:
        raise AssertionError(detail)


if __name__ == "__main__":
    import sys

    raise SystemExit(_selftest() if "--selftest" in sys.argv else print(json.dumps(
        {"ok": True, "usage": "python face_refine.py --selftest"})))
