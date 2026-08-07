package main

import (
	"encoding/json"
	"os"
	"path/filepath"
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
	// createBrief validates the template against the kit catalog via
	// scripts/kit-bridge.js; seed a minimal self-contained kit so the test
	// hermetic temp App does not depend on the source App's full package.
	seedMinimalKit(t, dest, []string{"paper-collage", "cinematic-dark", "clean-editorial", "vibrant-tech"})
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

	// composition.assets registers referenced assetIds for export.
	assets, err := host.InvokeMCP(target, app.Manifest.ID, "composition.assets", map[string]any{"assetIds": []any{"imgA", "audioX"}})
	if err != nil {
		t.Fatalf("composition.assets failed: %v", err)
	}
	if len(assets.(map[string]any)["assetIds"].([]any)) != 2 {
		t.Fatalf("unexpected assets result: %#v", assets)
	}

	// preview.serve.status reports stopped before any preview server is started.
	serve, err := host.InvokeAPI(target, app.Manifest.ID, "preview.serve.status", map[string]any{})
	if err != nil {
		t.Fatalf("preview.serve.status failed: %v", err)
	}
	if serve.(map[string]any)["running"] != false {
		t.Fatalf("expected preview stopped, got %#v", serve)
	}

	// logs.read rejects an unknown job id.
	if _, err := host.InvokeAPI(target, app.Manifest.ID, "logs.read", map[string]any{"jobId": "missing"}); err == nil {
		t.Fatal("logs.read accepted an unknown job id")
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

// seedMinimalKit writes a tiny scripts/kit-bridge.js and kit catalog so the
// App's readCatalog shell call works in a hermetic test App without the full
// source package tree.
func seedMinimalKit(t *testing.T, appDir string, templates []string) {
	t.Helper()
	bridge := `const fs = require("fs"); const path = require("path");
const kit = path.join(__dirname, "..", "packages", "remotion-kit");
const catalog = JSON.parse(fs.readFileSync(path.join(kit, "catalog.json"), "utf8"));
let version = "0.0.0";
try { version = JSON.parse(fs.readFileSync(path.join(kit, "manifest.json"), "utf8")).version || version; } catch (_) {}
process.stdout.write(JSON.stringify({ ...catalog, kitVersion: version }));`
	scriptsDir := filepath.Join(appDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(scriptsDir, "kit-bridge.js"), []byte(bridge), 0o644); err != nil {
		t.Fatal(err)
	}
	kitDir := filepath.Join(appDir, "packages", "remotion-kit")
	if err := os.MkdirAll(kitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	styleTemplates := map[string]any{}
	for _, name := range templates {
		styleTemplates[name] = map[string]string{"label": name}
	}
	catalogData, _ := json.Marshal(map[string]any{"styleTemplates": styleTemplates, "captionThemes": []any{}, "canvasSizes": []any{}, "components": []any{}})
	if err := os.WriteFile(filepath.Join(kitDir, "catalog.json"), catalogData, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(kitDir, "manifest.json"), []byte(`{"version":"0.0.0"}`), 0o644); err != nil {
		t.Fatal(err)
	}
}
