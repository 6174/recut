"""
[INPUT]: 平台注入的 RECUT_MODELS_DIR / RECUT_PYTHON / RECUT_VENV 与标准库子进程/git 能力；--target 定向准备
         （all/comfyui）与 --task-log 任务日志文件
[OUTPUT]: 为每个 runtime 创建与主 venv 隔离的专属 venv（从 RECUT_VENV 派生 <name>-<runtime>）、按固定 commit
          浅克隆其源码仓库（ComfyUI）、安装锁定依赖并自检；不下载模型权重（权重下载是 gen.install 的职责）
[POS]: gen-studio 的跨平台 runtime 运行环境准备器；主 venv 只保留轻量调度/下载依赖，torch/ComfyUI 等重依赖
       各自独立 venv，避免依赖互相覆盖
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
    msg = line[len("[gen] "):] if line.startswith("[gen] ") else line
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


def registry() -> dict:
    return json.loads((app_root() / "python" / "registry.json").read_text(encoding="utf-8"))


def models_root() -> Path:
    return Path(os.environ.get("RECUT_MODELS_DIR", Path.home() / ".recut" / "models")) / "gen-studio"


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
    print(f"[gen] 正在拉取 {runtime['id']} 源码（{revision[:12]}）。", flush=True)
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
        print(f"[gen] 正在创建 {runtime_id} 专属运行环境。", flush=True)
        subprocess.run([base_python, "-m", "venv", str(venv)], check=True)
    requirements = app_root() / runtime.get("requirements", "")
    fingerprint = ""
    marker = venv / REQUIREMENTS_MARKER
    if requirements.is_file():
        fingerprint = requirements_fingerprint(requirements)
        if marker.is_file() and marker.read_text(encoding="utf-8").strip() == fingerprint:
            print(f"[gen] {runtime_id} 依赖锁定未变化，跳过重装。", flush=True)
        else:
            print(f"[gen] 正在安装 {runtime_id} 锁定依赖（首次会下载 torch 等较大组件）。", flush=True)
            subprocess.run([str(target), "-m", "pip", "install", "--disable-pip-version-check", "--requirement", str(requirements)], check=True)
    print(f"[gen] 正在验证 {runtime_id} 依赖闭包。", flush=True)
    subprocess.run([str(target), "-m", "pip", "check"], check=True)
    runner = app_root() / runtime.get("runner", f"python/{runtime_id}_runner.py")
    subprocess.run([str(target), str(runner), "status"], check=True)
    if fingerprint:
        marker.write_text(fingerprint, encoding="utf-8")
    print(f"[gen] {runtime_id} 专属运行环境已就绪。", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["all", "comfyui"], default="all", help="定向准备目标：all=全部 runtime（缺省） / comfyui=仅 comfyui")
    parser.add_argument("--task-log", default="")
    args = parser.parse_args()
    resolve_task_log(args.task_log)
    reg = registry()
    runtimes = reg.get("runtimes", [])
    if args.target != "all":
        runtimes = [r for r in runtimes if r["id"] == args.target]
    for runtime in runtimes:
        try:
            prepare_runtime(runtime)
        except Exception as error:  # noqa: BLE001
            print(f"[gen] 警告：{runtime['id']} 运行环境准备失败（{error}）。", flush=True)
            if args.target != "all":
                raise


if __name__ == "__main__":
    main()
