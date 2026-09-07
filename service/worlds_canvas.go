/*
 * [INPUT]: 依赖 WorldStore 的 worlds/world_entities/world_relations 表、既有受控词表与 commitRevision 协议
 * [OUTPUT]: 对外提供 Recursive World Canvas 的能力面：受控关系词表、可扩展 entity type 目录（预设 seed + 自定义
 * 自动创建）、world_canvas 元素读写（entity 骨干 + 自由元素，均不产 revision）、递归容器（create_child/promote）
 * 与局部子图关系（scope_entity_id）。语义真相只落在 world_entities + world_relations；画布/类型是表达层，不进 Canon
 * [POS]: service 的 Recursive World Canvas 领域层；与 worlds_http.go（REST）、worlds_mcp.go（MCP）共同构成
 * recut.worlds.* 的增量能力，不改变既有 Canon 读取面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// WorldRelationSpec is one entry of the controlled relation vocabulary.
type WorldRelationSpec struct {
	LabelZh string `json:"labelZh"`
	Group   string `json:"group"`
}

// worldRelationTypes is the built-in read-only relation directory (RFC §5.3):
// relation_type stays open for free extension, but UI prefers these entries so
// the graph stays readable. Groups mirror the user draft: people/world/video/story.
var worldRelationTypes = map[string]WorldRelationSpec{
	"father":      {LabelZh: "父亲", Group: "people"},
	"mother":      {LabelZh: "母亲", Group: "people"},
	"child":       {LabelZh: "子女", Group: "people"},
	"spouse":      {LabelZh: "配偶", Group: "people"},
	"partner":     {LabelZh: "伴侣", Group: "people"},
	"friend":      {LabelZh: "朋友", Group: "people"},
	"teacher":     {LabelZh: "老师", Group: "people"},
	"student":     {LabelZh: "学生", Group: "people"},
	"colleague":   {LabelZh: "同事", Group: "people"},
	"enemy":       {LabelZh: "敌人", Group: "people"},
	"belongs_to":  {LabelZh: "属于", Group: "world"},
	"located_in":  {LabelZh: "位于", Group: "world"},
	"owns":        {LabelZh: "拥有", Group: "world"},
	"contains":    {LabelZh: "包含", Group: "world"},
	"created_by":  {LabelZh: "由…创作", Group: "world"},
	"appears_in":  {LabelZh: "出现在", Group: "video"},
	"followed_by": {LabelZh: "接续", Group: "video"},
	"precedes":    {LabelZh: "先于", Group: "video"},
	"adapted_from": {LabelZh: "改编自", Group: "story"},
	"causes":      {LabelZh: "导致", Group: "story"},
	"references":  {LabelZh: "引用", Group: "story"},
	"depends_on":  {LabelZh: "依赖", Group: "story"},
	"part_of":     {LabelZh: "属于一部分", Group: "story"},
}

// ListWorldRelationTypes returns the controlled vocabulary as a stable list.
func ListWorldRelationTypes() []map[string]any {
	groups := []string{"people", "world", "video", "story"}
	items := make([]map[string]any, 0, len(worldRelationTypes))
	for _, group := range groups {
		for id, spec := range worldRelationTypes {
			if spec.Group != group {
				continue
			}
			items = append(items, map[string]any{"id": id, "labelZh": spec.LabelZh, "group": spec.Group})
		}
	}
	return items
}

// WorldEntityType is one row of the entity type directory: a type is the schema,
// an entity is its instance. Custom types live per-world; presets are copied in
// as builtin rows and can be overridden in place (RFC §5.4).
type WorldEntityType struct {
	ID         string            `json:"id"`
	WorldID    string            `json:"worldId"`
	Scope      string            `json:"scope"` // preset | builtin | custom
	Name       string            `json:"name"`
	Icon       string            `json:"icon,omitempty"`
	Color      string            `json:"color,omitempty"`
	BaseKind   string            `json:"baseKind,omitempty"`
	Fields     []EntityTypeField `json:"fields"`
	ExtendsID  string            `json:"extendsId,omitempty"`
	Builtin    bool              `json:"builtin"`
	CreatedAt  string            `json:"createdAt"`
	UpdatedAt  string            `json:"updatedAt"`
}

// EntityTypeField is one field schema entry inside a type's fields_json.
type EntityTypeField struct {
	Key         string            `json:"key"`
	Label       string            `json:"label"`
	Type        string            `json:"type"` // text | textarea | number | boolean | select | multi | media
	Required    bool              `json:"required,omitempty"`
	Placeholder string            `json:"placeholder,omitempty"`
	Options     []string          `json:"options,omitempty"`
	Invariant   bool              `json:"invariant,omitempty"`
	I18n        map[string]string `json:"i18n,omitempty"`
}

// presetEntityTypeFields returns the first-phase preset field schemas, aligned
// with the existing kind semantics (RFC §5.4 table).
var presetEntityTypeFields = map[string][]EntityTypeField{
	"character": {
		{Key: "appearance", Label: "外貌与标志", Type: "textarea"},
		{Key: "personality", Label: "性格", Type: "textarea"},
		{Key: "voice", Label: "声音", Type: "textarea"},
		{Key: "invariants", Label: "不可变特征", Type: "textarea", Invariant: true},
	},
	"location": {
		{Key: "description", Label: "描述", Type: "textarea"},
		{Key: "atmosphere", Label: "氛围", Type: "textarea"},
	},
	"story": {
		{Key: "premise", Label: "前提", Type: "textarea"},
		{Key: "moment", Label: "关键时刻", Type: "textarea"},
		{Key: "emotion", Label: "情绪", Type: "textarea"},
	},
	"style": {
		{Key: "visual", Label: "视觉", Type: "textarea"},
		{Key: "guidance", Label: "guidance", Type: "textarea"},
		{Key: "avoid", Label: "避免", Type: "textarea"},
	},
	"rule": {
		{Key: "text", Label: "规则文本", Type: "textarea"},
	},
	"reference": {},
}

// presetEntityTypeNames maps a preset id to its zh display name.
var presetEntityTypeNames = map[string]string{
	"character": "人物", "location": "场景", "story": "故事",
	"style": "风格", "rule": "规则", "reference": "参考",
}

// ensurePresetEntityTypesInTx lazily seeds the preset directory rows into a
// world as scope='builtin' copies the first time the world's type surface is
// touched. Idempotent: worlds that already carry rows are left untouched.
func ensurePresetEntityTypesInTx(tx *sql.Tx, worldID string) error {
	var count int
	if err := tx.QueryRow("select count(*) from world_entity_types where world_id = ?", worldID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	now := isoTimeNow()
	order := []string{"character", "location", "story", "style", "rule", "reference"}
	for _, id := range order {
		fields := presetEntityTypeFields[id]
		encoded, err := json.Marshal(fields)
		if err != nil {
			return err
		}
		if _, err := tx.Exec("insert into world_entity_types (id, world_id, scope, name, icon, color, base_kind, fields_json, builtin, created_at, updated_at) values (?, ?, 'builtin', ?, '', '', ?, ?, 1, ?, ?)",
			id, worldID, presetEntityTypeNames[id], baseKindForPreset(id), string(encoded), now, now); err != nil {
			return err
		}
	}
	return nil
}

func baseKindForPreset(id string) string {
	if _, ok := presetEntityTypeFields[id]; !ok {
		return ""
	}
	return id
}

// EnsurePresetEntityTypes is the public, self-owning-tx entry used by world
// creation and fork; it makes the preset directory visible to any consumer.
func (w *WorldStore) EnsurePresetEntityTypes(worldID string) error {
	db, err := w.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := ensurePresetEntityTypesInTx(tx, worldID); err != nil {
		return err
	}
	return tx.Commit()
}

// ensureEntityType makes sure the given entity kind resolves inside the world's
// type directory. Preset kinds get their seeded builtin row; unknown kinds
// auto-create a minimal custom type (name + description) so canvas creation
// never blocks on a missing schema (RFC §5.4 "type 成本极低").
func (w *WorldStore) ensureEntityType(tx *sql.Tx, worldID, kind string) error {
	if kind == "" {
		return nil
	}
	if err := ensurePresetEntityTypesInTx(tx, worldID); err != nil {
		return err
	}
	var id string
	err := tx.QueryRow("select id from world_entity_types where world_id = ? and id = ? and archived_at is null", worldID, kind).Scan(&id)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	now := isoTimeNow()
	fields, _ := json.Marshal([]EntityTypeField{{Key: "description", Label: "描述", Type: "textarea"}})
	if _, err := tx.Exec("insert into world_entity_types (id, world_id, scope, name, icon, color, base_kind, fields_json, created_at, updated_at) values (?, ?, 'custom', ?, '', '', '', ?, ?, ?)",
		kind, worldID, kind, string(fields), now, now); err != nil {
		return err
	}
	return nil
}

// UpsertEntityTypeInput is the typed input of entityTypes.upsert.
type UpsertEntityTypeInput struct {
	WorldID   string
	TypeID    string
	Name      string
	Icon      string
	Color     string
	BaseKind  string
	Fields    []EntityTypeField
	CreatedBy string
}

// UpsertEntityType creates or overrides an entity type row. Preset ids
// (character/location/...) update the world's builtin copy and mark it as
// overridden (builtin=1 keeps the "derived from preset" provenance); any other
// id creates a world-local custom type. Type rows never enter the Canon.
func (w *WorldStore) UpsertEntityType(input UpsertEntityTypeInput) (WorldEntityType, error) {
	if strings.TrimSpace(input.WorldID) == "" {
		return WorldEntityType{}, worldsError(WorldsErrContextInvalid, "worldId is required")
	}
	if strings.TrimSpace(input.TypeID) == "" {
		return WorldEntityType{}, worldsError(WorldsErrContextInvalid, "type id is required")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = input.TypeID
	}
	if input.Fields == nil {
		input.Fields = []EntityTypeField{}
	}
	db, err := w.database()
	if err != nil {
		return WorldEntityType{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldEntityType{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return WorldEntityType{}, err
	}
	if err := ensurePresetEntityTypesInTx(tx, input.WorldID); err != nil {
		return WorldEntityType{}, err
	}
	fieldsJSON, err := json.Marshal(input.Fields)
	if err != nil {
		return WorldEntityType{}, err
	}
	now := isoTimeNow()
	scope := "custom"
	builtin := 0
	var existsID string
	err = tx.QueryRow("select id from world_entity_types where world_id = ? and id = ?", input.WorldID, input.TypeID).Scan(&existsID)
	if err == nil {
		if _, ok := presetEntityTypeFields[input.TypeID]; ok {
			scope = "builtin"
			builtin = 1
		}
		if _, err := tx.Exec("update world_entity_types set name = ?, icon = ?, color = ?, base_kind = ?, fields_json = ?, scope = ?, builtin = ?, updated_at = ? where world_id = ? and id = ?",
			name, input.Icon, input.Color, input.BaseKind, string(fieldsJSON), scope, builtin, now, input.WorldID, input.TypeID); err != nil {
			return WorldEntityType{}, err
		}
	} else if err == sql.ErrNoRows {
		if _, err := tx.Exec("insert into world_entity_types (id, world_id, scope, name, icon, color, base_kind, fields_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			input.TypeID, input.WorldID, scope, name, input.Icon, input.Color, input.BaseKind, string(fieldsJSON), now, now); err != nil {
			return WorldEntityType{}, err
		}
	} else {
		return WorldEntityType{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldEntityType{}, err
	}
	return w.getEntityType(db, input.WorldID, input.TypeID)
}

// ListEntityTypes returns the world's type directory: seeded builtin presets
// plus world-local custom types, presets first. Read-only, side-effect free.
func (w *WorldStore) ListEntityTypes(worldID string) ([]WorldEntityType, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return nil, err
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := ensurePresetEntityTypesInTx(tx, worldID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, world_id, scope, name, icon, color, base_kind, fields_json, extends_id, builtin, created_at, updated_at from world_entity_types where world_id = ? and archived_at is null order by (scope = 'custom') asc, id", worldID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]WorldEntityType, 0)
	for rows.Next() {
		item, err := scanEntityType(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (w *WorldStore) getEntityType(db *sql.DB, worldID, typeID string) (WorldEntityType, error) {
	row := db.QueryRow("select id, world_id, scope, name, icon, color, base_kind, fields_json, extends_id, builtin, created_at, updated_at from world_entity_types where world_id = ? and id = ? and archived_at is null", worldID, typeID)
	return scanEntityType(row)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanEntityType(row rowScanner) (WorldEntityType, error) {
	var item WorldEntityType
	var fieldsJSON string
	var builtin int
	if err := row.Scan(&item.ID, &item.WorldID, &item.Scope, &item.Name, &item.Icon, &item.Color, &item.BaseKind, &fieldsJSON, &item.ExtendsID, &builtin, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return WorldEntityType{}, err
	}
	item.Builtin = builtin != 0
	item.Fields = []EntityTypeField{}
	if fieldsJSON != "" {
		_ = json.Unmarshal([]byte(fieldsJSON), &item.Fields)
	}
	if item.Fields == nil {
		item.Fields = []EntityTypeField{}
	}
	return item, nil
}

// WorldCanvasElement is one element of a canvas context ('' = global canvas).
// kind='entity' elements project a semantic entity (ref_id = entity id, props
// only carry view preferences); every other kind is a free-expression element
// whose typed content lives in props_json. Canvas never enters the Canon.
type WorldCanvasElement struct {
	ID        string         `json:"id"`
	WorldID   string         `json:"worldId"`
	ContextID string         `json:"contextId,omitempty"`
	Kind      string         `json:"kind"`
	RefKind   string         `json:"refKind,omitempty"`
	RefID     string         `json:"refId,omitempty"`
	Name      string         `json:"name,omitempty"`
	Props     map[string]any `json:"props"`
	Geometry  map[string]any `json:"geometry"`
	Style     map[string]any `json:"style,omitempty"`
	Layer     string         `json:"layer,omitempty"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

// UpsertCanvasElementInput is the typed input of canvas.upsert.
type UpsertCanvasElementInput struct {
	WorldID   string
	ElementID string
	ContextID string
	Kind      string
	RefKind   string
	RefID     string
	Name      string
	Props     map[string]any
	Geometry  map[string]any
	Style     map[string]any
	Layer     string
	CreatedBy string
}

// UpsertCanvasElement writes one canvas element. Element ids mirror the
// front-end shape ids. Entity references are validated against the world; free
// elements carry their own props. No revision is produced: canvas is expression.
func (w *WorldStore) UpsertCanvasElement(input UpsertCanvasElementInput) (WorldCanvasElement, error) {
	if strings.TrimSpace(input.WorldID) == "" {
		return WorldCanvasElement{}, worldsError(WorldsErrContextInvalid, "worldId is required")
	}
	if strings.TrimSpace(input.Kind) == "" {
		return WorldCanvasElement{}, worldsError(WorldsErrContextInvalid, "canvas element kind is required")
	}
	if input.Props == nil {
		input.Props = map[string]any{}
	}
	if input.Geometry == nil {
		input.Geometry = map[string]any{}
	}
	if input.Style == nil {
		input.Style = map[string]any{}
	}
	db, err := w.database()
	if err != nil {
		return WorldCanvasElement{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldCanvasElement{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return WorldCanvasElement{}, err
	}
	if input.RefID != "" && input.RefKind != "" {
		var count int
		if err := tx.QueryRow("select count(*) from world_entities where id = ? and world_id = ? and archived_at is null", input.RefID, input.WorldID).Scan(&count); err != nil {
			return WorldCanvasElement{}, err
		}
		if count == 0 {
			return WorldCanvasElement{}, worldsError(WorldsErrEntityNotFound, "referenced entity does not belong to the world")
		}
	}
	propsJSON, err := json.Marshal(input.Props)
	if err != nil {
		return WorldCanvasElement{}, err
	}
	geometryJSON, err := json.Marshal(input.Geometry)
	if err != nil {
		return WorldCanvasElement{}, err
	}
	styleJSON, err := json.Marshal(input.Style)
	if err != nil {
		return WorldCanvasElement{}, err
	}
	now := isoTimeNow()
	elementID := input.ElementID
	if elementID == "" {
		elementID, err = newID()
		if err != nil {
			return WorldCanvasElement{}, err
		}
	}
	_, err = tx.Exec(`insert into world_canvas (id, world_id, context_id, kind, ref_kind, ref_id, name, props_json, geometry_json, style_json, layer, created_at, updated_at)
		values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		on conflict(world_id, id) do update set context_id = excluded.context_id, kind = excluded.kind, ref_kind = excluded.ref_kind, ref_id = excluded.ref_id,
		name = excluded.name, props_json = excluded.props_json, geometry_json = excluded.geometry_json, style_json = excluded.style_json, layer = excluded.layer, updated_at = excluded.updated_at`,
		elementID, input.WorldID, input.ContextID, input.Kind, input.RefKind, input.RefID, input.Name,
		string(propsJSON), string(geometryJSON), string(styleJSON), input.Layer, now, now)
	if err != nil {
		return WorldCanvasElement{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldCanvasElement{}, err
	}
	return w.getCanvasElement(db, input.WorldID, elementID)
}

// ListCanvasElements returns all canvas elements of one context ('') = global.
func (w *WorldStore) ListCanvasElements(worldID, contextID string) ([]WorldCanvasElement, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, world_id, context_id, kind, ref_kind, ref_id, name, props_json, geometry_json, style_json, layer, created_at, updated_at from world_canvas where world_id = ? and context_id = ? order by layer, created_at", worldID, contextID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]WorldCanvasElement, 0)
	for rows.Next() {
		item, err := scanCanvasElement(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (w *WorldStore) getCanvasElement(db *sql.DB, worldID, elementID string) (WorldCanvasElement, error) {
	row := db.QueryRow("select id, world_id, context_id, kind, ref_kind, ref_id, name, props_json, geometry_json, style_json, layer, created_at, updated_at from world_canvas where world_id = ? and id = ?", worldID, elementID)
	return scanCanvasElement(row)
}

func scanCanvasElement(row rowScanner) (WorldCanvasElement, error) {
	var item WorldCanvasElement
	var propsJSON, geometryJSON, styleJSON string
	if err := row.Scan(&item.ID, &item.WorldID, &item.ContextID, &item.Kind, &item.RefKind, &item.RefID, &item.Name, &propsJSON, &geometryJSON, &styleJSON, &item.Layer, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return WorldCanvasElement{}, err
	}
	item.Props = map[string]any{}
	item.Geometry = map[string]any{}
	item.Style = map[string]any{}
	if propsJSON != "" {
		_ = json.Unmarshal([]byte(propsJSON), &item.Props)
	}
	if geometryJSON != "" {
		_ = json.Unmarshal([]byte(geometryJSON), &item.Geometry)
	}
	if styleJSON != "" {
		_ = json.Unmarshal([]byte(styleJSON), &item.Style)
	}
	return item, nil
}

// DeleteCanvasElement removes a free-expression canvas element (or the visual
// projection of an entity). It never deletes the underlying semantic object.
func (w *WorldStore) DeleteCanvasElement(worldID, elementID, createdBy string) error {
	db, err := w.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, worldID); err != nil {
		return err
	}
	result, err := tx.Exec("delete from world_canvas where world_id = ? and id = ?", worldID, elementID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return worldsError(WorldsErrContextInvalid, "canvas element not found")
	}
	return tx.Commit()
}

// CreateChildEntityInput is the typed input of entities.create_child.
type CreateChildEntityInput struct {
	WorldID            string
	ParentID           string
	ContainerRole      string
	Kind               WorldEntityKind
	Title              string
	Summary            string
	Content            map[string]any
	IsProvisional      bool
	ExpectedRevisionID string
	CreatedBy          string
}

// CreateChildEntity creates an entity inside a parent entity's local context
// (recursive container). It reuses the canonical upsert path and produces a
// revision for canonical children (provisional drafts skip the revision).
func (w *WorldStore) CreateChildEntity(input CreateChildEntityInput) (WorldEntity, error) {
	if strings.TrimSpace(input.ParentID) == "" {
		return WorldEntity{}, worldsError(WorldsErrContextInvalid, "parent entity is required")
	}
	return w.UpsertEntity(UpsertEntityInput{
		WorldID: input.WorldID, Kind: input.Kind, Title: input.Title, Summary: input.Summary,
		Content: input.Content, ParentID: input.ParentID, ContainerRole: input.ContainerRole,
		IsProvisional: input.IsProvisional, ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: input.CreatedBy,
	})
}

// PromoteEntity flips an exploration draft (is_provisional=1) into a canonical
// entity and produces the first revision that freezes it as a fact.
func (w *WorldStore) PromoteEntity(worldID, entityID, expectedRevisionID, createdBy string) (WorldEntity, error) {
	db, err := w.database()
	if err != nil {
		return WorldEntity{}, err
	}
	existing, err := w.getEntity(db, worldID, entityID)
	if err != nil {
		return WorldEntity{}, err
	}
	if !existing.IsProvisional {
		return existing, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldEntity{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, worldID); err != nil {
		return WorldEntity{}, err
	}
	if err := w.checkWorldRevision(tx, worldID, expectedRevisionID); err != nil {
		return WorldEntity{}, err
	}
	now := isoTimeNow()
	if _, err := tx.Exec("update world_entities set is_provisional = 0, updated_at = ? where id = ? and world_id = ?", now, entityID, worldID); err != nil {
		return WorldEntity{}, err
	}
	if _, err := w.commitRevision(tx, worldID, "entity.promoted", createdBy); err != nil {
		return WorldEntity{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldEntity{}, err
	}
	logWorldEvent("world.entity.promoted", map[string]string{"worldId": worldID, "entityId": entityID})
	return w.getEntity(db, worldID, entityID)
}

// CreateRelationInput is the typed input of relations.create.
type CreateRelationInput struct {
	WorldID            string
	FromEntityID       string
	ToEntityID         string
	RelationType       string
	ScopeEntityID      string
	Metadata           map[string]any
	ExpectedRevisionID string
	CreatedBy          string
}

// CreateRelation writes a directed semantic edge into world_relations.
// ScopeEntityID makes the edge local to an entity's context (never in the
// global Canon); empty scope is a global relation. The edge is the only source
// of truth for the canvas binding projection.
func (w *WorldStore) CreateRelation(input CreateRelationInput) (WorldEntityRelation, error) {
	if strings.TrimSpace(input.WorldID) == "" {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "worldId is required")
	}
	if strings.TrimSpace(input.FromEntityID) == "" || strings.TrimSpace(input.ToEntityID) == "" {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "relation needs from and to entities")
	}
	if strings.TrimSpace(input.RelationType) == "" {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "relation type is required")
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	db, err := w.database()
	if err != nil {
		return WorldEntityRelation{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldEntityRelation{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return WorldEntityRelation{}, err
	}
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return WorldEntityRelation{}, err
	}
	for _, entityID := range []string{input.FromEntityID, input.ToEntityID, input.ScopeEntityID} {
		if entityID == "" {
			continue
		}
		var count int
		if err := tx.QueryRow("select count(*) from world_entities where id = ? and world_id = ? and archived_at is null", entityID, input.WorldID).Scan(&count); err != nil {
			return WorldEntityRelation{}, err
		}
		if count == 0 {
			return WorldEntityRelation{}, worldsError(WorldsErrEntityNotFound, "relation endpoint does not belong to the world")
		}
	}
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return WorldEntityRelation{}, err
	}
	relationID, err := newID()
	if err != nil {
		return WorldEntityRelation{}, err
	}
	now := isoTimeNow()
	if _, err := tx.Exec("insert into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json, scope_entity_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
		relationID, input.WorldID, input.FromEntityID, input.ToEntityID, input.RelationType, string(metadataJSON), nullIfEmpty(input.ScopeEntityID), now); err != nil {
		return WorldEntityRelation{}, err
	}
	if _, err := w.commitRevision(tx, input.WorldID, "relation.created", input.CreatedBy); err != nil {
		return WorldEntityRelation{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldEntityRelation{}, err
	}
	logWorldEvent("world.relation.created", map[string]string{"worldId": input.WorldID, "relationId": relationID})
	return WorldEntityRelation{ID: relationID, Type: input.RelationType, FromEntityID: input.FromEntityID, ToEntityID: input.ToEntityID, ScopeEntityID: input.ScopeEntityID}, nil
}

// ListRelations returns the relations of one entity: global relations touching
// it plus relations scoped to that entity's local context (RFC §5.2).
func (w *WorldStore) ListRelations(worldID, entityID string) ([]WorldEntityRelation, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, relation_type, from_entity_id, to_entity_id, scope_entity_id from world_relations where world_id = ? and ((from_entity_id = ? or to_entity_id = ?) or scope_entity_id = ?) order by created_at", worldID, entityID, entityID, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]WorldEntityRelation, 0)
	for rows.Next() {
		var relation WorldEntityRelation
		var scopeEntityID sql.NullString
		if err := rows.Scan(&relation.ID, &relation.Type, &relation.FromEntityID, &relation.ToEntityID, &scopeEntityID); err != nil {
			return nil, err
		}
		relation.ScopeEntityID = nullStringValue(scopeEntityID)
		items = append(items, relation)
	}
	return items, rows.Err()
}

// DeleteRelation removes a semantic edge and the canvas projection derived
// from it disappears on the next sync. It produces a new revision.
func (w *WorldStore) DeleteRelation(worldID, relationID, expectedRevisionID, createdBy string) error {
	db, err := w.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, worldID); err != nil {
		return err
	}
	if err := w.checkWorldRevision(tx, worldID, expectedRevisionID); err != nil {
		return err
	}
	result, err := tx.Exec("delete from world_relations where id = ? and world_id = ?", relationID, worldID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return worldsError(WorldsErrContextInvalid, "relation not found")
	}
	if _, err := w.commitRevision(tx, worldID, "relation.deleted", createdBy); err != nil {
		return err
	}
	return tx.Commit()
}

// checkParent verifies a parent entity exists inside the world, so container
// children can never cross world boundaries.
func (w *WorldStore) checkParent(tx *sql.Tx, worldID, parentID string) error {
	var count int
	if err := tx.QueryRow("select count(*) from world_entities where id = ? and world_id = ? and archived_at is null", parentID, worldID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return worldsError(WorldsErrEntityNotFound, "parent entity does not belong to the world")
	}
	return nil
}

func (w *WorldStore) listChildren(db *sql.DB, worldID, parentID string) ([]WorldEntitySummary, error) {
	rows, err := db.Query("select id, kind, title, summary, parent_id, container_role, is_provisional, updated_at from world_entities where world_id = ? and parent_id = ? and archived_at is null order by updated_at desc", worldID, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]WorldEntitySummary, 0)
	for rows.Next() {
		var item WorldEntitySummary
		var containerRole sql.NullString
		var provisional int
		item.WorldID = worldID
		item.ParentID = parentID
		if err := rows.Scan(&item.ID, &item.Kind, &item.Title, &item.Summary, &item.ParentID, &containerRole, &provisional, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.ContainerRole = nullStringValue(containerRole)
		item.IsProvisional = provisional != 0
		items = append(items, item)
	}
	return items, rows.Err()
}

// PromoteCanvasElementInput is the typed input of canvas.promote.
type PromoteCanvasElementInput struct {
	WorldID            string
	ElementID          string
	Kind               string // optional; used when a note becomes an entity
	RelationType       string // optional; used when an arrow becomes a relation
	Title              string // optional; overrides the derived note title
	ExpectedRevisionID string
	CreatedBy          string
}

// PromoteCanvasElement lifts a free-expression canvas element into a canonical
// semantic object and produces a revision. A note/text element becomes an
// entity (its canvas element stays behind as the projection); an arrow between
// two entity elements becomes a world_relations edge. Promote is an explicit,
// user-confirmed action.
func (w *WorldStore) PromoteCanvasElement(input PromoteCanvasElementInput) (map[string]any, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	element, err := w.getCanvasElement(db, input.WorldID, input.ElementID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, worldsError(WorldsErrContextInvalid, "canvas element not found")
		}
		return nil, err
	}
	switch element.Kind {
	case "note", "text":
		return w.promoteNoteToEntity(db, element, input)
	case "arrow":
		return w.promoteArrowToRelation(db, element, input)
	default:
		return nil, worldsError(WorldsErrContextInvalid, fmt.Sprintf("canvas element kind %q cannot be promoted", element.Kind))
	}
}

func (w *WorldStore) promoteNoteToEntity(db *sql.DB, element WorldCanvasElement, input PromoteCanvasElementInput) (map[string]any, error) {
	text := stringProp(element.Props, "text")
	if strings.TrimSpace(text) == "" {
		text = stringProp(element.Props, "title")
	}
	kind := strings.TrimSpace(input.Kind)
	if kind == "" {
		kind = strings.TrimSpace(stringProp(element.Props, "kind"))
	}
	if kind == "" {
		kind = "reference"
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = strings.TrimSpace(text)
		if title == "" {
			title = element.Name
		}
	}
	if len(title) > 120 {
		title = title[:120]
	}
	if title == "" {
		title = "便签"
	}
	entity, err := w.UpsertEntity(UpsertEntityInput{
		WorldID: input.WorldID, Kind: WorldEntityKind(kind), Title: title,
		Content: map[string]any{"body": text},
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: input.CreatedBy,
	})
	if err != nil {
		return nil, err
	}
	// Keep the canvas element as the projection, now bound to the entity.
	if _, err := w.UpsertCanvasElement(UpsertCanvasElementInput{
		WorldID: input.WorldID, ElementID: element.ID, ContextID: element.ContextID, Kind: "entity",
		RefKind: "entity", RefID: entity.ID, Name: entity.Title,
		Props: element.Props, Geometry: element.Geometry, Style: element.Style, Layer: element.Layer, CreatedBy: input.CreatedBy,
	}); err != nil {
		return nil, err
	}
	logWorldEvent("world.canvas.promoted", map[string]string{"worldId": input.WorldID, "elementId": element.ID, "entityId": entity.ID})
	return map[string]any{"promoted": "entity", "entity": entity}, nil
}

func (w *WorldStore) promoteArrowToRelation(db *sql.DB, element WorldCanvasElement, input PromoteCanvasElementInput) (map[string]any, error) {
	fromID := stringProp(element.Props, "fromElementId")
	toID := stringProp(element.Props, "toElementId")
	if fromID == "" || toID == "" {
		return nil, worldsError(WorldsErrContextInvalid, "arrow needs from and to element references")
	}
	from, err := w.getCanvasElement(db, input.WorldID, fromID)
	if err != nil {
		return nil, worldsError(WorldsErrContextInvalid, "arrow source element not found")
	}
	to, err := w.getCanvasElement(db, input.WorldID, toID)
	if err != nil {
		return nil, worldsError(WorldsErrContextInvalid, "arrow target element not found")
	}
	if from.Kind != "entity" || from.RefID == "" || to.Kind != "entity" || to.RefID == "" {
		return nil, worldsError(WorldsErrContextInvalid, "arrow endpoints must be entity elements")
	}
	relationType := strings.TrimSpace(input.RelationType)
	if relationType == "" {
		relationType = strings.TrimSpace(stringProp(element.Props, "relationType"))
	}
	if relationType == "" {
		relationType = "references"
	}
	relation, err := w.CreateRelation(CreateRelationInput{
		WorldID: input.WorldID, FromEntityID: from.RefID, ToEntityID: to.RefID,
		RelationType: relationType, ScopeEntityID: element.ContextID,
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: input.CreatedBy,
	})
	if err != nil {
		return nil, err
	}
	// The arrow stays as a canvas draft; the canonical edge is the source of
	// truth and the front-end renders it as a binding projection.
	logWorldEvent("world.canvas.promoted", map[string]string{"worldId": input.WorldID, "elementId": element.ID, "relationId": relation.ID})
	return map[string]any{"promoted": "relation", "relation": relation}, nil
}

func stringProp(props map[string]any, key string) string {
	value, _ := props[key].(string)
	return value
}

// nullStringValue flattens a nullable column into its empty string form.
func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

// isoTimeNow mirrors the project-level iso() helper for canvas/type timestamps.
func isoTimeNow() string {
	return iso(time.Now().UTC())
}