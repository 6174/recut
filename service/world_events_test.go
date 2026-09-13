/*
 * [INPUT]: 依赖 WorldStore/Store/WorldStore 的 MCP 适配层（worldsMCPTool）与 canvas 文档存储
 * [OUTPUT]: 验证 World Canvas 的 AI 反馈闭环：canvas.doc.update 的实体卡默认 id/名称/几何、
 *           canvas.docs 层索引、layout 只读回执，以及 canvas.lock/unlock 的 advisory 锁与 world.changed 广播
 * [POS]: service 的 World 写事件回归测试；不触网、不用真实模型提供商
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"testing"
)

func TestWorldCanvasPlacementDefaultsAndLayout(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Canvas World", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: "character", Name: "小黑", CreatedBy: "mcp"})
	if err != nil {
		t.Fatal(err)
	}
	// AI 只给 {kind, refId}：服务端补 shape:<entityId>、名称与默认几何。
	doc, err := worlds.UpdateCanvasDocumentOps(world.ID, "", []CanvasDocOp{{
		Op:      "insert",
		Element: &UpsertCanvasElementInput{WorldID: world.ID, Kind: "entity", RefKind: "entity", RefID: entity.ID},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Elements) != 1 {
		t.Fatalf("elements = %#v", doc.Elements)
	}
	element := doc.Elements[0]
	if element.ID != "shape:"+entity.ID {
		t.Fatalf("derived id = %q, want %q", element.ID, "shape:"+entity.ID)
	}
	if element.Name != "小黑" {
		t.Fatalf("derived name = %q", element.Name)
	}
	if got, _ := numericGeometry(element.Geometry["width"]); got != 264 {
		t.Fatalf("default width = %v", element.Geometry["width"])
	}
	if _, ok := element.Geometry["x"]; !ok {
		t.Fatalf("default x missing: %#v", element.Geometry)
	}

	// canvas.docs 层索引 + canvas.doc 的 layout 回执。
	result, err := worldsMCPTool(worlds, "recut.worlds.canvas.docs", map[string]any{"worldId": world.ID})
	if err != nil {
		t.Fatal(err)
	}
	docs := result.(map[string]any)["structuredContent"].(map[string]any)["items"].([]map[string]any)
	if len(docs) != 1 || docs[0]["contextId"] != "" {
		t.Fatalf("canvas.docs = %#v", docs)
	}
	result, err = worldsMCPTool(worlds, "recut.worlds.canvas.doc", map[string]any{"worldId": world.ID})
	if err != nil {
		t.Fatal(err)
	}
	payload := result.(map[string]any)["structuredContent"].(map[string]any)
	layout := payload["layout"].(map[string]any)
	if layout["elementCount"].(int) != 1 {
		t.Fatalf("layout = %#v", layout)
	}
	if layout["kinds"].(map[string]int)["entity"] != 1 {
		t.Fatalf("layout kinds = %#v", layout["kinds"])
	}
}

func TestWorldCanvasAdvisoryLockBroadcast(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Locked World", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	var events []map[string]any
	worlds.SetEventPublisher(func(_ string, data map[string]any) {
		events = append(events, data)
	})

	result, err := worldsMCPTool(worlds, "recut.worlds.canvas.lock", map[string]any{"worldId": world.ID, "owner": "agent"})
	if err != nil {
		t.Fatal(err)
	}
	locked := result.(map[string]any)["structuredContent"].(map[string]any)
	token, _ := locked["token"].(string)
	if token == "" || locked["acquired"] != true {
		t.Fatalf("lock result = %#v", locked)
	}
	if _, _, isLocked := worlds.canvasLockStatus(world.ID); !isLocked {
		t.Fatal("lock status not active after lock")
	}
	if len(events) != 1 || events[0]["event"] != "world.canvas.lock" {
		t.Fatalf("lock events = %#v", events)
	}

	// canvas.doc 回执携带锁状态，供 AI 自检。
	docResult, err := worldsMCPTool(worlds, "recut.worlds.canvas.doc", map[string]any{"worldId": world.ID})
	if err != nil {
		t.Fatal(err)
	}
	docPayload := docResult.(map[string]any)["structuredContent"].(map[string]any)
	if lock, ok := docPayload["lock"].(map[string]any); !ok || lock["owner"] != "agent" {
		t.Fatalf("canvas.doc lock = %#v", docPayload["lock"])
	}

	if _, err := worldsMCPTool(worlds, "recut.worlds.canvas.unlock", map[string]any{"worldId": world.ID, "token": token}); err != nil {
		t.Fatal(err)
	}
	if _, _, isLocked := worlds.canvasLockStatus(world.ID); isLocked {
		t.Fatal("lock status still active after unlock")
	}
	if events[len(events)-1]["event"] != "world.canvas.unlock" {
		t.Fatalf("unlock events = %#v", events)
	}
}

func TestWorldCanvasDocUpdateBroadcastsChanged(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Changed World", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	var events []map[string]any
	worlds.SetEventPublisher(func(_ string, data map[string]any) {
		events = append(events, data)
	})
	_, err = worldsMCPTool(worlds, "recut.worlds.canvas.doc.update", map[string]any{
		"worldId":   world.ID,
		"contextId": "",
		"ops": []any{map[string]any{
			"op":      "insert",
			"element": map[string]any{"kind": "note", "name": "便签", "props": map[string]any{"text": "hi"}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0]["event"] != "world.changed" || events[0]["tool"] != "recut.worlds.canvas.doc.update" {
		t.Fatalf("changed events = %#v", events)
	}
}
