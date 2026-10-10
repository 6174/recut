"""
[INPUT]: Modal 运行时（modal.Image from lmsysorg/sglang:dev、modal.Volume、modal.Secret recut-hf-token）；
          h3_contract（Ref2VA 请求构造与 SGLang 异步视频协议）；face_refine（参考组增强 + 人脸修复后处理）；
          /models 卷（**复用** minimax-h3 下好的 MiniMax-H3 Ref2VA 权重）、/merged 卷（**复用** minimax-h3-turbo
          离线合并出的 `ref2va-transformer`，即 lightx2v 8 步 Turbo）、/face 卷（本包专有：检测/修复小模型）
[OUTPUT]: 云端 Modal App「recut-minimax-h3-ref」——**Ref2VA 专用**的人脸保持档：H3Ref（`--model-variant ref2va`，
          只加载参考分区，配复用的 ref2v 8 步合并权重，默认**精确注意力**；服务 reference-to-video）与
          H3FaceRefine（小 GPU、不加载 SGLang/DiT，用 ONNX 模型对**已有视频**做同一套人脸修复）；
          generate_video = 参考组增强（L1）→ 提交 Ref2VA（8 步）→ 人脸修复（L4，可关）→ 落 /out（保留原始 mp4）；
          bootstrap 三步为**验证/复用**：校验共享权重与合并产物存在、下载本包的人脸小模型
[POS]: minimax-h3 系列的**参考生视频专用档**（与 minimax-h3 / -one / -turbo 并列，但只做 ref2video 这一主场景）；
       权重与 Turbo 合并产物全部复用已有卷，本包只新增「人脸保持」这一层与一个几百 MB 的模型卷
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import modal

from face_refine import RefineParams, build_reference_sheet, load_detector, refine_video_bytes
from h3_contract import build_video_body, submit_video, write_reference_conditions

os.environ.setdefault("MODAL_IMAGE_BUILDER_VERSION", "2025.06")
os.environ.setdefault("MODAL_USE_LEGACY_IMAGE_ENTRYPOINT", "0")

APP_NAME = "recut-minimax-h3-ref"
MODELS_VOLUME = "recut-minimax-h3-models"          # 复用：MiniMax-H3 权重（本包只读 Ref2VA 分区）
MERGED_VOLUME = "recut-minimax-h3-turbo-merged"    # 复用：turbo 离线合并出的 `ref2va-transformer`（lightx2v 8 步）
FACE_VOLUME = "recut-minimax-h3-ref-face"          # 本包专有：检测/修复小模型（几百 MB）
OUT_VOLUME = "recut-minimax-h3-ref-out"            # 本包专有：产物中转
MODELS_DIR, MERGED_DIR, FACE_DIR, OUT_DIR = "/models", "/merged", "/face", "/out"
MODEL_SUBDIR = "MiniMax-H3"
REF_VARIANT = "ref2va"
REF_MERGED_SUBDIR = "ref2va-transformer"
PORT = 30010
REF_DIR = "/tmp/h3-ref-refs"

WEIGHTS_MARKER = ".recut-download-complete"        # 复用 minimax-h3 的共享卷标记（子串匹配，兼容 -v2）
MERGED_MARKER = ".recut-merge-ref2va-complete"     # 复用 minimax-h3-turbo 的合并完成标记
FACE_MARKER = ".recut-facemodels-complete"

# 人脸模型（本包专有）：检测用 OpenCV Zoo 的 YuNet；修复用 CodeFormer 的 ONNX 导出。
# 修复模型取 FaceFusion 的导出（社区使用最广），并**按 commit pin 住**以保证可复现。下载在 Modal 侧进行
# （本机常连不上 huggingface.co）。`load_restorer` 会自适应读取实际的输入名/尺寸，换导出不必改代码，
# 但换之前请核对 I/O 是否 face-in/face-out。
FACE_DETECTION_URL = os.environ.get(
    "RECUT_H3_FACE_DETECTION_URL",
    "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx")
FACE_RESTORE_URLS = {
    "codeformer": os.environ.get(
        "RECUT_H3_CODEFORMER_URL",
        "https://huggingface.co/facefusion/models-3.0.0/resolve/"
        "728b9659bd9691bf32cbf7f61af478d94b7ba81e/codeformer.onnx"),
    "gfpgan": os.environ.get("RECUT_H3_GFPGAN_URL", ""),
}

# 步数：复用 lightx2v ref2v turbo 8 步（请求 = sigma 网格点 = 去噪次数+1 → 9）。
DEFAULT_STEPS = 9
# 注意力后端：**人脸保持档默认精确**（`auto` 在 SM90/100/120 会选近似的 subblock_sparse，对微细节不利）。
# SM12.x 无 fa kernel 时会自动回退精确 torch_sdpa。改用近似后端＝用脸部细节换速度，需自行抽检。
ATTENTION_BACKEND = os.environ.get("RECUT_H3_REF_ATTENTION", "fa")
# 形状预热：原意是把分配器/算子/首帧成本冻进 GPU 快照。调试期不用快照，预热就变成「每次冷启动多付
# 约 90s」，收益不再成立，故默认关闭（需要时置 True，并配合重新启用 snapshot）。
WARMUP = False
WARMUP_ASPECT = "16:9"
WARMUP_DURATION_SEC = 4
WARMUP_STEPS = 9
WARMUP_RESOLUTION = "1344x768"
BENCH_PROMPT = "A woman turns her head toward the camera and smiles, soft daylight."

app = modal.App(APP_NAME)

image = (
    modal.Image.from_registry("lmsysorg/sglang:dev")
    .entrypoint([])
    .run_commands(
        'python -m pip install --no-cache-dir -e "/sgl-workspace/sglang/python[diffusion]"',
        "python -m pip install --no-cache-dir huggingface_hub requests "
        "onnxruntime-gpu opencv-python-headless av numpy pillow",
    )
    .add_local_python_source("h3_contract", "face_refine")
)

models = modal.Volume.from_name(MODELS_VOLUME, create_if_missing=True)
merged = modal.Volume.from_name(MERGED_VOLUME, create_if_missing=True)
face_models = modal.Volume.from_name(FACE_VOLUME, create_if_missing=True)
outputs = modal.Volume.from_name(OUT_VOLUME, create_if_missing=True)

bootstrap_image = (
    modal.Image.debian_slim(python_version="3.11")
    # face_refine 在导入期就用 numpy/pillow，而 bootstrap 容器也会 import modal_app.py → face_refine，
    # 所以这个轻量镜像必须带上它们（否则 bootstrap 一进容器就 ModuleNotFoundError）。
    .pip_install("huggingface_hub", "requests", "numpy", "pillow")
    .add_local_python_source("h3_contract", "face_refine")
)


class PrereqError(RuntimeError):
    """前置产物缺失（确定性错误）：本包**不下载** H3 权重与 Turbo 合并产物，缺失时应指向应跑的那个包。"""


def _assert_shared_ready() -> None:
    """校验复用的共享产物（权重 + Turbo ref2v 合并）是否就绪，缺失时给出可执行的修复指引。"""
    if not (Path(MODELS_DIR) / MODEL_SUBDIR / "Ref2VA" / "transformer").is_dir():
        raise PrereqError(
            f"共享卷 {MODELS_VOLUME} 缺 Ref2VA 权重：请先对本包的前置预设包执行 modal.install，"
            "例如 `modal.install { modalapp: 'minimax-h3-turbo' }`（bootstrap_weights 会补下 Ref2VA 分区）。")
    if not (Path(MERGED_DIR) / REF_MERGED_SUBDIR / "model.safetensors.index.json").is_file():
        raise PrereqError(
            f"共享卷 {MERGED_VOLUME} 缺 Ref2VA 合并权重（{REF_MERGED_SUBDIR}）：请先 `modal.install "
            "{ modalapp: 'minimax-h3-turbo' }`（bootstrap_merge 会把 lightx2v ref2v 8 步 LoRA 离线合并进 Ref2VA transformer）。")


def _server_flags() -> list:
    """Ref2VA 专用单卡配方：只加载参考分区 + 复用的 ref2v 8 步合并权重；96GB 级卡用 fp8 DiT 常驻。"""
    import torch

    count = torch.cuda.device_count()
    if count != 1:
        raise RuntimeError(f"minimax-h3-ref 只提供单卡档（GPU 快照 + 人脸阶段），检测到 {count} 张 GPU")
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    flags = ["--model-path", f"{MODELS_DIR}/{MODEL_SUBDIR}", "--model-variant", REF_VARIANT,
             "--host", "127.0.0.1", "--port", str(PORT),
             "--num-gpus", "1", "--performance-mode", "speed", "--enable-torch-compile", "false",
             "--component-weights-paths.transformer", f"{MERGED_DIR}/{REF_MERGED_SUBDIR}"]
    if vram_gb < 130:
        flags += ["--quantization", "fp8", "--layerwise-offload-components", "text_encoder"]
    if ATTENTION_BACKEND and ATTENTION_BACKEND != "auto":
        flags += ["--attention-backend", ATTENTION_BACKEND]
    return flags


_SERVER: dict = {"proc": None}
_LOCK = threading.Lock()


def _healthy() -> bool:
    import requests

    for route in ("/health", "/v1/models"):
        try:
            if requests.get(f"http://127.0.0.1:{PORT}{route}", timeout=3).status_code == 200:
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


def _ensure_server() -> None:
    """幂等：复用本容器内已在监听的 Ref2VA 服务，否则启动并等待就绪（前置缺失报可执行错误）。"""
    _assert_shared_ready()
    proc = _SERVER.get("proc")
    if proc is not None and proc.poll() is None and _healthy():
        return
    with _LOCK:
        proc = _SERVER.get("proc")
        if proc is not None and proc.poll() is None and _healthy():
            return
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()
        command = ["sglang", "serve", *_server_flags()]
        print(f"[modal] 启动 SGLang Ref2VA 服务（复用 ref2v 8 步合并权重，注意力 {ATTENTION_BACKEND}）："
              + " ".join(command), flush=True)
        env = {**os.environ, "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True", "PYTHONUNBUFFERED": "1"}
        proc = subprocess.Popen(command, stdout=sys.stdout, stderr=subprocess.STDOUT, env=env)
        _SERVER["proc"] = proc
        deadline = time.time() + 3000
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"SGLang 服务退出（code {proc.returncode}）")
            if _healthy():
                print("[modal] SGLang Ref2VA 服务已就绪。", flush=True)
                return
            time.sleep(5)
        raise RuntimeError("SGLang 服务启动超时")


def _placeholder_png() -> bytes:
    """合成占位参考图（预热只求命中同一形状的参考编码/去噪路径）。"""
    try:
        import io

        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (512, 512), (128, 128, 128)).save(buffer, format="PNG")
        return buffer.getvalue()
    except Exception:  # noqa: BLE001
        import base64

        return base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


def _warmup_refs() -> list:
    return [{"field": "referenceImages", "name": "warmup.png", "mimeType": "image/png", "data": _placeholder_png()}]


def _warmup() -> None:
    print(f"[modal] Ref2VA 形状预热（{WARMUP_RESOLUTION}，{WARMUP_DURATION_SEC}s，{WARMUP_STEPS} 步）…", flush=True)
    conditions = write_reference_conditions(_warmup_refs(), REF_DIR)
    body = build_video_body(BENCH_PROMPT, aspect_ratio=WARMUP_ASPECT, duration_sec=WARMUP_DURATION_SEC,
                            steps=WARMUP_STEPS, seed=1000, conditions=conditions)
    started = time.time()
    submit_video(f"http://127.0.0.1:{PORT}", body, log=None)
    print(f"[modal] 预热完成（{round(time.time() - started, 1)}s）。", flush=True)


# ---------------------- 参考组增强（L1） ----------------------


def _image_refs(refs: list) -> list:
    """挑出参考图（field=referenceImages，或未标 field 且 mimeType 为图片）。"""
    out = []
    for ref in refs or []:
        field = str(ref.get("field") or "")
        mime = str(ref.get("mimeType") or "").lower()
        if field == "referenceImages" or (field == "" and mime.startswith("image/")):
            out.append(ref)
    return out


def _enhance_references(refs: list, prompt: str, params: RefineParams, log=print) -> tuple:
    """参考组增强：把参考图里的人脸裁出放大拼成一张「角色参考组」，追加为最后一张参考图。

    返回 (refs, prompt, note)。检测不到脸或关闭时原样返回。追加在**末尾**，因此调用方原有的
    `<Picture 1..N>` 编号不受影响；新图编号为 N+1，必要时在提示词末尾补一句说明（可关闭）。
    """
    images = _image_refs(refs or [])
    if not images:
        return refs, prompt, {"applied": False, "reason": "no image references"}
    detector = load_detector(FACE_DIR, log=log)
    if detector is None:
        return refs, prompt, {"applied": False, "reason": "detector unavailable"}
    sheet = build_reference_sheet([ref.get("data") for ref in images], detector, log=log)
    if sheet is None:
        return refs, prompt, {"applied": False, "reason": "no faces in references"}
    index = len([ref for ref in (refs or []) if str(ref.get("field") or "") in ("", "referenceImages")])
    enhanced = list(refs or []) + [{"field": "referenceImages", "name": "character-sheet.png",
                                    "mimeType": "image/png", "data": sheet}]
    if params.sheet_prompt and prompt:
        prompt = f"{prompt}\n\nUse <Picture {index + 1}> as the character reference sheet to keep the face and hairstyle consistent."
    return enhanced, prompt, {"applied": True, "picture": index + 1, "bytes": len(sheet)}


# ---------------------- 共享执行体 ----------------------


def _run_ref_video(prompt: str, aspect_ratio: str, duration_sec: float, steps: int, seed: int, refs, resolution: str,
                   face_params: RefineParams, sheet_enabled: bool, keep_raw: bool, log=print) -> dict:
    """参考生视频主链：参考组增强 → Ref2VA（8 步）→ 人脸修复（可关）→ 落 /out（保留原始产物）。"""
    _ensure_server()
    sheet_note = {"applied": False, "reason": "disabled"}
    if sheet_enabled:
        refs, prompt, sheet_note = _enhance_references(refs or [], prompt, face_params, log=log)
    conditions = write_reference_conditions(refs or [], REF_DIR)
    body = build_video_body(prompt, aspect_ratio=aspect_ratio, duration_sec=duration_sec, steps=steps,
                            seed=seed, conditions=conditions, resolution=resolution)
    print(f"[modal] 提交 H3 {body['task']}（{body['seconds']}s，{body['target']['aspect_ratio']}，"
          f"短边 {body['target']['short_edge']}，{body['num_inference_steps']} steps，seed {body['seed']}，"
          f"{len(conditions)} 条件）…", flush=True)
    started = time.time()
    data = submit_video(f"http://127.0.0.1:{PORT}", body, log=log)
    generate_seconds = round(time.time() - started, 1)

    raw_key, key = "", f"runs/{uuid.uuid4().hex}.mp4"
    report = {"applied": False, "reason": "noop", "model": face_params.model}
    refined = data
    if face_params.model != "off":
        print(f"[modal] 人脸修复阶段（{face_params.model}）…", flush=True)
        refined, report = refine_video_bytes(data, face_params, model_dir=FACE_DIR, log=log)

    path = Path(OUT_DIR) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(refined)
    if keep_raw and report.get("applied"):
        raw_key = f"runs/{uuid.uuid4().hex}.raw.mp4"
        raw_path = Path(OUT_DIR) / raw_key
        raw_path.write_bytes(data)
    outputs.commit()
    print(f"[modal] 已生成 {key}（生成 {generate_seconds}s，修复 {'是' if report.get('applied') else '否'}）。", flush=True)
    return {"kind": "file", "volume": OUT_VOLUME, "key": key, "mimeType": "video/mp4",
            "meta": {"durationSec": float(duration_sec), "fps": 24, "seed": body["seed"], "steps": int(steps),
                     "audio": True, "task": body["task"], "attentionBackend": ATTENTION_BACKEND,
                     "referenceSheet": sheet_note, "faceRefine": report,
                     "rawKey": raw_key, "generateSeconds": generate_seconds}}


@app.cls(image=image, gpu="RTX-PRO-6000",
         volumes={MODELS_DIR: models, MERGED_DIR: merged, FACE_DIR: face_models, OUT_DIR: outputs},
         timeout=3600, max_containers=1, memory=262144,
         retries=0)  # 确定性失败只报一次，避免 crash-loop 空烧 GPU
         # 调试期不启用 GPU memory snapshot（enable_memory_snapshot / enable_gpu_snapshot）：
         # 实测首次调用要为建快照多付约 10 分钟，而快照增益不明显。后续需要时再把这两项加回来。
class H3Ref:
    """Ref2VA 专用：服务 reference-to-video（参考生视频 + 人脸保持），只加载参考分区 + 复用的 8 步合并权重。"""

    @modal.enter()
    def start(self):
        try:
            _ensure_server()
        except PrereqError as error:
            print(f"[modal] 启动前置未满足（调用时会再次校验并报错）：{error}", flush=True)
            return
        if WARMUP:
            try:
                _warmup()
            except Exception as error:  # noqa: BLE001
                print(f"[modal] 预热失败（忽略，服务仍可用）：{error}", flush=True)

    @modal.exit()
    def stop(self):
        proc = _SERVER.get("proc")
        if proc is not None and proc.poll() is None:
            proc.terminate()

    @modal.method()
    def generate_video(self, prompt: str, aspectRatio: str = "auto", durationSec: float = 5,
                       steps: int = DEFAULT_STEPS, seed: int = -1, resolution: str = "", refs=None,
                       faceRefine: str = "auto", faceFidelity: float = 0.6, faceCropFactor: float = 2.5,
                       faceCanvasSize: str = "768", facePersonFallback: bool = False,
                       outputQuality: str = "detail", referenceSheet: str = "auto", keepRaw: bool = True):
        if not (refs or []):
            raise ValueError("reference-to-video 需要至少一个参考素材（图像/视频/音频）")
        _assert_shared_ready()  # 调用级断言：前置缺失归属这一次调用，可直接返回本机
        params = RefineParams.from_mapping({
            "faceRefine": faceRefine if faceRefine != "auto" else "codeformer",
            "faceFidelity": faceFidelity, "faceCropFactor": faceCropFactor,
            "faceCanvasSize": faceCanvasSize, "facePersonFallback": facePersonFallback,
            "outputQuality": outputQuality})
        return _run_ref_video(prompt, aspectRatio, durationSec, steps, seed, refs, resolution,
                              params, sheet_enabled=(referenceSheet != "off"), keep_raw=keepRaw)

    @modal.method()
    def bench(self, runs: int = 3, steps: int = DEFAULT_STEPS, durationSec: float = 5.0):
        """参考生视频时延/显存实测入口（`modal run bench.py`）。"""
        import statistics

        import torch

        _ensure_server()
        seconds = []
        for index in range(int(runs)):
            conditions = write_reference_conditions(_warmup_refs(), REF_DIR)
            body = build_video_body(BENCH_PROMPT, aspect_ratio=WARMUP_ASPECT, duration_sec=durationSec,
                                    steps=steps, seed=1000 + index, conditions=conditions)
            started = time.time()
            submit_video(f"http://127.0.0.1:{PORT}", body, log=None)
            elapsed = round(time.time() - started, 2)
            seconds.append(elapsed)
            print(f"[modal] bench {index + 1}/{runs}：{elapsed}s", flush=True)
        return {"app": APP_NAME, "task": "ref2va", "attentionBackend": ATTENTION_BACKEND,
                "gpu": torch.cuda.get_device_name(0), "steps": int(steps), "runs": int(runs),
                "seconds": seconds, "medianSec": round(statistics.median(seconds), 2) if seconds else None}


@app.cls(image=image, gpu="L4",
         volumes={FACE_DIR: face_models, OUT_DIR: outputs},
         timeout=1800, max_containers=1, memory=16384, retries=0)
class H3FaceRefine:
    """只做「对已有视频的人脸修复」：不加载 SGLang/DiT，跑在便宜的小卡上，用于「只重跑修复」的恢复路径。"""

    @modal.method()
    def refine_video(self, refs=None, faceRefine: str = "codeformer", faceFidelity: float = 0.6,
                     faceCropFactor: float = 2.5, faceCanvasSize: str = "768", facePersonFallback: bool = False,
                     outputQuality: str = "detail"):
        source = next((ref for ref in (refs or []) if str(ref.get("mimeType") or "").startswith("video/")), None)
        if source is None or source.get("data") is None:
            raise ValueError("face-refine 需要一个视频参考素材")
        params = RefineParams.from_mapping({"faceRefine": faceRefine or "codeformer", "faceFidelity": faceFidelity,
                                            "faceCropFactor": faceCropFactor, "faceCanvasSize": faceCanvasSize,
                                            "facePersonFallback": facePersonFallback,
                                            "outputQuality": outputQuality})
        print("[modal] 对已有视频做人脸修复（不重新生成）…", flush=True)
        data, report = refine_video_bytes(bytes(source["data"]), params, model_dir=FACE_DIR, log=print)
        key = f"runs/{uuid.uuid4().hex}.refined.mp4"
        path = Path(OUT_DIR) / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        outputs.commit()
        return {"kind": "file", "volume": OUT_VOLUME, "key": key, "mimeType": "video/mp4",
                "meta": {"audio": True, "faceRefine": report}}


# ---------------------- bootstrap（验证复用 + 下载本包小模型） ----------------------


@app.function(image=bootstrap_image, volumes={MODELS_DIR: models, MERGED_DIR: merged}, timeout=600)
def bootstrap_weights():
    """**不下载** H3 权重：只校验共享卷里 Ref2VA 权重与 Turbo ref2v 合并产物是否就绪（本包复用它们）。"""
    target = Path(MODELS_DIR) / MODEL_SUBDIR / "Ref2VA"
    merged_dir = Path(MERGED_DIR) / REF_MERGED_SUBDIR
    weights_ready = (target / "transformer").is_dir()
    merged_ready = (merged_dir / "model.safetensors.index.json").is_file()
    print(f"[modal] 共享权重（Ref2VA）就绪：{weights_ready}；共享合并产物（{REF_MERGED_SUBDIR}）就绪：{merged_ready}", flush=True)
    if not merged_ready:
        # 旧共享卷可能只合并了 FL2VA；Ref2VA 那份由 minimax-h3-turbo 的 bootstrap_merge 产出。
        raise RuntimeError(
            "缺 Ref2VA 合并产物：请先 `modal.install { modalapp: 'minimax-h3-turbo' }` 以离线合并 lightx2v ref2v 8 步 LoRA。")
    return {"ready": True, "reused": True, "weights": weights_ready, "merged": merged_ready}


@app.function(image=bootstrap_image, volumes={FACE_DIR: face_models}, timeout=1800)
def bootstrap_facemodels(force: bool = False):
    """把人脸检测/修复模型下载进 /face 卷（公开仓库，无需 token）。

    **逐文件校验**（而非只看一个总 marker）：文件存在且体积不小于预期下限才算就绪，因此后续新增或
    更换模型不会被旧 marker 短路；`force=True` 强制重下。体积下限同时用于挡住「把 HTML 错误页
    当成模型存下来」这种情况。
    """
    import requests

    Path(FACE_DIR).mkdir(parents=True, exist_ok=True)
    targets = [("人脸检测（YuNet）", "face_detection_yunet.onnx", FACE_DETECTION_URL, 100 * 1024)]
    for name, url in FACE_RESTORE_URLS.items():
        if url:
            targets.append((f"人脸修复（{name}）", f"{name}.onnx", url, 10 * 1024 * 1024))
    downloaded, skipped = [], []
    for label, filename, url, min_bytes in targets:
        dest = Path(FACE_DIR) / filename
        if not force and dest.is_file() and dest.stat().st_size >= min_bytes:
            skipped.append(filename)
            print(f"[modal] {label} 已就绪（{dest.stat().st_size / 1048576:.1f} MiB），跳过。", flush=True)
            continue
        part = dest.with_suffix(dest.suffix + ".part")
        print(f"[modal] 下载 {label} → {filename}…", flush=True)
        with requests.get(url, stream=True, timeout=(10, 300)) as response:
            response.raise_for_status()
            with part.open("wb") as sink:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    sink.write(chunk)
        if part.stat().st_size < min_bytes:
            raise RuntimeError(
                f"{label} 下载体积异常（{part.stat().st_size} B，期望 ≥ {min_bytes} B）：{url} "
                "可能不是模型文件（例如返回了 HTML 错误页）。")
        part.replace(dest)
        face_models.commit()
        downloaded.append(filename)
        print(f"[modal] 已下载 {label} → {filename}（{dest.stat().st_size / 1048576:.1f} MiB）", flush=True)
    (Path(FACE_DIR) / FACE_MARKER).write_text("ok", encoding="utf-8")
    face_models.commit()
    files = sorted(path.name for path in Path(FACE_DIR).glob("*.onnx"))
    print(f"[modal] /face 就绪：{files}", flush=True)
    return {"ready": True, "downloaded": downloaded, "skipped": skipped, "files": files}
