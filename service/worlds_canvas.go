/*
 * [INPUT]: 依赖 WorldStore 的 worlds/world_entities/world_relations 表、world_canvases 文档表（存储真相在
 * worlds_canvas_doc.go，本文件的元素级 API 是文档存储上的适配层）、既有受控词表与 commitRevision 协议
 * [OUTPUT]: 对外提供 Recursive World Canvas 的能力面：受控关系词表、可扩展 entity type 目录（预设 seed + 自定义
 * 自动创建）、world_canvas 元素读写（entity 骨干 + 自由元素，元素本身不产 revision；attr/media 元素绑定实体时
 * 会同步写回 entity.attrs，产出一次实体 revision；arrow/link 是语义边，出发点必须是 entity 元素）、递归容器
 * （create_child/promote）与局部子图关系（scope_entity_id）。箭头提升按终点分派：
 * entity→entity 成关系绑定（world_relations），entity→自由元素成属性绑定（attr 锚点 + 引用投影，值与右侧属性
 * 面板共享 entity.content 单一数据源（面板为准：面板编辑经 UpsertEntity 回刷 attr 投影，画布可创建/更新但无法删除））。
 * attr/media 元素写画布时同步写回 entity.attrs，两种关联模型都认：refId+field+value 锚点，或 edgeType=attr 属性边
 * 按 fromElementId 解析实体 + label 映射 schema 字段/保留字段（简介→intro、正文→detail）——AI 只画布不碰实体也能
 * 在右侧属性面板看到属性（见 syncCanvasAttrElement）。
 * 关系支持原位更新（UpdateRelation：类型/方向 patch，保留 id 与画布锚点）。语义真相只落在 world_entities +
 * world_relations；画布/类型是表达层，不进 Canon
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
	"reflect"
	"strings"
	"time"
)

// WorldRelationSpec is one entry of the controlled relation vocabulary.
type WorldRelationSpec struct {
	LabelZh string `json:"labelZh"`
	Group   string `json:"group"`
	// ToLabelZh is the preset label for the opposite end (father ↔ child). The
	// storage keeps a single edge with an optional inline toRole; this only
	// drives the UI's one-click fill of both ends (RFC 2026-09-20 §2.2).
	ToLabelZh string `json:"inverseLabelZh,omitempty"`
}

// worldRelationTypes is the built-in read-only relation directory (RFC §5.3):
// relation_type stays open for free extension, but UI prefers these entries so
// the graph stays readable. Groups mirror the user draft: people/world/video/story.
// The map key is the fromRole token; ToLabelZh (when present) is the preset
// toRole label for a one-click two-end fill.
var worldRelationTypes = map[string]WorldRelationSpec{
	"father":       {LabelZh: "父亲", Group: "people", ToLabelZh: "子女"},
	"mother":       {LabelZh: "母亲", Group: "people", ToLabelZh: "子女"},
	"child":        {LabelZh: "子女", Group: "people", ToLabelZh: "父母"},
	"spouse":       {LabelZh: "配偶", Group: "people"},
	"partner":      {LabelZh: "伴侣", Group: "people"},
	"friend":       {LabelZh: "朋友", Group: "people"},
	"teacher":      {LabelZh: "老师", Group: "people", ToLabelZh: "学生"},
	"student":      {LabelZh: "学生", Group: "people", ToLabelZh: "老师"},
	"colleague":    {LabelZh: "同事", Group: "people"},
	"enemy":        {LabelZh: "敌人", Group: "people"},
	"belongs_to":   {LabelZh: "属于", Group: "world", ToLabelZh: "拥有"},
	"located_in":   {LabelZh: "位于", Group: "world", ToLabelZh: "包含"},
	"owns":         {LabelZh: "拥有", Group: "world", ToLabelZh: "属于"},
	"contains":     {LabelZh: "包含", Group: "world", ToLabelZh: "位于"},
	"created_by":   {LabelZh: "由…创作", Group: "world"},
	"appears_in":   {LabelZh: "出现在", Group: "video"},
	"followed_by":  {LabelZh: "接续", Group: "video", ToLabelZh: "先于"},
	"precedes":     {LabelZh: "先于", Group: "video", ToLabelZh: "接续"},
	"adapted_from": {LabelZh: "改编自", Group: "story"},
	"causes":       {LabelZh: "导致", Group: "story"},
	"references":   {LabelZh: "引用", Group: "story"},
	"depends_on":   {LabelZh: "依赖", Group: "story"},
	"part_of":      {LabelZh: "属于一部分", Group: "story"},
	// 生产层结构链（生产层 RFC D8）：父→子。作品的 tree 由这条 link 单源表达，
	// parentId 只是通用归属（文件夹），不参与建树；环由解析端处理。
	"has_script": {LabelZh: "包含脚本", Group: "production", ToLabelZh: "属于作品"},
	"has_scene":  {LabelZh: "包含场次", Group: "production", ToLabelZh: "属于脚本"},
	"has_shot":   {LabelZh: "包含镜头", Group: "production", ToLabelZh: "属于场次"},
}

// productionRelationRoles are the structural link roles of the production chain
// (作品→视频脚本→场次→镜头), stored as normal entity→entity relations. They are
// the single source of truth for the production tree; `parentId` is only a
// generic location (folder), never gated by type.
var productionRelationRoles = map[string]bool{"has_script": true, "has_scene": true, "has_shot": true}

// productionLinkRoleFor maps a production child type to the structural role a
// parent→child link carries (script→has_script / scene→has_scene / shot→has_shot).
// Non-production types return "".
func productionLinkRoleFor(childTypeID string) string {
	switch childTypeID {
	case "script":
		return "has_script"
	case "scene":
		return "has_scene"
	case "shot":
		return "has_shot"
	}
	return ""
}

// materializeProductionLinkTx records the structural link of the production
// chain (作品→视频脚本→场次→镜头) when a production entity is created under
// another production entity. That link — not `parentId` — is the single source
// of truth for the production tree (生产层 RFC D8); `parentId` stays only a
// generic location (folder). Idempotent via unique(world_id, from, to, type);
// provisional mirrors the entity so a plan draft link stays out of the Canon
// and produces no revision.
func materializeProductionLinkTx(tx *sql.Tx, worldID, parentID, childEntityID, childTypeID string, provisional bool) error {
	role := productionLinkRoleFor(childTypeID)
	if role == "" || strings.TrimSpace(parentID) == "" || strings.TrimSpace(childEntityID) == "" {
		return nil
	}
	var parentType string
	if err := tx.QueryRow("select coalesce(nullif(type_id, ''), kind) from world_entities where id = ? and world_id = ? and archived_at is null", parentID, worldID).Scan(&parentType); err != nil {
		return err
	}
	if !productionNodeTypes[parentType] {
		return nil
	}
	relationID, err := newID()
	if err != nil {
		return err
	}
	flag := 0
	if provisional {
		flag = 1
	}
	_, err = tx.Exec("insert or ignore into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, to_role, metadata_json, is_provisional, created_at) values (?, ?, ?, ?, ?, '', '{}', ?, ?)",
		relationID, worldID, parentID, childEntityID, role, flag, isoTimeNow())
	return err
}

// ListWorldRelationTypes returns the controlled vocabulary as a stable list.
func ListWorldRelationTypes() []map[string]any {
	groups := []string{"people", "world", "video", "story", "production"}
	items := make([]map[string]any, 0, len(worldRelationTypes))
	for _, group := range groups {
		for id, spec := range worldRelationTypes {
			if spec.Group != group {
				continue
			}
			item := map[string]any{"id": id, "labelZh": spec.LabelZh, "group": spec.Group}
			if spec.ToLabelZh != "" {
				item["inverseLabelZh"] = spec.ToLabelZh
			}
			items = append(items, item)
		}
	}
	return items
}

// WorldEntityType is one row of the entity type directory: a type is the schema,
// an entity is its instance. Custom types live per-world; presets are copied in
// as builtin rows and can be overridden in place (RFC §5.4).
type WorldEntityType struct {
	ID       string            `json:"id"`
	WorldID  string            `json:"worldId"`
	Scope    string            `json:"scope"` // preset | builtin | custom
	Name     string            `json:"name"`
	Icon     string            `json:"icon,omitempty"`
	Color    string            `json:"color,omitempty"`
	BaseKind string            `json:"baseKind,omitempty"`
	Fields   []EntityTypeField `json:"fields"`
	// ChildTypes declares (advisory) which child types a node of this type may
	// contain — the machine-readable production shape (作品→场次→镜头). Empty
	// means "no declaration"; containment truth stays `parentId`.
	ChildTypes []string `json:"childTypes,omitempty"`
	ExtendsID  string   `json:"extendsId,omitempty"`
	Builtin    bool     `json:"builtin"`
	CreatedAt  string   `json:"createdAt"`
	UpdatedAt  string   `json:"updatedAt"`
}

// EntityTypeField is one field schema entry inside a type's fields_json.
type EntityTypeField struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Type        string   `json:"type"` // text | textarea | number | boolean | select | media
	Required    bool     `json:"required,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
	Options     []string `json:"options,omitempty"`
	Invariant   bool     `json:"invariant,omitempty"`
	// Locked pins the attr structure (label/type/removal): preset fields are
	// locked, user-added fields are not. Value stays user-editable either way.
	Locked bool              `json:"locked,omitempty"`
	I18n   map[string]string `json:"i18n,omitempty"`
}

// presetEntityTypeFields returns the preset field schemas. Preset fields are
// locked (structure pinned) except the explicit background field, which every
// preset carries unlocked: when set it overrides the entity card's default
// media-attrs carousel background (RFC 统一 Entity 模型 §背景).
//
// The default set is deliberately minimal, accurate and runnable (生产层 RFC §5):
// 谁(character) / 在哪(location) / 拍什么(script). Everything else is the user's
// to add:
//   - `reference` retired earlier (media attrs cover it);
//   - `rule` → world-level `identity.constraints` (always/never/prefer);
//   - `style` → world-level `identity.style` (one world = one STYLE LOCK);
//   - `story` → merged into `script` (script is the superset: logline + beats
//     already carry the narrative core, plus the producible spec);
//   - `object` → not seeded (key props are a common but optional extension).
var presetEntityTypeFields = map[string][]EntityTypeField{
	// 作品 = 交付单位：只承载**成片**（按需 media 属性，label「成片」）+ 子节点聚合；
	// 交付规格（平台/画幅/时长）留在脚本上（决定 2026-10-02）。
	"work": {
		{Key: "background", Label: "背景", Type: "media"},
	},
	"character": {
		{Key: "appearance", Label: "外貌与标志", Type: "textarea", Locked: true},
		{Key: "personality", Label: "性格", Type: "textarea", Locked: true},
		{Key: "voice", Label: "声音与说话方式", Type: "textarea", Locked: true},
		{Key: "voice_reference", Label: "声线参考", Type: "media", Options: []string{"audio"}, Locked: true},
		{Key: "invariants", Label: "不可变特征", Type: "textarea", Invariant: true, Locked: true},
		{Key: "background", Label: "背景", Type: "media"},
	},
	"location": {
		{Key: "description", Label: "描述", Type: "textarea", Locked: true},
		{Key: "atmosphere", Label: "氛围", Type: "textarea", Locked: true},
		{Key: "background", Label: "背景", Type: "media"},
	},
	// 道具 = 现实制作里必备的锚点实体（关键道具跨镜一致）：描述 + 外观标志
	// （颜色/材质/边角特征，连续性关键）+ 道具参考图（declared role=prop）。
	"prop": {
		{Key: "description", Label: "描述", Type: "textarea", Locked: true},
		{Key: "appearance", Label: "外观与标志", Type: "textarea", Locked: true},
		{Key: "prop_reference", Label: "道具参考图", Type: "media", Options: []string{"image"}, Locked: true},
		{Key: "background", Label: "背景", Type: "media"},
	},
	"script": {
		{Key: "logline", Label: "一句话概括", Type: "text", Locked: true},
		{Key: "beats", Label: "节拍 / 叙事结构", Type: "textarea", Locked: true},
		{Key: "vo", Label: "口播 / 旁白", Type: "textarea", Locked: true},
		{Key: "durationSec", Label: "目标时长（秒）", Type: "number", Locked: true},
		{Key: "aspectRatio", Label: "画幅", Type: "select", Options: []string{"9:16", "16:9", "1:1", "4:5"}, Locked: true},
		{Key: "platform", Label: "目标平台", Type: "text", Locked: true},
		{Key: "storyboard", Label: "分镜表", Type: "media", Locked: true},
		{Key: "background", Label: "背景", Type: "media"},
	},
}

// presetEntityTypeOrder is the seed order for the preset directory.
var presetEntityTypeOrder = []string{"work", "character", "location", "prop", "script"}

// presetEntityTypeNames maps a preset id to its zh display name. `character`
// reads as 角色 (not 人物) so it covers animals / creatures too; `prop` (道具) is
// the anchor a real production needs for cross-shot object consistency.
var presetEntityTypeNames = map[string]string{
	"work": "作品", "character": "角色", "location": "场景", "prop": "道具", "script": "视频脚本",
}

// retiredPresetEntityTypes are preset ids that used to be seeded but are no
// longer part of the default set. Their unused builtin rows are archived; a
// world that still holds entities of the type keeps the row readable.
var retiredPresetEntityTypes = []string{"reference", "object", "story", "style", "rule"}

// productionEntityTypeFields defines the structured objects of the PRODUCTION
// layer (生产层 RFC §6): 场次(scene) → 镜头(shot) → 每镜产物. They are
// deliberately NOT part of the default preset directory (D6): a fresh world's
// create menu stays the minimal three. They are seeded on FIRST USE, so the
// production structure hangs under a work without inflating the presets.
//
// 谁/在哪/拍什么 are world facts (entities); 场次/镜头 are the production
// structure built on top of them. Their base_kind stays empty on purpose: the
// CreationContext buckets are world anchors, and production objects must not
// leak into `facts`.
var productionEntityTypeFields = map[string][]EntityTypeField{
	"scene": {
		{Key: "summary", Label: "一句话概括", Type: "text", Locked: true},
		{Key: "beats", Label: "节拍", Type: "textarea", Locked: true},
		{Key: "emotion", Label: "情绪", Type: "textarea", Locked: true},
		{Key: "durationSec", Label: "目标时长（秒）", Type: "number", Locked: true},
		{Key: "background", Label: "背景", Type: "media"},
	},
	"shot": {
		{Key: "no", Label: "镜号", Type: "text", Locked: true},
		{Key: "shotSize", Label: "景别 / 角度 / 焦段", Type: "text", Locked: true},
		{Key: "durationSec", Label: "时长（秒）", Type: "number", Locked: true},
		{Key: "camera", Label: "镜头运动", Type: "text", Locked: true},
		{Key: "dialogue", Label: "台词 / 旁白", Type: "textarea", Locked: true},
		{Key: "background", Label: "背景", Type: "media"},
		// NOTE: 产物（关键帧 / 首帧 / 尾帧 / 片段 / 配音）**不设固定槽位**。
		// 镜头不是「首尾帧模式」——生成关系至少有三类（参考驱动 / 首尾帧 / 文生），
		// 实测绝大多数镜头是参考驱动（liblib：90 镜里 89 个 mixed2video）。
		// 所以产物是**按需添加的普通 media 属性**，用 label 标角色；生成方式记在
		// 产物资产自己的 metadata.proposal（model/modeType/params/references）。
	},
}

// productionEntityTypeNames maps a production type id to its zh display name.
var productionEntityTypeNames = map[string]string{"scene": "场次", "shot": "镜头"}

// entityTypeChildTypes declares, per type, the child types a node may contain —
// the machine-readable shape of the production hierarchy (生产层 RFC §5/§6):
// 作品(work) → 视频脚本(script) → 场次(scene) → 镜头(shot). Agents read it
// straight from entityTypes.list, so the tree shape never has to live only in
// skill prose.
//
// It is ADVISORY, not a gate: containment truth is still `parentId`, and any
// entity may still be a container (递归世界画布 RFC「没有容器类型」). A script
// may also hold a shot directly (one-scene pieces), so the list is permissive.
// Kept as a code constant exactly like the controlled relation vocabulary.
var entityTypeChildTypes = map[string][]string{
	"work":   {"script"},
	"script": {"scene", "shot"},
	"scene":  {"shot"},
	"shot":   {},
}

// childTypesFor returns a type's declared child types (advisory; empty = none
// declared, e.g. custom types and leaf types).
func childTypesFor(typeID string) []string {
	if types, ok := entityTypeChildTypes[typeID]; ok {
		return types
	}
	return nil
}

// ensurePresetEntityTypesInTx lazily seeds the preset directory rows into a
// world as scope='builtin' copies the first time the world's type surface is
// touched. Idempotent: missing rows (e.g. a preset added after a world was
// first seeded) are inserted; rows the world already carries are upgraded in
// place so a new preset field (locked flags, background) reaches old worlds
// without touching user-added custom fields.
func ensurePresetEntityTypesInTx(tx *sql.Tx, worldID string) error {
	now := isoTimeNow()
	for _, id := range presetEntityTypeOrder {
		var fieldsJSON string
		var scope string
		err := tx.QueryRow("select scope, fields_json from world_entity_types where world_id = ? and id = ?", worldID, id).Scan(&scope, &fieldsJSON)
		presetFields := presetEntityTypeFields[id]
		if err == sql.ErrNoRows {
			encoded, err := json.Marshal(presetFields)
			if err != nil {
				return err
			}
			if _, err := tx.Exec("insert into world_entity_types (id, world_id, scope, name, icon, color, base_kind, fields_json, builtin, created_at, updated_at) values (?, ?, 'builtin', ?, '', '', ?, ?, 1, ?, ?)",
				id, worldID, presetEntityTypeNames[id], baseKindForPreset(id), string(encoded), now, now); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		// Idempotent upgrade of an existing builtin row: merge preset locked
		// flags into existing fields by key and append preset fields the row
		// does not carry yet (e.g. background). Custom rows are never touched.
		if scope != "builtin" {
			continue
		}
		existing := []EntityTypeField{}
		if fieldsJSON != "" {
			_ = json.Unmarshal([]byte(fieldsJSON), &existing)
		}
		byKey := map[string]*EntityTypeField{}
		for index := range existing {
			byKey[existing[index].Key] = &existing[index]
		}
		changed := false
		for _, preset := range presetFields {
			if field, ok := byKey[preset.Key]; ok {
				if field.Locked != preset.Locked || field.Label != preset.Label {
					field.Locked = preset.Locked
					field.Label = preset.Label
					changed = true
				}
				continue
			}
			appended := preset
			existing = append(existing, appended)
			byKey[preset.Key] = &existing[len(existing)-1]
			changed = true
		}
		if !changed {
			continue
		}
		encoded, err := json.Marshal(existing)
		if err != nil {
			return err
		}
		if _, err := tx.Exec("update world_entity_types set fields_json = ?, updated_at = ? where world_id = ? and id = ?", string(encoded), now, worldID, id); err != nil {
			return err
		}
	}
	// Retired presets are archived when unused: `reference` (media attrs cover
	// it), `rule`/`style` (moved to world-level `identity.constraints` /
	// `identity.style`), `story` (merged into `script`), `object` (optional).
	// A world that still holds entities of a retired type keeps the row readable.
	for _, retired := range retiredPresetEntityTypes {
		if _, err := tx.Exec("update world_entity_types set archived_at = ?, updated_at = ? where world_id = ? and id = ? and scope = 'builtin' and archived_at is null and not exists (select 1 from world_entities where world_id = ? and (kind = ? or type_id = ?) and archived_at is null)",
			now, now, worldID, retired, worldID, retired, retired); err != nil {
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
func (w *WorldStore) ensureEntityType(tx *sql.Tx, worldID, typeID string) error {
	return ensureEntityTypeInTx(tx, worldID, typeID)
}

// ensureEntityTypeInTx makes sure the given type id resolves inside the world's
// type directory. Preset ids get their seeded builtin row; unknown ids
// auto-create a minimal custom type (name + description) so canvas creation
// never blocks on a missing schema (RFC §5.4 "type 成本极低").
func ensureEntityTypeInTx(tx *sql.Tx, worldID, typeID string) error {
	if typeID == "" {
		return nil
	}
	if err := ensurePresetEntityTypesInTx(tx, worldID); err != nil {
		return err
	}
	var id string
	err := tx.QueryRow("select id from world_entity_types where world_id = ? and id = ? and archived_at is null", worldID, typeID).Scan(&id)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	now := isoTimeNow()
	// Production objects (场次 / 镜头) are structured but not presets: seed their
	// real field schema on first use so they never appear in a fresh world's
	// create menu (D6), yet still carry 镜号/景别/首尾帧/片段/配音 fields.
	if fields, ok := productionEntityTypeFields[typeID]; ok {
		encoded, err := json.Marshal(fields)
		if err != nil {
			return err
		}
		if _, err := tx.Exec("insert into world_entity_types (id, world_id, scope, name, icon, color, base_kind, fields_json, builtin, created_at, updated_at) values (?, ?, 'builtin', ?, '', '', '', ?, 0, ?, ?)",
			typeID, worldID, productionEntityTypeNames[typeID], string(encoded), now, now); err != nil {
			return err
		}
		return nil
	}
	fields, _ := json.Marshal([]EntityTypeField{{Key: "description", Label: "描述", Type: "textarea"}})
	if _, err := tx.Exec("insert into world_entity_types (id, world_id, scope, name, icon, color, base_kind, fields_json, created_at, updated_at) values (?, ?, 'custom', ?, '', '', '', ?, ?, ?)",
		typeID, worldID, typeID, string(fields), now, now); err != nil {
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
		item.ChildTypes = childTypesFor(item.ID)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (w *WorldStore) getEntityType(db *sql.DB, worldID, typeID string) (WorldEntityType, error) {
	row := db.QueryRow("select id, world_id, scope, name, icon, color, base_kind, fields_json, extends_id, builtin, created_at, updated_at from world_entity_types where world_id = ? and id = ? and archived_at is null", worldID, typeID)
	item, err := scanEntityType(row)
	if err != nil {
		return WorldEntityType{}, err
	}
	item.ChildTypes = childTypesFor(item.ID)
	return item, nil
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

// WorldCanvasElement is one element of a canvas context (” = global canvas).
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

// validateCanvasLinkStart enforces that a canvas link/arrow starts from an
// entity element. Arrows drawn from free elements are rejected: edges carry
// semantics, so the start point must be a semantic subject.
func validateCanvasLinkStart(tx *sql.Tx, worldID string, props map[string]any) error {
	fromID := stringProp(props, "fromElementId")
	if strings.TrimSpace(fromID) == "" {
		return worldsError(WorldsErrContextInvalid, "link needs a fromElementId start point")
	}
	var kind string
	var refID string
	err := tx.QueryRow("select kind, ref_id from world_canvas where world_id = ? and id = ?", worldID, fromID).Scan(&kind, &refID)
	if err == sql.ErrNoRows {
		return worldsError(WorldsErrContextInvalid, "link start element not found")
	}
	if err != nil {
		return err
	}
	if kind != "entity" || refID == "" {
		return worldsError(WorldsErrContextInvalid, "only entity elements can be a link start point")
	}
	return nil
}

// syncAttrElementValue writes a canvas-edited property value back into the
// bound entity's attrs. Empty values are ignored on purpose: deletion of an
// entity property is reserved for the right property panel.
func (w *WorldStore) syncAttrElementValue(worldID, entityID string, props map[string]any) error {
	field := strings.TrimSpace(stringProp(props, "field"))
	value, hasValue := props["value"]
	if field == "" || !hasValue {
		return nil
	}
	if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
		return nil
	}
	db, err := w.database()
	if err != nil {
		return err
	}
	entity, err := w.getEntity(db, worldID, entityID)
	if err != nil {
		return err
	}
	// Values can be objects now (media attrs are {assetId,...}), and `==` panics
	// on uncomparable types like maps — compare deeply instead.
	if existing, ok := attrValueMap(entity.Attrs)[field]; ok && reflect.DeepEqual(existing, value) {
		return nil
	}
	_, err = w.UpsertEntity(UpsertEntityInput{
		WorldID: worldID, EntityID: entityID, Name: entity.Name,
		Intro: entity.Intro, Detail: entity.Detail, Attrs: patchEntityAttr(entity.Attrs, field, value),
		CreatedBy: "canvas",
	})
	return err
}

// canvasAttrSyncTargets returns the doc element ids whose bound entity attrs
// must be re-synced after writing element: the element itself when it is an
// attr/media value holder, plus the attr/media node an attribute edge points
// to (so building the edge after the node still syncs it).
func canvasAttrSyncTargets(element WorldCanvasElement) []string {
	if element.Kind == "attr" || element.Kind == "media" {
		return []string{element.ID}
	}
	if element.Kind != "arrow" {
		return nil
	}
	if edgeType := strings.TrimSpace(stringProp(element.Props, "edgeType")); edgeType != "" && edgeType != "attr" {
		return nil
	}
	if toID := strings.TrimSpace(stringProp(element.Props, "toElementId")); toID != "" {
		return []string{toID}
	}
	return nil
}

// syncCanvasAttrTargets resolves each target id inside a document payload and
// syncs its bound entity attrs. It is best-effort: a missing target is skipped
// and a failed sync is logged, never returned — the canvas document is already
// committed by the time this runs, so a projection side effect must not turn a
// successful canvas write into a reported failure.
func (w *WorldStore) syncCanvasAttrTargets(worldID string, targets []string, elements []WorldCanvasElement) {
	seen := map[string]bool{}
	for _, elementID := range targets {
		if elementID == "" || seen[elementID] {
			continue
		}
		seen[elementID] = true
		element, ok := canvasElementByID(elements, elementID)
		if !ok {
			continue
		}
		if err := w.syncCanvasAttrElement(worldID, element, elements); err != nil {
			logWorldEvent("world.canvas.attr.sync.failed", map[string]string{
				"worldId": worldID, "elementId": element.ID, "code": asWorldsError(err).Code,
			})
		}
	}
}

// syncCanvasAttrElement writes one canvas attr/media element back into its bound
// entity's attrs at the storage layer, so a producer that only authors the
// canvas still lands the property in the right-hand attribute panel. Two
// linkage models are accepted, mirroring the front-end:
//
//   - backend/promote model: the element itself carries refId + props.field +
//     props.value (delegates to syncAttrElementValue).
//   - interactive/AI model: the element is the end of an attr edge
//     (kind=arrow, props.edgeType absent or "attr", props.fromElementId
//     = "shape:<entityId>" or an entity element id, props.toElementId
//     = this element). The label maps to a first-class entity field
//     (简介/正文 → intro/detail) or a type-schema attr key, and the value comes
//     from props.text (text) or props.assetId (media).
//
// Empty text values are ignored on purpose (deletion stays panel-only), and an
// element with no resolvable entity is a no-op so a stray canvas draft never
// fails the write.
func (w *WorldStore) syncCanvasAttrElement(worldID string, element WorldCanvasElement, elements []WorldCanvasElement) error {
	if element.Kind != "attr" && element.Kind != "media" {
		return nil
	}
	if refID := strings.TrimSpace(element.RefID); refID != "" {
		if field := strings.TrimSpace(stringProp(element.Props, "field")); field != "" {
			return w.syncAttrElementValue(worldID, refID, element.Props)
		}
	}
	entityID := attrEdgeEntityID(element, elements)
	if entityID == "" {
		return nil
	}
	return w.syncAttrElementByLabel(worldID, entityID, element)
}

// attrEdgeEntityID resolves the entity an attr/media element is bound to
// through its attr edge: the arrow that ends at this element and starts at an
// entity element ("shape:<entityId>" mirror id or an element id).
func attrEdgeEntityID(element WorldCanvasElement, elements []WorldCanvasElement) string {
	for _, edge := range elements {
		if edge.Kind != "arrow" {
			continue
		}
		if stringProp(edge.Props, "toElementId") != element.ID {
			continue
		}
		if edgeType := strings.TrimSpace(stringProp(edge.Props, "edgeType")); edgeType != "" && edgeType != "attr" {
			continue
		}
		if entityID := resolveEntityIDRef(stringProp(edge.Props, "fromElementId"), elements); entityID != "" {
			return entityID
		}
	}
	return ""
}

// resolveEntityIDRef resolves an edge start reference to an entity id: a
// "shape:<entityId>" mirror id, an entity element's own id, or a bare id.
func resolveEntityIDRef(ref string, elements []WorldCanvasElement) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	if strings.HasPrefix(ref, "shape:") {
		return strings.TrimPrefix(ref, "shape:")
	}
	for _, item := range elements {
		if item.ID == ref {
			if item.Kind == "entity" || item.RefKind == "entity" {
				return strings.TrimSpace(item.RefID)
			}
			return ""
		}
	}
	return ref
}

// syncAttrElementByLabel writes a canvas attr/media element value into its
// entity using the same label→field/key mapping the canvas store applies:
// reserved labels (简介/正文) hit first-class intro/detail, otherwise the label
// resolves to a type-schema field key, else the label itself is the attr key.
func (w *WorldStore) syncAttrElementByLabel(worldID, entityID string, element WorldCanvasElement) error {
	label := strings.TrimSpace(stringProp(element.Props, "label"))
	if label == "" {
		label = strings.TrimPrefix(strings.TrimSpace(element.Name), "属性 · ")
	}
	if label == "" {
		return nil
	}
	db, err := w.database()
	if err != nil {
		return err
	}
	entity, err := w.getEntity(db, worldID, entityID)
	if err != nil {
		return nil // unlinked/stale draft: nothing to sync
	}
	mediaProp := strings.TrimSpace(stringProp(element.Props, "media"))
	if element.Kind == "media" || (mediaProp != "" && mediaProp != "text") {
		return w.syncAttrElementMedia(db, worldID, entity, label, mediaProp, element)
	}
	// Text: reserved labels write the first-class field, others the attr list.
	text := stringProp(element.Props, "text")
	if strings.TrimSpace(text) == "" {
		return nil
	}
	switch entityFieldKeyOfLabel(label) {
	case "intro":
		if entity.Intro == text {
			return nil
		}
		_, err = w.UpsertEntity(UpsertEntityInput{
			WorldID: worldID, EntityID: entity.ID, Name: entity.Name,
			Intro: text, Detail: entity.Detail, CreatedBy: "canvas",
		})
		return err
	case "detail":
		if entity.Detail == text {
			return nil
		}
		_, err = w.UpsertEntity(UpsertEntityInput{
			WorldID: worldID, EntityID: entity.ID, Name: entity.Name,
			Intro: entity.Intro, Detail: text, CreatedBy: "canvas",
		})
		return err
	}
	key := w.attrKeyForLabel(db, worldID, entity.TypeID, label)
	return w.upsertCanvasEntityAttr(worldID, entity, EntityAttr{Key: key, Label: label, Type: "text", Value: text})
}

// syncAttrElementMedia writes a canvas media element value into the entity's
// media attr. A url-only value cannot be expressed as an entity media attr
// (assetId is required server-side), so it is skipped rather than failing.
func (w *WorldStore) syncAttrElementMedia(db *sql.DB, worldID string, entity WorldEntity, label, mediaProp string, element WorldCanvasElement) error {
	assetID := strings.TrimSpace(stringProp(element.Props, "assetId"))
	if assetID == "" {
		return nil
	}
	kind := mediaProp
	if element.Kind == "media" {
		if modality := strings.TrimSpace(stringProp(element.Props, "modality")); modality != "" {
			kind = modality
		}
	}
	if kind == "" || kind == "text" {
		kind = "image"
	}
	value := map[string]any{"assetId": assetID, "kind": kind}
	name := strings.TrimSpace(stringProp(element.Props, "assetName"))
	if name == "" {
		if raw := strings.TrimSpace(element.Name); !strings.HasPrefix(raw, "属性 · ") {
			name = raw
		}
	}
	if name != "" {
		value["name"] = name
	}
	key := w.attrKeyForLabel(db, worldID, entity.TypeID, label)
	return w.upsertCanvasEntityAttr(worldID, entity, EntityAttr{Key: key, Label: label, Type: "media", Value: value})
}

// upsertCanvasEntityAttr patches one attr onto the entity and commits it
// through the canonical path (name/intro/detail ride along so the update never
// blanks them; the revision is de-duplicated by canonical hash).
func (w *WorldStore) upsertCanvasEntityAttr(worldID string, entity WorldEntity, attr EntityAttr) error {
	_, err := w.UpsertEntity(UpsertEntityInput{
		WorldID: worldID, EntityID: entity.ID, Name: entity.Name,
		Intro: entity.Intro, Detail: entity.Detail,
		Attrs: patchEntityAttrEntry(entity.Attrs, attr), CreatedBy: "canvas",
	})
	return err
}

// patchEntityAttrEntry returns a copy of attrs with one typed attr's value set,
// creating it when the key is new. A locked schema field keeps its pinned
// label/type; only the value moves.
func patchEntityAttrEntry(attrs []EntityAttr, incoming EntityAttr) []EntityAttr {
	result := make([]EntityAttr, 0, len(attrs)+1)
	found := false
	for _, attr := range attrs {
		if attr.Key == incoming.Key {
			attr.Value = incoming.Value
			if !attr.Locked {
				if incoming.Type != "" {
					attr.Type = incoming.Type
				}
				if strings.TrimSpace(attr.Label) == "" {
					attr.Label = incoming.Label
				}
			}
			found = true
		}
		result = append(result, attr)
	}
	if !found {
		if incoming.Label == "" {
			incoming.Label = incoming.Key
		}
		if incoming.Type == "" {
			incoming.Type = "text"
		}
		result = append(result, incoming)
	}
	return result
}

// attrKeyForLabel maps a canvas attr label to the entity type's field key
// (schema labels and keys both match), falling back to the label itself.
func (w *WorldStore) attrKeyForLabel(db *sql.DB, worldID, typeID, label string) string {
	var fieldsJSON string
	if err := db.QueryRow("select fields_json from world_entity_types where world_id = ? and id = ? and archived_at is null", worldID, typeID).Scan(&fieldsJSON); err != nil {
		return label
	}
	var fields []EntityTypeField
	if err := json.Unmarshal([]byte(fieldsJSON), &fields); err != nil {
		return label
	}
	for _, field := range fields {
		fieldLabel := strings.TrimSpace(field.Label)
		if fieldLabel == "" {
			fieldLabel = field.Key
		}
		if fieldLabel == label || field.Key == label {
			return field.Key
		}
	}
	return label
}

// entityFieldKeyOfLabel maps a reserved canvas attr label to a first-class
// entity field (简介/正文 ↔ intro/detail); other labels return "".
func entityFieldKeyOfLabel(label string) string {
	switch strings.TrimSpace(label) {
	case "简介", "介绍", "intro":
		return "intro"
	case "正文", "内容", "正文内容", "detail":
		return "detail"
	}
	return ""
}

// syncAttrProjections is the panel → canvas half of the property-binding sync.
// entity.content is the single shared data source; every attr element bound to
// the entity only holds a reference projection (props.value) that is refreshed
// here after each canonical write. A property removed on the panel side
// (content[field] gone) empties the projection instead of leaving a stale copy.
func (w *WorldStore) syncAttrProjections(worldID, entityID string, content map[string]any) {
	w.syncAttrDocProjections(worldID, entityID, content)
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

// CreateChildEntityInput is the typed input of entities.create_child.
type CreateChildEntityInput struct {
	WorldID            string       `json:"worldId"`
	ParentID           string       `json:"parentId"`
	ContainerRole      string       `json:"containerRole"`
	TypeID             string       `json:"typeId"`
	Name               string       `json:"name"`
	Intro              string       `json:"intro"`
	Detail             string       `json:"detail"`
	Attrs              []EntityAttr `json:"attrs"`
	IsProvisional      bool         `json:"isProvisional"`
	ExpectedRevisionID string       `json:"expectedRevisionId"`
	CreatedBy          string       `json:"createdBy"`
}

// CreateChildEntity creates an entity inside a parent entity's local context
// (recursive container). It reuses the canonical upsert path and produces a
// revision for canonical children (provisional drafts skip the revision).
func (w *WorldStore) CreateChildEntity(input CreateChildEntityInput) (WorldEntity, error) {
	if strings.TrimSpace(input.ParentID) == "" {
		return WorldEntity{}, worldsError(WorldsErrContextInvalid, "parent entity is required")
	}
	return w.UpsertEntity(UpsertEntityInput{
		WorldID: input.WorldID, TypeID: input.TypeID, Name: input.Name, Intro: input.Intro,
		Detail: input.Detail, Attrs: input.Attrs, ParentID: input.ParentID, ContainerRole: input.ContainerRole,
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
	FromRole           string
	ToRole             string
	ScopeEntityID      string
	Metadata           map[string]any
	// IsProvisional creates an exploration draft link: no revision is produced
	// and it stays out of the Canon until it is promoted.
	IsProvisional      bool
	ExpectedRevisionID string
	CreatedBy          string
}

// CreateRelation writes a semantic edge into world_relations. The edge is a
// single record with two optional endpoint roles: FromRole (stored in the
// legacy relation_type column) defaults to "references"; ToRole is empty when
// the opposite end carries no semantics (canvas draws a single arrowhead).
// ScopeEntityID makes the edge local to an entity's context (never in the
// global Canon); empty scope is a global relation.
func (w *WorldStore) CreateRelation(input CreateRelationInput) (WorldEntityRelation, error) {
	if strings.TrimSpace(input.WorldID) == "" {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "worldId is required")
	}
	if strings.TrimSpace(input.FromEntityID) == "" || strings.TrimSpace(input.ToEntityID) == "" {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "relation needs from and to entities")
	}
	input.FromRole = strings.TrimSpace(input.FromRole)
	if input.FromRole == "" {
		input.FromRole = "references"
	}
	input.ToRole = strings.TrimSpace(input.ToRole)
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
	provisional := 0
	if input.IsProvisional {
		provisional = 1
	}
	if _, err := tx.Exec("insert into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, to_role, metadata_json, scope_entity_id, is_provisional, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		relationID, input.WorldID, input.FromEntityID, input.ToEntityID, input.FromRole, input.ToRole, string(metadataJSON), nullIfEmpty(input.ScopeEntityID), provisional, now); err != nil {
		return WorldEntityRelation{}, err
	}
	// Exploration draft links are not facts: only canonical writes produce a revision.
	if !input.IsProvisional {
		if _, err := w.commitRevision(tx, input.WorldID, "relation.created", input.CreatedBy); err != nil {
			return WorldEntityRelation{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return WorldEntityRelation{}, err
	}
	logWorldEvent("world.relation.created", map[string]string{"worldId": input.WorldID, "relationId": relationID})
	return WorldEntityRelation{ID: relationID, FromRole: input.FromRole, ToRole: input.ToRole, FromEntityID: input.FromEntityID, ToEntityID: input.ToEntityID, ScopeEntityID: input.ScopeEntityID, IsProvisional: input.IsProvisional}, nil
}

// UpdateRelationInput is the typed input of relations.update. Empty string
// fields are left unchanged (patch semantics) except ToRole: a nil ToRole
// leaves it unchanged, a pointer to "" clears it (single arrow), any other
// value marks the opposite end. The relation id and scope are preserved so
// canvas anchors (arrow:<relationId>) survive a role or direction edit.
type UpdateRelationInput struct {
	WorldID            string
	RelationID         string
	FromRole           string
	FromEntityID       string
	ToEntityID         string
	ToRole             *string
	ExpectedRevisionID string
	CreatedBy          string
}

// UpdateRelation edits an existing edge in place: the endpoint roles and/or the
// endpoints (direction) can change. It produces a revision only when the Canon
// actually differs. A self-loop or a duplicate of another edge (same
// world/from/to/fromRole) is rejected instead of silently colliding with the
// unique constraint.
func (w *WorldStore) UpdateRelation(input UpdateRelationInput) (WorldEntityRelation, error) {
	if strings.TrimSpace(input.WorldID) == "" {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "worldId is required")
	}
	if strings.TrimSpace(input.RelationID) == "" {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "relationId is required")
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
	current := WorldEntityRelation{ID: input.RelationID}
	var scopeEntityID sql.NullString
	err = tx.QueryRow("select relation_type, to_role, from_entity_id, to_entity_id, scope_entity_id from world_relations where id = ? and world_id = ?", input.RelationID, input.WorldID).
		Scan(&current.FromRole, &current.ToRole, &current.FromEntityID, &current.ToEntityID, &scopeEntityID)
	if errors.Is(err, sql.ErrNoRows) {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "relation not found")
	}
	if err != nil {
		return WorldEntityRelation{}, err
	}
	current.ScopeEntityID = nullStringValue(scopeEntityID)

	next := current
	if value := strings.TrimSpace(input.FromRole); value != "" {
		next.FromRole = value
	}
	if input.ToRole != nil {
		next.ToRole = strings.TrimSpace(*input.ToRole)
	}
	if value := strings.TrimSpace(input.FromEntityID); value != "" {
		next.FromEntityID = value
	}
	if value := strings.TrimSpace(input.ToEntityID); value != "" {
		next.ToEntityID = value
	}
	if next.FromRole == "" {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "relation fromRole is required")
	}
	if next.FromEntityID == next.ToEntityID {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "relation cannot point to itself")
	}
	for _, entityID := range []string{next.FromEntityID, next.ToEntityID, next.ScopeEntityID} {
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
	var duplicate int
	if err := tx.QueryRow("select count(*) from world_relations where world_id = ? and from_entity_id = ? and to_entity_id = ? and relation_type = ? and id <> ?",
		input.WorldID, next.FromEntityID, next.ToEntityID, next.FromRole, input.RelationID).Scan(&duplicate); err != nil {
		return WorldEntityRelation{}, err
	}
	if duplicate > 0 {
		return WorldEntityRelation{}, worldsError(WorldsErrContextInvalid, "an identical relation already exists")
	}
	if _, err := tx.Exec("update world_relations set from_entity_id = ?, to_entity_id = ?, relation_type = ?, to_role = ? where id = ? and world_id = ?",
		next.FromEntityID, next.ToEntityID, next.FromRole, next.ToRole, input.RelationID, input.WorldID); err != nil {
		return WorldEntityRelation{}, err
	}
	if _, err := w.commitRevision(tx, input.WorldID, "relation.updated", input.CreatedBy); err != nil {
		return WorldEntityRelation{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldEntityRelation{}, err
	}
	logWorldEvent("world.relation.updated", map[string]string{"worldId": input.WorldID, "relationId": input.RelationID})
	return next, nil
}

// ListRelations returns the relations of one entity: global relations touching
// it plus relations scoped to that entity's local context (RFC §5.2). Every
// item carries a `direction` projection (out | in | scope) so the UI can phrase
// the bidirectional relation without caring about storage direction.
func (w *WorldStore) ListRelations(worldID, entityID string) ([]WorldEntityRelation, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, relation_type, to_role, from_entity_id, to_entity_id, scope_entity_id, is_provisional from world_relations where world_id = ? and ((from_entity_id = ? or to_entity_id = ?) or scope_entity_id = ?) order by created_at", worldID, entityID, entityID, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]WorldEntityRelation, 0)
	for rows.Next() {
		var relation WorldEntityRelation
		var scopeEntityID sql.NullString
		var provisional int
		if err := rows.Scan(&relation.ID, &relation.FromRole, &relation.ToRole, &relation.FromEntityID, &relation.ToEntityID, &scopeEntityID, &provisional); err != nil {
			return nil, err
		}
		relation.ScopeEntityID = nullStringValue(scopeEntityID)
		relation.IsProvisional = provisional != 0
		switch {
		case relation.ScopeEntityID == entityID && relation.FromEntityID != entityID && relation.ToEntityID != entityID:
			relation.Direction = "scope"
		case relation.FromEntityID == entityID:
			relation.Direction = "out"
		default:
			relation.Direction = "in"
		}
		items = append(items, relation)
	}
	return items, rows.Err()
}

// DeleteRelation soft-deletes a semantic edge by moving it into
// world_relation_tombstones (same id, so entity.restore / relation.restore can
// rebuild it and the shape:rel-<id> canvas anchor re-binds). The projection
// disappears on the next sync. It produces a new revision.
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
	now := iso(time.Now().UTC())
	// 同 id 陈旧墓碑（revert 后可能「墓碑 + 存活」共存）先清，写当前存活行保证最新
	if _, err := tx.Exec("delete from world_relation_tombstones where id = ? and world_id = ?", relationID, worldID); err != nil {
		return err
	}
	result, err := tx.Exec("insert or ignore into world_relation_tombstones (id, world_id, from_entity_id, to_entity_id, relation_type, to_role, metadata_json, scope_entity_id, is_provisional, created_at, archived_at, batch_id) select id, world_id, from_entity_id, to_entity_id, relation_type, to_role, metadata_json, scope_entity_id, is_provisional, created_at, ?, '' from world_relations where id = ? and world_id = ?", now, relationID, worldID)
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
	if _, err := tx.Exec("delete from world_relations where id = ? and world_id = ?", relationID, worldID); err != nil {
		return err
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
	rows, err := db.Query("select id, coalesce(nullif(type_id, ''), kind), title, summary, parent_id, container_role, is_provisional, updated_at from world_entities where world_id = ? and parent_id = ? and archived_at is null order by updated_at desc", worldID, parentID)
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
		if err := rows.Scan(&item.ID, &item.TypeID, &item.Name, &item.Intro, &item.ParentID, &containerRole, &provisional, &item.UpdatedAt); err != nil {
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
	TypeID             string // optional; used when a note becomes an entity
	FromRole           string // optional; used when an arrow becomes a relation
	ToRole             string // optional; opposite-end role (empty = unmarked)
	Field              string // optional; used when an arrow becomes a property binding
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
	elementContext, element, err := w.findCanvasDocElement(db, input.WorldID, input.ElementID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, worldsError(WorldsErrContextInvalid, "canvas element not found")
		}
		return nil, err
	}
	switch element.Kind {
	case "note", "text":
		return w.promoteNoteToEntity(db, elementContext, element, input)
	case "arrow", "link":
		// Edge semantics: entity → entity is a relation binding; entity →
		// free element is a property binding onto the entity's field.
		return w.promoteArrow(db, elementContext, element, input)
	default:
		return nil, worldsError(WorldsErrContextInvalid, fmt.Sprintf("canvas element kind %q cannot be promoted", element.Kind))
	}
}

func (w *WorldStore) promoteNoteToEntity(db *sql.DB, elementContext string, element WorldCanvasElement, input PromoteCanvasElementInput) (map[string]any, error) {
	text := stringProp(element.Props, "text")
	if strings.TrimSpace(text) == "" {
		text = stringProp(element.Props, "title")
	}
	typeID := strings.TrimSpace(input.TypeID)
	if typeID == "" {
		typeID = strings.TrimSpace(stringProp(element.Props, "typeId"))
	}
	if typeID == "" {
		typeID = EntityTypeObject
	}
	// B.5/T3：提升产出「草稿」实体（不进 Canon，用户在画布上确认设定后转正）；
	// 文本拆分为 第一行 → name、其余 → intro（全文保留在 detail）
	name := strings.TrimSpace(input.Title)
	intro := ""
	if name == "" {
		lines := strings.SplitN(strings.TrimSpace(text), "\n", 2)
		name = strings.TrimSpace(lines[0])
		if len(lines) == 2 {
			intro = strings.TrimSpace(lines[1])
		}
		if name == "" {
			name = element.Name
		}
	}
	if len(name) > 120 {
		name = name[:120]
	}
	if name == "" {
		name = "便签"
	}
	entity, err := w.UpsertEntity(UpsertEntityInput{
		WorldID: input.WorldID, TypeID: typeID, Name: name, Intro: intro, Detail: text,
		IsProvisional:      true,
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: input.CreatedBy,
	})
	if err != nil {
		return nil, err
	}
	// Keep the canvas element as the projection, now bound to the entity.
	if err := w.writeCanvasDocElement(input.WorldID, elementContext, WorldCanvasElement{
		ID: element.ID, ContextID: elementContext, Kind: "entity",
		RefKind: "entity", RefID: entity.ID, Name: entity.Name,
		Props: element.Props, Geometry: element.Geometry, Style: element.Style, Layer: element.Layer,
	}); err != nil {
		return nil, err
	}
	logWorldEvent("world.canvas.promoted", map[string]string{"worldId": input.WorldID, "elementId": element.ID, "entityId": entity.ID})
	return map[string]any{"promoted": "entity", "entity": entity}, nil
}

// promoteArrow resolves the arrow endpoints and picks the semantic binding:
// entity → entity creates a world_relations edge; entity → free element binds
// the free element as a reference projection of one of the entity's properties.
func (w *WorldStore) promoteArrow(db *sql.DB, elementContext string, element WorldCanvasElement, input PromoteCanvasElementInput) (map[string]any, error) {
	toID := stringProp(element.Props, "toElementId")
	if strings.TrimSpace(toID) == "" {
		return nil, worldsError(WorldsErrContextInvalid, "arrow needs a toElementId target")
	}
	toContext, to, err := w.findCanvasDocElement(db, input.WorldID, toID)
	if err != nil {
		return nil, worldsError(WorldsErrContextInvalid, "arrow target element not found")
	}
	if to.Kind == "entity" && to.RefID != "" {
		return w.promoteArrowToRelation(db, elementContext, element, input)
	}
	return w.promoteArrowToPropertyBinding(db, toContext, element, to, input)
}

func (w *WorldStore) promoteArrowToRelation(db *sql.DB, elementContext string, element WorldCanvasElement, input PromoteCanvasElementInput) (map[string]any, error) {
	fromID := stringProp(element.Props, "fromElementId")
	toID := stringProp(element.Props, "toElementId")
	if fromID == "" || toID == "" {
		return nil, worldsError(WorldsErrContextInvalid, "arrow needs from and to element references")
	}
	_, from, err := w.findCanvasDocElement(db, input.WorldID, fromID)
	if err != nil {
		return nil, worldsError(WorldsErrContextInvalid, "arrow source element not found")
	}
	_, to, err := w.findCanvasDocElement(db, input.WorldID, toID)
	if err != nil {
		return nil, worldsError(WorldsErrContextInvalid, "arrow target element not found")
	}
	if from.Kind != "entity" || from.RefID == "" || to.Kind != "entity" || to.RefID == "" {
		return nil, worldsError(WorldsErrContextInvalid, "arrow endpoints must be entity elements")
	}
	fromRole := strings.TrimSpace(input.FromRole)
	if fromRole == "" {
		fromRole = strings.TrimSpace(stringProp(element.Props, "fromRole"))
	}
	if fromRole == "" {
		fromRole = strings.TrimSpace(stringProp(element.Props, "relationType"))
	}
	if fromRole == "" {
		fromRole = "references"
	}
	toRole := strings.TrimSpace(input.ToRole)
	if toRole == "" {
		toRole = strings.TrimSpace(stringProp(element.Props, "toRole"))
	}
	relation, err := w.CreateRelation(CreateRelationInput{
		WorldID: input.WorldID, FromEntityID: from.RefID, ToEntityID: to.RefID,
		FromRole: fromRole, ToRole: toRole, ScopeEntityID: elementContext,
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

// promoteArrowToPropertyBinding turns an entity → free-element arrow into a
// property binding: the free element becomes a reference projection of one of
// the entity's properties. The property value's single source of truth is
// entity.content[field] (shared with the right property panel); the canvas
// element only projects it and can create/update the value, never delete it.
func (w *WorldStore) promoteArrowToPropertyBinding(db *sql.DB, toContext string, element WorldCanvasElement, to WorldCanvasElement, input PromoteCanvasElementInput) (map[string]any, error) {
	fromID := stringProp(element.Props, "fromElementId")
	if strings.TrimSpace(fromID) == "" {
		return nil, worldsError(WorldsErrContextInvalid, "property binding needs an entity start point")
	}
	_, from, err := w.findCanvasDocElement(db, input.WorldID, fromID)
	if err != nil {
		return nil, worldsError(WorldsErrContextInvalid, "property binding source element not found")
	}
	if from.Kind != "entity" || from.RefID == "" {
		return nil, worldsError(WorldsErrContextInvalid, "property binding must start from an entity element")
	}
	entity, err := w.getEntity(db, input.WorldID, from.RefID)
	if err != nil {
		return nil, err
	}
	field := strings.TrimSpace(input.Field)
	if field == "" {
		field = strings.TrimSpace(stringProp(element.Props, "field"))
	}
	if field == "" {
		field = strings.TrimSpace(stringProp(to.Props, "field"))
	}
	if field == "" {
		return nil, worldsError(WorldsErrContextInvalid, "property binding needs a field key")
	}
	// Canvas-side creation: an empty property seeds from the free element's
	// content (first line of the note text, else its title). Existing values
	// stay untouched — the property panel wins on conflict.
	valueMap := attrValueMap(entity.Attrs)
	current, _ := valueMap[field].(string)
	if strings.TrimSpace(current) == "" {
		seed := stringProp(to.Props, "text")
		if seed == "" {
			seed = stringProp(to.Props, "title")
		}
		if strings.TrimSpace(seed) != "" {
			entity, err = w.UpsertEntity(UpsertEntityInput{
				WorldID: input.WorldID, EntityID: entity.ID, Name: entity.Name,
				Intro: entity.Intro, Detail: entity.Detail,
				Attrs: patchEntityAttr(entity.Attrs, field, seed), CreatedBy: input.CreatedBy,
			})
			if err != nil {
				return nil, err
			}
		}
	}
	label := w.entityFieldLabel(db, input.WorldID, entity.TypeID, field)
	// Mark the target element as a property reference: its title carries the
	// bound property and props record the binding for sync.
	sourceTitle := to.Name
	if strings.TrimSpace(sourceTitle) == "" {
		sourceTitle = stringProp(to.Props, "title")
	}
	toProps := map[string]any{}
	for key, item := range to.Props {
		toProps[key] = item
	}
	toProps["binding"] = "property"
	toProps["boundEntityId"] = entity.ID
	toProps["boundField"] = field
	toProps["sourceTitle"] = sourceTitle
	boundTitle := strings.TrimSpace(sourceTitle)
	if boundTitle == "" {
		boundTitle = "引用"
	}
	if err := w.writeCanvasDocElement(input.WorldID, toContext, WorldCanvasElement{
		ID: to.ID, ContextID: toContext, Kind: to.Kind,
		RefKind: to.RefKind, RefID: to.RefID, Name: boundTitle + "（引用 · " + label + "）",
		Props: toProps, Geometry: to.Geometry, Style: to.Style, Layer: to.Layer,
	}); err != nil {
		return nil, err
	}
	// Attr element: the visible property edge anchor projecting the shared
	// value onto the canvas.
	attrID := "attr:" + to.ID
	boundValue := attrValueMap(entity.Attrs)[field]
	if err := w.writeCanvasDocElement(input.WorldID, toContext, WorldCanvasElement{
		ID: attrID, ContextID: toContext, Kind: "attr",
		RefKind: "entity", RefID: entity.ID, Name: "属性 · " + label,
		Props:    map[string]any{"field": field, "sourceElementId": to.ID, "value": boundValue},
		Geometry: to.Geometry, Layer: to.Layer,
	}); err != nil {
		return nil, err
	}
	logWorldEvent("world.canvas.promoted", map[string]string{"worldId": input.WorldID, "elementId": element.ID, "entityId": entity.ID, "field": field})
	return map[string]any{"promoted": "property", "entityId": entity.ID, "field": field, "attrElementId": attrID, "value": boundValue}, nil
}

// entityFieldLabel resolves a human label for a bound property from the
// entity's type field schema; unknown fields fall back to the key itself.
func (w *WorldStore) entityFieldLabel(db *sql.DB, worldID, kind, field string) string {
	var fieldsJSON string
	err := db.QueryRow("select fields_json from world_entity_types where world_id = ? and id = ? and archived_at is null", worldID, kind).Scan(&fieldsJSON)
	if err != nil {
		return field
	}
	var fields []EntityTypeField
	if err := json.Unmarshal([]byte(fieldsJSON), &fields); err != nil {
		return field
	}
	for _, item := range fields {
		if item.Key == field {
			if strings.TrimSpace(item.Label) != "" {
				return item.Label
			}
			return field
		}
	}
	return field
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

// getEntityTypeQuerier reads one type row through any rowQuerier (*sql.DB or
// *sql.Tx) so callers inside an open transaction see their own writes.
func getEntityTypeQuerier(db rowQuerier, worldID, typeID string) (WorldEntityType, error) {
	return scanEntityType(db.QueryRow("select id, world_id, scope, name, icon, color, base_kind, fields_json, extends_id, builtin, created_at, updated_at from world_entity_types where world_id = ? and id = ? and archived_at is null", worldID, typeID))
}
