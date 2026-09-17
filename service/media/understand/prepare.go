/*
 * [INPUT]: 依赖平台数据目录布局（<dataDir>/python/platform/<ver>）
 * [OUTPUT]: 平台理解环境的身份与准备：Python 路径解析、依赖锁哈希、跨平台准备脚本（pip 安装 + 取 ffmpeg/ffprobe + 写版本标记）
 * [POS]: media/understand 的环境生命周期入口；调用方经 ShellJobManager 异步执行，绝不静默安装
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// UnderstandToolVersion identifies the understanding evidence schema. It is
// persisted with reference evidence so a later reader knows which writer
// produced it.
const UnderstandToolVersion = "understand-1"

// UnderstandLockFile is the version marker written into the platform venv after
// a successful prepare. A changed lock hash marks the environment stale.
const UnderstandLockFile = ".recut-understand"

// UnderstandingDependencies is the locked dependency set for the understanding
// tools. ffprobe comes from static-ffmpeg (imageio-ffmpeg ships ffmpeg only).
var UnderstandingDependencies = []string{
	"static-ffmpeg",
	"scenedetect",
	"opencv-python-headless",
	"Pillow",
	"numpy",
}

// UnderstandLockHash is a stable hash of the dependency set plus tool version,
// used to detect that a prepared environment is out of date.
func UnderstandLockHash() string {
	sum := sha256.Sum256([]byte(UnderstandToolVersion + "\n" + strings.Join(UnderstandingDependencies, "\n")))
	return hex.EncodeToString(sum[:8])
}

// PlatformPythonPath resolves the platform venv Python. It returns "" when the
// installer-created venv is absent.
func PlatformPythonPath(dataDir string) string {
	venv := platformVenvDir(dataDir)
	candidate := filepath.Join(venv, "bin", "python")
	if runtime.GOOS == "windows" {
		candidate = filepath.Join(venv, "Scripts", "python.exe")
	}
	if _, err := os.Stat(candidate); err != nil {
		return ""
	}
	return candidate
}

// PlatformBinDir is where ffmpeg/ffprobe and other managed binaries live.
func PlatformBinDir(dataDir string) string {
	venv := platformVenvDir(dataDir)
	if runtime.GOOS == "windows" {
		return filepath.Join(venv, "Scripts")
	}
	return filepath.Join(venv, "bin")
}

// PrepareArgs returns the command and args a ShellJob runs to prepare the
// platform understanding environment. Using the venv Python itself keeps the
// step cross-platform (no shell dialect) and idempotent.
func PrepareArgs(dataDir string) (string, []string, bool) {
	python := PlatformPythonPath(dataDir)
	if python == "" {
		return "", nil, false
	}
	return python, []string{"-c", PrepareScript(dataDir)}, true
}

// PrepareScript installs the locked dependencies and materializes ffprobe (and
// ffmpeg when missing) into the venv bin, then writes the version marker. It is
// idempotent and never invoked implicitly by a read-only tool.
func PrepareScript(dataDir string) string {
	deps := strings.Join(UnderstandingDependencies, " ")
	binDir := filepath.ToSlash(PlatformBinDir(dataDir))
	marker := filepath.ToSlash(filepath.Join(platformVenvDir(dataDir), UnderstandLockFile))
	return fmt.Sprintf(`import json, os, shutil, stat, subprocess, sys
from pathlib import Path

print("[understand] 正在安装平台理解依赖 ...")
subprocess.check_call([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--upgrade"] + %q.split())

print("[understand] 正在获取 ffmpeg/ffprobe ...")
fetched = []
try:
    from static_ffmpeg import run as static_run
    pair = static_run.get_or_fetch_platform_executables_else_raise()
    if isinstance(pair, (tuple, list)):
        fetched = [item for item in pair if item]
except Exception as exc:
    print("[understand] static-ffmpeg 获取失败: %%s" %% exc, file=sys.stderr)
try:
    import imageio_ffmpeg
    fetched.append(imageio_ffmpeg.get_ffmpeg_exe())
except Exception:
    pass

target_bin = Path(r"%s")
target_bin.mkdir(parents=True, exist_ok=True)
for want in ("ffmpeg", "ffprobe"):
    name = want + (".exe" if os.name == "nt" else "")
    destination = target_bin / name
    if destination.exists():
        continue
    source = None
    for candidate in fetched:
        if Path(candidate).name.lower().startswith(want):
            source = candidate
            break
    if source:
        shutil.copy2(source, destination)
        os.chmod(destination, os.stat(destination).st_mode | stat.S_IEXEC)
        print("[understand] 已就绪: %%s" %% destination)
    else:
        print("[understand] 未取得 %%s（对应工具将不可用）" %% name, file=sys.stderr)

try:
    Path(r"%s").write_text(json.dumps({"toolVersion": %q, "lockHash": %q}))
except Exception as exc:
    print("[understand] 写入版本标记失败: %%s" %% exc, file=sys.stderr)
print("[understand] 平台理解环境准备完成")
`, deps, binDir, marker, UnderstandToolVersion, UnderstandLockHash())
}
