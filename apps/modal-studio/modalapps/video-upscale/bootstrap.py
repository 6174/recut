"""
[INPUT]: modal_app.py 的 app / bootstrap_weights；--source（automatic|huggingface|modelscope）/ --revision
[OUTPUT]: `modal run bootstrap.py --source <s>` —— 在 Modal 云端把 SeedVR2-7B 与 FlashVSR v1.1 权重写进 /models 卷，
          各自写完成标记（.recut-seedvr2-complete / .recut-flashvsr-complete）；幂等，可安全重跑
[POS]: video-upscale 预设包的权重准备入口（modal.install 与 deploy 收尾都会调用）；与镜像部署（modal.deploy）分离
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse

from modal_app import app, bootstrap_weights


@app.local_entrypoint()
def main(source: str = "automatic", revision: str = "main"):
    print(f"[modal] video-upscale：下载 SeedVR2-7B + FlashVSR v1.1（source={source}）…", flush=True)
    bootstrap_weights.remote(source=source, revision=revision)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="automatic")
    parser.add_argument("--revision", default="main")
    args = parser.parse_args()
    main(args.source, args.revision)
