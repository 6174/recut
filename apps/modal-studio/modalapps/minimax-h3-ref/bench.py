"""
[INPUT]: modal_app.py 的 app / APP_NAME / ATTENTION_BACKEND / DEFAULT_STEPS；--gpu / --runs / --steps / --duration
[OUTPUT]: modal run bench.py [--gpu <tier>]：对已部署的 H3Ref 按目标形状跑 runs 次，打印每次时延与中位数
[POS]: minimax-h3-ref 的实测入口（参考生视频的时延/档位对比）；与 minimax-h3-turbo 的 bench 同形
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import json

from modal_app import APP_NAME, ATTENTION_BACKEND, DEFAULT_STEPS, app


@app.local_entrypoint()
def main(gpu: str = "", runs: int = 3, steps: int = DEFAULT_STEPS, duration: float = 5.0):
    import modal

    target = modal.Cls.from_name(APP_NAME, "H3Ref")
    if gpu:
        target = target.with_options(gpu=gpu)
    print(f"[bench] {APP_NAME}.H3Ref.bench（backend={ATTENTION_BACKEND}，gpu={gpu or 'default'}，runs={runs}）…",
          flush=True)
    print(json.dumps(target().bench.remote(runs=runs, steps=steps, durationSec=duration), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="H3Ref（参考生视频）时延实测（需已 modal deploy）")
    parser.add_argument("--gpu", default="")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--steps", type=int, default=DEFAULT_STEPS)
    parser.add_argument("--duration", type=float, default=5.0)
    args = parser.parse_args()
    main(args.gpu, args.runs, args.steps, args.duration)
