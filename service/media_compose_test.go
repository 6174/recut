/*
 * [INPUT]: 依赖本地 FFmpeg、测试项目、MediaService 与临时视频/音频输入
 * [OUTPUT]: 验证两条连续轨能确定性合成为新的、已关联项目的 video Asset
 * [POS]: service 的平台导出回归测试；只覆盖本地合成，不调用任何 Provider 或模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestMediaComposeCreatesNewTimelineAsset(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("FFmpeg is not installed")
	}
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(filepath.Join(appDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	writeTestFile(t, filepath.Join(appDir, "ui", "index.html"), "ok")
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Export", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	videoPath := filepath.Join(root, "source.mp4")
	audioPath := filepath.Join(root, "source.m4a")
	runFFmpeg(t, "-f", "lavfi", "-i", "color=c=blue:s=320x320:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", videoPath)
	runFFmpeg(t, "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", "-y", audioPath)
	media := NewMediaService(store)
	video, err := media.ImportMedia("source.mp4", "video/mp4", readTestMedia(t, videoPath))
	if err != nil {
		t.Fatal(err)
	}
	audio, err := media.ImportMedia("source.m4a", "audio/mp4", readTestMedia(t, audioPath))
	if err != nil {
		t.Fatal(err)
	}
	asset, err := media.Compose(ComposeMediaInput{
		ProjectID:     project.ID,
		VideoTimeline: []TimelineClip{{AssetID: video.ID, StartSec: 0, DurationSec: 1}},
		AudioTimeline: []TimelineClip{{AssetID: audio.ID, StartSec: 0, DurationSec: 1}},
		Settings:      CompositionSettings{Width: 320, Height: 320, FPS: 24, Quality: "balanced"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if asset.ID == video.ID || asset.Kind != "video" || asset.Status != "completed" || len(asset.ProjectIDs) != 1 || asset.ProjectIDs[0] != project.ID {
		t.Fatalf("unexpected export asset: %#v", asset)
	}
	if _, err := os.Stat(asset.Metadata["path"].(string)); err != nil {
		t.Fatal(err)
	}
}

func runFFmpeg(t *testing.T, args ...string) {
	t.Helper()
	if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg %v: %v\n%s", args, err, output)
	}
}

func readTestMedia(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return content
}
