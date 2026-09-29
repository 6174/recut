"""
[INPUT]: modal_app.py 的 app/volumes 与 bootstrap_weights / bootstrap_from_modelscope；--source（automatic|huggingface|modelscope）
[OUTPUT]: 在 Modal 云端把 qwen-image-2.1 权重下载进 /models 卷并写完成标记；modal run bootstrap.py -- --source <s>
[POS]: qwen-image-2.1 预设包的权重准备入口（modal.install 调用）；与镜像部署（modal.deploy）分离
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse

from modal_app import MODELSCOPE_REPO, HUGGINGFACE_REPO, app, bootstrap_from_modelscope, bootstrap_weights


@app.local_entrypoint()
def main(source: str = "automatic", revision: str = "main"):
    if source == "modelscope":
        bootstrap_from_modelscope.remote(MODELSCOPE_REPO, revision)
        return
    if source == "huggingface":
        bootstrap_weights.remote(source=source, repo=HUGGINGFACE_REPO, revision=revision)
        return
    # automatic：先试 Hugging Face，失败回退 ModelScope。
    try:
        bootstrap_weights.remote(source=source, repo=HUGGINGFACE_REPO, revision=revision)
    except Exception as error:  # noqa: BLE001
        print(f"[modal] Hugging Face 下载失败（{error}），回退 ModelScope。", flush=True)
        bootstrap_from_modelscope.remote(MODELSCOPE_REPO, revision)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="automatic")
    parser.add_argument("--revision", default="main")
    args = parser.parse_args()
    main(args.source, args.revision)
