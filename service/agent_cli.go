/*
 * [INPUT]: 依赖常驻 service PATH、当前用户的 login shell 与标准库的可执行文件检查
 * [OUTPUT]: 对外提供 findAgentCommand，为 Agent runtime 解析可执行 CLI 的绝对路径
 * [POS]: service 的 Agent 运行时环境适配器；以用户 shell 的动态 PATH 补足 launchd/systemd 与交互 shell 的环境差异
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const agentShellLookupTimeout = 8 * time.Second

type AgentCommandDiagnostic struct {
	Command      string                 `json:"command"`
	ServicePath  string                 `json:"servicePath"`
	ResolvedPath string                 `json:"resolvedPath,omitempty"`
	Resolution   string                 `json:"resolution,omitempty"`
	Shells       []AgentShellDiagnostic `json:"shells"`
}

type AgentShellDiagnostic struct {
	Shell        string `json:"shell"`
	Path         string `json:"path,omitempty"`
	ResolvedPath string `json:"resolvedPath,omitempty"`
	Error        string `json:"error,omitempty"`
}

// findAgentCommand checks the daemon PATH first, then asks the current user's
// login shell. This keeps NVM, fnm and similar version managers owned by the
// user's shell configuration instead of encoding their directory layouts.
func findAgentCommand(command string) (string, error) {
	diagnostic := resolveAgentCommand(command, false)
	if diagnostic.ResolvedPath != "" {
		return diagnostic.ResolvedPath, nil
	}
	return "", exec.ErrNotFound
}

func inspectAgentCommand(command string) AgentCommandDiagnostic {
	return resolveAgentCommand(command, true)
}

func resolveAgentCommand(command string, inspectShells bool) AgentCommandDiagnostic {
	diagnostic := AgentCommandDiagnostic{Command: command, ServicePath: os.Getenv("PATH"), Shells: []AgentShellDiagnostic{}}
	if !isAgentCommand(command) {
		return diagnostic
	}
	if path, err := exec.LookPath(command); err == nil {
		diagnostic.ResolvedPath, diagnostic.Resolution = path, "service PATH"
		if !inspectShells {
			return diagnostic
		}
	}
	for _, shell := range agentShells() {
		shellDiagnostic := inspectAgentCommandInShell(shell, command)
		diagnostic.Shells = append(diagnostic.Shells, shellDiagnostic)
		if diagnostic.ResolvedPath == "" && shellDiagnostic.ResolvedPath != "" {
			diagnostic.ResolvedPath = shellDiagnostic.ResolvedPath
			diagnostic.Resolution = "login shell " + shell
		}
		if diagnostic.ResolvedPath != "" && !inspectShells {
			return diagnostic
		}
	}
	return diagnostic
}

func inspectAgentCommandInShell(shell, command string) AgentShellDiagnostic {
	diagnostic := AgentShellDiagnostic{Shell: shell}
	if runtime.GOOS == "windows" || !isExecutableFile(shell) || !isAgentCommand(command) {
		diagnostic.Error = "shell is unavailable"
		return diagnostic
	}
	ctx, cancel := context.WithTimeout(context.Background(), agentShellLookupTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, shell, "-lic", "printf '__RECUT_PATH__%s\\n' \"$PATH\"; command -v -- "+command).CombinedOutput()
	diagnostic.Path = agentShellPathFromOutput(string(output))
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			diagnostic.Error = "shell startup exceeded 8 seconds before command lookup completed"
			return diagnostic
		}
		diagnostic.Error = err.Error()
		return diagnostic
	}
	diagnostic.ResolvedPath = agentCommandPathFromOutput(command, string(output))
	if diagnostic.ResolvedPath == "" {
		diagnostic.Error = "command was not found in shell PATH"
	}
	return diagnostic
}

func agentShells() []string {
	candidates := []string{os.Getenv("SHELL"), "/bin/zsh", "/bin/bash", "/bin/sh"}
	shells := make([]string, 0, len(candidates))
	seen := map[string]bool{}
	for _, shell := range candidates {
		if shell != "" && !seen[shell] {
			seen[shell] = true
			shells = append(shells, shell)
		}
	}
	return shells
}

func isAgentCommand(command string) bool {
	for _, character := range command {
		if !(character == '-' || character == '_' || character >= 'a' && character <= 'z') {
			return false
		}
	}
	return command != ""
}

func agentCommandPathFromOutput(command, output string) string {
	for _, field := range strings.Fields(output) {
		if filepath.Base(field) == command && filepath.IsAbs(field) && isExecutableFile(field) {
			return field
		}
	}
	return ""
}

func agentShellPathFromOutput(output string) string {
	const marker = "__RECUT_PATH__"
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, marker) {
			return strings.TrimSpace(strings.TrimPrefix(line, marker))
		}
	}
	return ""
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return runtime.GOOS == "windows" || info.Mode()&0o111 != 0
}
