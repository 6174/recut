/*
 * [INPUT]: 依赖 AppHost、临时 manifest 和 JavaScript background
 * [OUTPUT]: 验证 JS App 的 capability 边界，以及 Vox Keyframes 必须保存图片快照、Scenes 必须走平台异步视频路径
 * [POS]: service 的 capability runtime 回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"github.com/dop251/goja"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestComposeMediaInputKeepsCamelCaseTimelineFields(t *testing.T) {
	runtime := goja.New()
	input, err := composeMediaInput(runtime, runtime.ToValue(map[string]any{
		"videoTimeline": []any{map[string]any{"assetId": "video-1", "startSec": 0, "durationSec": 5}},
		"audioTimeline": []any{map[string]any{"assetId": "audio-1", "startSec": 0, "durationSec": 5}},
		"settings":      map[string]any{"width": 1920, "height": 1080, "fps": 30, "quality": "balanced"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(input.VideoTimeline) != 1 || input.VideoTimeline[0].AssetID != "video-1" || len(input.AudioTimeline) != 1 || input.Settings.Width != 1920 {
		t.Fatalf("camelCase composition input was lost: %#v", input)
	}
}

func TestPythonStatusUsesCamelCasePropertiesForJavaScriptApps(t *testing.T) {
	root := t.TempDir()
	app := App{
		Manifest: Manifest{ID: "example.python", Runtime: AppRuntime{Python: &PythonRuntime{Venv: "example", Version: "3.11", Requirements: "requirements.lock"}}},
		Root:     root,
	}
	writeTestFile(t, filepath.Join(root, "requirements.lock"), "example-package\n")
	store := NewStore(filepath.Join(root, "data"), nil)
	manager := NewPythonRuntimeManager(store, NewShellJobManager(store))
	environment, err := manager.Environment(app)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(environment.Python), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, environment.Python, "")

	runtime := goja.New()
	status := pythonStatus(runtime, manager, app)(goja.FunctionCall{}).ToObject(runtime)
	if !status.Get("ready").ToBoolean() {
		t.Fatalf("JavaScript ready property = %v", status.Get("ready"))
	}
	if status.Get("Ready") != nil {
		t.Fatalf("Go field name leaked into JavaScript capability: %v", status.Get("Ready"))
	}
}

func TestAppHostInvokesManifestDeclaredJavaScriptAPI(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(filepath.Join(appDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite","files","artifacts.publish"],"operations":[{"name":"note.create","description":"Create a note.","surfaces":["api","mcp"],"inputSchema":{"type":"object"}}]}`)
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
	result, err := NewAppHost(apps, store).InvokeAPI(Target{ProjectID: project.ID, AppID: "example.app"}, "example.app", "note.create", map[string]any{"value": "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if result.(Artifact).Type != "example.note@1" {
		t.Fatalf("result = %#v", result)
	}
	mcpResult, err := NewAppHost(apps, store).InvokeMCP(Target{ProjectID: project.ID, AppID: "example.app"}, "example.app", "note.create", map[string]any{"value": "from agent"})
	if err != nil || mcpResult.(Artifact).Type != "example.note@1" {
		t.Fatalf("mcp result = %#v, err = %v", mcpResult, err)
	}
	artifacts, err := store.ListArtifacts(project.ID)
	if err != nil || len(artifacts) != 2 {
		t.Fatalf("artifacts = %#v, err = %v", artifacts, err)
	}
	if _, err := os.Stat(filepath.Join(store.projectDir(project.ID), "files", "note.txt")); err != nil {
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

	if _, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "brief.create", map[string]any{"topic": "测试统一 operation"}); err != nil {
		t.Fatalf("brief.create API: %v", err)
	}
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "brief.create", map[string]any{"topic": "测试统一 operation"}); err != nil {
		t.Fatalf("brief.create MCP: %v", err)
	}
	briefResources, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.list", map[string]any{})
	if err != nil {
		t.Fatalf("resource.list after brief.create: %v", err)
	}
	briefs := briefResources.([]any)
	if len(briefs) != 2 || briefs[0].(map[string]any)["kind"] != "brief" || briefs[1].(map[string]any)["kind"] != "brief" {
		t.Fatalf("brief.create must materialize visible brief resources: %#v", briefResources)
	}
	briefStore, err := store.AppStateDatabase(appID)
	if err != nil {
		t.Fatalf("brief app database: %v", err)
	}
	if _, err := briefStore.Exec("delete from resources where kind = ?", "brief"); err != nil {
		t.Fatalf("remove materialized brief resources: %v", err)
	}
	legacyResources, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.list", map[string]any{})
	if err != nil {
		t.Fatalf("resource.list for legacy brief: %v", err)
	}
	if len(legacyResources.([]any)) != 1 || legacyResources.([]any)[0].(map[string]any)["kind"] != "brief" {
		t.Fatalf("resource.list must expose a legacy brief: %#v", legacyResources)
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
			_, err = host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, call.name, call.input)
		} else {
			_, err = host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, call.name, call.input)
		}
		if err != nil {
			t.Fatalf("%s %s: %v", call.name, call.surface, err)
		}
	}

	beats := func(title string) map[string]any {
		return map[string]any{"kind": "beats", "title": title, "content": map[string]any{"hook": "反常识", "narrative": "因果", "beats": []any{map[string]any{"id": "beat-1", "title": "开场", "narration": "新信息", "visual": "数据卡", "purpose": "建立冲突", "durationSec": 3}}}}
	}
	first, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", beats("第一份节拍"))
	if err != nil {
		t.Fatalf("resource.create MCP: %v", err)
	}
	firstID := first.(Artifact).Value.(map[string]any)["id"].(string)
	second, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", beats("第二份节拍"))
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
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", keyframe(nil)); err == nil {
		t.Fatal("text-only keyframes must be rejected")
	}
	image := map[string]any{"assetId": "generated-image", "text": "Vox 拼贴画面", "imageAssetIds": []any{"look-image"}, "audioAssetIds": []any{}, "sourceResourceIds": []any{"beat-1", firstID}}
	createdKeyframes, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", keyframe(image))
	if err != nil {
		t.Fatalf("keyframes with generated image: %v", err)
	}
	keyframeID := createdKeyframes.(Artifact).Value.(map[string]any)["id"].(string)
	if _, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.list", map[string]any{}); err != nil {
		t.Fatalf("resource.list API: %v", err)
	}
	if _, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.retire", map[string]any{"id": keyframeID}); err != nil {
		t.Fatalf("resource.retire keyframes: %v", err)
	}
	if _, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.retire", map[string]any{"id": firstID}); err != nil {
		t.Fatalf("resource.retire API: %v", err)
	}
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.retire", map[string]any{"id": secondID}); err != nil {
		t.Fatalf("resource.retire MCP: %v", err)
	}
	if _, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.delete", map[string]any{"id": firstID}); err != nil {
		t.Fatalf("resource.delete API: %v", err)
	}
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.delete", map[string]any{"id": secondID}); err != nil {
		t.Fatalf("resource.delete MCP: %v", err)
	}
}

func TestCoverStudioSavePromotesAssetToCurrentPreview(t *testing.T) {
	apps, err := LoadCatalog(filepath.Join("..", "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(t.TempDir(), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	appID := "recut.cover-studio"
	target := Target{AppID: appID}
	if _, err := host.InvokeAPI(target, appID, "cover.configure", map[string]any{"channel": "小红书", "width": 1242, "height": 1660, "templateId": "editorial", "referenceAssetIds": []any{}, "brief": "右侧留白"}); err != nil {
		t.Fatalf("cover.configure: %v", err)
	}
	if _, err := host.InvokeAPI(target, appID, "cover.save", map[string]any{"assetId": "cover-asset", "prompt": "真实封面", "channel": "小红书", "width": 1242, "height": 1660, "templateId": "editorial", "referenceAssetIds": []any{}}); err != nil {
		t.Fatalf("cover.save API: %v", err)
	}
	context, err := host.InvokeMCP(target, appID, "cover.context", map[string]any{})
	if err != nil {
		t.Fatalf("cover.context: %v", err)
	}
	if context.(map[string]any)["previewAssetId"] != "cover-asset" {
		t.Fatalf("current preview = %#v", context)
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
	workflow, err := NewAppHost(apps, store).InvokeAPI(Target{ProjectID: project.ID, AppID: "recut.vox-broll"}, "recut.vox-broll", "workflow.context", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	execution := workflow.(map[string]any)["mediaExecution"].(map[string]any)
	scenes := execution["scenes"].(map[string]any)
	if scenes["kind"] != "platform-media-generation" || scenes["generate"] != "recut.video.generate_async" || scenes["complete"] != "accepted -> queued assetIds[0] -> resource.create; Daemon updates Asset status; for Seedance use output.generateAudio=true unless the user explicitly requests silent video; video text must quote audio.text verbatim and forbid extra speech" {
		t.Fatalf("scene media route = %#v", scenes)
	}
	prepared, err := NewAppHost(apps, store).InvokeAPI(Target{ProjectID: project.ID, AppID: "recut.vox-broll"}, "recut.vox-broll", "resource.prepare", map[string]any{"kind": "scenes"})
	if err != nil {
		t.Fatalf("resource.prepare scenes: %v", err)
	}
	prompt, _ := prepared.(map[string]any)["prompt"].(string)
	for _, required := range []string{
		"recut.video.generate_async",
		"keyframe.assetId",
		"audio.assetId",
		"audio.text",
		"唯一人声",
		"assetIds[0]",
		"resource.create",
		"不能等待轮询完成",
		"禁止使用 HyperFrames",
	} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("scene preparation is missing %q: %s", required, prompt)
		}
	}
}
