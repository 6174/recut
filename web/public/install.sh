#!/bin/sh
# [INPUT]: 依赖 macOS、curl、tar、公开的 recut.video 静态发布包和 launchd
# [OUTPUT]: 安装或原子升级 ~/.recut/bin/recut-service，并注册/重启当前用户的 launchd service
# [POS]: web/public 的无源码 macOS 安装入口；同一脚本服务首次安装与升级，绝不读取或删除用户项目数据
# [PROTOCOL]: 变更时更新此头部，然后检查 README.md
set -eu

fail() {
  echo "Recut installer: $1" >&2
  echo "请将完整输出交给 Codex 或 Claude Code 诊断；不要删除 ~/.recut 中的用户数据。" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "需要 curl"
command -v tar >/dev/null 2>&1 || fail "需要 tar"
command -v shasum >/dev/null 2>&1 || fail "需要 shasum"

[ "$(uname -s)" = "Darwin" ] || fail "当前安装器暂只支持 macOS"
os=darwin

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
actual_checksum=$(shasum -a 256 "$temporary/$archive" | awk '{print $1}')
[ "$actual_checksum" = "$expected_checksum" ] || fail "发布包校验失败"
tar -xzf "$temporary/$archive" -C "$temporary" || fail "无法解压 $archive"
test -x "$temporary/recut-service-$os-$arch" || fail "发布包缺少 service binary"

mkdir -p "$recut_home/bin" "$recut_home/logs"
install -m 755 "$temporary/recut-service-$os-$arch" "$recut_home/bin/recut-service.new" || fail "无法写入 service binary"
mv -f "$recut_home/bin/recut-service.new" "$recut_home/bin/recut-service" || fail "无法激活 service binary"

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

echo "Recut service $release_version 已安装/升级。请刷新 https://recut.video。"
