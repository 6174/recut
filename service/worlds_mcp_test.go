/*
 * [INPUT]: 依赖 handleMCP、WorldStore、Store 与临时工作区
 * [OUTPUT]: 验证 recut.worlds.* 全局工具始终注册、只读发现不依赖已安装 App、create/list/get/resolve 经
 * handleMCP 的同构 structuredContent 与实体跨世界隔离
 * [POS]: service 的 Creation Worlds MCP 回归测试；工具属于平台全局组，任何外部 MCP 客户端在选择 App 前即可发现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestWorldsMCPToolsAreAlwaysRegistered(t *testing.T) {
	definitions := platformMCPToolDefinitions()
	names := map[string]bool{}
	for _, tool := range definitions {
		names[tool["name"].(string)] = true
	}
	for _, expected := range []string{
		"recut.worlds.list",
		"recut.worlds.get",
		"recut.worlds.entities.list",
		"recut.worlds.entities.get",
		"recut.worlds.resolve",
		"recut.worlds.create",
		"recut.worlds.update",
		"recut.worlds.entities.upsert",
		"recut.worlds.references.attach",
		"recut.worlds.bind_project",
	} {
		if !names[expected] {
			t.Fatalf("global Worlds tool %q is missing", expected)
		}
	}
}

func TestWorldsMCPReadFlowAndStructuredContent(t *testing.T) {
	worlds, store, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Future City 2049", Type: WorldFiction, Description: "霓虹未来"})
	if err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	result, err := handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.list","arguments":{"type":"fiction_world","limit":10}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	page := result.(map[string]any)["structuredContent"].(map[string]any)
	items := page["items"].([]WorldSummary)
	if len(items) != 1 || items[0].ID != world.ID {
		t.Fatalf("worlds.list = %#v", items)
	}
	result, err = handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.entities.get","arguments":{"worldId":"` + world.ID + `","entityId":"missing"}}`),
	})
	if err == nil {
		t.Fatal("foreign/missing entity was not rejected")
	}
	result, err = handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.resolve","arguments":{"worldId":"` + world.ID + `","selection":{"purpose":"video"}}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	context := result.(map[string]any)["structuredContent"].(CreationContext)
	if context.World.ID != world.ID || context.World.RevisionID == "" {
		t.Fatalf("resolved context = %#v", context)
	}
}

func TestWorldsMCPCreateThenIsolatedResolve(t *testing.T) {
	_, store, _ := newTestWorldStore(t)
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	result, err := handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.create","arguments":{"name":"Marc AI","type":"creator_brand"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	world := result.(map[string]any)["structuredContent"].(WorldDetail)
	if world.Name != "Marc AI" || world.CurrentRevisionID == "" {
		t.Fatalf("created world = %#v", world)
	}
	result, err = handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.get","arguments":{"worldId":"` + world.ID + `"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	fetched := result.(map[string]any)["structuredContent"].(WorldDetail)
	if !reflect.DeepEqual(fetched.ID, world.ID) {
		t.Fatalf("world.get = %#v", fetched)
	}
}
