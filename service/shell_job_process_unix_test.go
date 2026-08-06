//go:build !windows

/*
 * [INPUT]: 依赖 Unix shell、进程组信号和 shell job 进程配置
 * [OUTPUT]: 验证取消 shell job 时其派生的孙进程（如 make → node vite-server）不会残留为孤儿
 * [POS]: service 本地任务进程的 Unix 生命周期回归测试；锁定长驻任务（Remotion Studio 预览）取消后整棵进程树一起退出
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestShellJobCommandCancellationStopsProcessGroup(t *testing.T) {
	pidPath := filepath.Join(t.TempDir(), "child.pid")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", "sleep 30 & echo $! > \"$1\"; wait", "sh", pidPath)
	configureShellJobCommand(cmd)
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
	t.Fatalf("Shell job grandchild process %d survived cancellation", childPID)
}
