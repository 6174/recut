/*
 * [INPUT]: 依赖 WorldStore/Store、EventBus、HTTP 画布写处理器（saveCanvasDocument）
 * [OUTPUT]: 验证多标签页同步的广播语义：用户（HTTP）画布写成功后广播 world.changed（source=web，带
 *           contextId/version/clientId），且**幂等写不广播**（防 reload 风暴）
 * [POS]: service 的画布多标签页同步回归测试（RFC 2026-10-03-world-canvas-multitab-sync）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSaveCanvasDocumentBroadcastsChangedForWebWrites(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Web Sync", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}

	s := &Server{bus: newEventBus(), worlds: worlds}
	client := newWSClient()
	s.bus.Register(client)
	s.bus.Subscribe(client, "world", world.ID)

	// drain 取出本轮已投递到该订阅者的 world 事件（非阻塞）。
	drain := func() []map[string]any {
		var out []map[string]any
		for {
			select {
			case frame := <-client.send:
				var parsed struct {
					Data map[string]any `json:"data"`
				}
				_ = json.Unmarshal(frame, &parsed)
				out = append(out, parsed.Data)
			default:
				return out
			}
		}
	}
	post := func(body string) (int, int) {
		req := httptest.NewRequest("POST", "/v1/worlds/"+world.ID+"/canvas/doc", strings.NewReader(body))
		req.SetPathValue("worldID", world.ID)
		rec := httptest.NewRecorder()
		s.saveCanvasDocument(rec, req)
		var parsed struct {
			Version int `json:"version"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
		return rec.Code, parsed.Version
	}

	// ① 首次写（建元素）→ 有实质变化 → 广播一条 world.changed（source=web，带 clientId/contextId/version）。
	code, v1 := post(`{"contextId":"","patch":true,"version":0,"clientId":"tab-a","elements":[{"id":"shape:note-1","kind":"note","geometry":{"x":10,"y":20}}]}`)
	if code != 200 {
		t.Fatalf("first write status=%d", code)
	}
	events := drain()
	if len(events) != 1 {
		t.Fatalf("first write events = %#v", events)
	}
	got := events[0]
	if got["event"] != "world.changed" || got["source"] != "web" || got["clientId"] != "tab-a" || got["contextId"] != "" {
		t.Fatalf("first write event = %#v", got)
	}
	if v, _ := got["version"].(float64); int(v) != v1 {
		t.Fatalf("event version = %v, want %d", got["version"], v1)
	}

	// ② 幂等重写（同 geometry，无实质变化）→ 不广播（否则会造成其它标签页 reload 风暴）。
	code, v2 := post(fmt.Sprintf(`{"contextId":"","patch":true,"version":%d,"clientId":"tab-a","elements":[{"id":"shape:note-1","geometry":{"x":10,"y":20}}]}`, v1))
	if code != 200 {
		t.Fatalf("idempotent write status=%d", code)
	}
	if events := drain(); len(events) != 0 {
		t.Fatalf("idempotent write must not broadcast, got %#v", events)
	}

	// ③ 真实改动（geometry.x）→ 再次广播。
	code, _ = post(fmt.Sprintf(`{"contextId":"","patch":true,"version":%d,"clientId":"tab-b","elements":[{"id":"shape:note-1","geometry":{"x":99}}]}`, v2))
	if code != 200 {
		t.Fatalf("second-change write status=%d", code)
	}
	events = drain()
	if len(events) != 1 || events[0]["clientId"] != "tab-b" {
		t.Fatalf("second-change events = %#v", events)
	}
}

func TestPatchCanvasDocumentChangedFlag(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Changed Flag", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	noteKind := "note"
	doc, err := worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: world.ID, ContextID: "",
		Elements:        []CanvasElementPatch{{ID: "shape:n1", Kind: &noteKind, Geometry: map[string]any{"x": float64(1), "y": float64(2)}}},
		ExpectedVersion: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !doc.Changed {
		t.Fatal("insert should mark Changed")
	}
	// 同一字段同值：不改变文档 → Changed=false。
	doc, err = worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: world.ID, ContextID: "",
		Elements:        []CanvasElementPatch{{ID: "shape:n1", Geometry: map[string]any{"x": float64(1)}}},
		ExpectedVersion: doc.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Changed {
		t.Fatal("idempotent patch must not mark Changed")
	}
	// 改一个字段：Changed=true。
	doc, err = worlds.PatchCanvasDocument(PatchCanvasDocumentInput{
		WorldID: world.ID, ContextID: "",
		Elements:        []CanvasElementPatch{{ID: "shape:n1", Geometry: map[string]any{"x": float64(5)}}},
		ExpectedVersion: doc.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !doc.Changed {
		t.Fatal("real change should mark Changed")
	}
}
