#!/usr/bin/env python3
"""
[INPUT]: 读取 RECUT_APP_FILES_DIR、RECUT_MODELS_DIR、Depth Anything V2 官方仓库、PyTorch、OpenCV 与 FFmpeg
[OUTPUT]: 输出单行 JSON 状态；在 App 私有 files/outputs 中生成 PNG 或 MP4 深度预览
[POS]: depth-anything 的本地执行入口；依赖和模型固定到 .recut/models/depth-anything-v2，不写入素材库
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "small": ("vits", "https://huggingface.co/depth-anything/Depth-Anything-V2-Small/resolve/main/depth_anything_v2_vits.pth?download=true"),
    "base": ("vitb", "https://huggingface.co/depth-anything/Depth-Anything-V2-Base/resolve/main/depth_anything_v2_vitb.pth?download=true"),
    "large": ("vitl", "https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth?download=true"),
}
CONFIGS = {
    "vits": {"encoder": "vits", "features": 64, "out_channels": [48, 96, 192, 384]},
    "vitb": {"encoder": "vitb", "features": 128, "out_channels": [96, 192, 384, 768]},
    "vitl": {"encoder": "vitl", "features": 256, "out_channels": [256, 512, 1024, 1024]},
}


def model_root() -> Path:
    return Path(os.environ.get("RECUT_MODELS_DIR", Path.home() / ".recut" / "models")) / "depth-anything-v2"


def files_root() -> Path:
    value = os.environ.get("RECUT_APP_FILES_DIR")
    if not value:
        raise RuntimeError("RECUT_APP_FILES_DIR is missing")
    return Path(value).resolve()


def state(root: Path) -> dict:
    checkpoint_dir = root / "checkpoints"
    installed = [name for name, (encoder, _) in MODELS.items() if (checkpoint_dir / f"depth_anything_v2_{encoder}.pth").is_file()]
    problems = []
    if not shutil.which("ffmpeg"):
        problems.append("FFmpeg is not available on PATH. Install it, then retry.")
    if not (root / "repository" / "depth_anything_v2" / "dpt.py").is_file():
        problems.append("Depth Anything V2 source has not been installed.")
    return {"ready": not problems, "modelsRoot": str(root), "installedModels": installed, "error": " ".join(problems)}


def emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=True))
    raise SystemExit(code)


def download(url: str, target: Path) -> None:
    temporary = target.with_suffix(target.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as destination:
        shutil.copyfileobj(response, destination)
    temporary.replace(target)


def install(selected: str) -> None:
    root = model_root()
    current = state(root)
    if not current["ready"]:
        emit(current, 1)
    encoder, url = MODELS[selected]
    checkpoint = root / "checkpoints" / f"depth_anything_v2_{encoder}.pth"
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    if not checkpoint.is_file():
        download(url, checkpoint)
    emit(state(root))


def safe_file(relative: str) -> Path:
    root = files_root()
    target = (root / relative).resolve()
    if target == root or root not in target.parents:
        raise RuntimeError("input or output path escapes the App file sandbox")
    return target


def infer(selected: str, style: str, kind: str, source_relative: str, output_relative: str) -> None:
    root = model_root()
    current = state(root)
    encoder, _ = MODELS[selected]
    checkpoint = root / "checkpoints" / f"depth_anything_v2_{encoder}.pth"
    if not current["ready"] or not checkpoint.is_file():
        emit({"ready": False, "error": current["error"] or f"Model {selected} has not been downloaded."}, 1)
    import cv2
    import torch

    sys.path.insert(0, str(root / "repository"))
    from depth_anything_v2.dpt import DepthAnythingV2

    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    depth_model = DepthAnythingV2(**CONFIGS[encoder])
    depth_model.load_state_dict(torch.load(checkpoint, map_location="cpu"))
    depth_model = depth_model.to(device).eval()
    source = safe_file(source_relative)
    output = safe_file(output_relative)
    output.parent.mkdir(parents=True, exist_ok=True)

    def render(frame):
        depth = depth_model.infer_image(frame)
        normalized = ((depth - depth.min()) / (depth.max() - depth.min() + 1e-6) * 255).astype("uint8")
        return cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR) if style == "grayscale" else cv2.applyColorMap(normalized, cv2.COLORMAP_INFERNO)

    if kind == "image":
        image = cv2.imread(str(source))
        if image is None:
            emit({"ready": False, "error": "The selected image could not be read."}, 1)
        if not cv2.imwrite(str(output), render(image)):
            emit({"ready": False, "error": "Could not write the depth image."}, 1)
    else:
        video = cv2.VideoCapture(str(source))
        if not video.isOpened():
            emit({"ready": False, "error": "The selected video could not be read."}, 1)
        width, height = int(video.get(cv2.CAP_PROP_FRAME_WIDTH)), int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = video.get(cv2.CAP_PROP_FPS) or 30
        writer = cv2.VideoWriter(str(output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
        if not writer.isOpened():
            emit({"ready": False, "error": "Could not initialize MP4 output. Check FFmpeg support."}, 1)
        while True:
            ok, frame = video.read()
            if not ok:
                break
            writer.write(render(frame))
        video.release()
        writer.release()
    emit({"ready": True, "output": output_relative})


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--model", choices=MODELS, required=True)
    infer_parser = commands.add_parser("infer")
    infer_parser.add_argument("--model", choices=MODELS, required=True)
    infer_parser.add_argument("--style", choices=["color", "grayscale"], required=True)
    infer_parser.add_argument("--kind", choices=["image", "video"], required=True)
    infer_parser.add_argument("--input", required=True)
    infer_parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        if args.command == "status":
            emit(state(model_root()))
        if args.command == "install":
            install(args.model)
        infer(args.model, args.style, args.kind, args.input, args.output)
    except Exception as error:
        emit({"ready": False, "error": str(error)}, 1)


if __name__ == "__main__":
    main()
