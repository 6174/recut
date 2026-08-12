/*
 * [INPUT]: 依赖标准库 HTTP Server、信号通道与 service 的 serveUntilSignal 关停边界
 * [OUTPUT]: 锁定 SIGINT/SIGTERM 触发短请求与事件流 HTTP Server 优雅停止的回归契约
 * [POS]: service 组合根的进程生命周期测试；不初始化真实 Store、媒体或网络监听器
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestActivateManagedToolPathPrependsPlatformFFmpeg(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "python", "platform", platformPythonVersion, "bin")
	name := "ffmpeg"
	if runtime.GOOS == "windows" {
		bin = filepath.Join(root, "python", "platform", platformPythonVersion, "Scripts")
		name = "ffmpeg.exe"
	}
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, name), []byte(""), 0o755); err != nil {
		t.Fatal(err)
	}
	previous := os.Getenv("PATH")
	t.Cleanup(func() { _ = os.Setenv("PATH", previous) })
	if err := os.Setenv("PATH", "/usr/bin"); err != nil {
		t.Fatal(err)
	}
	if err := activateManagedToolPath(root); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("PATH"); got != bin+string(os.PathListSeparator)+"/usr/bin" {
		t.Fatalf("PATH = %q", got)
	}
}

func TestServeUntilSignalShutsDownHTTPServer(t *testing.T) {
	signals := make(chan os.Signal, 1)
	signals <- os.Interrupt

	err := serveUntilSignal(&http.Server{Addr: "127.0.0.1:0", Handler: http.NewServeMux()}, signals)
	if err != nil {
		t.Fatalf("serveUntilSignal() error = %v", err)
	}
}

func TestServeHTTPServersUntilSignalShutsDownBothServers(t *testing.T) {
	signals := make(chan os.Signal, 1)
	signals <- os.Interrupt

	err := serveHTTPServersUntilSignal([]*http.Server{
		{Addr: "127.0.0.1:0", Handler: http.NewServeMux()},
		{Addr: "127.0.0.1:0", Handler: http.NewServeMux()},
	}, signals)
	if err != nil {
		t.Fatalf("serveHTTPServersUntilSignal() error = %v", err)
	}
}
