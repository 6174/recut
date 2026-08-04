/*
 * [INPUT]: 依赖标准库同步原语
 * [OUTPUT]: 对外提供 changeHub，作为长寿命 SSE 读者在对应 durable 事件表新增行时的进程内唤醒广播
 * [POS]: service 的异步事件基础设施；写者提交后通知，读者等待当前信号通道并以慢轮询兜底捕捉短命 MCP 进程的跨进程写入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"sync"
	"time"
)

// changeHub wakes SSE readers when a durable event table gains rows. notify
// closes the current signal channel and installs a fresh one, so every waiter
// wakes once while bursts coalesce. The lock only guards the channel swap and
// is held for nanoseconds, never across I/O.
type changeHub struct {
	mu     sync.Mutex
	signal chan struct{}
}

func newChangeHub() *changeHub {
	return &changeHub{signal: make(chan struct{})}
}

func (h *changeHub) notify() {
	h.mu.Lock()
	defer h.mu.Unlock()
	select {
	case <-h.signal:
	default:
		close(h.signal)
		h.signal = make(chan struct{})
	}
}

func (h *changeHub) wait() <-chan struct{} {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.signal
}

// changeHubPollInterval is the fallback for durable writes that arrive from a
// short-lived MCP process sharing the same SQLite file but not this process's
// memory. In-process writes wake readers immediately; this only bounds the
// latency for external writers.
const changeHubPollInterval = time.Second
