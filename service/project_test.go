/*
 * [INPUT]: 依赖 Store 的项目创建、项目 Doc SQLite 与 App 全局状态（appstate）sandbox capability
 * [OUTPUT]: 验证平台只提供资源，不规定 App 的数据布局；项目 Doc 只含 App 表；系统 App 不能创建用户项目
 * [POS]: service 的项目存储回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectSharesSingleAppSqliteWithoutPlatformTables(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite","files"]}`)
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
	db, err := store.AppStateDatabase("example.app")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("create table notes (project_id text, value text)"); err != nil {
		t.Fatal(err)
	}
	var tables []string
	rows, err := db.Query("select name from sqlite_master where type = 'table'")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	_ = rows.Close()
	for _, platform := range []string{"artifacts", "events", "projects", "agent_sessions"} {
		for _, table := range tables {
			if table == platform {
				t.Fatalf("platform table %q leaked into App sqlite", platform)
			}
		}
	}
	// The project Doc has no own sqlite file: it lives in the App database,
	// partitioned by ctx.project.id.
	if _, err := os.Stat(filepath.Join(store.projectDir(project.ID), "project.sqlite")); !os.IsNotExist(err) {
		t.Fatalf("project.sqlite exists: %v", err)
	}
	files, err := store.ProjectFilesRoot(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(files); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(store.projectDir(project.ID), "recut.json")); !os.IsNotExist(err) {
		t.Fatalf("legacy recut.json exists: %v", err)
	}
}

func TestAppStateIsGlobalAndIndependentOfProjects(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "standalone")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.standalone","name":"Standalone","author":"Test","description":"Test workspace App.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"},"permissions":["sqlite","files"]}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	first, err := store.AppStateDatabase("example.standalone")
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if _, err := first.Exec("create table if not exists prefs (k text)"); err != nil {
		t.Fatal(err)
	}
	second, err := store.AppStateDatabase("example.standalone")
	if err != nil {
		t.Fatal(err)
	}
	var count int
	if err := second.QueryRow("select count(*) from prefs").Scan(&count); err != nil {
		t.Fatalf("appstate is not shared across handles: %v", err)
	}
	if projects, err := store.List(); err != nil || len(projects) != 0 {
		t.Fatalf("appstate leaked into projects = %#v, err = %v", projects, err)
	}
	stateRoot, err := store.AppStateFilesRoot("example.standalone")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stateRoot); err != nil {
		t.Fatal(err)
	}
}

func TestStandaloneAppCannotCreateProject(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "standalone")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.standalone","name":"Standalone","author":"Test","description":"Test workspace App.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"}}`)
	apps, _ := LoadCatalog(filepath.Join(root, "apps"))
	store := NewStore(filepath.Join(root, "data"), apps)
	_ = store.Ensure()
	if _, err := store.Create(CreateInput{Name: "No", AppID: "example.standalone"}); err == nil {
		t.Fatal("standalone App created a project")
	}
}

func TestMediaSystemAppCannotCreateUserProject(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(CreateInput{Name: "No", AppID: mediaSystemAppID}); err == nil {
		t.Fatal("media system App created a user project")
	}
}

func TestOnboardingUsesAppThenGlobalThenPlatformFallback(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"onboarding":[{"id":"app","title":"App","prompt":"App prompt"}]}`)
	fallbackDir := filepath.Join(root, "apps", "fallback")
	if err := os.MkdirAll(fallbackDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(fallbackDir, "manifest.json"), `{"manifestVersion":1,"id":"fallback.app","name":"Fallback","author":"Test","description":"Fallback App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
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
	if err := store.SaveGlobalOnboarding([]OnboardingGuide{{ID: "global", Title: "Global", Prompt: "Global prompt"}}); err != nil {
		t.Fatal(err)
	}
	items, err := store.Onboarding(project.ID, DefaultLocale)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ID != "app" || items[1].ID != "global" {
		t.Fatalf("resolved onboarding = %#v", items)
	}
	if err := store.SaveGlobalOnboarding(nil); err != nil {
		t.Fatal(err)
	}
	items, err = store.Onboarding(project.ID, DefaultLocale)
	if err != nil || len(items) != 1 || items[0].ID != "app" {
		t.Fatalf("app onboarding after global reset = %#v, err = %v", items, err)
	}
	fallbackProject, err := store.Create(CreateInput{Name: "Fallback", AppID: "fallback.app"})
	if err != nil {
		t.Fatal(err)
	}
	items, err = store.Onboarding(fallbackProject.ID, DefaultLocale)
	if err != nil || len(items) != len(platformOnboarding) || items[0].ID != "platform-start" {
		t.Fatalf("platform fallback = %#v, err = %v", items, err)
	}
}

func writeTestFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestSQLiteDSNWindowsPath 锁定 Windows DSN 回归契约：盘符路径必须转成
// file:///C:/... 绝对 URI，绝不允许出现 %5C 或缺前导 "/"（会被 SQLite 误判
// 为 authority 导致 service 启动即退出）。
func TestSQLiteDSNWindowsPath(t *testing.T) {
	dsn := sqliteDSN("C:/Users/chen/.recut/index.db")
	if strings.Contains(dsn, "%5C") || strings.Contains(dsn, "%5c") {
		t.Fatalf("DSN percent-escaped a path separator: %s", dsn)
	}
	if !strings.HasPrefix(dsn, "file:///C:/") {
		t.Fatalf("DSN must be an absolute file URI (file:///C:/...), got %s", dsn)
	}
	if !strings.Contains(dsn, "index.db") || !strings.Contains(dsn, "_txlock=immediate") {
		t.Fatalf("DSN lost path or query parameters: %s", dsn)
	}
	posix := sqliteDSN("/Users/chen/.recut/index.db")
	if !strings.HasPrefix(posix, "file:///Users/") {
		t.Fatalf("POSIX path DSN changed: %s", posix)
	}
}
