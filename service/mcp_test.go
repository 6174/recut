/*
 * [INPUT]: 依赖 mcp.go 的平台工具定义
 * [OUTPUT]: 锁定按媒体类型拆分的 MCP 工具名称和输入 schema
 * [POS]: service MCP Host 的公开工具契约回归测试；不启动 stdio 服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
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
	for _, name := range []string{"recut.image.generate", "recut.video.generate_async", "recut.speech.generate_async", "recut.media.import_image"} {
		tool, ok := tools[name]
		if !ok {
			t.Fatalf("missing media tool %q", name)
		}
		schema := tool["inputSchema"].(map[string]any)
		properties := schema["properties"].(map[string]any)
		if _, exists := properties["capability"]; exists {
			t.Fatalf("%s must encode its capability in the tool name", name)
		}
		if name != "recut.media.import_image" {
			if _, exists := properties["text"]; !exists {
				t.Fatalf("%s must require text", name)
			}
		}
		if name == "recut.media.import_image" {
			if _, exists := properties["path"]; !exists {
				t.Fatalf("%s must require a project-relative path", name)
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

func TestMediaMCPToolsBypassAppToolBoundary(t *testing.T) {
	for _, name := range []string{
		"recut.media.configuration",
		"recut.image.generate",
		"recut.video.generate_async",
		"recut.speech.generate_async",
		"recut.media.list_voices",
		"recut.media.get_job",
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
