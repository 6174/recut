/*
 * [INPUT]: 依赖标准库 exec/context/os/user 与用户登录 shell 能力
 * [OUTPUT]: 对外提供 userBaseEnv：捕获用户登录+交互 shell 的完整环境（含 .zshrc/.bashrc/.zprofile 的 PATH 等），
 *           供 shell 任务/PTY 终端作为基础环境；捕获失败或超时回退 os.Environ。不假设用户是哪种 shell。
 * [POS]: service 的通用环境边界；让 App shell 任务与终端继承用户本机配置，与具体登录 shell 无关
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"io"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strings"
	"sync"
	"time"
)

var (
	userEnvOnce   sync.Once
	userEnvResult []string
)

// userBaseEnv returns the daemon environment merged with the user's login +
// interactive shell environment. The captured shell env (login + interactive,
// which sources .zprofile/.zshrc/.bash_profile/.bashrc as appropriate) supplies
// PATH and other additions the daemon may lack when launched outside a login
// shell. Shell-exported keys (e.g. PATH) override the daemon's; everything else
// falls back to the daemon environment. Captured once and cached.
func userBaseEnv() []string {
	userEnvOnce.Do(func() {
		userEnvResult = mergeEnv(os.Environ(), captureUserShellEnv())
	})
	return userEnvResult
}

// captureUserShellEnv runs the user's shell as a login + interactive shell and
// captures its `env`, so profile/rc files are honored regardless of shell type.
// Non-printable noise (greetings, job-control warnings) is discarded by the
// KEY=VALUE parser; a missing/hanging shell falls back to nil (daemon env).
func captureUserShellEnv() []string {
	shell := resolveUserShell()
	if shell == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, shell, "-l", "-i", "-c", "env")
	cmd.Stdin = nil
	cmd.Stderr = io.Discard
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	env := []string{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSuffix(line, "\r")
		if idx := strings.IndexByte(line, '='); idx > 0 && isEnvName(line[:idx]) {
			env = append(env, line)
		}
	}
	return env
}

// resolveUserShell prefers $SHELL, then the login shell from /etc/passwd,
// then a portable default. Windows returns "" (no capture).
func resolveUserShell() string {
	if shell := os.Getenv("SHELL"); shell != "" {
		return shell
	}
	if current, err := user.Current(); err == nil && current.Username != "" {
		if shell := loginShell(current.Username); shell != "" {
			return shell
		}
	}
	if runtime.GOOS == "windows" {
		return ""
	}
	return "/bin/sh"
}

func loginShell(username string) string {
	data, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Split(line, ":")
		if len(parts) >= 7 && parts[0] == username && parts[6] != "" {
			return parts[6]
		}
	}
	return ""
}

func isEnvName(key string) bool {
	if key == "" {
		return false
	}
	for i := 0; i < len(key); i++ {
		c := key[i]
		if !(c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || i > 0 && c >= '0' && c <= '9') {
			return false
		}
	}
	return true
}

// mergeEnv overlays override entries onto base by key, returning a single
// []string in KEY=VALUE form. Override wins on conflicting keys.
func mergeEnv(base, override []string) []string {
	if len(override) == 0 {
		return base
	}
	index := map[string]int{}
	for i, entry := range base {
		if idx := strings.IndexByte(entry, '='); idx > 0 {
			index[entry[:idx]] = i
		}
	}
	merged := make([]string, len(base))
	copy(merged, base)
	for _, entry := range override {
		if idx := strings.IndexByte(entry, '='); idx > 0 {
			key := entry[:idx]
			if i, ok := index[key]; ok {
				merged[i] = entry
			} else {
				index[key] = len(merged)
				merged = append(merged, entry)
			}
		}
	}
	return merged
}
