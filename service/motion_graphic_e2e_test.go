package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// E2E：Motion Graphic 创建链的完整数据管线——
// authorize（background 声明上下文+工具范围）→ motion-graphic.commit（受限子 Agent 唯一工具）→
// finalize（轻量验证进素材库）→ timeline.placeComponents（落轨）→ motion-graphic.resolve（返回可渲染 bundle）。
// 不启动真实模型：用受限会话的 motion-graphic.commit 工具模拟子 Agent 的唯一交付。
func TestMotionGraphicCreatePlaceResolveE2E(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	target := Target{ProjectID: project.ID, AppID: "recut.editor"}

	// 0. 初始化 background 项目文档（placeComponents 需要 project + version）。
	created := invoke(t, host, project, "project.create", map[string]any{"name": "Component E2E"})
	baseVersion := int(created["version"].(float64))

	// 1. authorize：background 动态声明受限子 Agent 请求（上下文 + 工具范围 + 聚焦上下文）。
	auth := invokeAPI(t, host, project, "motion-graphic.create", map[string]any{
		"items": []any{map[string]any{
			"nameHint": "Recut Fullscreen E2E",
			"brief":    "全屏文字动画：铺满画布，主标题'你好，Recut'，优雅淡入。",
			"role":     "fullscreen-text",
			"mode":     "fullscreen",
		}},
	})
	sub, ok := auth["subAgent"].(map[string]any)
	if !ok {
		t.Fatalf("authorize 未返回 subAgent: %#v", auth)
	}
	tools, _ := sub["allowedTools"].([]any)
	if len(tools) != 1 || tools[0] != "recut.editor.motion-graphic.commit" {
		t.Fatalf("authorize allowedTools = %#v", tools)
	}
	prompt, _ := sub["prompt"].(string)
	for _, must := range []string{"Recut Fullscreen E2E", "motion-graphic.commit", "Authoring contract"} {
		if !strings.Contains(prompt, must) {
			t.Fatalf("authorize prompt 缺 %q:\n%s", must, prompt)
		}
	}
	// fullscreen：平台注入画布宽高上下文，且聚焦上下文带 mode。
	if !strings.Contains(prompt, "FULLSCREEN") || !strings.Contains(prompt, "1920") {
		t.Fatalf("fullscreen 未注入画布上下文:\n%s", prompt)
	}
	focused, _ := sub["focused"].(map[string]any)
	if focused == nil || focused["mode"] != "fullscreen" {
		t.Fatalf("authorize focused = %#v", focused)
	}

	// 2. 受限子 Agent 的唯一工具：motion-graphic.commit 提交源码 → draft + 记录工具调用。
	//    聚焦上下文（focused.mode）由 App 声明、平台透传、motion-graphic.commit 消费。
	child, _, err := bridge.CreateSession(SessionContext{
		TaskID:       "e2e-subagent",
		Runtime:      "opencode",
		Model:        "test-model",
		AllowedTools: []string{"recut.editor.motion-graphic.commit"},
		Target:       target,
		Focused:      map[string]any{"mode": "fullscreen"},
	})
	if err != nil {
		t.Fatal(err)
	}
	source := "import { str } from \"@recut/runtime\";\n" +
		"import type { ComponentRenderContext } from \"@recut/runtime\";\n" +
		"export default {\n" +
		"  surface: \"html\",\n" +
		"  name: \"Recut E2E Chip\",\n" +
		"  keywords: [\"chip\"],\n" +
		"  inputs: [{ key: \"title\", type: \"text\", default: \"你好，Recut\", label: \"标题\" }],\n" +
		"  getBaseSize: () => ({ width: 400, height: 120 }),\n" +
		"  render(ctx: ComponentRenderContext) {\n" +
		"    const title = str(ctx.params.title, \"你好，Recut\");\n" +
		"    return `<div style=\"width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0ea5e9;color:#fff;font-size:32px\">${title}</div>`;\n" +
		"  },\n" +
		"};"
	argsJSON, _ := json.Marshal(map[string]any{
		"name": "Recut E2E Chip", "surface": "html", "keywords": []any{"chip"},
		"inputs": []any{map[string]any{"key": "title", "type": "text", "default": "你好，Recut", "label": "标题"}},
		"source": source,
	})
	commitRaw, err := handleMCP(bridge, host, media, child, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.editor.motion-graphic.commit","arguments":` + string(argsJSON) + `}`),
	})
	if err != nil {
		t.Fatalf("motion-graphic.commit: %v", err)
	}
	committed, _ := commitRaw.(map[string]any)["structuredContent"].(map[string]any)
	if committed == nil || committed["status"] != "draft" || committed["versionId"] == "" {
		t.Fatalf("commit = %#v", committed)
	}
	calls, ok := bridge.AgentToolCalls(child.ID)
	if !ok || len(calls) != 1 || calls[0].Name != "recut.editor.motion-graphic.commit" || calls[0].Result["versionId"] != committed["versionId"] {
		t.Fatalf("recorded tool calls = %#v, %v", calls, ok)
	}

	// 3. finalize：平台回传 subAgentTools，background 轻量验证 → verified + 素材库 media 事件。
	final := invokeAPI(t, host, project, "motion-graphic.create", map[string]any{
		"subAgentTools": []any{map[string]any{"name": "recut.editor.motion-graphic.commit", "result": calls[0].Result}},
	})
	components, _ := final["components"].([]any)
	if len(components) != 1 {
		t.Fatalf("finalize components = %#v", final)
	}
	comp, _ := components[0].(map[string]any)
	if comp["status"] != "verified" || comp["componentId"] == "" || comp["versionId"] != committed["versionId"] {
		t.Fatalf("finalize comp = %#v", comp)
	}
	// focused.mode=fullscreen 应经 motion-graphic.commit 注入并保留在组件上。
	if comp["mode"] != "fullscreen" {
		t.Fatalf("finalize comp mode = %#v", comp)
	}
	if lib, _ := final["library"].(map[string]any); lib == nil || lib["tab"] != "media" {
		t.Fatalf("finalize library = %#v", final["library"])
	}

	// 4. 落轨：timeline.placeComponents（原子放置 verified 组件）。
	placed := invoke(t, host, project, "timeline.placeComponents", map[string]any{
		"baseVersion": baseVersion,
		"items":       []any{map[string]any{"componentId": comp["componentId"], "startSec": 0, "durationSec": 8}},
	})
	if placed["ok"] != true {
		t.Fatalf("placeComponents = %#v", placed)
	}
	refs, _ := placed["result"].(map[string]any)["refs"].([]any)
	if len(refs) != 1 {
		t.Fatalf("placeComponents refs = %#v", placed)
	}

	// 5. 可渲染 bundle：motion-graphic.resolve 返回 verified head 的编译产物（UI harness 据此渲染）。
	resolved := invokeAPI(t, host, project, "motion-graphic.resolve", map[string]any{"ids": []any{comp["componentId"]}})
	resolvedComps, _ := resolved["components"].([]any)
	if len(resolvedComps) != 1 {
		t.Fatalf("resolve = %#v", resolved)
	}
	rc, _ := resolvedComps[0].(map[string]any)
	if rc["status"] != "verified" || rc["versionId"] != committed["versionId"] {
		t.Fatalf("resolve comp = %#v", rc)
	}
	bundle, _ := rc["bundle"].(string)
	if !strings.Contains(bundle, "@recut/runtime") || !strings.Contains(bundle, "Recut E2E Chip") {
		t.Fatalf("resolve bundle 不完整: %d bytes", len(bundle))
	}
	t.Logf("E2E 通过：%s verified → 落轨 ref=%#v → bundle %d bytes", comp["componentId"], refs[0], len(bundle))
}

// mgTestSource 生成一个可构建的最小 html 组件源码（label 用于断言内容随版本更新）。
func mgTestSource(label string) string {
	return "import { str } from \"@recut/runtime\";\n" +
		"import type { ComponentRenderContext } from \"@recut/runtime\";\n" +
		"export default {\n" +
		"  surface: \"html\",\n" +
		"  name: \"" + label + "\",\n" +
		"  inputs: [{ key: \"title\", type: \"text\", default: \"" + label + "\", label: \"标题\" }],\n" +
		"  getBaseSize: () => ({ width: 400, height: 120 }),\n" +
		"  render(ctx: ComponentRenderContext) {\n" +
		"    return `<div style=\"width:100%;height:100%\">${str(ctx.params.title, \"" + label + "\")}</div>`;\n" +
		"  },\n" +
		"};"
}

func defineAndVerifyMG(t *testing.T, host *AppHost, project Project, label, source string) (string, string) {
	t.Helper()
	defined := invokeAPI(t, host, project, "motion-graphic.define", map[string]any{"name": label, "surface": "html", "source": source})
	if defined["status"] != "draft" {
		t.Fatalf("motion-graphic.define = %#v", defined)
	}
	id, _ := defined["componentId"].(string)
	versionID, _ := defined["versionId"].(string)
	if id == "" || versionID == "" {
		t.Fatalf("define missing ids = %#v", defined)
	}
	verified := invokeAPI(t, host, project, "motion-graphic.verify", map[string]any{"versionId": versionID, "report": map[string]any{"ok": true}})
	if verified["status"] != "verified" {
		t.Fatalf("motion-graphic.verify = %#v", verified)
	}
	return id, versionID
}

// E2E：单条 current code（无版本历史）——update 原位覆盖并递增 versionId；
// 构建失败绝不覆盖 last-good。
func TestMotionGraphicUpdateOverwritesAndProtectsLastGood(t *testing.T) {
	_, _, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{"name": "MG Update"})
	id, v1 := defineAndVerifyMG(t, host, project, "MG v1", mgTestSource("MG v1"))

	updated := invoke(t, host, project, "motion-graphic.update", map[string]any{"componentId": id, "source": mgTestSource("MG v2")})
	if updated["ok"] != true || updated["status"] != "verified" {
		t.Fatalf("motion-graphic.update = %#v", updated)
	}
	v2, _ := updated["versionId"].(string)
	if want := id + "@2"; v2 != want {
		t.Fatalf("versionId = %q want %q (v1=%q)", v2, want, v1)
	}
	src := invoke(t, host, project, "motion-graphic.source", map[string]any{"componentId": id})
	if !strings.Contains(src["source"].(string), "MG v2") {
		t.Fatalf("current code not overwritten: %#v", src)
	}

	// 失败构建：确定性扫描拒绝 Date.now，且不覆盖 last-good（source/version/status 不变）。
	failed := invoke(t, host, project, "motion-graphic.update", map[string]any{
		"componentId": id,
		"source":          mgTestSource("bad") + "\nconst tick = Date.now();",
	})
	if failed["ok"] != false || failed["status"] != "failed" || failed["buildError"] == nil {
		t.Fatalf("failed update should be a business failure envelope: %#v", failed)
	}
	after := invoke(t, host, project, "motion-graphic.source", map[string]any{"componentId": id})
	if !strings.Contains(after["source"].(string), "MG v2") {
		t.Fatalf("last-good source lost after failed build: %#v", after)
	}
	listed := invoke(t, host, project, "motion-graphic.list", map[string]any{})
	for _, value := range listed["components"].([]any) {
		m := value.(map[string]any)
		if m["componentId"] == id {
			if m["status"] != "verified" || m["versionId"] != v2 || m["version"] != float64(2) {
				t.Fatalf("status/version drifted after failed build: %#v", m)
			}
		}
	}
}

// E2E：MG 是全局素材——项目 A 创建验证后，项目 B 无需本地引用即可发现、解析并落轨。
func TestMotionGraphicGlobalLibraryAcrossProjects(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{"name": "MG A"})
	id, versionID := defineAndVerifyMG(t, host, project, "MG Global", mgTestSource("MG Global"))

	other, err := store.Create(CreateInput{Name: "MG B", AppID: "recut.editor"})
	if err != nil {
		t.Fatal(err)
	}
	created := invoke(t, host, other, "project.create", map[string]any{"name": "MG B"})
	baseVersion := int(created["version"].(float64))

	listed := invoke(t, host, other, "motion-graphic.list", map[string]any{})
	found := false
	for _, value := range listed["components"].([]any) {
		m := value.(map[string]any)
		if m["componentId"] == id {
			found = true
			if m["status"] != "verified" || m["versionId"] != versionID {
				t.Fatalf("global list view = %#v", m)
			}
		}
	}
	if !found {
		t.Fatalf("MG created in A not visible from B: %#v", listed)
	}

	resolved := invokeAPI(t, host, other, "motion-graphic.resolve", map[string]any{"ids": []any{id}})
	if len(resolved["components"].([]any)) != 1 {
		t.Fatalf("resolve in B = %#v", resolved)
	}

	placed := invoke(t, host, other, "timeline.placeComponents", map[string]any{
		"baseVersion": baseVersion,
		"items":       []any{map[string]any{"componentId": id, "startSec": 0, "durationSec": 5}},
	})
	if placed["ok"] != true {
		t.Fatalf("place global MG in B = %#v", placed)
	}
	read := invoke(t, host, other, "timeline.read", map[string]any{})
	clips, _ := read["clips"].([]any)
	placedOK := false
	for _, value := range clips {
		m := value.(map[string]any)
		if m["type"] == "component" && m["componentId"] == id {
			placedOK = true
		}
	}
	if !placedOK {
		t.Fatalf("timeline.read missing component clip: %#v", read)
	}
}

// E2E：editor 私有组件表一次性迁移进全局 mg_materials，并登记项目引用索引。
func TestMotionGraphicLegacyMigration(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{"name": "MG Legacy"})
	db, err := store.AppStateDatabase("recut.editor")
	if err != nil {
		t.Fatal(err)
	}
	now := nowIso()
	if _, err := db.Exec("insert into editor_components (component_id, project_id, name, surface, keywords_json, head_version_id, mode, created_at, updated_at) values (?, ?, ?, 'html', '[]', ?, 'local', ?, ?)",
		"legacy-1", project.ID, "Legacy MG", "legacy-1@1", now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into editor_component_versions (version_id, component_id, version, source, bundle_hash, bundle, inputs_json, status, test_report_json, created_at, verified_at) values (?, ?, 1, ?, 'h', 'bundle', '[]', 'verified', null, ?, ?)",
		"legacy-1@1", "legacy-1", "export default { surface: \"html\", render() { return \"x\"; } };", now, now); err != nil {
		t.Fatal(err)
	}

	listed := invoke(t, host, project, "motion-graphic.list", map[string]any{})
	found := false
	for _, value := range listed["components"].([]any) {
		m := value.(map[string]any)
		if m["componentId"] == "legacy-1" {
			found = true
			if m["status"] != "verified" || m["name"] != "Legacy MG" || m["versionId"] != "legacy-1@1" {
				t.Fatalf("migrated material = %#v", m)
			}
		}
	}
	if !found {
		t.Fatalf("legacy component not migrated: %#v", listed)
	}
	refs, err := queryMaps(db, "select count(*) as n from editor_assets where project_id = ? and type = 'component' and ref_id = ?", project.ID, "legacy-1")
	if err != nil || len(refs) == 0 || edNum(refs[0]["n"]) < 1 {
		t.Fatalf("migration did not register project reference: %#v (%v)", refs, err)
	}
}

// E2E：component 元素读取/回读不丢引用字段（componentId 保留，供属性面板/渲染器解析）。
func TestEditorComponentElementRoundTrip(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{"name": "MG Legacy Doc"})
	db, err := store.AppStateDatabase("recut.editor")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := queryMaps(db, "select project_json from editor_projects where project_id = ?", project.ID)
	if err != nil || len(rows) == 0 {
		t.Fatalf("project row missing: %v %#v", err, rows)
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(edStr(rows[0]["project_json"])), &doc); err != nil {
		t.Fatal(err)
	}
	scenes := edSlice(doc["scenes"])
	scene := edMap(scenes[0])
	tracks := edMap(scene["tracks"])
	main := edMap(tracks["main"])
	main["elements"] = append(edSlice(main["elements"]), map[string]any{
		"id": "el-legacy", "type": "component", "componentId": "legacy-mg",
		"startTime": float64(0), "duration": float64(120), "params": map[string]any{}, "keyframes": []any{},
	})
	serialized, _ := json.Marshal(doc)
	if _, err := db.Exec("update editor_projects set project_json = ? where project_id = ?", string(serialized), project.ID); err != nil {
		t.Fatal(err)
	}

	read := invoke(t, host, project, "timeline.read", map[string]any{})
	clips, _ := read["clips"].([]any)
	found := false
	for _, value := range clips {
		m := value.(map[string]any)
		if m["ref"] != nil && edStr(edMap(m["ref"])["elementId"]) == "el-legacy" {
			found = true
			if m["type"] != "component" || m["componentId"] != "legacy-mg" {
				t.Fatalf("component element lost componentId on read: %#v", m)
			}
		}
	}
	if !found {
		t.Fatalf("legacy element missing from timeline.read: %#v", read)
	}
}
