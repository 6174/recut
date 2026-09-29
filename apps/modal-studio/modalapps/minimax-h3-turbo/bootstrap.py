"""
[INPUT]: modal_app.py 的 app/image/volumes 与 bootstrap_weights / bootstrap_adapters / bootstrap_merge；--source / --revision / --patterns
[OUTPUT]: 在 Modal 云端准备三样：/models（复用/补下 MiniMax-H3 FL2VA + Ref2VA 权重，与 minimax-h3 共用同一卷）、
          /adapters（下载 Turbo 少步 LoRA）、/merged（把 LoRA 离线合并进 transformer）；
          modal run bootstrap.py --source <s> [--patterns model_index.json]
[POS]: minimax-h3-turbo 预设包的准备入口（modal.install / deploy 收尾调用）；H3 为 HF gated，需先 modal.secret.set 配置 token；
       权重部分若共享卷已有完成标记则直接短路（零重复下载）；合并为 CPU 流式、幂等（有标记即跳过）
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse

from modal_app import app, bootstrap_adapters, bootstrap_merge, bootstrap_weights


@app.local_entrypoint()
def main(source: str = "automatic", revision: str = "main", patterns: str = ""):
    if source == "modelscope":
        print("[modal] MiniMax-H3 为 Hugging Face gated 仓库，ModelScope 不受支持；改用 huggingface。", flush=True)
        source = "huggingface"
    bootstrap_weights.remote(source=source, revision=revision, patterns=patterns)
    bootstrap_adapters.remote(revision=revision)
    bootstrap_merge.remote(revision=revision)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="automatic")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--patterns", default="")
    args = parser.parse_args()
    main(args.source, args.revision, args.patterns)
