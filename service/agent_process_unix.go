//go:build !windows

/*
 * [INPUT]: 依赖 os/exec 的 Agent CLI 子进程与 Unix 进程组信号
 * [OUTPUT]: 为 Agent CLI 配置独立进程组，并在上下文取消时终止整个运行组
 * [POS]: service Agent 运行时的 Unix 进程生命周期适配器；确保 OpenCode 与其 MCP 子进程共同退出
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"errors"
	"os/exec"
	"syscall"
)

func configureAgentCommand(cmd *exec.Cmd) {
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
