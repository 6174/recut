"""
[INPUT]: modal_app.py 的 app / APP_NAME / ATTENTION_BACKEND / DEFAULT_STEPS；--gpu / --runs / --steps / --duration / --aspect
[OUTPUT]: modal run bench.py [--gpu <tier>]：对已部署的 H3Turbo 按目标形状跑 runs 次，打印每次时延、中位数与近似峰值显存
[POS]: minimax-h3-turbo 的 M1 实测入口（注意力后端 / GPU 档位 / 步数的时延对比）；
       切换后端＝改 modal_app.py 的 ATTENTION_BACKEND 后重新 modal.deploy（近似后端需在目标负载上抽检质量）
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import json

from modal_app import APP_NAME, ATTENTION_BACKEND, DEFAULT_STEPS, app


@app.local_entrypoint()
def main(gpu: str = "", runs: int = 3, steps: int = DEFAULT_STEPS, duration: float = 5.0, aspect: str = "16:9"):
    import modal

    # 与 modal_runner.py 的 cls 调用一致：Cls.from_name(...).with_options(gpu=...)().<method>
    target = modal.Cls.from_name(APP_NAME, "H3Turbo")
    if gpu:
        target = target.with_options(gpu=gpu)
    print(f"[bench] {APP_NAME}.H3Turbo.bench（backend={ATTENTION_BACKEND}，gpu={gpu or 'default'}，"
          f"runs={runs}，steps={steps}）…", flush=True)
    result = target().bench.remote(runs=runs, steps=steps, durationSec=duration, aspectRatio=aspect)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="H3Turbo 时延实测（需已 modal deploy）")
    parser.add_argument("--gpu", default="")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--steps", type=int, default=DEFAULT_STEPS)
    parser.add_argument("--duration", type=float, default=5.0)
    parser.add_argument("--aspect", default="16:9")
    args = parser.parse_args()
    main(args.gpu, args.runs, args.steps, args.duration, args.aspect)
