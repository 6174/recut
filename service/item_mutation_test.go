/*
 * [INPUT]: 依赖测试 Catalog、Store 与 MediaService
 * [OUTPUT]: 锁定项目及素材重命名、删除和文件/索引清理契约
 * [POS]: service 的工作台实体管理回归测试；保护卡片 More 菜单依赖的 HTTP 写入能力
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectRenameAndDelete(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Before", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	files, err := store.ProjectFilesRoot(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(files, "draft.txt"), "draft")
	renamed, err := store.Rename(project.ID, "After")
	if err != nil || renamed.Name != "After" {
		t.Fatalf("Rename() = %#v, %v", renamed, err)
	}
	if err := store.Delete(project.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(project.ID); err == nil {
		t.Fatal("deleted project is still readable")
	}
	if _, err := os.Stat(files); !os.IsNotExist(err) {
		t.Fatalf("project files still exist: %v", err)
	}
}

func TestMediaAssetRenameAndDelete(t *testing.T) {
	media := NewMediaService(NewStore(t.TempDir(), nil))
	asset, err := media.ImportImage("before.png", "image/png", []byte("image"))
	if err != nil {
		t.Fatal(err)
	}
	renamed, err := media.RenameAsset(asset.ID, "after.png")
	if err != nil || renamed.Name != "after.png" {
		t.Fatalf("RenameAsset() = %#v, %v", renamed, err)
	}
	if err := media.DeleteAsset(asset.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := media.GetAsset(asset.ID); err == nil {
		t.Fatal("deleted asset is still readable")
	}
}
