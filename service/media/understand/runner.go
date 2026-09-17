/*
 * [INPUT]: 依赖标准库 os/exec 与平台全局 Python venv、受管 PATH（install.sh 前置 <dataDir>/python/platform/<ver>/bin）
 * [OUTPUT]: 参考理解的 IO adapter：Runner 接口 + ExecRunner 实现、平台工具解析（python/ffmpeg/ffprobe/字体目录）
 *   与结构化「需要准备」错误；所有外部进程调用集中在此，便于测试注入 fake runner
 * [POS]: media/understand 的唯一 IO 边界；工具与纯函数分离，缺依赖时返回可执行指引而非静默安装
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Runner abstracts external process execution so unit tests inject a fake and
// never touch ffmpeg/Python.
type Runner interface {
	Run(ctx context.Context, name string, args ...string) ([]byte, error)
}

// ExecRunner runs real processes, capturing stderr for diagnostics.
type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if len(message) > 1200 {
			message = message[len(message)-1200:]
		}
		if message == "" {
			return output, fmt.Errorf("%s failed: %w", name, err)
		}
		return output, fmt.Errorf("%s failed: %w: %s", name, err, message)
	}
	return output, nil
}

// MissingDependencyError signals that a capability is unavailable until the
// platform environment is prepared. It never means "install silently"; it is a
// structured, actionable error envelope.
type MissingDependencyError struct {
	Tool string
	Hint string
}

func (e *MissingDependencyError) Error() string {
	if e.Hint != "" {
		return e.Hint
	}
	return fmt.Sprintf("%s is not available; prepare the platform Python environment first", e.Tool)
}

// IsMissingDependency reports whether an error is a structured readiness guide.
func IsMissingDependency(err error) bool {
	var target *MissingDependencyError
	return errors.As(err, &target)
}

const (
	platformPythonVersion  = "3.11"
	pythonReadinessModules = "PIL, numpy, scenedetect, cv2"
)

// Toolkit resolves the external executables once and lends them to every
// understanding operation.
type Toolkit struct {
	Runner   Runner
	DataDir  string
	Python   string
	FFmpeg   string
	FFprobe  string
	FontsDir string
}

// NewToolkit resolves the platform executables under dataDir. Missing binaries
// are not fatal here: each operation turns them into a readiness error so the
// agent can report precisely what must be prepared.
func NewToolkit(dataDir string, runner Runner) *Toolkit {
	if runner == nil {
		runner = ExecRunner{}
	}
	venv := platformVenvDir(dataDir)
	python := filepath.Join(venv, "bin", "python")
	if runtime.GOOS == "windows" {
		python = filepath.Join(venv, "Scripts", "python.exe")
	}
	if _, err := os.Stat(python); err != nil {
		python = ""
	}
	ffmpeg := lookPath("ffmpeg")
	if ffmpeg == "" {
		ffmpeg = existingBinary(filepath.Join(venv, "bin", "ffmpeg"), filepath.Join(venv, "Scripts", "ffmpeg.exe"))
	}
	ffprobe := lookPath("ffprobe")
	if ffprobe == "" {
		ffprobe = existingBinary(filepath.Join(venv, "bin", "ffprobe"), filepath.Join(venv, "Scripts", "ffprobe.exe"))
	}
	return &Toolkit{
		Runner:   runner,
		DataDir:  dataDir,
		Python:   python,
		FFmpeg:   ffmpeg,
		FFprobe:  ffprobe,
		FontsDir: filepath.Join(dataDir, "fonts"),
	}
}

func platformVenvDir(dataDir string) string {
	return filepath.Join(dataDir, "python", "platform", platformPythonVersion)
}

func lookPath(name string) string {
	if path, err := exec.LookPath(name); err == nil {
		return path
	}
	return ""
}

func existingBinary(candidates ...string) string {
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func (t *Toolkit) requireFFprobe() error {
	if t.FFprobe == "" {
		return &MissingDependencyError{Tool: "ffprobe", Hint: "平台受管 ffprobe 不可用；请先调用 recut.media.understand.prepare 准备平台 Python 环境（RFC §2.3），不要在本机手工 pip 安装。"}
	}
	return nil
}

func (t *Toolkit) requireFFmpeg() error {
	if t.FFmpeg == "" {
		return &MissingDependencyError{Tool: "ffmpeg", Hint: "平台受管 ffmpeg 不可用；请重新运行 Recut 安装器，或调用 recut.media.understand.prepare 准备平台 Python 环境。"}
	}
	return nil
}

func (t *Toolkit) requirePython(module string) error {
	if t.Python == "" {
		return &MissingDependencyError{Tool: "python", Hint: "平台 Python 运行环境尚未就绪；请调用 recut.media.understand.prepare 准备（RFC §2.3）。"}
	}
	return nil
}

// Environment is the readiness snapshot surfaced to the agent.
type Environment struct {
	Ready          bool     `json:"ready"`
	PythonReady    bool     `json:"pythonReady"`
	FFmpegReady    bool     `json:"ffmpegReady"`
	FFprobeReady   bool     `json:"ffprobeReady"`
	PythonModules  bool     `json:"pythonModulesReady"`
	Python         string   `json:"python,omitempty"`
	FFmpeg         string   `json:"ffmpeg,omitempty"`
	FFprobe        string   `json:"ffprobe,omitempty"`
	Missing        []string `json:"missing"`
	ReadinessError string   `json:"readinessError,omitempty"`
}

// Environment probes the resolved tools. It runs one cheap Python import check
// to detect the imaging/scene-detection modules; a missing module is reported,
// never auto-installed.
func (t *Toolkit) Environment(ctx context.Context) Environment {
	env := Environment{
		Python:       t.Python,
		FFmpeg:       t.FFmpeg,
		FFprobe:      t.FFprobe,
		PythonReady:  t.Python != "",
		FFmpegReady:  t.FFmpeg != "",
		FFprobeReady: t.FFprobe != "",
	}
	if !env.PythonReady {
		env.Missing = append(env.Missing, "python")
	}
	if !env.FFmpegReady {
		env.Missing = append(env.Missing, "ffmpeg")
	}
	if !env.FFprobeReady {
		env.Missing = append(env.Missing, "ffprobe")
	}
	if env.PythonReady {
		script := "import " + strings.ReplaceAll(pythonReadinessModules, ", ", ", ")
		if output, err := t.Runner.Run(ctx, t.Python, "-c", script); err != nil {
			env.PythonModules = false
			env.Missing = append(env.Missing, "pythonModules")
			env.ReadinessError = strings.TrimSpace(string(output))
		} else {
			env.PythonModules = true
		}
	}
	env.Ready = env.PythonReady && env.FFmpegReady && env.FFprobeReady && env.PythonModules
	return env
}

// runPythonJSON writes the script and a JSON payload to temp files, runs the
// platform Python, and decodes the script's stdout JSON into out.
func (t *Toolkit) runPythonJSON(ctx context.Context, script string, payload any, out any) error {
	if t.Python == "" {
		return t.requirePython("")
	}
	dir, err := os.MkdirTemp("", "recut-understand-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	scriptPath := filepath.Join(dir, "script.py")
	if err := os.WriteFile(scriptPath, []byte(script), 0o600); err != nil {
		return err
	}
	args := []string{scriptPath}
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		payloadPath := filepath.Join(dir, "payload.json")
		if err := os.WriteFile(payloadPath, data, 0o600); err != nil {
			return err
		}
		args = append(args, payloadPath)
	}
	output, err := t.Runner.Run(ctx, t.Python, args...)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(bytes.TrimSpace(output), out); err != nil {
		return fmt.Errorf("cannot parse python output: %w", err)
	}
	return nil
}
