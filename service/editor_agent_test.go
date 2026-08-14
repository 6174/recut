package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setupEditorTestApp 把真实 recut.editor 应用（../apps/editor）复制进临时目录并建项目，
// 使测试走真实 background.js + manifest + goja host + sqlite 全链路。
func setupEditorTestApp(t *testing.T) (*Catalog, *Store, *AppHost, Project) {
	t.Helper()
	src := filepath.Join("..", "apps", "editor")
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "recut-editor")
	if err := os.MkdirAll(filepath.Join(appDir, "ui", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	manifest, err := os.ReadFile(filepath.Join(src, "manifest.json"))
	if err != nil {
		t.Fatalf("read editor manifest: %v", err)
	}
	background, err := os.ReadFile(filepath.Join(src, "background.js"))
	if err != nil {
		t.Fatalf("read editor background: %v", err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), string(manifest))
	writeTestFile(t, filepath.Join(appDir, "background.js"), string(background))
	writeTestFile(t, filepath.Join(appDir, "ui", "dist", "index.html"), "ok")

	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Editor E2E", AppID: "recut.editor"})
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	return apps, store, host, project
}

// invoke 走与 MCP 完全相同的 InvokeMCP 路径（surface 门 + __recut 解析 + goja 执行）。
func invoke(t *testing.T, host *AppHost, project Project, op string, input map[string]any) map[string]any {
	t.Helper()
	res, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: "recut.editor"}, "recut.editor", op, input)
	if err != nil {
		t.Fatalf("%s: %v", op, err)
	}
	raw, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("%s marshal: %v", op, err)
	}
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%s unmarshal: %v", op, err)
	}
	return out
}

func projectEvents(store *Store, projectID string) []map[string]any {
	events, _ := store.ListProjectEvents(projectID, 0)
	out := []map[string]any{}
	for _, e := range events {
		m := map[string]any{}
		if json.Unmarshal([]byte(e.Payload), &m) == nil {
			out = append(out, m)
		}
	}
	return out
}

// TestEditorAgentDataLayer 覆盖：建项目→读→写 op 日志→D1 关键帧→validate→undo/redo→冲突→aiLock，
// 并断言每条 mutation 都经 ctx.project.emit 落 events 账本（前端同步的数据源）。
func TestEditorAgentDataLayerAndOps(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)

	created := invoke(t, host, project, "project.create", map[string]any{})
	if v := numOf(created["version"]); v != 1 {
		t.Fatalf("project.create version = %v, want 1", created["version"])
	}

	// timeline.command insert（可 undo 写入口）
	ins := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert",
		"payload": map[string]any{
			"element": map[string]any{"type": "video", "name": "A", "mediaId": "a1", "startSec": float64(0), "durationSec": float64(2)},
		},
	}})
	if !boolOf(ins["ok"]) || numOf(ins["version"]) != 2 {
		t.Fatalf("insert = %#v", ins)
	}
	el := ins["result"].(map[string]any)["element"].(map[string]any)
	ref := map[string]any{"trackId": el["trackId"], "elementId": el["elementId"]}

	// timeline.read
	read := invoke(t, host, project, "timeline.read", map[string]any{})
	clips := read["clips"].([]any)
	if len(clips) != 1 {
		t.Fatalf("timeline.read clips = %#v", read)
	}
	if d := clips[0].(map[string]any)["durationSec"].(float64); d != 2 {
		t.Fatalf("durationSec = %v, want 2", d)
	}

	// element.get
	got := invoke(t, host, project, "element.get", ref)
	if got["element"].(map[string]any)["type"] != "video" {
		t.Fatalf("element.get = %#v", got)
	}

	// D1 关键帧：先写基础值，再 upsert 关键帧，再带 atSec param → 落关键帧
	invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "param", "payload": map[string]any{"ref": ref, "params": map[string]any{"opacity": float64(0.5)}},
	}})
	invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "keyframe-upsert", "payload": map[string]any{"ref": ref, "path": "opacity", "atSec": float64(0), "value": float64(0)},
	}})
	invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "param", "payload": map[string]any{"ref": ref, "params": map[string]any{"opacity": float64(1)}, "atSec": float64(2)},
	}})
	det := invoke(t, host, project, "element.get", ref)
	anim := det["element"].(map[string]any)["animations"].(map[string]any)
	if anim["opacity"] == nil || numOf(anim["opacity"].(map[string]any)["keyCount"]) != 2 {
		t.Fatalf("expected 2 opacity keyframes, got %#v", anim)
	}

	// validate：未登记素材 → asset-exists
	val := invoke(t, host, project, "timeline.validate", map[string]any{})
	if boolOf(val["ok"]) {
		t.Fatalf("validate should fail before asset registration: %#v", val)
	}
	// 登记素材
	invoke(t, host, project, "timeline.assets", map[string]any{"assetIds": []any{"a1"}})
	val = invoke(t, host, project, "timeline.validate", map[string]any{})
	if !boolOf(val["ok"]) || len(val["violations"].([]any)) != 0 {
		t.Fatalf("validate after registration = %#v", val)
	}

	// undo → 撤销最后一条 keyframe-upsert（opacity 回 1 条）
	u := invoke(t, host, project, "history.undo", map[string]any{})
	if !boolOf(u["ok"]) {
		t.Fatalf("undo = %#v", u)
	}
	det = invoke(t, host, project, "element.get", ref)
	anim = det["element"].(map[string]any)["animations"].(map[string]any)
	if numOf(anim["opacity"].(map[string]any)["keyCount"]) != 1 {
		t.Fatalf("undo should remove keyframe, got %#v", anim)
	}

	// redo → 恢复 2 条
	r := invoke(t, host, project, "history.redo", map[string]any{})
	if !boolOf(r["ok"]) {
		t.Fatalf("redo = %#v", r)
	}

	// baseVersion 冲突
	cur := numOf(invoke(t, host, project, "project.get", map[string]any{})["version"])
	conf := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "delete", "payload": map[string]any{"refs": []any{ref}}, "baseVersion": float64(1),
	}})
	if boolOf(conf["ok"]) || !boolOf(conf["conflict"]) || numOf(conf["currentVersion"]) != cur {
		t.Fatalf("stale baseVersion should conflict: %#v", conf)
	}

	// aiLock：lock → UI save 被拒 → unlock
	lock := invoke(t, host, project, "project.lock", map[string]any{"owner": "agent-e2e"})
	if !boolOf(lock["ok"]) {
		t.Fatalf("lock = %#v", lock)
	}
	// UI 整份保存走 api surface（InvokeAPI）；锁内应被拒
	uiSave, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: "recut.editor"}, "recut.editor", "project.save", map[string]any{"project": map[string]any{"metadata": map[string]any{}}})
	if err != nil {
		t.Fatalf("project.save (UI) under lock: %v", err)
	}
	uiSaveJSON, _ := json.Marshal(uiSave)
	uiSaveMap := map[string]any{}
	_ = json.Unmarshal(uiSaveJSON, &uiSaveMap)
	if !boolOf(uiSaveMap["locked"]) {
		t.Fatalf("UI save under lock should be rejected: %#v", uiSaveMap)
	}
	unlock := invoke(t, host, project, "project.unlock", map[string]any{})
	if !boolOf(unlock["ok"]) {
		t.Fatalf("unlock = %#v", unlock)
	}

	// 事件账本：每条 mutation 都广播 project.document.changed
	changed := map[int]bool{}
	for _, e := range projectEvents(store, project.ID) {
		if e["type"] == "project.document.changed" {
			changed[int(numOf(e["version"]))] = true
		}
	}
	for _, v := range []int{2, 3, 4, 5, 6, 7} {
		if !changed[v] {
			t.Fatalf("missing project.document.changed version=%d in %#v", v, changed)
		}
	}
	lockedSeen := false
	for _, e := range projectEvents(store, project.ID) {
		if e["type"] == "project:locked" && e["owner"] == "agent-e2e" {
			lockedSeen = true
		}
	}
	if !lockedSeen {
		t.Fatal("missing project:locked event")
	}
}

// TestEditorAgentSyncToRealtimeWS 覆盖后端→前端同步链路：
// 后台 ctx.project.emit → events 账本 → project WS channel → 客户端帧。
func TestEditorAgentSyncToRealtimeWS(t *testing.T) {
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
	ack := readWSFrame(t, conn)
	if ack["type"] != "subscribed" {
		t.Fatalf("subscribe ack = %#v", ack)
	}

	// 通过真实 MCP 路径执行一次写 → 应广播 project.document.changed{version:2}
	invoke(t, host, project, "project.create", map[string]any{})
	invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert", "payload": map[string]any{
			"element": map[string]any{"type": "image", "name": "B", "mediaId": "a2", "startSec": float64(0), "durationSec": float64(3)},
		},
	}})

	found := false
	for i := 0; i < 6 && !found; i++ {
		frame := readWSFrame(t, conn)
		if frame["type"] != "project.event" {
			continue
		}
		ev, ok := frame["event"].(map[string]any)
		if !ok {
			continue
		}
		if ev["type"] == "project.document.changed" && numOf(ev["version"]) == 2 {
			found = true
		}
	}
	if !found {
		t.Fatal("WS project channel did not deliver project.document.changed{version:2}")
	}
}

// numOf / boolOf 取 JSON 数值/布尔。
func numOf(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	}
	return 0
}
func boolOf(v any) bool {
	b, _ := v.(bool)
	return b
}

func TestEditorManifestIsSelfConsistent(t *testing.T) {
	src := filepath.Join("..", "apps", "editor")
	raw, err := os.ReadFile(filepath.Join(src, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Operations []struct {
			Name     string   `json:"name"`
			Surfaces []string `json:"surfaces"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, op := range manifest.Operations {
		if seen[op.Name] {
			t.Fatalf("duplicate operation %q", op.Name)
		}
		seen[op.Name] = true
		if len(op.Surfaces) == 0 {
			t.Fatalf("operation %q has no surfaces", op.Name)
		}
	}
	// 关键 AI 操作必须 mcp surface
	for _, must := range []string{"timeline.read", "element.get", "timeline.validate", "timeline.command", "history.undo", "project.lock", "component.define", "component.list"} {
		ok := false
		for _, op := range manifest.Operations {
			if op.Name == must && strings.Contains(strings.Join(op.Surfaces, ","), "mcp") {
				ok = true
			}
		}
		if !ok {
			t.Fatalf("operation %q must have mcp surface", must)
		}
	}
}
