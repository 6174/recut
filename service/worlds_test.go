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
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: first.ID, TypeID: EntityTypeCharacter, Name: "Mina", Intro: "主角", Detail: "银发少女", Attrs: []EntityAttr{{Key: "age", Type: "text", Value: "20"}}})
	if err != nil {
		t.Fatal(err)
	}
	if entity.WorldID != first.ID || entity.TypeID != EntityTypeCharacter || entity.Detail != "银发少女" {
		t.Fatalf("entity = %#v", entity.WorldEntitySummary)
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

// Onboarding RFC: creation no longer seeds template shell entities — a new
// world starts truly empty (no fake completion) but still commits its initial
// revision so bindings and hashes behave identically to any other world.
func TestWorldCreateStartsEmptyWithRevision(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Future City 2049", Type: WorldFiction, Description: "霓虹未来"})
	if err != nil {
		t.Fatal(err)
	}
	if world.CurrentRevisionID == "" || world.Revision.ID == "" || world.Revision.CanonicalHash == "" {
		t.Fatalf("world revision = %#v", world.Revision)
	}
	for kind := range world.EntityCounts {
		if world.EntityCounts[kind] != 0 {
			t.Fatalf("seeded %s count = %d, want 0 (no template shells)", kind, world.EntityCounts[kind])
		}
	}
	entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: world.ID})
	if err != nil || len(entities) != 0 {
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
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Mina", Attrs: []EntityAttr{{Key: "appearance", Type: "textarea", Value: "银发"}}})
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
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, EntityID: entity.ID, Name: "Mina", Detail: entity.Detail, Attrs: entity.Attrs}); err != nil {
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

// Evidence writes are frozen (RFC 统一 Entity 模型): AttachReference and
// UpdateEvidence now reject every write with WORLD_CONTEXT_INVALID so agents
// migrate to media attrs; reads keep working for pre-existing rows.
func TestEvidenceWritesAreFrozen(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "IP", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	assetID := newTestAsset(t, media, "mina.png")
	_, err = worlds.AttachReference(AttachReferenceInput{WorldID: world.ID, AssetID: assetID, Role: "character_reference"})
	assertFrozenEvidence(t, err)
	_, err = worlds.AttachReference(AttachReferenceInput{WorldID: world.ID, URL: "https://cdn.example.com/a.png", Modality: "image", Purpose: "appearance"})
	assertFrozenEvidence(t, err)
	_, err = worlds.UpdateEvidence(UpdateEvidenceInput{WorldID: world.ID, EvidenceID: "ev_missing", Purpose: "identity", Status: "primary"})
	assertFrozenEvidence(t, err)
}

func assertFrozenEvidence(t *testing.T, err error) {
	t.Helper()
	var worldErr *WorldsError
	if !errors.As(err, &worldErr) || worldErr.Code != WorldsErrContextInvalid {
		t.Fatalf("expected frozen evidence write to fail with WORLD_CONTEXT_INVALID, got %v", err)
	}
	if !strings.Contains(worldErr.Message, "evidence writes are frozen") {
		t.Fatalf("frozen message = %q", worldErr.Message)
	}
}

// Evidence reads stay available so existing worlds and old revisions remain
// browsable during the transition; evidence.list simply returns what is there.
func TestEvidenceReadsRemainAvailableAfterFreeze(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "IP", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	items, err := worlds.ListEvidence(world.ID)
	if err != nil || len(items) != 0 {
		t.Fatalf("list evidence = %#v, %v", items, err)
	}
	context, err := worlds.Resolve(ResolveInput{WorldID: world.ID, Selection: WorldSelection{Purpose: "image"}})
	if err != nil || len(context.References) != 0 {
		t.Fatalf("resolved references = %#v, %v", context.References, err)
	}
	if err := worlds.ArchiveEvidence(ArchiveEvidenceInput{WorldID: world.ID, EvidenceID: "ev_missing"}); err == nil {
		t.Fatal("archiving unknown evidence must fail")
	} else {
		var worldErr *WorldsError
		if !errors.As(err, &worldErr) || worldErr.Code != WorldsErrNotFound {
			t.Fatalf("expected WORLD_NOT_FOUND, got %v", err)
		}
	}
}

func TestResolveProjectsSelectionAndRejectsForeignEntity(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Future City", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Mina", Attrs: []EntityAttr{{Key: "appearance", Type: "textarea", Value: "银发"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeRule, Name: "保持霓虹风格", Attrs: []EntityAttr{{Key: "type", Type: "text", Value: "always"}, {Key: "text", Type: "textarea", Value: "保持霓虹未来都市风格"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeRule, Name: "不改外貌", Detail: "不要修改 Mina 的年龄和外貌", Attrs: []EntityAttr{{Key: "type", Type: "text", Value: "never"}}}); err != nil {
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
	foreign, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: other.ID, TypeID: EntityTypeCharacter, Name: "Foreign"})
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
	story, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeStory, Name: "Mina 抵达", Attrs: []EntityAttr{{Key: "synopsis", Type: "textarea", Value: "Mina 来到未来都市"}}})
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
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "新角色", Attrs: []EntityAttr{{Key: "appearance", Type: "textarea", Value: "银发"}}}); err != nil {
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

func TestEntityCreateRejectsEmptyTypeID(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "IP", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, Name: "No type"}); err == nil {
		t.Fatal("entity create without typeId was accepted")
	}
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Mina"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, EntityID: entity.ID, Name: "Mina 2.0"}); err != nil {
		t.Fatalf("typeless update must inherit the entity type: %v", err)
	}
}

func ptrString(value string) *string { return &value }
func TestCreationWorldAndEntityContextMaterializers(t *testing.T) {
	worlds, store, media := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Future City 2049", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	character, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Mina", Attrs: []EntityAttr{{Key: "appearance", Type: "textarea", Value: "银发"}}})
	if err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, NewAgentBridge(store), media)
	worldMaterial, err := manager.contextMaterials([]ChatContext{{Type: "creation_world", Source: "user", Payload: map[string]any{"worldId": world.ID}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(worldMaterial) != 1 || !strings.Contains(worldMaterial[0].Text, "recut.worlds.brief") || !strings.Contains(worldMaterial[0].Text, world.ID) {
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

func TestArchiveWorldForUserHidesLocalWorldFromList(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "橙子一家", Type: WorldCustom})
	if err != nil {
		t.Fatal(err)
	}
	changed, err := worlds.ArchiveWorldForUser(world.ID, "test")
	if err != nil || !changed {
		t.Fatalf("ArchiveWorldForUser = %v, %v", changed, err)
	}
	if listContains(worlds, t, world.ID) {
		t.Fatal("archived local world must disappear from ListWorlds")
	}
	if changed, err := worlds.ArchiveWorldForUser(world.ID, "test"); err != nil || changed {
		t.Fatalf("second archive = %v, %v", changed, err)
	}
	if _, err := worlds.GetWorld(world.ID); err != nil {
		t.Fatalf("GetWorld after archive: %v", err)
	}
	// platform 世界不能被用户归档。
	if _, err := worlds.ArchiveWorldForUser("pgc.xiaohei", "test"); err == nil {
		t.Fatal("platform world must not be user-archivable")
	}
}

// entityAttrValue returns one attr's value from an entity's ordered attr list.
func entityAttrValue(entity WorldEntity, key string) any {
	for _, attr := range entity.Attrs {
		if attr.Key == key {
			return attr.Value
		}
	}
	return nil
}

// entityAttr returns one attr entry from an entity's ordered attr list.
func entityAttr(entity WorldEntity, key string) (EntityAttr, bool) {
	for _, attr := range entity.Attrs {
		if attr.Key == key {
			return attr, true
		}
	}
	return EntityAttr{}, false
}

// 统一实体模型：preset type 的 locked 字段由服务端自动物化并固定结构
// （label/type 按字段 schema 钉死，value 用户可编辑）；用户自定义 attr 通过；
// 非法 type / 缺 options 的 select / 值类型不符被拒绝。
func TestEntityAttrsPresetLockedFieldsAndValidation(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "IP", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	// Client sends a locked key with deliberately wrong label/type: the schema
	// pins structure, only the value survives.
	entity, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Mina",
		Attrs: []EntityAttr{
			{Key: "appearance", Label: "客户端乱写的标签", Type: "number", Value: "银发红瞳"},
			{Key: "temper", Label: "脾气", Type: "text", Value: "急性子"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	lockedKeys := []string{"appearance", "personality", "voice", "invariants"}
	for _, key := range lockedKeys {
		attr, ok := entityAttr(entity, key)
		if !ok {
			t.Fatalf("preset locked attr %q missing: %#v", key, entity.Attrs)
		}
		if !attr.Locked {
			t.Fatalf("attr %q should be locked", key)
		}
	}
	appearance, _ := entityAttr(entity, "appearance")
	if appearance.Label != "外貌与标志" || appearance.Type != "textarea" {
		t.Fatalf("locked attr structure must be pinned by schema: %#v", appearance)
	}
	if appearance.Value != "银发红瞳" {
		t.Fatalf("locked attr value must stay user-editable: %#v", appearance)
	}
	if temper, ok := entityAttr(entity, "temper"); !ok || temper.Value != "急性子" {
		t.Fatalf("user custom attr must pass through: %#v", entity.Attrs)
	}
	// Unlocked declared fields (background) are not auto-materialized until
	// the user sets them; when set, the media value passes through.
	background := EntityAttr{Key: "background", Type: "media", Value: map[string]any{"assetId": newTestAsset(t, media, "bg.png")}}
	withMedia, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, EntityID: entity.ID, Name: "Mina",
		Attrs: append([]EntityAttr{}, append(entity.Attrs, background)...),
	})
	if err != nil {
		t.Fatal(err)
	}
	gotBackground, ok := entityAttr(withMedia, "background")
	if !ok || gotBackground.Locked || gotBackground.Type != "media" {
		t.Fatalf("background media attr must pass through unlocked: %#v", gotBackground)
	}
	// Invalid attr type is rejected.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Bad",
		Attrs: []EntityAttr{{Key: "weird", Type: "color", Value: "red"}},
	}); err == nil {
		t.Fatal("invalid attr type was accepted")
	}
	// select without options is rejected.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Bad",
		Attrs: []EntityAttr{{Key: "tier", Type: "select", Value: "S"}},
	}); err == nil {
		t.Fatal("select without options was accepted")
	}
	// select value outside options is rejected.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Bad",
		Attrs: []EntityAttr{{Key: "tier", Type: "select", Options: []string{"S", "A"}, Value: "B"}},
	}); err == nil {
		t.Fatal("select value outside options was accepted")
	}
	// number value type mismatch is rejected.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Bad",
		Attrs: []EntityAttr{{Key: "age", Type: "number", Value: "twenty"}},
	}); err == nil {
		t.Fatal("number attr with text value was accepted")
	}
}

// media attr：必须带 assetId；素材不存在（或 media 服务不可用）被拒绝。
func TestEntityMediaAttrRequiresExistingAsset(t *testing.T) {
	world, _, _ := newTestWorldStore(t)
	// WorldStore without a media service: validation cannot reach the library.
	bare := NewWorldStore(world.store, nil)
	bareWorld, err := bare.CreateWorld(CreateWorldInput{Name: "NoMedia", Type: WorldCustom})
	if err != nil {
		t.Fatal(err)
	}
	_, err = bare.UpsertEntity(UpsertEntityInput{
		WorldID: bareWorld.ID, TypeID: EntityTypeCharacter, Name: "Mina",
		Attrs: []EntityAttr{{Key: "background", Type: "media", Value: map[string]any{"assetId": "ast_any"}}},
	})
	var worldErr *WorldsError
	if !errors.As(err, &worldErr) || worldErr.Code != WorldsErrAccessDenied {
		t.Fatalf("expected media-unavailable error, got %v", err)
	}
	if !strings.Contains(worldErr.Message, "media service is unavailable") {
		t.Fatalf("message = %q", worldErr.Message)
	}
	// With a media service: a media attr without assetId is rejected.
	worlds, _, _ := newTestWorldStore(t)
	created, err := worlds.CreateWorld(CreateWorldInput{Name: "Media", Type: WorldCustom})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: created.ID, TypeID: EntityTypeCharacter, Name: "Mina",
		Attrs: []EntityAttr{{Key: "background", Type: "media", Value: map[string]any{}}},
	}); err == nil {
		t.Fatal("media attr without assetId was accepted")
	}
	// A nonexistent asset is rejected with ASSET_NOT_FOUND.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: created.ID, TypeID: EntityTypeCharacter, Name: "Mina",
		Attrs: []EntityAttr{{Key: "background", Type: "media", Value: map[string]any{"assetId": "ast_missing"}}},
	}); err == nil {
		t.Fatal("nonexistent asset was accepted")
	} else if !errors.As(err, &worldErr) || worldErr.Code != WorldsErrAssetNotFound {
		t.Fatalf("expected ASSET_NOT_FOUND, got %v", err)
	}
}

// attrs=nil 更新保留已存储 attrs；attrs=[] 清空用户 attrs，但 locked preset
// 字段由 schema 重新物化（结构保留、value 清空）。
func TestEntityAttrsNilKeepsAndEmptyRematerializes(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Keep", Type: WorldCustom})
	if err != nil {
		t.Fatal(err)
	}
	entity, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Mina",
		Attrs: []EntityAttr{{Key: "appearance", Type: "textarea", Value: "银发"}, {Key: "note", Type: "text", Value: "草稿"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// nil attrs: a partial update (rename only) keeps the stored attrs intact.
	renamed, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, EntityID: entity.ID, Name: "Mina 2"})
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "Mina 2" {
		t.Fatalf("rename = %q", renamed.Name)
	}
	if got := entityAttrValue(renamed, "note"); got != "草稿" {
		t.Fatalf("nil attrs must keep stored attrs, note = %v", got)
	}
	// Empty (non-nil) attrs: user attrs are emptied, locked preset fields are
	// re-materialized by schema with nil values.
	emptied, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, EntityID: entity.ID, Name: "Mina 2", Attrs: []EntityAttr{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := entityAttr(emptied, "note"); ok {
		t.Fatalf("empty attrs must drop user attrs: %#v", emptied.Attrs)
	}
	attr, ok := entityAttr(emptied, "appearance")
	if !ok || !attr.Locked || attr.Value != nil {
		t.Fatalf("locked preset field must be re-materialized with nil value: %#v", attr)
	}
}

// 受控关系词表构成图：ListRelations 从触及实体的视角投影 direction（out/in/scope）。
func TestListRelationsDirectionOutAndIn(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Graph", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	father, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "父亲"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "子女"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.CreateRelation(CreateRelationInput{WorldID: world.ID, FromEntityID: father.ID, ToEntityID: child.ID, RelationType: "father"}); err != nil {
		t.Fatal(err)
	}
	fatherRelations, err := worlds.ListRelations(world.ID, father.ID)
	if err != nil || len(fatherRelations) != 1 {
		t.Fatalf("father relations = %#v, %v", fatherRelations, err)
	}
	if fatherRelations[0].Direction != "out" {
		t.Fatalf("father direction = %q, want out", fatherRelations[0].Direction)
	}
	childRelations, err := worlds.ListRelations(world.ID, child.ID)
	if err != nil || len(childRelations) != 1 {
		t.Fatalf("child relations = %#v, %v", childRelations, err)
	}
	if childRelations[0].Direction != "in" {
		t.Fatalf("child direction = %q, want in", childRelations[0].Direction)
	}
	// The controlled vocabulary carries the inverse projection for the pair.
	inverses := map[string]string{}
	for _, item := range ListWorldRelationTypes() {
		if id, ok := item["id"].(string); ok {
			inverses[id], _ = item["inverseId"].(string)
		}
	}
	if inverses["father"] != "child" || inverses["child"] != "father" {
		t.Fatalf("father/child inverse pair broken: %v/%v", inverses["father"], inverses["child"])
	}
}

// 迁移：legacy 行（type_id=” + content_json）折叠为统一实体模型：
// body→detail、其余 key→text attrs、"type" ghost key 丢弃、type_id=kind。
func TestMigrationCollapsesLegacyEntityRowsToUnified(t *testing.T) {
	worlds, store, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Legacy", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	legacyID := "legacy_entity_1"
	if _, err := db.Exec("insert into world_entities (id, world_id, type_id, kind, title, summary, detail, attrs_json, content_json, created_at, updated_at) values (?, ?, '', 'character', 'Mina', '主角', '', '[]', ?, ?, ?)",
		legacyID, world.ID, `{"body":"银发少女的完整设定","type":"character","appearance":"银发红瞳","age":20}`, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := migrateWorldEntitiesToUnified(db); err != nil {
		t.Fatal(err)
	}
	entity, err := worlds.GetEntity(world.ID, legacyID)
	if err != nil {
		t.Fatal(err)
	}
	if entity.TypeID != "character" || entity.Name != "Mina" || entity.Intro != "主角" {
		t.Fatalf("unified base fields = %#v", entity.WorldEntitySummary)
	}
	if entity.Detail != "银发少女的完整设定" {
		t.Fatalf("body must migrate to detail, got %q", entity.Detail)
	}
	if got := entityAttrValue(entity, "appearance"); got != "银发红瞳" {
		t.Fatalf("content keys must migrate to text attrs, appearance = %#v", got)
	}
	if _, ok := entityAttr(entity, "type"); ok {
		t.Fatalf("the 'type' ghost key must be dropped: %#v", entity.Attrs)
	}
	// Non-string values survive as their JSON encoding.
	age, ok := entityAttr(entity, "age")
	if !ok || age.Value == nil || age.Value == "" {
		t.Fatalf("non-string content value must survive migration: %#v", age)
	}
	// Re-running the migration is a no-op (type_id pinned rows are skipped).
	if err := migrateWorldEntitiesToUnified(db); err != nil {
		t.Fatal(err)
	}
	reloaded, err := worlds.GetEntity(world.ID, legacyID)
	if err != nil || reloaded.Detail != entity.Detail {
		t.Fatalf("second migration pass mutated the row: %#v, %v", reloaded, err)
	}
}

// Canon 投影：attrs 在 resolve/brief 事实里被扁平化为 key→value，
// 生成提示词可以直接读到 appearance/voice 等自然字段。
func TestCanonicalFlattensAttrsIntoResolvedFacts(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Facts", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	entity, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: EntityTypeCharacter, Name: "Mina", Detail: "完整正文",
		Attrs: []EntityAttr{
			{Key: "appearance", Type: "textarea", Value: "银发红瞳"},
			{Key: "voice", Type: "textarea", Value: "低缓清晰"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	brief, err := worlds.Brief(BriefInput{WorldID: world.ID, Selection: WorldSelection{Purpose: "agent"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(brief.Facts.Characters) != 1 {
		t.Fatalf("brief characters = %#v", brief.Facts.Characters)
	}
	fact := brief.Facts.Characters[0]
	if fact["name"] != "Mina" || fact["detail"] != "完整正文" {
		t.Fatalf("brief fact base fields = %#v", fact)
	}
	if fact["appearance"] != "银发红瞳" || fact["voice"] != "低缓清晰" {
		t.Fatalf("brief fact must flatten attrs: %#v", fact)
	}
	if fact["id"] != entity.ID {
		t.Fatalf("brief fact id = %v", fact["id"])
	}
	context, err := worlds.Resolve(ResolveInput{WorldID: world.ID, Selection: WorldSelection{Purpose: "video"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(context.Entities.Characters) != 1 || context.Entities.Characters[0]["appearance"] != "银发红瞳" {
		t.Fatalf("resolve characters = %#v", context.Entities.Characters)
	}
}

func TestMigrationRecyclesEntityEvidenceIntoMediaAttrs(t *testing.T) {
	worlds, store, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Legacy", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	character, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: "character", Name: "Mina", Intro: "主角",
		CreatedBy: "test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into world_asset_refs (id, world_id, entity_id, asset_id, modality, purpose, label, created_at) values (?, ?, ?, 'asset_img_1', 'image', 'appearance', '', ?)",
		"ev_1", world.ID, character.ID, "2026-01-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	// World-level row without an entity: no conversion, archived only.
	if _, err := db.Exec("insert into world_asset_refs (id, world_id, entity_id, asset_id, modality, purpose, label, created_at) values (?, ?, NULL, 'asset_logo_1', 'image', 'visual_style', '标志', ?)",
		"ev_world", world.ID, "2026-01-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := migrateWorldEvidenceToMediaAttrs(db); err != nil {
		t.Fatal(err)
	}
	entity, err := worlds.GetEntity(world.ID, character.ID)
	if err != nil {
		t.Fatal(err)
	}
	media := []EntityAttr{}
	for _, attr := range entity.Attrs {
		if attr.Type == "media" {
			media = append(media, attr)
		}
	}
	if len(media) != 1 {
		t.Fatalf("evidence row must become one media attr, got %#v", entity.Attrs)
	}
	if media[0].Label != "外貌参考" {
		t.Fatalf("purpose must map to the attr label, got %q", media[0].Label)
	}
	payload, _ := media[0].Value.(map[string]any)
	if payload["assetId"] != "asset_img_1" || payload["kind"] != "image" {
		t.Fatalf("media attr value = %#v", payload)
	}
	var archived int
	if err := db.QueryRow("select count(*) from world_asset_refs where archived_at is null and world_id = ?", world.ID).Scan(&archived); err != nil {
		t.Fatal(err)
	}
	if archived != 0 {
		t.Fatalf("recycled rows must be archived, %d remain live", archived)
	}
	// Re-running is a no-op for attrs (rows are archived).
	if err := migrateWorldEvidenceToMediaAttrs(db); err != nil {
		t.Fatal(err)
	}
	reloaded, err := worlds.GetEntity(world.ID, character.ID)
	if err != nil || len(reloaded.Attrs) != len(entity.Attrs) {
		t.Fatalf("second migration pass mutated attrs: %#v", reloaded)
	}
}
