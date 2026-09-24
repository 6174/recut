"""
[INPUT]: comfyuiapps/*/manifest.json（每个工作流的单一信息源）与 python/runtimes.json（runtime 目录）
[OUTPUT]: 生成 python/registry.json（runtimes + apps）、comfyuiapps/index.json（app id 列表），并同步根
          manifest.json 的 contributes.media.providers[].models（parameters/referenceFields/exposeModel）
[POS]: comfyui-studio 的注册表生成器；运行期只读生成物，人工不再手改 registry.json；构建内置归档前先跑
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


def scan_apps() -> list:
    apps = []
    for manifest_path in sorted((ROOT / "comfyuiapps").glob("*/manifest.json")):
        manifest = load_json(manifest_path)
        if not manifest.get("id"):
            raise SystemExit(f"{manifest_path}: app manifest must declare id")
        apps.append(manifest)
    return apps


def form_parameters(form_schema: list) -> list:
    """非 media 字段 → 平台 MediaParameter 列表。"""
    parameters = []
    for field in form_schema or []:
        kind = field.get("type")
        if kind == "media" or not field.get("key"):
            continue
        param = {"name": field["key"]}
        if kind == "number":
            param["type"] = "number"
            for key in ("default", "min", "max"):
                if field.get(key) is not None:
                    param[key] = field[key]
        elif kind == "boolean":
            param["type"] = "boolean"
            if field.get("default") is not None:
                param["default"] = field["default"]
        elif kind == "select":
            param["type"] = "string"
            param["enum"] = field.get("options") or []
            if field.get("default") is not None:
                param["default"] = field["default"]
        else:
            param["type"] = "string"
            if field.get("default") is not None:
                param["default"] = field["default"]
        parameters.append(param)
    return parameters


def reference_fields(form_schema: list) -> list:
    fields = []
    for field in form_schema or []:
        if field.get("type") != "media" or not field.get("key"):
            continue
        fields.append({"field": field["key"], "role": field.get("kind") or "image", "multiple": bool(field.get("multiple"))})
    return fields


def registry_app(manifest: dict) -> dict:
    weights = manifest.get("weights") or {}
    return {
        "id": manifest["id"],
        "label": manifest.get("name") or manifest["id"],
        "capability": manifest.get("capability") or "image.generate",
        "runtime": manifest.get("runtime") or "comfyui",
        "exposeModel": manifest.get("exposeModel") or "",
        "output": manifest.get("output") or {"kind": "image", "mimeType": "image/png", "ext": "png"},
        "inputModes": manifest.get("inputModes") or ["text"],
        "formSchema": manifest.get("formSchema") or [],
        "defaultParams": manifest.get("defaultParams") or {},
        "weights": {
            "huggingFace": weights.get("huggingFace", ""),
            "modelScope": weights.get("modelScope", ""),
            "revision": weights.get("revision", ""),
            "sizeGb": weights.get("sizeGb", 0),
            "files": weights.get("files") or [],
        },
    }


def contributed_model(manifest: dict) -> dict | None:
    if not manifest.get("exposeModel"):
        return None
    weights = manifest.get("weights") or {}
    model = {
        "id": manifest["exposeModel"],
        "name": manifest.get("name") or manifest["exposeModel"],
        "capability": manifest.get("capability") or "image.generate",
        "runtime": manifest.get("runtime") or "comfyui",
        "sizeGb": weights.get("sizeGb", 0),
        "inputModes": manifest.get("inputModes") or ["text"],
        "parameters": form_parameters(manifest.get("formSchema") or []),
        "referenceFields": reference_fields(manifest.get("formSchema") or []),
        "weights": {
            "huggingFace": weights.get("huggingFace", ""),
            "modelScope": weights.get("modelScope", ""),
            "revision": weights.get("revision", ""),
        },
    }
    if isinstance(manifest.get("name"), dict):
        model["name"] = (manifest["name"].get("zh") or manifest["name"].get("en") or manifest["id"])
        model["localized"] = {loc: {"name": val} for loc, val in manifest["name"].items() if val}
    return model


def main() -> None:
    runtimes = load_json(ROOT / "python" / "runtimes.json").get("runtimes", [])
    manifests = scan_apps()
    apps = [registry_app(m) for m in manifests]

    dump_json(ROOT / "python" / "registry.json", {"runtimes": runtimes, "apps": apps})
    dump_json(ROOT / "comfyuiapps" / "index.json", [m["id"] for m in manifests])

    # 同步 manifest.contributes.media 的 models（保留 provider 身份/operations 的既有声明）。
    manifest_path = ROOT / "manifest.json"
    root = load_json(manifest_path)
    media = ((root.get("contributes") or {}).get("media") or {})
    providers = media.get("providers") or []
    if providers:
        models = [m for m in (contributed_model(manifest) for manifest in manifests) if m]
        providers[0]["models"] = models
        dump_json(manifest_path, root)

    print(f"[publish_registry] {len(apps)} app(s) → registry.json / index.json / contributes.media")


if __name__ == "__main__":
    main()
