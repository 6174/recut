/*
 * [INPUT]: 依赖临时 App manifest、AppHost 与 HTTP 路由
 * [OUTPUT]: 锁定独立 App 的 operation 通过 appstate API 路由执行：ctx.project 为空、读写 appstate sqlite，
 * 且 project App 走该路由必须被拒绝、错误路径不被误判为项目目标
 * [POS]: runtime 的独立 App HTTP 边界回归测试；不依赖真实构建或网络端口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStandaloneAppAPIResolvesToAppstateTarget(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "standalone")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.standalone","name":"Standalone","author":"Test","description":"Test App.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"},"permissions":["sqlite"],"operations":[{"name":"ping","description":"Report target.","surfaces":["api"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("ping", function(input, ctx) { ctx.sqlite.execute("create table if not exists pings (note text)"); ctx.sqlite.execute("insert into pings values (?)", [input.note || "none"]); return { project: ctx.project, note: input.note || "none" }; });`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	handler := NewServer(apps, store, nil, nil, nil, host, nil).routes()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/apps/example.standalone/api/ping", strings.NewReader(`{"note":"hello"}`))
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("POST /v1/apps/example.standalone/api/ping = %d %q", recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if project, ok := payload["project"]; !ok || project != nil {
		t.Fatalf("standalone operation did not resolve to appstate target: %#v", payload)
	}
	if payload["note"] != "hello" {
		t.Fatalf("operation input was not delivered: %#v", payload)
	}

	// The appstate sqlite is the single persistent handle for the App.
	db, err := store.AppStateDatabase("example.standalone")
	if err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow("select count(*) from pings where note = 'hello'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("appstate sqlite write = %d err=%v", count, err)
	}
}

func TestProjectAppAPIRejectsAppstateTarget(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "project")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.project","name":"Project","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite"],"operations":[{"name":"ping","description":"Ping.","surfaces":["api"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("ping", function(input, ctx) { return { ok: true }; });`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	handler := NewServer(apps, store, nil, nil, nil, host, nil).routes()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/apps/example.project/api/ping", strings.NewReader("{}"))
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("project App via appstate route = %d %q", recorder.Code, recorder.Body.String())
	}
}
