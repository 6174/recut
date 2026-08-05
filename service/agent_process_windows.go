//go:build windows

/*
 * [INPUT]: 依赖 os/exec 的 Agent CLI 子进程
 * [OUTPUT]: 保持 Agent CLI 的跨平台启动与取消调用契约
 * [POS]: service Agent 运行时的 Windows 生命周期适配器；由 Go 的默认上下文取消终止直接子进程
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "os/exec"

func configureAgentCommand(cmd *exec.Cmd) {}
