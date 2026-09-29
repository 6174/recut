"""
[INPUT]: Modal 运行时（modal.Image / modal.Volume）；/models 卷里由 bootstrap.py 下载的 Qwen-Image-2.1 权重（diffusers 布局）
[OUTPUT]: 云端 Modal App「recut-qwen-image-21」：类 QwenImage21 在容器内常驻 QwenImage21Pipeline，提供
          generate_image（文生图，原生 2K，返回 PNG bytes）与 edit_image（图像编辑，接收 1–10 张参考图 bytes，
          返回 PNG bytes）；bootstrap_weights / bootstrap_from_modelscope 把权重下载进 /models 卷。类开启
          GPU memory snapshot（enable_memory_snapshot + enable_gpu_snapshot），把 import/加载/预热挪进
          @modal.enter(snap=True)，后续冷启动直接从快照恢复。镜像设 PYTORCH_CUDA_ALLOC_CONF=expandable_segments
          且加载后开启 VAE 分块解码：Qwen-Image 20B 权重已占约 39GB，L40S(48GB) 上原生 2K 的 VAE 解码会 OOM
[POS]: qwen-image-2.1 预设包的云端执行体；用 @app.cls 以支持 Modal 1.x 的 with_options(gpu=...) 逐档切换 GPU，
       并让 pipeline 在容器内只加载一次；文生图与编辑共用同一个 pipeline（QwenImage21Pipeline 统一两用）
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import inspect
import io
from pathlib import Path

import modal

APP_NAME = "recut-qwen-image-21"
MODELS_VOLUME = "recut-qwen-image-21-models"
MODELS_DIR = "/models"
MARKER = ".recut-download-complete"
HUGGINGFACE_REPO = "Qwen/Qwen-Image-2.1"
MODELSCOPE_REPO = "Qwen/Qwen-Image-2.1"
MAX_REFERENCES = 10

app = modal.App(APP_NAME)

# QwenImage21Pipeline 由 diffusers 随模型 Day-0 提供（见 diffusers PR #14804），故从 git main 安装。
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "torch",
        "torchvision",
        "accelerate",
        "pillow",
        "safetensors",
        "transformers>=5.17",
        "huggingface_hub",
        "sentencepiece",
    )
    .pip_install("git+https://github.com/huggingface/diffusers")
    # 显存碎片是 L40S(48GB) 上原生 2K 解码 OOM 的直接诱因（错误日志亦建议此项）。
    .env({"PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"})
)

models = modal.Volume.from_name(MODELS_VOLUME, create_if_missing=True)

# 下载权重只需轻量镜像（不必拉起 torch/diffusers 运行时）。
bootstrap_image = modal.Image.debian_slim(python_version="3.11").pip_install("huggingface_hub")
modelscope_image = modal.Image.debian_slim(python_version="3.11").pip_install("modelscope")

# Qwen-Image-2.1 原生 2K 推荐尺寸（宽, 高）。
ASPECT_RATIOS = {
    "1:1": (2048, 2048),
    "16:9": (2752, 1536),
    "9:16": (1536, 2752),
    "4:3": (2400, 1792),
    "3:4": (1792, 2400),
    "3:2": (2528, 1696),
    "2:3": (1696, 2528),
}
DEFAULT_SIZE = (2048, 2048)


def _size(aspect_ratio: str) -> tuple[int, int]:
    return ASPECT_RATIOS.get(str(aspect_ratio or ""), DEFAULT_SIZE)


def _generator(seed):
    import torch

    if seed is None or int(seed) < 0:
        return None
    return torch.Generator("cuda").manual_seed(int(seed))


def _png_bytes(pil_image) -> bytes:
    buffer = io.BytesIO()
    pil_image.save(buffer, format="PNG")
    return buffer.getvalue()


def _supported_kwargs(pipe, kwargs: dict) -> dict:
    """按 pipeline __call__ 的签名裁剪参数：不支持的键直接丢弃（如某些版本的 negative_prompt / guidance_scale）。"""
    try:
        params = inspect.signature(pipe.__call__).parameters
    except (TypeError, ValueError):
        return kwargs
    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in params.values()):
        return kwargs
    return {key: value for key, value in kwargs.items() if key in params}


@app.cls(image=image, volumes={MODELS_DIR: models}, gpu="L40S", timeout=1800, max_containers=1,
         enable_memory_snapshot=True, experimental_options={"enable_gpu_snapshot": True})
class QwenImage21:
    @modal.enter(snap=True)
    def load(self):
        import torch
        from diffusers import QwenImage21Pipeline

        self.pipe = QwenImage21Pipeline.from_pretrained(
            MODELS_DIR, dtype=torch.bfloat16
        ).to("cuda")
        # 原生 2K 的 VAE 解码峰值显存很大：分块解码，让 48GB 档（L40S）也能解出 2048×2048。
        self.pipe.vae.enable_tiling()
        # 预热一次前向，把 CUDA/分配器/算子初始化也冻进快照（Modal 官方建议）。
        with torch.inference_mode():
            self.pipe(prompt="warmup", width=512, height=512, num_inference_steps=1)

    def _generate(self, prompt: str, negative_prompt: str, width, height, steps: int,
                  guidance: float, seed: int, image=None) -> dict:
        import torch

        kwargs = {"prompt": prompt, "num_inference_steps": int(steps), "generator": _generator(seed)}
        if width and height:
            kwargs["width"] = int(width)
            kwargs["height"] = int(height)
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
        if guidance is not None:
            kwargs["guidance_scale"] = float(guidance)
        if image is not None:
            kwargs["image"] = image
        with torch.inference_mode():
            result = self.pipe(**_supported_kwargs(self.pipe, kwargs)).images[0]
        return {"kind": "bytes", "data": _png_bytes(result), "mimeType": "image/png",
                "meta": {"width": result.width, "height": result.height, "seed": int(seed), "steps": int(steps)}}

    @modal.method()
    def generate_image(self, prompt: str, negativePrompt: str = "", aspectRatio: str = "1:1",
                       steps: int = 40, guidance: float = 1.0, seed: int = -1, refs=None):
        width, height = _size(aspectRatio)
        return self._generate(prompt, negativePrompt, width, height, steps, guidance, seed)

    @modal.method()
    def edit_image(self, prompt: str, negativePrompt: str = "", steps: int = 40,
                   guidance: float = 1.0, seed: int = -1, refs=None):
        from PIL import Image

        if not refs:
            raise ValueError("图像编辑需要至少一张参考图")
        images = []
        for entry in refs[:MAX_REFERENCES]:
            picture = Image.open(io.BytesIO(entry["data"]))
            picture.load()
            images.append(picture)
        # 输出尺寸跟随参考图，故不传 width/height。
        return self._generate(prompt, negativePrompt, None, None, steps, guidance, seed,
                              image=images[0] if len(images) == 1 else images)


@app.function(image=bootstrap_image, volumes={MODELS_DIR: models}, timeout=7200)
def bootstrap_weights(source: str = "automatic", repo: str = HUGGINGFACE_REPO, revision: str = "main"):
    from huggingface_hub import snapshot_download

    target = Path(MODELS_DIR)
    if (target / MARKER).is_file():
        print("[modal] qwen-image-2.1 权重已存在（完成标记在），跳过下载。", flush=True)
        return {"ready": True, "path": str(target), "skipped": True}
    target.mkdir(parents=True, exist_ok=True)
    print(f"[modal] 从 Hugging Face 下载 {repo} 权重到 {target}…", flush=True)
    snapshot_download(repo_id=repo, revision=revision or None, local_dir=str(target))
    (target / MARKER).write_text("ok", encoding="utf-8")
    models.commit()
    print("[modal] qwen-image-2.1 权重已就绪。", flush=True)
    return {"ready": True, "path": str(target)}


@app.function(image=modelscope_image, volumes={MODELS_DIR: models}, timeout=7200)
def bootstrap_from_modelscope(repo: str = MODELSCOPE_REPO, revision: str = "main"):
    from modelscope import snapshot_download

    target = Path(MODELS_DIR)
    if (target / MARKER).is_file():
        print("[modal] qwen-image-2.1 权重已存在（完成标记在），跳过下载。", flush=True)
        return {"ready": True, "path": str(target), "skipped": True}
    target.mkdir(parents=True, exist_ok=True)
    print(f"[modal] 从 ModelScope 下载 {repo} 权重到 {target}…", flush=True)
    snapshot_download(repo, revision=revision or None, local_dir=str(target))
    (target / MARKER).write_text("ok", encoding="utf-8")
    models.commit()
    print("[modal] qwen-image-2.1 权重已就绪（ModelScope）。", flush=True)
    return {"ready": True, "path": str(target)}
