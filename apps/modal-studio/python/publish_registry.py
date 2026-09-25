"""
[INPUT]: modalapps/*/manifest.json（每个预设包的单一信息源）
[OUTPUT]: 生成 python/registry.json（modalapps：engine/函数/表单/权重/就绪兜底）与 modalapps/index.json（id 列表）；
          v1 不生成 contributes.media（不接平台）
[POS]: modal-studio 的注册表生成器；运行期只读生成物，人工不再手改 registry.json
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def scan_modalapps() -> list:
    apps = []
    for manifest_path in sorted((ROOT / "modalapps").glob("*/manifest.json")):
        manifest = load_json(manifest_path)
        if not manifest.get("id"):
            raise SystemExit(f"{manifest_path}: modalapp manifest must declare id")
        apps.append(manifest)
    return apps


def registry_function(manifest: dict, function: dict) -> dict:
    return {
        "id": function["id"],
        "label": function.get("name") or function["id"],
        "entrypoint": function.get("entrypoint") or function["id"],
        "invoke": function.get("invoke") or {"mode": "sdk"},
        "output": function.get("output") or {"kind": "image", "mimeType": "image/png", "ext": "png"},
        "formSchema": function.get("formSchema") or [],
        "defaultParams": function.get("defaultParams") or {},
    }


def registry_modalapp(manifest: dict) -> dict:
    engine = manifest.get("engine") or {}
    weights = manifest.get("weights") or {}
    return {
        "id": manifest["id"],
        "label": manifest.get("name") or manifest["id"],
        "capability": manifest.get("capability") or "image.generate",
        "appName": engine.get("appName") or manifest["id"],
        "sourceDir": engine.get("sourceDir") or f"modalapps/{manifest['id']}",
        "origin": "builtin",
        "gpuTiers": engine.get("gpuTiers") or {"default": "T4", "options": []},
        "timeoutSec": engine.get("timeoutSec", 3600),
        "idleTimeoutSec": engine.get("idleTimeoutSec", 60),
        "volumes": engine.get("volumes") or [],
        "secrets": engine.get("secrets") or [],
        "profileId": engine.get("profileId") or "",
        "weights": {
            "bootstrapFunction": weights.get("bootstrapFunction", "bootstrap_weights"),
            "repoHuggingFace": weights.get("repoHuggingFace", ""),
            "repoModelScope": weights.get("repoModelScope", ""),
            "revision": weights.get("revision", ""),
            "sizeGb": weights.get("sizeGb", 0),
            "files": weights.get("files") or [],
        },
        "functions": [registry_function(manifest, function) for function in (manifest.get("functions") or [])],
    }


def main() -> None:
    manifests = scan_modalapps()
    apps = [registry_modalapp(m) for m in manifests]
    dump_json(ROOT / "python" / "registry.json", {"modalapps": apps})
    dump_json(ROOT / "modalapps" / "index.json", [m["id"] for m in manifests])
    print(f"[publish_registry] {len(apps)} modalapp(s) → registry.json / index.json")


if __name__ == "__main__":
    main()
