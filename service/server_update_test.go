/*
 * [INPUT]: 依赖 Server 的 system status 与 self-update HTTP 路由
 * [OUTPUT]: 验证旧/测试 service 不会伪装支持 self-update
 * [POS]: service 传输层的自更新 API 回归测试；不下载包也不触碰 launchd
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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
	restart := httptest.NewRecorder()
	handler.ServeHTTP(restart, httptest.NewRequest(http.MethodPost, "/v1/system/restart", nil))
	if restart.Code != http.StatusNotImplemented {
		t.Fatalf("restart without updater = %d", restart.Code)
	}
}

func TestHealthReportsServiceStartTime(t *testing.T) {
	handler := NewServer(nil, nil, nil, nil, nil, nil, nil).routes()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("health = %d", recorder.Code)
	}
	var body struct {
		Status    string `json:"status"`
		StartedAt string `json:"startedAt"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ok" {
		t.Fatalf("health status = %q", body.Status)
	}
	if _, err := time.Parse(time.RFC3339Nano, body.StartedAt); err != nil {
		t.Fatalf("health startedAt = %q: %v", body.StartedAt, err)
	}
}
