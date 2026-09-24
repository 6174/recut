"""
[INPUT]: 平台注入的 RECUT_APP_FILES_DIR / RECUT_MODELS_DIR / RECUT_PYTHON；comfyuiapps/<id>/manifest.json
          与其 workflow.py / bootstrap.py
[OUTPUT]: 面向 comfyuiapp 作者的稳定 SDK：BuildContext（workflow.py 的 build(ctx) 入参）、BootstrapContext
          （bootstrap.py 的 prepare(ctx) 入参）、load_app/load_workflow（按目录加载 manifest 与 workflow 模块）、
          权重/参考图/画幅/seed 的解析助手与 ComfyUI 节点糖
[POS]: comfyui-studio 的作者契约层；workflow.py 与 bootstrap.py 只依赖本模块，不直接触碰 runner 内部实现
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import time
from pathlib import Path

# 画幅 → 宽高（32 的倍数；默认约 1MP 兼顾速度）。
ASPECT_RATIOS = {
    "1:1": (1024, 1024),
    "16:9": (1280, 704),
    "9:16": (704, 1280),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
}


def app_root() -> Path:
    """comfyui-studio App 根目录（python/ 的父级）。"""
    return Path(__file__).resolve().parent.parent


def apps_dir() -> Path:
    return app_root() / "comfyuiapps"


def models_root() -> Path:
    return Path(os.environ.get("RECUT_MODELS_DIR", Path.home() / ".recut" / "models")) / "comfyui-studio"


def files_root() -> Path:
    return Path(os.environ.get("RECUT_APP_FILES_DIR", "."))


def comfyui_repository() -> Path:
    return models_root() / "comfyui" / "repository"


def comfyui_models_dir() -> Path:
    return comfyui_repository() / "models"


def comfyui_input_dir() -> Path:
    return comfyui_repository() / "input"


def load_app(app_id: str) -> dict:
    """读取 comfyuiapps/<app_id>/manifest.json。"""
    path = apps_dir() / app_id / "manifest.json"
    if not path.is_file():
        raise SystemExit(f"unknown comfyui app: {app_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_workflow(app_id: str):
    """以稳定模块名导入 comfyuiapps/<app_id>/workflow.py（同进程，可用 runtime venv 依赖）。"""
    path = apps_dir() / app_id / "workflow.py"
    if not path.is_file():
        raise SystemExit(f"comfyui app {app_id} has no workflow.py")
    return _load_module(path, f"recut_comfyuiapp_{app_id.replace('-', '_').replace('.', '_')}")


def load_bootstrap(app_id: str):
    path = apps_dir() / app_id / "bootstrap.py"
    if not path.is_file():
        return None
    return _load_module(path, f"recut_comfyuiapp_boot_{app_id.replace('-', '_').replace('.', '_')}")


def weight_roles(manifest: dict) -> dict:
    """manifest.weights.files（role/path 列表）→ {role: 文件名}。"""
    roles: dict[str, str] = {}
    for entry in ((manifest.get("weights") or {}).get("files") or []):
        if isinstance(entry, dict):
            role = str(entry.get("role") or "").strip()
            path = str(entry.get("path") or "").strip()
        else:  # 兼容纯路径写法：用目录名作 role
            path = str(entry or "").strip()
            role = Path(path).parent.name
        if role and path:
            roles[role] = Path(path).name
    return roles


class BuildContext:
    """workflow.py 的 build(ctx) 入参：表单参数 + 权重 + 参考图 + 输出。"""

    def __init__(self, manifest: dict, params: dict, references: list[str], output: str):
        self.manifest = manifest
        self.params = dict(params or {})
        self._weights = weight_roles(manifest)
        self._references = list(references or [])
        self.output = output

    def param(self, key: str, default=None):
        value = self.params.get(key)
        return default if value is None or value == "" else value

    @property
    def weights(self) -> dict:
        return dict(self._weights)

    def weight(self, role: str) -> str:
        name = self._weights.get(role)
        if not name:
            raise SystemExit(f"工作流缺少权重角色：{role}（请检查 manifest.weights.files）")
        return name

    def references(self) -> list[str]:
        return list(self._references)

    def size(self, default=(1024, 1024)) -> tuple[int, int]:
        ratio = str(self.param("aspectRatio", "") or "")
        return ASPECT_RATIOS.get(ratio, default)

    def seed(self) -> int:
        raw = self.params.get("seed")
        if raw is None or raw == "" or str(raw) == "-1":
            return int(time.time()) % (2**31)
        return int(raw)

    def node(self, class_type: str, **inputs) -> dict:
        return {"class_type": class_type, "inputs": inputs}


class BootstrapContext:
    """bootstrap.py 的 prepare(ctx) 入参：runtime venv / ComfyUI 源码 / 权重目录。"""

    def __init__(self, app_id: str, task_log=None):
        self.app_id = app_id
        self.comfyui_dir = comfyui_repository()
        self.models_dir = comfyui_models_dir()
        self.python = os.environ.get("RECUT_PYTHON", "")
        self._task_log = task_log

    def task_log(self, message: str) -> None:
        print(f"[comfy] {message}", flush=True)

    def pip_install(self, requirements: list[str]) -> None:
        if not requirements:
            return
        import sys

        self.task_log(f"安装 {self.app_id} 额外依赖：{' '.join(requirements)}")
        subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", *requirements], check=True)

    def clone_custom_node(self, repository: str, revision: str) -> Path:
        name = repository.rstrip("/").split("/")[-1]
        target = self.comfyui_dir / "custom_nodes" / name
        if not (target / ".git").is_dir():
            target.mkdir(parents=True, exist_ok=True)
            subprocess.run(["git", "-C", str(target), "init", "--quiet"], check=True)
            subprocess.run(["git", "-C", str(target), "remote", "add", "origin", repository], check=True)
        self.task_log(f"拉取 custom node {name}（{(revision or '')[:12]}）")
        subprocess.run(["git", "-C", str(target), "fetch", "--depth", "1", "origin", revision], check=True)
        subprocess.run(["git", "-C", str(target), "checkout", "--force", "FETCH_HEAD"], check=True)
        return target
