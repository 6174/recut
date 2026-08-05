package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemotionStudioManifestAndRuntime(t *testing.T) {
	appDir := filepath.Join("..", "apps", "recut-remotion-studio")
	if _, err := os.Stat(filepath.Join(appDir, "manifest.json")); err != nil {
		t.Skipf("recut-remotion-studio not present: %v", err)
	}
	root := t.TempDir()
	dest := filepath.Join(root, "apps", "recut-remotion-studio")
	if err := copyTree(t, appDir, dest, "background.js", "manifest.json", "AGENTS.md"); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatalf("catalog load (manifest validation) failed: %v", err)
	}
	app, ok := apps.Get("recut.remotion-studio")
	if !ok {
		t.Fatal("manifest recut.remotion-studio not found in catalog")
	}
	if app.Manifest.Kind != "project" || app.Manifest.UI.ProjectView == "" {
		t.Fatalf("unexpected manifest shape: kind=%s ui=%#v", app.Manifest.Kind, app.Manifest.UI)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Remotion Test", AppID: "recut.remotion-studio"})
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store, nil)

	// workflow.context must run in Goja and report the brief stage.
	result, err := host.InvokeAPI(project.ID, app.Manifest.ID, "workflow.context", map[string]any{})
	if err != nil {
		t.Fatalf("workflow.context failed: %v", err)
	}
	value, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("unexpected workflow.context result: %#v", result)
	}
	if value["stage"] != "brief" {
		t.Fatalf("expected stage brief, got %#v", value["stage"])
	}

	// project.create stores a brief in the app SQLite namespace.
	brief, err := host.InvokeAPI(project.ID, app.Manifest.ID, "project.create", map[string]any{
		"template": "cinematic-dark", "topic": "测试选题", "details": "细节", "expectedDurationSec": 15,
	})
	if err != nil {
		t.Fatalf("project.create failed: %v", err)
	}
	if briefArtifact, ok := brief.(Artifact); !ok || briefArtifact.Value == nil {
		t.Fatalf("unexpected brief result: %#v", brief)
	}

	// A valid design must be accepted and the stage must advance to preview.
	design := map[string]any{
		"title": "测试设计", "durationSec": 10, "fps": 30, "width": 1280, "height": 720,
		"template": "cinematic-dark",
		"style":    map[string]any{"background": "#0b0b12", "primary": "#fff", "accent": "#e8b341", "text": "#fff", "captionTheme": "pop", "captionPrimary": "#fff", "captionSecondary": "#e8b341", "effectId": "starfield"},
		"scenes": []any{
			map[string]any{"id": "s1", "kind": "title", "title": "开场", "durationSec": 3, "effectId": "cinematic-title"},
			map[string]any{"id": "s2", "kind": "content", "title": "内容", "narration": "一段旁白。", "imageAssetId": "imgA", "durationSec": 4},
			map[string]any{"id": "s3", "kind": "outro", "title": "收尾", "durationSec": 3},
		},
	}
	saved, err := host.InvokeMCP(project.ID, app.Manifest.ID, "composition.save", map[string]any{"title": "测试设计", "content": design})
	if err != nil {
		t.Fatalf("composition.save failed: %v", err)
	}
	savedArtifact, ok := saved.(Artifact)
	if !ok {
		t.Fatalf("unexpected composition.save result: %#v", saved)
	}
	designID := savedArtifact.Value.(map[string]any)["id"]
	if designID == "" {
		t.Fatal("composition.save returned no design id")
	}

	// An invalid design (scene durations not matching) must be rejected.
	if _, err := host.InvokeMCP(project.ID, app.Manifest.ID, "composition.save", map[string]any{
		"title": "坏设计",
		"content": map[string]any{
			"title": "x", "durationSec": 10, "template": "cinematic-dark", "style": map[string]any{},
			"scenes": []any{map[string]any{"id": "a", "kind": "title", "title": "t", "durationSec": 100}},
		},
	}); err == nil {
		t.Fatal("invalid design was accepted")
	}

	// itemPatch update must succeed and the workflow stage must become preview.
	if _, err := host.InvokeAPI(project.ID, app.Manifest.ID, "composition.update", map[string]any{
		"id": designID, "itemPatch": map[string]any{"collection": "scenes", "match": map[string]any{"id": "s2"}, "patch": map[string]any{"narration": "改后的旁白。"}},
	}); err != nil {
		t.Fatalf("composition.update failed: %v", err)
	}
	wf, err := host.InvokeAPI(project.ID, app.Manifest.ID, "workflow.context", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if wf.(map[string]any)["stage"] != "preview" {
		t.Fatalf("expected stage preview after design, got %#v", wf.(map[string]any)["stage"])
	}
}

func copyTree(t *testing.T, src, dst string, names ...string) error {
	t.Helper()
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(src, name))
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dst, name), data, 0o644); err != nil {
			return err
		}
	}
	return nil
}
