"""
[INPUT]: 平台注入的 RECUT_MODELS_DIR / RECUT_PYTHON / RECUT_VENV 与标准库子进程/git 能力；python/registry.json
          （由 publish_registry.py 生成）与 comfyuiapps/*/bootstrap.py；--target 定向准备（all/comfyui/<appId>）
          与 --task-log 任务日志文件
[OUTPUT]: 为 runtime 创建与主 venv 隔离的专属 venv（从 RECUT_VENV 派生 <name>-<runtime>）、按固定 commit 浅克隆
          其源码仓库（ComfyUI）、安装锁定依赖并自检；逐工作流执行其 bootstrap.py；最后启动/复用 ComfyUI 常驻服务。
          不下载模型权重（权重下载是 comfy.install 的职责）
[POS]: comfyui-studio 的运行环境准备器；主 venv 只保留轻量调度/下载依赖，torch/ComfyUI 等重依赖各自独立 venv；
       引擎随 prepare 就绪，UI 与 background/AI 都可触发（幂等，见 comfyui_runner.ensure_server）
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import builtins
import datetime
import hashlib
import json
import os
import subprocess
from pathlib import Path

REQUIREMENTS_MARKER = ".recut-requirements.sha256"


def requirements_fingerprint(requirements: Path) -> str:
    return hashlib.sha256(requirements.read_bytes()).hexdigest()

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
    elif any(word in msg for word in ("较慢", "回退", "等待", "重试", "进行")):
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
    return Path(__file__).resolve().parent


def python_dir() -> Path:
    return app_root() / "python"


def registry() -> dict:
    return json.loads((python_dir() / "registry.json").read_text(encoding="utf-8"))


def models_root() -> Path:
    return Path(os.environ.get("RECUT_MODELS_DIR", Path.home() / ".recut" / "models")) / "comfyui-studio"


def runtime_repository(runtime: dict) -> Path:
    return models_root() / runtime["id"] / "repository"


def ensure_repository(runtime: dict) -> None:
    """按固定 commit 浅克隆 runtime 的源码仓库（如 ComfyUI），保证上游更新不影响已装环境。"""
    url = runtime.get("repository")
    revision = runtime.get("revision")
    if not url or not revision:
        return
    target = runtime_repository(runtime)
    if not (target / ".git").is_dir():
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "-C", str(target), "init", "--quiet"], check=True)
        subprocess.run(["git", "-C", str(target), "remote", "add", "origin", url], check=True)
    print(f"[comfy] 正在拉取 {runtime['id']} 源码（{revision[:12]}）。", flush=True)
    subprocess.run(["git", "-C", str(target), "fetch", "--depth", "1", "origin", revision], check=True)
    subprocess.run(["git", "-C", str(target), "checkout", "--force", "FETCH_HEAD"], check=True)


def runtime_venv(runtime_id: str) -> Path:
    root = Path(os.environ.get("RECUT_VENV", ""))
    if not root.name:
        raise RuntimeError("RECUT_VENV is required to prepare a runtime")
    return root.with_name(f"{root.name}-{runtime_id}")


def runtime_python(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def prepare_runtime(runtime: dict) -> None:
    runtime_id = runtime["id"]
    ensure_repository(runtime)
    venv = runtime_venv(runtime_id)
    target = runtime_python(venv)
    base_python = os.environ.get("RECUT_PYTHON")
    if not base_python:
        raise RuntimeError("RECUT_PYTHON is required to prepare a runtime")
    if not target.is_file():
        print(f"[comfy] 正在创建 {runtime_id} 专属运行环境。", flush=True)
        subprocess.run([base_python, "-m", "venv", str(venv)], check=True)
    requirements = app_root() / runtime.get("requirements", "")
    fingerprint = ""
    marker = venv / REQUIREMENTS_MARKER
    if requirements.is_file():
        fingerprint = requirements_fingerprint(requirements)
        if marker.is_file() and marker.read_text(encoding="utf-8").strip() == fingerprint:
            print(f"[comfy] {runtime_id} 依赖锁定未变化，跳过重装。", flush=True)
        else:
            print(f"[comfy] 正在安装 {runtime_id} 锁定依赖（首次会下载 torch 等较大组件）。", flush=True)
            subprocess.run([str(target), "-m", "pip", "install", "--disable-pip-version-check", "--requirement", str(requirements)], check=True)
    print(f"[comfy] 正在验证 {runtime_id} 依赖闭包。", flush=True)
    subprocess.run([str(target), "-m", "pip", "check"], check=True)
    runner = app_root() / runtime.get("runner", f"python/{runtime_id}_runner.py")
    subprocess.run([str(target), str(runner), "status"], check=True)
    if fingerprint:
        marker.write_text(fingerprint, encoding="utf-8")
    print(f"[comfy] {runtime_id} 专属运行环境已就绪。", flush=True)


def prepare_app(app: dict) -> None:
    """在 runtime venv 语境下执行工作流自己的 bootstrap.py（额外 pip / custom_nodes）。"""
    runtime_id = app.get("runtime", "comfyui")
    python = runtime_python(runtime_venv(runtime_id))
    if not python.is_file():
        raise RuntimeError(f"{runtime_id} 运行环境未就绪，无法准备 {app['id']}")
    script = app_root() / "comfyuiapps" / app["id"] / "bootstrap.py"
    if not script.is_file():
        return
    print(f"[comfy] 准备工作流 {app['id']} 的依赖。", flush=True)
    env = {**os.environ, "PYTHONPATH": str(python_dir()) + os.pathsep + os.environ.get("PYTHONPATH", "")}
    subprocess.run([str(python), str(script), "--app", app["id"]], check=True, env=env, cwd=str(app_root()))


def ensure_engine() -> None:
    """启动/复用 ComfyUI 常驻服务（幂等）；失败只告警，不阻断环境准备。"""
    reg = registry()
    runtime = next((r for r in reg.get("runtimes", []) if r["id"] == "comfyui"), None)
    if runtime is None:
        return
    python = runtime_python(runtime_venv("comfyui"))
    if not python.is_file():
        return
    runner = app_root() / runtime.get("runner", "python/comfyui_runner.py")
    print("[comfy] 正在确保 ComfyUI 引擎就绪。", flush=True)
    process = subprocess.Popen([str(python), str(runner), "serve"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert process.stdout is not None
    for line in process.stdout:
        print(line.rstrip(), flush=True)
    if process.wait() != 0:
        print("[comfy] 警告：ComfyUI 引擎启动失败，可稍后在界面重试。", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default="all", help="定向准备目标：all=全部（缺省） / comfyui=仅运行时 / <appId>=仅该工作流")
    parser.add_argument("--task-log", default="")
    args = parser.parse_args()
    resolve_task_log(args.task_log)
    reg = registry()
    runtimes = reg.get("runtimes", [])
    apps = reg.get("apps", [])

    if args.target == "all":
        selected_runtimes, selected_apps = runtimes, apps
    elif args.target == "comfyui":
        selected_runtimes, selected_apps = [r for r in runtimes if r["id"] == "comfyui"], []
    else:
        app = next((a for a in apps if a["id"] == args.target), None)
        if app is None:
            raise SystemExit(f"unknown prepare target: {args.target}")
        selected_runtimes = [r for r in runtimes if r["id"] == app.get("runtime", "comfyui")]
        selected_apps = [app]

    for runtime in selected_runtimes:
        try:
            prepare_runtime(runtime)
        except Exception as error:  # noqa: BLE001
            print(f"[comfy] 警告：{runtime['id']} 运行环境准备失败（{error}）。", flush=True)
            if args.target != "all":
                raise
    for app in selected_apps:
        try:
            prepare_app(app)
        except Exception as error:  # noqa: BLE001
            print(f"[comfy] 警告：{app['id']} 依赖准备失败（{error}）。", flush=True)
            if args.target != "all":
                raise
    ensure_engine()


if __name__ == "__main__":
    main()
