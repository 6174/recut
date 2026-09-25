"""
[INPUT]: modal_app.py 的 app/image/volume 与 bootstrap_weights（已挂载 recut-hf-token Secret）；--source / --patterns
[OUTPUT]: 在 Modal 云端用 HF token 把 MiniMax-H3 FL2VA 权重下载进 /models 卷并写完成标记；
          modal run bootstrap.py --source <s> [--patterns model_index.json]
[POS]: minimax-h3 预设包的权重准备入口（modal.install 调用）；H3 为 HF gated 仓库，必须先 modal.secret.set 配置 token
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse

from modal_app import app, bootstrap_weights


@app.local_entrypoint()
def main(source: str = "automatic", revision: str = "main", patterns: str = ""):
    if source == "modelscope":
        print("[modal] MiniMax-H3 为 Hugging Face gated 仓库，ModelScope 不受支持；改用 huggingface。", flush=True)
        source = "huggingface"
    bootstrap_weights.remote(source=source, revision=revision, patterns=patterns)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="automatic")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--patterns", default="")
    args = parser.parse_args()
    main(args.source, args.revision, args.patterns)
