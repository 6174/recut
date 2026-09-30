"""
[INPUT]: Modal 运行时（modal.Image / modal.Volume / modal.Secret）；/models 卷里由 bootstrap.py 下载的 sd-turbo 权重
[OUTPUT]: 云端 Modal App「recut-sd-turbo」：类 SDTurbo 在容器内常驻 sd-turbo pipeline，提供 generate_image（文生图，
          默认原生尺寸、可经「分辨率」下调短边，返回 PNG bytes）与 generate_image_from_image（图生图，接收参考图
          bytes，返回 PNG bytes；输出尺寸跟随参考图）；bootstrap_weights
           把权重下载进 /models 卷。类开启 GPU memory snapshot（enable_memory_snapshot + enable_gpu_snapshot），
           把 import/加载/首帧预热挪进 @modal.enter(snap=True)，后续冷启动直接从快照恢复
[POS]: sd-turbo 预设包的云端执行体；用 @app.cls 以支持 Modal 1.x 的 with_options(gpu=...) 逐档切换 GPU，
       并让 pipeline 在容器内只加载一次；GPU 快照把「冷启动加载」从每次计费里剔除
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import io
from pathlib import Path

import modal

APP_NAME = "recut-sd-turbo"
MODELS_VOLUME = "recut-sd-turbo-models"
MODELS_DIR = "/models"
MARKER = ".recut-download-complete"

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install("torch", "diffusers", "transformers", "accelerate", "safetensors", "pillow", "huggingface_hub")
)

models = modal.Volume.from_name(MODELS_VOLUME, create_if_missing=True)

# 下载权重只需轻量镜像（不必拉起 torch/diffusers 运行时）。
bootstrap_image = modal.Image.debian_slim(python_version="3.11").pip_install("huggingface_hub")

# sd-turbo 原生尺寸（宽, 高）：512 短边为基准，同画幅下总面积≈262k，故各画幅原生短边并不相等。
ASPECT_RATIOS = {
    "1:1": (512, 512),
    "16:9": (640, 360),
    "9:16": (360, 640),
    "4:3": (576, 432),
    "3:4": (432, 576),
}
DEFAULT_SIZE = (512, 512)
# diffusers 侧要求边长对齐到 8 的倍数（VAE 下采样 8）；用 16 更稳。
SIZE_ALIGN = 16


def _align(value: float) -> int:
    return max(SIZE_ALIGN, int(round(float(value) / SIZE_ALIGN)) * SIZE_ALIGN)


def _size(aspect_ratio: str, resolution=None) -> tuple[int, int]:
    """画幅 + 分辨率 → (宽, 高)。

    `resolution` 是表单「分辨率」（目标短边，px）：非数字或非正数（空串/0/负数）都视为「没给」，
    保持原生尺寸；不小于该画幅的原生短边时同样保持原生（不超分）；否则按画幅比例把短边缩到目标值。
    """
    native = ASPECT_RATIOS.get(str(aspect_ratio or ""), DEFAULT_SIZE)
    try:
        requested = float(resolution)
    except (TypeError, ValueError):
        return native
    if requested <= 0:
        return native
    width, height = native
    target = _align(requested)
    if target >= min(width, height):
        return native
    if width >= height:
        return _align(target * width / height), target
    return target, _align(target * height / width)


def _generator(seed: int):
    import torch

    if seed is None or int(seed) < 0:
        return None
    return torch.Generator("cuda").manual_seed(int(seed))


def _png_bytes(pil_image) -> bytes:
    buffer = io.BytesIO()
    pil_image.save(buffer, format="PNG")
    return buffer.getvalue()


@app.cls(image=image, volumes={MODELS_DIR: models}, gpu="T4", timeout=1800, max_containers=1,
         enable_memory_snapshot=True, experimental_options={"enable_gpu_snapshot": True})
class SDTurbo:
    @modal.enter(snap=True)
    def load(self):
        import torch
        from diffusers import AutoPipelineForText2Image

        self.t2i = AutoPipelineForText2Image.from_pretrained(
            MODELS_DIR, torch_dtype=torch.float16, safety_checker=None
        ).to("cuda")
        self.i2i = None
        # 预热一次前向，把 CUDA/分配器/算子初始化也冻进快照（Modal 官方建议）。
        with torch.inference_mode():
            self.t2i(prompt="warmup", width=64, height=64, num_inference_steps=1,
                     guidance_scale=0.0).images[0]

    def _image2image(self):
        from diffusers import AutoPipelineForImage2Image

        if self.i2i is None:
            # 复用 t2i 的组件，避免重复加载权重。
            self.i2i = AutoPipelineForImage2Image.from_pipe(self.t2i)
        return self.i2i

    @modal.method()
    def generate_image(self, prompt: str, negativePrompt: str = "", aspectRatio: str = "1:1",
                       resolution: str = "", steps: int = 2, guidance: float = 0.0, seed: int = -1, refs=None):
        width, height = _size(aspectRatio, resolution)
        result = self.t2i(prompt=prompt, negative_prompt=negativePrompt or None, width=width, height=height,
                          num_inference_steps=int(steps), guidance_scale=float(guidance),
                          generator=_generator(seed)).images[0]
        return {"kind": "bytes", "data": _png_bytes(result), "mimeType": "image/png",
                "meta": {"width": result.width, "height": result.height, "seed": int(seed), "steps": int(steps)}}

    @modal.method()
    def generate_image_from_image(self, prompt: str, strength: float = 0.6, steps: int = 2, seed: int = -1, refs=None):
        from PIL import Image

        if not refs:
            raise ValueError("图生图需要一个参考图")
        source = Image.open(io.BytesIO(refs[0]["data"])).convert("RGB")
        result = self._image2image()(prompt=prompt, image=source, strength=float(strength),
                                     num_inference_steps=int(steps), guidance_scale=0.0,
                                     generator=_generator(seed)).images[0]
        return {"kind": "bytes", "data": _png_bytes(result), "mimeType": "image/png",
                "meta": {"width": result.width, "height": result.height, "seed": int(seed), "steps": int(steps)}}


@app.function(image=bootstrap_image, volumes={MODELS_DIR: models}, timeout=3600)
def bootstrap_weights(source: str = "automatic", repo: str = "stabilityai/sd-turbo", revision: str = "main"):
    from huggingface_hub import snapshot_download

    target = Path(MODELS_DIR)
    # 幂等短路：已完成过（标记存在）就跳过，不重复下载/校验。
    if (target / MARKER).is_file():
        print("[modal] sd-turbo 权重已存在（完成标记在），跳过下载。", flush=True)
        return {"ready": True, "path": str(target), "skipped": True}
    target.mkdir(parents=True, exist_ok=True)
    print(f"[modal] 从 {repo} 下载 sd-turbo 权重到 {target}…", flush=True)
    snapshot_download(repo_id=repo, revision=revision or None, local_dir=str(target))
    (target / MARKER).write_text("ok", encoding="utf-8")
    models.commit()
    print("[modal] sd-turbo 权重已就绪。", flush=True)
    return {"ready": True, "path": str(target)}
