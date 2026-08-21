package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setupEditorTestApp 把真实 recut.editor 应用（../apps/editor）复制进临时目录并建项目，
// 使测试走真实 background.js + backgroundModules + manifest + goja host + sqlite 全链路。
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
	backgroundDir := filepath.Join(src, "background")
	if entries, readErr := os.ReadDir(backgroundDir); readErr == nil {
		if err := os.MkdirAll(filepath.Join(appDir, "background"), 0o755); err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".js" {
				continue
			}
			content, fileErr := os.ReadFile(filepath.Join(backgroundDir, entry.Name()))
			if fileErr != nil {
				t.Fatal(fileErr)
			}
			writeTestFile(t, filepath.Join(appDir, "background", entry.Name()), string(content))
		}
	}
	writeTestFile(t, filepath.Join(appDir, "ui", "dist", "index.html"), "ok")
	// 组件构建链依赖：复制 scripts/component-build.js 与 sdk/，并让 ui/node_modules 指向真实应用
	// （component-build.js 从 `<appRoot>/scripts` 解析 esbuild/typescript 于 `<appRoot>/ui`）。
	if err := copyEditorDir(t, filepath.Join(src, "scripts"), filepath.Join(appDir, "scripts")); err != nil {
		t.Fatal(err)
	}
	if err := copyEditorDir(t, filepath.Join(src, "sdk"), filepath.Join(appDir, "sdk")); err != nil {
		t.Fatal(err)
	}
	realNodeModules := filepath.Join(src, "ui", "node_modules")
	if _, err := os.Stat(realNodeModules); err == nil {
		absReal, absErr := filepath.Abs(realNodeModules)
		if absErr != nil {
			t.Fatal(absErr)
		}
		if err := os.Symlink(absReal, filepath.Join(appDir, "ui", "node_modules")); err != nil {
			t.Fatal(err)
		}
	}
	// 随包 catalog（library.browse 的 shipped 回退源）
	catalogSrc := filepath.Join(src, "catalog")
	if entries, err := os.ReadDir(catalogSrc); err == nil {
		if err := os.MkdirAll(filepath.Join(appDir, "catalog"), 0o755); err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			content, err := os.ReadFile(filepath.Join(catalogSrc, entry.Name()))
			if err != nil {
				continue
			}
			writeTestFile(t, filepath.Join(appDir, "catalog", entry.Name()), string(content))
		}
	}

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
	return invokeSurface(t, host, project, op, input, "mcp")
}

// copyEditorDir 递归复制目录（非空内容），用于让测试 app 具备组件构建链的 scripts/sdk。
func copyEditorDir(t *testing.T, src, dst string) error {
	t.Helper()
	entries, err := os.ReadDir(src)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := copyEditorDir(t, srcPath, dstPath); err != nil {
				return err
			}
			continue
		}
		content, err := os.ReadFile(srcPath)
		if err != nil {
			return err
		}
		writeTestFile(t, dstPath, string(content))
	}
	return nil
}

// invokeAPI 走 InvokeAPI 路径（api surface 门），用于 cover.* 等仅 UI 的操作。
func invokeAPI(t *testing.T, host *AppHost, project Project, op string, input map[string]any) map[string]any {
	t.Helper()
	return invokeSurface(t, host, project, op, input, "api")
}

func invokeSurface(t *testing.T, host *AppHost, project Project, op string, input map[string]any, surface string) map[string]any {
	t.Helper()
	target := Target{ProjectID: project.ID, AppID: "recut.editor"}
	var (
		res any
		err error
	)
	if surface == "api" {
		res, err = host.InvokeAPI(target, "recut.editor", op, input)
	} else {
		res, err = host.InvokeMCP(target, "recut.editor", op, input)
	}
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
	lockInfo := lock["lock"].(map[string]any)
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
	unlock := invoke(t, host, project, "project.unlock", map[string]any{"owner": lockInfo["owner"], "token": lockInfo["token"]})
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

// TestEditorScriptSurface 覆盖 script.* 文稿面全链路（真实 background.js + goja + InvokeMCP）：
// 说话元素内嵌 transcript 快照 → script.read 物化 → 行内删词/删行 → script.apply 翻译回 op 批 →
// 碎片带 transcript 快照可再编辑 → script.find / fix-transcript / clean。
func TestEditorScriptSurface(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)

	invoke(t, host, project, "project.create", map[string]any{})
	ins := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert",
		"payload": map[string]any{
			"element": map[string]any{
				"type": "video", "name": "说话", "mediaId": "a1", "startSec": float64(0), "durationSec": float64(3),
				"transcript": map[string]any{
					"source": "transcript", "language": "zh",
					"segments": []any{
						map[string]any{"start": float64(0), "end": float64(1.5), "text": "大家好，嗯今天聊聊"},
						map[string]any{"start": float64(1.5), "end": float64(3), "text": "本地优先的平台"},
					},
				},
			},
		},
	}})
	if !boolOf(ins["ok"]) {
		t.Fatalf("insert = %#v", ins)
	}

	rd := invoke(t, host, project, "script.read", map[string]any{})
	if !boolOf(rd["ok"]) || numOf(rd["segments"]) != 2 {
		t.Fatalf("script.read = %#v", rd)
	}
	md := rd["content"].(string)
	if !strings.Contains(md, "嗯") || !strings.Contains(md, "本地优先") {
		t.Fatalf("script.read content unexpected:\n%s", md)
	}

	edited := strings.Replace(md, "嗯", "~~嗯~~", 1)
	lines := strings.Split(edited, "\n")
	kept := []string{}
	for _, ln := range lines {
		if strings.Contains(ln, ":1]") {
			continue // 删第二段
		}
		kept = append(kept, ln)
	}
	ap := invoke(t, host, project, "script.apply", map[string]any{"content": strings.Join(kept, "\n")})
	if !boolOf(ap["ok"]) || numOf(ap["pieces"]) != 2 {
		t.Fatalf("script.apply = %#v", ap)
	}
	read := invoke(t, host, project, "timeline.read", map[string]any{})
	clips := read["clips"].([]any)
	if len(clips) != 2 {
		t.Fatalf("after apply clips = %d, want 2", len(clips))
	}
	if !boolOf(clips[0].(map[string]any)["hasTranscript"]) {
		t.Fatalf("fragment should keep transcript snapshot: %#v", clips[0])
	}

	rd2 := invoke(t, host, project, "script.read", map[string]any{})
	if !boolOf(rd2["ok"]) {
		t.Fatalf("script.read after apply = %#v", rd2)
	}
	if strings.Contains(rd2["content"].(string), "本地优先") {
		t.Fatalf("deleted segment should be gone:\n%s", rd2["content"])
	}

	fd := invoke(t, host, project, "script.find", map[string]any{"text": "大家好"})
	if !boolOf(fd["ok"]) || len(fd["matches"].([]any)) != 1 {
		t.Fatalf("script.find = %#v", fd)
	}
	match := fd["matches"].([]any)[0].(map[string]any)

	fx := invoke(t, host, project, "script.fix-transcript", map[string]any{
		"trackId": match["trackId"], "elementId": match["elementId"], "segmentIndex": numOf(match["segment"]), "text": "修正文本",
	})
	if !boolOf(fx["ok"]) {
		t.Fatalf("script.fix-transcript = %#v", fx)
	}
	rd3 := invoke(t, host, project, "script.read", map[string]any{})
	if !strings.Contains(rd3["content"].(string), "修正文本") {
		t.Fatalf("fix should reflect in script.read:\n%s", rd3["content"])
	}

	cl := invoke(t, host, project, "script.clean", map[string]any{"fillers": true})
	if !boolOf(cl["ok"]) {
		t.Fatalf("script.clean = %#v", cl)
	}

	// 事件账本：script 批里的每条 op 都广播 project.document.changed
	changed := map[float64]bool{}
	for _, e := range projectEvents(store, project.ID) {
		if e["type"] == "project.document.changed" {
			changed[numOf(e["version"])] = true
		}
	}
	if len(changed) < 4 {
		t.Fatalf("expected multiple document.changed versions, got %#v", changed)
	}
}

// TestEditorAudioMix 覆盖 P3 自动混音：track.role（可 undo）+ duck 包络 + audio.smooth 幂等，
// 走真实 background.js + goja + InvokeMCP。
func TestEditorAudioMix(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)

	invoke(t, host, project, "project.create", map[string]any{})
	// 音乐轨 + 口播轨
	music := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "track-add", "payload": map[string]any{"type": "audio", "name": "音乐"},
	}})
	musicTrackId := music["result"].(map[string]any)["trackId"].(string)
	invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "track-add", "payload": map[string]any{"type": "audio", "name": "口播"},
	}})
	read := invoke(t, host, project, "timeline.read", map[string]any{})
	var voTrackId string
	for _, tr := range read["tracks"].([]any) {
		m := tr.(map[string]any)
		if m["name"] == "口播" {
			voTrackId = m["trackId"].(string)
		}
	}
	if voTrackId == "" {
		t.Fatalf("vo track not found: %#v", read["tracks"])
	}

	// role：口播=anchor，音乐=follower（duck 10dB）
	invoke(t, host, project, "track.role", map[string]any{"trackId": voTrackId, "role": "anchor"})
	role := invoke(t, host, project, "track.role", map[string]any{"trackId": musicTrackId, "role": "follower", "duckDepthDb": float64(10)})
	if !boolOf(role["ok"]) {
		t.Fatalf("track.role = %#v", role)
	}
	read = invoke(t, host, project, "timeline.read", map[string]any{})
	roleSeen := false
	for _, tr := range read["tracks"].([]any) {
		m := tr.(map[string]any)
		if m["trackId"] == voTrackId && m["role"] == "anchor" {
			roleSeen = true
		}
	}
	if !roleSeen {
		t.Fatalf("track role not exposed in timeline.read: %#v", read["tracks"])
	}

	// 音乐元素
	ins := invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert", "payload": map[string]any{
			"trackId": musicTrackId,
			"element": map[string]any{"type": "audio", "name": "BGM", "mediaId": "bgm1", "sourceType": "upload", "startSec": float64(0), "durationSec": float64(6)},
		},
	}})
	if !boolOf(ins["ok"]) {
		t.Fatalf("insert bgm = %#v", ins)
	}
	// 登记素材，validate 零违反
	invoke(t, host, project, "timeline.assets", map[string]any{"assetIds": []any{"bgm1", "vo1"}})

	sm := invoke(t, host, project, "audio.smooth", map[string]any{})
	if !boolOf(sm["ok"]) || numOf(sm["applied"]) != 4 {
		t.Fatalf("audio.smooth = %#v", sm)
	}
	bgmEl := ins["result"].(map[string]any)["element"].(map[string]any)
	det := invoke(t, host, project, "element.get", bgmEl)
	anim := det["element"].(map[string]any)["animations"].(map[string]any)
	if anim["volume"] == nil || numOf(anim["volume"].(map[string]any)["keyCount"]) != 4 {
		t.Fatalf("audio.smooth should add 4 volume keyframes: %#v", det["element"])
	}
	sm2 := invoke(t, host, project, "audio.smooth", map[string]any{})
	if !boolOf(sm2["ok"]) || numOf(sm2["applied"]) != 0 {
		t.Fatalf("audio.smooth should be idempotent: %#v", sm2)
	}

	val := invoke(t, host, project, "timeline.validate", map[string]any{})
	if !boolOf(val["ok"]) {
		t.Fatalf("validate = %#v", val)
	}

	// undo 链：撤销一次 audio.smooth 的最后一个 keyframe
	u := invoke(t, host, project, "history.undo", map[string]any{})
	if !boolOf(u["ok"]) {
		t.Fatalf("undo = %#v", u)
	}
	// 事件账本确认写广播
	changed := 0
	for _, e := range projectEvents(store, project.ID) {
		if e["type"] == "project.document.changed" {
			changed += 1
		}
	}
	if changed < 6 {
		t.Fatalf("expected broadcast versions, got %d", changed)
	}
}

// TestEditorPlaceAudioAndAudioResolvable 覆盖 AI 音频落轨一等公民链路：
// timeline.placeAudio 由 AI 只给 media assetId，后端推导 sourceType:upload+mediaId，
// 自动登记并广播 project.assets.changed（前端实时同步事件）；validate 对无效
// library+无 sourceUrl 的组合报 audio-unresolvable。
func TestEditorPlaceAudioAndAudioResolvable(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{})

	// 1) timeline.placeAudio：AI 只给媒体 assetId + start/duration
	pa := invoke(t, host, project, "timeline.placeAudio", map[string]any{"items": []any{
		map[string]any{"assetId": "voice-1", "name": "旁白", "startSec": float64(0), "durationSec": float64(5)},
		map[string]any{"assetId": "voice-2", "name": "旁白2", "startSec": float64(5), "durationSec": float64(4)},
	}})
	if !boolOf(pa["ok"]) {
		t.Fatalf("placeAudio = %#v", pa)
	}
	refs := pa["result"].(map[string]any)["refs"].([]any)
	if len(refs) != 2 {
		t.Fatalf("placeAudio refs = %d, want 2", len(refs))
	}

	// 2) 回读：两个音频元素都应是 sourceType:upload + mediaId
	read := invoke(t, host, project, "timeline.read", map[string]any{})
	clips := read["clips"].([]any)
	if len(clips) != 2 {
		t.Fatalf("clips = %d, want 2", len(clips))
	}
	for _, c := range clips {
		m := c.(map[string]any)
		if m["type"] != "audio" {
			t.Fatalf("clip type = %#v", m["type"])
		}
		if stringOf(m["sourceType"]) != "upload" {
			t.Fatalf("audio sourceType = %#v, want upload", m["sourceType"])
		}
		mediaID := stringOf(m["mediaId"])
		if mediaID != "voice-1" && mediaID != "voice-2" {
			t.Fatalf("audio mediaId = %#v", mediaID)
		}
	}

	// 3) validate：mediaId 已被自动登记 → 零违反（可播放）
	val := invoke(t, host, project, "timeline.validate", map[string]any{})
	if !boolOf(val["ok"]) || len(val["violations"].([]any)) != 0 {
		t.Fatalf("validate after placeAudio = %#v", val)
	}

	// 4) 反向用例：直接 insert 一个 library + 无 sourceUrl 的音频 → validate 报 audio-unresolvable
	lst := invoke(t, host, project, "timeline.read", map[string]any{})
	tracks := lst["tracks"].([]any)
	var audioTrack string
	for _, tr := range tracks {
		m := tr.(map[string]any)
		if m["type"] == "audio" {
			audioTrack = stringOf(m["trackId"])
			break
		}
	}
	if audioTrack == "" {
		t.Fatalf("no audio track found")
	}
	invoke(t, host, project, "timeline.command", map[string]any{"op": map[string]any{
		"type": "insert", "payload": map[string]any{
			"trackId": audioTrack,
			"element": map[string]any{"type": "audio", "name": "坏音频", "sourceType": "library", "startSec": float64(10), "durationSec": float64(3)},
		},
	}})
	val = invoke(t, host, project, "timeline.validate", map[string]any{})
	badFound := false
	for _, v := range val["violations"].([]any) {
		vm := v.(map[string]any)
		if stringOf(vm["code"]) == "audio-unresolvable" {
			badFound = true
		}
	}
	if !badFound {
		t.Fatalf("expected audio-unresolvable violation, got %#v", val)
	}

	// 5) 同步事件：placeAudio 与 timeline.assets 都广播 project.assets.changed{library.tab=media}
	assetSeen := false
	for _, e := range projectEvents(store, project.ID) {
		if e["type"] == "project.assets.changed" {
			if lib, ok := e["library"].(map[string]any); ok && stringOf(lib["tab"]) == "media" {
				assetSeen = true
			}
		}
	}
	if !assetSeen {
		t.Fatal("project.assets.changed event missing after placeAudio")
	}
}

// TestEditorPlaceAudioAttachesAssetToProject 覆盖「前端面板实时看到新增音频」的数据链路：
// placeAudio 会把引用的媒体素材 attach 到当前项目，使 recut.assets.list(projectId)
// 能取到它（编辑器媒体面板重拉即见、回放可解析）；同时校验 audio.save 之类 workspace 素材
// 不 attach 时不会出现在项目素材列表（缺省分离语义）。
func TestEditorPlaceAudioAttachesAssetToProject(t *testing.T) {
	_, store, _, project := setupEditorTestApp(t)
	media := NewMediaService(store)
	host := NewAppHost(store.catalog, store, media)

	vo, err := media.ImportMedia("voice-audio.wav", "audio/wav", []byte("RIFF"))
	if err != nil {
		t.Fatal(err)
	}
	png, err := media.ImportMedia("pic.png", "image/png", []byte("png"))
	if err != nil {
		t.Fatal(err)
	}

	invoke(t, host, project, "project.create", map[string]any{})

	// attach 前：项目素材列表不应包含 voice（workspace 分离）
	before, _ := media.ListAssets(project.ID)
	for _, a := range before {
		if a.ID == vo.ID {
			t.Fatalf("voice asset should not be project-attached before placeAudio: %#v", a)
		}
	}

	// 只 placeAudio 引用 voice；image 留作对照
	pa := invoke(t, host, project, "timeline.placeAudio", map[string]any{"items": []any{
		map[string]any{"assetId": vo.ID, "name": "旁白", "startSec": float64(0), "durationSec": float64(5)},
	}})
	if !boolOf(pa["ok"]) {
		t.Fatalf("placeAudio = %#v", pa)
	}

	// attach 后：voice 出现在项目素材列表（前端 recut.assets.list(projectId) 即见）；image 仍不归属
	after, _ := media.ListAssets(project.ID)
	voiceFound, imageFound := false, false
	for _, a := range after {
		if a.ID == vo.ID {
			voiceFound = true
		}
		if a.ID == png.ID {
			imageFound = true
		}
	}
	if !voiceFound {
		t.Fatal("placeAudio should attach the narration asset to the project (panel real-time visibility)")
	}
	if imageFound {
		t.Fatalf("unreferenced image should not be project-attached: %#v", png)
	}
}

// TestEditorLibraryBrowse 覆盖 P4 catalog-first：真实 goja 链路下 library.browse
// 按 CDN(若可达)→随包→builtin 顺序解析目录（网络无关断言：只检查内容不锁 source），
// 且能按 category/query 过滤。
func TestEditorLibraryBrowse(t *testing.T) {
	_, _, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{})

	all := invoke(t, host, project, "library.browse", map[string]any{"category": "effects"})
	if !boolOf(all["ok"]) {
		t.Fatalf("library.browse effects = %#v", all)
	}
	src := all["source"].(string)
	if src != "cdn" && src != "shipped" && src != "builtin" {
		t.Fatalf("unexpected catalog source %q", src)
	}
	items := all["items"].([]any)
	if len(items) < 4 {
		t.Fatalf("effects catalog should have >=4 effects, got %d (source=%s)", len(items), src)
	}
	first := items[0].(map[string]any)
	if first["kind"] != "effect" || first["id"] != "effect.glass" {
		t.Fatalf("first effect = %#v", first)
	}

	query := invoke(t, host, project, "library.browse", map[string]any{"category": "effects", "query": "magnify"})
	if numOf(query["count"]) != 1 || query["items"].([]any)[0].(map[string]any)["id"] != "effect.magnify" {
		t.Fatalf("library.browse query = %#v", query)
	}

	// 随包音频目录有 sfx → 无论 CDN 是否可达都有结果
	sfx := invoke(t, host, project, "library.browse", map[string]any{"category": "sound-effects"})
	if !boolOf(sfx["ok"]) || numOf(sfx["count"]) < 1 {
		t.Fatalf("library.browse sfx = %#v", sfx)
	}
	sfxFirst := sfx["items"].([]any)[0].(map[string]any)
	if sfxFirst["kind"] != "sound-effect" || !strings.HasPrefix(sfxFirst["url"].(string), "https://cdn.recut.video/") {
		t.Fatalf("sfx url should be absolute CDN: %#v", sfxFirst)
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

func stringOf(v any) string {
	s, _ := v.(string)
	return s
}

// TestEditorManualCoverFlow 覆盖封面选择模式闭环：auto → frame（用户选帧）→ asset（素材选图）
// → auto 恢复；手动模式下 cover.update 自动首帧同步被跳过。
func TestEditorManualCoverFlow(t *testing.T) {
	_, store, _, project := setupEditorTestApp(t)
	media := NewMediaService(store)
	host := NewAppHost(store.catalog, store, media)

	pngB64 := base64.StdEncoding.EncodeToString([]byte("frame-png"))

	// 初始 auto 模式。
	got := invokeAPI(t, host, project, "cover.get", map[string]any{})
	if mode := stringOf(got["mode"]); mode != "auto" {
		t.Fatalf("initial cover mode = %q, want auto", mode)
	}

	// 手动选帧：切到 frame 模式并登记 file 封面。
	frame := invokeAPI(t, host, project, "cover.set-frame", map[string]any{"fileBase64": pngB64, "mimeType": "image/png", "frameSec": 3.5})
	if mode := stringOf(frame["mode"]); mode != "frame" {
		t.Fatalf("cover.set-frame mode = %q, want frame", mode)
	}
	if sec := numOf(frame["frameSec"]); sec != 3.5 {
		t.Fatalf("cover.set-frame frameSec = %v, want 3.5", sec)
	}
	if cover, ok := frame["cover"].(map[string]any); !ok || stringOf(cover["source"]) != "file" {
		t.Fatalf("cover.set-frame cover = %#v, want file cover", frame["cover"])
	}

	// 手动模式下自动首帧同步被跳过。
	skip := invokeAPI(t, host, project, "cover.update", map[string]any{"fileBase64": pngB64})
	if ok := boolOf(skip["skipped"]); !ok {
		t.Fatalf("cover.update should be skipped in manual mode, got %#v", skip)
	}

	// 从素材库选图片：切到 asset 模式。
	img, err := media.ImportMedia("cover.png", "image/png", []byte("img"))
	if err != nil {
		t.Fatal(err)
	}
	asset := invokeAPI(t, host, project, "cover.set-asset", map[string]any{"assetId": img.ID})
	if mode := stringOf(asset["mode"]); mode != "asset" {
		t.Fatalf("cover.set-asset mode = %q, want asset", mode)
	}
	if cover, ok := asset["cover"].(map[string]any); !ok || stringOf(cover["assetId"]) != img.ID || stringOf(cover["kind"]) != "image" {
		t.Fatalf("cover.set-asset cover = %#v, want image asset cover", asset["cover"])
	}

	// 恢复自动：mode 回到 auto，cover.update 恢复生效。
	auto := invokeAPI(t, host, project, "cover.set-auto", map[string]any{})
	if mode := stringOf(auto["mode"]); mode != "auto" {
		t.Fatalf("cover.set-auto mode = %q, want auto", mode)
	}
	restored := invokeAPI(t, host, project, "cover.update", map[string]any{"fileBase64": pngB64})
	if skipped := boolOf(restored["skipped"]); skipped {
		t.Fatalf("cover.update should apply again after set-auto, got %#v", restored)
	}
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
	for _, must := range []string{"timeline.read", "element.get", "timeline.validate", "timeline.command", "timeline.placeComponents", "history.undo", "project.lock", "component.create", "component.revise", "component.list"} {
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
