/*
 * [INPUT]: 依赖 App Catalog、Store 与嵌入式核心 Agent 模板
 * [OUTPUT]: 验证渲染后的 Vox Agent guide 强制经 Recut MCP 生成媒体、OpenCode MCP 5 分钟超时配置，包含中文 Vox 提示词/导演语言，且不会将场景交给 HyperFrames 或本地渲染
 * [POS]: service 的 Agent 指令与 MCP 配置回归测试；锁定跨 App 的媒体执行边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestVoxGuideRequiresRecutVideoGeneration(t *testing.T) {
	apps, err := LoadCatalog(filepath.Join("..", "apps"))
	if err != nil {
		t.Fatal(err)
	}
	app, ok := apps.Get("recut.vox-broll")
	if !ok {
		t.Fatal("Vox B-roll app is unavailable")
	}
	guide, err := NewAgentBridge(NewStore(t.TempDir(), apps)).renderCodexGuide(app)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"reports no enabled default `image.generate` route",
		"Codex Agent default when the user has not configured an image model",
		"model ID `codex/image`",
		"Codex's native image-generation capability",
		"Do not call `recut.image.generate`",
		"recut.media.import_image",
		"recut.video.generate_async",
		"recut.media.get_job",
		"do not select or read a generic video-creation skill",
		"Keep user-configured extensions available",
		"HyperFrames；它不是 Scenes 阶段的实现方式",
		"Vox 提示词与导演语言",
		"关键画面：五段提示词结构",
		"场景视频：六段提示词结构",
		"导演节奏：从结构到镜头",
	} {
		if !bytes.Contains(guide, []byte(required)) {
			t.Fatalf("rendered guide is missing %q", required)
		}
	}
	appGuide, err := os.ReadFile(filepath.Join(app.Root, "AGENTS.md"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(appGuide, []byte("recut.media.generate")) {
		t.Fatal("Vox guide must not reference the retired recut.media.generate tool")
	}
	if bytes.Contains(appGuide, []byte("使用用户本地的 ffmpeg")) {
		t.Fatal("Vox guide must not direct Scene delivery through local ffmpeg")
	}
	workflow, err := os.ReadFile(filepath.Join(app.Root, "background.js"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(workflow, []byte("recut.media.generate")) || !bytes.Contains(workflow, []byte("platform-media-generation")) {
		t.Fatal("Vox workflow must declare platform media generation without the retired media tool")
	}
}

func TestOpencodeProjectAllowsFiveMinuteMCPCalls(t *testing.T) {
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
	bridge := NewAgentBridge(store)
	session, token, err := bridge.CreateSession(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	path, err := bridge.WriteOpencodeProject(session, token, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	config := map[string]any{}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if timeout, ok := config["experimental"].(map[string]any)["mcp_timeout"].(float64); !ok || timeout != opencodeMCPTimeoutMilliseconds {
		t.Fatalf("MCP call timeout = %#v", config["experimental"])
	}
	recut := config["mcp"].(map[string]any)["recut"].(map[string]any)
	if timeout, ok := recut["timeout"].(float64); !ok || timeout != opencodeMCPTimeoutMilliseconds {
		t.Fatalf("MCP initialization timeout = %#v", recut["timeout"])
	}
}
