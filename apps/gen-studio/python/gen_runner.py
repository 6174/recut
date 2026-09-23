"""
[INPUT]: 平台注入的 RECUT_APP_FILES_DIR / RECUT_MODELS_DIR / RECUT_VENV / RECUT_PYTHON；python/registry.json
         引擎/模型注册表；--task-log 任务日志文件
[OUTPUT]: status（runtime venv 与模型权重就绪度）、catalog（同 status 的模型面）、install（从 huggingface/
          modelscope/automatic 下载权重，不动 venv；逐文件断点续传 + 大小校验 + 完成标记，可安全重试）、
          generate（把请求派发到模型所属 runtime 的专属 venv worker）
[POS]: gen-studio 的主 venv 调度器；主 venv 保持轻量（下载/调度），真正推理在 runtime 专属 venv
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import builtins
import datetime
import fnmatch
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

_ORIG_PRINT = builtins.print
_TASK_LOG = None


def _write_task_log(text: str) -> None:
    if _TASK_LOG is None:
        return
    line = text.strip()
    if not line:
        return
    msg = line[len("[gen] "):] if line.startswith("[gen] ") else line
    level = "info"
    if any(word in msg for word in ("失败", "错误", "不可用", "异常")):
        level = "error"
    elif any(word in msg for word in ("完成", "就绪", "已下载", "成功")):
        level = "ok"
    elif any(word in msg for word in ("较慢", "回退", "等待", "重试", "进行", "download")):
        level = "warn"
    _TASK_LOG.write(json.dumps({"ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "level": level, "message": msg}, ensure_ascii=False) + "\n")
    _TASK_LOG.flush()


def _teed_print(*args, **kwargs):
    _ORIG_PRINT(*args, **kwargs)
    if args:
        _write_task_log(str(args[0]))


def resolve_task_log(raw: str) -> None:
    global _TASK_LOG
    if not raw:
        return
    candidate = Path(raw)
    if not candidate.is_absolute() and os.environ.get("RECUT_APP_FILES_DIR"):
        candidate = Path(os.environ["RECUT_APP_FILES_DIR"]) / candidate
    candidate.parent.mkdir(parents=True, exist_ok=True)
    _TASK_LOG = open(candidate, "a", encoding="utf-8")
    builtins.print = _teed_print


def app_root() -> Path:
    return Path(__file__).resolve().parent.parent


def registry() -> dict:
    return json.loads((app_root() / "python" / "registry.json").read_text(encoding="utf-8"))


def models_root() -> Path:
    return Path(os.environ.get("RECUT_MODELS_DIR", Path.home() / ".recut" / "models")) / "gen-studio"


def runtime_venv(runtime_id: str) -> Path:
    root = Path(os.environ.get("RECUT_VENV", ""))
    if not root.name:
        return Path("/nonexistent/recut-gen-venv")
    return root.with_name(f"{root.name}-{runtime_id}")


def runtime_python(runtime_id: str) -> Path:
    venv = runtime_venv(runtime_id)
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def model_dir(runtime_id: str, model_id: str) -> Path:
    """每个 runtime/model 的状态目录（下载完成标记、元数据）。"""
    return models_root() / runtime_id / model_id


def runtime_repository(runtime: dict) -> Path:
    return models_root() / runtime["id"] / "repository"


def model_files_dir(runtime: dict, model_id: str) -> Path:
    """权重落盘目录。ComfyUI 要求文件放在其仓库的 models/ 下（按子目录分类）。"""
    if runtime.get("id") == "comfyui":
        return runtime_repository(runtime) / "models"
    return model_dir(runtime["id"], model_id)


# 下载完成标记：权重目录内所有文件写完后才落盘。判据只看标记，避免半途崩溃时
# 早到的 model_index.json 被误判为「已下载」。
DOWNLOAD_MARKER = ".recut-download-complete"


def model_downloaded(runtime_id: str, model_id: str) -> bool:
    return (model_dir(runtime_id, model_id) / DOWNLOAD_MARKER).is_file()


def runtime_def(reg: dict, runtime_id: str) -> dict:
    return next((r for r in reg.get("runtimes", []) if r["id"] == runtime_id), {"id": runtime_id})


def requirements_fingerprint(runtime: dict) -> str:
    requirements = app_root() / runtime.get("requirements", "")
    if not requirements.is_file():
        return ""
    return hashlib.sha256(requirements.read_bytes()).hexdigest()


def runtime_status(runtime: dict) -> dict:
    runtime_id = runtime["id"]
    python = runtime_python(runtime_id)
    if not python.is_file():
        return {"ready": False, "error": f"{runtime_id} 专属运行环境未就绪。"}
    expected = requirements_fingerprint(runtime)
    if expected:
        marker = runtime_venv(runtime_id) / ".recut-requirements.sha256"
        try:
            actual = marker.read_text(encoding="utf-8").strip()
        except OSError:
            actual = ""
        if actual != expected:
            return {"ready": False, "error": f"{runtime_id} 运行环境依赖已更新，需要重新准备。"}
    runner = app_root() / runtime.get("runner", f"python/{runtime_id}_runner.py")
    try:
        result = subprocess.run([str(python), str(runner), "status"], capture_output=True, text=True, timeout=120)
    except Exception as error:  # noqa: BLE001
        return {"ready": False, "error": str(error)}
    if result.returncode != 0:
        return {"ready": False, "error": (result.stdout or result.stderr or "").strip()[-400:]}
    lines = [line for line in (result.stdout or "").strip().split("\n") if line.strip()]
    try:
        payload = json.loads(lines[-1]) if lines else {}
    except ValueError:
        payload = {}
    return {"ready": bool(payload.get("ready")), "error": payload.get("error")}


def cmd_status(_: argparse.Namespace) -> dict:
    reg = registry()
    runtimes = {}
    for runtime in reg.get("runtimes", []):
        runtimes[runtime["id"]] = runtime_status(runtime)
    models = {}
    for model in reg.get("models", []):
        downloaded = model_downloaded(model["runtime"], model["id"])
        models[model["id"]] = {
            "installed": downloaded,
            "sizeGb": (model.get("weights") or {}).get("sizeGb", 0),
            "source": "",
        }
    problems = []
    for runtime_id, state in runtimes.items():
        if not state["ready"]:
            problems.append(state.get("error") or f"{runtime_id} 未就绪。")
    return {"ready": not problems, "error": problems[0] if problems else "", "runtimes": runtimes, "models": models}


def cmd_catalog(args: argparse.Namespace) -> dict:
    return cmd_status(args)


def display_size(size: float) -> str:
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KiB"
    if size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MiB"
    return f"{size / (1024 * 1024 * 1024):.2f} GiB"


def resumable_download(url: str, dest: Path, expected_size: int = 0, attempts: int = 8) -> None:
    """流式下载到 dest.part，带读超时、断点续传与卡死重试（对齐 audio-studio）。

    已按 expected_size 校验完整的目标文件直接跳过；只下了一半的文件从 dest.part
    续传，用 HTTP Range 从断点继续；读超时 30s，失败按指数退避重试，最多 8 次。
    """
    import requests as requests_lib

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    if not part.exists() and dest.exists():
        if expected_size and dest.stat().st_size == expected_size:
            print(f"[gen] {dest.name} 已存在（{display_size(expected_size)}），跳过。", flush=True)
            return
        dest.replace(part)
    read_timeout = 30
    for attempt in range(1, attempts + 1):
        done = part.stat().st_size if part.exists() else 0
        if expected_size and done >= expected_size:
            break
        headers = {"Range": f"bytes={done}-"} if done else {}
        try:
            started = time.monotonic()
            last_report = 0.0
            with requests_lib.get(url, headers=headers, stream=True, timeout=(10, read_timeout)) as response:
                if response.status_code == 416:
                    break
                response.raise_for_status()
                mode = "ab" if (done and response.status_code == 206) else "wb"
                with part.open(mode) as sink:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        sink.write(chunk)
                        now = time.monotonic()
                        if now - last_report >= 15:
                            current = part.stat().st_size
                            speed = (current - done) / max(now - started, 0.001) / (1024 * 1024)
                            print(f"[gen] {dest.name} 已下载 {display_size(current)}（{speed:.1f} MiB/s）。", flush=True)
                            last_report = now
            break
        except (requests_lib.RequestException, OSError) as error:
            kept = part.stat().st_size if part.exists() else 0
            if attempt >= attempts:
                raise RuntimeError(f"{dest.name} 下载失败（已重试 {attempts} 次，最后错误：{error}）。") from error
            print(f"[gen] {dest.name} 下载中断（{error}），从 {display_size(kept)} 续传（第 {attempt}/{attempts} 次重试）。", flush=True)
            time.sleep(min(2 ** attempt, 30))
    if expected_size and part.exists() and part.stat().st_size != expected_size:
        raise RuntimeError(f"{dest.name} 下载不完整（{part.stat().st_size} / {expected_size} 字节）。")
    part.replace(dest)


def matches_allow(name: str, allow) -> bool:
    if not allow:
        return True
    return any(fnmatch.fnmatch(name, pattern) for pattern in allow)


def download_huggingface_repo(repo: str, revision: str, target: Path, allow=None) -> None:
    """按 repo_info 逐文件下载到 App 自有目录：每文件独立断点续传 + 大小校验，
    避免 40GB 级权重在半路崩溃后从头再来（对齐 audio-studio）。allow 为文件白名单
    （registry.weights.files 的 glob），只拉需要的文件。"""
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    from huggingface_hub import hf_hub_url, repo_info  # type: ignore

    info = repo_info(repo, revision=revision or None, files_metadata=True)
    pinned = info.sha
    siblings = [item for item in info.siblings if item.rfilename != ".gitattributes" and matches_allow(item.rfilename, allow)]
    if not siblings:
        raise RuntimeError(f"{repo} 没有匹配白名单的文件：{allow}")
    total = sum(item.size or 0 for item in siblings)
    print(f"[gen] 从 Hugging Face 下载 {repo}（{display_size(total)}，{len(siblings)} 个文件）。", flush=True)
    downloaded = 0
    for item in siblings:
        size = item.size or 0
        url = hf_hub_url(repo, item.rfilename, revision=pinned)
        resumable_download(url, target / item.rfilename, expected_size=size)
        downloaded += size
        print(f"[gen] 已下载 {display_size(downloaded)} / {display_size(total)}（{item.rfilename}）。", flush=True)
    print(f"[gen] {repo} 下载完成。", flush=True)


def download_modelscope_repo(repo: str, revision: str, target: Path, allow=None) -> None:
    from modelscope.hub.snapshot_download import snapshot_download  # type: ignore

    # ModelScope 的默认分支是 master，HF 是 main；共用同一个 revision 会 404，这里归一化。
    ms_revision = revision if revision and revision not in ("main", "master") else None
    print(f"[gen] 从 ModelScope 下载 {repo}。", flush=True)
    try:
        snapshot_download(repo, revision=ms_revision, local_dir=str(target), allow_file_pattern=allow)
    except TypeError as error:
        # 旧版 modelscope 不支持白名单参数；绝不退回整仓下载（该仓库共 ~74GB）。
        raise RuntimeError(f"当前 modelscope 版本不支持 allow_file_pattern，无法按白名单下载：{error}") from error
    print(f"[gen] {repo} 下载完成。", flush=True)


def cmd_install(args: argparse.Namespace) -> dict:
    reg = registry()
    model = next((m for m in reg.get("models", []) if m["id"] == args.model), None)
    if model is None:
        raise SystemExit(f"unknown model: {args.model}")
    runtime = runtime_def(reg, model["runtime"])
    weights = model.get("weights") or {}
    allow = weights.get("files") or None
    target = model_files_dir(runtime, model["id"])
    if model_downloaded(model["runtime"], model["id"]):
        print(f"[gen] {model['id']} 权重已就绪，跳过下载。", flush=True)
        return {"ready": True, "model": model["id"], "path": str(target), "cached": True}
    target.mkdir(parents=True, exist_ok=True)
    revision = weights.get("revision", "")
    source = args.source or "automatic"
    errors = []
    order = [source] if source in ("huggingface", "modelscope") else ["huggingface", "modelscope"]
    for candidate in order:
        repo = weights.get("huggingFace", "") if candidate == "huggingface" else weights.get("modelScope", "")
        if not repo:
            errors.append(f"{candidate}: 未配置仓库")
            continue
        try:
            if candidate == "huggingface":
                download_huggingface_repo(repo, revision, target, allow)
            else:
                download_modelscope_repo(repo, revision, target, allow)
            marker = {
                "model": model["id"], "source": candidate, "revision": revision,
                "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
            (model_dir(model["runtime"], model["id"])).mkdir(parents=True, exist_ok=True)
            (model_dir(model["runtime"], model["id"]) / DOWNLOAD_MARKER).write_text(json.dumps(marker, ensure_ascii=False), encoding="utf-8")
            print(f"[gen] {model['id']} 权重已下载到 {target}。", flush=True)
            return {"ready": True, "model": model["id"], "path": str(target)}
        except Exception as error:  # noqa: BLE001
            errors.append(f"{candidate}: {error}")
            print(f"[gen] {candidate} 下载失败：{error}", flush=True)
            print("[gen] 尝试下一个来源。", flush=True)
    raise SystemExit("; ".join(errors) or "download failed")


def cmd_generate(args: argparse.Namespace) -> dict:
    reg = registry()
    model = next((m for m in reg.get("models", []) if m["id"] == args.model), None)
    if model is None:
        raise SystemExit(f"unknown model: {args.model}")
    runtime_id = model["runtime"]
    python = runtime_python(runtime_id)
    if not python.is_file():
        raise SystemExit(f"{runtime_id} 专属运行环境未就绪，请先准备环境。")
    runtime = runtime_def(reg, runtime_id)
    runner = app_root() / runtime.get("runner", f"python/{runtime_id}_runner.py")
    forwarded = ["generate", "--model", model["id"], "--prompt", args.prompt, "--output", args.output]
    if args.negative_prompt:
        forwarded += ["--negative-prompt", args.negative_prompt]
    if args.aspect_ratio:
        forwarded += ["--aspect-ratio", args.aspect_ratio]
    if args.seed:
        forwarded += ["--seed", str(args.seed)]
    if args.steps:
        forwarded += ["--steps", str(args.steps)]
    if args.cfg:
        forwarded += ["--cfg", str(args.cfg)]
    for reference in args.reference:
        forwarded += ["--reference", reference]
    process = subprocess.Popen([str(python), str(runner), *forwarded], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert process.stdout is not None
    for line in process.stdout:
        print(line.rstrip(), flush=True)
    if process.wait() != 0:
        raise SystemExit("generation worker failed")
    return {"ready": True, "model": model["id"], "output": args.output}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-log", default="")
    sub = parser.add_subparsers(dest="command", required=True)

    status_parser = sub.add_parser("status")
    status_parser.add_argument("--task-log", default="")

    catalog_parser = sub.add_parser("catalog")
    catalog_parser.add_argument("--task-log", default="")

    install_parser = sub.add_parser("install")
    install_parser.add_argument("--model", required=True)
    install_parser.add_argument("--source", default="automatic")
    install_parser.add_argument("--task-log", default="")

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
    generate_parser.add_argument("--task-log", default="")

    args = parser.parse_args()
    resolve_task_log(args.task_log)

    if args.command == "status":
        payload = cmd_status(args)
    elif args.command == "catalog":
        payload = cmd_catalog(args)
    elif args.command == "install":
        payload = cmd_install(args)
    elif args.command == "generate":
        payload = cmd_generate(args)
    else:  # pragma: no cover
        raise SystemExit(f"unknown command: {args.command}")

    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
