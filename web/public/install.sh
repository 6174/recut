#!/bin/sh
# [INPUT]: 依赖 POSIX shell、curl、tar、SHA-256 工具、公开的 recut.video 静态发布包和用户级服务管理器
# [OUTPUT]: 安装或原子升级 ~/.recut/bin/recut-service，在 macOS/Linux 注册并验证当前用户的常驻 service
# [POS]: web/public 的无源码 Unix 安装入口；覆盖 macOS、Linux 和 FreeBSD，绝不读取或删除用户项目数据
# [PROTOCOL]: 变更时更新此头部，然后检查 README.md
set -eu

fail() {
  echo "Recut installer: $1" >&2
  echo "请将完整输出交给 Codex、Claude Code 或 OpenCode 诊断；不要删除 ~/.recut 中的用户数据。" >&2
  exit 1
}

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
  Linux) os=linux ;;
  FreeBSD) os=freebsd ;;
  MINGW*|MSYS*|CYGWIN*) fail "Windows 请在 PowerShell 运行: irm https://recut.video/install.ps1 | iex" ;;
  *) fail "暂不支持 $(uname -s)；可用 make service-build TARGET=<os>-<arch> 交叉编译" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=amd64 ;;
  *) fail "暂不支持 $(uname -m) CPU" ;;
esac

download_base=${RECUT_DOWNLOAD_BASE_URL:-https://recut.video}
archive="recut-service-$os-$arch.tar.gz"
recut_home=${RECUT_HOME:-"$HOME/.recut"}
temporary=$(mktemp -d "${TMPDIR:-/tmp}/recut-install.XXXXXX") || fail "无法创建临时目录"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

curl --fail --location --silent --show-error "$download_base/releases/latest/manifest.json" -o "$temporary/manifest.json" || fail "无法下载 release manifest"
release_version=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$temporary/manifest.json")
expected_checksum=$(sed -n "s/.*\"$os-$arch\":{\"archive\":\"$archive\",\"sha256\":\"\([^\"]*\)\"}.*/\1/p" "$temporary/manifest.json")
[ -n "$release_version" ] || fail "release manifest 缺少版本"
[ -n "$expected_checksum" ] || fail "release manifest 缺少 $os-$arch 包"
curl --fail --location --silent --show-error "$download_base/releases/latest/$archive" -o "$temporary/$archive" || fail "无法下载 $archive"
actual_checksum=$(sha256 "$temporary/$archive")
[ "$actual_checksum" = "$expected_checksum" ] || fail "发布包校验失败"
tar -xzf "$temporary/$archive" -C "$temporary" || fail "无法解压 $archive"
test -x "$temporary/recut-service-$os-$arch" || fail "发布包缺少 service binary"

mkdir -p "$recut_home/bin" "$recut_home/logs"
cp "$temporary/recut-service-$os-$arch" "$recut_home/bin/recut-service.new" || fail "无法写入 service binary"
chmod 755 "$recut_home/bin/recut-service.new" || fail "无法设置 service binary 权限"
mv -f "$recut_home/bin/recut-service.new" "$recut_home/bin/recut-service" || fail "无法激活 service binary"

install_launchd() {
  launch_dir="$HOME/Library/LaunchAgents"
  plist="$launch_dir/video.recut.service.plist"
  mkdir -p "$launch_dir"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>video.recut.service</string>
  <key>ProgramArguments</key><array><string>$recut_home/bin/recut-service</string><string>--data-dir</string><string>$recut_home</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$recut_home/logs/service.log</string>
  <key>StandardErrorPath</key><string>$recut_home/logs/service-error.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/video.recut.service" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist" || fail "无法注册 macOS service"
}

install_systemd_user() {
  unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  unit="$unit_dir/recut.service"
  mkdir -p "$unit_dir"
  cat > "$unit" <<UNIT
[Unit]
Description=Recut local service

[Service]
ExecStart=$recut_home/bin/recut-service --data-dir $recut_home
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload && systemctl --user enable --now recut.service
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
  if [ "$os" = "darwin" ]; then
    echo "macOS service 日志：$recut_home/logs/service-error.log" >&2
    if [ -f "$recut_home/logs/service-error.log" ]; then
      tail -n 80 "$recut_home/logs/service-error.log" >&2 || true
    fi
    echo "launchd 状态：launchctl print gui/$(id -u)/video.recut.service" >&2
    return
  fi
  echo "Linux service 日志：journalctl --user -u recut.service -n 80 --no-pager" >&2
  if command -v journalctl >/dev/null 2>&1; then
    journalctl --user -u recut.service -n 80 --no-pager >&2 || true
  fi
}

case "$os" in
  darwin) install_launchd; wait_for_service || fail "service 启动失败" ;;
  linux)
    if command -v systemctl >/dev/null 2>&1 && install_systemd_user; then wait_for_service || fail "service 启动失败";
    else
      echo "Recut service 已安装，但当前 Unix 会话没有可用的 systemd user manager。" >&2
      echo "请用以下命令启动：$recut_home/bin/recut-service --data-dir $recut_home" >&2
    fi
    ;;
  freebsd)
    echo "Recut service 已安装。请由服务器进程管理器启动：$recut_home/bin/recut-service --data-dir $recut_home" >&2
    ;;
esac

echo "Recut service $release_version 已安装/升级。请刷新 https://recut.video。"
