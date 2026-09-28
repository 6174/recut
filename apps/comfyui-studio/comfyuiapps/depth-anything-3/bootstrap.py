"""
[INPUT]: comfyui_sdk.BootstrapContext（runtime venv / ComfyUI 源码目录 / 权重目录）
[OUTPUT]: prepare(ctx) —— 本工作流的依赖准备（depth-anything-3 使用 ComfyUI 核心节点，无额外 pip / custom_nodes）
[POS]: depth-anything-3 的 app 级 bootstrap；权重下载是 comfy.install 的职责，不在此处
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

from comfyui_sdk import BootstrapContext


def prepare(ctx: BootstrapContext) -> None:
    # Depth Anything 3 由 ComfyUI 核心（comfy_extras/nodes_depth_anything_3.py）提供，无额外依赖。
    ctx.task_log("depth-anything-3 无额外依赖。")


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="")
    args = parser.parse_args()
    app_id = args.app or Path(__file__).resolve().parent.name
    prepare(BootstrapContext(app_id))
