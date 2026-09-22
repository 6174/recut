/*
 * [INPUT]: 依赖 Store、MediaService 与临时工作区
 * [OUTPUT]: 验证参考理解产物（origin=understand）与参考资产（role=reference）不进入项目素材库：
 *   项目列表默认隐藏 understand、IncludeAnalysis 可显式包含、一次性迁移幂等解挂
 * [POS]: service 的素材隔离回归测试；修正 Layer 1 理解产物污染项目素材库的历史行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// importDistinctAsset imports a small PNG with a unique trailing byte so the
// content-hash dedup never collapses the fixtures into one asset.
func importDistinctAsset(t *testing.T, media *MediaService, name string, seed byte) string {
	t.Helper()
	asset, err := media.ImportMediaReader(name, "image/png", bytes.NewReader([]byte{0x89, 0x50, 0x4e, 0x47, seed}))
	if err != nil {
		t.Fatalf("import %s = %v", name, err)
	}
	return asset.ID
}

func TestAnalysisAssetsStayOutOfProjectLibrary(t *testing.T) {
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
	project, err := store.Create(CreateInput{Name: "Isolation", AppID: "recut.editor"})
	if err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)

	// An understanding product (origin=understand) attached to the project.
	understand := importDistinctAsset(t, media, "frame.png", 0x01)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("update media_assets set origin = 'understand' where id = ?", understand); err != nil {
		t.Fatal(err)
	}
	if err := media.Attach(understand, project.ID); err != nil {
		t.Fatal(err)
	}

	// A reference asset (role=reference) attached to the project.
	reference := importDistinctAsset(t, media, "reference.mp4", 0x02)
	if _, err := media.UpdateMaterial(reference, MaterialUpdateInput{
		AttrPatch: []MaterialAttr{{Key: "role", Type: "select", Options: []string{"reference"}, Value: "reference"}},
	}, MaterialActorAgent, "asset.update"); err != nil {
		t.Fatal(err)
	}
	if err := media.Attach(reference, project.ID); err != nil {
		t.Fatal(err)
	}

	// A genuine project asset that must stay.
	keep := importDistinctAsset(t, media, "shot.png", 0x03)
	if err := media.Attach(keep, project.ID); err != nil {
		t.Fatal(err)
	}

	listed, err := media.ListAssets(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if containsAsset(listed, understand) {
		t.Fatalf("project listing must hide origin=understand assets by default")
	}
	if !containsAsset(listed, keep) {
		t.Fatalf("project listing must include genuine project assets")
	}

	withAnalysis, err := media.ListAssetsFiltered(project.ID, MediaAssetFilter{IncludeAnalysis: true})
	if err != nil {
		t.Fatal(err)
	}
	if !containsAsset(withAnalysis.Items, understand) {
		t.Fatalf("IncludeAnalysis must surface origin=understand assets")
	}

	detached, err := media.MigrateDetachAnalysisAssets()
	if err != nil {
		t.Fatal(err)
	}
	if detached != 2 {
		t.Fatalf("migration detached = %d, want 2 (understand + reference)", detached)
	}
	after, err := media.ListAssets(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if containsAsset(after, understand) || containsAsset(after, reference) {
		t.Fatalf("migration must detach analysis/reference assets from the project")
	}
	if !containsAsset(after, keep) {
		t.Fatalf("migration must not detach genuine project assets")
	}

	// Idempotent: a second run is a no-op.
	again, err := media.MigrateDetachAnalysisAssets()
	if err != nil {
		t.Fatal(err)
	}
	if again != 0 {
		t.Fatalf("second migration detached = %d, want 0", again)
	}
}

func TestEditorAssetRemoveDetachesFromProject(t *testing.T) {
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
	project, err := store.Create(CreateInput{Name: "Editor", AppID: "recut.editor"})
	if err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	host := NewAppHost(apps, store, media)

	asset := importDistinctAsset(t, media, "shot.png", 0x11)
	invoke(t, host, project, "asset.add", map[string]any{"assetId": asset})
	listed, err := media.ListAssets(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !containsAsset(listed, asset) {
		t.Fatalf("asset.add must attach the asset to the project")
	}

	invoke(t, host, project, "asset.remove", map[string]any{"assetId": asset})
	listed, err = media.ListAssets(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if containsAsset(listed, asset) {
		t.Fatalf("asset.remove must detach the asset from the project")
	}
	if _, err := media.GetAsset(asset); err != nil {
		t.Fatalf("asset.remove must keep the global asset: %v", err)
	}
}

func containsAsset(assets []MediaAsset, id string) bool {
	for _, asset := range assets {
		if asset.ID == id {
			return true
		}
	}
	return false
}
