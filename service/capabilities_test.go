/*
 * [INPUT]: 依赖临时双 App manifest（project 调用方 + standalone capability 提供方）、AppHost 与
 *          AppStore/Store 安装目录，直接调用 ctx.capabilities.invoke 的底层 Go 面。
 * [OUTPUT]: 锁定通用能力桥：round-trip 透传、业务错误信封、app-not-installed / op-not-exposed、
 *           inspect 能力发现与安装引导、同步超时。
 * [POS]: capability bridge 的回归测试；不依赖真实 audio-studio。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writeTwoAppHarness 创建「editor（project，调用方）」+「audio-studio（standalone，提供方）」两个 stub App。
func writeTwoAppHarness(t *testing.T) (*AppHost, *Store, string) {
	t.Helper()
	root := t.TempDir()
	// 提供方 standalone App：暴露两个 capability op（echo + 断言业务错误）与一个普通（非 capability）op。
	providerDir := filepath.Join(root, "apps", "audio-studio")
	if err := os.MkdirAll(filepath.Join(providerDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(providerDir, "manifest.json"), `{"manifestVersion":1,"id":"recut.audio-studio","name":"Audio Studio","author":"Test","description":"Test provider.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"},"permissions":["files"],"operations":[{"name":"cap.echo","capability":true,"description":"Echo an object.","surfaces":["mcp"],"inputSchema":{"type":"object"}},{"name":"cap.bizfail","capability":true,"description":"Throw a typed business error.","surfaces":["mcp"],"inputSchema":{"type":"object"}},{"name":"cap.slow","capability":true,"description":"Block the caller beyond the sync window.","surfaces":["mcp"],"inputSchema":{"type":"object"}},{"name":"private.op","capability":false,"description":"Not a capability.","surfaces":["api"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(providerDir, "background.js"), `recut.operation.register("cap.echo", function(input, ctx) { return { echoed: input, at: ctx.locale }; });
recut.operation.register("cap.bizfail", function(input, ctx) { recut.error({ code: "audio.not-ready", message: "model not installed", hint: "Install the model first.", retryable: true }); });
recut.operation.register("cap.slow", function(input, ctx) { var end = Date.now() + 1500; while (Date.now() < end) {} return { slow: true }; });
recut.operation.register("private.op", function(input, ctx) { return { private: true }; });`)
	writeTestFile(t, filepath.Join(providerDir, "ui", "index.html"), "ok")

	// 调用方 project App：自身只注册一个 api op，在 handler 里经 ctx.capabilities.invoke 调提供方。
	callerDir := filepath.Join(root, "apps", "editor")
	if err := os.MkdirAll(filepath.Join(callerDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(callerDir, "manifest.json"), `{"manifestVersion":1,"id":"recut.editor","name":"Editor","author":"Test","description":"Test caller.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":[],"operations":[{"name":"gen.run","description":"Invoke a capability.","surfaces":["api"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(callerDir, "background.js"), `recut.operation.register("gen.run", function(input, ctx) { const r = ctx.capabilities.invoke({ appId: input.appId, name: input.name, input: input.input || {} }); return r; });`)
	writeTestFile(t, filepath.Join(callerDir, "ui", "index.html"), "ok")

	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Proj", AppID: "recut.editor"})
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	_ = project
	return host, store, project.ID
}

func invokeViaCapability(t *testing.T, host *AppHost, projectID, targetAppID, name string, input map[string]any) map[string]any {
	t.Helper()
	result, err := host.InvokeAPI(Target{ProjectID: projectID, AppID: "recut.editor"}, "recut.editor", "gen.run", map[string]any{"appId": targetAppID, "name": name, "input": input})
	if err != nil {
		t.Fatal(err)
	}
	return result.(map[string]any)
}

func TestCapabilityBridgeRoundTrip(t *testing.T) {
	host, store, projectID := writeTwoAppHarness(t)
	result := invokeViaCapability(t, host, projectID, "recut.audio-studio", "cap.echo", map[string]any{"value": "你好"})
	if !result["ok"].(bool) {
		t.Fatalf("echo not ok: %#v", result)
	}
	echoed, ok := result["result"].(map[string]any)
	if !ok {
		t.Fatalf("result shape = %#v", result)
	}
	inner, ok := echoed["echoed"].(map[string]any)
	if !ok || inner["value"] != "你好" {
		t.Fatalf("value not echoed through %#v", echoed)
	}
	// 审计事件落在调用方项目账本。
	events, err := store.ListProjectEvents(projectID, 0)
	if err != nil {
		t.Fatal(err)
	}
	seen := false
	for _, ev := range events {
		var raw map[string]any
		if err := json.Unmarshal([]byte(ev.Payload), &raw); err != nil {
			continue
		}
		if strings.Contains(toString(raw["type"]), "app.capability.completed") && toString(raw["name"]) == "cap.echo" {
			seen = true
		}
	}
	if !seen {
		t.Fatalf("no capability.completed audit event: %#v", events)
	}
}

func TestCapabilityBridgeBusinessErrorEnvelope(t *testing.T) {
	host, _, projectID := writeTwoAppHarness(t)
	result := invokeViaCapability(t, host, projectID, "recut.audio-studio", "cap.bizfail", map[string]any{})
	if result["ok"].(bool) {
		t.Fatalf("expected failure, got %#v", result)
	}
	envelope, ok := result["error"].(map[string]any)
	if !ok {
		t.Fatalf("no error envelope: %#v", result)
	}
	if envelope["code"] != "audio.not-ready" || envelope["kind"] != "business" || envelope["retryable"] != true || envelope["phase"] != "sync" {
		t.Fatalf("envelope mismatch: %#v", envelope)
	}
}

func TestCapabilityBridgeAppNotInstalled(t *testing.T) {
	host, _, projectID := writeTwoAppHarness(t)
	result := invokeViaCapability(t, host, projectID, "recut.missing", "cap.echo", map[string]any{})
	if result["ok"].(bool) {
		t.Fatalf("expected failure for missing app, got %#v", result)
	}
	envelope, _ := result["error"].(map[string]any)
	if envelope["code"] != "app.not-installed" {
		t.Fatalf("code mismatch: %#v", envelope)
	}
}

func TestCapabilityBridgeOpNotExposed(t *testing.T) {
	host, _, projectID := writeTwoAppHarness(t)
	result := invokeViaCapability(t, host, projectID, "recut.audio-studio", "private.op", map[string]any{})
	if result["ok"].(bool) {
		t.Fatalf("expected failure for non-capability op, got %#v", result)
	}
	envelope, _ := result["error"].(map[string]any)
	if envelope["code"] != "op.not-exposed" {
		t.Fatalf("code mismatch: %#v", envelope)
	}
}

func TestCapabilityInspect(t *testing.T) {
	host, _, projectID := writeTwoAppHarness(t)
	_ = projectID
	// 直接调 inspect 层。
	view := host.capabilityInspect("recut.audio-studio", DefaultLocale)
	if view["ready"] != true {
		t.Fatalf("expected ready: %#v", view)
	}
	ops, ok := view["operations"].([]map[string]any)
	if !ok || len(ops) != 3 {
		t.Fatalf("operations = %#v", view)
	}
	// 未安装 App 带安装引导信息（本 harness 无 appstore，install/repository 为空，但 code 应明确）。
	missing := host.capabilityInspect("recut.missing", DefaultLocale)
	if missing["ready"] != false || missing["code"] != "app.not-installed" {
		t.Fatalf("missing inspect = %#v", missing)
	}
}

func TestCapabilityBridgeSyncTimeout(t *testing.T) {
	host, _, projectID := writeTwoAppHarness(t)
	old := capabilityInvokeTimeout
	capabilityInvokeTimeout = 80 * time.Millisecond
	defer func() { capabilityInvokeTimeout = old }()
	start := time.Now()
	result, err := host.capabilityInvoke(Target{ProjectID: projectID, AppID: "recut.editor"}, "recut.audio-studio", "cap.slow", map[string]any{}, DefaultLocale)
	if err != nil {
		t.Fatal(err)
	}
	if result["ok"].(bool) {
		t.Fatalf("expected timeout for slow capability, got ok: %#v", result)
	}
	envelope, _ := result["error"].(map[string]any)
	if envelope["code"] != "invoke.timeout" || envelope["retryable"] != true {
		t.Fatalf("timeout envelope mismatch: %#v", envelope)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("invoke.timeout did not bound the call: %v", elapsed)
	}
}