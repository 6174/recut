/*
 * [INPUT]: 依赖 Catalog、Store 与 Server 的本地 HTTP 路由
 * [OUTPUT]: 锁定全局 onboarding 保存、通用/项目/独立 App 三类 scope 的会话隔离与最新优先、通用会话创建及 LAN CORS 的 HTTP 契约
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
	"strings"
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

func TestGeneralAgentSessionHTTP(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(apps, store, nil, nil, NewAgentManager(store, nil, nil), nil, nil).routes()

	request := httptest.NewRequest(http.MethodPost, "/v1/agent-sessions", bytes.NewBufferString(`{"runtime":"codex"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create general session = %d: %s", recorder.Code, recorder.Body.String())
	}
	session := ChatSession{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.ProjectID != generalChatProjectID {
		t.Fatalf("general session scope = %q", session.ProjectID)
	}
	if _, err := store.Get(generalChatProjectID); err != nil {
		t.Fatalf("general scope was not materialized: %v", err)
	}

	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/agent-sessions?scope=general", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("list general sessions = %d: %s", recorder.Code, recorder.Body.String())
	}
	var sessions []ChatSession
	if err := json.Unmarshal(recorder.Body.Bytes(), &sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].ID != session.ID {
		t.Fatalf("general sessions = %#v", sessions)
	}

	projects, err := store.List()
	if err != nil || len(projects) != 0 {
		t.Fatalf("visible projects = %#v, %v", projects, err)
	}
}

func TestAgentSessionHTTPScopesAreIsolatedAndNewestFirst(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	for name, manifest := range map[string]string{
		"project":    `{"manifestVersion":1,"id":"example.project","name":"Project","author":"Test","description":"Test project App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`,
		"standalone": `{"manifestVersion":1,"id":"example.standalone","name":"Standalone","author":"Test","description":"Test standalone App.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"}}`,
	} {
		if err := os.MkdirAll(filepath.Join(appsDir, name), 0o755); err != nil {
			t.Fatal(err)
		}
		writeTestFile(t, filepath.Join(appsDir, name, "manifest.json"), manifest)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Project", AppID: "example.project"})
	if err != nil {
		t.Fatal(err)
	}
	appScope, err := store.EnsureStandaloneAppProject("example.standalone")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(apps, store, nil, nil, NewAgentManager(store, nil, nil), nil, nil).routes()

	general := createAgentSessionHTTP(t, handler, `{"runtime":"codex"}`)
	projectFirst := createAgentSessionHTTP(t, handler, `{"projectId":"`+project.ID+`","runtime":"codex"}`)
	projectLatest := createAgentSessionHTTP(t, handler, `{"projectId":"`+project.ID+`","runtime":"codex"}`)
	app := createAgentSessionHTTP(t, handler, `{"projectId":"`+appScope.ID+`","runtime":"codex"}`)

	assertSessionList := func(path string, expected ...string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("list %s = %d: %s", path, recorder.Code, recorder.Body.String())
		}
		var sessions []ChatSession
		if err := json.Unmarshal(recorder.Body.Bytes(), &sessions); err != nil {
			t.Fatal(err)
		}
		if len(sessions) != len(expected) {
			t.Fatalf("list %s = %#v, want %d sessions", path, sessions, len(expected))
		}
		for index, id := range expected {
			if sessions[index].ID != id {
				t.Fatalf("list %s[%d] = %q, want %q", path, index, sessions[index].ID, id)
			}
		}
	}
	assertSessionList("/v1/agent-sessions?scope=general", general.ID)
	assertSessionList("/v1/agent-sessions?projectId="+project.ID, projectLatest.ID, projectFirst.ID)
	assertSessionList("/v1/agent-sessions?projectId="+appScope.ID, app.ID)
}

func createAgentSessionHTTP(t *testing.T, handler http.Handler, body string) ChatSession {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/agent-sessions", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create session = %d: %s", recorder.Code, recorder.Body.String())
	}
	var session ChatSession
	if err := json.Unmarshal(recorder.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	return session
}

func TestSystemLogsExposeDiagnosticsToLocalNetwork(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root, nil)
	if err := os.MkdirAll(filepath.Join(root, "logs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "logs", "service-2026-08-02.log"), []byte("INFO service started\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(nil, store, nil, nil, nil, nil, nil).routes()
	request := httptest.NewRequest(http.MethodGet, "/v1/system/logs", nil)
	request.RemoteAddr = "192.168.1.20:17373"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "CODEX CLI resolution") || !strings.Contains(recorder.Body.String(), "OPENCODE CLI resolution") || !strings.Contains(recorder.Body.String(), "INFO service started") {
		t.Fatalf("local diagnostics = %d: %s", recorder.Code, recorder.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/system/logs", nil)
	request.RemoteAddr = "203.0.113.10:17373"
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("public diagnostics = %d", recorder.Code)
	}
}
