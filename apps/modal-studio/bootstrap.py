"""
[INPUT]: 平台注入的 RECUT_PYTHON / RECUT_APP_FILES_DIR；python/registry.json（由 publish_registry.py 生成）
[OUTPUT]: 一次性校验：确保注册表存在（缺失时用同一解释器生成）并打印预设包/函数摘要；token 与云端环境在运行时按需处理
[POS]: modal-studio 的主 venv 应用准备器（由平台 ctx.python.prepare 调用）；不做云端部署/权重下载（那是 modal.deploy/modal.install 的职责）
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def app_root() -> Path:
    return Path(__file__).resolve().parent


def main() -> None:
    root = app_root()
    registry_path = root / "python" / "registry.json"
    if not registry_path.is_file():
        print("[modal] 注册表缺失，正在生成 registry.json。", flush=True)
        subprocess.run([sys.executable, str(root / "python" / "publish_registry.py")], check=True)
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print("[modal] 注册表不可读，请重新运行 publish_registry.py。", flush=True)
        return
    apps = registry.get("modalapps", [])
    functions = sum(len(app.get("functions", [])) for app in apps)
    print(f"[modal] Modal 云函数已就绪：{len(apps)} 个预设包、{functions} 个函数。", flush=True)
    print("[modal] 下一步：在界面 Setup 门配置 modal token，然后部署环境并准备权重。", flush=True)


if __name__ == "__main__":
    main()
