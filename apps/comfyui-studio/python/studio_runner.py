"""
[INPUT]: 平台注入的 RECUT_APP_FILES_DIR / RECUT_MODELS_DIR / RECUT_VENV / RECUT_PYTHON；python/registry.json
          （由 publish_registry.py 从 comfyuiapps/*/manifest.json 生成）；--task-log 任务日志文件
[OUTPUT]: status（runtime venv 与各工作流权重就绪度）、catalog（同 status 的工作流面）、install（从 huggingface/
          modelscope/automatic 下载权重，不动 venv；逐文件断点续传 + 大小校验 + 完成标记，可安全重试）、
          generate（把请求派发到工作流所属 runtime 的专属 venv worker）、engine（ComfyUI 常驻服务 status/start/stop）
[POS]: comfyui-studio 的主 venv 调度器；主 venv 保持轻量（下载/调度），真正推理在 comfyui runtime 专属 venv
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
    msg = line[len("[comfy] "):] if line.startswith("[comfy] ") else line
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
    return Path(os.environ.get("RECUT_MODELS_DIR", Path.home() / ".recut" / "models")) / "comfyui-studio"


def runtime_venv(runtime_id: str) -> Path:
    root = Path(os.environ.get("RECUT_VENV", ""))
    if not root.name:
        return Path("/nonexistent/recut-comfyui-venv")
    return root.with_name(f"{root.name}-{runtime_id}")


def runtime_python(runtime_id: str) -> Path:
    venv = runtime_venv(runtime_id)
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def app_dir(runtime_id: str, app_id: str) -> Path:
    """每个 runtime/app 的状态目录（下载完成标记、元数据）。"""
    return models_root() / runtime_id / app_id


def runtime_repository(runtime: dict) -> Path:
    return models_root() / runtime["id"] / "repository"


def weight_files(manifest: dict) -> list:
    """manifest.weights.files 归一为路径列表（同时作为下载白名单）。"""
    out = []
    for entry in ((manifest.get("weights") or {}).get("files") or []):
        path = entry.get("path") if isinstance(entry, dict) else entry
        if path:
            out.append(path)
    return out


def weight_target(runtime: dict, app_id: str) -> Path:
    """权重落盘目录。ComfyUI 要求文件放在其仓库的 models/ 下（按子目录分类）。"""
    if runtime.get("id") == "comfyui":
        return runtime_repository(runtime) / "models"
    return app_dir(runtime["id"], app_id)


# 下载完成标记：权重目录内所有文件写完后才落盘。
DOWNLOAD_MARKER = ".recut-download-complete"


def app_downloaded(runtime_id: str, app_id: str) -> bool:
    return (app_dir(runtime_id, app_id) / DOWNLOAD_MARKER).is_file()


def runtime_def(reg: dict, runtime_id: str) -> dict:
    return next((r for r in reg.get("runtimes", []) if r["id"] == runtime_id), {"id": runtime_id})


def app_def(reg: dict, app_id: str) -> dict:
    return next((a for a in reg.get("apps", []) if a["id"] == app_id), None)


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
    apps = {}
    for app in reg.get("apps", []):
        downloaded = app_downloaded(app["runtime"], app["id"])
        apps[app["id"]] = {
            "installed": downloaded,
            "sizeGb": (app.get("weights") or {}).get("sizeGb", 0),
            "source": "",
        }
    problems = []
    for runtime_id, state in runtimes.items():
        if not state["ready"]:
            problems.append(state.get("error") or f"{runtime_id} 未就绪。")
    return {"ready": not problems, "error": problems[0] if problems else "", "runtimes": runtimes, "apps": apps}


def cmd_catalog(args: argparse.Namespace) -> dict:
    return cmd_status(args)


def display_size(size: float) -> str:
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KiB"
    if size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MiB"
    return f"{size / (1024 * 1024 * 1024):.2f} GiB"


def resumable_download(url: str, dest: Path, expected_size: int = 0, attempts: int = 8) -> None:
    """流式下载到 dest.part，带读超时、断点续传与卡死重试（对齐 audio-studio）。"""
    import requests as requests_lib

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    if not part.exists() and dest.exists():
        if expected_size and dest.stat().st_size == expected_size:
            print(f"[comfy] {dest.name} 已存在（{display_size(expected_size)}），跳过。", flush=True)
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
                            print(f"[comfy] {dest.name} 已下载 {display_size(current)}（{speed:.1f} MiB/s）。", flush=True)
                            last_report = now
            break
        except (requests_lib.RequestException, OSError) as error:
            kept = part.stat().st_size if part.exists() else 0
            if attempt >= attempts:
                raise RuntimeError(f"{dest.name} 下载失败（已重试 {attempts} 次，最后错误：{error}）。") from error
            print(f"[comfy] {dest.name} 下载中断（{error}），从 {display_size(kept)} 续传（第 {attempt}/{attempts} 次重试）。", flush=True)
            time.sleep(min(2 ** attempt, 30))
    if expected_size and part.exists() and part.stat().st_size != expected_size:
        raise RuntimeError(f"{dest.name} 下载不完整（{part.stat().st_size} / {expected_size} 字节）。")
    part.replace(dest)


def matches_allow(name: str, allow) -> bool:
    if not allow:
        return True
    return any(fnmatch.fnmatch(name, pattern) for pattern in allow)


def download_huggingface_repo(repo: str, revision: str, target: Path, allow=None) -> None:
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    from huggingface_hub import hf_hub_url, repo_info  # type: ignore

    info = repo_info(repo, revision=revision or None, files_metadata=True)
    pinned = info.sha
    siblings = [item for item in info.siblings if item.rfilename != ".gitattributes" and matches_allow(item.rfilename, allow)]
    if not siblings:
        raise RuntimeError(f"{repo} 没有匹配白名单的文件：{allow}")
    total = sum(item.size or 0 for item in siblings)
    print(f"[comfy] 从 Hugging Face 下载 {repo}（{display_size(total)}，{len(siblings)} 个文件）。", flush=True)
    downloaded = 0
    for item in siblings:
        size = item.size or 0
        url = hf_hub_url(repo, item.rfilename, revision=pinned)
        resumable_download(url, target / item.rfilename, expected_size=size)
        downloaded += size
        print(f"[comfy] 已下载 {display_size(downloaded)} / {display_size(total)}（{item.rfilename}）。", flush=True)
    print(f"[comfy] {repo} 下载完成。", flush=True)


def download_modelscope_repo(repo: str, revision: str, target: Path, allow=None) -> None:
    from modelscope.hub.snapshot_download import snapshot_download  # type: ignore

    ms_revision = revision if revision and revision not in ("main", "master") else None
    print(f"[comfy] 从 ModelScope 下载 {repo}。", flush=True)
    try:
        snapshot_download(repo, revision=ms_revision, local_dir=str(target), allow_file_pattern=allow)
    except TypeError as error:
        raise RuntimeError(f"当前 modelscope 版本不支持 allow_file_pattern，无法按白名单下载：{error}") from error
    print(f"[comfy] {repo} 下载完成。", flush=True)


def cmd_install(args: argparse.Namespace) -> dict:
    reg = registry()
    app = app_def(reg, args.app)
    if app is None:
        raise SystemExit(f"unknown app: {args.app}")
    runtime = runtime_def(reg, app["runtime"])
    weights = app.get("weights") or {}
    allow = weight_files(app) or None
    target = weight_target(runtime, app["id"])
    if app_downloaded(app["runtime"], app["id"]):
        print(f"[comfy] {app['id']} 权重已就绪，跳过下载。", flush=True)
        return {"ready": True, "app": app["id"], "path": str(target), "cached": True}
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
            marker = {"app": app["id"], "source": candidate, "revision": revision,
                      "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            app_dir(app["runtime"], app["id"]).mkdir(parents=True, exist_ok=True)
            (app_dir(app["runtime"], app["id"]) / DOWNLOAD_MARKER).write_text(json.dumps(marker, ensure_ascii=False), encoding="utf-8")
            print(f"[comfy] {app['id']} 权重已下载到 {target}。", flush=True)
            return {"ready": True, "app": app["id"], "path": str(target)}
        except Exception as error:  # noqa: BLE001
            errors.append(f"{candidate}: {error}")
            print(f"[comfy] {candidate} 下载失败：{error}", flush=True)
            print("[comfy] 尝试下一个来源。", flush=True)
    raise SystemExit("; ".join(errors) or "download failed")


def cmd_generate(args: argparse.Namespace) -> dict:
    reg = registry()
    app = app_def(reg, args.app)
    if app is None:
        raise SystemExit(f"unknown app: {args.app}")
    runtime_id = app["runtime"]
    python = runtime_python(runtime_id)
    if not python.is_file():
        raise SystemExit(f"{runtime_id} 专属运行环境未就绪，请先准备环境。")
    runtime = runtime_def(reg, runtime_id)
    runner = app_root() / runtime.get("runner", f"python/{runtime_id}_runner.py")
    forwarded = ["generate", "--app", app["id"], "--output", args.output]
    if args.params:
        forwarded += ["--params", args.params]
    for reference in args.reference:
        forwarded += ["--reference", reference]
    process = subprocess.Popen([str(python), str(runner), *forwarded], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert process.stdout is not None
    for line in process.stdout:
        print(line.rstrip(), flush=True)
    if process.wait() != 0:
        raise SystemExit("generation worker failed")
    return {"ready": True, "app": app["id"], "output": args.output}


# ---------------------- ComfyUI 引擎（常驻服务） ----------------------


def engine_port() -> int:
    return int(os.environ.get("RECUT_COMFYUI_PORT", "8188"))


def engine_pid_file() -> Path:
    return models_root() / "comfyui" / "server.pid"


def engine_alive(port: int) -> bool:
    import urllib.request

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=2) as response:
            return response.status == 200
    except Exception:  # noqa: BLE001
        return False


def engine_status(port: int) -> dict:
    try:
        pid = engine_pid_file().read_text(encoding="utf-8").strip()
    except OSError:
        pid = ""
    return {"running": engine_alive(port), "port": port, "pid": pid}


def engine_start(port: int) -> dict:
    runtime = runtime_def(registry(), "comfyui")
    python = runtime_python("comfyui")
    if not python.is_file():
        raise SystemExit("ComfyUI 专属运行环境未就绪，请先准备环境。")
    runner = app_root() / runtime.get("runner", "python/comfyui_runner.py")
    process = subprocess.Popen([str(python), str(runner), "serve", "--port", str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert process.stdout is not None
    for line in process.stdout:
        print(line.rstrip(), flush=True)
    if process.wait() != 0:
        raise SystemExit("ComfyUI 引擎启动失败。")
    return {"ready": True, "running": True, "port": port}


def engine_stop(port: int) -> dict:
    import signal

    try:
        pid = int(engine_pid_file().read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        pid = 0
    if pid <= 0:
        if not engine_alive(port):
            return {"running": False, "port": port, "pid": ""}
        raise SystemExit("找不到 ComfyUI 服务进程，无法关闭。")
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except Exception:  # noqa: BLE001
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:  # noqa: BLE001
            pass
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and engine_alive(port):
        time.sleep(0.5)
    if engine_alive(port):
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except Exception:  # noqa: BLE001
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception:  # noqa: BLE001
                pass
        time.sleep(1)
    try:
        engine_pid_file().unlink()
    except OSError:
        pass
    return {"running": engine_alive(port), "port": port, "pid": ""}


def cmd_engine(args: argparse.Namespace) -> dict:
    action = args.engine_action
    port = engine_port()
    if action == "status":
        return engine_status(port)
    if action == "start":
        return engine_start(port)
    if action == "stop":
        return engine_stop(port)
    raise SystemExit(f"unknown engine action: {action}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-log", default="")
    sub = parser.add_subparsers(dest="command", required=True)

    status_parser = sub.add_parser("status")
    status_parser.add_argument("--task-log", default="")

    catalog_parser = sub.add_parser("catalog")
    catalog_parser.add_argument("--task-log", default="")

    install_parser = sub.add_parser("install")
    install_parser.add_argument("--app", required=True)
    install_parser.add_argument("--source", default="automatic")
    install_parser.add_argument("--task-log", default="")

    generate_parser = sub.add_parser("generate")
    generate_parser.add_argument("--app", required=True)
    generate_parser.add_argument("--output", required=True)
    generate_parser.add_argument("--params", default="")
    generate_parser.add_argument("--reference", action="append", default=[])
    generate_parser.add_argument("--task-log", default="")

    engine_parser = sub.add_parser("engine")
    engine_parser.add_argument("engine_action", choices=["status", "start", "stop"])
    engine_parser.add_argument("--task-log", default="")

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
    elif args.command == "engine":
        payload = cmd_engine(args)
    else:  # pragma: no cover
        raise SystemExit(f"unknown command: {args.command}")

    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
