/*
 * [INPUT]: 依赖 mcp.go 的平台工具定义
 * [OUTPUT]: 锁定按媒体类型拆分的 MCP 工具名称和输入 schema
 * [POS]: service MCP Host 的公开工具契约回归测试；不启动 stdio 服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "testing"

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
	for _, name := range []string{"recut.image.generate", "recut.video.generate_async", "recut.speech.generate_async"} {
		tool, ok := tools[name]
		if !ok {
			t.Fatalf("missing media tool %q", name)
		}
		schema := tool["inputSchema"].(map[string]any)
		properties := schema["properties"].(map[string]any)
		if _, exists := properties["capability"]; exists {
			t.Fatalf("%s must encode its capability in the tool name", name)
		}
		if _, exists := properties["text"]; !exists {
			t.Fatalf("%s must require text", name)
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
