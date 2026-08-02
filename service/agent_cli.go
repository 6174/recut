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

// findAgentCommand checks the daemon PATH first, then asks the current user's
// login shell. This keeps NVM, fnm and similar version managers owned by the
// user's shell configuration instead of encoding their directory layouts.
func findAgentCommand(command string) (string, error) {
	if path, err := exec.LookPath(command); err == nil {
		return path, nil
	}
	for _, shell := range agentShells() {
		if path, err := findAgentCommandInShell(shell, command); err == nil {
			return path, nil
		}
	}
	return "", exec.ErrNotFound
}

func findAgentCommandInShell(shell, command string) (string, error) {
	if runtime.GOOS == "windows" || !isExecutableFile(shell) || !isAgentCommand(command) {
		return "", exec.ErrNotFound
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, shell, "-lic", "command -v -- "+command).Output()
	if err != nil {
		return "", err
	}
	path := agentCommandPathFromOutput(command, string(output))
	if path == "" {
		return "", exec.ErrNotFound
	}
	return path, nil
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

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return runtime.GOOS == "windows" || info.Mode()&0o111 != 0
}
