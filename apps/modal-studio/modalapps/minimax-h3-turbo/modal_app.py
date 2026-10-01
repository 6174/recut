"""
[INPUT]: Modal 运行时（modal.Image from lmsysorg/sglang:dev、modal.Volume、modal.Secret recut-hf-token）；
          h3_contract（请求构造与 SGLang 异步视频协议）；/models 卷里由 bootstrap.py 下载的 MiniMax-H3 权重（FL2VA + Ref2VA 分区）
          （与 minimax-h3 / minimax-h3-one 共用同一 recut-minimax-h3-models 卷，避免重复下载）；
          /adapters 卷里由 bootstrap_adapters 下载的 Turbo 少步 LoRA
[OUTPUT]: 云端 Modal App「recut-minimax-h3-turbo」：单卡（默认 RTX PRO 6000 96GB）下两个并列 Modal 类——
          H3Turbo（--model-variant fl2va，服务 t2va/fl2va）：Turbo 少步 LoRA（默认 9 步 / 8 NFE）以
          --lora-merge-mode auto 合并进常驻权重，DiT 在线 fp8（SM100+/SM120 映射 mxfp8）常驻、bf16 文本编码器按组件
          流式 offload；类开启 GPU memory snapshot（enable_memory_snapshot + enable_gpu_snapshot），
          @modal.enter(snap=True) 拉起 sglang 子进程后冻结整棵进程树（含子进程 CUDA 状态），冷启动从快照秒级恢复、
          不再重读权重。前置产物（离线合并等）缺失属**确定性错误**（PrereqError）：_assert_ready 在**方法体**断言
          （错误归属调用、可直接返回本机），start() 捕获 PrereqError 后正常放行，类设 retries=0——三者共同避免
          容器反复重建（Modal 会把 @modal.enter 的异常当容器启动失败反复重试 = crash-loop，空烧 GPU 且错误不落地）。
          H3TurboRef（--model-variant ref2va，服务多模态参考 ref2va）：走 **Ref2VA 专用的
          lightx2v ref2v turbo 8 步 LoRA**（离线合并进 Ref2VA transformer；diffusers 命名 + q/k/v 交织，
          与 FL2VA 那份 larryvrh LoRA 不同源、不可互换）。generate_video 把表单参数 +
          参考素材组装成 SGLang /v1/videos 请求（经 h3_contract，Turbo 默认 9 步，分辨率＝最长边 → 按画幅换算 `target.short_edge`）；
          bootstrap_weights 复用/补下
          FL2VA+Ref2VA 权重，bootstrap_adapters 下两份 Turbo LoRA（fl2va + ref2va）
[POS]: minimax-h3 / minimax-h3-one 的「极速版」并列预设包（三选一）：复用同一权重卷，用少步 LoRA + 合成式 fp8 驻留 +
       快注意力（可选）+ GPU 快照，把「少算步、算得快、起得快」落到 Modal。契约与另外两者完全同构（同一 h3_contract），
       区别只在默认步数与 serve 配方
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import modal

from h3_contract import MODEL_NAME, build_video_body, submit_video, write_reference_conditions

# 固定到 2025.06：1) 避开旧构建器在「本地 Python 与镜像内解释器不一致」时选错 Modal 依赖文件的
# 问题；2) 该版本起 Modal 不再把客户端依赖装进镜像，而是在运行时挂到 /__modal/deps 并由
# sitecustomize 注入 sys.path。sglang:dev 的运行时解释器与镜像构建时的 pip 环境不一致，
# 2024.10 的「镜像内安装」会漏掉 grpclib 等依赖，导致容器启动即 ModuleNotFoundError / crash-loop。
os.environ.setdefault("MODAL_IMAGE_BUILDER_VERSION", "2025.06")
os.environ.setdefault("MODAL_USE_LEGACY_IMAGE_ENTRYPOINT", "0")

APP_NAME = "recut-minimax-h3-turbo"
MODELS_VOLUME = "recut-minimax-h3-models"  # 与 minimax-h3 / minimax-h3-one 共用，权重只下载一次（本包只读使用）
ADAPTERS_VOLUME = "recut-minimax-h3-turbo-adapters"  # 本包专有：Turbo LoRA 适配器
MERGED_VOLUME = "recut-minimax-h3-turbo-merged"  # 本包专有：LoRA 离线合并后的 transformer
OUT_VOLUME = "recut-minimax-h3-turbo-out"
MODELS_DIR = "/models"
ADAPTERS_DIR = "/adapters"
MERGED_DIR = "/merged"
OUT_DIR = "/out"
MODEL_SUBDIR = "MiniMax-H3"
MODEL_VARIANT = "fl2va"  # FL2VA 分区：服务 t2va/fl2va（配 Turbo 少步 LoRA）
REF_VARIANT = "ref2va"  # Ref2VA 分区：服务 ref2va（多模态参考，不配 Turbo LoRA）
PORT = 30010
MARKER = ".recut-download-complete-v2"  # v2 = 增加 Ref2VA 分区；旧卷（仅有 v1 标记）会自动补下
ADAPTER_MARKER = ".recut-adapters-complete"
MERGED_MARKER = ".recut-merge-complete"
REF_DIR = "/tmp/h3-refs"

# —— Turbo 少步配方：LoRA 离线合并进 transformer 权重（运行期 LoRA 在当前 build 上会崩，见下）——
# 为什么离线合并：sglang 会把 GPU 上所有线性层换成 *WithLoRA 包裹层，而 H3 的 MLP forward 无条件读
#   `self.fc2.quant_method`（minimax_h3.py forward → _accepts_mxfp8_input），包裹层没有该属性 →
#   服务在 warmup 阶段 AttributeError 直接启动失败（2026-09-29 真机复现；与是否量化无关）。
# 因此改为在 bootstrap 里把 LoRA 离线合并进权重（W' = W + B@A，LoRA 仓库 README 明示 alpha == rank
# → 无额外缩放），再用 --component-weights-paths.transformer 提供合并后的 transformer：
# 无运行期 LoRA → quant_method 探针正常，且可继续用 --quantization fp8。
# 取舍：作者指出「合并进 bf16 会把较小的 delta 舍入掉，故运行期 LoRA 最锐、合并版 a bit softer」——
# 本包因上游 bug 只能走合并版；等上游修复后切回运行期 LoRA 可拿回最锐结果。
LORA_REPO = "larryvrh/MiniMax-H3-Turbo-Lora"
LORA_FILE = "minimax_h3_turbo_v4_step600_ema.safetensors"  # 作者推荐：v4-600 EMA
LORA_DIRNAME = "MiniMax-H3-Turbo-Lora"
BASE_TRANSFORMER_SUBDIR = "MiniMax-H3/FL2VA/transformer"  # 官方 FL2VA 分片（model-0000N-of-00013 + index + config）
MERGED_SUBDIR = "transformer"  # 合并产物：/merged/transformer
USE_TURBO = True
# Turbo 请求步数＝sigma 网格点数＝去噪次数+1（作者建议 4–8 次去噪 → 网格 5–9）。
DEFAULT_STEPS = 9 if USE_TURBO else 50

# —— Ref2VA 少步（lightx2v）：纯 PEFT LoRA，可走同一套离线合并，但命名体系不同 ——
# 与 FL2VA 用的 larryvrh（native 命名，按名直接匹配）不同，lightx2v 是 **diffusers 命名**且 q/k/v 分开：
#   * 改写：token_refiner.refiner_blocks.*→token_refiner.blocks.*、transformer_blocks.*→blocks.*、
#           attn.to_out.0→attn.out_proj、ff.net.0.proj→mlp.fc1、ff.net.2→mlp.fc2；
#   * q/k/v 需按 head 交织融合进 native 的 attn.qkv_proj；
#   * 缩放 scale = alpha/rank（该仓 alpha=8、rank=128 → 0.0625，**不是** 1.0）。
# 映射与交织直接复用 SGLang 自带实现（build_minimax_h3_pdd_weights 的 _target_of/_interleave_qkv），
# 避免自己重写 qkv 布局——那是只有交织顺序错了才会「静默产出坏权重」的地方。
REF_LORA_REPO = "lightx2v/Minimax-h3-Turbo"
REF_LORA_FILE = "minimax_h3_ref2v_turbo_8step_v1.0_768p_bf16.safetensors"  # 8 NFE → 请求 9 步
REF_LORA_DIRNAME = "Minimax-h3-Turbo"
REF_BASE_TRANSFORMER_SUBDIR = "MiniMax-H3/Ref2VA/transformer"
REF_MERGED_SUBDIR = "ref2va-transformer"
REF_MERGED_MARKER = ".recut-merge-ref2va-complete"
USE_REF_TURBO = True
DEFAULT_REF_STEPS = 9 if USE_REF_TURBO else 50
WARMUP_STEPS = 9  # 预热只求触达同一形状的 kernel/分配器，用较少步数即可（省快照构建时间）

# —— 注意力后端 profile（server-wide，部署期固定）——
# 'fa' 为精确 FlashAttention（一致性基准）；其余为近似（非常量级一致性），启用后须在目标负载上抽检视频与音频。
# 切换方式：改 ATTENTION_BACKEND 一行 + 重新 modal.deploy；镜像会按 profile 的 pip 补装对应内核。
_SAGE_PIP = (
    "python -m pip install --no-cache-dir --force-reinstall "
    '"git+https://github.com/thu-ml/SageAttention.git@d9704247a5139ab4c03bf7fc6b35cc0e2cbb5ea4" '
    "--no-build-isolation"
)
ATTENTION_PROFILES = {
    "fa": {"pip": [], "flags": ["--attention-backend", "fa"]},
    # 量化注意力；Hopper 需装上游 SM90 修复而非 PyPI 2.2.0（此处固定到上游 commit）。
    "sage_attn": {"pip": [_SAGE_PIP], "flags": ["--attention-backend", "sage_attn"]},
    # Sage→Sol 混合：前 10 步走精确、其后走近似（文本编码器保持兼容的 dense 后端）。
    "sol_attn": {
        "pip": [_SAGE_PIP],
        "flags": ["--attention-backend", "sol_attn",
                  "--attention-backend-config", "dense_backend=sage_attn,dense_steps=10",
                  "--component-attention-backends", "text_encoder=torch_sdpa"],
    },
    # 无训练块稀疏（内建，SM90/SM100/SM120）；文本编码器保持 dense。
    "subblock_sparse_attn": {
        "pip": [],
        "flags": ["--attention-backend", "subblock_sparse_attn",
                  "--component-attention-backends", "text_encoder=torch_sdpa",
                  "--attention-backend-config", '{"sparsity": 0.75, "skip_first_steps": 10}'],
    },
}
# 'auto'：按容器实际 GPU 架构自动挑——SM90/SM100/SM120 → 无训练块稀疏 subblock_sparse_attn（SM12.x 上比 fa
# 回退的 torch_sdpa 快，且请求步数 ≤ 其 skip_first_steps 时自动退化为 dense，Turbo 9 步不受近似影响），
# 其余（含 B300/SM103，不在其支持列表）→ 精确 fa。也可显式固定为下面任一后端。
ATTENTION_BACKEND = "auto"

# —— 形状对齐预热（M1）——
# 快照创建时按「目标形状」预热一次，把分配器/算子/首帧成本一起冻进快照，避免首个真实请求付冷形状开销。
WARMUP = True
WARMUP_RESOLUTION = "1344x768"  # target.short_edge=768 与 16:9 对齐后的画布
WARMUP_ASPECT = "16:9"
WARMUP_DURATION_SEC = 4  # 用最短时长预热，够触发同一去噪/解码路径
BENCH_PROMPT = "A cat walking on a sunny beach, gentle waves."

app = modal.App(APP_NAME)


def _resolved_backend() -> str:
    """实际生效的注意力后端：`auto` 时按当前 GPU 架构挑（SM90/SM100/SM120 → 块稀疏；否则精确 fa）。"""
    if ATTENTION_BACKEND != "auto":
        return ATTENTION_BACKEND
    try:
        import torch

        major, minor = torch.cuda.get_device_capability(0)
        if major * 10 + minor in (90, 100, 120):
            return "subblock_sparse_attn"
    except Exception:  # noqa: BLE001
        pass
    return "fa"


def _attention_profile() -> dict:
    return ATTENTION_PROFILES.get(_resolved_backend()) or ATTENTION_PROFILES["fa"]


def _attention_pip() -> list[str]:
    # auto 只会解析到两个 pip-free 后端（fa / subblock_sparse_attn），构建期无需按架构补装内核。
    if ATTENTION_BACKEND == "auto":
        return []
    return list(_attention_profile()["pip"])


def _attention_flags() -> list[str]:
    return list(_attention_profile()["flags"])


# SGLang 官方镜像（含 H3 diffusion 支持）。**不要用 add_python**：它会用新解释器重装镜像内
# 已有 pip 包（含 sglang 依赖），而旧的 aiohttp 在 Python 3.12 下无法从源码编译。改用镜像自带
# 解释器 + run_commands 装 diffusion 额外依赖（并按所选注意力后端补装内核）。
image = (
    modal.Image.from_registry("lmsysorg/sglang:dev")
    .entrypoint([])
    .run_commands(
        'python -m pip install --no-cache-dir -e "/sgl-workspace/sglang/python[diffusion]"',
        "python -m pip install --no-cache-dir huggingface_hub requests",
        *_attention_pip(),
    )
    # Modal 1.0 起本地模块不再 automount；显式把与本地 mock 共用的契约模块带进容器。
    .add_local_python_source("h3_contract")
)

models = modal.Volume.from_name(MODELS_VOLUME, create_if_missing=True)
adapters = modal.Volume.from_name(ADAPTERS_VOLUME, create_if_missing=True)
merged = modal.Volume.from_name(MERGED_VOLUME, create_if_missing=True)
outputs = modal.Volume.from_name(OUT_VOLUME, create_if_missing=True)

# 下载权重只需轻量镜像：不要用 sglang 镜像（冷启动要拉取十几 GB），否则 bootstrap 会卡在拉镜像。
# 但容器导入 modal_app.py 会执行 `from h3_contract import ...`，故这里也要挂同一本地模块，否则
# bootstrap 函数一进容器就 ModuleNotFoundError。
bootstrap_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("huggingface_hub", "requests")
    .add_local_python_source("h3_contract")
)


# ---------------------- SGLang 常驻服务（容器内，单卡） ----------------------


def _turbo_flags(variant: str = MODEL_VARIANT) -> list[str]:
    """两个分区各自的**离线合并** transformer（`--component-weights-paths.transformer`），不用运行期 LoRA。

    合并产物由 `bootstrap_merge` 写进 /merged（与 base 同分片布局、仅权重被改写）：
      * FL2VA（larryvrh turbo 9 步）→ /merged/transformer；
      * Ref2VA（lightx2v ref2v turbo 8 步）→ /merged/ref2va-transformer。
    两者是不同的 LoRA、不同的 base 分区，故各合各的、互不通用。
    """
    if variant == MODEL_VARIANT:
        return ["--component-weights-paths.transformer", f"{MERGED_DIR}/{MERGED_SUBDIR}"] if USE_TURBO else []
    if variant == REF_VARIANT:
        return ["--component-weights-paths.transformer", f"{MERGED_DIR}/{REF_MERGED_SUBDIR}"] if USE_REF_TURBO else []
    return []


def _server_flags(variant: str = MODEL_VARIANT) -> list[str]:
    """单卡 recipe：fp8 只量化 DiT 让其常驻，bf16 文本编码器在 96GB 级单卡上流式 offload。

    单卡才能用 GPU memory snapshot（Modal 不支持多卡快照），故本包只提供单卡档：
    - ≥130GB（H200/B200/B300 单卡）：BF16/FP32 全驻留放得下（DiT 62 + 文本编码器 46 + VAE 10 ≈ 118 GiB），不量化最快；
    - <130GB（RTX PRO 6000 96GB / SM120）：在线 fp8 DiT（≈33 GiB）常驻，文本编码器按组件流式 offload。
    合并后的权重没有 LoRA 包裹层，故 fp8 可与 Turbo 叠加（这正是离线合并要换来的能力）。
    形状预热（--warmup-resolutions）只对 Turbo/fl2va 生效；ref2va 走官方分区、无对应预热曲线。
    """
    import torch

    count = torch.cuda.device_count()
    if count != 1:
        raise RuntimeError(f"minimax-h3-turbo 只支持单卡（GPU 快照限制），检测到 {count} 张 GPU")
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    flags = ["--model-path", f"{MODELS_DIR}/{MODEL_SUBDIR}", "--model-variant", variant,
             "--host", "127.0.0.1", "--port", str(PORT),
             "--num-gpus", "1", "--performance-mode", "speed", "--enable-torch-compile", "false"]
    if vram_gb < 130:
        # 96GB 级单卡：fp8 DiT 常驻，bf16 文本编码器（≈46GB）放不下 → 流式 offload。
        flags += ["--quantization", "fp8", "--layerwise-offload-components", "text_encoder"]
    if WARMUP and variant == MODEL_VARIANT:
        flags += ["--warmup-resolutions", WARMUP_RESOLUTION]
    return flags + _turbo_flags(variant) + _attention_flags()


_SERVER: dict = {"proc": None, "variant": None}
_LOCK = threading.Lock()


def _healthy() -> bool:
    import requests

    for route in ("/health", "/v1/models"):
        try:
            if requests.get(f"http://127.0.0.1:{PORT}{route}", timeout=3).status_code == 200:
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


class PrereqError(RuntimeError):
    """前置产物缺失/不完整（确定性错误）。

    它与「基础设施抖动」不同：重试一百次结果也一样。若在 @modal.enter(snap=True) 里直接抛，
    Modal 会把它当作**容器启动失败**并反复重建容器（crash-loop，每个新容器都重新尝试建快照，
    空烧 GPU，而错误只在容器日志里、任务日志看不到）。因此这类错误单独成类：
    - 容器启动路径（start）捕获它并放行——容器正常起来，让调用拿到清晰的一次性错误；
    - 调用路径（generate_video）先断言它——错误归属于这一次调用，能直接返回给本机。
    """


def _assert_ready(variant: str) -> None:
    """校验该分区所需的**离线产物**是否就绪（缺失时报可执行错误，而非晦涩的 SGLang traceback）。"""
    if variant == MODEL_VARIANT and USE_TURBO and not (Path(MERGED_DIR) / MERGED_SUBDIR / "model.safetensors.index.json").is_file():
        raise PrereqError(
            f"Turbo 合并权重未就绪：请先 modal.install（缺 {MERGED_DIR}/{MERGED_SUBDIR}）——"
            "bootstrap 会先下 LoRA，再离线合并进 transformer。")
    if variant == REF_VARIANT:
        # 旧共享卷只下过 FL2VA，Ref2VA 分区可能残缺；SGLang 会在启动时报晦涩的
        # "missing required component directories"，这里提前给出可执行的修复指引。
        ref_dir = Path(MODELS_DIR) / MODEL_SUBDIR / "Ref2VA"
        missing = [name for name in ("tokenizer", "video_vae", "transformer") if not (ref_dir / name).is_dir()]
        if missing:
            raise PrereqError(
                f"Ref2VA 权重不完整（缺 {ref_dir} 下的 {', '.join(missing)}）：请先 modal.install —— "
                "bootstrap_weights 会补下 Ref2VA 分区（旧卷只含 FL2VA 时会缺这些目录）。")
        if USE_REF_TURBO and not (Path(MERGED_DIR) / REF_MERGED_SUBDIR / "model.safetensors.index.json").is_file():
            raise PrereqError(
                f"Ref2VA 合并权重未就绪：请先 modal.install（缺 {MERGED_DIR}/{REF_MERGED_SUBDIR}）——"
                "bootstrap 会下 lightx2v Ref2VA turbo LoRA 并离线合并进 Ref2VA transformer。")


def _ensure_server(variant: str = MODEL_VARIANT) -> None:
    """幂等：复用本容器内已在监听且**分区一致**的 SGLang 服务；否则启动并等待就绪。

    分区不同（fl2va ↔ ref2va）时不能复用，因为一个 SGLang 进程只加载一个 checkpoint 分区。
    前置产物缺失是确定性错误（PrereqError）——调用方（方法体）应先断言；这里也校验一次，
    以便容器在快照恢复后仍能在调用时给出清晰原因。
    """
    _assert_ready(variant)
    proc = _SERVER.get("proc")
    if proc is not None and proc.poll() is None and _SERVER.get("variant") == variant and _healthy():
        return
    with _LOCK:
        proc = _SERVER.get("proc")
        if proc is not None and proc.poll() is None and _SERVER.get("variant") == variant and _healthy():
            return
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()
        command = ["sglang", "serve", *_server_flags(variant)]
        label = ("Turbo 少步配方（离线合并）" if USE_TURBO else "base 配方") if variant == MODEL_VARIANT else "Ref2VA 参考配方"
        print(f"[modal] 启动 SGLang 服务（{label}，variant={variant}）：" + " ".join(command), flush=True)
        env = {**os.environ, "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True", "PYTHONUNBUFFERED": "1"}
        proc = subprocess.Popen(command, stdout=sys.stdout, stderr=subprocess.STDOUT, env=env)
        _SERVER["proc"] = proc
        _SERVER["variant"] = variant
        deadline = time.time() + 3000
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"SGLang 服务退出（code {proc.returncode}）")
            if _healthy():
                print("[modal] SGLang 服务已就绪。", flush=True)
                return
            time.sleep(5)
        raise RuntimeError("SGLang 服务启动超时")


def _warmup_png() -> bytes:
    """合成一张占位参考图（预热只求触发同一形状的参考编码/去噪路径，不关心内容）。"""
    try:
        import io

        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (512, 512), (128, 128, 128)).save(buffer, format="PNG")
        return buffer.getvalue()
    except Exception:  # noqa: BLE001
        import base64

        return base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


def _warmup_refs(variant: str) -> list:
    """预热用的参考素材：fl2va 无参考（→ task t2va）；ref2va 需 ≥1 个参考，故补一张占位图（→ task ref2va）。"""
    if variant != REF_VARIANT:
        return []
    return [{"field": "referenceImages", "name": "warmup.png", "mimeType": "image/png", "data": _warmup_png()}]


def _warmup(variant: str = MODEL_VARIANT) -> None:
    """按目标形状预热一次（结果会随快照被冻结）。后端不可用 / 预热失败会在此暴露。

    ref2va 分区走官方 Ref2VA 权重、请求必须带参考素材，故用 `_warmup_refs` 合成占位参考，确保预热真的命中
    ref2va 路径（否则会被 partition 拒绝，白预热）。
    """
    print(f"[modal] 形状预热（{variant} · {WARMUP_RESOLUTION}，{WARMUP_DURATION_SEC}s，{WARMUP_STEPS} 步，"
          f"backend={_resolved_backend()}）…", flush=True)
    conditions = write_reference_conditions(_warmup_refs(variant), REF_DIR)
    body = build_video_body(BENCH_PROMPT, aspect_ratio=WARMUP_ASPECT, duration_sec=WARMUP_DURATION_SEC,
                            steps=WARMUP_STEPS, seed=1000, conditions=conditions)
    started = time.time()
    submit_video(f"http://127.0.0.1:{PORT}", body, log=None)
    print(f"[modal] 预热完成（{round(time.time() - started, 1)}s）。", flush=True)


def _run_video(variant: str, prompt: str, aspect_ratio: str, duration_sec: float,
               steps: int, seed: int, refs, resolution: str = "") -> dict:
    """共享执行体：确保对应分区的服务在跑，组装请求、提交并落地 mp4。

    `resolution` 是表单「分辨率」（目标**最长边**，px）；空值/越界由契约层按画幅换算成短边并归一
    （不超分，H3 原生 768p）。
    注意：单卡快照只按 1344×768（WARMUP_RESOLUTION）做了形状预热，换到更小的画幅时首个请求要多付一次
    分配器增长成本（结果不变）。
    """
    _ensure_server(variant)
    conditions = write_reference_conditions(refs or [], REF_DIR)
    body = build_video_body(prompt, aspect_ratio=aspect_ratio, duration_sec=duration_sec,
                            steps=steps, seed=seed, conditions=conditions, resolution=resolution)
    print(f"[modal] 提交 H3 {body['task']}（{body['seconds']}s，{body['target']['aspect_ratio']}，"
          f"最长边 {resolution or '原生'} → 短边 {body['target']['short_edge']}，"
          f"{body['num_inference_steps']} steps，seed {body['seed']}，{len(conditions)} 条件）…", flush=True)
    started = time.time()
    data = submit_video(f"http://127.0.0.1:{PORT}", body, log=print)
    key = f"runs/{uuid.uuid4().hex}.mp4"
    path = Path(OUT_DIR) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    outputs.commit()
    print(f"[modal] 已生成 {key}（{round(time.time() - started, 1)}s）。", flush=True)
    return {"kind": "file", "volume": OUT_VOLUME, "key": key, "mimeType": "video/mp4",
            "meta": {"durationSec": float(duration_sec), "fps": 24, "seed": body["seed"],
                     "steps": int(steps), "audio": True, "task": body["task"]}}


def _sample_vram(stop: threading.Event, samples: list) -> None:
    """尽力采样 nvidia-smi 的 used 显存（近似峰值）；容器无 nvidia-smi 时静默退出。"""
    while not stop.is_set():
        try:
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                text=True, stderr=subprocess.DEVNULL)
            samples.append(int(out.strip().splitlines()[0]))
        except Exception:  # noqa: BLE001
            return
        stop.wait(0.5)


@app.cls(image=image, gpu="RTX-PRO-6000",
         volumes={MODELS_DIR: models, ADAPTERS_DIR: adapters, MERGED_DIR: merged, OUT_DIR: outputs},
         timeout=3600, max_containers=1, memory=262144,  # 单卡流式/驻留需较大 host RAM
         retries=0,  # 确定性失败只报一次：容器起不来时不要反复重建（crash-loop 会空烧 GPU）
         enable_memory_snapshot=True, experimental_options={"enable_gpu_snapshot": True})
class H3Turbo:
    """FL2VA 分区 + Turbo 少步 LoRA（离线合并）：服务 t2va（文生视频+音频）与 fl2va（首/尾帧生视频+音频）。"""

    @modal.enter(snap=True)
    def start(self):
        """拉起 SGLang 常驻服务（用离线合并后的 Turbo transformer），并把整棵进程树（含 sglang 子进程的
        CUDA 状态）冻进 GPU memory snapshot；快照创建时执行一次，之后冷启动直接从快照恢复、不再重读权重。

        前置产物缺失（PrereqError）**不放行到容器启动失败**：容器要能正常起来，错误在调用时一次性报出；
        否则 Modal 会把确定性错误当作容器启动失败反复重建（crash-loop）。
        """
        try:
            _ensure_server(MODEL_VARIANT)
        except PrereqError as error:
            print(f"[modal] 启动前置未满足（调用时会再次校验并报错）：{error}", flush=True)
            return
        if WARMUP:
            _warmup(MODEL_VARIANT)

    @modal.exit()
    def stop(self):
        proc = _SERVER.get("proc")
        if proc is not None and proc.poll() is None:
            proc.terminate()

    @modal.method()
    def generate_video(self, prompt: str, aspectRatio: str = "auto", durationSec: float = 5,
                       steps: int = DEFAULT_STEPS, seed: int = -1, resolution: str = "", refs=None):
        # 调用级断言：前置缺失时错误归属于这一次调用（可直接返回本机），而不是容器启动失败。
        _assert_ready(MODEL_VARIANT)
        return _run_video(MODEL_VARIANT, prompt, aspectRatio, durationSec, steps, seed, refs, resolution)

    @modal.method()
    def bench(self, prompt: str = BENCH_PROMPT, aspectRatio: str = WARMUP_ASPECT,
              durationSec: float = 5, steps: int = DEFAULT_STEPS, runs: int = 3):
        """M1 实测入口：按目标形状跑 runs 次，返回每次时延与近似峰值显存。

        用法：`modal run bench.py --gpu <tier> --runs 3`（切换后端＝改 ATTENTION_BACKEND 后重新 deploy）。
        """
        import statistics

        import torch

        _ensure_server(MODEL_VARIANT)
        stop = threading.Event()
        samples: list = []
        threading.Thread(target=_sample_vram, args=(stop, samples), daemon=True).start()
        seconds = []
        try:
            for index in range(int(runs)):
                body = build_video_body(prompt, aspect_ratio=aspectRatio, duration_sec=durationSec,
                                        steps=steps, seed=1000 + index, conditions=[])
                started = time.time()
                submit_video(f"http://127.0.0.1:{PORT}", body, log=None)
                elapsed = round(time.time() - started, 2)
                seconds.append(elapsed)
                print(f"[modal] bench {index + 1}/{runs}：{elapsed}s", flush=True)
        finally:
            stop.set()
        return {"app": APP_NAME, "attentionBackend": ATTENTION_BACKEND, "gpu": torch.cuda.get_device_name(0),
                "resolution": WARMUP_RESOLUTION, "aspectRatio": aspectRatio,
                "durationSec": float(durationSec), "steps": int(steps), "runs": int(runs),
                "seconds": seconds, "medianSec": round(statistics.median(seconds), 2) if seconds else None,
                "peakVramGb": round(max(samples) / 1024, 2) if samples else None}


@app.cls(image=image, gpu="RTX-PRO-6000",
         volumes={MODELS_DIR: models, MERGED_DIR: merged, OUT_DIR: outputs},
         timeout=3600, max_containers=1, memory=262144,
         retries=0,  # 确定性失败只报一次：容器起不来时不要反复重建（crash-loop 会空烧 GPU）
         enable_memory_snapshot=True, experimental_options={"enable_gpu_snapshot": True})
class H3TurboRef:
    """Ref2VA 分区：服务 ref2va（多模态参考生视频+音频），并要求至少一个参考素材。

    走 **Ref2VA 专用的 lightx2v turbo 8 步 LoRA**（离线合并进 Ref2VA transformer → `/merged/ref2va-transformer`）。
    它不是 FL2VA 那份 larryvrh LoRA——两者 base 分区与覆盖面都不同——且是 diffusers 命名、需把 q/k/v 交织进
    `attn.qkv_proj`（见 `_merge_ref2va`）。合并后请求 9 步（8 NFE）。另保留单卡 GPU 快照、fp8 DiT 驻留与形状预热。
    """

    @modal.enter(snap=True)
    def start(self):
        """前置产物缺失（PrereqError）不放行到容器启动失败——否则 Modal 会反复重建容器（crash-loop）。"""
        try:
            _ensure_server(REF_VARIANT)
        except PrereqError as error:
            print(f"[modal] 启动前置未满足（调用时会再次校验并报错）：{error}", flush=True)
            return
        if WARMUP:
            # best-effort：占位参考若被分区拒绝，也不该拖垮整个 ref2va 服务。
            try:
                _warmup(REF_VARIANT)
            except Exception as error:  # noqa: BLE001
                print(f"[modal] Ref2VA 形状预热失败（忽略，服务仍可用）：{error}", flush=True)

    @modal.exit()
    def stop(self):
        proc = _SERVER.get("proc")
        if proc is not None and proc.poll() is None:
            proc.terminate()

    @modal.method()
    def generate_video(self, prompt: str, aspectRatio: str = "auto", durationSec: float = 5,
                       steps: int = DEFAULT_REF_STEPS, seed: int = -1, resolution: str = "", refs=None):
        if not (refs or []):
            raise ValueError("reference-to-video 需要至少一个参考素材（图像/视频/音频）")
        # 调用级断言：前置缺失时错误归属于这一次调用（可直接返回本机），而不是容器启动失败。
        _assert_ready(REF_VARIANT)
        return _run_video(REF_VARIANT, prompt, aspectRatio, durationSec, steps, seed, refs, resolution)


@app.function(image=bootstrap_image, volumes={MODELS_DIR: models}, timeout=7200,
              secrets=[modal.Secret.from_name("recut-hf-token")])
def bootstrap_weights(source: str = "automatic", repo: str = MODEL_NAME, revision: str = "main", patterns: str = ""):
    """把 H3 权重（FL2VA + Ref2VA 两个分区）下载进 /models 卷（与 minimax-h3 / minimax-h3-one 共用同一卷）。

    若共享卷已有完成标记（由 minimax-h3 下好），直接短路——不联网、不需要 token，实现「复用不重下」。
    否则用同一套断点续传逻辑补下（H3 两个分区共约 270GB 且为 HF gated）。
    """
    import os

    target = Path(MODELS_DIR) / MODEL_SUBDIR
    # 幂等短路：曾完成全量下载（标记存在）且未请求子集时直接跳过——不联网、不需要 token。
    if not (patterns or "").strip() and (Path(MODELS_DIR) / MARKER).is_file():
        print("[modal] H3 权重已存在（共享卷标记在），复用、跳过下载。", flush=True)
        return {"ready": True, "path": str(target), "skipped": True}

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or ""
    if not token:
        raise RuntimeError("缺少 HF token：请先 modal.secret.set { name: 'recut-hf-token', values: { HF_TOKEN } }")
    allow = [p.strip() for p in (patterns or "").split(",") if p.strip()] or ["model_index.json", "FL2VA/*", "Ref2VA/*"]
    target.mkdir(parents=True, exist_ok=True)
    pinned, files = _list_files(repo, revision, allow)
    if not files:
        raise RuntimeError(f"{repo} 没有匹配的文件（FL2VA/Ref2VA）")
    total = sum(size for _, size, _ in files)
    print(f"[modal] H3 待下载 {len(files)} 个文件，共 {_human(total)}（pinned {pinned[:12]}）…", flush=True)
    for index, (path, size, url) in enumerate(files, start=1):
        changed = _download_resumable(url, target / path, size, token, models)
        print(f"[modal] [{index}/{len(files)}] {path} · {_human(size)} · {'下载完成' if changed else '已存在'}", flush=True)
    if not (patterns or "").strip():
        (Path(MODELS_DIR) / MARKER).write_text("ok", encoding="utf-8")
    models.commit()
    print("[modal] H3 权重（FL2VA + Ref2VA）已就绪。", flush=True)
    return {"ready": True, "path": str(target), "files": len(files), "revision": pinned}


@app.function(image=bootstrap_image, volumes={ADAPTERS_DIR: adapters}, timeout=1800)
def bootstrap_adapters(repo: str = LORA_REPO, filename: str = LORA_FILE, revision: str = "main"):
    """把两份少步 LoRA 下载进 /adapters 卷（各约 1GB，公开仓库，无需 token）。

    - FL2VA：larryvrh turbo（native 命名）；
    - Ref2VA：lightx2v ref2v turbo 8 步（diffusers 命名，见文件头注释）。
    幂等：文件已存在则短路。下游 `bootstrap_merge` 会分别离线合并进对应分区的 transformer。
    """
    from huggingface_hub import hf_hub_download

    downloaded = []
    for each_repo, each_file in ((repo, filename), (REF_LORA_REPO, REF_LORA_FILE)):
        target = Path(ADAPTERS_DIR) / each_repo.split("/")[-1]
        dest = target / each_file
        if dest.is_file() and dest.stat().st_size > 0:
            print(f"[modal] LoRA 已存在，跳过下载：{each_repo}/{each_file}", flush=True)
        else:
            target.mkdir(parents=True, exist_ok=True)
            print(f"[modal] 下载 LoRA {each_repo}/{each_file} → {target}…", flush=True)
            hf_hub_download(repo_id=each_repo, filename=each_file, revision=revision or None, local_dir=str(target))
        downloaded.append(str(dest))
    (Path(ADAPTERS_DIR) / ADAPTER_MARKER).write_text("ok", encoding="utf-8")
    adapters.commit()
    print("[modal] 两份少步 LoRA 已就绪。", flush=True)
    return {"ready": True, "paths": downloaded}


def _copy_companions(base_dir: Path, out_dir: Path) -> None:
    """原样复制 index 与 config，保证合并产物与 base 同结构。"""
    for extra in sorted(base_dir.glob("*.json")):
        (out_dir / extra.name).write_text(extra.read_text(encoding="utf-8"), encoding="utf-8")


def _write_merged_shards(base_dir: Path, out_dir: Path, marker: Path, label: str, apply) -> int:
    """按 base 的分片流式写出合并结果；`apply(name, weight)` 返回新张量，None 表示原样透传。"""
    import json

    from safetensors import safe_open
    from safetensors.torch import save_file

    index_path = base_dir / "model.safetensors.index.json"
    weight_map = json.loads(index_path.read_text(encoding="utf-8"))["weight_map"]
    by_file: dict = {}
    for tensor_name, file_name in weight_map.items():
        by_file.setdefault(file_name, []).append(tensor_name)
    out_dir.mkdir(parents=True, exist_ok=True)
    merged_count = 0
    for file_name in sorted(by_file):
        tensors = {}
        with safe_open(str(base_dir / file_name), framework="pt", device="cpu") as handle:
            for tensor_name in by_file[file_name]:
                weight = handle.get_tensor(tensor_name)
                updated = apply(tensor_name, weight)
                tensors[tensor_name] = weight if updated is None else updated
                if updated is not None:
                    merged_count += 1
        save_file(tensors, str(out_dir / file_name), metadata={"format": "pt"})
        merged.commit()
        print(f"[modal] {label} {file_name} 已写出。", flush=True)
    _copy_companions(base_dir, out_dir)
    marker.write_text("ok", encoding="utf-8")
    merged.commit()
    return merged_count


def _merge_fl2va(filename: str) -> dict:
    """FL2VA（larryvrh，native 命名）：`W' = W + B@A`（该仓 alpha == rank → 无额外缩放）。"""
    import torch
    from safetensors import safe_open

    base_dir = Path(MODELS_DIR) / BASE_TRANSFORMER_SUBDIR
    out_dir = Path(MERGED_DIR) / MERGED_SUBDIR
    marker = Path(MERGED_DIR) / MERGED_MARKER
    if marker.is_file() and (out_dir / "model.safetensors.index.json").is_file():
        print("[modal] FL2VA 合并权重已存在，跳过。", flush=True)
        return {"ready": True, "path": str(out_dir), "skipped": True}
    lora_path = Path(ADAPTERS_DIR) / LORA_DIRNAME / filename
    if not lora_path.is_file():
        raise RuntimeError(f"缺 FL2VA LoRA：{lora_path}（请先跑 bootstrap_adapters）")

    pairs: dict = {}  # base 张量名 -> (down, up)，延迟到逐分片时再乘（省内存）
    with safe_open(str(lora_path), framework="pt", device="cpu") as handle:
        names = sorted({key.rsplit(".lora_", 1)[0] for key in handle.keys() if ".lora_" in key})
        for name in names:
            try:
                pairs[name + ".weight"] = (handle.get_tensor(name + ".lora_A.weight").to(torch.float32),
                                           handle.get_tensor(name + ".lora_B.weight").to(torch.float32))
            except Exception as error:  # noqa: BLE001
                raise RuntimeError(f"LoRA 键不完整：{name}（{error}）") from error
    print(f"[modal] FL2VA LoRA 覆盖 {len(pairs)} 个权重张量。", flush=True)

    def apply(name: str, weight):
        pair = pairs.get(name)
        if pair is None:
            return None
        down, up = pair
        return (weight.to(torch.float32) + up @ down).to(weight.dtype)

    count = _write_merged_shards(base_dir, out_dir, marker, "FL2VA", apply)
    if count != len(pairs):
        raise RuntimeError(f"FL2VA 合并不完整：{count}/{len(pairs)} 个 delta 未命中 base，勿使用该产物")
    print(f"[modal] FL2VA 合并完成：{count} 个张量 → {out_dir}", flush=True)
    return {"ready": True, "path": str(out_dir), "merged": count}


def _merge_ref2va() -> dict:
    """Ref2VA（lightx2v，diffusers 命名）：映射改写 + q/k/v 交织进 `attn.qkv_proj`，`scale = alpha/rank`。

    映射与交织复用 SGLang 自带实现（`build_minimax_h3_pdd_weights._target_of` / `_interleave_qkv`），
    保证与官方 PDD 合并路径同一套语义；命中数不符即抛错（宁可失败也不要静默产出坏权重）。
    """
    import torch
    from safetensors import safe_open

    from sglang.multimodal_gen.tools.build_minimax_h3_pdd_weights import _interleave_qkv, _target_of

    base_dir = Path(MODELS_DIR) / REF_BASE_TRANSFORMER_SUBDIR
    out_dir = Path(MERGED_DIR) / REF_MERGED_SUBDIR
    marker = Path(MERGED_DIR) / REF_MERGED_MARKER
    if marker.is_file() and (out_dir / "model.safetensors.index.json").is_file():
        print("[modal] Ref2VA 合并权重已存在，跳过。", flush=True)
        return {"ready": True, "path": str(out_dir), "skipped": True}
    lora_path = Path(ADAPTERS_DIR) / REF_LORA_DIRNAME / REF_LORA_FILE
    if not lora_path.is_file():
        raise RuntimeError(f"缺 Ref2VA LoRA：{lora_path}（请先跑 bootstrap_adapters）")

    downs, ups, meta = {}, {}, {}
    with safe_open(str(lora_path), framework="pt", device="cpu") as handle:
        meta = handle.metadata() or {}
        for key in handle.keys():
            if key.endswith(".lora_A.default.weight"):
                downs[key[: -len(".lora_A.default.weight")]] = handle.get_tensor(key).to(torch.float32)
            elif key.endswith(".lora_B.default.weight"):
                ups[key[: -len(".lora_B.default.weight")]] = handle.get_tensor(key).to(torch.float32)
    if not downs:
        raise RuntimeError(f"{lora_path} 不像 lightx2v LoRA（没有 .lora_A.default.weight 键）")
    rank = int(next(iter(downs.values())).shape[0])  # 从形状取 rank，不依赖 metadata
    alpha = float(meta.get("alpha", rank))
    scale = alpha / rank
    print(f"[modal] Ref2VA LoRA：{len(downs)} 个模块，rank={rank} alpha={alpha} scale={scale}", flush=True)

    pairs, qkv = {}, {}
    for module, down in downs.items():
        up = ups.get(module)
        if up is None:
            raise RuntimeError(f"LoRA 键不完整：{module}")
        target = _target_of(module)
        if target is None:
            raise RuntimeError(f"diffusers→native 无映射规则：{module}")
        for role in ("to_q", "to_k", "to_v"):
            if target.endswith(f".attn.{role}"):
                qkv.setdefault(target[: -len(f".attn.{role}")], {})[role[-1]] = (down, up)
                break
        else:
            pairs[target + ".weight"] = (down, up)
    fused = {}
    for prefix, parts in qkv.items():
        if set(parts) != {"q", "k", "v"}:
            raise RuntimeError(f"{prefix} 缺 q/k/v 之一：{sorted(parts)}")
        fused[prefix + ".attn.qkv_proj.weight"] = parts
    expected = len(pairs) + len(fused)
    print(f"[modal] Ref2VA 映射：{len(pairs)} 直连 + {len(fused)} 组 qkv = {expected} 个 native 目标", flush=True)

    def apply(name: str, weight):
        pair = pairs.get(name)
        if pair is not None:
            down, up = pair
            return (weight.to(torch.float32) + (up @ down) * scale).to(weight.dtype)
        parts = fused.get(name)
        if parts is None:
            return None
        q, k, v = (parts[role][1] @ parts[role][0] for role in ("q", "k", "v"))
        return (weight.to(torch.float32) + _interleave_qkv(q, k, v) * scale).to(weight.dtype)

    count = _write_merged_shards(base_dir, out_dir, marker, "Ref2VA", apply)
    if count != expected:
        raise RuntimeError(f"Ref2VA 合并不完整：{count}/{expected} 个 delta 未命中 base（映射有误，勿使用该产物）")
    print(f"[modal] Ref2VA 合并完成：{count} 个张量 → {out_dir}", flush=True)
    return {"ready": True, "path": str(out_dir), "merged": count}


@app.function(image=image, volumes={MODELS_DIR: models, ADAPTERS_DIR: adapters, MERGED_DIR: merged},
              timeout=7200, memory=65536)  # CPU 流式：逐分片处理，峰值 ≈ 一个输出分片 + LoRA delta
def bootstrap_merge(repo: str = LORA_REPO, filename: str = LORA_FILE, revision: str = "main"):
    """把两份少步 LoRA **离线合并**进各自分区的 transformer，写进 /merged（纯 CPU，无需 GPU）。

    - FL2VA（larryvrh，native 命名）→ `/merged/transformer`；
    - Ref2VA（lightx2v ref2v 8 步，diffusers 命名）→ `/merged/ref2va-transformer`。

    各自按 base 分片逐张量流式处理（其余原样透传），产物与 base 同布局（分片 + index + config），
    serve 用 `--component-weights-paths.transformer <dir>`；幂等（各有完成标记即跳过）。
    合并会把较小的 delta 折进 bf16 而损失一点精度（运行期 LoRA 最锐、合并版 a bit softer）——
    之所以走合并，是因为当前 sglang build 的运行期 LoRA 会让服务启动即崩（见文件头注释）。
    """
    result = {"fl2va": _merge_fl2va(filename)}
    if USE_REF_TURBO:
        result["ref2va"] = _merge_ref2va()
    return {"ready": True, **result}


def _matches(name: str, allow: list) -> bool:
    import fnmatch

    if not allow:
        return True
    return any(fnmatch.fnmatch(name, pattern) for pattern in allow)


def _list_files(repo: str, revision: str, allow: list) -> tuple:
    from huggingface_hub import hf_hub_url, repo_info

    info = repo_info(repo, revision=revision or None, files_metadata=True)
    pinned = info.sha
    files = []
    for sibling in info.siblings:
        path = sibling.rfilename
        if path == ".gitattributes" or not _matches(path, allow):
            continue
        files.append((path, sibling.size or 0, hf_hub_url(repo, path, revision=pinned)))
    return pinned, files


def _human(size: int) -> str:
    value = float(size or 0)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024 or unit == "TiB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} TiB"


def _download_resumable(url: str, dest: Path, expected: int, token: str, volume, attempts: int = 12) -> bool:
    """单文件断点续传：`.part` + HTTP Range；每 10 分钟 commit 一次卷。返回是否实际下载。"""
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    if dest.is_file() and (not expected or dest.stat().st_size == expected):
        return False
    if not part.exists() and dest.is_file():
        dest.replace(part)
    auth = {"Authorization": f"Bearer {token}"} if token else {}
    last_commit = time.time()
    for attempt in range(1, attempts + 1):
        done = part.stat().st_size if part.exists() else 0
        if expected and done >= expected:
            break
        headers = dict(auth)
        if done:
            headers["Range"] = f"bytes={done}-"
        try:
            with requests.get(url, headers=headers, stream=True, timeout=(10, 60)) as response:
                if response.status_code == 416:
                    break
                response.raise_for_status()
                mode = "ab" if (done and response.status_code == 206) else "wb"
                with part.open(mode) as sink:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        sink.write(chunk)
                        if time.time() - last_commit > 600:
                            sink.flush()
                            volume.commit()
                            last_commit = time.time()
        except (requests.RequestException, OSError) as error:
            if attempt >= attempts:
                raise RuntimeError(f"{dest.name} 下载失败（重试 {attempts} 次）：{error}") from error
            print(f"[modal] {dest.name} 中断（{error}），从 {_human(part.stat().st_size if part.exists() else 0)} 续传（{attempt}/{attempts}）。", flush=True)
            time.sleep(min(2 ** attempt, 60))
            continue
        break
    if expected and (not part.exists() or part.stat().st_size != expected):
        raise RuntimeError(f"{dest.name} 下载不完整（{part.stat().st_size if part.exists() else 0}/{expected} 字节），重跑可续传")
    part.replace(dest)
    volume.commit()
    return True
