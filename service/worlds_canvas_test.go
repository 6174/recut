/*
 * [INPUT]: 依赖 WorldStore 与临时工作区（同 worlds_test.go 的测试基建）
 * [OUTPUT]: 验证 Recursive World Canvas 数据结构落地：entity type 目录（预设 seed / 自定义自动创建 / 覆盖）、
 * world_canvas 元素读写不产 revision、递归容器（create_child / promote / parent 归属）、局部关系
 * （scope_entity_id 不进全局 canonical）、受控关系词表、promote 闭环（便签→实体、箭头→关系）
 * [POS]: service 的 Recursive World Canvas 回归测试；不调用真实模型提供商，全部使用临时 SQLite
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"testing"
)

func createTestWorld(t *testing.T, worlds *WorldStore) string {
	t.Helper()
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Canvas", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	return world.ID
}

// currentCanonical reads the live canonical JSON of a world's current revision.
func currentCanonical(t *testing.T, worlds *WorldStore, worldID string) string {
	t.Helper()
	db, err := worlds.database()
	if err != nil {
		t.Fatal(err)
	}
	var canonical string
	if err := db.QueryRow("select canonical_json from world_revisions r join worlds w on w.current_revision_id = r.id where w.id = ?", worldID).Scan(&canonical); err != nil {
		t.Fatal(err)
	}
	return canonical
}

// containsEntityID reports whether the canonical payload freezes an entity id.
func containsEntityID(canonical, entityID string) bool {
	return entityIDInCanonical(canonical, entityID)
}

func revRelations(canonical string) []map[string]any {
	return parseCanonicalRelations(canonical)
}

// entityIDInCanonical checks whether the given entity id appears in any entity
// bucket of the canonical payload.
func entityIDInCanonical(canonical, entityID string) bool {
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(canonical), &payload); err != nil {
		return false
	}
	entities, _ := payload["entities"].(map[string]any)
	for _, bucket := range entities {
		records, _ := bucket.([]any)
		for _, raw := range records {
			record, _ := raw.(map[string]any)
			if id, ok := record["id"].(string); ok && id == entityID {
				return true
			}
		}
	}
	return false
}

// parseCanonicalRelations returns the relation records frozen in a canonical payload.
func parseCanonicalRelations(canonical string) []map[string]any {
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(canonical), &payload); err != nil {
		return nil
	}
	raw, _ := payload["relations"].([]any)
	items := make([]map[string]any, 0, len(raw))
	for _, value := range raw {
		if record, ok := value.(map[string]any); ok {
			items = append(items, record)
		}
	}
	return items
}

func TestPresetEntityTypesAreSeeded(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	types, err := worlds.ListEntityTypes(worldID)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]WorldEntityType{}
	for _, item := range types {
		byID[item.ID] = item
	}
	for _, id := range []string{"character", "location", "story", "style", "rule", "reference"} {
		if _, ok := byID[id]; !ok {
			t.Fatalf("preset type %q not seeded", id)
		}
	}
	character := byID["character"]
	if character.Scope != "builtin" || !character.Builtin {
		t.Fatalf("preset type scope = %q builtin = %v", character.Scope, character.Builtin)
	}
	if len(character.Fields) == 0 {
		t.Fatal("character preset should carry field schemas")
	}
	if ListWorldRelationTypes() == nil {
		t.Fatal("relation vocabulary should be listable")
	}
}

func TestCustomEntityTypeAutoCreatedAndCanonical(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	before, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	entity, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: worldID, Kind: "mecha", Title: "初号机",
		Content: map[string]any{"能源类型": "核动力"},
	})
	if err != nil {
		t.Fatalf("unknown kind should auto-create a minimal type: %v", err)
	}
	if entity.Kind != "mecha" {
		t.Fatalf("entity kind = %q", entity.Kind)
	}
	types, err := worlds.ListEntityTypes(worldID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range types {
		if item.ID == "mecha" && item.Scope == "custom" {
			found = true
		}
	}
	if !found {
		t.Fatal("custom type 'mecha' not created")
	}
	// Canonical write produces a new revision.
	after, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision.ID == before.Revision.ID {
		t.Fatal("entity upsert should produce a new revision")
	}
}

func TestProvisionalDraftSkipsRevisionAndCanonical(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	before, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: worldID, Kind: EntityCharacter, Title: "草稿角色",
		Content: map[string]any{"appearance": "未定"}, IsProvisional: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !draft.IsProvisional {
		t.Fatal("draft should be provisional")
	}
	after, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision.ID != before.Revision.ID {
		t.Fatal("provisional draft must not produce a revision")
	}
	// Canonical must not contain the draft.
	rev := currentCanonical(t, worlds, worldID)
	if containsEntityID(rev, draft.ID) {
		t.Fatal("provisional draft leaked into canonical")
	}
	// Promote flips to canonical and produces a revision.
	promoted, err := worlds.PromoteEntity(worldID, draft.ID, after.Revision.ID, "test")
	if err != nil {
		t.Fatal(err)
	}
	if promoted.IsProvisional {
		t.Fatal("promoted entity should be canonical")
	}
	afterPromote, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	if afterPromote.Revision.ID == after.Revision.ID {
		t.Fatal("promote should produce a new revision")
	}
}

func TestCanvasElementsDoNotProduceRevisions(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: EntityCharacter, Title: "梁启超"})
	if err != nil {
		t.Fatal(err)
	}
	before, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:entity-1", ContextID: "", Kind: "entity",
		RefKind: "entity", RefID: entity.ID, Name: "梁启超",
		Props: map[string]any{"collapsed": false}, Geometry: map[string]any{"x": 10, "y": 20, "width": 220, "height": 120}, Layer: "0",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:note-1", ContextID: "", Kind: "note",
		Props: map[string]any{"text": "家族草稿"}, Geometry: map[string]any{"x": 300, "y": 20, "width": 160, "height": 120}, Layer: "0",
	}); err != nil {
		t.Fatal(err)
	}
	after, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision.ID != before.Revision.ID {
		t.Fatal("canvas writes must not produce revisions")
	}
	elements, err := worlds.ListCanvasElements(worldID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(elements) != 2 {
		t.Fatalf("canvas elements = %d", len(elements))
	}
	if elements[0].Kind != "entity" || elements[0].RefID != entity.ID {
		t.Fatalf("entity element projection wrong: %#v", elements[0])
	}
	scoped, err := worlds.ListCanvasElements(worldID, entity.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(scoped) != 0 {
		t.Fatalf("entity context should be empty, got %d", len(scoped))
	}
	if err := worlds.DeleteCanvasElement(worldID, "shape:note-1", "test"); err != nil {
		t.Fatal(err)
	}
}

func TestRecursiveContainerCreateChild(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	liang, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: EntityCharacter, Title: "梁启超"})
	if err != nil {
		t.Fatal(err)
	}
	family, err := worlds.CreateChildEntity(CreateChildEntityInput{
		WorldID: worldID, ParentID: liang.ID, ContainerRole: "family",
		Kind: EntityStory, Title: "家族",
	})
	if err != nil {
		t.Fatal(err)
	}
	if family.ParentID != liang.ID || family.ContainerRole != "family" {
		t.Fatalf("child parent = %q role = %q", family.ParentID, family.ContainerRole)
	}
	child, err := worlds.CreateChildEntity(CreateChildEntityInput{
		WorldID: worldID, ParentID: family.ID, Kind: EntityCharacter, Title: "梁思成",
	})
	if err != nil {
		t.Fatal(err)
	}
	liangReload, err := worlds.GetEntity(worldID, liang.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(liangReload.Children) != 1 || liangReload.Children[0].ID != family.ID {
		t.Fatalf("children = %#v", liangReload.Children)
	}
	if child.ParentID != family.ID {
		t.Fatalf("child parent = %q", child.ParentID)
	}
	// Global list hides container children by default? No — it lists all
	// non-provisional entities; parents are just carried on the summary.
	items, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: worldID, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]WorldEntitySummary{}
	for _, item := range items {
		byID[item.ID] = item
	}
	if byID[family.ID].ParentID != liang.ID {
		t.Fatalf("list should carry parentId, got %q", byID[family.ID].ParentID)
	}
}

func TestScopedRelationStaysOutOfGlobalCanonical(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	liang, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: EntityCharacter, Title: "梁启超"})
	if err != nil {
		t.Fatal(err)
	}
	liangsi, err := worlds.CreateChildEntity(CreateChildEntityInput{WorldID: worldID, ParentID: liang.ID, Kind: EntityCharacter, Title: "梁思成"})
	if err != nil {
		t.Fatal(err)
	}
	globalRelation, err := worlds.CreateRelation(CreateRelationInput{
		WorldID: worldID, FromEntityID: liang.ID, ToEntityID: liangsi.ID, RelationType: "father",
	})
	if err != nil {
		t.Fatal(err)
	}
	localRelation, err := worlds.CreateRelation(CreateRelationInput{
		WorldID: worldID, FromEntityID: liangsi.ID, ToEntityID: liang.ID, RelationType: "child",
		ScopeEntityID: liang.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	relations, err := worlds.ListRelations(worldID, liang.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(relations) != 2 {
		t.Fatalf("entity relations = %d", len(relations))
	}
	// Canonical only carries the global relation.
	rev := currentCanonical(t, worlds, worldID)
	relationIDs := map[string]bool{}
	for _, relation := range revRelations(rev) {
		relationIDs[relation["id"].(string)] = true
	}
	if !relationIDs[globalRelation.ID] {
		t.Fatal("global relation missing from canonical")
	}
	if relationIDs[localRelation.ID] {
		t.Fatal("scoped relation leaked into global canonical")
	}
	// Entity view exposes both: global + relations scoped to that entity.
	entity, err := worlds.GetEntity(worldID, liang.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(entity.Relations) != 2 {
		t.Fatalf("entity relation view = %d", len(entity.Relations))
	}
}

func TestCanvasPromoteNoteToEntityAndArrowToRelation(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: EntityCharacter, Title: "林徽因"})
	if err != nil {
		t.Fatal(err)
	}
	note, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:note-1", Kind: "note",
		Props: map[string]any{"text": "建筑学家"}, Geometry: map[string]any{"x": 0, "y": 0, "width": 160, "height": 100}, Layer: "0",
	})
	if err != nil {
		t.Fatal(err)
	}
	arrow, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:arrow-1", Kind: "arrow",
		Props: map[string]any{"fromElementId": "shape:entity-0", "toElementId": "shape:entity-1"},
		Geometry: map[string]any{"x": 0, "y": 0, "width": 1, "height": 1}, Layer: "0",
	})
	if err != nil {
		t.Fatal(err)
	}
	entityEl, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:entity-0", Kind: "entity", RefKind: "entity", RefID: entity.ID,
		Geometry: map[string]any{"x": 0, "y": 0, "width": 220, "height": 120}, Layer: "0",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: EntityCharacter, Title: "梁思成"})
	if err != nil {
		t.Fatal(err)
	}
	secondEl, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:entity-1", Kind: "entity", RefKind: "entity", RefID: second.ID,
		Geometry: map[string]any{"x": 300, "y": 0, "width": 220, "height": 120}, Layer: "0",
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = entityEl
	_ = secondEl
	_ = arrow
	_ = note
	before, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	noteResult, err := worlds.PromoteCanvasElement(PromoteCanvasElementInput{
		WorldID: worldID, ElementID: "shape:note-1", Kind: "character", Title: "林徽因2",
		ExpectedRevisionID: before.Revision.ID, CreatedBy: "test",
	})
	if err != nil {
		t.Fatalf("promote note: %v", err)
	}
	if noteResult["promoted"] != "entity" {
		t.Fatalf("note promote result = %v", noteResult["promoted"])
	}
	// The note element is now bound to the new entity.
	elements, err := worlds.ListCanvasElements(worldID, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, element := range elements {
		if element.ID == "shape:note-1" {
			if element.Kind != "entity" || element.RefID == "" {
				t.Fatalf("note should remain as entity projection: %#v", element)
			}
		}
	}
	mid, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	arrowResult, err := worlds.PromoteCanvasElement(PromoteCanvasElementInput{
		WorldID: worldID, ElementID: "shape:arrow-1", RelationType: "spouse",
		ExpectedRevisionID: mid.Revision.ID, CreatedBy: "test",
	})
	if err != nil {
		t.Fatalf("promote arrow: %v", err)
	}
	if arrowResult["promoted"] != "relation" {
		t.Fatalf("arrow promote result = %v", arrowResult["promoted"])
	}
	after, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision.ID == mid.Revision.ID {
		t.Fatal("promote should produce a new revision")
	}
	relations, err := worlds.ListRelations(worldID, entity.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(relations) != 1 || relations[0].Type != "spouse" {
		t.Fatalf("promoted relation = %#v", relations)
	}
}

func TestForkCarriesCanvasTypesAndContainer(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	liang, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: "mecha", Title: "初号机"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := worlds.CreateChildEntity(CreateChildEntityInput{WorldID: worldID, ParentID: liang.ID, Kind: "mecha", Title: "改二号"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:e", Kind: "entity", RefKind: "entity", RefID: child.ID,
		Geometry: map[string]any{"x": 0, "y": 0, "width": 100, "height": 100}, Layer: "0",
	}); err != nil {
		t.Fatal(err)
	}
	forked, err := worlds.ForkWorld(ForkWorldInput{WorldID: worldID})
	if err != nil {
		t.Fatal(err)
	}
	types, err := worlds.ListEntityTypes(forked.ID)
	if err != nil {
		t.Fatal(err)
	}
	foundCustom := false
	for _, item := range types {
		if item.ID == "mecha" && item.Scope == "custom" {
			foundCustom = true
		}
	}
	if !foundCustom {
		t.Fatal("custom type should survive fork")
	}
	items, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: forked.ID, Limit: 100, IncludeProvisional: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("forked entities = %d", len(items))
	}
	for _, item := range items {
		if item.ID == liang.ID || item.ID == child.ID {
			t.Fatal("fork should remap entity ids")
		}
	}
}