"""
[INPUT]: h3_contract / face_refine；modal_runner.py 传入的 function_id/params/refs/mock_url
[OUTPUT]: invoke(function_id, params, refs, mock_url)：对本地 mock 的 SGLang 走「POST→轮询→下载 content」，
          再走同一套人脸保持链（参考组增强 / 人脸修复；本地无模型时优雅降级为原样返回）；
          face-refine 则直接对传入的视频参考跑修复链
[POS]: minimax-h3-ref 的本地 mock 入口（零 GPU/无模型即可跑通整条链路）；modal_runner.py invoke --mock 动态加载
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import os
import tempfile

from face_refine import RefineParams, refine_video_bytes
from h3_contract import build_video_body, submit_video, write_reference_conditions

REF_DIR = os.environ.get("RECUT_H3_REF_DIR") or os.path.join(tempfile.gettempdir(), "recut-h3-ref-refs")


def _face_params(params: dict) -> RefineParams:
    model = params.get("faceRefine") or "codeformer"
    if model == "auto":
        model = "codeformer"
    return RefineParams.from_mapping({"faceRefine": model, "faceFidelity": params.get("faceFidelity"),
                                      "faceCropFactor": params.get("faceCropFactor"),
                                      "faceCanvasSize": params.get("faceCanvasSize"),
                                      "facePersonFallback": params.get("facePersonFallback")})


def invoke(function_id: str, params: dict, refs: list, mock_url: str) -> dict:
    params = params or {}
    face_params = _face_params(params)
    if function_id == "face-refine":
        source = next((ref for ref in (refs or []) if str(ref.get("mimeType") or "").startswith("video/")), None)
        if source is None:
            raise ValueError("face-refine 需要一个视频参考素材")
        data, report = refine_video_bytes(bytes(source.get("data") or b""), face_params,
                                          model_dir="", log=print)
        return {"kind": "bytes", "data": data, "mimeType": "video/mp4", "meta": {"audio": True, "faceRefine": report}}

    conditions = write_reference_conditions(refs or [], REF_DIR)
    body = build_video_body(params.get("prompt", ""), aspect_ratio=params.get("aspectRatio") or "auto",
                            duration_sec=params.get("durationSec", 5), steps=params.get("steps", 9),
                            seed=params.get("seed", -1), conditions=conditions,
                            resolution=params.get("resolution", ""))
    data = submit_video(mock_url, body, log=print)
    refined, report = refine_video_bytes(data, face_params, model_dir="", log=print)
    return {"kind": "bytes", "data": refined, "mimeType": "video/mp4",
            "meta": {"durationSec": float(params.get("durationSec", 5)), "fps": 24, "seed": body["seed"],
                     "steps": int(params.get("steps", 9)), "audio": True, "task": body["task"],
                     "referenceSheet": {"applied": False, "reason": "mock"}, "faceRefine": report}}
