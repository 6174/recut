/*
 * [INPUT]: 依赖 WorldStore、Store、MediaService 与临时工作区
 * [OUTPUT]: 验证多 World 隔离、同标题实体跨 World 独立、实体-世界不匹配、分页、已完成/缺失/未就绪 Asset
 * 校验、Canon 哈希稳定性、乐观并发冲突、事务回滚、reference 语义校验、resolve 投影与 Project 绑定固定 revision
 * [POS]: service 的 Creation Worlds 回归测试；不调用真实模型提供商，全部使用内存/临时 SQLite
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestWorldStore(t *testing.T) (*WorldStore, *Store, *MediaService) {
	t.Helper()
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	return NewWorldStore(store, media), store, media
}

// newTestWorldStoreWithApp returns a WorldStore backed by a Store whose catalog
// contains a project-type App, so project binding ownership checks can run.
func newTestWorldStoreWithApp(t *testing.T) (*WorldStore, *Store, *MediaService) {
	t.Helper()
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
	media := NewMediaService(store)
	return NewWorldStore(store, media), store, media
}

func newTestAsset(t *testing.T, media *MediaService, name string) string {
	t.Helper()
	asset, err := media.ImportMediaReader(name, "image/png", bytes.NewReader([]byte{0x89, 0x50, 0x4e, 0x47}))
	if err != nil {
		t.Fatalf("import asset = %v", err)
	}
	return asset.ID
}

func TestWorldsAreIsolatedAcrossSameNamedEntities(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	first, err := worlds.CreateWorld(CreateWorldInput{Name: "Alpha", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	second, err := worlds.CreateWorld(CreateWorldInput{Name: "Beta", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	_ = newTestAsset(t, media, "cover.png")
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: first.ID, Kind: EntityCharacter, Title: "Mina", Content: map[string]any{"age": "20"}})
	if err != nil {
		t.Fatal(err)
	}
	if entity.WorldID != first.ID {
		t.Fatalf("entity world = %q", entity.WorldID)
	}
	other, err := worlds.GetEntity(second.ID, entity.ID)
	if err == nil {
		t.Fatalf("entity leaked across worlds: %#v", other)
	}
	var worldErr *WorldsError
	if !errors.As(err, &worldErr) || worldErr.Code != WorldsErrEntityNotFound {
		t.Fatalf("expected ENTITY_NOT_FOUND, got %v", err)
	}
}

func TestWorldCreateSeedsTemplateEntitiesAndRevision(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Future City 2049", Type: WorldFiction, Description: "霓虹未来"})
	if err != nil {
		t.Fatal(err)
	}
	if world.CurrentRevisionID == "" || world.Revision.ID == "" || world.Revision.CanonicalHash == "" {
		t.Fatalf("world revision = %#v", world.Revision)
	}
	if world.EntityCounts[EntityLocation] != 1 {
		t.Fatalf("seeded location count = %d", world.EntityCounts[EntityLocation])
	}
	entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: world.ID})
	if err != nil || len(entities) != 1 {
		t.Fatalf("template entities = %#v, %v", entities, err)
	}
}

func TestWorldListPaginationAndFilter(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	for index := 0; index < 5; index++ {
		if _, err := worlds.CreateWorld(CreateWorldInput{Name: "W" + string(rune('A'+index)), Type: WorldCustom}); err != nil {
			t.Fatal(err)
		}
	}
	items, next, err := worlds.ListWorlds(ListWorldsInput{Limit: 2})
	if err != nil || len(items) != 2 || next == "" {
		t.Fatalf("page1 = %d items next=%q err=%v", len(items), next, err)
	}
	items, next, err = worlds.ListWorlds(ListWorldsInput{Cursor: next, Limit: 2})
	if err != nil || len(items) != 2 || next == "" {
		t.Fatalf("page2 = %d items next=%q err=%v", len(items), next, err)
	}
	items, next, err = worlds.ListWorlds(ListWorldsInput{Cursor: next, Limit: 2})
	if err != nil || len(items) != 1 || next != "" {
		t.Fatalf("page3 = %d items next=%q err=%v", len(items), next, err)
	}
	items, _, err = worlds.ListWorlds(ListWorldsInput{Text: "WA"})
	if err != nil || len(items) != 1 || items[0].Name != "WA" {
		t.Fatalf("text filter = %#v, %v", items, err)
	}
}

func TestRevisionHashIsStableAndSemanticWritesCreateNewRevision(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Mina", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	firstRevision := world.CurrentRevisionID
	firstHash := world.Revision.CanonicalHash
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Kind: EntityCharacter, Title: "Mina", Content: map[string]any{"appearance": "银发"}})
	if err != nil {
		t.Fatal(err)
	}
	world, err = worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if world.CurrentRevisionID == firstRevision {
		t.Fatal("semantic write did not advance revision")
	}
	if world.Revision.CanonicalHash == firstHash {
		t.Fatal("canonical hash did not change after semantic write")
	}
	// A non-semantic touch (same content) must not create a new revision.
	beforeIdentical, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, EntityID: entity.ID, Kind: EntityCharacter, Title: "Mina", Content: map[string]any{"appearance": "银发"}}); err != nil {
		t.Fatal(err)
	}
	stable, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stable.CurrentRevisionID != beforeIdentical.CurrentRevisionID {
		t.Fatal("identical semantic write advanced the revision")
	}
}

func TestOptimisticConcurrencyConflict(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Brand", Type: WorldBrand})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpdateWorld(UpdateWorldInput{WorldID: world.ID, Name: ptrString("Brand 2.0")}); err != nil {
		t.Fatal(err)
	}
	_, err = worlds.UpdateWorld(UpdateWorldInput{WorldID: world.ID, Name: ptrString("Brand 3.0"), ExpectedRevisionID: world.CurrentRevisionID})
	var conflict *WorldsError
	if !errors.As(err, &conflict) || conflict.Code != WorldsErrRevisionConflict {
		t.Fatalf("expected WORLD_REVISION_CONFLICT, got %v", err)
	}
}

func TestReferenceRequiresCompletedAssetAndValidRole(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "IP", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.AttachReference(AttachReferenceInput{WorldID: world.ID, AssetID: "ast_missing", Role: "character_reference"}); err == nil {
		t.Fatal("missing asset was accepted")
	} else {
		var worldErr *WorldsError
		if !errors.As(err, &worldErr) || worldErr.Code != WorldsErrAssetNotFound {
			t.Fatalf("expected ASSET_NOT_FOUND, got %v", err)
		}
	}
	assetID := newTestAsset(t, media, "mina.png")
	if _, err := worlds.AttachReference(AttachReferenceInput{WorldID: world.ID, AssetID: assetID, Role: "arbitrary_role"}); err == nil {
		t.Fatal("arbitrary role was accepted")
	}
	reference, err := worlds.AttachReference(AttachReferenceInput{WorldID: world.ID, AssetID: assetID, Role: "character_reference", Label: "正面角色设定图"})
	if err != nil {
		t.Fatalf("attach = %v", err)
	}
	if reference.AssetID != assetID || reference.Role != "character_reference" {
		t.Fatalf("reference = %#v", reference)
	}
	world, err = worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if world.Revision.CanonicalHash == "" {
		t.Fatal("reference attach did not record a revision")
	}
}

func TestResolveProjectsSelectionAndRejectsForeignEntity(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Future City", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Kind: EntityCharacter, Title: "Mina", Content: map[string]any{"appearance": "银发"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Kind: EntityRule, Title: "保持霓虹风格", Content: map[string]any{"type": "always", "text": "保持霓虹未来都市风格"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Kind: EntityRule, Title: "不改外貌", Content: map[string]any{"type": "never", "text": "不要修改 Mina 的年龄和外貌"}}); err != nil {
		t.Fatal(err)
	}
	context, err := worlds.Resolve(ResolveInput{WorldID: world.ID, Selection: WorldSelection{Purpose: "video"}})
	if err != nil {
		t.Fatal(err)
	}
	latest, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if context.World.ID != world.ID || context.World.RevisionID != latest.CurrentRevisionID {
		t.Fatalf("context world = %#v", context.World)
	}
	if len(context.Constraints.Always) != 1 || context.Constraints.Always[0] != "保持霓虹未来都市风格" {
		t.Fatalf("constraints = %#v", context.Constraints)
	}
	if len(context.Constraints.Never) != 1 {
		t.Fatalf("never constraints = %#v", context.Constraints)
	}
	if len(context.Entities.Characters) != 1 {
		t.Fatalf("characters = %#v", context.Entities.Characters)
	}
	other, err := worlds.CreateWorld(CreateWorldInput{Name: "Other", Type: WorldCustom})
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: other.ID, Kind: EntityCharacter, Title: "Foreign", Content: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = worlds.Resolve(ResolveInput{WorldID: world.ID, Selection: WorldSelection{EntityIDs: []string{foreign.ID}, Purpose: "video"}})
	var mismatch *WorldsError
	if !errors.As(err, &mismatch) || mismatch.Code != WorldsErrEntityWorldMismatch {
		t.Fatalf("expected ENTITY_WORLD_MISMATCH, got %v", err)
	}
}

func TestProjectBindingFreezesRevisionAndRejectsReplaceWithoutFlag(t *testing.T) {
	worlds, store, _ := newTestWorldStoreWithApp(t)
	project, err := store.Create(CreateInput{Name: "Video", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "IP", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	story, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Kind: EntityStory, Title: "Mina 抵达", Content: map[string]any{"synopsis": "Mina 来到未来都市"}})
	if err != nil {
		t.Fatal(err)
	}
	world, err = worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	frozenRevision := world.CurrentRevisionID
	binding, err := worlds.BindProject(BindProjectInput{ProjectID: project.ID, WorldID: world.ID, Selection: WorldSelection{StoryID: story.ID, Purpose: "video"}})
	if err != nil {
		t.Fatal(err)
	}
	if binding.RevisionID != frozenRevision || binding.TargetID != project.ID || binding.Role != "primary" {
		t.Fatalf("binding = %#v", binding)
	}
	if _, err := worlds.BindProject(BindProjectInput{ProjectID: project.ID, WorldID: world.ID, Selection: WorldSelection{Purpose: "video"}}); err == nil {
		t.Fatal("double bind without replace was accepted")
	}
	// Later World edits must not change the frozen context.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Kind: EntityCharacter, Title: "新角色", Content: map[string]any{"appearance": "银发"}}); err != nil {
		t.Fatal(err)
	}
	context, err := worlds.GetProjectContext(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if context.World.RevisionID != frozenRevision {
		t.Fatalf("frozen revision changed: %q != %q", context.World.RevisionID, frozenRevision)
	}
	for _, character := range context.Entities.Characters {
		if character["name"] == "新角色" {
			t.Fatalf("frozen context leaked a later edit: %#v", context.Entities.Characters)
		}
	}
	replaced, err := worlds.BindProject(BindProjectInput{ProjectID: project.ID, WorldID: world.ID, Selection: WorldSelection{StoryID: story.ID, Purpose: "video"}, Replace: true})
	if err != nil {
		t.Fatalf("replace = %v", err)
	}
	if replaced.ID == binding.ID {
		t.Fatal("replace did not create a new binding")
	}
	unbound, err := store.Create(CreateInput{Name: "Unbound", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	context, err = worlds.GetProjectContext(unbound.ID)
	if err != nil {
		t.Fatal(err)
	}
	if context != nil {
		t.Fatalf("unbound project returned context %#v", context)
	}
}

func TestEntityCreateRejectsEmptyKind(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "IP", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Title: "No kind", Content: map[string]any{}}); err == nil {
		t.Fatal("entity create without kind was accepted")
	}
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Kind: EntityCharacter, Title: "Mina", Content: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, EntityID: entity.ID, Title: "Mina 2.0", Content: map[string]any{}}); err != nil {
		t.Fatalf("kindless update must inherit the entity kind: %v", err)
	}
}

func ptrString(value string) *string { return &value }
func TestCreationWorldAndEntityContextMaterializers(t *testing.T) {
	worlds, store, media := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Future City 2049", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	character, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Kind: EntityCharacter, Title: "Mina", Content: map[string]any{"appearance": "银发"}})
	if err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, NewAgentBridge(store), media)
	worldMaterial, err := manager.contextMaterials([]ChatContext{{Type: "creation_world", Source: "user", Payload: map[string]any{"worldId": world.ID}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(worldMaterial) != 1 || !strings.Contains(worldMaterial[0].Text, "recut.worlds.get") || !strings.Contains(worldMaterial[0].Text, world.ID) {
		t.Fatalf("world material = %#v", worldMaterial)
	}
	entityMaterial, err := manager.contextMaterials([]ChatContext{{Type: "creation_entity", Source: "user", Payload: map[string]any{"worldId": world.ID, "entityId": character.ID}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(entityMaterial) != 1 || !strings.Contains(entityMaterial[0].Text, "recut.worlds.entities.get") || !strings.Contains(entityMaterial[0].Text, "Mina") {
		t.Fatalf("entity material = %#v", entityMaterial)
	}
	if _, err := manager.contextMaterials([]ChatContext{{Type: "creation_entity", Source: "user", Payload: map[string]any{"worldId": world.ID, "entityId": "missing"}}}); err == nil {
		t.Fatal("missing entity attachment was accepted")
	}
	if _, err := manager.contextMaterials([]ChatContext{{Type: "creation_world", Source: "user", Payload: map[string]any{"worldId": "missing"}}}); err == nil {
		t.Fatal("missing world attachment was accepted")
	}
}
