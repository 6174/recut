"""
[INPUT]: 仅标准库（base64/json/random/time/urllib/pathlib）；H3 表单参数与参考素材 bytes（带 field 角色标记）
[OUTPUT]: H3 与 SGLang /v1/videos 之间的纯契约：build_video_body（按参考角色推断 task：t2va/fl2va/ref2va，组请求体，
          含种子归一与类型归一）、write_reference_conditions（按 field/mimeType 把参考素材落盘为 file:// 条件：
          首/尾帧 role=keyframe + frame_index，其余 role=reference，图像/视频/音频按类型声明）、
          submit_video（POST→轮询→下载 content 的异步视频协议，兼容直接返回字节/内联 b64/url 的旧实现）
[POS]: minimax-h3 预设包的契约层；modal_app.py（云端容器）与 mock.py（本地 mock）共用，
       可用 mock_sglang.py 在没有 GPU/Modal 的情况下单测
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import base64
import json
import random
import time
from pathlib import Path
from urllib import error as _urlerror
from urllib import request as _urlrequest

MODEL_NAME = "MiniMaxAI/MiniMax-H3"
VALID_TASKS = ("t2va", "fl2va", "ref2va")
MIN_SECONDS = 4
MAX_SECONDS = 15

# 参考素材角色：keyframe 用于 FL2VA 的首/尾帧（frame_index 0=首帧、-1=尾帧）；
# 其余落入 reference（Ref2VA 的多模态参考：图像/视频/音频）。
KEYFRAME_FIELDS = {"firstFrame": 0, "lastFrame": -1}
REFERENCE_KINDS = {"referenceImages": "image", "referenceVideos": "video", "referenceAudios": "audio"}
# 参考视频可选：type=video（可无音轨）/ video_audio（必须有音轨）；表单字段用后者按需区分。
_KIND_EXT = {"image": ".png", "video": ".mp4", "video_audio": ".mp4", "audio": ".mp3"}

_COMPLETED = {"completed", "succeeded", "success", "done"}
_FAILED = {"failed", "error", "canceled", "cancelled"}


def normalize_seed(seed) -> int:
    """SGLang 只接受非负整数种子；表单的 -1（随机）归一化为具体随机种子。"""
    try:
        value = int(seed)
    except (TypeError, ValueError):
        value = -1
    if value < 0:
        return random.SystemRandom().randint(0, 2**31 - 1)
    return value


def task_for_conditions(conditions) -> str:
    """从条件角色推断 task：含 reference → ref2va；含 keyframe → fl2va；否则 t2va。"""
    roles = {str(condition.get("role") or "") for condition in (conditions or [])}
    if "reference" in roles:
        return "ref2va"
    if "keyframe" in roles:
        return "fl2va"
    return "t2va"


def build_video_body(prompt: str, *, aspect_ratio: str = "auto", duration_sec=5, steps: int = 50,
                     seed=-1, conditions=None, task: str | None = None) -> dict:
    """按 SGLang H3 契约组 /v1/videos 请求体（seconds 为整数秒、duration_seconds 为浮点秒）。

    `task` 缺省时按 conditions 的角色推断（t2va/fl2va/ref2va），与 SGLang 的 task 语义一致。
    """
    conditions = list(conditions or [])
    resolved_task = task or task_for_conditions(conditions)
    if resolved_task not in VALID_TASKS:
        raise ValueError(f"task must be one of {list(VALID_TASKS)}, got {resolved_task!r}")
    return {
        "model": MODEL_NAME,
        "prompt": prompt,
        "seconds": int(duration_sec),
        "task": resolved_task,
        "conditions": conditions,
        "target": {"short_edge": 768, "aspect_ratio": aspect_ratio or "auto",
                   "duration_seconds": float(duration_sec)},
        "quality": "lossless",
        "num_outputs_per_prompt": 1,
        "num_inference_steps": int(steps),
        "flow_shift": 12.0,
        "audio_flow_shift": 3.0,
        "seed": normalize_seed(seed),
    }


def _ref_kind(ref: dict, field: str) -> str:
    """参考素材类型：优先按表单字段（referenceImages/Videos/Audios），否则按 mimeType 推断。"""
    if field in REFERENCE_KINDS:
        return REFERENCE_KINDS[field]
    mime = str(ref.get("mimeType") or "").lower()
    if mime.startswith("video/"):
        return "video_audio" if ref.get("withAudio") else "video"
    if mime.startswith("audio/"):
        return "audio"
    return "image"


def _suffix_for(ref: dict, kind: str, index: int) -> str:
    suffix = Path(str(ref.get("name") or "")).suffix
    return suffix or _KIND_EXT.get(kind, f".{index}")


def write_reference_conditions(refs, ref_dir) -> list:
    """把参考素材写到本地，返回 SGLang 可读的 file:// 条件列表。

    - `field` 为 firstFrame/lastFrame → `{type:image, role:keyframe, frame_index:0|-1}`（FL2VA）；
    - 其余（referenceImages/Videos/Audios 或按 mimeType 推断）→ `{type:image|video|video_audio|audio, role:reference}`
      （Ref2VA），参考视频可带 `startTimeSeconds`（默认 0）。
    """
    conditions = []
    if not refs:
        return conditions
    target_dir = Path(ref_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    for index, ref in enumerate(refs):
        field = str(ref.get("field") or "")
        data = ref.get("data")
        if data is None:
            continue
        if field in KEYFRAME_FIELDS:
            kind = "image"
        else:
            kind = _ref_kind(ref, field)
        path = target_dir / f"ref{index}{_suffix_for(ref, kind, index)}"
        path.write_bytes(bytes(data))
        if field in KEYFRAME_FIELDS:
            conditions.append({"type": "image", "uri": path.as_uri(), "role": "keyframe",
                               "frame_index": KEYFRAME_FIELDS[field]})
            continue
        condition = {"type": kind, "uri": path.as_uri(), "role": "reference"}
        start = ref.get("startTimeSeconds")
        if kind in ("video", "video_audio") and start is not None:
            try:
                condition["start_time_seconds"] = max(0.0, float(start))
            except (TypeError, ValueError):
                pass
        conditions.append(condition)
    return conditions


def _request(method: str, url: str, body=None, timeout: int = 30):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = _urlrequest.Request(url, data=data, method=method, headers=headers)
    try:
        with _urlrequest.urlopen(request, timeout=timeout) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except _urlerror.HTTPError as error:
        raw = b""
        try:
            raw = error.read()
        except Exception:  # noqa: BLE001
            pass
        head = {k.lower(): v for k, v in (error.headers or {}).items()}
        return int(error.code), head, raw


def _inline_bytes(payload):
    if not isinstance(payload, dict):
        return None
    for key in ("data", "video", "b64_video", "b64_json"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            try:
                return base64.b64decode(value)
            except (ValueError, base64.binascii.Error):
                continue
    return None


def _video_status(base: str, video_id: str, timeout: int = 30):
    status, _, raw = _request("GET", f"{base}/v1/videos/{video_id}", timeout=timeout)
    if status == 200 and raw:
        try:
            info = json.loads(raw.decode("utf-8"))
            if isinstance(info, dict) and "status" in info:
                return info
        except ValueError:
            pass
    status, _, raw = _request("GET", f"{base}/v1/videos", timeout=timeout)
    if status == 200 and raw:
        try:
            listing = json.loads(raw.decode("utf-8"))
        except ValueError:
            return None
        items = listing.get("data") if isinstance(listing, dict) else listing
        for item in items or []:
            if isinstance(item, dict) and (item.get("id") == video_id or item.get("video_id") == video_id):
                return item
    return None


def submit_video(base_url: str, body: dict, timeout: int = 1800, poll_interval: float = 2.0, log=print) -> bytes:
    """POST /v1/videos → 轮询状态 → 下载 /v1/videos/{id}/content，返回 mp4 bytes。"""
    base = str(base_url or "").rstrip("/")
    if not base:
        raise ValueError("SGLang base URL is required")
    if log:
        log(f"[modal] /v1/videos request: {json.dumps(body, ensure_ascii=False)[:1500]}")
    status, headers, raw = _request("POST", f"{base}/v1/videos", body=body, timeout=timeout)
    if status != 200:
        detail = raw.decode("utf-8", "replace").strip()
        if not detail:
            detail = f"<empty body · {headers.get('content-type') or 'no content-type'}>"
        raise RuntimeError(f"SGLang /v1/videos 失败（{status}）：{detail[:800]}")
    ctype = (headers.get("content-type") or "").lower()
    if ctype.startswith("video") or ctype.startswith("application/octet-stream"):
        return raw
    try:
        payload = json.loads(raw.decode("utf-8"))
    except ValueError:
        return raw
    inline = _inline_bytes(payload)
    if inline is not None:
        return inline
    video_id = payload.get("id") or payload.get("video_id") or ""
    if not video_id:
        raise RuntimeError(f"无法解析 /v1/videos 响应：{json.dumps(payload, ensure_ascii=False)[:800]}")
    if log:
        log(f"[modal] 视频任务已入队（{video_id}），等待完成…")
    deadline = time.monotonic() + timeout
    info = None
    while True:
        info = _video_status(base, video_id)
        state = str((info or {}).get("status") or "").lower()
        if state in _COMPLETED:
            break
        if state in _FAILED:
            raise RuntimeError(f"SGLang 视频任务失败（{video_id}）：{json.dumps(info, ensure_ascii=False)[:800]}")
        if time.monotonic() > deadline:
            raise TimeoutError(f"等待 SGLang 视频任务超时（{video_id}）")
        if log:
            progress = (info or {}).get("progress")
            log(f"[modal] 视频任务 {video_id} 状态 {state or 'unknown'}{f'（{progress}）' if progress is not None else ''}…")
        time.sleep(poll_interval)
    status, _, raw = _request("GET", f"{base}/v1/videos/{video_id}/content", timeout=timeout)
    if status == 200 and raw:
        return raw
    if isinstance(info, dict):
        url = info.get("url") or info.get("video_url")
        if url:
            absolute = url if url.startswith("http") else f"{base}{url if url.startswith('/') else '/' + url}"
            status, _, raw = _request("GET", absolute, timeout=timeout)
            if status == 200 and raw:
                return raw
    detail = (raw or b"").decode("utf-8", "replace")[:400]
    raise RuntimeError(f"无法下载 SGLang 视频内容（{video_id}，HTTP {status}）：{detail}")
