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
	"strings"
	"testing"
)

func TestWorldsMCPToolsAreAlwaysRegistered(t *testing.T) {
	definitions := platformMCPToolDefinitions(DefaultLocale)
	names := map[string]bool{}
	for _, tool := range definitions {
		names[tool["name"].(string)] = true
	}
	for _, expected := range []string{
		"recut.worlds.list",
		"recut.worlds.get",
		"recut.worlds.entities.list",
		"recut.worlds.entities.get",
		"recut.worlds.entityTypes.list",
		"recut.worlds.doc",
		"recut.worlds.docs",
		"recut.worlds.create",
		"recut.worlds.update",
		"recut.worlds.fork",
		"recut.worlds.delete",
		"recut.worlds.revisions.list",
		"recut.worlds.revert",
		"recut.worlds.export",
		"recut.worlds.import",
		"recut.worlds.proposals.list",
		// 方案 A：内容写入收口在画布接口（无额外 canvas 层）。
		"recut.worlds.entity",
		"recut.worlds.relation",
		"recut.worlds.entityType",
		"recut.worlds.doc.update",
		"recut.worlds.promote",
		"recut.worlds.lock",
		"recut.worlds.unlock",
	} {
		if !names[expected] {
			t.Fatalf("global Worlds tool %q is missing", expected)
		}
	}
	// 收口：语义 CRUD 写入面下线，内容只能经画布接口写。
	for _, removed := range []string{
		"recut.worlds.entities.upsert",
		"recut.worlds.entities.create_child",
		"recut.worlds.entities.promote",
		"recut.worlds.relations.create",
		"recut.worlds.relations.update",
		"recut.worlds.entityTypes.upsert",
		"recut.worlds.references.attach",
		"recut.worlds.evidence.attach",
		"recut.worlds.evidence.update",
	} {
		if names[removed] {
			t.Fatalf("retired tool %q must be removed from the MCP surface", removed)
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
}

func TestWorldsMCPDeleteRequiresNameConfirmation(t *testing.T) {
	_, store, _ := newTestWorldStore(t)
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	result, err := handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.create","arguments":{"name":"Doomed","type":"custom"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	world := result.(map[string]any)["structuredContent"].(WorldDetail)
	if _, err := handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.delete","arguments":{"worldId":"` + world.ID + `","name":"Wrong"}}`),
	}); err == nil {
		t.Fatal("delete accepted a mismatched name")
	}
	result, err = handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.delete","arguments":{"worldId":"` + world.ID + `","name":"Doomed"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	structured := result.(map[string]any)["structuredContent"].(map[string]any)
	if deleted, _ := structured["deleted"].(bool); !deleted {
		t.Fatalf("delete structuredContent = %#v", structured)
	}
	if _, err := handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.worlds.get","arguments":{"worldId":"` + world.ID + `"}}`),
	}); err == nil {
		t.Fatal("deleted world is still readable")
	}
}

func TestWorldsMCPCanvasWriteSurface(t *testing.T) {
	_, store, _ := newTestWorldStore(t)
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	call := func(name, args string) (any, error) {
		return handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
			Method: "tools/call",
			Params: json.RawMessage(`{"name":"` + name + `","arguments":` + args + `}`),
		})
	}
	created, err := call("recut.worlds.create", `{"name":"Canvas World","type":"custom"}`)
	if err != nil {
		t.Fatal(err)
	}
	world := created.(map[string]any)["structuredContent"].(WorldDetail)

	// create 实体 + 在根画布自动放置投影卡。
	res, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"create","typeId":"character","name":"Hero","intro":"s","contextId":""}`)
	if err != nil {
		t.Fatal(err)
	}
	hero := res.(map[string]any)["structuredContent"].(WorldEntity)
	if hero.ID == "" || hero.Name != "Hero" {
		t.Fatalf("entity = %#v", hero)
	}
	docRes, err := call("recut.worlds.doc", `{"worldId":"`+world.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	doc := docRes.(map[string]any)["structuredContent"].(map[string]any)
	elements := doc["elements"].([]WorldCanvasElement)
	placed := false
	for _, element := range elements {
		if element.Kind == "entity" && element.RefID == hero.ID {
			placed = true
		}
	}
	if !placed {
		t.Fatalf("projection card not placed: %#v", elements)
	}

	// 一等字段经画布接口更新。
	upd, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"update","entityId":"`+hero.ID+`","intro":"changed"}`)
	if err != nil {
		t.Fatal(err)
	}
	if upd.(map[string]any)["structuredContent"].(WorldEntity).Intro != "changed" {
		t.Fatalf("first-class field not updated")
	}

	// 子设定 + parentId 过滤。
	if _, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"create","typeId":"object","name":"Item","parentId":"`+hero.ID+`"}`); err != nil {
		t.Fatal(err)
	}
	childrenRes, err := call("recut.worlds.entities.list", `{"worldId":"`+world.ID+`","parentId":"`+hero.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	children := childrenRes.(map[string]any)["structuredContent"].(map[string]any)["items"].([]WorldEntitySummary)
	if len(children) != 1 || children[0].Name != "Item" {
		t.Fatalf("children = %#v", children)
	}

	// 归档 → 列表隐藏；恢复 → 可见。
	if _, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"archive","entityId":"`+hero.ID+`"}`); err != nil {
		t.Fatal(err)
	}
	listRes, err := call("recut.worlds.entities.list", `{"worldId":"`+world.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	items := listRes.(map[string]any)["structuredContent"].(map[string]any)["items"].([]WorldEntitySummary)
	if len(items) != 0 {
		t.Fatalf("archived entity still listed: %#v", items)
	}
	if _, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"restore","entityId":"`+hero.ID+`"}`); err != nil {
		t.Fatal(err)
	}
	listRes, err = call("recut.worlds.entities.list", `{"worldId":"`+world.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	items = listRes.(map[string]any)["structuredContent"].(map[string]any)["items"].([]WorldEntitySummary)
	// 恢复会连带恢复同一归档批次的子设定；hero 必须带着原名回来。
	foundHero := false
	for _, item := range items {
		if item.ID == hero.ID && item.Name == "Hero" {
			foundHero = true
		}
	}
	if !foundHero {
		t.Fatalf("restored entity not listed or name lost: %#v", items)
	}
}

func TestWorldsMCPRevisionsProposalsAndAttrPatch(t *testing.T) {
	_, store, _ := newTestWorldStore(t)
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	call := func(name, args string) (any, error) {
		return handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
			Method: "tools/call",
			Params: json.RawMessage(`{"name":"` + name + `","arguments":` + args + `}`),
		})
	}
	created, err := call("recut.worlds.create", `{"name":"Rev World","type":"custom"}`)
	if err != nil {
		t.Fatal(err)
	}
	world := created.(map[string]any)["structuredContent"].(WorldDetail)

	// attrPatch：只按 key 合并单条属性，其余保持不变。
	res, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"create","typeId":"character","name":"Hero","attrs":[{"key":"appearance","label":"外貌","type":"textarea","value":"old"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	hero := res.(map[string]any)["structuredContent"].(WorldEntity)
	if _, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"update","entityId":"`+hero.ID+`","attrPatch":[{"key":"appearance","value":"new"},{"key":"tag","label":"标签","type":"text","value":"x"}]}`); err != nil {
		t.Fatal(err)
	}
	got, err := call("recut.worlds.entities.get", `{"worldId":"`+world.ID+`","entityId":"`+hero.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	entity := got.(map[string]any)["structuredContent"].(WorldEntity)
	values := map[string]any{}
	labels := map[string]string{}
	for _, attr := range entity.Attrs {
		values[attr.Key] = attr.Value
		labels[attr.Key] = attr.Label
	}
	if values["appearance"] != "new" {
		t.Fatalf("attrPatch did not update appearance: %#v", entity.Attrs)
	}
	if values["tag"] != "x" || labels["tag"] != "标签" {
		t.Fatalf("attrPatch did not add attr: %#v", entity.Attrs)
	}

	// 版本历史 + 回滚 plumbing。
	revRes, err := call("recut.worlds.revisions.list", `{"worldId":"`+world.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	revisions := revRes.(map[string]any)["structuredContent"].(map[string]any)["items"].([]WorldRevisionSummary)
	if len(revisions) == 0 || revisions[0].ID == "" {
		t.Fatalf("revisions = %#v", revisions)
	}
	if _, err := call("recut.worlds.revert", `{"worldId":"`+world.ID+`","revisionId":"`+revisions[0].ID+`"}`); err != nil {
		t.Fatalf("revert: %v", err)
	}
}

func TestWorldsMCPDescriptionsLocalized(t *testing.T) {
	zh := map[string]string{}
	for _, tool := range worldsMCPToolDefinitions(LocaleZh) {
		zh[tool["name"].(string)] = tool["description"].(string)
	}
	en := map[string]string{}
	for _, tool := range worldsMCPToolDefinitions(LocaleEn) {
		en[tool["name"].(string)] = tool["description"].(string)
	}
	if len(zh) != len(en) || len(zh) == 0 {
		t.Fatalf("tool counts differ zh=%d en=%d", len(zh), len(en))
	}
	for name, text := range zh {
		if en[name] == "" {
			t.Fatalf("%s has no en description", name)
		}
		if en[name] == text {
			t.Fatalf("%s en description equals zh (not localized)", name)
		}
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
	fetched := result.(map[string]any)["structuredContent"].(WorldContext)
	if !reflect.DeepEqual(fetched.ID, world.ID) {
		t.Fatalf("world.get = %#v", fetched)
	}
}

// world.get 必须把 World 的实体图（entities + relations）与 world.md 一并返回，
// 否则 Agent 不知道世界里有谁、谁是主角色、它们怎么关联。
func TestWorldsMCPGetReturnsEntityGraphAndSkill(t *testing.T) {
	_, store, _ := newTestWorldStore(t)
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	call := func(name, args string) (any, error) {
		return handleMCP(bridge, NewAppHost(nil, store), media, AgentSession{ID: "s1"}, mcpRequest{
			Method: "tools/call",
			Params: json.RawMessage(`{"name":"` + name + `","arguments":` + args + `}`),
		})
	}
	created, err := call("recut.worlds.create", `{"name":"Graph World","type":"character_ip"}`)
	if err != nil {
		t.Fatal(err)
	}
	world := created.(map[string]any)["structuredContent"].(WorldDetail)
	heroRes, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"create","typeId":"character","name":"Hero"}`)
	if err != nil {
		t.Fatal(err)
	}
	hero := heroRes.(map[string]any)["structuredContent"].(WorldEntity)
	alleyRes, err := call("recut.worlds.entity", `{"worldId":"`+world.ID+`","op":"create","typeId":"location","name":"Alley"}`)
	if err != nil {
		t.Fatal(err)
	}
	alley := alleyRes.(map[string]any)["structuredContent"].(WorldEntity)
	if _, err := call("recut.worlds.relation", `{"worldId":"`+world.ID+`","op":"create","fromEntityId":"`+hero.ID+`","toEntityId":"`+alley.ID+`","relationType":"located_in"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := call("recut.worlds.update", `{"worldId":"`+world.ID+`","skillMd":"# Graph World\n\n英雄走在夜巷。"}`); err != nil {
		t.Fatal(err)
	}

	result, err := call("recut.worlds.get", `{"worldId":"`+world.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	fetched := result.(map[string]any)["structuredContent"].(WorldContext)
	if !strings.Contains(fetched.SkillMd, "英雄走在夜巷") {
		t.Fatalf("world.get must return world.md: %q", fetched.SkillMd)
	}
	// 合并后同一入口还要带生产上下文（facts / references）。
	if len(fetched.Facts.Characters) != 1 || fetched.Facts.Characters[0]["name"] != "Hero" {
		t.Fatalf("world.get must return facts: %#v", fetched.Facts)
	}
	kinds := map[string]bool{}
	for _, entity := range fetched.Entities {
		kinds[entity.TypeID] = true
	}
	if len(fetched.Entities) != 2 || !kinds["character"] || !kinds["location"] {
		t.Fatalf("world.get entities = %#v", fetched.Entities)
	}
	if len(fetched.Relations) != 1 || fetched.Relations[0].Type != "located_in" {
		t.Fatalf("world.get relations = %#v", fetched.Relations)
	}
	if fetched.Relations[0].FromEntityID != hero.ID || fetched.Relations[0].ToEntityID != alley.ID {
		t.Fatalf("relation ends wrong: %#v", fetched.Relations[0])
	}
}
