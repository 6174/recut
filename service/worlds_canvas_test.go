/*
 * [INPUT]: 依赖 WorldStore 与临时工作区（同 worlds_test.go 的测试基建）
 * [OUTPUT]: 验证 Recursive World Canvas 数据结构落地：entity type 目录（预设 seed / 自定义自动创建 / 覆盖）、
 * world_canvas 元素读写不产 revision（arrow/link 出发点必须是 entity 元素）、递归容器（create_child / promote /
 * parent 归属）、局部关系（scope_entity_id 不进全局 canonical）、受控关系词表、promote 闭环（便签→实体、
 * 箭头→关系 / 箭头→属性绑定与画布↔属性面板同步纪律）
 * [POS]: service 的 Recursive World Canvas 回归测试；不调用真实模型提供商，全部使用临时 SQLite
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"strings"
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
	// Link start gate: an arrow drawn before its endpoints exist is rejected,
	// and a free element can never be the start point.
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:arrow-bad", Kind: "arrow",
		Props: map[string]any{"fromElementId": "shape:note-1", "toElementId": "shape:entity-0"},
		Geometry: map[string]any{"x": 0, "y": 0, "width": 1, "height": 1}, Layer: "0",
	}); err == nil {
		t.Fatal("arrow from a free element must be rejected")
	}
	// Link start gate: an arrow drawn before its endpoints exist is rejected,
	// and a free element can never be the start point.
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:arrow-bad", Kind: "arrow",
		Props: map[string]any{"fromElementId": "shape:note-1", "toElementId": "shape:entity-0"},
		Geometry: map[string]any{"x": 0, "y": 0, "width": 1, "height": 1}, Layer: "0",
	}); err == nil {
		t.Fatal("arrow from a free element must be rejected")
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:arrow-missing", Kind: "arrow",
		Props: map[string]any{"fromElementId": "shape:ghost", "toElementId": "shape:entity-0"},
		Geometry: map[string]any{"x": 0, "y": 0, "width": 1, "height": 1}, Layer: "0",
	}); err == nil {
		t.Fatal("arrow with a missing start element must be rejected")
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
	// A semantic link may only be drawn once the entity start point exists.
	arrow, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:arrow-1", Kind: "arrow",
		Props: map[string]any{"fromElementId": "shape:entity-0", "toElementId": "shape:entity-1"},
		Geometry: map[string]any{"x": 0, "y": 0, "width": 1, "height": 1}, Layer: "0",
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

// TestCanvasPropertyBindingAndSync：entity→自由元素的箭头是属性绑定；
// 自由元素标记为引用投影（title 标注属性），attr 锚点元素与右侧属性面板
// 共享 entity.content 单一数据源；画布可创建/更新值，但永远无法删除。
func TestCanvasPropertyBindingAndSync(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: EntityCharacter, Title: "林徽因"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:entity-0", Kind: "entity", RefKind: "entity", RefID: entity.ID,
		Geometry: map[string]any{"x": 0, "y": 0, "width": 220, "height": 120}, Layer: "0",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:note-1", Kind: "note", Name: "外貌便签",
		Props: map[string]any{"text": "建筑学家"}, Geometry: map[string]any{"x": 300, "y": 0, "width": 160, "height": 100}, Layer: "0",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:arrow-1", Kind: "arrow",
		Props: map[string]any{"fromElementId": "shape:entity-0", "toElementId": "shape:note-1"},
		Geometry: map[string]any{"x": 0, "y": 0, "width": 1, "height": 1}, Layer: "0",
	}); err != nil {
		t.Fatal(err)
	}
	before, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := worlds.PromoteCanvasElement(PromoteCanvasElementInput{
		WorldID: worldID, ElementID: "shape:arrow-1", Field: "appearance",
		ExpectedRevisionID: before.Revision.ID, CreatedBy: "test",
	})
	if err != nil {
		t.Fatalf("promote property binding: %v", err)
	}
	if result["promoted"] != "property" {
		t.Fatalf("property promote result = %v", result["promoted"])
	}
	// Canvas-side creation: the empty property seeded from the note text.
	updated, err := worlds.GetEntity(worldID, entity.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Content["appearance"] != "建筑学家" {
		t.Fatalf("property should be seeded from the note, got %#v", updated.Content["appearance"])
	}
	// The target element is marked as a reference projection with the bound
	// property in its title.
	elements, err := worlds.ListCanvasElements(worldID, "")
	if err != nil {
		t.Fatal(err)
	}
	var attrFound bool
	for _, element := range elements {
		if element.ID == "shape:note-1" {
			if element.Props["binding"] != "property" || element.Props["boundField"] != "appearance" || element.Props["boundEntityId"] != entity.ID {
				t.Fatalf("note should be marked as a property reference: %#v", element.Props)
			}
			if !strings.Contains(element.Name, "外貌与标志") {
				t.Fatalf("note title should carry the bound property label, got %q", element.Name)
			}
		}
		if element.ID == "attr:shape:note-1" {
			attrFound = true
			if element.Kind != "attr" || element.RefID != entity.ID || element.Name != "属性 · 外貌与标志" {
				t.Fatalf("attr anchor element wrong: %#v", element)
			}
		}
	}
	if !attrFound {
		t.Fatal("attr anchor element missing")
	}
	// Canvas update writes through to the shared data source.
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "attr:shape:note-1", Kind: "attr",
		RefKind: "entity", RefID: entity.ID, Name: "属性 · 外貌与标志",
		Props: map[string]any{"field": "appearance", "sourceElementId": "shape:note-1", "value": "近代建筑之父"},
		Geometry: map[string]any{"x": 300, "y": 0}, Layer: "0",
	}); err != nil {
		t.Fatal(err)
	}
	updated, err = worlds.GetEntity(worldID, entity.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Content["appearance"] != "近代建筑之父" {
		t.Fatalf("canvas value should sync into entity content, got %#v", updated.Content["appearance"])
	}
	// Panel → canvas: a right-panel edit flows into the attr projection, which
	// only stores a reference to the shared data source.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: worldID, EntityID: entity.ID, Kind: entity.Kind, Title: entity.Title,
		Content: map[string]any{"appearance": "中国第一位女建筑师"}, CreatedBy: "panel",
	}); err != nil {
		t.Fatal(err)
	}
	elements, err = worlds.ListCanvasElements(worldID, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, element := range elements {
		if element.ID == "attr:shape:note-1" && element.Props["value"] != "中国第一位女建筑师" {
			t.Fatalf("panel edit should refresh the attr projection, got %#v", element.Props["value"])
		}
	}
	// Canvas cannot delete: an empty value is ignored, panel data survives.
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "attr:shape:note-1", Kind: "attr",
		RefKind: "entity", RefID: entity.ID, Name: "属性 · 外貌与标志",
		Props: map[string]any{"field": "appearance", "sourceElementId": "shape:note-1", "value": ""},
		Geometry: map[string]any{"x": 300, "y": 0}, Layer: "0",
	}); err != nil {
		t.Fatal(err)
	}
	updated, err = worlds.GetEntity(worldID, entity.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Content["appearance"] != "中国第一位女建筑师" {
		t.Fatalf("canvas must not delete panel-side property data, got %#v", updated.Content["appearance"])
	}
	// Panel-side deletion is authoritative: removing the property empties the
	// projection instead of leaving a stale copy.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: worldID, EntityID: entity.ID, Kind: entity.Kind, Title: entity.Title,
		Content: map[string]any{}, CreatedBy: "panel",
	}); err != nil {
		t.Fatal(err)
	}
	elements, err = worlds.ListCanvasElements(worldID, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, element := range elements {
		if element.ID == "attr:shape:note-1" {
			if value, ok := element.Props["value"]; ok && value != nil {
				t.Fatalf("panel deletion should empty the attr projection, got %#v", value)
			}
		}
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
// TestDeleteEntityArchivesSubgraphAndCascade（T2）：删除实体归档整个子图，
// 触达关系物理删除、证据归档、画布实体投影清理，产 1 条 revision。
func TestDeleteEntityArchivesSubgraphAndCascade(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	person, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: "character", Title: "林小满", Summary: "电台主播"})
	if err != nil {
		t.Fatal(err)
	}
	station, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: "location", Title: "北平路电台"})
	if err != nil {
		t.Fatal(err)
	}
	necklace, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: "object", Title: "项链", ParentID: person.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.CreateRelation(CreateRelationInput{WorldID: worldID, FromEntityID: person.ID, ToEntityID: station.ID, RelationType: "located_in"}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.AttachReference(AttachReferenceInput{WorldID: worldID, EntityID: person.ID, URL: "https://example.com/portrait.png", Modality: "image", Role: "character_reference"}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:" + person.ID, Kind: "entity", RefKind: "entity", RefID: person.ID,
		Name: "林小满", Geometry: map[string]any{"x": 40, "y": 40},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: worldID, ElementID: "shape:attr-" + person.ID, Kind: "attr", RefKind: "", RefID: "",
		Name: "属性 · 图片", Geometry: map[string]any{"x": 300, "y": 40},
	}); err != nil {
		t.Fatal(err)
	}
	revisionBefore, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}

	result, err := worlds.DeleteEntity(DeleteEntityInput{WorldID: worldID, EntityID: person.ID})
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 2 || result.Children != 1 || result.Relations != 1 || result.Evidences != 1 {
		t.Fatalf("delete impact = %+v", result)
	}
	if _, err := worlds.GetEntity(worldID, person.ID); err == nil {
		t.Fatal("deleted entity should not be gettable")
	}
	items, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: worldID, Limit: 100, IncludeProvisional: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != station.ID {
		t.Fatalf("station should survive: %+v", items)
	}
	if _, err := worlds.GetEntity(worldID, necklace.ID); err == nil {
		t.Fatal("child entity should be archived with the parent")
	}
	db, err := worlds.database()
	if err != nil {
		t.Fatal(err)
	}
	var relations int
	if err := db.QueryRow("select count(*) from world_relations where world_id = ?", worldID).Scan(&relations); err != nil {
		t.Fatal(err)
	}
	if relations != 0 {
		t.Fatalf("relations should be cascaded, got %d", relations)
	}
	// 文档粒度存储（RFC 2026-09-09）：投影清理从文档正文统计
	rootDoc, err := worlds.GetCanvasDocument(worldID, "")
	if err != nil {
		t.Fatal(err)
	}
	entityElements, attrElements := 0, 0
	for _, element := range rootDoc.Elements {
		if element.RefKind == "entity" {
			entityElements++
		}
		if element.Kind == "attr" {
			attrElements++
		}
	}
	if entityElements != 0 {
		t.Fatalf("entity canvas projections should be removed, got %d", entityElements)
	}
	if attrElements != 1 {
		t.Fatalf("unrelated attr element should survive, got %d", attrElements)
	}
	revisionAfter, err := worlds.GetWorld(worldID)
	if err != nil {
		t.Fatal(err)
	}
	if revisionAfter.Revision.ID == revisionBefore.Revision.ID {
		t.Fatal("delete should produce a new revision")
	}
	evidence, err := worlds.ListEvidence(worldID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range evidence {
		if item.EntityID == person.ID && item.Status != "archived" {
			t.Fatalf("evidence of deleted entity should be archived: %+v", item)
		}
	}
}

// TestRevertToRevisionRebuildsSemantics（T12）：回滚 = 非破坏指针回移；
// 目标 revision 之后新增的实体/关系/证据消失，目标点之前的状态按 canonical 重建（id 保留）。
func TestRevertToRevisionRebuildsSemantics(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)
	person, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: "character", Title: "林小满", Summary: "电台主播"})
	if err != nil {
		t.Fatal(err)
	}
	history, err := worlds.ListRevisions(worldID)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) < 2 {
		t.Fatalf("history should have multiple revisions, got %d", len(history))
	}
	target := history[0]
	station, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: "location", Title: "北平路电台"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.CreateRelation(CreateRelationInput{WorldID: worldID, FromEntityID: person.ID, ToEntityID: station.ID, RelationType: "located_in"}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.AttachReference(AttachReferenceInput{WorldID: worldID, EntityID: person.ID, URL: "https://example.com/p.png", Modality: "image"}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: "object", Title: "项链"}); err != nil {
		t.Fatal(err)
	}
	reverted, err := worlds.RevertToRevision(worldID, target.ID, "", "test")
	if err != nil {
		t.Fatal(err)
	}
	if reverted.Revision.ID != target.ID {
		t.Fatalf("revert should point at target revision, got %s want %s", reverted.Revision.ID, target.ID)
	}
	items, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: worldID, Limit: 100, IncludeProvisional: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != person.ID {
		t.Fatalf("only the pre-revision entity should survive revert: %+v", items)
	}
	if items[0].Summary != "电台主播" {
		t.Fatalf("entity fields should be rebuilt from canonical: %+v", items[0])
	}
	db, err := worlds.database()
	if err != nil {
		t.Fatal(err)
	}
	var relations, evidence int
	if err := db.QueryRow("select count(*) from world_relations where world_id = ?", worldID).Scan(&relations); err != nil {
		t.Fatal(err)
	}
	if relations != 0 {
		t.Fatalf("relations added after target should be gone, got %d", relations)
	}
	if err := db.QueryRow("select count(*) from world_asset_refs where world_id = ?", worldID).Scan(&evidence); err != nil {
		t.Fatal(err)
	}
	if evidence != 0 {
		t.Fatalf("evidence added after target should be gone, got %d", evidence)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, Kind: "story", Title: "新故事"}); err != nil {
		t.Fatalf("writes after revert should work: %v", err)
	}
}
