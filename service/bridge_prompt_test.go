/*
 * [INPUT]: 依赖 App Catalog、Store 与嵌入式核心 Agent 模板
 * [OUTPUT]: 验证渲染后的 Vox Agent guide 强制经 Recut MCP 生成媒体，包含中文 Vox 提示词/导演语言，且不会将场景交给 HyperFrames 或本地渲染
 * [POS]: service 的 Agent 指令回归测试；锁定跨 App 的媒体执行边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
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
