"""
[INPUT]: h3_contract；modal_runner.py 传入的 function_id/params/refs/mock_url
[OUTPUT]: invoke(function_id, params, refs, mock_url)：用 h3_contract 组 H3 请求并对本地 mock 的
          SGLang 走「POST→轮询→下载 content」，返回 {kind:"bytes", ...} 交给 runner 落盘
[POS]: minimax-h3 的本地 mock 入口；modal_runner.py invoke --mock 动态加载调用，不碰 Modal/GPU
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import os
import tempfile

from h3_contract import build_video_body, submit_video, write_reference_conditions

REF_DIR = os.environ.get("RECUT_H3_REF_DIR") or os.path.join(tempfile.gettempdir(), "recut-h3-refs")


def invoke(function_id: str, params: dict, refs: list, mock_url: str) -> dict:
    params = params or {}
    conditions = write_reference_conditions(refs or [], REF_DIR)
    aspect_ratio = params.get("aspectRatio") or ("auto" if conditions else "16:9")
    duration_sec = params.get("durationSec", 5)
    steps = params.get("steps", 50)
    body = build_video_body(params.get("prompt", ""), aspect_ratio=aspect_ratio,
                            duration_sec=duration_sec, steps=steps,
                            seed=params.get("seed", -1), conditions=conditions)
    data = submit_video(mock_url, body, log=print)
    return {"kind": "bytes", "data": data, "mimeType": "video/mp4",
            "meta": {"durationSec": float(duration_sec), "fps": 24, "seed": body["seed"],
                     "steps": int(steps), "audio": True}}
