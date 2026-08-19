/*
 * [INPUT]: 依赖 AppHost 的 recut.error 绑定、MCP 错误信封（mcpError）与 HTTP 边界翻译
 * [OUTPUT]: 锁定错误面架构（rfc/2026-08-19 P2）：App background 经 recut.error 声明业务错误，
 *           平台翻译成正常结果 {ok:false,kind,code,hint}；只有传输/协议故障才以 JSON-RPC error 呈现
 * [POS]: service 错误信封边界回归测试
 * [PROTOCOL]: 变更时更新此头部
 */
package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newBusinessErrorTestApp(t *testing.T) (*AppHost, *Store, Target) {
	t.Helper()
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite"],"operations":[{"name":"boom","description":"Business error.","surfaces":["api","mcp"],"inputSchema":{"type":"object"}},{"name":"transport","description":"Transport error.","surfaces":["api","mcp"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `
recut.operation.register("boom", function(input, ctx) {
  recut.error({ kind: "business", code: "no-verified-head", message: "组件没有 verified head", hint: "请先 component.finalize" });
});
recut.operation.register("transport", function(input, ctx) {
  throw new Error("i/o bottleneck");
});
`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Err", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	return host, store, Target{ProjectID: project.ID, AppID: "example.app"}
}

func TestAppBusinessErrorBecomesTypedEnvelope(t *testing.T) {
	host, _, target := newBusinessErrorTestApp(t)
	_, err := host.InvokeMCP(target, "example.app", "boom", map[string]any{})
	var env *mcpError
	if !errors.As(err, &env) {
		t.Fatalf("err type = %T %v; want *mcpError", err, err)
	}
	if env.Kind != "business" || env.Code != "no-verified-head" || env.Hint == "" {
		t.Fatalf("envelope = %+v", env)
	}
}

func TestPlainAppErrorStaysTransportError(t *testing.T) {
	host, _, target := newBusinessErrorTestApp(t)
	_, err := host.InvokeMCP(target, "example.app", "transport", map[string]any{})
	var env *mcpError
	if errors.As(err, &env) && env.Kind != "" && env.Kind != "transport" {
		t.Fatalf("plain throw must not become a business envelope, got %+v", env)
	}
}

func TestMCPHTTPBusinessErrorIsAResultNotACrash(t *testing.T) {
	_, store, _ := newBusinessErrorTestApp(t)
	apps, err := LoadCatalog(store.catalog.dir)
	if err != nil {
		t.Fatal(err)
	}
	_, bearer, err := store.CreateDeviceToken(nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(apps, store, nil, NewAgentBridge(store), nil, NewAppHost(apps, store), NewMediaService(store))
	httpServer := httptest.NewServer(server.routes())
	defer httpServer.Close()

	body := `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"example.app.boom","arguments":{}}}`
	request, err := http.NewRequest(http.MethodPost, httpServer.URL+"/v1/mcp", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("MCP-Protocol-Version", mcpProtocolVersion)
	request.Header.Set("Authorization", "Bearer "+bearer)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var payload struct {
		Result map[string]any `json:"result"`
		RPCErr map[string]any `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.RPCErr != nil {
		t.Fatalf("business error must NOT be a JSON-RPC error, got %#v", payload.RPCErr)
	}
	if payload.Result["isError"] != true {
		t.Fatalf("business result must carry isError, got %#v", payload.Result["isError"])
	}
	content, ok := payload.Result["content"].([]any)
	if !ok || len(content) != 1 {
		t.Fatalf("business result must carry text content, got %#v", payload.Result["content"])
	}
	text, _ := content[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "no-verified-head") {
		t.Fatalf("content text must include the envelope JSON, got %q", text)
	}
	r, ok := payload.Result["structuredContent"].(map[string]any)
	if !ok {
		t.Fatalf("business result must carry structuredContent, got %#v", payload.Result["structuredContent"])
	}
	if r["ok"] != false || r["kind"] != "business" || r["code"] != "no-verified-head" || r["hint"] == "" {
		t.Fatalf("business result envelope = %#v", r)
	}
}
