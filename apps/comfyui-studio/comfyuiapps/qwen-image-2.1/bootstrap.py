"""
[INPUT]: comfyui_sdk.BootstrapContext（runtime venv / ComfyUI 源码目录 / 权重目录）
[OUTPUT]: prepare(ctx) —— 本工作流的依赖准备（qwen-image-2.1 无额外 pip / custom_nodes，仅校验权重角色）
[POS]: qwen-image-2.1 的 app 级 bootstrap；权重下载是 comfy.install 的职责，不在此处
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

from comfyui_sdk import BootstrapContext


def prepare(ctx: BootstrapContext) -> None:
    # 本工作流仅使用 ComfyUI 内置节点，无额外依赖；如需可：
    #   ctx.pip_install(["sageattention==2.*"])
    #   ctx.clone_custom_node("https://github.com/kijai/ComfyUI-KJNodes", "<pinned-sha>")
    ctx.task_log("qwen-image-2.1 无额外依赖。")


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="")
    args = parser.parse_args()
    app_id = args.app or Path(__file__).resolve().parent.name
    prepare(BootstrapContext(app_id))
