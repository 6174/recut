/*
 * [INPUT]: 依赖 editor_agent_test.go 的真实 Editor App setup、MCP 调用、事件账本与 realtime WS 辅助。
 * [OUTPUT]: 锁定迁移后 recut.editor 两层契约：① 每个 op 的归属（Go 原生 vs goja 兜底白名单）唯一且显式；
 *           ② Go 原生 op 产生的客户端可见实时事件信封（project.document.changed / project.assets.changed /
 *           project:locked / project:unlocked）字段完整，前端 useRecutProjectSync 可直接消费。
 * [POS]: Editor 迁移（native-migration RFC）的服务层回归；防止 op 静默落层或事件语义漂移。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gorilla/websocket"
)

// editorGojaOps 是 M2 组件域：仍由 goja background 承担（共享同一 appstate DB），
// 与 Go 原生 op 构成 recut.editor 的完整归属。新增/迁移 op 时必须显式更新此表。
var editorGojaOps = map[string]bool{
	"component.create":  true,
	"component.revise":  true,
	"component.define":  true,
	"component.verify":  true,
	"component.list":    true,
	"component.source":  true,
	"component.update":  true,
	"component.resolve": true,
	"component.archive": true,
	"component.commit":  true, // 受限子 Agent 唯一工具（非 manifest operation）
}

// TestEditorNativeDispatchCoverage 锁定「每个 recut.editor op 都有且只有一个归属」。
func TestEditorNativeDispatchCoverage(t *testing.T) {
	apps, _, _, _ := setupEditorTestApp(t)
	app, ok := apps.Get("recut.editor")
	if !ok {
		t.Fatal("editor app missing")
	}
	declared := map[string]bool{}
	for _, op := range app.Manifest.Operations {
		declared[op.Name] = true
		if editorGojaOps[op.Name] {
			if _, native := editorNativeHandlers[op.Name]; native {
				t.Errorf("op %q is both goja-listed and Go-native", op.Name)
			}
			continue
		}
		if _, native := editorNativeHandlers[op.Name]; !native {
			t.Errorf("op %q is neither Go-native nor in the goja allowlist (silent fallback)", op.Name)
		}
	}
	for name := range editorNativeHandlers {
		if !declared[name] {
			t.Errorf("Go-native handler %q is not declared in the editor manifest", name)
		}
	}
}

// waitProjectEvent 在 WS 上等待一条指定 type 的 project.event（跳过其它事件）。
func waitProjectEvent(t *testing.T, conn *websocket.Conn, wantType string, max int, match func(map[string]any) bool) map[string]any {
	t.Helper()
	for i := 0; i < max; i++ {
		frame := readWSFrame(t, conn)
		if frame["type"] != "project.event" {
			continue
		}
		event, _ := frame["event"].(map[string]any)
		if event == nil || event["type"] != wantType {
			continue
		}
		if match == nil || match(event) {
			return event
		}
	}
	t.Fatalf("did not receive project event %q", wantType)
	return nil
}

// TestEditorRealtimeEventContract 走真实 service + WS，断言 Go 原生 op 的客户端可见事件信封。
func TestEditorRealtimeEventContract(t *testing.T) {
	apps, store, host, project := setupEditorTestApp(t)
	server := NewServer(apps, store, nil, nil, nil, nil, NewMediaService(store))
	srv := httptest.NewServer(server.routes())
	t.Cleanup(srv.Close)
	conn := dialRealtime(t, srv)
	if err := conn.WriteJSON(map[string]any{
		"type":     "subscribe",
		"channels": []map[string]any{{"channel": "project", "projectId": project.ID}},
	}); err != nil {
		t.Fatal(err)
	}
	if ack := readWSFrame(t, conn); ack["type"] != "subscribed" {
		t.Fatalf("subscribe ack = %#v", ack)
	}

	invoke(t, host, project, "project.create", map[string]any{})

	insert := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert", "payload": map[string]any{
			"element": map[string]any{"type": "image", "name": "sync", "mediaId": "a1", "startSec": float64(0), "durationSec": float64(2)},
		},
	}})
	if !boolOf(insert["ok"]) {
		t.Fatalf("insert = %#v", insert)
	}

	// project.document.changed：前端 applyRemoteOperations 依赖 document + operations + 版本区间。
	changed := waitProjectEvent(t, conn, "project.document.changed", 12, func(ev map[string]any) bool {
		return numOf(ev["version"]) == 2
	})
	if numOf(changed["fromVersion"]) != 1 || numOf(changed["toVersion"]) != 2 {
		t.Fatalf("document.changed versions = %#v", changed)
	}
	if stringOf(changed["source"]) != "agent" {
		t.Fatalf("document.changed source = %#v", changed["source"])
	}
	ops, ok := changed["operations"].([]any)
	if !ok || len(ops) != 1 || operationType(ops[0]) != "insert" {
		t.Fatalf("document.changed operations = %#v", changed["operations"])
	}
	document, ok := changed["document"].(map[string]any)
	if !ok || countProjectElements(document) != 1 {
		t.Fatalf("document.changed document = %#v", changed["document"])
	}

	// project.assets.changed：前端素材面板实时刷新依赖 library.tab=media。
	invoke(t, host, project, "timeline.assets", map[string]any{"assetIds": []any{"a1"}})
	assets := waitProjectEvent(t, conn, "project.assets.changed", 12, func(ev map[string]any) bool {
		lib, _ := ev["library"].(map[string]any)
		return stringOf(lib["tab"]) == "media"
	})
	if ids, _ := assets["mediaIds"].([]any); len(ids) == 0 {
		t.Fatalf("assets.changed mediaIds = %#v", assets["mediaIds"])
	}

	// project:locked / project:unlocked：前端据此暂停/恢复保存并显示 AI 编辑态。
	lock := invoke(t, host, project, "project.lock", map[string]any{"owner": "agent-sync"})
	lockInfo := lock["lock"].(map[string]any)
	locked := waitProjectEvent(t, conn, "project:locked", 12, nil)
	if stringOf(locked["owner"]) != "agent-sync" {
		t.Fatalf("project:locked owner = %#v", locked["owner"])
	}
	invoke(t, host, project, "project.unlock", map[string]any{"owner": lockInfo["owner"], "token": lockInfo["token"]})
	waitProjectEvent(t, conn, "project:unlocked", 12, nil)
}
