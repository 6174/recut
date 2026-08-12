/*
 * [INPUT]: 依赖 Catalog 的 PythonRuntime、ShellJobManager 与 App 包内 requirements/bootstrap 文件
 * [OUTPUT]: 对外提供 manifest 驱动的 Python venv 路径、状态检查和异步准备任务
 * [POS]: service 的 Python 环境生命周期；平台拥有 venv 与依赖指纹，App 的 bootstrap 仍可自由执行额外安装逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type PythonEnvironment struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Python  string `json:"python"`
	Version string `json:"version,omitempty"`
	Ready   bool   `json:"ready"`
	Error   string `json:"error,omitempty"`
}
type PythonRuntimeManager struct {
	store *Store
	jobs  *ShellJobManager
}

const (
	platformPythonVersion = "3.11"
	platformPythonVenv    = "platform"
)

func NewPythonRuntimeManager(store *Store, jobs *ShellJobManager) *PythonRuntimeManager {
	return &PythonRuntimeManager{store: store, jobs: jobs}
}

func (m *PythonRuntimeManager) Environment(app App) (PythonEnvironment, error) {
	definition := app.Manifest.Runtime.Python
	if definition == nil {
		return PythonEnvironment{}, errors.New("App does not declare a Python runtime")
	}
	fingerprint, err := runtimeFingerprint(app.Root, *definition)
	if err != nil {
		return PythonEnvironment{}, err
	}
	path := filepath.Join(m.store.root, "python", "envs", app.Manifest.ID, runtimeVenvName(*definition), fingerprint)
	python := filepath.Join(path, "bin", "python")
	if runtime.GOOS == "windows" {
		python = filepath.Join(path, "Scripts", "python.exe")
	}
	env := PythonEnvironment{Name: runtimeVenvName(*definition), Path: path, Python: python, Version: runtimePythonVersion(*definition), Ready: false}
	if _, err := os.Stat(python); err == nil {
		if !venvMatchesPythonVersion(path, env.Version) {
			env.Error = fmt.Sprintf("existing environment was created with a different Python version; prepare it again with Python %s", env.Version)
		} else {
			env.Ready = true
		}
	} else if !os.IsNotExist(err) {
		env.Error = err.Error()
	}
	return env, nil
}

func (m *PythonRuntimeManager) Prepare(projectID string, app App, filesRoot, modelsRoot string) (ShellJob, error) {
	env, err := m.Environment(app)
	if err != nil {
		return ShellJob{}, err
	}
	runtime := app.Manifest.Runtime.Python
	command, err := runtimePythonCommand(*runtime)
	if err != nil {
		return ShellJob{}, err
	}
	commandName, arguments, err := pythonPrepareCommand(*runtime)
	if err != nil {
		return ShellJob{}, err
	}
	environment := append(m.environment(env, filesRoot, modelsRoot), "RECUT_PYTHON_COMMAND="+command, "RECUT_PYTHON_VERSION="+runtimePythonVersion(*runtime), "RECUT_TOOLCHAIN_DIR="+filepath.Join(m.store.root, "tools"))
	if runtime.Requirements != "" {
		environment = append(environment, "RECUT_PYTHON_REQUIREMENTS="+filepath.Join(app.Root, runtime.Requirements))
	}
	if runtime.Bootstrap != "" {
		environment = append(environment, "RECUT_PYTHON_BOOTSTRAP="+filepath.Join(app.Root, runtime.Bootstrap))
	}
	return m.jobs.Start(ShellJobStart{ProjectID: projectID, AppID: app.Manifest.ID, Command: commandName, Args: arguments, Dir: app.Root, Env: environment, TimeoutSeconds: 1800})
}

func (m *PythonRuntimeManager) environment(env PythonEnvironment, filesRoot, modelsRoot string) []string {
	return []string{"RECUT_APP_FILES_DIR=" + filesRoot, "RECUT_MODELS_DIR=" + modelsRoot, "RECUT_VENV=" + env.Path, "RECUT_PYTHON=" + env.Python, "PATH=" + prependPythonEnvironmentPath(env.Path, environmentValue(userBaseEnv(), "PATH"))}
}

func prependPythonEnvironmentPath(venv, basePath string) string {
	bin := filepath.Join(venv, "bin")
	if runtime.GOOS == "windows" {
		bin = filepath.Join(venv, "Scripts")
	}
	if basePath == "" {
		return bin
	}
	return bin + string(os.PathListSeparator) + basePath
}
func runtimeFingerprint(root string, runtime PythonRuntime) (string, error) {
	content := runtimePythonVersion(runtime) + "\n" + runtimeVenvName(runtime)
	content += "\n" + strings.Join(runtime.Tools, ",")
	if runtime.Requirements != "" {
		data, err := os.ReadFile(filepath.Join(root, runtime.Requirements))
		if err != nil {
			return "", fmt.Errorf("read Python requirements: %w", err)
		}
		content += "\n" + string(data)
	}
	sum := sha256.Sum256([]byte(strings.TrimSpace(content)))
	return hex.EncodeToString(sum[:8]), nil
}

func runtimePythonCommand(definition PythonRuntime) (string, error) {
	version := runtimePythonVersion(definition)
	if !validPythonVersion(version) {
		return "", fmt.Errorf("invalid requested Python version %q", definition.Version)
	}
	return "python" + version, nil
}

func runtimePythonVersion(definition PythonRuntime) string {
	if definition.Version == "" {
		return platformPythonVersion
	}
	return definition.Version
}

func runtimeVenvName(definition PythonRuntime) string {
	if definition.Venv == "" {
		return platformPythonVenv
	}
	return definition.Venv
}

func venvMatchesPythonVersion(path, version string) bool {
	if version == "" {
		return true
	}
	data, err := os.ReadFile(filepath.Join(path, "pyvenv.cfg"))
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, found := strings.Cut(line, "=")
		if found && strings.TrimSpace(key) == "version" {
			return strings.HasPrefix(strings.TrimSpace(value), version+".") || strings.TrimSpace(value) == version
		}
	}
	return false
}

func preparePythonScript() string {
	return "set -eu\nprintf '%s\\n' '[python] 正在准备受管 Python 工具链。'\nif ! command -v \"$RECUT_PYTHON_COMMAND\" >/dev/null 2>&1; then\n  uv=\"$RECUT_TOOLCHAIN_DIR/uv/uv\"\n  if [ ! -x \"$uv\" ]; then\n    mkdir -p \"$RECUT_TOOLCHAIN_DIR\"\n    curl --proto '=https' --tlsv1.2 -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=\"$RECUT_TOOLCHAIN_DIR/uv\" sh\n  fi\n  \"$uv\" python install \"$RECUT_PYTHON_VERSION\"\n  RECUT_PYTHON_COMMAND=\"$(\"$uv\" python find \"$RECUT_PYTHON_VERSION\")\"\nfi\nprintf '%s\\n' '[python] 正在创建隔离运行环境。'\nif [ -x \"$RECUT_PYTHON\" ]; then\n  actual_version=\"$(\"$RECUT_PYTHON\" -c 'import sys; print(f\"{sys.version_info.major}.{sys.version_info.minor}\")' 2>/dev/null || true)\"\n  if [ \"$actual_version\" != \"$RECUT_PYTHON_VERSION\" ]; then\n    printf '%s\\n' \"[python] 正在移除由 Python $actual_version 创建的不兼容环境。\"\n    rm -rf \"$RECUT_VENV\"\n  fi\nfi\n\"$RECUT_PYTHON_COMMAND\" -m venv \"$RECUT_VENV\"\nprintf '%s\\n' '[python] 正在升级 pip。'\n\"$RECUT_PYTHON\" -m pip install --upgrade pip\n"
}

func pythonPrepareCommand(definition PythonRuntime) (string, []string, error) {
	if runtime.GOOS == "windows" {
		if definition.Bootstrap != "" && filepath.Ext(definition.Bootstrap) != ".py" {
			return "", nil, fmt.Errorf("Python App bootstrap %q is not portable; Windows requires a .py bootstrap", definition.Bootstrap)
		}
		return "powershell.exe", []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", preparePythonPowerShell(definition.Tools)}, nil
	}
	script := preparePythonScript()
	if definition.Requirements != "" {
		script += "printf '%s\\n' '[python] 正在安装锁定依赖。'\n\"$RECUT_PYTHON\" -m pip install --requirement \"$RECUT_PYTHON_REQUIREMENTS\"\n"
	}
	script += preparePythonTools(definition.Tools)
	if definition.Bootstrap != "" {
		if filepath.Ext(definition.Bootstrap) == ".py" {
			script += "printf '%s\\n' '[python] 正在准备应用代码。'\n\"$RECUT_PYTHON\" \"$RECUT_PYTHON_BOOTSTRAP\"\n"
		} else {
			script += "printf '%s\\n' '[python] 正在准备应用代码。'\nsh \"$RECUT_PYTHON_BOOTSTRAP\"\n"
		}
	}
	return "sh", []string{"-eu", "-c", script}, nil
}

func preparePythonPowerShell(tools []string) string {
	script := "$ErrorActionPreference = 'Stop'\nWrite-Output '[python] 正在准备受管 Python 工具链。'\nif (-not (Get-Command $env:RECUT_PYTHON_COMMAND -ErrorAction SilentlyContinue)) {\n  $uv = Join-Path $env:RECUT_TOOLCHAIN_DIR 'uv\\uv.exe'\n  if (-not (Test-Path -LiteralPath $uv -PathType Leaf)) {\n    New-Item -ItemType Directory -Force -Path $env:RECUT_TOOLCHAIN_DIR | Out-Null\n    $env:UV_INSTALL_DIR = (Join-Path $env:RECUT_TOOLCHAIN_DIR 'uv')\n    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression\n  }\n  & $uv python install $env:RECUT_PYTHON_VERSION\n  $env:RECUT_PYTHON_COMMAND = (& $uv python find $env:RECUT_PYTHON_VERSION).Trim()\n}\nWrite-Output '[python] 正在创建隔离运行环境。'\nif (Test-Path -LiteralPath $env:RECUT_PYTHON -PathType Leaf) {\n  $actualVersion = (& $env:RECUT_PYTHON -c 'import sys; print(f\"{sys.version_info.major}.{sys.version_info.minor}\")').Trim()\n  if ($actualVersion -ne $env:RECUT_PYTHON_VERSION) { Remove-Item -LiteralPath $env:RECUT_VENV -Recurse -Force -ErrorAction SilentlyContinue }\n}\n& $env:RECUT_PYTHON_COMMAND -m venv $env:RECUT_VENV\nWrite-Output '[python] 正在升级 pip。'\n& $env:RECUT_PYTHON -m pip install --upgrade pip\nif ($env:RECUT_PYTHON_REQUIREMENTS) { Write-Output '[python] 正在安装锁定依赖。'; & $env:RECUT_PYTHON -m pip install --requirement $env:RECUT_PYTHON_REQUIREMENTS }\n"
	if len(tools) > 0 {
		script += "Write-Output '[python] 正在准备 FFmpeg。'\n& $env:RECUT_PYTHON -m pip install --disable-pip-version-check imageio-ffmpeg\n& $env:RECUT_PYTHON -c 'from pathlib import Path; import imageio_ffmpeg, os, shutil; source = Path(imageio_ffmpeg.get_ffmpeg_exe()); target = Path(os.environ[\"RECUT_VENV\"]) / \"Scripts\" / \"ffmpeg.exe\"; target.unlink(missing_ok=True); shutil.copy2(source, target)'\n"
	}
	return script + "if ($env:RECUT_PYTHON_BOOTSTRAP) { Write-Output '[python] 正在准备应用代码。'; & $env:RECUT_PYTHON $env:RECUT_PYTHON_BOOTSTRAP }\n"
}

func preparePythonTools(tools []string) string {
	for _, tool := range tools {
		if tool == "ffmpeg" {
			return "printf '%s\\n' '[python] 正在准备 FFmpeg。'\n\"$RECUT_PYTHON\" -m pip install --disable-pip-version-check imageio-ffmpeg\n\"$RECUT_PYTHON\" -c 'from pathlib import Path; import imageio_ffmpeg, os, shutil; source = Path(imageio_ffmpeg.get_ffmpeg_exe()); scripts = \"Scripts\" if os.name == \"nt\" else \"bin\"; name = \"ffmpeg.exe\" if os.name == \"nt\" else \"ffmpeg\"; target = Path(os.environ[\"RECUT_VENV\"]) / scripts / name; target.unlink(missing_ok=True); shutil.copy2(source, target); print(f\"[python] FFmpeg 已就绪：{source.name}\")'\n"
		}
	}
	return ""
}
