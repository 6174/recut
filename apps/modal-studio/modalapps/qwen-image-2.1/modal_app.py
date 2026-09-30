"""
[INPUT]: Modal 运行时（modal.Image / modal.Volume）；/models 卷里由 bootstrap.py 下载的 Qwen-Image-2.1 权重（diffusers 布局）
[OUTPUT]: 云端 Modal App「recut-qwen-image-21」：类 QwenImage21 在容器内常驻 QwenImage21Pipeline，提供
          generate_image（文生图，默认原生 2K、可经「分辨率」下调最长边，返回 PNG bytes）与 edit_image（图像编辑，
          接收 1–10 张参考图 bytes，默认输出尺寸跟随参考图、可用「画幅 + 分辨率」覆盖，返回 PNG bytes）；
          bootstrap_weights / bootstrap_from_modelscope 把权重下载进
          /models 卷。类开启
          GPU memory snapshot（enable_memory_snapshot + enable_gpu_snapshot），把 import/加载/预热挪进
          @modal.enter(snap=True)，后续冷启动直接从快照恢复。镜像设 PYTORCH_CUDA_ALLOC_CONF=expandable_segments，
          VAE 分块解码只在输出较大时开启（原生 2K 在 L40S(48GB) 上不分块会 OOM）：分块会在块边界留下拼缝/色斑，
          常用尺寸一律整图解码，不为了 2K 让基础画质一直打折。
          另打印环境/精度/pipeline 接受参数，并在每次调用打印实际下发与被丢弃的参数、以及采样期数值警告——
          与本地 ComfyUI（int8 权重、整图 VAE 解码、resolution-conditioned 文本编码）对比出图差异时的事实依据
[POS]: qwen-image-2.1 预设包的云端执行体；用 @app.cls 以支持 Modal 1.x 的 with_options(gpu=...) 逐档切换 GPU，
       并让 pipeline 在容器内只加载一次；文生图与编辑共用同一个 pipeline（QwenImage21Pipeline 统一两用）
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import inspect
import io
import warnings
from pathlib import Path

import modal

APP_NAME = "recut-qwen-image-21"
MODELS_VOLUME = "recut-qwen-image-21-models"
MODELS_DIR = "/models"
MARKER = ".recut-download-complete"
HUGGINGFACE_REPO = "Qwen/Qwen-Image-2.1"
MODELSCOPE_REPO = "Qwen/Qwen-Image-2.1"
MAX_REFERENCES = 10
# VAE 分块解码的启用阈值（输出最长边）：≥ 该值才分块（原生 2K 在 L40S(48GB) 上不分块会 OOM）；
# 常用尺寸整图解码，避免块边界的拼缝/色斑——不为 2K 让基础画质一直打折。
TILING_MIN_SIDE = 1536

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

# Qwen-Image-2.1 原生 2K 推荐尺寸（宽, 高）：同画幅下总面积≈4.2MP，故「2K」是面积档而非固定短边。
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
# diffusers 侧要求边长对齐到 16 的倍数（VAE 下采样 8 × transformer patch 2）。
SIZE_ALIGN = 16


def _align(value: float) -> int:
    return max(SIZE_ALIGN, int(round(float(value) / SIZE_ALIGN)) * SIZE_ALIGN)


def _size(aspect_ratio: str, resolution=None) -> tuple[int, int]:
    """画幅 + 分辨率 → (宽, 高)。

    `resolution` 是表单「分辨率」（目标**最长边**，px）：非数字或非正数（空串/0/负数）都视为「没给」，
    保持原生 2K；不小于该画幅的原生最长边时同样保持原生（不超分）；否则按画幅比例把最长边缩到目标值
    ——短边随之下降，抽卡更快也更省额度。基准取「最长边」而不是短边：宽画幅（如 21:9）按短边放大时
    长边会被撑到远超目标，那正是爆显存的来源。
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
    if target >= max(width, height):
        return native
    if width >= height:
        return target, _align(target * height / width)
    return _align(target * width / height), target


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
        import diffusers
        import torch
        import transformers
        from diffusers import QwenImage21Pipeline

        self.pipe = QwenImage21Pipeline.from_pretrained(
            MODELS_DIR, dtype=torch.bfloat16
        ).to("cuda")
        self._log_environment(diffusers, torch, transformers)
        # 预热一次前向，把 CUDA/分配器/算子初始化也冻进快照（Modal 官方建议）。
        # 步数必须 ≥2：1 步时 flow-match 的时间步 shift 会退化（除零 → NaN），warmup 产物虽被丢弃，
        # 但日志会刷 invalid value 警告，掩盖真实问题。
        with torch.inference_mode():
            self.pipe(prompt="warmup", width=512, height=512, num_inference_steps=2)

    def _log_environment(self, diffusers, torch, transformers) -> None:
        """一次性打印环境/精度/可用参数：与本地 ComfyUI（int8 权重、整图 VAE 解码）对比出图差异时的事实依据。"""
        def dtype_of(name):
            module = getattr(self.pipe, name, None)
            return getattr(module, "dtype", "?")

        try:
            accepted = list(inspect.signature(self.pipe.__call__).parameters)
        except (TypeError, ValueError):
            accepted = []
        print(
            f"[modal] 环境 torch={torch.__version__} diffusers={diffusers.__version__} "
            f"transformers={transformers.__version__} | transformer={dtype_of('transformer')} "
            f"vae={dtype_of('vae')} text_encoder={dtype_of('text_encoder')} "
            f"scheduler={type(self.pipe.scheduler).__name__}",
            flush=True,
        )
        print(f"[modal] pipeline 接受参数：{accepted}", flush=True)

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
        # 分块解码只在输出大到 48GB 装不下时才开：分块会在块边界留下拼缝/色斑，
        # 常用尺寸整图解码才和本地 ComfyUI 的 VAEDecode 一致。
        use_tiling = bool(width and height and max(int(width), int(height)) >= TILING_MIN_SIDE)
        if getattr(self.pipe.vae, "use_tiling", None) != use_tiling:
            self.pipe.vae.enable_tiling(use_tiling)
        effective = _supported_kwargs(self.pipe, kwargs)
        dropped = sorted(set(kwargs) - set(effective))
        if dropped:
            print(f"[modal] 注意：当前 pipeline 不接受这些参数，已静默丢弃 → {dropped}", flush=True)
        print(f"[modal] 采样参数：{ {k: v for k, v in effective.items() if k != 'generator'} } seed={seed} "
              f"vae_tiling={use_tiling}", flush=True)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            with torch.inference_mode():
                result = self.pipe(**effective).images[0]
        numeric = sorted({str(item.message) for item in caught if issubclass(item.category, RuntimeWarning)})
        if numeric:
            print(f"[modal] 采样期数值警告（可能已写进像素）：{numeric}", flush=True)
        return {"kind": "bytes", "data": _png_bytes(result), "mimeType": "image/png",
                "meta": {"width": result.width, "height": result.height, "seed": int(seed), "steps": int(steps)}}

    @modal.method()
    def generate_image(self, prompt: str, negativePrompt: str = "", aspectRatio: str = "1:1",
                       resolution: str = "", steps: int = 40, guidance: float = 1.0, seed: int = -1, refs=None):
        width, height = _size(aspectRatio, resolution)
        return self._generate(prompt, negativePrompt, width, height, steps, guidance, seed)

    @modal.method()
    def edit_image(self, prompt: str, negativePrompt: str = "", aspectRatio: str = "",
                   resolution: str = "", steps: int = 40, guidance: float = 1.0, seed: int = -1, refs=None):
        from PIL import Image

        if not refs:
            raise ValueError("图像编辑需要至少一张参考图")
        images = []
        for entry in refs[:MAX_REFERENCES]:
            picture = Image.open(io.BytesIO(entry["data"]))
            picture.load()
            images.append(picture)
        # 画幅留空 → 输出尺寸跟随参考图（不传 width/height）；显式给定画幅 → 按画幅 + 分辨率出图。
        width, height = _size(aspectRatio, resolution) if str(aspectRatio or "").strip() else (None, None)
        return self._generate(prompt, negativePrompt, width, height, steps, guidance, seed,
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
