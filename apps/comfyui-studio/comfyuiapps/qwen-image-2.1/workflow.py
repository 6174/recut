"""
[INPUT]: comfyui_sdk.BuildContext（表单 params、按 role 解析的权重文件名、已复制的参考图、输出路径）
[OUTPUT]: build(ctx) -> ComfyUI API 格式工作流（文生图；有参考图时切换为编辑模式）；meta(ctx, graph) 回填尺寸/seed
[POS]: qwen-image-2.1 工作流的唯一构建处；纯函数，可单测（不依赖 ComfyUI 服务）
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

from comfyui_sdk import BuildContext


def build(ctx: BuildContext) -> dict:
    unet = ctx.weight("unet")
    clip = ctx.weight("clip")
    vae = ctx.weight("vae")
    width, height = ctx.size(default=(1024, 1024))
    refs = ctx.references()

    graph = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": clip, "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": vae}},
        "4": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["2", 0], "vae": ["3", 0],
            "prompt": ctx.param("prompt", ""), "negative_prompt": ctx.param("negativePrompt", " "),
            "resolution": 1024}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "6": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1], "latent_image": ["5", 0],
            "seed": ctx.seed(), "steps": int(ctx.param("steps", 10)), "cfg": float(ctx.param("cfg", 1.0)),
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0], "filename_prefix": "qwen_image_2.1"}},
    }
    # 编辑模式：把参考图接进 TextEncodeQwenImage21，并用其 latent 输出（按首张参考图尺寸）。
    for index, name in enumerate(refs, start=1):
        node_id = str(100 + index)
        graph[node_id] = {"class_type": "LoadImage", "inputs": {"image": name, "upload": "image"}}
        graph["4"]["inputs"][f"images.image_{index}"] = [node_id, 0]
    if refs:
        graph["6"]["inputs"]["latent_image"] = ["4", 2]
    return graph


def meta(ctx: BuildContext, graph: dict) -> dict:
    width, height = ctx.size(default=(1024, 1024))
    return {"width": width, "height": height, "seed": ctx.seed(), "steps": int(ctx.param("steps", 10))}
