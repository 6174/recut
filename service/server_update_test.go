/*
 * [INPUT]: 依赖 Server 的 system status 与 self-update HTTP 路由
 * [OUTPUT]: 验证旧/测试 service 不会伪装支持 self-update
 * [POS]: service 传输层的自更新 API 回归测试；不下载包也不触碰 launchd
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSystemUpdateRequiresConfiguredUpdater(t *testing.T) {
	handler := NewServer(nil, nil, nil, nil, nil, nil, nil).routes()
	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/v1/system/status", nil))
	if status.Code != http.StatusOK {
		t.Fatalf("system status = %d", status.Code)
	}
	update := httptest.NewRecorder()
	handler.ServeHTTP(update, httptest.NewRequest(http.MethodPost, "/v1/system/update", nil))
	if update.Code != http.StatusNotImplemented {
		t.Fatalf("self-update without updater = %d", update.Code)
	}
}
