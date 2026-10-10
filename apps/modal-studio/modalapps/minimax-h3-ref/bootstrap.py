"""
[INPUT]: modal_app.py 的 app / bootstrap_weights / bootstrap_facemodels；--source / --revision（runner 会传 --source）
[OUTPUT]: `modal run bootstrap.py` —— 本包**不下载 H3 权重**（复用共享卷）：先校验共享权重与 Turbo ref2v 合并产物，
          再下载本包专有的人脸检测/修复小模型到 /face 卷
[POS]: minimax-h3-ref 的准备入口（modal.install / deploy 收尾调用）；前置缺失时给出「去跑哪个预设包」的可执行指引
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse

from modal_app import app, bootstrap_facemodels, bootstrap_weights


@app.local_entrypoint()
def main(source: str = "automatic", revision: str = "main", patterns: str = ""):
    # 本包复用共享权重卷，不需要 --source（保留参数只为与 runner 的调用形状一致）。
    print(f"[modal] minimax-h3-ref：复用共享权重（source={source} 仅占位）；校验前置 + 下载人脸小模型…", flush=True)
    bootstrap_weights.remote()
    bootstrap_facemodels.remote()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="automatic")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--patterns", default="")
    args = parser.parse_args()
    main(args.source, args.revision, args.patterns)
