"""
[INPUT]: comfyui_sdk.BuildContext（表单 params、按 role 解析的权重文件名、已复制的输入图、输出路径）
[OUTPUT]: build(ctx) -> ComfyUI API 格式工作流（Depth Anything 3 单目深度图）；meta(ctx, graph) 回填分辨率/输出模式
[POS]: depth-anything-3 工作流的唯一构建处；纯函数，可单测（不依赖 ComfyUI 服务）
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

from comfyui_sdk import BuildContext


def build(ctx: BuildContext) -> dict:
    refs = ctx.references()
    if not refs:
        raise SystemExit("depth-anything-3 需要一张输入图（请在「输入图」中选择素材）。")

    model = ctx.weight("model")
    resolution = int(ctx.param("resolution", 504))
    render = ctx.param("render", "depth_colored")
    normalization = ctx.param("normalization", "v2_style")

    return {
        "1": {"class_type": "LoadDA3Model", "inputs": {"model_name": model, "weight_dtype": "default"}},
        "2": {"class_type": "LoadImage", "inputs": {"image": refs[0], "upload": "image"}},
        "3": {"class_type": "DA3Inference", "inputs": {
            "da3_model": ["1", 0], "image": ["2", 0], "resolution": resolution,
            "resize_method": "upper_bound_resize", "mode": {"mode": "mono"}}},
        "4": {"class_type": "DA3Render", "inputs": {
            "da3_geometry": ["3", 0],
            "output": {"output": render, "normalization": normalization, "apply_sky_clip": False}}},
        "5": {"class_type": "SaveImage", "inputs": {"images": ["4", 0], "filename_prefix": "da3_depth"}},
    }


def meta(ctx: BuildContext, graph: dict) -> dict:
    return {"resolution": int(ctx.param("resolution", 504)), "render": ctx.param("render", "depth_colored")}
