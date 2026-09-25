"""
[INPUT]: 仅标准库；命令行 --host/--port/--delay/--selftest；参考帧 file:// 必须指向本机可读文件
[OUTPUT]: 本地 mock 的 SGLang 视频服务：GET /health、GET /v1/models、POST /v1/videos（按 H3 契约校验，
          非法返回 {"detail": ...} 400；合法返回 {id,status}）、GET /v1/videos（列表）、
          GET /v1/videos/{id}（状态）、GET /v1/videos/{id}/content（返回内嵌的极小合法 mp4）
[POS]: minimax-h3 的零成本本地替身：`python mock_sglang.py --port 30010` 启动后，配合
       `modal_runner.py invoke --mock` 即可在没有 GPU/Modal 的情况下秒级跑通整条链路并复现 400
[PROTOCOL]: 变更时更新此头部，然后检查 README.md
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from h3_contract import (MAX_SECONDS, MIN_SECONDS, MODEL_NAME, VALID_TASKS, build_video_body,
                         submit_video)

# 1s / 64x64 / 8fps 的黑色 mp4（含静音 AAC 轨），仅用于本地链路验证。
_TINY_MP4 = base64.b64decode(
    "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"
)

_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

_VIDEOS: dict = {}
_LOCK = threading.Lock()
_DELAY = 1.0


def validate(body) -> str | None:
    """按 H3/SGLang 的请求契约校验；返回错误 detail（None 表示合法）。"""
    if not isinstance(body, dict):
        return "request body must be a JSON object"
    task = body.get("task")
    if task not in VALID_TASKS:
        return f"task must be one of {list(VALID_TASKS)}, got {task!r}"
    seed = body.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        return f"seed must be a non-negative int or list of ints, got {seed!r}"
    # 真实 SGLang 对 seconds 宽松（数字字符串会被强制转换），但 duration_seconds 严格要求 number。
    seconds = body.get("seconds")
    if isinstance(seconds, bool):
        return "seconds must be an integer"
    if isinstance(seconds, str):
        try:
            int(seconds)
        except ValueError:
            return f"seconds must be an integer, got {seconds!r}"
    elif not isinstance(seconds, int):
        return "seconds must be an integer"
    target = body.get("target") or {}
    duration = target.get("duration_seconds")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        return "target.duration_seconds must be a number"
    if not (MIN_SECONDS <= float(duration) <= MAX_SECONDS):
        return f"target.duration_seconds must be between {MIN_SECONDS} and {MAX_SECONDS}, got {duration!r}"
    steps = body.get("num_inference_steps")
    if isinstance(steps, bool) or not isinstance(steps, int) or steps < 1:
        return "num_inference_steps must be a positive integer"
    conditions = body.get("conditions") or []
    if not isinstance(conditions, list):
        return "conditions must be a list"
    if task == "t2va" and conditions:
        return "t2va does not accept conditions"
    if task == "fl2va":
        if not conditions:
            return "fl2va requires one or two keyframe image conditions"
        if len(conditions) > 2:
            return "fl2va accepts at most two keyframe images"
        frames = []
        for condition in conditions:
            if not isinstance(condition, dict) or condition.get("type") != "image" or condition.get("role") != "keyframe":
                return "fl2va conditions must be images with role 'keyframe'"
            uri = str(condition.get("uri") or "")
            if not uri.startswith("file://") or not Path(uri[7:]).is_file():
                return f"fl2va keyframe not readable: {uri or '<empty>'}"
            frames.append(condition.get("frame_index"))
        if frames not in ([0], [-1], [0, -1]):
            return f"fl2va unsupported frame_index set {frames}; supported: [0], [-1], [0, -1]"
    return None


class _Handler(BaseHTTPRequestHandler):
    server_version = "mock-sglang/0.1"

    def log_message(self, fmt, *args):  # noqa: A003
        sys.stderr.write("[mock] " + (fmt % args) + "\n")

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, code, content_type, payload):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _public(self, item):
        elapsed = time.time() - item["created_at"]
        if elapsed >= _DELAY:
            status, progress = "completed", 100
        else:
            status, progress = "in_progress", int(100 * elapsed / max(_DELAY, 0.001))
        return {**item, "status": status, "progress": progress}

    def do_GET(self):  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/health":
            self._bytes(200, "text/plain", b"ok")
            return
        if path == "/v1/models":
            self._json(200, {"object": "list", "data": [
                {"id": MODEL_NAME, "object": "model", "owned_by": "sglang", "task_type": "FL2VA"}]})
            return
        if path == "/v1/videos":
            with _LOCK:
                items = [self._public(v) for v in _VIDEOS.values()]
            self._json(200, {"object": "list", "data": items})
            return
        match = re.fullmatch(r"/v1/videos/([^/]+)(/content)?", path)
        if match:
            video_id, want_content = match.group(1), match.group(2)
            with _LOCK:
                item = _VIDEOS.get(video_id)
            if not item:
                self._json(404, {"detail": f"video {video_id} not found"})
                return
            if want_content:
                self._bytes(200, "video/mp4", _TINY_MP4)
                return
            self._json(200, self._public(item))
            return
        self._json(404, {"detail": "not found"})

    def do_POST(self):  # noqa: N802
        if urlsplit(self.path).path != "/v1/videos":
            self._json(404, {"detail": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            self._json(400, {"detail": "invalid JSON body"})
            return
        error = validate(body)
        if error:
            self._json(400, {"detail": error})
            return
        video_id = "video_" + uuid.uuid4().hex[:24]
        with _LOCK:
            _VIDEOS[video_id] = {"id": video_id, "object": "video", "created_at": time.time()}
        self._json(200, {"id": video_id, "object": "video", "status": "queued", "progress": 0})


def _serve(host: str, port: int) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), _Handler)


def run_selftest() -> int:
    global _DELAY
    _DELAY = 0.0
    server = _serve("127.0.0.1", 0)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    failures = []

    def check(name, run):
        try:
            run()
            print(f"PASS  {name}")
        except Exception as error:  # noqa: BLE001
            failures.append(name)
            print(f"FAIL  {name}: {error}")

    def assert_mp4(data):
        assert isinstance(data, (bytes, bytearray)) and len(data) > 0, f"empty video: {data!r}"

    check("t2va 端到端返回 mp4",
          lambda: assert_mp4(submit_video(base, build_video_body("a cat", duration_sec=5, steps=4, seed=1), log=None)))

    def fl2va_ok():
        import tempfile
        directory = Path(tempfile.mkdtemp())
        frame = directory / "ref0.png"
        frame.write_bytes(_TINY_PNG)
        conditions = [{"type": "image", "uri": frame.as_uri(), "role": "keyframe", "frame_index": 0}]
        body = build_video_body("continue", aspect_ratio="auto", duration_sec=5, steps=4, seed=2, conditions=conditions)
        assert_mp4(submit_video(base, body, log=None))

    check("fl2va 端到端返回 mp4", fl2va_ok)

    def rejects(field, mutate, needle):
        body = build_video_body("x", duration_sec=5, steps=4, seed=1)
        mutate(body)
        try:
            submit_video(base, body, log=None)
        except RuntimeError as error:
            assert needle in str(error), f"expected {needle!r}, got {error}"
            return
        raise AssertionError(f"expected 400 for {field}")

    check("seed=-1 被拒", lambda: rejects("seed", lambda b: b.update(seed=-1), "seed must be a non-negative"))
    check("duration_seconds 字符串被拒",
          lambda: rejects("duration_seconds", lambda b: b.update(target={**b["target"], "duration_seconds": "5"}),
                          "target.duration_seconds must be a number"))

    def string_seconds_ok():
        body = build_video_body("x", duration_sec=5, steps=4, seed=1)
        body["seconds"] = "5"
        assert_mp4(submit_video(base, body, log=None))

    check("seconds 数字字符串可被接受", string_seconds_ok)

    def missing_ref():
        conditions = [{"type": "image", "uri": Path("/nonexistent/ref.png").as_uri(),
                       "role": "keyframe", "frame_index": 0}]
        body = build_video_body("x", duration_sec=5, steps=4, seed=1, conditions=conditions)
        try:
            submit_video(base, body, log=None)
        except RuntimeError as error:
            assert "keyframe not readable" in str(error), str(error)
            return
        raise AssertionError("expected 400 for missing keyframe")

    check("缺失参考帧被拒", missing_ref)

    server.shutdown()
    if failures:
        print(f"\n{len(failures)} 项失败：{', '.join(failures)}")
        return 1
    print("\n全部通过：H3 契约与异步视频协议在本地跑通。")
    return 0


def main() -> int:
    global _DELAY
    parser = argparse.ArgumentParser(description="本地 mock 的 SGLang MiniMax-H3 /v1/videos 服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=30010)
    parser.add_argument("--delay", type=float, default=1.0, help="每个视频任务从入队到完成的秒数")
    parser.add_argument("--selftest", action="store_true", help="起临时服务并跑契约自检后退出")
    args = parser.parse_args()
    if args.selftest:
        return run_selftest()
    _DELAY = args.delay
    server = _serve(args.host, args.port)
    print(f"[mock] SGLang 替身已启动：http://{args.host}:{args.port}（delay={args.delay}s，Ctrl+C 退出）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
