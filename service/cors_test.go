/*
 * [INPUT]: 依赖 net/http 与 net/http/httptest，直测 withLocalCORS 中间件
 * [OUTPUT]: 锁定「无 Origin 的普通请求命中长缓存后，画布 crossOrigin 请求仍应拿到 ACAO」的
 *  Vary: Origin 契约（回归：面板 <img> 无 crossOrigin 先写入不带 ACAO 的响应会污染缓存）
 * [POS]: service 的 CORS 缓存正确性单元测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWithLocalCORSVariesOnOrigin(t *testing.T) {
	handler := withLocalCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// 普通 GET（无 Origin，模拟面板 <img>）：必须带 Vary: Origin，否则该响应会被
	// HTTP 缓存复用到后续跨域请求上（无 ACAO → 画布 CORS 失败）。
	plain := httptest.NewRequest(http.MethodGet, "/v1/media/assets/x/content", nil)
	plainRecorder := httptest.NewRecorder()
	handler.ServeHTTP(plainRecorder, plain)
	if got := plainRecorder.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("no-origin response Vary = %q, want Origin", got)
	}
	if got := plainRecorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("no-origin response ACAO = %q, want empty", got)
	}

	// 跨域 GET：ACAO 回显 Origin，且同样带 Vary: Origin。
	cors := httptest.NewRequest(http.MethodGet, "/v1/media/assets/x/content", nil)
	cors.Header.Set("Origin", "http://app.localhost:3000")
	corsRecorder := httptest.NewRecorder()
	handler.ServeHTTP(corsRecorder, cors)
	if got := corsRecorder.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("cors response Vary = %q, want Origin", got)
	}
	if got := corsRecorder.Header().Get("Access-Control-Allow-Origin"); got != "http://app.localhost:3000" {
		t.Fatalf("cors response ACAO = %q", got)
	}
}
