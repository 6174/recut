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
	writeTestFile(t, filepath.Join(environment.Path, "pyvenv.cfg"), "version = 3.11.12\n")

	runtime := goja.New()
	status := pythonStatus(runtime, manager, app)(goja.FunctionCall{}).ToObject(runtime)
	if !status.Get("ready").ToBoolean() {
		t.Fatalf("JavaScript ready property = %v", status.Get("ready"))
	}
	if status.Get("Ready") != nil {
		t.Fatalf("Go field name leaked into JavaScript capability: %v", status.Get("Ready"))
	}
}

func TestPythonEnvironmentRejectsVenvCreatedWithWrongVersion(t *testing.T) {
	root := t.TempDir()
	app := App{Manifest: Manifest{ID: "example.python", Runtime: AppRuntime{Python: &PythonRuntime{Venv: "example", Version: "3.11", Requirements: "requirements.lock"}}}, Root: root}
	writeTestFile(t, filepath.Join(root, "requirements.lock"), "example-package\n")
	manager := NewPythonRuntimeManager(NewStore(filepath.Join(root, "data"), nil), NewShellJobManager(NewStore(filepath.Join(root, "unused"), nil)))
	environment, err := manager.Environment(app)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(environment.Python), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, environment.Python, "")
	writeTestFile(t, filepath.Join(environment.Path, "pyvenv.cfg"), "version = 3.9.19\n")
	environment, err = manager.Environment(app)
	if err != nil {
		t.Fatal(err)
	}
	if environment.Ready || !strings.Contains(environment.Error, "different Python version") {
		t.Fatalf("environment = %#v", environment)
	}
}

func TestPythonRuntimeUsesManifestVersionForVenvCreation(t *testing.T) {
	command, err := runtimePythonCommand(PythonRuntime{Version: "3.11"})
	if err != nil || command != "python3.11" {
		t.Fatalf("command = %q, err = %v", command, err)
	}
	script := preparePythonScript()
	if !strings.Contains(script, "astral.sh/uv/install.sh") || !strings.Contains(script, "\"$uv\" python install \"$RECUT_PYTHON_VERSION\"") || !strings.Contains(script, "\"$RECUT_PYTHON_COMMAND\" -m venv") || !strings.Contains(script, "rm -rf \"$RECUT_VENV\"") {
		t.Fatalf("prepare script does not recreate mismatched environments: %s", script)
	}
}

func TestPythonRuntimeUsesPlatformDefaultsWhenAppOmitsVersionAndVenv(t *testing.T) {
	definition := PythonRuntime{}
	if runtimePythonVersion(definition) != "3.11" || runtimeVenvName(definition) != "platform" {
		t.Fatalf("defaults = version %q, venv %q", runtimePythonVersion(definition), runtimeVenvName(definition))
	}
	command, err := runtimePythonCommand(definition)
	if err != nil || command != "python3.11" {
		t.Fatalf("default command = %q, err = %v", command, err)
	}
}

func TestPythonRuntimeInstallsDeclaredFFmpegWithoutSystemPackageManager(t *testing.T) {
	script := preparePythonTools([]string{"ffmpeg"})
	if !strings.Contains(script, "imageio_ffmpeg.get_ffmpeg_exe()") || !strings.Contains(script, "shutil.copy2(source, target)") || !strings.Contains(script, "Scripts") {
		t.Fatalf("ffmpeg tool bootstrap = %s", script)
	}
}

func TestPythonEnvironmentPathPreservesLoginShellTools(t *testing.T) {
	path := prependPythonEnvironmentPath("/private/recut/env", "/opt/homebrew/bin:/usr/bin:/bin")
	if path != "/private/recut/env/bin:/opt/homebrew/bin:/usr/bin:/bin" {
		t.Fatalf("Python environment PATH = %q", path)
	}
}

func TestPythonRuntimeBootstrapIsPortablePython(t *testing.T) {
	command, args, err := pythonPrepareCommand(PythonRuntime{Requirements: "requirements.lock", Bootstrap: "bootstrap.py"})
	if err != nil || command != "sh" || len(args) != 3 || !strings.Contains(args[2], "\"$RECUT_PYTHON\" \"$RECUT_PYTHON_BOOTSTRAP\"") || !strings.Contains(args[2], "RECUT_PYTHON_REQUIREMENTS") {
		t.Fatalf("portable bootstrap command = %q %#v, err = %v", command, args, err)
	}
	windows := preparePythonPowerShell([]string{"ffmpeg"})
	for _, expected := range []string{"UV_INSTALL_DIR", "uv\\uv.exe", "python install", "Scripts", "RECUT_PYTHON_BOOTSTRAP", "RECUT_PYTHON_REQUIREMENTS"} {
		if !strings.Contains(windows, expected) {
			t.Fatalf("Windows bootstrap missing %q: %s", expected, windows)
		}
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

func TestProjectAppCanSetItsOwnImageOrVideoCover(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(filepath.Join(appDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"operations":[{"name":"cover.apply","description":"Set the project cover.","surfaces":["api"],"inputSchema":{"type":"object","required":["assetId"],"properties":{"assetId":{"type":"string"}}}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("cover.apply", function(input, ctx) { return ctx.project.setCover({assetId: input.assetId}); });`)
	writeTestFile(t, filepath.Join(appDir, "ui", "index.html"), "ok")
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Cover", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	asset, err := media.ImportMedia("cover.mp4", "video/mp4", []byte("video"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewAppHost(apps, store, media).InvokeAPI(Target{ProjectID: project.ID, AppID: "example.app"}, "example.app", "cover.apply", map[string]any{"assetId": asset.ID})
	if err != nil {
		t.Fatal(err)
	}
	updated := result.(Project)
	if updated.Cover == nil || updated.Cover.AssetID != asset.ID || updated.Cover.Kind != "video" {
		t.Fatalf("cover result = %#v", updated)
	}
	assets, err := media.ListAssets(project.ID)
	if err != nil || len(assets) != 1 || assets[0].ID != asset.ID {
		t.Fatalf("cover asset was not attached to project: %#v, %v", assets, err)
	}
}

func TestProjectAppsPromoteCompletedDeliveryToCover(t *testing.T) {
	for _, app := range []string{"remotion-studio", "vox-broll"} {
		source, err := os.ReadFile(filepath.Join("..", "apps", app, "background.js"))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(source), "ctx.project.setCover({ assetId: asset.id });") {
			t.Fatalf("%s does not promote its completed video to the project cover", app)
		}
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
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "brief.create", map[string]any{"topic": "重复立项"}); err == nil {
		t.Fatal("brief.create must reject a second project brief without recreate: true")
	}
	briefResources, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.list", map[string]any{})
	if err != nil {
		t.Fatalf("resource.list after brief.create: %v", err)
	}
	briefs := briefResources.([]any)
	if len(briefs) != 1 || briefs[0].(map[string]any)["kind"] != "brief" {
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
		{"api", "resource.prepare", map[string]any{"kind": "research"}},
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

	research := map[string]any{"kind": "research", "title": "资料库", "content": map[string]any{"researchQuestion": "为什么", "coverageSummary": "包含支持与限制", "status": "draft", "sources": []any{
		map[string]any{"assetId": "reference-1", "title": "文章", "kind": "article", "insight": "支持证据", "relevance": "高"},
		map[string]any{"assetId": "reference-2", "title": "视频", "kind": "youtube", "insight": "案例", "relevance": "高"},
		map[string]any{"assetId": "reference-3", "title": "反例", "kind": "web", "insight": "限制", "relevance": "中"},
	}}}
	first, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", research)
	if err != nil {
		t.Fatalf("create research: %v", err)
	}
	firstID := first.(Artifact).Value.(map[string]any)["id"].(string)
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "research.approve", map[string]any{"id": firstID}); err != nil {
		t.Fatalf("approve research: %v", err)
	}
	preparedProposals, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.prepare", map[string]any{"kind": "proposals", "contextMentions": []any{
		map[string]any{"type": "project_item", "id": firstID, "name": "资料库", "kind": "research"},
		map[string]any{"type": "system_asset", "id": "system-image-1", "name": "系统参考图", "kind": "image"},
	}})
	if err != nil {
		t.Fatalf("prepare proposals with temporary mentions: %v", err)
	}
	preparedPrompt, _ := preparedProposals.(map[string]any)["prompt"].(string)
	for _, required := range []string{"本次 @ 临时上下文", "资料库", "system-image-1", "系统参考图"} {
		if !strings.Contains(preparedPrompt, required) {
			t.Fatalf("temporary context is missing %q: %s", required, preparedPrompt)
		}
	}
	proposals := map[string]any{"kind": "proposals", "title": "叙事方案", "content": map[string]any{"framing": "从证据到结论", "selectionStatus": "pending", "candidates": []any{map[string]any{"id": "proposal-1", "title": "方案一", "logline": "一个清晰论点", "thesis": "核心结论", "narrativeArc": "钩子到回报", "sourceIds": []any{"reference-1"}, "whyNow": "观众关心"}}}}
	second, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", proposals)
	if err != nil {
		t.Fatalf("create proposals: %v", err)
	}
	secondID := second.(Artifact).Value.(map[string]any)["id"].(string)
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "proposal.select", map[string]any{"id": secondID, "candidateId": "proposal-1"}); err != nil {
		t.Fatalf("select proposal: %v", err)
	}
	script := map[string]any{"kind": "script", "title": "剧本", "content": map[string]any{"title": "测试短片", "logline": "一句话", "screenplay": "旁白", "scenes": []any{map[string]any{"id": "scene-1", "title": "开场", "narration": "新信息", "visualPlan": "数据卡", "purpose": "建立冲突", "durationSec": 60, "sourceIds": []any{"reference-1"}}}}}
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", script); err != nil {
		t.Fatalf("create script: %v", err)
	}
	media := map[string]any{"assetId": "look-image", "text": "视觉圣经", "imageAssetIds": []any{}, "audioAssetIds": []any{}}
	look := map[string]any{"kind": "look", "title": "视觉圣经", "content": map[string]any{"media": media, "definition": "编辑风格", "palette": "红蓝", "paperTechnique": "拼贴", "typeTreatment": "粗体", "texture": "新闻纸", "mood": "紧张", "directorMethod": "证据递进"}}
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", look); err != nil {
		t.Fatalf("create look: %v", err)
	}
	keyframe := func(image any) map[string]any {
		content := map[string]any{"keyframes": []any{map[string]any{"beatId": "beat-1", "title": "开场画面", "composition": "左侧人物，右侧数据卡", "headline": "三秒钩子", "layers": []any{"人物", "数据卡"}}}}
		if image != nil {
			content["keyframes"].([]any)[0].(map[string]any)["image"] = image
		}
		return map[string]any{"kind": "keyframes", "title": "关键画面", "content": content}
	}
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", keyframe(nil)); err == nil {
		t.Fatal("text-only keyframes must be rejected")
	}
	image := map[string]any{"assetId": "generated-image", "text": "编辑拼贴画面", "imageAssetIds": []any{"look-image"}, "audioAssetIds": []any{}}
	createdKeyframes, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.create", keyframe(image))
	if err != nil {
		t.Fatalf("keyframes with generated image: %v", err)
	}
	keyframeValue := createdKeyframes.(Artifact).Value.(map[string]any)
	if _, ok := keyframeValue["dependencies"]; ok {
		t.Fatalf("new resources must not expose section dependencies: %#v", keyframeValue)
	}
	if _, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.list", map[string]any{}); err != nil {
		t.Fatalf("resource.list API: %v", err)
	}
	if _, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.retire", map[string]any{"id": firstID}); err == nil {
		t.Fatal("resource.retire must not be exposed: linear workflow resources cannot be arbitrarily removed")
	}
	if _, err := host.InvokeMCP(Target{ProjectID: project.ID, AppID: appID}, appID, "resource.delete", map[string]any{"id": secondID}); err == nil {
		t.Fatal("resource.delete must not be exposed: linear workflow resources cannot be arbitrarily removed")
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
	if scenes["kind"] != "平台媒体生成" || scenes["generate"] != "recut.video.generate_async" {
		t.Fatalf("scene media route = %#v", scenes)
	}
	if _, err := NewAppHost(apps, store).InvokeAPI(Target{ProjectID: project.ID, AppID: "recut.vox-broll"}, "recut.vox-broll", "resource.prepare", map[string]any{"kind": "scenes"}); err == nil {
		t.Fatal("resource.prepare scenes must reject an out-of-order stage")
	}
	workflowSource, err := os.ReadFile(filepath.Join("..", "apps", "vox-broll", "background.js"))
	if err != nil {
		t.Fatal(err)
	}
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
		if !strings.Contains(string(workflowSource), required) {
			t.Fatalf("scene workflow is missing %q", required)
		}
	}
}
