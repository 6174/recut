"""
[INPUT]: Modal 运行时（modal.Image from lmsysorg/sglang:dev、modal.Volume、modal.Secret recut-hf-token）；
          h3_contract（请求构造与 SGLang 异步视频协议）；/models 卷里由 bootstrap.py 下载的 MiniMax-H3 FL2VA 权重
[OUTPUT]: 云端 Modal App「recut-minimax-h3」：在容器内托管一个 SGLang 常驻服务（按探测到的 GPU 选已验证 recipe），
          generate_video 把表单参数 + 参考帧组装成 SGLang /v1/videos 请求（经 h3_contract），取回 mp4 写入 /out 卷
          并返回 file 结果；bootstrap_weights 用 HF token 把 FL2VA 权重下载进 /models 卷
[POS]: minimax-h3 预设包的云端执行体；把「多卡 SGLang 服务」封进一个 Modal Function，对本机 runner 仍是
       Function.from_name(...).with_options(gpu=...).remote(...)，无需 HTTP endpoint。请求契约与本地 mock
       （mock.py/mock_sglang.py）共用 h3_contract，保证「本地跑通＝云端同一套逻辑」
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
# 与总注释一致：把「每次 spawn 都 re-exec 当前代码」的旧版构建器钉到 2025.06（进程级，见下方注释）。
os.environ.setdefault("MODAL_USE_LEGACY_IMAGE_ENTRYPOINT", "0")

APP_NAME = "recut-minimax-h3"
MODELS_VOLUME = "recut-minimax-h3-models"
OUT_VOLUME = "recut-minimax-h3-out"
MODELS_DIR = "/models"
OUT_DIR = "/out"
MODEL_SUBDIR = "MiniMax-H3"
MODEL_VARIANT = "fl2va"
PORT = 30010
MARKER = ".recut-download-complete"
REF_DIR = "/tmp/h3-refs"

app = modal.App(APP_NAME)

# SGLang 官方镜像（含 H3 diffusion 支持）。**不要用 add_python**：它会用新解释器重装镜像内
# 已有 pip 包（含 sglang 依赖），而旧的 aiohttp 在 Python 3.12 下无法从源码编译。改用镜像自带
# 解释器 + run_commands 装 diffusion 额外依赖。
image = (
    modal.Image.from_registry("lmsysorg/sglang:dev")
    .entrypoint([])
    .run_commands(
        'python -m pip install --no-cache-dir -e "/sgl-workspace/sglang/python[diffusion]"',
        "python -m pip install --no-cache-dir huggingface_hub requests",
    )
    # Modal 1.0 起本地模块不再 automount；显式把与本地 mock 共用的契约模块带进容器。
    .add_local_python_source("h3_contract")
)

models = modal.Volume.from_name(MODELS_VOLUME, create_if_missing=True)
outputs = modal.Volume.from_name(OUT_VOLUME, create_if_missing=True)

# 下载权重只需轻量镜像：不要用 sglang 镜像（冷启动要拉取十几 GB），否则 bootstrap 会卡在拉镜像。
# 但容器导入 modal_app.py 会执行 `from h3_contract import ...`，故这里也要挂同一本地模块，否则
# bootstrap 函数一进容器就 ModuleNotFoundError。
bootstrap_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("huggingface_hub", "requests")
    .add_local_python_source("h3_contract")
)


# ---------------------- SGLang 常驻服务（容器内） ----------------------


def _server_flags() -> list[str]:
    """按探测到的 GPU 型号/数量选择 SGLang 已验证 recipe（单节点）。"""
    import torch

    count = torch.cuda.device_count()
    name = torch.cuda.get_device_name(0).upper()
    flags = ["--model-path", f"{MODELS_DIR}/{MODEL_SUBDIR}", "--model-variant", MODEL_VARIANT,
             "--host", "127.0.0.1", "--port", str(PORT)]
    if "B200" in name or "B300" in name:
        if count >= 8:
            flags += ["--num-gpus", "8", "--ulysses-degree", "8", "--performance-mode", "speed"]
        else:
            flags += ["--num-gpus", str(count), "--ulysses-degree", str(count),
                      "--performance-mode", "speed", "--use-fsdp-inference", "true"]
    elif "H200" in name:
        flags += ["--num-gpus", str(count), "--ulysses-degree", str(count), "--performance-mode", "speed"]
    elif "H100" in name and count == 4:
        # 官方 h100-resident-4：TP 2 + Ulysses 2
        flags += ["--num-gpus", "4", "--tp-size", "2", "--ulysses-degree", "2", "--performance-mode", "speed"]
    else:
        flags += ["--num-gpus", str(count), "--performance-mode", "speed"]
    return flags


_SERVER: dict = {"proc": None}
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


def _ensure_server() -> None:
    """幂等：复用本容器内已在监听的 SGLang 服务；否则启动并等待就绪。"""
    proc = _SERVER.get("proc")
    if proc is not None and proc.poll() is None and _healthy():
        return
    with _LOCK:
        proc = _SERVER.get("proc")
        if proc is not None and proc.poll() is None and _healthy():
            return
        command = ["sglang", "serve", *_server_flags()]
        print("[modal] 启动 SGLang 服务：" + " ".join(command), flush=True)
        env = {**os.environ, "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True", "PYTHONUNBUFFERED": "1"}
        proc = subprocess.Popen(command, stdout=sys.stdout, stderr=subprocess.STDOUT, env=env)
        _SERVER["proc"] = proc
        deadline = time.time() + 3000
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"SGLang 服务退出（code {proc.returncode}）")
            if _healthy():
                print("[modal] SGLang 服务已就绪。", flush=True)
                return
            time.sleep(5)
        raise RuntimeError("SGLang 服务启动超时")


@app.cls(image=image, gpu="H200:4", volumes={MODELS_DIR: models, OUT_DIR: outputs},
         timeout=3600, max_containers=1)
class H3:
    @modal.enter()
    def start(self):
        """容器启动即拉起 SGLang 常驻服务；@modal.enter 每容器只跑一次（非每次调用）。"""
        _ensure_server()

    @modal.exit()
    def stop(self):
        proc = _SERVER.get("proc")
        if proc is not None and proc.poll() is None:
            proc.terminate()

    @modal.method()
    def generate_video(self, prompt: str, aspectRatio: str = "auto", durationSec: float = 5,
                       steps: int = 50, seed: int = -1, refs=None):
        _ensure_server()
        conditions = write_reference_conditions(refs or [], REF_DIR)
        body = build_video_body(prompt, aspect_ratio=aspectRatio, duration_sec=durationSec,
                                steps=steps, seed=seed, conditions=conditions)
        print(f"[modal] 提交 H3 {body['task']}（{body['seconds']}s，{body['target']['aspect_ratio']}，"
              f"{body['num_inference_steps']} steps，seed {body['seed']}）…", flush=True)
        started = time.time()
        data = submit_video(f"http://127.0.0.1:{PORT}", body, log=print)
        key = f"runs/{uuid.uuid4().hex}.mp4"
        path = Path(OUT_DIR) / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        outputs.commit()
        print(f"[modal] 已生成 {key}（{round(time.time() - started, 1)}s）。", flush=True)
        return {"kind": "file", "volume": OUT_VOLUME, "key": key, "mimeType": "video/mp4",
                "meta": {"durationSec": float(durationSec), "fps": 24, "seed": body["seed"],
                         "steps": int(steps), "audio": True}}


@app.function(image=bootstrap_image, volumes={MODELS_DIR: models}, timeout=7200,
              secrets=[modal.Secret.from_name("recut-hf-token")])
def bootstrap_weights(source: str = "automatic", repo: str = MODEL_NAME, revision: str = "main", patterns: str = ""):
    """把 H3 FL2VA 权重下载进 /models 卷。**只有 bootstrap 会写权重卷**（deploy/generate 都不下载）。

    H3 权重约 134GB 且为 HF gated，因此：
    - 逐文件 HTTP Range 断点续传（`.part` 保留在卷里，重跑从断点继续）；
    - 每 10 分钟 `volume.commit()` 一次，容器超时/中断也能保住已下进度；
    - 全部文件校验通过后才写完成标记；重跑幂等跳过已完成文件。
    `patterns` 逗号分隔可只下子集（如 `model_index.json` 做冒烟验证）。
    """
    import os

    target = Path(MODELS_DIR) / MODEL_SUBDIR
    # 幂等短路：曾完成全量下载（标记存在）且未请求子集时直接跳过——不联网、不需要 token。
    if not (patterns or "").strip() and (Path(MODELS_DIR) / MARKER).is_file():
        print("[modal] H3 权重已存在（完成标记在），跳过下载。", flush=True)
        return {"ready": True, "path": str(target), "skipped": True}

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or ""
    if not token:
        raise RuntimeError("缺少 HF token：请先 modal.secret.set { name: 'recut-hf-token', values: { HF_TOKEN } }")
    allow = [p.strip() for p in (patterns or "").split(",") if p.strip()] or ["model_index.json", "FL2VA/*"]
    target.mkdir(parents=True, exist_ok=True)
    pinned, files = _list_files(repo, revision, allow)
    if not files:
        raise RuntimeError(f"{repo} 没有匹配的文件（FL2VA）")
    total = sum(size for _, size, _ in files)
    print(f"[modal] H3 待下载 {len(files)} 个文件，共 {_human(total)}（pinned {pinned[:12]}）…", flush=True)
    for index, (path, size, url) in enumerate(files, start=1):
        changed = _download_resumable(url, target / path, size, token, models)
        print(f"[modal] [{index}/{len(files)}] {path} · {_human(size)} · {'下载完成' if changed else '已存在'}", flush=True)
    # 完成标记写在卷根部，供 modal.status / volume_ready 探测；只有「全量下载」全部文件就绪才写。
    if not (patterns or "").strip():
        (Path(MODELS_DIR) / MARKER).write_text("ok", encoding="utf-8")
    models.commit()
    print("[modal] H3 FL2VA 权重已就绪。", flush=True)
    return {"ready": True, "path": str(target), "files": len(files), "revision": pinned}


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
