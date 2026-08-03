/*
 * [INPUT]: 依赖 mcp.go 的平台工具定义、Store 与本地 HTTP 测试服务
 * [OUTPUT]: 锁定按媒体类型拆分的 MCP 工具名称、终态等待输入 schema、数组型 structuredContent 的 record 包装，以及长图片请求不阻塞素材查询
 * [POS]: service MCP Host 的公开工具契约与 stdio 并发回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestMediaMCPToolDefinitionsSeparateGenerationContracts(t *testing.T) {
	tools := map[string]map[string]any{}
	for _, tool := range mediaMCPToolDefinitions() {
		tools[tool["name"].(string)] = tool
	}
	for _, name := range []string{"recut.media.generate", "recut.media.generate_async"} {
		if _, exists := tools[name]; exists {
			t.Fatalf("legacy multiplexed tool %q must not be exposed", name)
		}
	}
	for _, name := range []string{"recut.image.generate", "recut.video.generate_async", "recut.speech.generate_async", "recut.media.wait_for_job", "recut.media.import_image"} {
		tool, ok := tools[name]
		if !ok {
			t.Fatalf("missing media tool %q", name)
		}
		schema := tool["inputSchema"].(map[string]any)
		properties := schema["properties"].(map[string]any)
		if _, exists := properties["capability"]; exists {
			t.Fatalf("%s must encode its capability in the tool name", name)
		}
		if name != "recut.media.import_image" && name != "recut.media.wait_for_job" {
			if _, exists := properties["text"]; !exists {
				t.Fatalf("%s must require text", name)
			}
		}
		if name == "recut.media.import_image" {
			if _, exists := properties["path"]; !exists {
				t.Fatalf("%s must require a project-relative path", name)
			}
		}
		if name == "recut.media.wait_for_job" {
			if _, exists := properties["jobId"]; !exists {
				t.Fatalf("%s must require a jobId", name)
			}
		}
	}
	video := tools["recut.video.generate_async"]["inputSchema"].(map[string]any)["properties"].(map[string]any)
	if _, ok := video["imageAssetIds"]; !ok {
		t.Fatal("video generation must accept image references")
	}
	if _, ok := video["audioAssetIds"]; !ok {
		t.Fatal("video generation must accept audio references")
	}
	if _, ok := video["videoAssetIds"]; !ok {
		t.Fatal("video generation must accept video references")
	}
	speech := tools["recut.speech.generate_async"]["inputSchema"].(map[string]any)["properties"].(map[string]any)
	if _, ok := speech["imageAssetIds"]; ok {
		t.Fatal("speech generation must not advertise image references")
	}
	if _, ok := speech["voiceId"]; !ok {
		t.Fatal("speech generation must expose a voiceId")
	}
	if _, ok := tools["recut.media.list_voices"]; !ok {
		t.Fatal("speech generation must expose voice discovery")
	}
}

func TestProjectMCPToolCreatesListedProject(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	source, err := store.Create(CreateInput{Name: "Source", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := handleMCP(NewAgentBridge(store), NewAppHost(apps, store), NewMediaService(store), AgentSession{ProjectID: source.ID}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.project.create","arguments":{"name":"Agent Loop 概念","appId":"example.app"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	project, ok := result.(map[string]any)["structuredContent"].(Project)
	if !ok || project.Name != "Agent Loop 概念" || project.AppID != "example.app" {
		t.Fatalf("project tool result = %#v", result)
	}
	projects, err := store.List()
	found := false
	for _, candidate := range projects {
		found = found || candidate.ID == project.ID
	}
	if err != nil || len(projects) != 2 || !found {
		t.Fatalf("listed projects = %#v, err = %v", projects, err)
	}
	tool := projectMCPToolDefinition()
	if tool["name"] != "recut.project.create" {
		t.Fatalf("project tool definition = %#v", tool)
	}
}

func TestMediaMCPToolsBypassAppToolBoundary(t *testing.T) {
	for _, name := range []string{
		"recut.media.configuration",
		"recut.image.generate",
		"recut.video.generate_async",
		"recut.speech.generate_async",
		"recut.media.list_voices",
		"recut.media.get_job",
		"recut.media.wait_for_job",
		"recut.media.list_assets",
		"recut.media.import_image",
		"recut.media.attach",
	} {
		if !isMediaMCPTool(name) {
			t.Fatalf("platform media tool %q was not recognized", name)
		}
	}
	if isMediaMCPTool("recut.vox-broll.create_resource") {
		t.Fatal("App tool was misclassified as a platform media tool")
	}
}

func TestMCPStructuredContentWrapsListsInRecord(t *testing.T) {
	wrapped, ok := structuredMCPContent([]MediaVoice{}).(map[string]any)
	if !ok {
		t.Fatalf("list structuredContent = %#v", structuredMCPContent([]MediaVoice{}))
	}
	if _, ok := wrapped["items"].([]MediaVoice); !ok {
		t.Fatalf("wrapped list = %#v", wrapped)
	}
	object := map[string]any{"assetId": "asset-1"}
	if structured := structuredMCPContent(object); !reflect.DeepEqual(structured, object) {
		t.Fatalf("object structuredContent changed to %#v", structured)
	}
}

func TestMCPListAssetsIsNotBlockedByImageGeneration(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
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
	provider := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/images/generations" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		time.Sleep(100 * time.Millisecond)
		_, _ = writer.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JwQAAAABJRU5ErkJggg=="}]}`))
	}))
	defer provider.Close()
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "openai-compatible", Name: "Test", APIBase: provider.URL}, "test-key")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.SaveRoute(MediaRoute{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session, token, err := bridge.CreateSession(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("RECUT_AGENT_SESSION", session.ID)
	t.Setenv("RECUT_AGENT_TOKEN", token)
	input := strings.NewReader("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"recut.image.generate\",\"arguments\":{\"text\":\"slow image\"}}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"recut.media.list_assets\",\"arguments\":{}}}\n")
	var output bytes.Buffer
	if err := RunMCPStdio(bridge, NewAppHost(apps, store), media, input, &output); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("responses = %q", output.String())
	}
	first := struct {
		ID int `json:"id"`
	}{}
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatal(err)
	}
	if first.ID != 2 {
		t.Fatalf("list_assets was blocked behind image generation: first response = %s", lines[0])
	}
}

func TestImportNativeImageArchivesProjectFileAndRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
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
	content, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JwQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(store.projectDir(project.ID), "files", "cover.png")
	if err := os.WriteFile(imagePath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	asset, err := importNativeImage(store, media, AgentSession{ProjectID: project.ID}, map[string]any{"path": "files/cover.png"})
	if err != nil {
		t.Fatal(err)
	}
	if asset.Origin != "codex-native" || len(asset.ProjectIDs) != 1 || asset.ProjectIDs[0] != project.ID {
		t.Fatalf("native import = %#v", asset)
	}
	if _, err := importNativeImage(store, media, AgentSession{ProjectID: project.ID}, map[string]any{"path": "../outside.png"}); err == nil {
		t.Fatal("native import accepted a path outside the project")
	}
	outsidePath := filepath.Join(root, "outside.png")
	if err := os.WriteFile(outsidePath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsidePath, filepath.Join(store.projectDir(project.ID), "files", "escape.png")); err != nil {
		t.Fatal(err)
	}
	if _, err := importNativeImage(store, media, AgentSession{ProjectID: project.ID}, map[string]any{"path": "files/escape.png"}); err == nil {
		t.Fatal("native import accepted a symbolic-link escape")
	}
}
