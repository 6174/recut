/*
 * [INPUT]: 依赖 Catalog 的 manifest-only 注册规则
 * [OUTPUT]: 验证项目型与独立型 App 不需要 project-layout 配置
 * [POS]: service 的扩展注册表回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCatalogLoadsManifestOnlyApps(t *testing.T) {
	root := t.TempDir()
	for name, manifest := range map[string]string{
		"project":    `{"manifestVersion":1,"id":"example.project","name":"Project","author":"Test","description":"Test project App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`,
		"standalone": `{"manifestVersion":1,"id":"example.standalone","name":"Standalone","author":"Test","description":"Test workspace App.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"}}`,
	} {
		dir := filepath.Join(root, "apps", name)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		writeTestFile(t, filepath.Join(dir, "manifest.json"), manifest)
	}
	catalog, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	if app, ok := catalog.Get("example.standalone"); !ok || app.Manifest.Kind != StandaloneApp {
		t.Fatalf("standalone app = %#v, found = %v", app, ok)
	}
}

func TestCatalogLoadsSymlinkedAppPackage(t *testing.T) {
	root := t.TempDir()
	packageRoot := filepath.Join(root, "source", "example")
	if err := os.MkdirAll(packageRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(packageRoot, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(packageRoot, filepath.Join(appsDir, "example")); err != nil {
		t.Fatal(err)
	}
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	if app, ok := catalog.Get("example.app"); !ok || app.Root != filepath.Join(appsDir, "example") {
		t.Fatalf("symlinked app = %#v, found = %v", app, ok)
	}
}

func TestCatalogRejectsManifestWithoutAttribution(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	if _, err := LoadCatalog(filepath.Join(root, "apps")); err == nil {
		t.Fatal("manifest without author and description was accepted")
	}
}

func TestCatalogLoadsManifestOnboarding(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"onboarding":[{"id":"brief","title":"Create a brief","description":"Start with the goal.","prompt":"Help me create a brief."}]}`)
	catalog, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	app, ok := catalog.Get("example.app")
	if !ok || len(app.Manifest.Onboarding) != 1 || app.Manifest.Onboarding[0].Prompt != "Help me create a brief." {
		t.Fatalf("onboarding = %#v, found = %v", app.Manifest.Onboarding, ok)
	}
}
