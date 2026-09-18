/*
 * [INPUT]: 依赖 BuiltinAppManager、内嵌 Remotion Studio、剪辑器与声音工坊发布归档及临时 apps 目录
 * [OUTPUT]: 验证首启安装、旧内置包原子覆盖和开发软链接优先级
 * [POS]: service 内置 App 分发的回归测试；不访问真实用户目录或网络
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 剪辑器已是平台原生 App（RFC 2026-09-17-editor-native-migration M4）：meta 与 op
// 契约定义在 Go（editor_app.go），没有内置安装包，但必须可被 Catalog 解析并枚举进
// MCP 工具面。
func TestEditorIsPlatformNativeApp(t *testing.T) {
	appsDir := filepath.Join(t.TempDir(), "apps")
	if err := NewBuiltinAppManager(appsDir).Ensure(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(appsDir, "editor")); !os.IsNotExist(err) {
		t.Fatalf("editor must not be installed as a built-in App package: %v", err)
	}
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	app, ok := catalog.Get("recut.editor")
	if !ok {
		t.Fatal("Editor was not resolvable from the catalog")
	}
	if app.Root != "" {
		t.Fatalf("native editor descriptor carries no package root, got %q", app.Root)
	}
	listed := false
	apps, err := catalog.List()
	if err != nil {
		t.Fatal(err)
	}
	for _, candidate := range apps {
		if candidate.Manifest.ID == "recut.editor" {
			listed = true
		}
	}
	if !listed {
		t.Fatal("native editor App must be enumerable for the MCP tool surface")
	}
	// Motion Graphic 的 AI 工具面已平台化（recut.motion-graphic.*）：编辑器 App 仅保留
	// api surface 供 UI 桥读写组件素材，MCP surface 归平台（见 TestMotionGraphicPlatformTools）。
	for _, operation := range app.Manifest.Operations {
		if !strings.HasPrefix(operation.Name, "motion-graphic.") {
			continue
		}
		for _, surface := range operation.Surfaces {
			if surface == "mcp" {
				t.Fatalf("editor op %q must not expose mcp; motion graphic is a platform tool", operation.Name)
			}
		}
	}
}

func TestBuiltinAppsInstallRemotionStudioOnFirstLaunch(t *testing.T) {
	appsDir := filepath.Join(t.TempDir(), "apps")
	manager := NewBuiltinAppManager(appsDir)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	app, ok := catalog.Get("recut.remotion-studio")
	if !ok {
		t.Fatal("Remotion Studio was not added to the catalog")
	}
	if app.Root != filepath.Join(appsDir, "remotion-studio") {
		t.Fatalf("built-in App root = %q", app.Root)
	}
	for _, required := range []string{"background.js", "ui/dist/index.html", "remotion-skeleton/pnpm-lock.yaml", "skills/remotion-studio/SKILL.md"} {
		if _, err := os.Stat(filepath.Join(app.Root, required)); err != nil {
			t.Fatalf("built-in App is missing %s: %v", required, err)
		}
	}
}

func TestBuiltinAppsInstallAudioStudioOnFirstLaunch(t *testing.T) {
	appsDir := filepath.Join(t.TempDir(), "apps")
	manager := NewBuiltinAppManager(appsDir)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	app, ok := catalog.Get("recut.audio-studio")
	if !ok {
		t.Fatal("Audio Studio was not added to the catalog")
	}
	if app.Root != filepath.Join(appsDir, "audio-studio") {
		t.Fatalf("built-in App root = %q", app.Root)
	}
	for _, required := range []string{"background.js", "ui/dist/index.html", "python/audio_runner.py", "python/requirements.lock", "bootstrap.py", "skills/audio-studio/SKILL.md", "presets/catalog.json"} {
		if _, err := os.Stat(filepath.Join(app.Root, required)); err != nil {
			t.Fatalf("built-in App is missing %s: %v", required, err)
		}
	}
}

func TestBuiltinAppsReplaceOlderPackage(t *testing.T) {
	appsDir := filepath.Join(t.TempDir(), "apps")
	manager := NewBuiltinAppManager(appsDir)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(appsDir, "remotion-studio", "background.js")
	if err := os.WriteFile(stale, []byte("outdated"), 0o644); err != nil {
		t.Fatal(err)
	}
	obsolete := filepath.Join(appsDir, "remotion-studio", "obsolete.txt")
	if err := os.WriteFile(obsolete, []byte("remove me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(stale)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) == "outdated" {
		t.Fatal("startup synchronization did not replace the stale built-in App")
	}
	if _, err := os.Stat(obsolete); !os.IsNotExist(err) {
		t.Fatalf("stale App file survived replacement: %v", err)
	}
}

func TestBuiltinAppsPreserveDevelopmentSymlink(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	development := filepath.Join(root, "development", "remotion-studio")
	if err := os.MkdirAll(development, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(appsDir, "remotion-studio")
	if err := os.Symlink(development, link); err != nil {
		t.Fatal(err)
	}
	if err := NewBuiltinAppManager(appsDir).Ensure(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(link)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("development App link was replaced: info=%#v err=%v", info, err)
	}
}
