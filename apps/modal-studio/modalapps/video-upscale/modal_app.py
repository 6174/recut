"""
[INPUT]: Modal 运行时（两个镜像：SeedVR2 = cuda-devel + torch/flash_attn/apex + /opt/seedvr 源码；FlashVSR = cuda-devel +
         diffsynth + Block-Sparse-Attention + /opt/flashvsr 源码）；/models 卷（bootstrap.py 下载的 SeedVR2-7B 与 FlashVSR v1.1）；
         参考视频（runner 传 refs=[{name,mimeType,data}]，这里取第一段 video/*）
[OUTPUT]: 云端 Modal App「recut-video-upscale」——**一个入口、两档**：SeedVR2Upscaler.upscale（质量档，SeedVR2-7B 官方
          inference_seedvr2_7b.py，默认单卡 sp_size=1）与 FlashVSRUpscaler.upscale_fast（快速档，FlashVSR v1.1 官方脚本）；
          两者都把结果写进 /out 卷并按需把源音轨原样 copy 回封装；bootstrap_weights 把两套权重下进 /models（各写完成标记）
[POS]: video-upscale 预设包的云端执行体；两档共用一次 deploy、各自独立的类与镜像——质量与快速互不干扰，
       但都经同一入口（一个预设包 = 一个切换单位）。逐产物就绪（seedvr2 / flashvsr）由 manifest 的 artifacts/requires 声明
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

import modal

os.environ.setdefault("MODAL_IMAGE_BUILDER_VERSION", "2025.06")

APP_NAME = "recut-video-upscale"
MODELS_VOLUME = "recut-video-upscale-models"
OUT_VOLUME = "recut-video-upscale-out"
MODELS_DIR, OUT_DIR = "/models", "/out"

# 两个上游工程各自 clone 在镜像里；权重走卷，运行时用符号链接把仓库「默认查找路径」接到卷上
# （SeedVR2 文档约定 ckpts/，FlashVSR 脚本约定 examples/WanVSR/FlashVSR-v1.1/），因此不用改上游脚本的路径常量。
SEEDVR_DIR = "/opt/seedvr"
FLASHVSR_DIR = "/opt/flashvsr"
SEEDVR_WEIGHTS = "seedvr2-7b"
FLASHVSR_WEIGHTS = "flashvsr-v1.1"

SEEDVR_MARKER = ".recut-seedvr2-complete"
FLASHVSR_MARKER = ".recut-flashvsr-complete"
DOWNLOAD_MARKER = ".recut-download-complete"

SEEDVR_SCRIPT = "projects/inference_seedvr2_7b.py"
# FlashVSR 官方推理脚本按「档位」分文件（tiny = 小条件解码器；full = 完整解码器），v1.1 是推荐版本。
FLASHVSR_SCRIPTS = {
    "tiny": "examples/WanVSR/infer_flashvsr_v1.1_tiny.py",
    "full": "examples/WanVSR/infer_flashvsr_v1.1_full.py",
}
# Block-Sparse-Attention 编译目标架构：A100(8.0) / H200(9.0)。换别的卡要改这里并重新 deploy。
FLASHVSR_CUDA_ARCH = "8.0;9.0"
ALIGN = 16

app = modal.App(APP_NAME)

# ---------------------- 镜像 ----------------------

# SeedVR2 需要从源码编译 flash_attn 与 apex（官方 Quick Start 要求），故用带 nvcc 的 cuda-devel 基座 + 官方验证的 py3.10/torch2.4.0。
seedvr_image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.10")
    .apt_install("git", "ffmpeg", "build-essential")
    .pip_install("torch==2.4.0", "torchvision==0.19.0", "einops", "huggingface_hub", "requests",
                 "opencv-python-headless", "av", "numpy", "pillow", "safetensors", "transformers")
    .run_commands(
        f"git clone --depth 1 https://github.com/ByteDance-Seed/SeedVR.git {SEEDVR_DIR}",
        f"pip install -r {SEEDVR_DIR}/requirements.txt",
        "pip install flash_attn==2.5.9.post1 --no-build-isolation",
        # apex 源码编译很脆；官方提供与 py3.10/torch2.4.0 匹配的预编译 whl。
        "pip install https://huggingface.co/ByteDance-Seed/SeedVR2-3B/resolve/main/"
        "apex-0.1-cp310-cp310-linux_x86_64.whl",
    )
)

# FlashVSR 依赖 diffsynth（pip -e .）与 mit-han-lab/Block-Sparse-Attention（需 nvcc 现场编译），同样用 cuda-devel 基座。
flashvsr_image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git", "ffmpeg", "build-essential")
    .pip_install("packaging", "ninja")
    .run_commands(
        f"git clone --depth 1 https://github.com/OpenImagingLab/FlashVSR.git {FLASHVSR_DIR}",
        f"pip install -e {FLASHVSR_DIR}",
        f"pip install -r {FLASHVSR_DIR}/requirements.txt",
        "git clone --depth 1 https://github.com/mit-han-lab/Block-Sparse-Attention.git /opt/block-sparse-attention",
        f"cd /opt/block-sparse-attention && TORCH_CUDA_ARCH_LIST='{FLASHVSR_CUDA_ARCH}' python setup.py install",
    )
)

models = modal.Volume.from_name(MODELS_VOLUME, create_if_missing=True)
outputs = modal.Volume.from_name(OUT_VOLUME, create_if_missing=True)

# 下载权重只需轻量镜像（不必拉起 torch/编译链）。
bootstrap_image = modal.Image.debian_slim(python_version="3.11").pip_install("huggingface_hub", "modelscope")


class PrereqError(RuntimeError):
    """前置产物缺失（确定性错误）：应指向「先 modal.install 哪个函数所需产物」，而不是让容器空烧。"""


# ---------------------- 共用工具 ----------------------

def _pick_video(refs) -> dict:
    source = next((ref for ref in (refs or []) if str(ref.get("mimeType") or "").startswith("video/")), None)
    if source is None or source.get("data") is None:
        raise ValueError("需要一个视频参考素材（video/*）")
    return source


def _ready(marker: str, label: str, function: str) -> bool:
    return (Path(MODELS_DIR) / marker).is_file()


def _assert_ready(marker: str, label: str, function: str) -> None:
    if not _ready(marker, label, function):
        raise PrereqError(
            f"{label} 权重未就绪（卷根缺标记 {marker}）：请先 `modal.install {{ modalapp: 'video-upscale' }}`"
            f"（bootstrap_weights 会把权重写进 {MODELS_VOLUME}）。")


def _align(value: float) -> int:
    return max(ALIGN, int(round(float(value) / ALIGN)) * ALIGN)


def _ffprobe_size(path: Path) -> tuple:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True).stdout.strip()
    width, height = out.splitlines()[0].split(",")[:2]
    return int(width), int(height)


def _target_size(width: int, height: int, target) -> tuple:
    """输出最长边 → (宽, 高)，保持画幅；`source`/非正数表示不放大，只按对齐规整。"""
    try:
        requested = int(str(target))
    except (TypeError, ValueError):
        return _align(width), _align(height)
    if requested <= max(width, height):
        return _align(width), _align(height)
    if width >= height:
        return _align(requested), _align(requested * height / width)
    return _align(requested * width / height), _align(requested)


def _run(command: list, cwd: str) -> None:
    """跑上游推理命令并把输出实时转发到容器日志（App 侧 `modal app logs --follow` 可见）。"""
    print(f"[modal] $ {' '.join(command)}", flush=True)
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"}
    proc = subprocess.Popen(command, cwd=cwd, stdout=sys.stdout, stderr=subprocess.STDOUT, env=env)
    if proc.wait() != 0:
        raise RuntimeError(f"上游推理失败（exit {proc.returncode}）：{' '.join(command)}")


def _first_mp4(directory: Path) -> Path:
    found = sorted(directory.rglob("*.mp4"))
    if not found:
        raise RuntimeError(f"上游推理未产出 mp4：{directory}")
    return found[0]


def _deliver(produced: Path, source_bytes: bytes, keep_audio: bool, meta: dict) -> dict:
    """把产物落到 /out 卷；keep_audio 时把源音轨用 ffmpeg 原样 copy 回封装（不重编码音频）。"""
    key = f"runs/{uuid.uuid4().hex}.mp4"
    dest = Path(OUT_DIR) / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    audio = "none"
    if keep_audio:
        with tempfile.NamedTemporaryFile(suffix=".src.mp4", delete=False) as handle:
            handle.write(source_bytes)
            source_path = handle.name
        try:
            proc = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(produced), "-i", source_path,
                 "-map", "0:v:0", "-map", "1:a?", "-c:v", "copy", "-c:a", "copy", "-shortest", str(dest)],
                capture_output=True, text=True)
            if proc.returncode == 0:
                audio = "copied"
            else:  # 源没有音轨或编码不兼容：退回纯视频，别让交付失败
                print(f"[modal] 合成音轨失败，退回无音轨输出：{proc.stderr.strip()}", flush=True)
        finally:
            Path(source_path).unlink(missing_ok=True)
    if audio != "copied":
        shutil.copy(produced, dest)
    outputs.commit()
    print(f"[modal] 已生成 {key}（音轨 {audio}）。", flush=True)
    return {"kind": "file", "volume": OUT_VOLUME, "key": key, "mimeType": "video/mp4",
            "meta": {**meta, "audio": audio == "copied"}}


# ---------------------- 质量档：SeedVR2-7B ----------------------

@app.cls(image=seedvr_image, gpu="H200",
         volumes={MODELS_DIR: models, OUT_DIR: outputs},
         timeout=7200, max_containers=1, memory=262144,
         retries=0)  # 确定性失败只报一次，避免 crash-loop 空烧 GPU
class SeedVR2Upscaler:
    """SeedVR2-7B（一步扩散）：把「仓库默认 ckpts/」接到 /models 卷，官方脚本零改动运行。"""

    @modal.enter()
    def start(self):
        link = Path(SEEDVR_DIR) / "ckpts"
        target = Path(MODELS_DIR) / SEEDVR_WEIGHTS
        try:
            if not link.exists() and target.is_dir():
                link.symlink_to(target)
        except OSError as error:  # noqa: BLE001 — 链接失败不影响调用（调用时会再断言就绪）
            print(f"[modal] 建立 ckpts 链接失败（忽略）：{error}", flush=True)
        if not _ready(SEEDVR_MARKER, "SeedVR2-7B", "upscale"):
            print(f"[modal] SeedVR2-7B 未就绪（缺 {SEEDVR_MARKER}）：调用时会报可执行错误。", flush=True)

    @modal.method()
    def upscale(self, targetLongEdge: str = "1920", seed: int = -1, keepAudio: bool = True, refs=None):
        source = _pick_video(refs)
        _assert_ready(SEEDVR_MARKER, "SeedVR2-7B", "upscale")
        with tempfile.TemporaryDirectory() as work:
            workdir = Path(work)
            in_dir = workdir / "in"
            in_dir.mkdir()
            in_path = in_dir / "input.mp4"
            in_path.write_bytes(bytes(source["data"]))
            out_dir = workdir / "out"
            out_dir.mkdir()
            width, height = _ffprobe_size(in_path)
            res_w, res_h = _target_size(width, height, targetLongEdge)
            _run(["torchrun", "--nproc-per-node=1", str(Path(SEEDVR_DIR) / SEEDVR_SCRIPT),
                  "--video_path", str(in_dir), "--output_dir", str(out_dir),
                  "--seed", str(int(seed)), "--res_h", str(res_h), "--res_w", str(res_w), "--sp_size", "1"],
                 cwd=SEEDVR_DIR)
            produced = _first_mp4(out_dir)
            return _deliver(produced, bytes(source["data"]), bool(keepAudio), {
                "model": "SeedVR2-7B", "seed": int(seed), "targetLongEdge": str(targetLongEdge),
                "sourceWidth": width, "sourceHeight": height, "width": res_w, "height": res_h})


# ---------------------- 快速档：FlashVSR v1.1 ----------------------

# FlashVSR 官方脚本把输入/输出路径写成模块级常量，没有 CLI 参数。这里把「脚本里那几个常量」按名替换到副本上再跑；
# 上游改版导致某个锚点失配时**明确报错并指名文件**（而不是静默跑出错误结果）——首次真机 deploy 需按 README 核对一次。
FLASHVSR_IO_PATCHES = [
    (r"(?m)^(\s*(?:input_video|input_path|video_path|src_video|input_video_path)\s*=\s*)(['\"]).*?\2",
     r"\g<1>\"{input}\""),
    (r"(?m)^(\s*(?:output_path|output_dir|save_path|out_dir|output_video_path)\s*=\s*)(['\"]).*?\2",
     r"\g<1>\"{output}\""),
]


def _flashvsr_script(script: str, input_path: Path, output_dir: Path) -> Path:
    """把上游脚本的输入/输出常量指向本次任务，写到临时目录的副本（不动仓库原件）。"""
    import re

    origin = Path(FLASHVSR_DIR) / script
    text = origin.read_text(encoding="utf-8")
    for pattern, replacement in FLASHVSR_IO_PATCHES:
        text, hits = re.subn(pattern, replacement.format(input=input_path, output=output_dir), text)
        if hits == 0:
            raise PrereqError(
                f"FlashVSR 脚本锚点失配（{pattern}）于 {origin}：上游可能改了输入/输出常量名。"
                "请核对 pinned revision 后更新 modal_app.FLASHVSR_IO_PATCHES。")
    patched = Path(tempfile.mkdtemp()) / Path(script).name
    patched.write_text(text, encoding="utf-8")
    return patched


@app.cls(image=flashvsr_image, gpu="A100-80GB",
         volumes={MODELS_DIR: models, OUT_DIR: outputs},
         timeout=7200, max_containers=1, memory=262144,
         retries=0)
class FlashVSRUpscaler:
    """FlashVSR v1.1（一步流式 4×）：把脚本约定的权重目录接到 /models 卷。"""

    @modal.enter()
    def start(self):
        repo_dir = Path(FLASHVSR_DIR) / "examples" / "WanVSR"
        target = Path(MODELS_DIR) / FLASHVSR_WEIGHTS
        link = repo_dir / "FlashVSR-v1.1"
        try:
            if not link.exists() and target.is_dir():
                link.symlink_to(target)
        except OSError as error:  # noqa: BLE001
            print(f"[modal] 建立 FlashVSR 权重链接失败（忽略）：{error}", flush=True)
        if not _ready(FLASHVSR_MARKER, "FlashVSR v1.1", "upscale-fast"):
            print(f"[modal] FlashVSR 未就绪（缺 {FLASHVSR_MARKER}）：调用时会报可执行错误。", flush=True)

    @modal.method()
    def upscale_fast(self, mode: str = "tiny", keepAudio: bool = True, refs=None):
        source = _pick_video(refs)
        _assert_ready(FLASHVSR_MARKER, "FlashVSR v1.1", "upscale-fast")
        script = FLASHVSR_SCRIPTS.get(str(mode) or "tiny", FLASHVSR_SCRIPTS["tiny"])
        with tempfile.TemporaryDirectory() as work:
            workdir = Path(work)
            in_path = workdir / "input.mp4"
            in_path.write_bytes(bytes(source["data"]))
            out_dir = workdir / "out"
            out_dir.mkdir()
            patched = _flashvsr_script(script, in_path, out_dir)
            _run(["python", str(patched)], cwd=str(Path(FLASHVSR_DIR) / "examples" / "WanVSR"))
            produced = _first_mp4(out_dir)
            width, height = _ffprobe_size(in_path)
            return _deliver(produced, bytes(source["data"]), bool(keepAudio), {
                "model": "FlashVSR-v1.1", "mode": str(mode), "scale": 4,
                "sourceWidth": width, "sourceHeight": height})


# ---------------------- bootstrap（权重 → 卷） ----------------------

@app.function(image=bootstrap_image, volumes={MODELS_DIR: models}, timeout=7200)
def bootstrap_weights(source: str = "automatic", revision: str = "main"):
    """把两套权重下进 /models：SeedVR2-7B 与 FlashVSR v1.1；各自幂等短路并写完成标记。"""
    from huggingface_hub import snapshot_download

    root = Path(MODELS_DIR)
    root.mkdir(parents=True, exist_ok=True)

    def _download(repo: str, dest: Path, patterns, marker: str, label: str) -> bool:
        if marker.is_file():
            print(f"[modal] {label} 已存在（{marker.name}），跳过下载。", flush=True)
            return False
        dest.mkdir(parents=True, exist_ok=True)
        print(f"[modal] 下载 {label}（{repo}）→ {dest}…", flush=True)
        snapshot_download(repo_id=repo, revision=revision or None, local_dir=str(dest),
                          allow_patterns=patterns, resume_download=True)
        marker.write_text("ok", encoding="utf-8")
        models.commit()
        print(f"[modal] {label} 已就绪。", flush=True)
        return True

    if source == "modelscope":
        from modelscope import snapshot_download as ms_download

        if not (root / SEEDVR_MARKER).is_file():
            dest = root / SEEDVR_WEIGHTS
            dest.mkdir(parents=True, exist_ok=True)
            print(f"[modal] 从 ModelScope 下载 SeedVR2-7B → {dest}…", flush=True)
            ms_download("ByteDance-Seed/SeedVR2-7B", revision=revision or None, local_dir=str(dest))
            (root / SEEDVR_MARKER).write_text("ok", encoding="utf-8")
            models.commit()
    else:
        _download("ByteDance-Seed/SeedVR2-7B", root / SEEDVR_WEIGHTS,
                  ["*.json", "*.safetensors", "*.pth", "*.bin", "*.py", "*.md", "*.txt"],
                  root / SEEDVR_MARKER, "SeedVR2-7B")

    # FlashVSR 只发布在 Hugging Face（4 个文件），ModelScope 无镜像。
    _download("JunhaoZhuang/FlashVSR-v1.1", root / FLASHVSR_WEIGHTS, None,
              root / FLASHVSR_MARKER, "FlashVSR v1.1")

    # 基础权重完成标记（让 volumeReady 的兜底语义也成立）。
    (root / DOWNLOAD_MARKER).write_text("ok", encoding="utf-8")
    models.commit()
    return {"ready": True, "path": str(root)}
