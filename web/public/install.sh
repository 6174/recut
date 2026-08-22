#!/bin/sh
# [INPUT]: 依赖 POSIX shell、curl、tar、SHA-256 工具、公开的 cdn.recut.video 发布包（R2）和用户级服务管理器
# [OUTPUT]: 带阶段日志地安装或原子升级 ~/.recut/bin/recut-service，并预置受管 Python 3.11、venv、FFmpeg 后注册/验证当前用户的常驻 service
# [POS]: web/public 的无源码安装入口；当前发布仅覆盖 macOS（Apple 芯片）与 Windows，Linux、FreeBSD 与 Intel Mac 暂不提供发布包，绝不读取或删除用户项目数据
# [PROTOCOL]: 变更时更新此头部，然后检查 README.md
set -eu

log() {
  printf '%s %s\n' "[Recut install]" "$*"
}

fail() {
  log "失败：$1" >&2
  echo "请将完整输出交给 Codex、Claude Code 或 OpenCode 诊断；不要删除 ~/.recut 中的用户数据。" >&2
  exit 1
}

if [ -z "${RECUT_HOME:-}" ] && [ -z "${HOME:-}" ]; then
  fail "需要 HOME 或 RECUT_HOME"
fi

log "检查安装器能力"
command -v curl >/dev/null 2>&1 || fail "需要 curl"
command -v tar >/dev/null 2>&1 || fail "需要 tar"
if command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | awk '{print $1}'; }
else
  fail "需要 shasum 或 sha256sum"
fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  MINGW*|MSYS*|CYGWIN*) fail "Windows 请在 PowerShell 运行: irm https://recut.video/install.ps1 | iex" ;;
  Linux) fail "暂不支持 Linux；可用 make service-build TARGET=linux-<arch> 从源码构建" ;;
  FreeBSD) fail "暂不支持 FreeBSD；可用 make service-build TARGET=freebsd-<arch> 从源码构建" ;;
  *) fail "暂不支持 $(uname -s)；可用 make service-build TARGET=<os>-<arch> 交叉编译" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) [ "$os" = darwin ] && fail "暂不支持 Intel Mac；请使用 Apple 芯片的 Mac 或参考源码构建" || arch=amd64 ;;
  *) fail "暂不支持 $(uname -m) CPU" ;;
esac

download_base=${RECUT_DOWNLOAD_BASE_URL:-https://cdn.recut.video}
download_base=${download_base%/}
archive="recut-service-$os-$arch.tar.gz"
recut_home=${RECUT_HOME:-"$HOME/.recut"}
temporary=$(mktemp -d "${TMPDIR:-/tmp}/recut-install.XXXXXX") || fail "无法创建临时目录"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

log "检测到 ${os}/${arch}；数据目录：$recut_home"
log "下载发布清单"
# latest 只存最新版 manifest 指针（含 version）；包本体在版本目录 /releases/<version>/。
curl --connect-timeout 15 --max-time 300 --fail --location --silent --show-error "$download_base/releases/latest/manifest.json" -o "$temporary/manifest.json" || fail "无法下载 release manifest"
release_version=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$temporary/manifest.json")
expected_checksum=$(sed -n "s/.*\"$os-$arch\":{\"archive\":\"$archive\",\"sha256\":\"\([^\"]*\)\"}.*/\1/p" "$temporary/manifest.json")
[ -n "$release_version" ] || fail "release manifest 缺少版本"
[ -n "$expected_checksum" ] || fail "release manifest 缺少 $os-$arch 包"
log "下载 Recut service $release_version"
curl --connect-timeout 15 --max-time 600 --fail --location --silent --show-error "$download_base/releases/$release_version/$archive" -o "$temporary/$archive" || fail "无法下载 $archive"
log "校验发布包完整性"
actual_checksum=$(sha256 "$temporary/$archive")
[ "$actual_checksum" = "$expected_checksum" ] || fail "发布包校验失败"
log "解压 service 发布包"
tar -xzf "$temporary/$archive" -C "$temporary" || fail "无法解压 $archive"
test -x "$temporary/recut-service-$os-$arch" || fail "发布包缺少 service binary"

prepare_platform_runtime() {
  tools_dir="$recut_home/tools"
  uv="$tools_dir/uv/uv"
  log "准备平台 Python 3.11、venv 与 FFmpeg"
  if [ ! -x "$uv" ]; then
    log "下载受管 Python 安装器"
    mkdir -p "$tools_dir"
    uv_installer="$temporary/uv-install.sh"
    curl --connect-timeout 15 --max-time 300 --proto '=https' --tlsv1.2 --fail --location --silent --show-error https://astral.sh/uv/install.sh -o "$uv_installer" || fail "无法下载受管 Python 安装器"
    env UV_INSTALL_DIR="$tools_dir/uv" sh "$uv_installer" || fail "无法安装受管 Python 安装器"
  else
    log "复用已安装的受管 Python 安装器"
  fi
  log "安装或复用 Python 3.11"
  "$uv" python install 3.11 || fail "无法准备 Python 3.11"
  platform_python=$("$uv" python find 3.11) || fail "无法定位受管 Python 3.11"
  platform_venv="$recut_home/python/platform/3.11"
  if [ ! -x "$platform_venv/bin/python" ]; then
    log "创建平台默认 venv"
    mkdir -p "$(dirname "$platform_venv")"
    "$platform_python" -m venv "$platform_venv" || fail "无法创建平台默认 venv"
  else
    log "复用平台默认 venv"
  fi
  log "安装平台 FFmpeg"
  "$platform_venv/bin/python" -m pip install --disable-pip-version-check --upgrade imageio-ffmpeg || fail "无法安装平台 FFmpeg"
  RECUT_PLATFORM_VENV="$platform_venv" "$platform_venv/bin/python" -c 'from pathlib import Path; import imageio_ffmpeg, os; source = Path(imageio_ffmpeg.get_ffmpeg_exe()); target = Path(os.environ["RECUT_PLATFORM_VENV"]) / "bin" / "ffmpeg"; target.unlink(missing_ok=True); target.symlink_to(source); print("[Recut install] FFmpeg 已就绪")' || fail "无法激活平台 FFmpeg"
}

prepare_platform_runtime

mkdir -p "$recut_home/bin" "$recut_home/logs"
cp "$temporary/recut-service-$os-$arch" "$recut_home/bin/recut-service.new" || fail "无法写入 service binary"
chmod 755 "$recut_home/bin/recut-service.new" || fail "无法设置 service binary 权限"
mv -f "$recut_home/bin/recut-service.new" "$recut_home/bin/recut-service" || fail "无法激活 service binary"

install_launchd() {
  xml_escape() {
    printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
  }
  launch_dir="$HOME/Library/LaunchAgents"
  plist="$launch_dir/video.recut.service.plist"
  xml_home=$(xml_escape "$recut_home")
  xml_binary=$(xml_escape "$recut_home/bin/recut-service")
  xml_log=$(xml_escape "$recut_home/logs/service.log")
  xml_error_log=$(xml_escape "$recut_home/logs/service-error.log")
  mkdir -p "$launch_dir"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>video.recut.service</string>
  <key>ProgramArguments</key><array><string>$xml_binary</string><string>--data-dir</string><string>$xml_home</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$xml_log</string>
  <key>StandardErrorPath</key><string>$xml_error_log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/video.recut.service" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist" || fail "无法注册 macOS service"
}

wait_for_service() {
  attempts=0
  while [ "$attempts" -lt 30 ]; do
    if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:17373/health >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  echo "Recut service 已注册，但未能在 http://127.0.0.1:17373/health 启动。" >&2
  print_startup_diagnostics
  return 1
}

print_startup_diagnostics() {
  echo "macOS service 日志：$recut_home/logs/service-error.log" >&2
  if [ -f "$recut_home/logs/service-error.log" ]; then
    tail -n 80 "$recut_home/logs/service-error.log" >&2 || true
  fi
  echo "launchd 状态：launchctl print gui/$(id -u)/video.recut.service" >&2
}

log "注册并启动 macOS 本地服务"
install_launchd
log "等待本地服务就绪"
wait_for_service || fail "service 启动失败"

log "完成：Recut service $release_version 已安装/升级。请刷新 https://recut.video。"
