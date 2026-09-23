"""
[INPUT]: 平台注入的 RECUT_APP_FILES_DIR / RECUT_MODELS_DIR / RECUT_VENV；python/registry.json 中的模型权重与
         pipeline 名；generate 子命令的 prompt/画幅/seed/steps/cfg/参考图
[OUTPUT]: status（torch/diffusers 依赖自检）、generate（加载对应 diffusers pipeline → 推理 → 落 PNG 与
          <output>.meta.json，记录尺寸/seed/耗时）
[POS]: gen-studio 默认 runtime（diffusers）专属 venv 内的通用推理 worker；一个 worker 服务该 runtime 下所有模型，
       模型差异由注册表条目（pipeline 名 + 权重路径 + 表单）驱动
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import time
from pathlib import Path

ASPECT_RATIOS = {
    "1:1": (1328, 1328),
    "16:9": (1664, 928),
    "9:16": (928, 1664),
    "4:3": (1472, 1104),
    "3:4": (1104, 1472),
    "3:2": (1584, 1056),
    "2:3": (1056, 1584),
}


def app_root() -> Path:
    return Path(__file__).resolve().parent.parent


def registry() -> dict:
    return json.loads((app_root() / "python" / "registry.json").read_text(encoding="utf-8"))


def models_root() -> Path:
    return Path(os.environ.get("RECUT_MODELS_DIR", Path.home() / ".recut" / "models")) / "gen-studio"


def files_root() -> Path:
    return Path(os.environ.get("RECUT_APP_FILES_DIR", "."))


def cmd_status(_: argparse.Namespace) -> dict:
    try:
        import torch  # type: ignore  # noqa: F401
        import diffusers  # type: ignore  # noqa: F401
        import transformers  # type: ignore  # noqa: F401
    except Exception as error:  # noqa: BLE001
        return {"ready": False, "error": f"依赖缺失：{error}"}
    return {"ready": True, "error": None, "torch": torch.__version__, "diffusers": diffusers.__version__}


def resolve_output(raw: str) -> Path:
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = files_root() / candidate
    candidate.parent.mkdir(parents=True, exist_ok=True)
    return candidate


def cmd_generate(args: argparse.Namespace) -> dict:
    import torch  # type: ignore
    from diffusers import DiffusionPipeline  # type: ignore

    reg = registry()
    model = next((m for m in reg.get("models", []) if m["id"] == args.model), None)
    if model is None:
        raise SystemExit(f"unknown model: {args.model}")
    weights = model.get("weights") or {}
    target = models_root() / model["runtime"] / model["id"]
    if not target.is_dir():
        raise SystemExit(f"model weights not found: {target}")

    width, height = ASPECT_RATIOS.get(args.aspect_ratio or "1:1", (1328, 1328))
    seed = int(args.seed) if str(args.seed).strip() not in ("", "-1") else int(time.time()) % (2**31)
    steps = int(args.steps) if str(args.steps).strip() else 50
    cfg = float(args.cfg) if str(args.cfg).strip() else 4.0
    negative_prompt = args.negative_prompt or " "

    if torch.cuda.is_available():
        device = "cuda"
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"
    dtype = torch.float32 if device == "cpu" else torch.bfloat16
    print(f"[gen] 加载 {model['id']}（{device}）…", flush=True)
    try:
        import sdnq  # noqa: F401  # 注册 SDNQ 量化后端（预量化权重需要）
    except Exception:  # noqa: BLE001
        pass
    pipeline = DiffusionPipeline.from_pretrained(str(target), torch_dtype=dtype)
    if device != "cuda":
        # MPS/CPU 上没有 CUDA 专属显存，用注意力切片压低峰值内存。
        try:
            pipeline.enable_attention_slicing()
        except Exception:  # noqa: BLE001
            pass
    pipeline = pipeline.to(device)
    # MPS 的 torch.Generator 不支持 manual_seed，统一用 CPU 生成器保证可复现。
    generator = torch.Generator(device="cpu" if device == "mps" else device).manual_seed(seed)

    kwargs = {
        "prompt": args.prompt,
        "negative_prompt": negative_prompt,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "true_cfg_scale": cfg,
        "generator": generator,
    }
    references = [Path(ref) for ref in args.reference if Path(ref).is_file()]
    if references:
        # 首版：参考图作为 image 输入（编辑类 pipeline 生效；纯文生图 pipeline 会忽略）。
        kwargs["image"] = references[0] if len(references) == 1 else references

    started = time.time()
    print("[gen] 正在推理…", flush=True)
    output = pipeline(**kwargs)
    image = output.images[0]
    elapsed = round(time.time() - started, 2)

    output_path = resolve_output(args.output + ".png")
    image.save(output_path)
    meta = {
        "model": model["id"], "prompt": args.prompt, "negativePrompt": negative_prompt,
        "width": width, "height": height, "seed": seed, "steps": steps, "cfg": cfg,
        "duration": elapsed, "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    Path(str(output_path) + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print(f"[gen] 已生成 {output_path.name}（{elapsed}s）。", flush=True)
    return {"ready": True, "output": str(output_path), **meta}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status")

    generate_parser = sub.add_parser("generate")
    generate_parser.add_argument("--model", required=True)
    generate_parser.add_argument("--prompt", required=True)
    generate_parser.add_argument("--output", required=True)
    generate_parser.add_argument("--negative-prompt", default="")
    generate_parser.add_argument("--aspect-ratio", default="")
    generate_parser.add_argument("--seed", default="")
    generate_parser.add_argument("--steps", default="")
    generate_parser.add_argument("--cfg", default="")
    generate_parser.add_argument("--reference", action="append", default=[])

    args = parser.parse_args()
    payload = cmd_status(args) if args.command == "status" else cmd_generate(args)
    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
