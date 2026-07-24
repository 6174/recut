/*
 * [INPUT]: 依赖 AgentBridge 的临时项目会话与 MCP JSON-RPC handler
 * [OUTPUT]: 验证 Recut MCP 宣告 resources 和 app tools
 * [POS]: service 的 MCP 可发现性回归测试，防止 CLI 只加载空 server
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"testing"
)

func TestMCPAdvertisesRecutResourcesAndTools(t *testing.T) {
	bridge, session := testBridgeSession(t)
	resources, err := handleMCP(bridge, session, mcpRequest{Method: "resources/list"})
	if err != nil {
		t.Fatal(err)
	}
	list := resources.(map[string]any)["resources"].([]map[string]any)
	if len(list) != 1 || list[0]["name"] != "Recut project context" {
		t.Fatalf("resources = %#v", resources)
	}
	tools, err := handleMCP(bridge, session, mcpRequest{Method: "tools/list"})
	if err != nil {
		t.Fatal(err)
	}
	if len(tools.(map[string]any)["tools"].([]map[string]any)) < 5 {
		t.Fatalf("tools = %#v", tools)
	}
}

func testBridgeSession(t *testing.T) (*AgentBridge, AgentSession) {
	t.Helper()
	root := t.TempDir()
	appsDir := root + "/apps/example"
	if err := os.MkdirAll(appsDir+"/schemas", 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, appsDir+"/manifest.json", `{"id":"example.app","name":"Example","version":"1.0.0"}`)
	writeTestFile(t, appsDir+"/project-layout.json", `{"version":1,"files":[{"path":"data/model.json","schema":"schemas/model.json","kind":"source"}]}`)
	apps, err := LoadCatalog(root + "/apps")
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(root+"/data", apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session, _, err := bridge.CreateSession(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	return bridge, session
}
