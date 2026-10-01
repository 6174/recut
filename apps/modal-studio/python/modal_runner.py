"""
[INPUT]: 平台注入的 RECUT_APP_FILES_DIR / RECUT_PYTHON；内置 modalapps/*（App 包内，只读）与用户 modalapps/*
          （--user-root，缺省 RECUT_APP_FILES_DIR，即 appstate）；<files>/modal/profiles.json（token profile 镜像）；
          --task-log 任务日志文件
[OUTPUT]: status（token profile/连通性、内置+用户预设包的部署状态、volume 就绪度与 stale（预设包目录 hash ——
          排除忽略名单（通用 modalapps/deploy-ignore.json + 预设包 manifest 的 deployIgnore）里的文件 ——
          与上次成功 deploy 记录不一致 → 代码已变更、需重新部署）；就绪度**逐产物**判定：预设包在
          engine.artifacts 声明产物（权重 / LoRA / 离线合并…），逐个探测完成标记并在 states[a].assets 上报，
          volumeReady 只代表基础权重（离线合并产物缺失不再被误报为就绪）；--modalapp 可只探一个包（提交前预检用）；
          各预设包的探测（volume ls + 目录 hash）并行执行，耗时不再随预设包数量线性增长）、deploy（modal deploy 构建 Image 与函数，成功后把目录 hash 记进 appstate/modal/deploy-state.json）、bootstrap（modal run 把权重写进 Volume）、invoke
          （Function.from_name(...).with_options(gpu=...).spawn(...) 调用并把产物拉回本机；调用 ID 落盘到 `<output>.call_id`，供 cancel 直接按 ID 取消；**成功取回结果后**才撤掉该文件，取消/失败时保留；轮询用 call.get(timeout)
          报心跳，长轮询偶发断连（ConnectionError 等）时按调用 ID 重连继续等待——spawn 已提交、云端仍在算，
          判负只会留下无人认领的 GPU 任务；后台 `modal app logs --follow` 把云端容器日志 tee 进任务日志，
          按 since 过滤掉 App 历史回放、并让子进程行缓冲，deploy/bootstrap 期间同样跟随）、
          invoke --mock（加载预设包 mock.py，对本地 mock 服务跑通同一套产物链路，不部署/不访问 Modal/GPU）、
          cancel（FunctionCall.from_id(...).cancel()：按调用 ID 直接取消云端调用——本机 runner 可能已被 SIGKILL、
          收不到 SIGTERM，只有直接 cancel 才能停住云端计算并释放 GPU）、teardown（modal app stop）、secret（modal secret create --force）；任何命令的失败原因都写进任务日志
          （App 只读任务日志，stderr 里的 traceback 到不了界面）。
[POS]: modal-studio 的本机薄客户端；GPU 计算与权重全在 modal.com，本机只做编排、上传参考、接收产物。预设包来源
          分内置（App 包）与用户（appstate），二者共用同一 manifest/modal_app.py/bootstrap.py 契约。modal CLI
          子进程输出逐行实时转发（bootstrap 长下载全程可见）；仅 status/catalog 的机器解析类短命令（app list、
          volume ls）静默执行，既不产生无用噪声，也避免输出管道被塞住而影响完成标记的捕获。
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import base64
import builtins
import datetime
import fnmatch
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_ORIG_PRINT = builtins.print
_TASK_LOG = None
_TASK_LOG_LOCK = threading.Lock()
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

# invoke 长轮询断连后的重连上限。spawn 已把输入提交到云端、云端不会因本机断开而停止计算，
# 所以一次网络抖动不该把仍在烧 GPU 的任务判负：先按调用 ID 重连若干次，超出上限才放弃并取消云端调用。
INVOKE_RECONNECT_LIMIT = 20


def _write_task_log(text: str) -> None:
    if _TASK_LOG is None:
        return
    line = _ANSI_RE.sub("", text).strip()
    if not line:
        return
    msg = line[len("[modal] "):] if line.startswith("[modal] ") else line
    level = "info"
    if any(word in msg for word in ("失败", "错误", "不可用", "异常", "Traceback", "Error")):
        level = "error"
    elif any(word in msg for word in ("完成", "就绪", "已下载", "成功")):
        level = "ok"
    elif any(word in msg for word in ("较慢", "回退", "等待", "重试", "进行", "deploy", "download")):
        level = "warn"
    payload = json.dumps({"ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "level": level, "message": msg}, ensure_ascii=False) + "\n"
    with _TASK_LOG_LOCK:
        _TASK_LOG.write(payload)
        _TASK_LOG.flush()


def _teed_print(*args, **kwargs):
    _ORIG_PRINT(*args, **kwargs)
    if args:
        _write_task_log(str(args[0]))


def resolve_task_log(raw: str) -> None:
    global _TASK_LOG
    if not raw:
        return
    candidate = Path(raw)
    if not candidate.is_absolute() and os.environ.get("RECUT_APP_FILES_DIR"):
        candidate = Path(os.environ["RECUT_APP_FILES_DIR"]) / candidate
    candidate.parent.mkdir(parents=True, exist_ok=True)
    _TASK_LOG = open(candidate, "a", encoding="utf-8")
    builtins.print = _teed_print


def app_root() -> Path:
    return Path(__file__).resolve().parent.parent


def files_root() -> Path:
    return Path(os.environ.get("RECUT_APP_FILES_DIR", "."))


def resolve_file(raw: str) -> Path:
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = files_root() / candidate
    return candidate


# ---------------------- 预设包发现（内置 + 用户） ----------------------


def normalize_manifest(manifest: dict, origin: str, source_rel: str) -> dict:
    engine = manifest.get("engine") or {}
    weights = manifest.get("weights") or {}
    return {
        "id": manifest["id"],
        "label": manifest.get("name") or manifest["id"],
        "capability": manifest.get("capability") or "image.generate",
        "appName": engine.get("appName") or manifest["id"],
        "sourceDir": source_rel,
        "origin": origin,
        "gpuTiers": engine.get("gpuTiers") or {"default": "T4", "options": []},
        "timeoutSec": engine.get("timeoutSec", 3600),
        "idleTimeoutSec": engine.get("idleTimeoutSec", 60),
        "volumes": engine.get("volumes") or [],
        "secrets": engine.get("secrets") or [],
        "profileId": engine.get("profileId") or "",
        # 预设包声明的就绪产物（key/volume/marker）与每个函数所需产物；缺省时退回「只看基础权重卷」。
        "artifacts": engine.get("artifacts") or [],
        "requires": engine.get("requires") or {},
        "weights": {
            "bootstrapFunction": weights.get("bootstrapFunction", "bootstrap_weights"),
            "repoHuggingFace": weights.get("repoHuggingFace", ""),
            "repoModelScope": weights.get("repoModelScope", ""),
            "revision": weights.get("revision", ""),
            "sizeGb": weights.get("sizeGb", 0),
            "files": weights.get("files") or [],
        },
        "functions": [{
            "id": function["id"],
            "label": function.get("name") or function["id"],
            "entrypoint": function.get("entrypoint") or function["id"],
            "invoke": function.get("invoke") or {"mode": "sdk"},
            "output": function.get("output") or {"kind": "image", "mimeType": "image/png", "ext": "png"},
            "formSchema": function.get("formSchema") or [],
            "defaultParams": function.get("defaultParams") or {},
        } for function in (manifest.get("functions") or [])],
    }


def scan_modalapps(root: Path, origin: str) -> list:
    out = []
    base = root / "modalapps"
    if not base.is_dir():
        return out
    for manifest_path in sorted(base.glob("*/manifest.json")):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not manifest.get("id"):
            continue
        out.append(normalize_manifest(manifest, origin, f"modalapps/{manifest_path.parent.name}"))
    return out


def user_root_of(args: argparse.Namespace) -> Path:
    raw = getattr(args, "user_root", "") or ""
    return Path(raw) if raw else files_root()


def all_modalapps(user_root: Path) -> list:
    merged = {m["id"]: m for m in scan_modalapps(app_root(), "builtin")}
    for m in scan_modalapps(user_root, "user"):
        merged[m["id"]] = m  # 用户同名覆盖内置（save 已禁止与内置撞名，此处仅兜底）
    return list(merged.values())


def manifest_at(source_dir: Path) -> dict:
    manifest_path = source_dir / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"missing manifest.json: {manifest_path}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


# ---------------------- 代码变更检测（目录 hash） ----------------------

# 策略从简：对整个预设包目录算 sha256，只跳过明显的生成物/噪声。
_HASH_SKIP_DIRS = {"__pycache__", ".git"}
_HASH_SKIP_SUFFIXES = (".pyc", ".pyo")
_HASH_SKIP_NAMES = {".DS_Store"}

# 部署变更检测的忽略名单：这些文件不参与 `modal deploy`（manifest 只被本机 runner 读取，文档/mock/bench
# 不上云），改它们不应把预设包标成 stale。分两层：通用名单（所有预设包共享）+ 预设包自带的 `deployIgnore`。
_HASH_IGNORE_FILE = ("modalapps", "deploy-ignore.json")
# 通用名单文件缺失/损坏时的兜底（保持最小集，避免误报「待部署」）。
_HASH_IGNORE_FALLBACK = ("manifest.json", "*.md", "mock*.py", "bench*.py")


def common_ignore() -> tuple:
    """通用忽略名单：随 App 包发布的 `modalapps/deploy-ignore.json`（JSON 字符串数组），内置/用户预设包共享。"""
    path = app_root().joinpath(*_HASH_IGNORE_FILE)
    try:
        patterns = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _HASH_IGNORE_FALLBACK
    if not isinstance(patterns, list):
        return _HASH_IGNORE_FALLBACK
    cleaned = tuple(str(pattern) for pattern in patterns if str(pattern).strip())
    return cleaned or _HASH_IGNORE_FALLBACK


def deploy_ignore(manifest: dict | None) -> tuple:
    """通用名单 + manifest 声明的 `deployIgnore`（glob，相对预设包根或文件名）。"""
    extra = tuple(str(pattern) for pattern in ((manifest or {}).get("deployIgnore") or []))
    return common_ignore() + extra


def matches_ignore(rel: Path, patterns: tuple) -> bool:
    """`rel`（相对预设包根）是否命中忽略名单。

    glob 命中相对路径或文件名（`mock*.py` 这类可匹配任意层级的文件名）；以 `/` 结尾的 pattern 按目录名匹配
    （`output/` 命中任意层级的 output 目录）。
    """
    if not patterns:
        return False
    posix = rel.as_posix()
    for pattern in patterns:
        if pattern.endswith("/"):
            directory = pattern.rstrip("/")
            if directory in rel.parts or posix.startswith(f"{directory}/"):
                return True
        elif fnmatch.fnmatch(posix, pattern) or fnmatch.fnmatch(rel.name, pattern):
            return True
    return False


def source_path(modalapp: dict, user_root: Path) -> Path:
    """由归一 manifest 解析预设包源码目录的绝对路径（内置在 App 包内，用户在 appstate）。"""
    base = app_root() if modalapp.get("origin") == "builtin" else user_root
    return base / str(modalapp.get("sourceDir") or "")


def source_ignore(modalapp: dict, user_root: Path) -> tuple:
    """读取预设包 manifest 的忽略名单；缺 manifest 时退回默认名单。"""
    try:
        return deploy_ignore(manifest_at(source_path(modalapp, user_root)))
    except (SystemExit, OSError, ValueError):
        return deploy_ignore(None)


def folder_hash(source: Path, ignore: tuple = ()) -> str:
    """整个预设包目录的确定性 sha256（相对路径 + 内容）；目录缺失返回空串。

    `ignore` 为 glob 列表（命中相对路径或文件名即跳过），用于把不参与部署的文件排除在变更检测之外。
    """
    if not source.is_dir():
        return ""
    digest = hashlib.sha256()
    for path in sorted(p for p in source.rglob("*") if p.is_file()):
        rel = path.relative_to(source)
        parts = rel.parts
        if any(part in _HASH_SKIP_DIRS for part in parts):
            continue
        if path.name in _HASH_SKIP_NAMES or path.suffix in _HASH_SKIP_SUFFIXES:
            continue
        if matches_ignore(rel, ignore):
            continue
        digest.update(rel.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def deploy_state_file() -> Path:
    return files_root() / "modal" / "deploy-state.json"


def load_deploy_state() -> dict:
    try:
        return json.loads(deploy_state_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def record_deploy(modalapp_id: str, source: Path, ignore: tuple = ()) -> str:
    """部署成功后记录当前目录 hash（按忽略名单），供后续 status 判断代码是否变更。"""
    digest = folder_hash(source, ignore)
    state = load_deploy_state()
    state[modalapp_id] = {"deployHash": digest, "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    path = deploy_state_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    return digest


# ---------------------- token profiles ----------------------


def profiles_file() -> Path:
    return files_root() / "modal" / "profiles.json"


def load_profiles() -> dict:
    path = profiles_file()
    if not path.is_file():
        return {"profiles": [], "defaultProfileId": ""}
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"profiles": [], "defaultProfileId": ""}


def select_profile(profile_id: str) -> dict | None:
    data = load_profiles()
    profiles = data.get("profiles") or []
    if profile_id:
        return next((p for p in profiles if p.get("id") == profile_id), None)
    default_id = data.get("defaultProfileId") or ""
    if default_id:
        found = next((p for p in profiles if p.get("id") == default_id), None)
        if found:
            return found
    return profiles[0] if profiles else None


def apply_credentials(profile_id: str, required: bool) -> dict | None:
    profile = select_profile(profile_id)
    if not profile:
        if required:
            raise SystemExit("尚未配置 Modal token：请先在界面 Setup 门添加 token profile。")
        return None
    token_id = str(profile.get("tokenId") or "")
    token_secret = str(profile.get("tokenSecret") or "")
    if not token_id or not token_secret:
        if required:
            raise SystemExit("选中的 Modal token profile 不完整。")
        return None
    # 只在子进程环境里出现，绝不写入日志。
    os.environ["MODAL_TOKEN_ID"] = token_id
    os.environ["MODAL_TOKEN_SECRET"] = token_secret
    return profile


# ---------------------- Modal CLI / SDK ----------------------


def modal_cli() -> str:
    candidate = Path(sys.executable).with_name("modal.exe" if os.name == "nt" else "modal")
    if candidate.is_file():
        return str(candidate)
    found = shutil.which("modal")
    if found:
        return found
    raise SystemExit("未找到 modal CLI：请先准备运行环境（安装 modal 包）。")


def run_cli(args: list[str], timeout: int | None = None, cwd: str | None = None, echo: bool = True) -> subprocess.CompletedProcess:
    """执行 modal CLI 并**逐行实时**转发输出（长任务如 bootstrap 下载全程可见）。

    仍返回 CompletedProcess（.returncode/.stdout）：stdout 为累计文本，供 JSON 解析等调用方使用。

    `echo=False` 用于机器解析的短命令（status/catalog 的 app list 与 volume ls）：它们的输出没有人看，
    逐行转发只会把 stdout 这个管道塞满（转发线程被下游读得慢卡住时，捕获到的 stdout 会不完整，
    而 volume 完成标记正是从这份捕获里读的）。静默执行既去掉噪声，也让捕获不再受下游影响。
    """
    process = subprocess.Popen(
        [modal_cli(), *args],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=cwd,
        env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"},
    )
    lines: list[str] = []

    def _pump() -> None:
        stream = process.stdout
        if stream is None:
            return
        try:
            for line in stream:
                lines.append(line)
                if echo and line.strip():
                    print(f"[modal] {line.rstrip()}", flush=True)
        except (OSError, ValueError):
            return

    thread = threading.Thread(target=_pump, name="modal-cli-stream", daemon=True)
    thread.start()
    try:
        returncode = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        thread.join(timeout=2)
        raise
    thread.join(timeout=2)
    return subprocess.CompletedProcess(process.args, returncode, "".join(lines), None)


_CLOUD_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:[+-]\d{2}:?\d{2})?)")


def _cloud_line_time(line: str) -> "datetime.datetime | None":
    """从 `modal app logs --timestamps` 的行首解析时间戳（带时区偏移时返回 aware datetime）。"""
    match = _CLOUD_TS_RE.match(line)
    if not match:
        return None
    try:
        return datetime.datetime.fromisoformat(match.group(1))
    except ValueError:
        return None


def start_app_log_follower(app_name: str, since: "datetime.datetime | None" = None) -> dict | None:
    """后台跟随已部署 App 的云端容器日志（含 SGLang 启动与崩溃堆栈），逐行 tee 进任务日志。

    裸 SDK 的 spawn()/get() 不会流式接收容器日志——Modal 只在 `app.run()` /
    `modal app logs` 路径打印它们；这里用一条 `modal app logs --follow` 子进程补齐，
    否则云端启动失败只会表现为「云端运行中」心跳，问题无法暴露。

    `modal app logs --follow` 不能和 `--since` 组合（CLI 明确拒绝），所以时间过滤在本地做：
    `since` 之前的行直接丢弃。否则每次新任务都会把 App 的历史日志（上一次的崩溃栈）整段回放进
    当前任务日志，用户看到的是「与本次无关的旧错误」。子进程 stdout 走管道时 Python 会块缓冲，
    这里给子进程 `PYTHONUNBUFFERED=1`，让云端日志**逐行**到达而不是攒成一大坨。
    """
    try:
        process = subprocess.Popen(
            [modal_cli(), "app", "logs", app_name, "--follow", "--show-container-id", "--timestamps"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            env={**os.environ, "NO_COLOR": "1", "TERM": "dumb", "PYTHONUNBUFFERED": "1"},
        )
    except OSError as error:
        print(f"[modal] 无法连接云端日志：{error}", flush=True)
        return None
    stopped = threading.Event()
    # 允许一点时钟偏差，避免刚好在跟随开始时创建的容器日志被误丢。
    cutoff = (since - datetime.timedelta(seconds=120)) if since else None
    if cutoff is not None and cutoff.tzinfo is not None:
        cutoff = cutoff.astimezone(datetime.timezone.utc)

    def _keep(line: str) -> bool:
        if cutoff is None:
            return True
        stamp = _cloud_line_time(line)
        if stamp is None:
            # 续行（无时间戳前缀，例如 traceback 的代码行）跟随上一行，不单独判定。
            return True
        if stamp.tzinfo is None:
            return True
        return stamp.astimezone(datetime.timezone.utc) >= cutoff

    def _pump() -> None:
        stream = process.stdout
        if stream is None:
            return
        try:
            for raw in stream:
                if stopped.is_set():
                    break
                line = raw.rstrip()
                if line and _keep(line):
                    print(f"[cloud] {line}", flush=True)
        except (OSError, ValueError):
            return

    thread = threading.Thread(target=_pump, name="modal-app-logs", daemon=True)
    thread.start()
    return {"process": process, "stopped": stopped, "thread": thread}


def stop_app_log_follower(follower: dict | None) -> None:
    if not follower:
        return
    follower["stopped"].set()
    process = follower["process"]
    try:
        process.terminate()
    except OSError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
        except OSError:
            pass
    follower["thread"].join(timeout=2)


def app_names() -> tuple[bool, list[str], str]:
    """返回 (connected, deployed app names, error)。输出只用于解析，故静默执行（见 run_cli 的 echo）。"""
    try:
        process = run_cli(["app", "list", "--json"], timeout=60, echo=False)
    except FileNotFoundError as error:
        return False, [], str(error)
    if process.returncode != 0:
        return False, [], (process.stdout or "modal app list failed").strip()[-400:]
    text = (process.stdout or "").strip()
    start = text.find("[")
    if start == -1:
        return True, [], ""
    try:
        payload = json.loads(text[start:])
    except ValueError:
        names = []
        for line in text.splitlines():
            parts = [p.strip() for p in line.split("│")]
            if len(parts) >= 4 and parts[-1] and parts[-1] not in ("Name", "名称"):
                names.append(parts[-1])
        return True, names, ""
    names = []
    for item in payload if isinstance(payload, list) else []:
        if isinstance(item, dict):
            lowered = {str(key).lower(): value for key, value in item.items()}
            name = lowered.get("description") or lowered.get("name") or lowered.get("app_name") or lowered.get("appname") or ""
            if name:
                names.append(str(name))
    return True, names, ""


def existing_secrets() -> list:
    try:
        process = run_cli(["secret", "list", "--json"], timeout=60)
    except FileNotFoundError:
        return []
    if process.returncode != 0:
        return []
    text = (process.stdout or "").strip()
    start = text.find("[")
    if start == -1:
        return []
    try:
        payload = json.loads(text[start:])
    except ValueError:
        return []
    names = []
    for item in payload if isinstance(payload, list) else []:
        if isinstance(item, dict):
            lowered = {str(key).lower(): value for key, value in item.items()}
            name = lowered.get("name") or ""
            if name:
                names.append(str(name))
    return names


_VOLUME_LOCKS: dict[str, "threading.Lock"] = {}
_VOLUME_LOCKS_GUARD = threading.Lock()


def _volume_lock(volume_name: str) -> "threading.Lock":
    with _VOLUME_LOCKS_GUARD:
        return _VOLUME_LOCKS.setdefault(volume_name, threading.Lock())


def _probe_volume(volume_name: str) -> str | None:
    text: str | None = None
    warned = False
    for attempt in range(2):
        try:
            process = run_cli(["volume", "ls", volume_name], timeout=60, echo=False)
        except FileNotFoundError:
            return None
        except subprocess.TimeoutExpired:
            process = None
        if process is not None and process.returncode == 0:
            return process.stdout or ""
        if attempt == 0:
            print(f"[modal] 卷 {volume_name} 就绪度探测失败，重试一次…", flush=True)
            warned = True
    if warned:
        print(f"[modal] 卷 {volume_name} 就绪度探测失败（已重试），本次按未就绪处理。", flush=True)
    return text


def volume_listing(volume_name: str, cache: dict | None = None) -> str | None:
    """`modal volume ls <name>` 的输出（用于判断完成标记）；失败重试一次后返回 None。

    一次探测失败不等于「卷没就绪」：网络抖动、CLI 异常、输出捕获不完整都会让返回码非 0，
    直接据此下结论会在界面弹出假的告警。所以失败时重试一次才判定，且探测全程静默
    （见 run_cli 的 echo）——逐行转发会把 stdout 管道塞住而读不到标记。

    cache 以卷名为键：同一轮 status 里 models 卷被多个预设包共用，只探一次（失败结果也缓存，
    避免共享卷被反复重试、反复刷失败日志）。按卷名加锁，既保证同一卷只探一次，也保留
    不同卷之间的并行探测。
    """
    if cache is None:
        return _probe_volume(volume_name)
    with _volume_lock(volume_name):
        if volume_name in cache:
            return cache[volume_name]
        text = _probe_volume(volume_name)
        cache[volume_name] = text
        return text


def volume_has_marker(volume_name: str, marker: str, cache: dict | None = None) -> bool:
    """卷根是否含完成标记（按前缀包含判断）：标记名带版本后缀（`.recut-*-complete-v2`）也能命中。"""
    if not volume_name or not marker:
        return False
    text = volume_listing(volume_name, cache)
    return bool(text) and marker in text


def modalapp_state(modalapp: dict, user_root: Path, names: list, deploy_state: dict, cache: dict | None = None) -> tuple:
    """单个预设包的部署/权重/变更状态（一次 `modal app list` 与卷探测结果由调用方共享）。

    就绪度按**逐产物**判定：预设包在 `engine.artifacts` 声明自身产物（权重 / LoRA / 离线合并…），
    这里逐个探测其完成标记。`volumeReady` 只代表「基础权重」——离线合并产物缺失时权重卷照样就绪，
    正是它让「界面显示就绪 → 提交 → 云端 SGLang 起不来」的坑成立（见 modal.envError / crash-loop）。
    未声明 `artifacts` 的预设包退回旧语义（只看第一个卷的下载标记）。
    """
    app_name = modalapp.get("appName") or modalapp["id"]
    deployed = app_name in names
    current_hash = folder_hash(source_path(modalapp, user_root), source_ignore(modalapp, user_root))
    recorded_hash = (deploy_state.get(modalapp["id"]) or {}).get("deployHash") or ""
    artifacts = modalapp.get("artifacts") or []
    assets: dict = {}
    if artifacts:
        for artifact in artifacts:
            key = str(artifact.get("key") or "").strip()
            if not key:
                continue
            assets[key] = volume_has_marker(str(artifact.get("volume") or ""), str(artifact.get("marker") or ""), cache)
        volume_ready = assets.get("weights", True)
    else:
        volumes = modalapp.get("volumes") or []
        volume_ready = True if not volumes else volume_has_marker(volumes[0]["name"], ".recut-download-complete", cache)
    state = {
        "deployed": deployed,
        "volumeReady": volume_ready if deployed else False,
        # 已部署但目录 hash 与上次成功部署记录不一致（含首次接入无记录）→ 代码已变更，需重新部署。
        "stale": deployed and current_hash != "" and recorded_hash != current_hash,
    }
    if artifacts:
        state["assets"] = assets
    return modalapp["id"], state


def cmd_status(args: argparse.Namespace) -> dict:
    profile = apply_credentials(args.profile, required=False)
    if not profile:
        return {"ready": True, "connected": False, "account": "", "error": "尚未配置 Modal token。", "modalapps": {}}
    try:
        connected, names, error = app_names()
    except Exception as exc:  # noqa: BLE001
        return {"ready": True, "connected": False, "account": "", "error": str(exc), "modalapps": {}}
    if not connected:
        return {"ready": True, "connected": False, "account": "", "error": error, "modalapps": {}}
    user_root = user_root_of(args)
    deploy_state = load_deploy_state()
    modalapps = all_modalapps(user_root)
    # `--modalapp` 只探一个预设包（提交前的就绪度预检走这条，避免为一次提交探全部 5 个包）。
    only = (getattr(args, "modalapp", "") or "").strip()
    if only:
        modalapps = [m for m in modalapps if m["id"] == only]
    # 每个预设包的 volume ls 是独立网络往返（各约 1.5-2.3s），串行累加就是进入工作台的主要等待；
    # 并行探测后总耗时约为最慢的一个包（± 单次 CLI 冷启动），预设包数量不再线性放大延迟。
    cache: dict = {}
    if modalapps:
        with ThreadPoolExecutor(max_workers=min(8, len(modalapps))) as pool:
            states = dict(pool.map(lambda modalapp: modalapp_state(modalapp, user_root, names, deploy_state, cache), modalapps))
    else:
        states = {}
    return {"ready": True, "connected": True, "account": profile.get("name") or "", "error": "", "modalapps": states}


def cmd_catalog(args: argparse.Namespace) -> dict:
    return cmd_status(args)


# ---------------------- 生命周期 ----------------------


def cmd_deploy(args: argparse.Namespace) -> dict:
    apply_credentials(args.profile, required=True)
    source = Path(args.dir)
    manifest = manifest_at(source)
    engine = manifest.get("engine") or {}
    app_name = engine.get("appName") or manifest["id"]
    print(f"[modal] 正在部署 {manifest['id']}（{app_name}，首次构建镜像较慢）…", flush=True)
    # 部署期间也跟随已部署 App 的容器日志：`modal run bootstrap.py` 只打印它自己这次调用的输出，
    # 而**正在崩溃循环的已部署函数**（例如待运行任务把容器反复拉起来）属于另一个 App，只有这里能带出来。
    follower = start_app_log_follower(app_name, since=datetime.datetime.now(datetime.timezone.utc))
    try:
        process = run_cli(["deploy", "modal_app.py"], cwd=str(source))
        if process.returncode != 0:
            raise SystemExit("modal deploy failed")
        record_deploy(manifest["id"], source, deploy_ignore(manifest))
        print(f"[modal] {manifest['id']} 已部署。", flush=True)
        # 部署与权重合并：镜像部署成功后，若声明了权重卷，直接接着跑 bootstrap（幂等/断点续传）。
        weights = manifest.get("weights") or {}
        if weights and (engine.get("volumes") or []) and (source / "bootstrap.py").is_file():
            weight_source = args.weight_source or "huggingface"
            print(f"[modal] 继续准备 {manifest['id']} 权重（source={weight_source}）…", flush=True)
            boot = run_cli(["run", "bootstrap.py", "--source", weight_source], cwd=str(source))
            if boot.returncode != 0:
                raise SystemExit("modal bootstrap failed")
            print(f"[modal] {manifest['id']} 权重已就绪。", flush=True)
    finally:
        stop_app_log_follower(follower)
    return {"ready": True, "modalapp": manifest["id"], "deployed": True}


def cmd_secrets(args: argparse.Namespace) -> dict:
    apply_credentials(args.profile, required=False)
    return {"secrets": existing_secrets()}


def cmd_bootstrap(args: argparse.Namespace) -> dict:
    apply_credentials(args.profile, required=True)
    source = Path(args.dir)
    manifest = manifest_at(source)
    script = source / "bootstrap.py"
    if not script.is_file():
        raise SystemExit(f"missing bootstrap.py for {manifest['id']}")
    engine = manifest.get("engine") or {}
    app_name = engine.get("appName") or manifest["id"]
    weight_source = args.weight_source or "automatic"
    print(f"[modal] 正在准备 {manifest['id']} 权重（source={weight_source}）…", flush=True)
    follower = start_app_log_follower(app_name, since=datetime.datetime.now(datetime.timezone.utc))
    try:
        process = run_cli(["run", "bootstrap.py", "--source", weight_source], cwd=str(source))
        if process.returncode != 0:
            raise SystemExit("modal bootstrap failed")
    finally:
        stop_app_log_follower(follower)
    print(f"[modal] {manifest['id']} 权重已就绪。", flush=True)
    return {"ready": True, "modalapp": manifest["id"], "installed": True}


def cmd_teardown(args: argparse.Namespace) -> dict:
    apply_credentials(args.profile, required=True)
    source = Path(args.dir)
    manifest = manifest_at(source)
    app_name = (manifest.get("engine") or {}).get("appName") or manifest["id"]
    process = run_cli(["app", "stop", app_name])
    if process.returncode != 0:
        raise SystemExit("modal app stop failed")
    print(f"[modal] {app_name} 已停止（Volume 保留）。", flush=True)
    return {"ready": True, "modalapp": manifest["id"], "stopped": True}


# ---------------------- 调用 ----------------------


def read_json(path: str, fallback):
    if not path:
        return fallback
    try:
        return json.loads(resolve_file(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def load_references(refs_path: str) -> list:
    entries = read_json(refs_path, [])
    out = []
    for entry in entries if isinstance(entries, list) else []:
        path = resolve_file(str(entry.get("path") or ""))
        if not path.is_file():
            print(f"[modal] 参考素材不存在，已跳过：{path}", flush=True)
            continue
        item = {"name": entry.get("name") or path.name, "mimeType": entry.get("mimeType") or "",
                "data": path.read_bytes()}
        # 角色/时序透传给 h3_contract：field 决定首/尾帧 keyframe 还是多模态 reference。
        if entry.get("field"):
            item["field"] = str(entry["field"])
        if entry.get("startTimeSeconds") is not None:
            item["startTimeSeconds"] = entry["startTimeSeconds"]
        if entry.get("withAudio"):
            item["withAudio"] = True
        out.append(item)
    return out


def harvest_result(result, output_path: Path) -> dict:
    """把函数返回归一为本地文件，返回 meta。"""
    if isinstance(result, dict) and result.get("kind") == "file":
        volume = str(result.get("volume") or "")
        key = str(result.get("key") or "")
        if not volume or not key:
            raise SystemExit("函数返回的 file 结果缺少 volume/key")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        process = run_cli(["volume", "get", volume, key, str(output_path)])
        if process.returncode != 0:
            raise SystemExit("modal volume get failed")
        return result.get("meta") or {}
    data = result.get("data") if isinstance(result, dict) else result
    if isinstance(data, str):
        try:
            data = base64.b64decode(data)
        except ValueError:
            data = data.encode("utf-8")
    if not isinstance(data, (bytes, bytearray)):
        raise SystemExit("函数未返回可写入的产物（期望 bytes 或 file 结果）")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(bytes(data))
    return (result.get("meta") if isinstance(result, dict) else {}) or {}


def _load_modalapp_mock(source: Path):
    """动态加载预设包目录里的 mock.py（与 h3_contract 同级），供 invoke --mock 调用。"""
    import importlib.util

    path = source / "mock.py"
    if not path.is_file():
        raise SystemExit(f"该预设包没有本地 mock 入口：{path}")
    if str(source) not in sys.path:
        sys.path.insert(0, str(source))
    name = f"recut_modalapp_mock_{source.name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"无法加载 mock.py：{path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    if not hasattr(module, "invoke"):
        raise SystemExit(f"mock.py 必须暴露 invoke(function_id, params, refs, mock_url)：{path}")
    return module


def cmd_invoke_mock(args: argparse.Namespace) -> dict:
    """本地 mock 调用：不部署、不访问 Modal/GPU，直接对本地 mock 服务跑通产物链路。"""
    source = Path(args.dir)
    manifest = manifest_at(source)
    fn = next((f for f in (manifest.get("functions") or []) if f["id"] == args.function), None)
    if fn is None:
        raise SystemExit(f"unknown function: {args.function} in {manifest['id']}")
    params = read_json(args.params, {})
    references = load_references(args.refs)
    if references:
        print(f"[modal] 附带 {len(references)} 个参考素材。", flush=True)
    output_spec = fn.get("output") or {"kind": "image", "ext": "png", "mimeType": "image/png"}
    ext = output_spec.get("ext") or "png"
    output_path = resolve_file(args.output + "." + ext)
    mock_url = args.mock_url or os.environ.get("RECUT_MODAL_MOCK_URL") or "http://127.0.0.1:30010"
    mock = _load_modalapp_mock(source)
    print(f"[modal] mock 调用 {manifest['id']}.{fn['id']} → {mock_url}（不部署、不调用 Modal）…", flush=True)
    started = time.time()
    result = mock.invoke(fn["id"], params, references, mock_url)
    elapsed = round(time.time() - started, 2)
    meta = harvest_result(result, output_path)
    merged = {"modalapp": manifest["id"], "function": fn["id"], "gpuTier": "mock", "duration": elapsed,
              "references": len(references), "mock": True,
              "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if isinstance(meta, dict):
        merged.update(meta)
        if meta.get("durationSec") is not None:
            merged["duration"] = meta["durationSec"]
    Path(str(output_path) + ".meta.json").write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
    print(f"[modal] mock 已生成 {output_path.name}（{elapsed}s）。", flush=True)
    return {"ready": True, "output": str(output_path), **merged}


def cmd_invoke(args: argparse.Namespace) -> dict:
    if getattr(args, "mock", False):
        return cmd_invoke_mock(args)
    apply_credentials(args.profile, required=True)
    source = Path(args.dir)
    manifest = manifest_at(source)
    engine = manifest.get("engine") or {}
    fn = next((f for f in (manifest.get("functions") or []) if f["id"] == args.function), None)
    if fn is None:
        raise SystemExit(f"unknown function: {args.function} in {manifest['id']}")
    params = read_json(args.params, {})
    references = load_references(args.refs)
    if references:
        print(f"[modal] 附带 {len(references)} 个参考素材。", flush=True)
    output_spec = fn.get("output") or {"kind": "image", "ext": "png", "mimeType": "image/png"}
    ext = output_spec.get("ext") or "png"
    output_path = resolve_file(args.output + "." + ext)

    import modal  # type: ignore

    # 长轮询期间偶发、且可恢复的连接类错误：spawn 已提交、云端仍在计算，按调用 ID 重连后
    # 继续等待即可，不应把任务判负（否则云端继续烧 GPU，而本机记录已是失败）。
    transient_errors = (
        modal.exception.ConnectionError,
        modal.exception.InternalError,
        modal.exception.ClientClosed,
    )

    app_name = engine.get("appName") or manifest["id"]
    invoke = fn.get("invoke") or {}
    gpu = args.gpu or (engine.get("gpuTiers") or {}).get("default") or "T4"
    if invoke.get("kind") == "cls":
        # Modal 1.x 只在 Cls 上支持 with_options(gpu=...)（Function 已移除该方法）。
        cls_name = invoke.get("cls") or fn.get("cls")
        method_name = invoke.get("method") or fn.get("entrypoint") or fn["id"]
        target = modal.Cls.from_name(app_name, cls_name)
        if gpu:
            target = target.with_options(gpu=gpu)
        handle = getattr(target(), method_name)
        print(f"[modal] 调用 {app_name}.{cls_name}.{method_name}（gpu={gpu}）…", flush=True)
    else:
        entrypoint = fn.get("entrypoint") or fn["id"]
        # 函数式调用固定使用函数声明的 gpu（Modal 1.x 无 Function.with_options）。
        handle = modal.Function.from_name(app_name, entrypoint)
        print(f"[modal] 调用 {app_name}.{entrypoint}…", flush=True)

    follower = start_app_log_follower(app_name, since=datetime.datetime.now(datetime.timezone.utc))
    print(f"[modal] 已跟随云端日志（{app_name}）。", flush=True)
    started = time.time()
    call = handle.spawn(**params, refs=references)
    call_id = call.object_id
    # 调用 ID 落盘：取消时本机进程可能已被 SIGKILL（收不到 SIGTERM），App 只有按 ID 才能直接取消云端调用（见 cmd_cancel）。
    call_id_path = resolve_file(args.output + ".call_id")
    try:
        call_id_path.parent.mkdir(parents=True, exist_ok=True)
        call_id_path.write_text(call_id, encoding="utf-8")
    except OSError:
        call_id_path = None

    cancelled = {"flag": False}

    def _handler(signum, frame):  # noqa: ANN001
        cancelled["flag"] = True
        try:
            call.cancel()
        except Exception:  # noqa: BLE001
            pass
        raise SystemExit(130)

    previous = signal.signal(signal.SIGTERM, _handler)
    try:
        last_report = 0.0
        reconnects = 0
        while True:
            try:
                result = call.get(timeout=15)
                break
            except TimeoutError:
                now = time.monotonic()
                if now - last_report >= 15:
                    print(f"[modal] 云端运行中（已等待 {int(time.time() - started)}s）…", flush=True)
                    last_report = now
            except TypeError:
                # 兼容不支持 timeout 参数的 SDK：退化为阻塞等待（取消仍经 SIGTERM 处理）。
                result = call.get()
                break
            except modal.exception.OutputExpiredError:
                # 云端已丢弃该调用结果：重连也取不回来，只能重跑。
                raise SystemExit("云端调用结果已过期（Modal 已丢弃该调用），请重新运行。")
            except transient_errors as error:
                reconnects += 1
                if reconnects > INVOKE_RECONNECT_LIMIT:
                    # 彻底失联：取消云端调用，避免继续占 GPU 却无人取回结果。
                    try:
                        call.cancel()
                    except Exception:  # noqa: BLE001
                        pass
                    raise SystemExit(f"与 Modal 的连接连续 {reconnects} 次中断，已放弃：{error}")
                delay = min(2 ** reconnects, 30)
                print(f"[modal] 连接中断（{error}），{delay}s 后按调用 ID 重连（第 {reconnects} 次）…", flush=True)
                time.sleep(delay)
                last_report = 0.0
                try:
                    call = modal.FunctionCall.from_id(call_id)
                except Exception as reconnect_error:  # noqa: BLE001
                    print(f"[modal] 重连失败，将再次重试：{reconnect_error}", flush=True)
            except modal.exception.Error as error:
                # 云端函数的确定性失败（远端异常/超时等）：直接给出原因，别只剩一个 exit status。
                raise SystemExit(f"云端调用失败：{error}")
    finally:
        # 调用 ID 只在**成功取回结果**后才撤掉（见下方）：取消/失败时保留，App 才能按 ID 直接取消云端调用。
        # 之前放在 finally 里，SIGTERM 取消路径也会把它删掉，导致 cancelRemoteCall 拿不到 ID、
        # 被取消的云端调用继续跑（与下一次调用并存 → 同一 App 两个容器同时冷启动）。
        signal.signal(signal.SIGTERM, previous)
        stop_app_log_follower(follower)
    if cancelled["flag"]:
        raise SystemExit(130)

    if call_id_path is not None:
        try:
            call_id_path.unlink()
        except OSError:
            pass

    elapsed = round(time.time() - started, 2)
    meta = harvest_result(result, output_path)
    merged = {"modalapp": manifest["id"], "function": fn["id"], "gpuTier": gpu, "duration": elapsed,
              "references": len(references), "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if isinstance(meta, dict):
        merged.update(meta)
        if meta.get("durationSec") is not None:
            merged["duration"] = meta["durationSec"]
    Path(str(output_path) + ".meta.json").write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
    print(f"[modal] 已生成 {output_path.name}（{elapsed}s）。", flush=True)
    return {"ready": True, "output": str(output_path), **merged}


def cmd_cancel(args: argparse.Namespace) -> dict:
    """按调用 ID 直接取消云端 Modal 调用。

    与「杀掉本机 runner 进程」互补：本地进程可能已被 SIGKILL（收不到 SIGTERM）、已崩溃，或 daemon 重启
    丢了句柄，此时只有按调用 ID 直接 cancel 才能停住云端计算、释放 GPU。取消一个终态调用不算失败。
    """
    apply_credentials(args.profile, required=True)
    call_id = str(getattr(args, "call_id", "") or "").strip()
    if not call_id:
        raise SystemExit("--call-id is required")

    import modal  # type: ignore

    print(f"[modal] 取消云端调用 {call_id}…", flush=True)
    try:
        modal.FunctionCall.from_id(call_id).cancel()
    except Exception as error:  # noqa: BLE001
        print(f"[modal] 取消未生效（调用可能已结束）：{error}", flush=True)
        return {"ready": True, "cancelled": False, "callId": call_id}
    print("[modal] 已请求取消云端调用。", flush=True)
    return {"ready": True, "cancelled": True, "callId": call_id}


def cmd_secret(args: argparse.Namespace) -> dict:
    payload = read_json(args.secret_file, {})
    try:
        resolve_file(args.secret_file).unlink()
    except OSError:
        pass
    values = payload.get("values") if isinstance(payload, dict) else None
    if not isinstance(values, dict) or not values:
        raise SystemExit("secret values are required")
    apply_credentials(args.profile, required=True)
    kv = [f"{key}={val}" for key, val in values.items()]
    process = run_cli(["secret", "create", args.name, *kv, "--force"])
    if process.returncode != 0:
        raise SystemExit("modal secret create failed")
    print(f"[modal] Secret {args.name} 已写入。", flush=True)
    return {"ready": True, "name": args.name, "created": True}


def common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--profile", default="")
    parser.add_argument("--task-log", default="")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-log", default="")
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("status", "catalog"):
        status_parser = sub.add_parser(name)
        status_parser.add_argument("--user-root", default="")
        status_parser.add_argument("--modalapp", default="")
        common(status_parser)

    secrets_parser = sub.add_parser("secrets")
    common(secrets_parser)

    deploy_parser = sub.add_parser("deploy")
    deploy_parser.add_argument("--modalapp", default="")
    deploy_parser.add_argument("--dir", required=True)
    deploy_parser.add_argument("--weight-source", default="")
    common(deploy_parser)

    bootstrap_parser = sub.add_parser("bootstrap")
    bootstrap_parser.add_argument("--modalapp", default="")
    bootstrap_parser.add_argument("--dir", required=True)
    bootstrap_parser.add_argument("--weight-source", default="automatic")
    common(bootstrap_parser)

    teardown_parser = sub.add_parser("teardown")
    teardown_parser.add_argument("--modalapp", default="")
    teardown_parser.add_argument("--dir", required=True)
    common(teardown_parser)

    invoke_parser = sub.add_parser("invoke")
    invoke_parser.add_argument("--modalapp", default="")
    invoke_parser.add_argument("--dir", required=True)
    invoke_parser.add_argument("--function", required=True)
    invoke_parser.add_argument("--output", required=True)
    invoke_parser.add_argument("--params", default="")
    invoke_parser.add_argument("--refs", default="")
    invoke_parser.add_argument("--gpu", default="")
    invoke_parser.add_argument("--mock", action="store_true", help="本地 mock 调用：不部署、不访问 Modal/GPU")
    invoke_parser.add_argument("--mock-url", default="")
    common(invoke_parser)

    cancel_parser = sub.add_parser("cancel")
    cancel_parser.add_argument("--call-id", required=True)
    common(cancel_parser)

    secret_parser = sub.add_parser("secret")
    secret_parser.add_argument("--name", required=True)
    secret_parser.add_argument("--secret-file", required=True)
    common(secret_parser)

    args = parser.parse_args()
    resolve_task_log(args.task_log)

    try:
        if args.command == "status":
            payload = cmd_status(args)
        elif args.command == "catalog":
            payload = cmd_catalog(args)
        elif args.command == "secrets":
            payload = cmd_secrets(args)
        elif args.command == "deploy":
            payload = cmd_deploy(args)
        elif args.command == "bootstrap":
            payload = cmd_bootstrap(args)
        elif args.command == "teardown":
            payload = cmd_teardown(args)
        elif args.command == "invoke":
            payload = cmd_invoke(args)
        elif args.command == "cancel":
            payload = cmd_cancel(args)
        elif args.command == "secret":
            payload = cmd_secret(args)
        else:  # pragma: no cover
            raise SystemExit(f"unknown command: {args.command}")

        print(json.dumps(payload, ensure_ascii=False), flush=True)
    except SystemExit as error:
        # 失败原因写进任务日志：App 只读任务日志，stderr 里的 traceback 到不了界面，
        # 否则用户只能看到底层 shell job 的「exit status 1」。
        if error.code not in (None, 0):
            message = "已取消。" if error.code == 130 else f"失败：{error}"
            print(f"[modal] {args.command} {message}", flush=True)
        raise
    except Exception as error:  # noqa: BLE001
        print(f"[modal] {args.command} 异常：{type(error).__name__}: {error}", flush=True)
        raise


if __name__ == "__main__":
    main()
