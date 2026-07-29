/*
 * [INPUT]: 依赖 Catalog、Store 与 Server 的本地 HTTP 路由
 * [OUTPUT]: 锁定全局 onboarding 保存、按项目解析与 LAN CORS 的 HTTP 契约
 * [POS]: service 的 Agent 传输层回归测试；不启动真实 daemon 或 Agent CLI
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestAgentOnboardingHTTP(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"onboarding":[{"id":"app","title":"App","prompt":"App prompt"}]}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(apps, store, nil, nil, nil, nil, nil).routes()

	request := httptest.NewRequest(http.MethodPut, "/v1/agent-onboarding", bytes.NewBufferString(`{"items":[{"id":"global","title":"Global","prompt":"Global prompt"}]}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("save onboarding = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/agent-onboarding?projectId="+project.ID, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("resolve onboarding = %d: %s", recorder.Code, recorder.Body.String())
	}
	payload := struct {
		Items []OnboardingGuide `json:"items"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 2 || payload.Items[0].ID != "app" || payload.Items[1].ID != "global" {
		t.Fatalf("resolved onboarding = %#v", payload.Items)
	}

	preflight := httptest.NewRequest(http.MethodOptions, "/v1/agent-onboarding", nil)
	preflight.Header.Set("Origin", "https://recut.video")
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, preflight)
	if recorder.Code != http.StatusNoContent || recorder.Header().Get("Access-Control-Allow-Methods") != "GET, POST, PUT, PATCH, OPTIONS" {
		t.Fatalf("onboarding preflight = %d, methods = %q", recorder.Code, recorder.Header().Get("Access-Control-Allow-Methods"))
	}

	lanPreflight := httptest.NewRequest(http.MethodOptions, "/v1/agent-onboarding", nil)
	lanPreflight.Header.Set("Origin", "http://192.168.1.20:3000")
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, lanPreflight)
	if recorder.Code != http.StatusNoContent || recorder.Header().Get("Access-Control-Allow-Origin") != "http://192.168.1.20:3000" {
		t.Fatalf("LAN preflight = %d, origin = %q", recorder.Code, recorder.Header().Get("Access-Control-Allow-Origin"))
	}

	deniedPreflight := httptest.NewRequest(http.MethodOptions, "/v1/agent-onboarding", nil)
	deniedPreflight.Header.Set("Origin", "https://untrusted.example")
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, deniedPreflight)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("untrusted preflight = %d", recorder.Code)
	}
}
