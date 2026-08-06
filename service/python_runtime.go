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
	Name   string `json:"name"`
	Path   string `json:"path"`
	Python string `json:"python"`
	Ready  bool   `json:"ready"`
	Error  string `json:"error,omitempty"`
}
type PythonRuntimeManager struct {
	store *Store
	jobs  *ShellJobManager
}

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
	path := filepath.Join(m.store.root, "python", "envs", app.Manifest.ID, definition.Venv, fingerprint)
	python := filepath.Join(path, "bin", "python")
	if runtime.GOOS == "windows" {
		python = filepath.Join(path, "Scripts", "python.exe")
	}
	env := PythonEnvironment{Name: definition.Venv, Path: path, Python: python, Ready: false}
	if _, err := os.Stat(python); err == nil {
		env.Ready = true
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
	script := "set -eu\nprintf '%s\\n' '[python] 正在创建隔离运行环境。'\npython3 -m venv \"$RECUT_VENV\"\nprintf '%s\\n' '[python] 正在升级 pip。'\n\"$RECUT_PYTHON\" -m pip install --upgrade pip\n"
	if runtime.Requirements != "" {
		script += "printf '%s\\n' '[python] 正在安装锁定依赖。'\n\"$RECUT_PYTHON\" -m pip install --requirement \"$1\"\n"
	}
	if runtime.Bootstrap != "" {
		script += "printf '%s\\n' '[python] 正在准备应用代码。'\nsh \"$2\"\n"
	}
	arguments := []string{"-eu", "-c", script, "recut-python-runtime"}
	if runtime.Requirements != "" {
		arguments = append(arguments, filepath.Join(app.Root, runtime.Requirements))
	}
	if runtime.Bootstrap != "" {
		if runtime.Requirements == "" {
			arguments = append(arguments, "")
		}
		arguments = append(arguments, filepath.Join(app.Root, runtime.Bootstrap))
	}
	return m.jobs.Start(ShellJobStart{ProjectID: projectID, AppID: app.Manifest.ID, Command: "sh", Args: arguments, Dir: app.Root, Env: m.environment(env, filesRoot, modelsRoot), TimeoutSeconds: 1800})
}

func (m *PythonRuntimeManager) environment(env PythonEnvironment, filesRoot, modelsRoot string) []string {
	return []string{"RECUT_APP_FILES_DIR=" + filesRoot, "RECUT_MODELS_DIR=" + modelsRoot, "RECUT_VENV=" + env.Path, "RECUT_PYTHON=" + env.Python, "PATH=" + filepath.Join(env.Path, "bin") + string(os.PathListSeparator) + os.Getenv("PATH")}
}
func runtimeFingerprint(root string, runtime PythonRuntime) (string, error) {
	content := runtime.Version + "\n" + runtime.Venv
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
