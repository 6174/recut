package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// E2E：受限子 Agent 创建链的完整数据管线——
// authorize（background 声明上下文+工具范围）→ component.commit（受限子 Agent 唯一工具）→
// finalize（轻量验证进素材库）→ timeline.placeComponents（落轨）→ component.resolve（返回可渲染 bundle）。
// 不启动真实模型：用受限会话的 component.commit 工具模拟子 Agent 的唯一交付。
func TestComponentCreatePlaceResolveE2E(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	bridge := NewAgentBridge(store)
	media := NewMediaService(store)
	target := Target{ProjectID: project.ID, AppID: "recut.editor"}

	// 0. 初始化 background 项目文档（placeComponents 需要 project + version）。
	created := invoke(t, host, project, "project.create", map[string]any{"name": "Component E2E"})
	baseVersion := int(created["version"].(float64))

	// 1. authorize：background 动态声明受限子 Agent 请求（上下文 + 工具范围 + 聚焦上下文）。
	auth := invokeAPI(t, host, project, "component.create", map[string]any{
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
	if len(tools) != 1 || tools[0] != "recut.editor.component.commit" {
		t.Fatalf("authorize allowedTools = %#v", tools)
	}
	prompt, _ := sub["prompt"].(string)
	for _, must := range []string{"Recut Fullscreen E2E", "component.commit", "Authoring contract"} {
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

	// 2. 受限子 Agent 的唯一工具：component.commit 提交源码 → draft + 记录工具调用。
	//    聚焦上下文（focused.mode）由 App 声明、平台透传、component.commit 消费。
	child, _, err := bridge.CreateSession(SessionContext{
		TaskID:       "e2e-subagent",
		Runtime:      "opencode",
		Model:        "test-model",
		AllowedTools: []string{"recut.editor.component.commit"},
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
		Params: json.RawMessage(`{"name":"recut.editor.component.commit","arguments":` + string(argsJSON) + `}`),
	})
	if err != nil {
		t.Fatalf("component.commit: %v", err)
	}
	committed, _ := commitRaw.(map[string]any)["structuredContent"].(map[string]any)
	if committed == nil || committed["status"] != "draft" || committed["versionId"] == "" {
		t.Fatalf("commit = %#v", committed)
	}
	calls, ok := bridge.AgentToolCalls(child.ID)
	if !ok || len(calls) != 1 || calls[0].Name != "recut.editor.component.commit" || calls[0].Result["versionId"] != committed["versionId"] {
		t.Fatalf("recorded tool calls = %#v, %v", calls, ok)
	}

	// 3. finalize：平台回传 subAgentTools，background 轻量验证 → verified + 素材库 media 事件。
	final := invokeAPI(t, host, project, "component.create", map[string]any{
		"subAgentTools": []any{map[string]any{"name": "recut.editor.component.commit", "result": calls[0].Result}},
	})
	components, _ := final["components"].([]any)
	if len(components) != 1 {
		t.Fatalf("finalize components = %#v", final)
	}
	comp, _ := components[0].(map[string]any)
	if comp["status"] != "verified" || comp["componentId"] == "" || comp["versionId"] != committed["versionId"] {
		t.Fatalf("finalize comp = %#v", comp)
	}
	// focused.mode=fullscreen 应经 component.commit 注入并保留在组件上。
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

	// 5. 可渲染 bundle：component.resolve 返回 verified head 的编译产物（UI harness 据此渲染）。
	resolved := invokeAPI(t, host, project, "component.resolve", map[string]any{"ids": []any{comp["componentId"]}})
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
