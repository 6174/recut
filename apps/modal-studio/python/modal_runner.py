"""
[INPUT]: 平台注入的 RECUT_APP_FILES_DIR / RECUT_PYTHON；内置 modalapps/*（App 包内，只读）与用户 modalapps/*
          （--user-root，缺省 RECUT_APP_FILES_DIR，即 appstate）；<files>/modal/profiles.json（token profile 镜像）；
          --task-log 任务日志文件
[OUTPUT]: status（token profile/连通性、内置+用户预设包的部署状态、volume 就绪度与 stale（预设包目录 hash 与
          上次成功 deploy 记录不一致 → 代码已变更、需重新部署））、deploy（modal deploy 构建 Image 与函数，成功后把
          目录 hash 记进 appstate/modal/deploy-state.json）、bootstrap（modal run 把权重写进 Volume）、invoke
          （Function.from_name(...).with_options(gpu=...).spawn(...) 调用并把产物拉回本机；后台 `modal app logs
          --follow` 把云端容器日志 tee 进任务日志，避免启动崩溃只剩心跳）、invoke --mock（加载预设包 mock.py，
          对本地 mock 服务跑通同一套产物链路，不部署/不访问 Modal/GPU）、teardown（modal app stop）、secret
          （modal secret create --force）
[POS]: modal-studio 的本机薄客户端；GPU 计算与权重全在 modal.com，本机只做编排、上传参考、接收产物。预设包来源
         分内置（App 包）与用户（appstate），二者共用同一 manifest/modal_app.py/bootstrap.py 契约。modal CLI
         子进程输出逐行实时转发（bootstrap 长下载全程可见）。
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import base64
import builtins
import datetime
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
from pathlib import Path

_ORIG_PRINT = builtins.print
_TASK_LOG = None
_TASK_LOG_LOCK = threading.Lock()
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


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


def source_path(modalapp: dict, user_root: Path) -> Path:
    """由归一 manifest 解析预设包源码目录的绝对路径（内置在 App 包内，用户在 appstate）。"""
    base = app_root() if modalapp.get("origin") == "builtin" else user_root
    return base / str(modalapp.get("sourceDir") or "")


def folder_hash(source: Path) -> str:
    """整个预设包目录的确定性 sha256（相对路径 + 内容）；目录缺失返回空串。"""
    if not source.is_dir():
        return ""
    digest = hashlib.sha256()
    for path in sorted(p for p in source.rglob("*") if p.is_file()):
        parts = path.relative_to(source).parts
        if any(part in _HASH_SKIP_DIRS for part in parts):
            continue
        if path.name in _HASH_SKIP_NAMES or path.suffix in _HASH_SKIP_SUFFIXES:
            continue
        digest.update(path.relative_to(source).as_posix().encode("utf-8"))
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


def record_deploy(modalapp_id: str, source: Path) -> str:
    """部署成功后记录当前目录 hash，供后续 status 判断代码是否变更。"""
    digest = folder_hash(source)
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


def run_cli(args: list[str], timeout: int | None = None, cwd: str | None = None) -> subprocess.CompletedProcess:
    """执行 modal CLI 并**逐行实时**转发输出（长任务如 bootstrap 下载全程可见）。

    仍返回 CompletedProcess（.returncode/.stdout）：stdout 为累计文本，供 JSON 解析等调用方使用。
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
                if line.strip():
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


def start_app_log_follower(app_name: str) -> dict | None:
    """后台跟随已部署 App 的云端容器日志（含 SGLang 启动与崩溃堆栈），逐行 tee 进任务日志。

    裸 SDK 的 spawn()/get() 不会流式接收容器日志——Modal 只在 `app.run()` /
    `modal app logs` 路径打印它们；这里用一条 `modal app logs --follow` 子进程补齐，
    否则云端启动失败只会表现为「云端运行中」心跳，问题无法暴露。
    """
    try:
        process = subprocess.Popen(
            [modal_cli(), "app", "logs", app_name, "--follow", "--show-container-id", "--timestamps"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"},
        )
    except OSError as error:
        print(f"[modal] 无法连接云端日志：{error}", flush=True)
        return None
    stopped = threading.Event()

    def _pump() -> None:
        stream = process.stdout
        if stream is None:
            return
        try:
            for raw in stream:
                if stopped.is_set():
                    break
                line = raw.rstrip()
                if line:
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
    """返回 (connected, deployed app names, error)。"""
    try:
        process = run_cli(["app", "list", "--json"], timeout=60)
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


def volume_exists(name: str) -> bool:
    try:
        process = run_cli(["volume", "ls", name], timeout=60)
    except FileNotFoundError:
        return False
    return process.returncode == 0


def volume_ready(modalapp: dict) -> bool:
    volumes = modalapp.get("volumes") or []
    if not volumes:
        return True
    models_volume = volumes[0]["name"]
    if not volume_exists(models_volume):
        return False
    try:
        process = run_cli(["volume", "ls", models_volume], timeout=60)
    except FileNotFoundError:
        return False
    # bootstrap 在权重目录根部写 .recut-download-complete 作为完成标记。
    return process.returncode == 0 and ".recut-download-complete" in (process.stdout or "")


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
    states = {}
    user_root = user_root_of(args)
    deploy_state = load_deploy_state()
    for modalapp in all_modalapps(user_root):
        app_name = modalapp.get("appName") or modalapp["id"]
        deployed = app_name in names
        current_hash = folder_hash(source_path(modalapp, user_root))
        recorded_hash = (deploy_state.get(modalapp["id"]) or {}).get("deployHash") or ""
        states[modalapp["id"]] = {
            "deployed": deployed,
            "volumeReady": volume_ready(modalapp) if deployed else False,
            # 已部署但目录 hash 与上次成功部署记录不一致（含首次接入无记录）→ 代码已变更，需重新部署。
            "stale": deployed and current_hash != "" and recorded_hash != current_hash,
        }
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
    process = run_cli(["deploy", "modal_app.py"], cwd=str(source))
    if process.returncode != 0:
        raise SystemExit("modal deploy failed")
    record_deploy(manifest["id"], source)
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
    weight_source = args.weight_source or "automatic"
    print(f"[modal] 正在准备 {manifest['id']} 权重（source={weight_source}）…", flush=True)
    process = run_cli(["run", "bootstrap.py", "--source", weight_source], cwd=str(source))
    if process.returncode != 0:
        raise SystemExit("modal bootstrap failed")
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
        out.append({"name": entry.get("name") or path.name, "mimeType": entry.get("mimeType") or "", "data": path.read_bytes()})
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

    follower = start_app_log_follower(app_name)
    print(f"[modal] 已跟随云端日志（{app_name}）。", flush=True)
    started = time.time()
    call = handle.spawn(**params, refs=references)

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
    finally:
        signal.signal(signal.SIGTERM, previous)
        stop_app_log_follower(follower)
    if cancelled["flag"]:
        raise SystemExit(130)

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

    secret_parser = sub.add_parser("secret")
    secret_parser.add_argument("--name", required=True)
    secret_parser.add_argument("--secret-file", required=True)
    common(secret_parser)

    args = parser.parse_args()
    resolve_task_log(args.task_log)

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
    elif args.command == "secret":
        payload = cmd_secret(args)
    else:  # pragma: no cover
        raise SystemExit(f"unknown command: {args.command}")

    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
