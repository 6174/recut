//go:build !windows

/*
 * [INPUT]: 依赖 Unix shell、进程组信号和 Agent CLI 进程配置
 * [OUTPUT]: 验证取消 Agent CLI 时其派生子进程不会残留
 * [POS]: service Agent 运行时的 Unix 生命周期回归测试；锁定 OpenCode MCP 子进程与父进程共同退出
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestAgentCommandCancellationStopsProcessGroup(t *testing.T) {
	pidPath := filepath.Join(t.TempDir(), "child.pid")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", "sleep 30 & echo $! > \"$1\"; wait", "sh", pidPath)
	configureAgentCommand(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	childPID := waitForChildPID(t, pidPath)
	cancel()
	_ = cmd.Wait()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		err := syscall.Kill(childPID, 0)
		if errors.Is(err, syscall.ESRCH) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Agent child process %d survived cancellation", childPID)
}

func waitForChildPID(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil {
			pid, parseErr := strconv.Atoi(strings.TrimSpace(string(data)))
			if parseErr == nil && pid > 0 {
				return pid
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Agent child process did not start")
	return 0
}
