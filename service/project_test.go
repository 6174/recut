/*
 * [INPUT]: 依赖 Store 的项目创建、App SQLite 与文件 sandbox capability
 * [OUTPUT]: 验证平台只提供资源，不规定 App 的数据布局
 * [POS]: service 的项目存储回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectProvidesAppStorageWithoutProjectLayout(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite","files"]}`)
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
	db, err := store.AppDatabase(project.ID, "example.app")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("create table notes (value text)"); err != nil {
		t.Fatal(err)
	}
	files, err := store.AppFilesRoot(project.ID, "example.app")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(files); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(store.projectDir(project.ID), "apps", "example.app", "data")); !os.IsNotExist(err) {
		t.Fatalf("legacy App data directory exists: %v", err)
	}
	mount := filepath.Join(store.projectDir(project.ID), ".recut", "app")
	info, err := os.Lstat(mount)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("App source mount = %v, err = %v", info, err)
	}
	target, err := filepath.EvalSymlinks(mount)
	expectedTarget, expectedErr := filepath.EvalSymlinks(appDir)
	if err != nil || expectedErr != nil || target != expectedTarget {
		t.Fatalf("App source mount target = %q, expected = %q, err = %v / %v", target, expectedTarget, err, expectedErr)
	}
}

func TestStandaloneAppCannotCreateProject(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "standalone")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.standalone","name":"Standalone","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"}}`)
	apps, _ := LoadCatalog(filepath.Join(root, "apps"))
	store := NewStore(filepath.Join(root, "data"), apps)
	_ = store.Ensure()
	if _, err := store.Create(CreateInput{Name: "No", AppID: "example.standalone"}); err == nil {
		t.Fatal("standalone App created a project")
	}
}

func writeTestFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}
