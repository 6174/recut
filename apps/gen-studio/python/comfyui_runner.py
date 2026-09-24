"""
[INPUT]: 平台注入的 RECUT_MODELS_DIR / RECUT_VENV / RECUT_PYTHON；python/registry.json 的模型权重清单；
         generate 子命令的 prompt/画幅/seed/steps/cfg/参考图
[OUTPUT]: status（torch 与 ComfyUI 源码自检）、generate（启动/复用本机 ComfyUI 服务 → 提交 API 格式工作流
          （文生图 / 参考图编辑）→ 轮询历史 → 取回 PNG 与 <output>.meta.json）
[POS]: gen-studio comfyui runtime 专属 venv 内的通用推理 worker；源码按固定 commit 克隆到
        <RECUT_MODELS_DIR>/gen-studio/comfyui/repository，权重放在其 models/ 下
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# 画幅 → 宽高（32 的倍数；Qwen-Image-2.1 原生支持 2K，这里默认约 1MP 兼顾速度）。
ASPECT_RATIOS = {
    "1:1": (1024, 1024),
    "16:9": (1280, 704),
    "9:16": (704, 1280),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
}

DEFAULT_PORT = 8188
CLIENT_ID = "recut-gen-studio"


def app_root() -> Path:
    return Path(__file__).resolve().parent.parent


def registry() -> dict:
    return json.loads((app_root() / "python" / "registry.json").read_text(encoding="utf-8"))


def models_root() -> Path:
    return Path(os.environ.get("RECUT_MODELS_DIR", Path.home() / ".recut" / "models")) / "gen-studio"


def files_root() -> Path:
    return Path(os.environ.get("RECUT_APP_FILES_DIR", "."))


def repository() -> Path:
    return models_root() / "comfyui" / "repository"


def pid_path() -> Path:
    return models_root() / "comfyui" / "server.pid"


def model_files(model: dict) -> dict:
    """从 registry 权重清单里取 unet / clip / vae 的文件名（ComfyUI 只认文件名）。"""
    names = {"unet": "", "clip": "", "vae": ""}
    for entry in ((model.get("weights") or {}).get("files") or []):
        base = Path(entry).name
        if entry.startswith("diffusion_models/"):
            names["unet"] = base
        elif entry.startswith("text_encoders/"):
            names["clip"] = base
        elif entry.startswith("vae/"):
            names["vae"] = base
    return names


def resolve_output(raw: str) -> Path:
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = files_root() / candidate
    candidate.parent.mkdir(parents=True, exist_ok=True)
    return candidate


def cmd_status(_: argparse.Namespace) -> dict:
    repo = repository()
    if not (repo / "main.py").is_file():
        return {"ready": False, "error": f"ComfyUI 源码未就绪：{repo}（请先准备环境）"}
    try:
        import torch  # type: ignore  # noqa: F401
    except Exception as error:  # noqa: BLE001
        return {"ready": False, "error": f"依赖缺失：{error}"}
    return {"ready": True, "error": None}


# ---------------------- ComfyUI 服务 ----------------------


def server_url(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def server_alive(port: int) -> bool:
    import requests  # type: ignore

    try:
        response = requests.get(server_url(port) + "/system_stats", timeout=2)
        return response.status_code == 200
    except Exception:  # noqa: BLE001
        return False


ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def tail_server_log(log_path: Path, offset: int) -> int:
    """把 server.log 自 offset 起新增的完整行转成 worker stdout，返回新 offset。"""
    try:
        size = log_path.stat().st_size
    except OSError:
        return offset
    if size <= offset:
        return offset
    with open(log_path, "rb") as handle:
        handle.seek(offset)
        chunk = handle.read()
    cut = chunk.rfind(b"\n")
    if cut == -1:
        return offset
    for raw in chunk[:cut].decode("utf-8", "replace").replace("\r", "\n").split("\n"):
        line = ANSI_RE.sub("", raw).strip()
        if line:
            print(f"[comfyui] {line}", flush=True)
    return offset + cut + 1


def ensure_server(port: int) -> None:
    """复用已在监听的本机 ComfyUI；否则启动一个常驻服务（不随本进程退出）。"""
    import requests  # type: ignore

    if server_alive(port):
        print(f"[gen] 复用已运行的 ComfyUI 服务（:{port}）。", flush=True)
        return
    repo = repository()
    print(f"[gen] 正在启动 ComfyUI 服务（:{port}，首次启动较慢）…", flush=True)
    log_path = models_root() / "comfyui" / "server.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    offset = log_path.stat().st_size if log_path.is_file() else 0
    log = open(log_path, "ab")
    process = subprocess.Popen(
        [sys.executable, "main.py", "--listen", "127.0.0.1", "--port", str(port), "--disable-auto-launch"],
        cwd=str(repo),
        stdout=log,
        stderr=subprocess.STDOUT,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
        start_new_session=True,
    )
    try:
        pid_path().write_text(str(process.pid), encoding="utf-8")
    except OSError:
        pass
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        offset = tail_server_log(log_path, offset)
        if process.poll() is not None:
            tail_server_log(log_path, offset)
            raise SystemExit(f"ComfyUI 服务启动失败（退出码 {process.returncode}），日志见 {log_path}")
        if server_alive(port):
            offset = tail_server_log(log_path, offset)
            print("[gen] ComfyUI 服务已就绪。", flush=True)
            return
        time.sleep(3)
    tail_server_log(log_path, offset)
    raise SystemExit(f"ComfyUI 服务启动超时，日志见 {log_path}")


# ---------------------- 工作流 ----------------------


def t2i_workflow(names: dict, prompt: str, negative: str, width: int, height: int, steps: int, cfg: float, seed: int) -> dict:
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": names["unet"], "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": names["clip"], "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": names["vae"]}},
        "4": {"class_type": "TextEncodeQwenImage21", "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt, "negative_prompt": negative, "resolution": 1024}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "6": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1], "latent_image": ["5", 0], "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0], "filename_prefix": "qwen_image_2.1"}},
    }


def edit_workflow(names: dict, prompt: str, negative: str, steps: int, cfg: float, seed: int, input_names: list) -> dict:
    workflow = t2i_workflow(names, prompt, negative, 1024, 1024, steps, cfg, seed)
    # 编辑：用 TextEncodeQwenImage21 的 latent 输出（按首张参考图尺寸），并把参考图接进 images.image_N。
    for index, name in enumerate(input_names, start=1):
        node_id = str(100 + index)
        workflow[node_id] = {"class_type": "LoadImage", "inputs": {"image": name, "upload": "image"}}
        workflow["4"]["inputs"][f"images.image_{index}"] = [node_id, 0]
    workflow["6"]["inputs"]["latent_image"] = ["4", 2]
    return workflow


def copy_references(paths: list) -> list:
    input_dir = repository() / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    names = []
    for index, raw in enumerate(paths, start=1):
        # background 传入的是以 App 文件区（RECUT_APP_FILES_DIR）为根的相对路径，
        # 与 resolve_output 同一约定；必须按 files_root() 解析，否则会落到 worker 的 CWD。
        source = Path(raw)
        if not source.is_absolute():
            source = files_root() / source
        if not source.is_file():
            print(f"[gen] 参考图不存在，已跳过：{raw}", flush=True)
            continue
        suffix = source.suffix or ".png"
        name = f"recut_ref_{index}{suffix}"
        shutil.copyfile(source, input_dir / name)
        names.append(name)
    return names


def queue_and_wait(port: int, workflow: dict, output_path: Path) -> None:
    import requests  # type: ignore

    response = requests.post(server_url(port) + "/prompt", json={"prompt": workflow, "client_id": CLIENT_ID}, timeout=30)
    payload = response.json()
    if response.status_code != 200 or "prompt_id" not in payload:
        raise SystemExit(f"ComfyUI 拒绝工作流：{json.dumps(payload, ensure_ascii=False)[:600]}")
    prompt_id = payload["prompt_id"]
    print(f"[gen] 工作流已提交（{prompt_id}），等待出图…", flush=True)
    started = time.monotonic()
    last_report = 0.0
    while True:
        history = requests.get(server_url(port) + f"/history/{prompt_id}", timeout=30).json()
        entry = history.get(prompt_id)
        if entry:
            status = (entry.get("status") or {}).get("status_str", "")
            if status == "error":
                raise SystemExit(f"ComfyUI 执行失败：{json.dumps(entry.get('status'), ensure_ascii=False)[:600]}")
            images = []
            for node_output in (entry.get("outputs") or {}).values():
                images.extend(node_output.get("images") or [])
            if images:
                image = images[0]
                query = f"?filename={image['filename']}&subfolder={image.get('subfolder','')}&type={image.get('type','output')}"
                data = requests.get(server_url(port) + "/view" + query, timeout=120).content
                output_path.write_bytes(data)
                print(f"[gen] 已生成 {output_path.name}（{int(time.monotonic() - started)}s）。", flush=True)
                return
        now = time.monotonic()
        if now - last_report >= 15:
            print(f"[gen] 出图中（已等待 {int(now - started)}s）…", flush=True)
            last_report = now
        time.sleep(2)


def cmd_serve(args: argparse.Namespace) -> dict:
    port = int(args.port or os.environ.get("RECUT_COMFYUI_PORT", DEFAULT_PORT))
    ensure_server(port)
    pid = ""
    try:
        pid = pid_path().read_text(encoding="utf-8").strip()
    except OSError:
        pid = ""
    return {"ready": True, "running": True, "port": port, "pid": pid}


def cmd_generate(args: argparse.Namespace) -> dict:
    reg = registry()
    model = next((m for m in reg.get("models", []) if m["id"] == args.model), None)
    if model is None:
        raise SystemExit(f"unknown model: {args.model}")
    names = model_files(model)
    if not all(names.values()):
        raise SystemExit("模型权重清单不完整，请先下载模型。")
    missing = [name for name in names.values() if not _weight_present(name)]
    if missing:
        raise SystemExit(f"模型权重缺失：{missing}，请先下载模型。")

    width, height = ASPECT_RATIOS.get(args.aspect_ratio or "1:1", (1024, 1024))
    seed = int(args.seed) if str(args.seed).strip() not in ("", "-1") else int(time.time()) % (2**31)
    steps = int(args.steps) if str(args.steps).strip() else 10
    cfg = float(args.cfg) if str(args.cfg).strip() else 1.0
    negative = args.negative_prompt or " "

    port = int(os.environ.get("RECUT_COMFYUI_PORT", DEFAULT_PORT))
    ensure_server(port)

    references = copy_references(args.reference or [])
    if references:
        print(f"[gen] 编辑模式：{len(references)} 张参考图。", flush=True)
        workflow = edit_workflow(names, args.prompt, negative, steps, cfg, seed, references)
    else:
        workflow = t2i_workflow(names, args.prompt, negative, width, height, steps, cfg, seed)

    output_path = resolve_output(args.output + ".png")
    started = time.time()
    queue_and_wait(port, workflow, output_path)
    elapsed = round(time.time() - started, 2)

    meta = {
        "model": model["id"], "prompt": args.prompt, "negativePrompt": negative,
        "width": width, "height": height, "seed": seed, "steps": steps, "cfg": cfg,
        "references": len(references), "duration": elapsed,
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    Path(str(output_path) + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"ready": True, "output": str(output_path), **meta}


def _weight_present(name: str) -> bool:
    for sub in ("diffusion_models", "text_encoders", "vae"):
        if (repository() / "models" / sub / name).is_file():
            return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")

    serve_parser = sub.add_parser("serve")
    serve_parser.add_argument("--port", default="")

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
    if args.command == "status":
        payload = cmd_status(args)
    elif args.command == "serve":
        payload = cmd_serve(args)
    else:
        payload = cmd_generate(args)
    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
