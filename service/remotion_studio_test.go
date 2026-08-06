package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRemotionStudioManifestAndRuntime(t *testing.T) {
	appDir := filepath.Join("..", "apps", "remotion-studio")
	if _, err := os.Stat(filepath.Join(appDir, "manifest.json")); err != nil {
		t.Skipf("remotion-studio not present: %v", err)
	}
	root := t.TempDir()
	dest := filepath.Join(root, "apps", "remotion-studio")
	if err := copyTree(t, appDir, dest, "background.js", "manifest.json"); err != nil {
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
	target := Target{ProjectID: project.ID, AppID: "recut.remotion-studio"}

	// workflow.context must run in Goja and report the brief stage.
	value, err := host.InvokeAPI(target, app.Manifest.ID, "workflow.context", map[string]any{})
	if err != nil {
		t.Fatalf("workflow.context failed: %v", err)
	}
	ctxValue, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("unexpected workflow.context result: %#v", value)
	}
	if ctxValue["stage"] != "brief" {
		t.Fatalf("expected stage brief, got %#v", ctxValue["stage"])
	}

	// project.create stores a brief in the app SQLite namespace.
	brief, err := host.InvokeAPI(target, app.Manifest.ID, "project.create", map[string]any{
		"template": "cinematic-dark", "topic": "测试选题", "details": "细节", "expectedDurationSec": 15,
	})
	if err != nil {
		t.Fatalf("project.create failed: %v", err)
	}
	if briefArtifact, ok := brief.(Artifact); !ok || briefArtifact.Value == nil {
		t.Fatalf("unexpected brief result: %#v", brief)
	}

	// After a brief exists the stage advances to studio (preview/export).
	nextCtx, err := host.InvokeAPI(target, app.Manifest.ID, "workflow.context", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	ctxValue = nextCtx.(map[string]any)
	if ctxValue["stage"] != "studio" {
		t.Fatalf("expected stage studio after brief, got %#v", ctxValue["stage"])
	}

	// catalog.list returns static catalogs for the brief form.
	catalog, err := host.InvokeAPI(target, app.Manifest.ID, "catalog.list", map[string]any{})
	if err != nil {
		t.Fatalf("catalog.list failed: %v", err)
	}
	catalogMap, ok := catalog.(map[string]any)
	if !ok || catalogMap["styleTemplates"] == nil || catalogMap["captionThemes"] == nil {
		t.Fatalf("unexpected catalog result: %#v", catalog)
	}

	// code.write/code.read round-trip through the project files sandbox.
	if _, err := host.InvokeAPI(target, app.Manifest.ID, "code.write", map[string]any{"path": "workspace/compositions/ProjectVideo.tsx", "content": "export const x = 1;"}); err != nil {
		t.Fatalf("code.write failed: %v", err)
	}
	read, err := host.InvokeAPI(target, app.Manifest.ID, "code.read", map[string]any{"path": "workspace/compositions/ProjectVideo.tsx"})
	if err != nil {
		t.Fatalf("code.read failed: %v", err)
	}
	if !strings.Contains(read.(map[string]any)["content"].(string), "export const x = 1;") {
		t.Fatalf("code.read did not round-trip: %#v", read)
	}

	// code paths outside workspace/ are rejected.
	if _, err := host.InvokeAPI(target, app.Manifest.ID, "code.write", map[string]any{"path": "outside.ts", "content": "x"}); err == nil {
		t.Fatal("code.write accepted a path outside workspace/")
	}

	// composition.assets registers referenced assetIds for export.
	assets, err := host.InvokeMCP(target, app.Manifest.ID, "composition.assets", map[string]any{"assetIds": []any{"imgA", "audioX"}})
	if err != nil {
		t.Fatalf("composition.assets failed: %v", err)
	}
	if len(assets.(map[string]any)["assetIds"].([]any)) != 2 {
		t.Fatalf("unexpected assets result: %#v", assets)
	}

	// studio.stop is a no-op-safe lifecycle op without a running server.
	if _, err := host.InvokeAPI(target, app.Manifest.ID, "studio.stop", map[string]any{}); err != nil {
		t.Fatalf("studio.stop failed: %v", err)
	}
	// studio.status reports stopped without a running server.
	status, err := host.InvokeAPI(target, app.Manifest.ID, "studio.status", map[string]any{})
	if err != nil {
		t.Fatalf("studio.status failed: %v", err)
	}
	if status.(map[string]any)["running"] != false {
		t.Fatalf("expected studio stopped, got %#v", status)
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
