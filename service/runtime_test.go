/*
 * [INPUT]: 依赖 AppHost、临时 manifest 和 JavaScript background
 * [OUTPUT]: 验证 JS App 的 capability 边界，以及 Vox Keyframes 必须保存图片快照
 * [POS]: service 的 capability runtime 回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppHostInvokesManifestDeclaredJavaScriptAPI(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(filepath.Join(appDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite","files","artifacts.publish"],"operations":[{"name":"note.create","description":"Create a note.","surfaces":["api","mcp"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("note.create", function(input, ctx) { ctx.sqlite.execute("create table if not exists notes (value text)"); ctx.sqlite.execute("insert into notes values (?)", [input.value]); ctx.files.writeText("note.txt", input.value); return ctx.artifacts.publish({type:"example.note@1", value:{value:input.value}}); });`)
	writeTestFile(t, filepath.Join(appDir, "ui", "index.html"), "ok")
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewAppHost(apps, store).InvokeAPI(project.ID, "example.app", "note.create", map[string]any{"value": "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if result.(Artifact).Type != "example.note@1" {
		t.Fatalf("result = %#v", result)
	}
	mcpResult, err := NewAppHost(apps, store).InvokeMCP(project.ID, "example.app", "note.create", map[string]any{"value": "from agent"})
	if err != nil || mcpResult.(Artifact).Type != "example.note@1" {
		t.Fatalf("mcp result = %#v, err = %v", mcpResult, err)
	}
	artifacts, err := store.ListArtifacts(project.ID)
	if err != nil || len(artifacts) != 2 {
		t.Fatalf("artifacts = %#v, err = %v", artifacts, err)
	}
	if _, err := os.Stat(filepath.Join(store.projectDir(project.ID), "apps", "example.app", "files", "note.txt")); err != nil {
		t.Fatal(err)
	}
}

func TestVoxBrollManifestOperationsRunOnDeclaredSurfaces(t *testing.T) {
	apps, err := LoadCatalog(filepath.Join("..", "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(t.TempDir(), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Vox operation test", AppID: "recut.vox-broll"})
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	appID := "recut.vox-broll"

	if _, err := host.InvokeAPI(project.ID, appID, "brief.create", map[string]any{"topic": "测试统一 operation"}); err != nil {
		t.Fatalf("brief.create API: %v", err)
	}
	if _, err := host.InvokeMCP(project.ID, appID, "brief.create", map[string]any{"topic": "测试统一 operation"}); err != nil {
		t.Fatalf("brief.create MCP: %v", err)
	}
	for _, call := range []struct {
		surface string
		name    string
		input   map[string]any
	}{
		{"api", "brief.latest", map[string]any{}},
		{"api", "workflow.context", map[string]any{}},
		{"mcp", "workflow.context", map[string]any{}},
		{"api", "resource.prepare", map[string]any{"kind": "beats"}},
	} {
		var err error
		if call.surface == "api" {
			_, err = host.InvokeAPI(project.ID, appID, call.name, call.input)
		} else {
			_, err = host.InvokeMCP(project.ID, appID, call.name, call.input)
		}
		if err != nil {
			t.Fatalf("%s %s: %v", call.name, call.surface, err)
		}
	}

	beats := func(title string) map[string]any {
		return map[string]any{"kind": "beats", "title": title, "content": map[string]any{"hook": "反常识", "narrative": "因果", "beats": []any{map[string]any{"id": "beat-1", "title": "开场", "narration": "新信息", "visual": "数据卡", "purpose": "建立冲突", "durationSec": 3}}}}
	}
	first, err := host.InvokeMCP(project.ID, appID, "resource.create", beats("第一份节拍"))
	if err != nil {
		t.Fatalf("resource.create MCP: %v", err)
	}
	firstID := first.(Artifact).Value.(map[string]any)["id"].(string)
	second, err := host.InvokeMCP(project.ID, appID, "resource.create", beats("第二份节拍"))
	if err != nil {
		t.Fatalf("second resource.create MCP: %v", err)
	}
	secondID := second.(Artifact).Value.(map[string]any)["id"].(string)
	keyframe := func(image any) map[string]any {
		content := map[string]any{"keyframes": []any{map[string]any{"beatId": "beat-1", "title": "开场画面", "composition": "左侧人物，右侧数据卡", "headline": "三秒钩子", "layers": []any{"人物", "数据卡"}}}}
		if image != nil {
			content["keyframes"].([]any)[0].(map[string]any)["image"] = image
		}
		return map[string]any{"kind": "keyframes", "title": "关键画面", "content": content, "dependencies": []any{firstID}}
	}
	if _, err := host.InvokeMCP(project.ID, appID, "resource.create", keyframe(nil)); err == nil {
		t.Fatal("text-only keyframes must be rejected")
	}
	image := map[string]any{"assetId": "generated-image", "text": "Vox 拼贴画面", "imageAssetIds": []any{"look-image"}, "audioAssetIds": []any{}, "sourceResourceIds": []any{"beat-1", firstID}}
	createdKeyframes, err := host.InvokeMCP(project.ID, appID, "resource.create", keyframe(image))
	if err != nil {
		t.Fatalf("keyframes with generated image: %v", err)
	}
	keyframeID := createdKeyframes.(Artifact).Value.(map[string]any)["id"].(string)
	if _, err := host.InvokeAPI(project.ID, appID, "resource.list", map[string]any{}); err != nil {
		t.Fatalf("resource.list API: %v", err)
	}
	if _, err := host.InvokeAPI(project.ID, appID, "resource.retire", map[string]any{"id": keyframeID}); err != nil {
		t.Fatalf("resource.retire keyframes: %v", err)
	}
	if _, err := host.InvokeAPI(project.ID, appID, "resource.retire", map[string]any{"id": firstID}); err != nil {
		t.Fatalf("resource.retire API: %v", err)
	}
	if _, err := host.InvokeMCP(project.ID, appID, "resource.retire", map[string]any{"id": secondID}); err != nil {
		t.Fatalf("resource.retire MCP: %v", err)
	}
	if _, err := host.InvokeAPI(project.ID, appID, "resource.delete", map[string]any{"id": firstID}); err != nil {
		t.Fatalf("resource.delete API: %v", err)
	}
	if _, err := host.InvokeMCP(project.ID, appID, "resource.delete", map[string]any{"id": secondID}); err != nil {
		t.Fatalf("resource.delete MCP: %v", err)
	}
}

func TestVoxWorkflowDeclaresPlatformMediaExecution(t *testing.T) {
	apps, err := LoadCatalog(filepath.Join("..", "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(t.TempDir(), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Vox media route", AppID: "recut.vox-broll"})
	if err != nil {
		t.Fatal(err)
	}
	workflow, err := NewAppHost(apps, store).InvokeAPI(project.ID, "recut.vox-broll", "workflow.context", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	execution := workflow.(map[string]any)["mediaExecution"].(map[string]any)
	scenes := execution["scenes"].(map[string]any)
	if scenes["kind"] != "platform-media-generation" || scenes["generate"] != "recut.video.generate_async" || scenes["complete"] != "recut.media.get_job -> assetId -> resource.create" {
		t.Fatalf("scene media route = %#v", scenes)
	}
}
