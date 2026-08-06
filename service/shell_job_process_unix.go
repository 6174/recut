//go:build !windows

/*
 * [INPUT]: 依赖 os/exec 的 shell job 子进程与 Unix 进程组信号
 * [OUTPUT]: 为每个 shell job 配置独立进程组，并在取消/超时时终止整个进程树
 * [POS]: service 本地任务进程的 Unix 生命周期适配器；确保 make → node（如 Remotion Studio 预览 vite-server）等孙进程随父进程一起退出，不残留孤儿
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"errors"
	"os/exec"
	"syscall"
)

// configureShellJobCommand puts every shell job in its own process group so a
// cancel/timeout reaps the whole job tree. Without it, exec.CommandContext only
// kills the direct child (e.g. make), orphaning grandchildren such as the Vite
// preview dev server that keep running and holding ports/status files.
func configureShellJobCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return nil
		}
		return err
	}
}
