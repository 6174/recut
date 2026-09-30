"""
[INPUT]: modalapps/*/manifest.json（每个预设包的单一信息源）
[OUTPUT]: 生成 python/registry.json（modalapps：engine/函数/表单/权重/expose/就绪兜底）与 modalapps/index.json
          （id 列表），并同步根 manifest.json 的 contributes.media.providers[0].models（每个声明 expose 的
          modalapp → 一个平台模型，读取其 expose.function 的表单/权重；inputModes 按 media 字段类型汇总，
          另产出 referenceFields 让平台识别「可锚定参考」的模型，并把预设包声明的 referenceImage 参考图
          归一策略透传给平台模型）
[POS]: modal-studio 的注册表生成器；运行期只读生成物，人工不再手改 registry.json；构建内置归档前先跑
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


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
        "minReferences": function.get("minReferences") or 0,
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
        "expose": manifest.get("expose") or {},
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


def exposed_function(manifest: dict, function_id: str) -> dict:
    functions = manifest.get("functions") or []
    for function in functions:
        if function.get("id") == function_id:
            return function
    raise SystemExit(f"{manifest['id']}: expose.function {function_id!r} is not one of its functions")


# ---------------------- 平台贡献（contributes.media） ----------------------

def output_capability(kind: str) -> str:
    if kind == "video":
        return "video.generate"
    if kind == "audio":
        return "speech.generate"
    return "image.generate"


def form_parameters(form_schema: list) -> list:
    """非 media 字段 → 平台 MediaParameter 列表（与 comfyui-studio 对齐）。"""
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


def input_modes(function: dict) -> list:
    """按 media 字段声明收集输入模态：text + 各参考素材类型（image/video/audio）。"""
    modes = ["text"]
    for field in function.get("formSchema") or []:
        if field.get("type") != "media":
            continue
        mode = field.get("kind") or "image"
        if mode not in modes:
            modes.append(mode)
    return modes


def reference_fields(function: dict) -> list:
    """media 字段 → 平台 referenceFields（field/role/multiple），供平台识别「可锚定参考」的模型。"""
    fields = []
    for field in function.get("formSchema") or []:
        if field.get("type") != "media" or not field.get("key"):
            continue
        fields.append({"field": field["key"], "role": field.get("kind") or "image",
                       "multiple": bool(field.get("multiple"))})
    return fields


def extra_parameters(manifest: dict, declared, existing: list) -> list:
    """按 expose.parameters 显式补充平台模型参数。

    平台模型默认只取 expose.function 的表单（例如 qwen 暴露 image-edit，它没有 resolution），
    但「分辨率」这类只存在于文生图函数的参数也需要在平台侧可选。运行时会按实际命中的函数
    （background.js resolveTarget + coerceParams）裁剪，不适用的参数会被丢弃，因此多补是安全的。
    """
    names = {param.get("name") for param in existing}
    wanted = [name for name in (declared or []) if name and name not in names]
    if not wanted:
        return existing
    available = {}
    for function in manifest.get("functions") or []:
        for param in form_parameters(function.get("formSchema") or []):
            available.setdefault(param["name"], param)
    return existing + [available[name] for name in wanted if name in available]


def contributed_model(manifest: dict) -> dict | None:
    expose = manifest.get("expose") or {}
    model_id = expose.get("model")
    if not model_id:
        return None
    if not MODEL_ID_RE.match(model_id):
        raise SystemExit(f"{manifest['id']}: expose.model {model_id!r} must match {MODEL_ID_RE.pattern}")
    function = exposed_function(manifest, expose.get("function") or (manifest.get("functions") or [{}])[0].get("id"))
    weights = manifest.get("weights") or {}
    name = manifest.get("name")
    label = (name.get("zh") or name.get("en") or model_id) if isinstance(name, dict) else (name or model_id)
    model = {
        "id": model_id,
        "name": label,
        "capability": expose.get("capability") or output_capability((function.get("output") or {}).get("kind", "image")),
        "runtime": "modal",
        "sizeGb": weights.get("sizeGb", 0),
        "inputModes": input_modes(function),
        "parameters": extra_parameters(manifest, expose.get("parameters"), form_parameters(function.get("formSchema") or [])),
        "referenceFields": reference_fields(function),
        "weights": {
            "huggingFace": weights.get("repoHuggingFace", ""),
            "modelScope": weights.get("repoModelScope", ""),
            "revision": weights.get("revision", ""),
        },
    }
    budgets = function.get("referenceBudgets") or []
    if budgets:
        model["referenceBudgets"] = budgets
    # 参考图归一策略由预设包声明（单一信息源），生成器透传给平台模型；缺省时平台按内置上限处理。
    reference_image = manifest.get("referenceImage")
    if reference_image:
        model["referenceImage"] = reference_image
    if isinstance(name, dict):
        model["localized"] = {loc: {"name": val} for loc, val in name.items() if val}
    return model


def main() -> None:
    manifests = scan_modalapps()
    apps = [registry_modalapp(m) for m in manifests]
    dump_json(ROOT / "python" / "registry.json", {"modalapps": apps})
    dump_json(ROOT / "modalapps" / "index.json", [m["id"] for m in manifests])

    # 同步 manifest.contributes.media 的 models（保留 provider 身份/operations/executor 的既有声明）。
    manifest_path = ROOT / "manifest.json"
    root = load_json(manifest_path)
    media = ((root.get("contributes") or {}).get("media") or {})
    providers = media.get("providers") or []
    if providers:
        models = [m for m in (contributed_model(manifest) for manifest in manifests) if m]
        providers[0]["models"] = models
        dump_json(manifest_path, root)

    print(f"[publish_registry] {len(apps)} modalapp(s) → registry.json / index.json / contributes.media")


if __name__ == "__main__":
    main()
