/*
 * [INPUT]: 依赖标准库 HTTP Server、信号通道与 service 的 serveUntilSignal 关停边界
 * [OUTPUT]: 锁定 SIGINT/SIGTERM 触发 HTTP Server 优雅停止的回归契约
 * [POS]: service 组合根的进程生命周期测试；不初始化真实 Store、媒体或网络监听器
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http"
	"os"
	"testing"
)

func TestServeUntilSignalShutsDownHTTPServer(t *testing.T) {
	signals := make(chan os.Signal, 1)
	signals <- os.Interrupt

	err := serveUntilSignal(&http.Server{Addr: "127.0.0.1:0", Handler: http.NewServeMux()}, signals)
	if err != nil {
		t.Fatalf("serveUntilSignal() error = %v", err)
	}
}
