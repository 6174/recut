/*
 * [INPUT]: 依赖 logging.go 的请求审计中间件与标准库 HTTP 测试能力
 * [OUTPUT]: 验证 HTTP 成功、客户端错误与服务端错误分别被记录为 INFO、WARN、ERROR
 * [POS]: service 可观测性回归测试；不创建真实日志文件或监听网络端口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestLoggingUsesResponseSeverity(t *testing.T) {
	var output bytes.Buffer
	logger := log.New(&output, "", log.Ldate|log.Ltime|log.Lmicroseconds|log.LUTC)
	handler := withRequestLogging(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(map[string]int{"/ok": http.StatusOK, "/bad-request": http.StatusBadRequest, "/failure": http.StatusInternalServerError}[r.URL.Path])
	}), logger)

	for _, path := range []string{"/ok", "/bad-request", "/failure"} {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
	}

	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 3 {
		t.Fatalf("log lines = %d: %q", len(lines), output.String())
	}
	for index, want := range []string{"INFO request method=GET path=\"/ok\" status=200", "WARN request method=GET path=\"/bad-request\" status=400", "ERROR request method=GET path=\"/failure\" status=500"} {
		if !strings.Contains(lines[index], want) {
			t.Errorf("line %d = %q, want %q", index, lines[index], want)
		}
		if !strings.Contains(lines[index], "duration=") {
			t.Errorf("line %d lacks duration: %q", index, lines[index])
		}
	}
}

func TestRequestLoggingIncludesServerErrorCause(t *testing.T) {
	var output bytes.Buffer
	logger := log.New(&output, "", 0)
	handler := withRequestLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusInternalServerError, errors.New("workspace database is unavailable"))
	}), logger)
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/projects", nil))
	if !strings.Contains(output.String(), "ERROR request method=GET path=\"/v1/projects\" status=500") || !strings.Contains(output.String(), `error="workspace database is unavailable"`) {
		t.Fatalf("error log = %q", output.String())
	}
}
