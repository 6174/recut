#!/usr/bin/env bash
# [INPUT]: 接收 Makefile 构建出的二进制路径和 RECUT_HOME
# [OUTPUT]: 为当前用户安装并启动 Recut 常驻 service
# [POS]: scripts 的系统集成器；只写 ~/.recut 与用户级服务管理器配置
# [PROTOCOL]: 变更时更新此头部，然后检查 README.md
set -euo pipefail

binary_path=${1:?"usage: install-service.sh <recut-service binary>"}
recut_home=${RECUT_HOME:-"$HOME/.recut"}
service_bin="$recut_home/bin/recut-service"
log_dir="$recut_home/logs"

mkdir -p "$recut_home/bin" "$log_dir"
install -m 755 "$binary_path" "$service_bin"

case "$(uname -s)" in
  Darwin)
    launch_dir="$HOME/Library/LaunchAgents"
    plist="$launch_dir/video.recut.service.plist"
    mkdir -p "$launch_dir"
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>video.recut.service</string>
  <key>ProgramArguments</key><array><string>$service_bin</string><string>--data-dir</string><string>$recut_home</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$log_dir/service.log</string>
  <key>StandardErrorPath</key><string>$log_dir/service-error.log</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/video.recut.service" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
    ;;
  Linux)
    unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    unit="$unit_dir/recut.service"
    mkdir -p "$unit_dir"
    cat > "$unit" <<UNIT
[Unit]
Description=Recut local service
[Service]
ExecStart=$service_bin --data-dir $recut_home
Restart=on-failure
RestartSec=3
[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now recut.service
    ;;
  *)
    echo "Installed $service_bin. Start it manually: $service_bin --data-dir $recut_home" >&2
    ;;
esac

echo "Recut service is installed. Open https://recut.video and wait for LOCAL SERVICE CONNECTED."
