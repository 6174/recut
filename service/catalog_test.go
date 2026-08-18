/*
 * [INPUT]: 依赖 Catalog 的 manifest-only 注册规则
 * [OUTPUT]: 验证缺失 apps 目录自动初始化为空目录、项目型与独立型 App 不需要 project-layout 配置、backgroundModules 路径约束，并锁定本地 App link/manifest 变化会刷新 Catalog
 * [POS]: service 的扩展注册表回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCatalogCreatesMissingAppsDirectoryAsEmpty(t *testing.T) {
	appsDir := filepath.Join(t.TempDir(), "apps")
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(appsDir)
	if err != nil || !info.IsDir() {
		t.Fatalf("apps directory = %#v, %v", info, err)
	}
	apps, err := catalog.List()
	if err != nil || len(apps) != 0 {
		t.Fatalf("empty catalog = %#v, %v", apps, err)
	}
	installations, err := catalog.Installations()
	if err != nil || len(installations) != 0 {
		t.Fatalf("empty installations = %#v, %v", installations, err)
	}
}

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

func TestCatalogValidatesBackgroundModules(t *testing.T) {
	manifest := Manifest{
		ManifestVersion: 1,
		ID:              "example.modules",
		Name:            "Modules",
		Author:          "Test",
		Description:     "Test App.",
		Version:         "1.0.0",
		Kind:            ProjectApp,
		Background:      "background.js",
		BackgroundModules: []string{"background/model.js"},
		UI:              UIEntrypoints{ProjectView: "ui/index.html"},
	}
	if err := validateManifest(manifest); err != nil {
		t.Fatalf("valid backgroundModules rejected: %v", err)
	}
	manifest.BackgroundModules = []string{"../escape.js"}
	if err := validateManifest(manifest); err == nil {
		t.Fatal("escaping background module accepted")
	}
	manifest.BackgroundModules = []string{"background/model.ts"}
	if err := validateManifest(manifest); err == nil {
		t.Fatal("non-JavaScript background module accepted")
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

func TestCatalogIgnoresLegacyMediaLibraryLink(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "removed-media-library"), filepath.Join(appsDir, mediaSystemProjectID)); err != nil {
		t.Fatal(err)
	}
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatalf("legacy media-library link prevented startup: %v", err)
	}
	if apps, err := catalog.List(); err != nil || len(apps) != 0 {
		t.Fatalf("legacy media-library link appeared as an App: %#v", apps)
	}
}

func TestCatalogRefreshesWhenLocalAppLinkOrManifestChanges(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	packageRoot := filepath.Join(root, "source", "example")
	if err := os.MkdirAll(packageRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := func(description string) string {
		return `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"` + description + `","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`
	}
	writeTestFile(t, filepath.Join(packageRoot, "manifest.json"), manifest("A local App."))
	if err := os.Symlink(packageRoot, filepath.Join(appsDir, "example")); err != nil {
		t.Fatal(err)
	}
	apps, err := catalog.List()
	if err != nil || len(apps) != 1 || apps[0].Manifest.ID != "example.app" {
		t.Fatalf("linked apps = %#v, err = %v", apps, err)
	}

	writeTestFile(t, filepath.Join(packageRoot, "manifest.json"), manifest("A locally linked App with an updated manifest."))
	apps, err = catalog.List()
	if err != nil || apps[0].Manifest.Description != "A locally linked App with an updated manifest." {
		t.Fatalf("refreshed apps = %#v, err = %v", apps, err)
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

func TestCatalogValidatesPythonRuntime(t *testing.T) {
	valid := Manifest{ManifestVersion: 1, ID: "example.python", Name: "Python", Author: "Test", Description: "Test App.", Version: "1.0.0", Kind: ProjectApp, Background: "background.js", UI: UIEntrypoints{ProjectView: "ui/index.html"}, Permissions: []string{"python", "shell"}, Runtime: AppRuntime{Python: &PythonRuntime{Venv: "example-runtime", Requirements: "python/requirements.lock", Bootstrap: "bootstrap.py"}}}
	if err := validateManifest(valid); err != nil {
		t.Fatalf("valid python runtime rejected: %v", err)
	}
	valid.Runtime.Python.Venv = ""
	if err := validateManifest(valid); err != nil {
		t.Fatalf("platform-default Python venv rejected: %v", err)
	}
	valid.Runtime.Python.Venv = "../escape"
	if err := validateManifest(valid); err == nil {
		t.Fatal("unsafe Python venv accepted")
	}
	valid.Runtime.Python.Venv = "example-runtime"
	valid.Runtime.Python.Version = "3.11.1"
	if err := validateManifest(valid); err == nil {
		t.Fatal("patch-level Python runtime version accepted")
	}
	valid.Runtime.Python.Version = "3.11"
	valid.Runtime.Python.Tools = []string{"ffmpeg", "ffmpeg"}
	if err := validateManifest(valid); err == nil {
		t.Fatal("duplicate Python runtime tool accepted")
	}
}
