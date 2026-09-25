"""
[INPUT]: modal_app.py 的 app/image/volume 与 weights 仓库配置；--source（automatic|huggingface|modelscope）
[OUTPUT]: 在 Modal 云端把 sd-turbo 权重下载进 /models 卷并写完成标记；modal run bootstrap.py -- --source <s>
[POS]: sd-turbo 预设包的权重准备入口（modal.install 调用）；与镜像部署（modal.deploy）分离
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
from pathlib import Path

from modal_app import MODELS_DIR, MODELS_VOLUME, app, bootstrap_weights, image, models

MODELSCOPE_REPO = "AI-ModelScope/sd-turbo"
HUGGINGFACE_REPO = "stabilityai/sd-turbo"


@app.function(image=image, volumes={MODELS_DIR: models}, timeout=3600)
def bootstrap_from_modelscope(repo: str, revision: str = "main"):
    from modelscope import snapshot_download

    target = Path(MODELS_DIR)
    # 幂等短路：已完成过（标记存在）就跳过，不重复下载/校验。
    if (target / ".recut-download-complete").is_file():
        print("[modal] sd-turbo 权重已存在（完成标记在），跳过下载。", flush=True)
        return {"ready": True, "path": str(target), "skipped": True}
    target.mkdir(parents=True, exist_ok=True)
    print(f"[modal] 从 ModelScope 下载 {repo}…", flush=True)
    snapshot_download(repo, revision=revision or None, local_dir=str(target))
    (target / ".recut-download-complete").write_text("ok", encoding="utf-8")
    models.commit()
    print("[modal] sd-turbo 权重已就绪（ModelScope）。", flush=True)
    return {"ready": True, "path": str(target)}


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
