"""
[INPUT]: 平台注入的 RECUT_MODELS_DIR / RECUT_VENV / RECUT_PYTHON / RECUT_APP_FILES_DIR；comfyuiapps/<id>/
          的 manifest.json 与 workflow.py；generate 子命令的 --params/--reference
[OUTPUT]: status（torch 与 ComfyUI 源码自检）、serve（启动/复用本应用 ComfyUI 常驻服务，端口被旧/外来实例占用时按仓库归属接管或报错）、generate（加载 app manifest →
          导入 workflow.build(ctx) 动态构图 → 提交 API 工作流 → 按 output.kind 取回产物 → 写 <output>.meta.json）
[POS]: comfyui-studio comfyui runtime venv 内的通用执行器；不认识任何具体工作流，工作流全部来自 comfyuiapps/
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

import comfyui_sdk
from comfyui_sdk import BuildContext, load_app, load_workflow, weight_roles

DEFAULT_PORT = 8188
CLIENT_ID = "recut-comfyui-studio"

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def repository() -> Path:
    return comfyui_sdk.comfyui_repository()


def pid_path() -> Path:
    return comfyui_sdk.models_root() / "comfyui" / "server.pid"


def lock_path() -> Path:
    return comfyui_sdk.models_root() / "comfyui" / "server.lock"


def resolve_output(raw: str) -> Path:
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = comfyui_sdk.files_root() / candidate
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


def listening_pid(port: int) -> int:
    """返回监听 port 的进程 PID；无法判定时返回 0（跨平台尽力而为）。"""
    proc = Path("/proc")
    if proc.is_dir():
        inode = ""
        try:
            for line in Path("/proc/net/tcp").read_text().splitlines()[1:]:
                fields = line.split()
                if len(fields) < 10 or fields[3] != "0A":  # 0A = LISTEN
                    continue
                if int(fields[1].split(":")[1], 16) != port:
                    continue
                inode = fields[9]
                break
        except (OSError, ValueError):
            inode = ""
        if inode:
            for entry in proc.iterdir():
                if not entry.name.isdigit():
                    continue
                try:
                    for fd in (entry / "fd").iterdir():
                        try:
                            if os.readlink(fd) == f"socket:[{inode}]":
                                return int(entry.name)
                        except OSError:
                            continue
                except OSError:
                    continue
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            capture_output=True, text=True, timeout=5,
        )
        for token in result.stdout.split():
            if token.isdigit():
                return int(token)
    except (OSError, subprocess.SubprocessError):
        pass
    return 0


def process_cwd(pid: int) -> str:
    """返回进程工作目录的 realpath；无法判定时返回空串。"""
    try:
        link = Path(f"/proc/{pid}/cwd")
        if link.exists():
            return os.path.realpath(link)
    except OSError:
        pass
    try:
        result = subprocess.run(
            ["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.splitlines():
            if line.startswith("n"):
                return os.path.realpath(line[1:].strip())
    except (OSError, subprocess.SubprocessError):
        pass
    return ""


def server_owned(port: int) -> bool:
    """监听 port 的 ComfyUI 是否由本应用启动（工作目录 == 本应用仓库）。

    拿不到 PID/cwd 时保守返回 True：宁可复用也不误杀用户自建的实例。
    """
    pid = listening_pid(port)
    if pid <= 0:
        return True
    cwd = process_cwd(pid)
    if not cwd:
        return True
    return cwd == os.path.realpath(str(repository()))


def reclaim_foreign_server(port: int) -> None:
    """端口被旧实例占用时接管：仅当它是同一 models 根下（如改名前的 gen-studio）的
    ComfyUI 仓库才停止；其它来源直接报错，交给用户处理。"""
    pid = listening_pid(port)
    cwd = process_cwd(pid) if pid > 0 else ""
    models_parent = os.path.realpath(str(comfyui_sdk.models_root().parent))
    if pid > 0 and cwd and Path(cwd).is_relative_to(models_parent):
        print(f"[comfy] 端口 {port} 被旧 ComfyUI 实例占用（{cwd}），正在停止并接管…", flush=True)
        _terminate_pid(pid)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and server_alive(port):
            time.sleep(0.5)
        if server_alive(port):
            _kill_pid(pid)
            time.sleep(1)
        return
    raise SystemExit(
        f"端口 {port} 已被其它 ComfyUI 实例占用（cwd={cwd or '未知'}）；"
        f"请先停止它，或用 RECUT_COMFYUI_PORT 换一个端口。"
    )


def _terminate_pid(pid: int) -> None:
    import signal

    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except Exception:  # noqa: BLE001
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:  # noqa: BLE001
            pass


def _kill_pid(pid: int) -> None:
    import signal

    try:
        os.killpg(os.getpgid(pid), signal.SIGKILL)
    except Exception:  # noqa: BLE001
        try:
            os.kill(pid, signal.SIGKILL)
        except Exception:  # noqa: BLE001
            pass


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


def _acquire_lock(timeout: float = 600.0) -> bool:
    """跨进程文件锁：创建 server.lock（O_EXCL）。已存在且过旧（>15min）视为残留并接管。"""
    path = lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode("utf-8"))
            os.close(fd)
            return True
        except FileExistsError:
            try:
                if time.time() - path.stat().st_mtime > 900:
                    path.unlink()
                    continue
            except OSError:
                pass
            time.sleep(1)
    return False


def _release_lock() -> None:
    try:
        lock_path().unlink()
    except OSError:
        pass


def ensure_server(port: int) -> None:
    """幂等：复用本应用启动的常驻 ComfyUI；端口被旧/外来实例占用时先接管或报错；
    否则在文件锁保护下启动一个常驻服务（不随本进程退出）。"""
    if server_alive(port):
        if server_owned(port):
            print(f"[comfy] 复用已运行的 ComfyUI 服务（:{port}）。", flush=True)
            return
        reclaim_foreign_server(port)
    if not _acquire_lock():
        raise SystemExit("等待 ComfyUI 引擎锁超时。")
    try:
        if server_alive(port):  # 另一个进程已启动
            if server_owned(port):
                print(f"[comfy] 复用已运行的 ComfyUI 服务（:{port}）。", flush=True)
                return
            reclaim_foreign_server(port)
        repo = repository()
        print(f"[comfy] 正在启动 ComfyUI 服务（:{port}，首次启动较慢）…", flush=True)
        log_path = comfyui_sdk.models_root() / "comfyui" / "server.log"
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
                tail_server_log(log_path, offset)
                print("[comfy] ComfyUI 服务已就绪。", flush=True)
                return
            time.sleep(3)
        tail_server_log(log_path, offset)
        raise SystemExit(f"ComfyUI 服务启动超时，日志见 {log_path}")
    finally:
        _release_lock()


# ---------------------- 产物取回 ----------------------


def copy_references(paths: list) -> list:
    input_dir = comfyui_sdk.comfyui_input_dir()
    input_dir.mkdir(parents=True, exist_ok=True)
    names = []
    for index, raw in enumerate(paths, start=1):
        source = Path(raw)
        if not source.is_absolute():
            source = comfyui_sdk.files_root() / source
        if not source.is_file():
            print(f"[comfy] 参考图不存在，已跳过：{raw}", flush=True)
            continue
        suffix = source.suffix or ".png"
        name = f"recut_ref_{index}{suffix}"
        shutil.copyfile(source, input_dir / name)
        names.append(name)
    return names


def _output_items(entry: dict, kind: str) -> list:
    keys = {"image": ["images"], "video": ["gifs", "videos"], "audio": ["audio", "audios"]}.get(kind, ["images"])
    items = []
    for node_output in (entry.get("outputs") or {}).values():
        for key in keys:
            items.extend(node_output.get(key) or [])
    return items


def queue_and_wait(port: int, workflow: dict, output_path: Path, kind: str) -> None:
    import requests  # type: ignore

    response = requests.post(server_url(port) + "/prompt", json={"prompt": workflow, "client_id": CLIENT_ID}, timeout=30)
    payload = response.json()
    if response.status_code != 200 or "prompt_id" not in payload:
        raise SystemExit(f"ComfyUI 拒绝工作流：{json.dumps(payload, ensure_ascii=False)[:600]}")
    prompt_id = payload["prompt_id"]
    print(f"[comfy] 工作流已提交（{prompt_id}），等待产出…", flush=True)
    started = time.monotonic()
    last_report = 0.0
    while True:
        history = requests.get(server_url(port) + f"/history/{prompt_id}", timeout=30).json()
        entry = history.get(prompt_id)
        if entry:
            status = (entry.get("status") or {}).get("status_str", "")
            if status == "error":
                raise SystemExit(f"ComfyUI 执行失败：{json.dumps(entry.get('status'), ensure_ascii=False)[:600]}")
            items = _output_items(entry, kind)
            if items:
                item = items[0]
                query = f"?filename={item['filename']}&subfolder={item.get('subfolder','')}&type={item.get('type','output')}"
                data = requests.get(server_url(port) + "/view" + query, timeout=300).content
                output_path.write_bytes(data)
                print(f"[comfy] 已生成 {output_path.name}（{int(time.monotonic() - started)}s）。", flush=True)
                return
        now = time.monotonic()
        if now - last_report >= 15:
            print(f"[comfy] 产出中（已等待 {int(now - started)}s）…", flush=True)
            last_report = now
        time.sleep(2)


def _weight_missing(manifest: dict) -> list:
    missing = []
    for entry in ((manifest.get("weights") or {}).get("files") or []):
        rel = entry.get("path") if isinstance(entry, dict) else entry
        if rel and not (comfyui_sdk.comfyui_models_dir() / rel).is_file():
            missing.append(Path(rel).name)
    return missing


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
    app_id = args.app
    manifest = load_app(app_id)
    if not weight_roles(manifest):
        raise SystemExit("模型权重清单不完整，请先下载模型。")
    missing = _weight_missing(manifest)
    if missing:
        raise SystemExit(f"模型权重缺失：{missing}，请先下载模型。")

    params = {}
    if args.params:
        raw = Path(args.params)
        if not raw.is_absolute():
            raw = comfyui_sdk.files_root() / raw
        try:
            params = json.loads(raw.read_text(encoding="utf-8"))
        except OSError:
            params = {}

    port = int(os.environ.get("RECUT_COMFYUI_PORT", DEFAULT_PORT))
    ensure_server(port)

    references = copy_references(args.reference or [])
    if references:
        print(f"[comfy] 编辑模式：{len(references)} 张参考图。", flush=True)
    ctx = BuildContext(manifest, params, references, args.output)
    module = load_workflow(app_id)
    graph = module.build(ctx)

    kind = (manifest.get("output") or {}).get("kind", "image")
    ext = (manifest.get("output") or {}).get("ext", "png")
    output_path = resolve_output(args.output + "." + ext)
    started = time.time()
    queue_and_wait(port, graph, output_path, kind)
    elapsed = round(time.time() - started, 2)

    meta = {"app": app_id, "outputKind": kind, "duration": elapsed, "references": len(references),
            "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if hasattr(module, "meta"):
        try:
            extra = module.meta(ctx, graph) or {}
            if isinstance(extra, dict):
                meta.update(extra)
        except Exception as error:  # noqa: BLE001
            print(f"[comfy] meta() 计算失败，已忽略：{error}", flush=True)
    Path(str(output_path) + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"ready": True, "output": str(output_path), **meta}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")

    serve_parser = sub.add_parser("serve")
    serve_parser.add_argument("--port", default="")

    generate_parser = sub.add_parser("generate")
    generate_parser.add_argument("--app", required=True)
    generate_parser.add_argument("--output", required=True)
    generate_parser.add_argument("--params", default="")
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
