/*
 * [INPUT]: 依赖本目录 Catalog 加载能力和 Store 的本地项目创建能力
 * [OUTPUT]: 验证平台核心状态与 App 私有状态按 Project Layout Descriptor 初始化
 * [POS]: service 的项目格式回归测试，防止 App 状态越过 namespace 边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateBuildsCoreAndAppNamespaces(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appsDir, "manifest.json"), `{"id":"example.app","name":"Example","version":"1.0.0"}`)
	writeTestFile(t, filepath.Join(appsDir, "project-layout.json"), `{"version":1,"files":[{"path":"data/model.json","schema":"schemas/model.json","kind":"source"},{"path":"derived/preview.json","kind":"derived"}]}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	projectRoot := filepath.Join(root, "data", "projects", created.ID)
	for _, path := range []string{"recut.json", "core/assets.json", "core/exports.json", "state/events.jsonl", "apps/example.app/app.json", "apps/example.app/data/model.json"} {
		if _, err := os.Stat(filepath.Join(projectRoot, path)); err != nil {
			t.Fatalf("expected %s: %v", path, err)
		}
	}
	state, err := store.ReadAppSourceState(created.ID, "data/model.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := state.(map[string]any); !ok {
		t.Fatalf("source state = %#v", state)
	}
	if _, err := store.ReadAppSourceState(created.ID, "data/private.json"); err == nil {
		t.Fatal("undeclared source state was readable")
	}
}

func writeTestFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}
