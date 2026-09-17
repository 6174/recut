/*
 * [INPUT]: 依赖 MediaService 的 Asset 读取/落盘、既有 durable 事件账本与标准库 JSON
 * [OUTPUT]: 全局素材的通用创作信息层：有序 typed attributes（含 provenance 字段级溯源）、
 *   content 长正文 + contentMeta，以及 asset.update 的 locked/结构校验与按 key 合并（attrPatch）
 * [POS]: media 包的「素材属性协议层」；content/attributes 真相与 Asset 生命周期同表（metadata_json），
 *   facet 仍由各自 owner op 写入，本层只提供读取归位（proposal 兼容视图）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	MetadataKeyContent     = "content"
	MetadataKeyContentMeta = "contentMeta"
	MetadataKeyAttributes  = "attributes"
)

// Provenance 的写入者类别；Agent 字段必带 agent，便于读取侧区分 AI 生成内容。
const (
	MaterialActorSystem = "system"
	MaterialActorAgent  = "agent"
	MaterialActorUser   = "user"
)

// MaterialProvenance 记录一个素材字段/content 是谁、因何、依据什么写入的，
// 让 AI 生成的字段可以回溯到具体写入 op、生成任务、模型与参考素材。
type MaterialProvenance struct {
	By       string   `json:"by"`
	Op       string   `json:"op,omitempty"`
	JobID    string   `json:"jobId,omitempty"`
	ModelID  string   `json:"modelId,omitempty"`
	AssetIDs []string `json:"assetIds,omitempty"`
	At       string   `json:"at,omitempty"`
}

// MaterialAttr 对齐 World Entity 的有序 typed key-value；素材额外携带
// source/provenance 以支持字段级溯源。Locked 字段的结构不可改、可改值。
type MaterialAttr struct {
	Key        string              `json:"key"`
	Label      string              `json:"label,omitempty"`
	Type       string              `json:"type"`
	Value      any                 `json:"value,omitempty"`
	Options    []string            `json:"options,omitempty"`
	Locked     bool                `json:"locked,omitempty"`
	Source     string              `json:"source,omitempty"`
	Provenance *MaterialProvenance `json:"provenance,omitempty"`
}

// MaterialUpdateInput 是 asset.update 的输入：Name/Content 为 nil 表示不改；
// Attributes 非 nil 为整体替换，AttrPatch 非空为按 key 合并（二者互斥，优先整体替换）。
type MaterialUpdateInput struct {
	Name       *string
	Content    *string
	Attributes *[]MaterialAttr
	AttrPatch  []MaterialAttr
}

var materialAttrTypes = map[string]struct{}{
	"text": {}, "textarea": {}, "number": {}, "boolean": {},
	"select": {}, "media": {}, "ref": {}, "url": {},
}

// MaterialAttrsFromMetadata decodes the persisted attributes array. A missing or
// null value is an empty list; malformed data fails closed rather than silently
// dropping user fields.
func MaterialAttrsFromMetadata(metadata map[string]any) ([]MaterialAttr, error) {
	raw, ok := metadata[MetadataKeyAttributes]
	if !ok || raw == nil {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	attrs := []MaterialAttr{}
	if err := json.Unmarshal(data, &attrs); err != nil {
		return nil, fmt.Errorf("media asset attributes are malformed: %w", err)
	}
	return attrs, nil
}

// UpdateMaterial writes the reusable creative-information layer of one asset.
// name/content/attributes share the asset's single transaction so the durable
// event ledger and SSE observers see one coherent update.
func (m *MediaService) UpdateMaterial(id string, input MaterialUpdateInput, actor, op string) (MediaAsset, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return MediaAsset{}, errors.New("media asset not found")
	}
	actor = strings.TrimSpace(actor)
	if actor == "" {
		actor = MaterialActorUser
	}
	asset, err := m.GetAsset(id)
	if err != nil {
		return MediaAsset{}, errors.New("media asset not found")
	}
	if asset.Status == "deleted" {
		return MediaAsset{}, errors.New("deleted media asset cannot be edited")
	}
	now := time.Now().UTC()
	nowISO := now.Format(time.RFC3339Nano)

	metadata := map[string]any{}
	for key, value := range asset.Metadata {
		metadata[key] = value
	}
	name := asset.Name
	nameChanged := false
	if input.Name != nil {
		next := strings.TrimSpace(*input.Name)
		if next == "" {
			return MediaAsset{}, errors.New("asset name is required")
		}
		if next != name {
			name, nameChanged = next, true
		}
	}
	if input.Content != nil {
		metadata[MetadataKeyContent] = *input.Content
		metadata[MetadataKeyContentMeta] = MaterialProvenance{By: actor, Op: op, At: nowISO}
	}
	switch {
	case input.Attributes != nil:
		existing, err := MaterialAttrsFromMetadata(asset.Metadata)
		if err != nil {
			return MediaAsset{}, err
		}
		next, err := applyMaterialAttrReplace(existing, *input.Attributes, actor, op, nowISO)
		if err != nil {
			return MediaAsset{}, err
		}
		metadata[MetadataKeyAttributes] = next
	case len(input.AttrPatch) > 0:
		existing, err := MaterialAttrsFromMetadata(asset.Metadata)
		if err != nil {
			return MediaAsset{}, err
		}
		next, err := applyMaterialAttrPatch(existing, input.AttrPatch, actor, op, nowISO)
		if err != nil {
			return MediaAsset{}, err
		}
		metadata[MetadataKeyAttributes] = next
	}

	serialized, err := json.Marshal(metadata)
	if err != nil {
		return MediaAsset{}, err
	}
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if nameChanged {
		_, err = tx.Exec("update media_assets set name = ?, metadata_json = ?, updated_at = ? where id = ?", name, string(serialized), nowISO, id)
	} else {
		_, err = tx.Exec("update media_assets set metadata_json = ?, updated_at = ? where id = ?", string(serialized), nowISO, id)
	}
	if err != nil {
		return rollback(err)
	}
	if err := recordAssetEvent(tx, id, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return m.GetAsset(id)
}

func validateMaterialAttr(attr MaterialAttr) error {
	key := strings.TrimSpace(attr.Key)
	if key == "" {
		return errors.New("material attribute key is required")
	}
	attrType := strings.TrimSpace(attr.Type)
	if _, ok := materialAttrTypes[attrType]; !ok {
		return fmt.Errorf("material attribute %q has unknown type %q", key, attr.Type)
	}
	if attrType == "select" && len(attr.Options) == 0 {
		return fmt.Errorf("material attribute %q of type select requires options", key)
	}
	if attr.Value == nil {
		return nil
	}
	switch attrType {
	case "media":
		value, ok := materialStringMap(attr.Value)
		if !ok || strings.TrimSpace(materialStringValue(value["assetId"])) == "" {
			return fmt.Errorf("material attribute %q of type media requires a value.assetId", key)
		}
	case "ref":
		value, ok := materialStringMap(attr.Value)
		if !ok || strings.TrimSpace(materialStringValue(value["id"])) == "" {
			return fmt.Errorf("material attribute %q of type ref requires a value.id", key)
		}
	}
	return nil
}

func materialStringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func materialStringMap(value any) (map[string]any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		return typed, true
	case map[string]string:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			result[key] = item
		}
		return result, true
	}
	return nil, false
}

func materialAttrIndex(attrs []MaterialAttr) map[string]MaterialAttr {
	index := make(map[string]MaterialAttr, len(attrs))
	for _, attr := range attrs {
		index[strings.TrimSpace(attr.Key)] = attr
	}
	return index
}

func sameMaterialValue(left, right any) bool {
	a, _ := json.Marshal(left)
	b, _ := json.Marshal(right)
	return string(a) == string(b)
}

// withMaterialProvenance keeps the original provenance when value and structure
// did not change; otherwise it stamps the current writer. This keeps system
// provenance stable while still tracing every real AI/user write.
func withMaterialProvenance(attr MaterialAttr, prev MaterialAttr, hasPrev bool, actor, op, now string) MaterialAttr {
	if hasPrev && sameMaterialValue(prev.Value, attr.Value) && prev.Label == attr.Label && prev.Type == attr.Type {
		attr.Provenance = prev.Provenance
		return attr
	}
	attr.Provenance = &MaterialProvenance{By: actor, Op: op, At: now}
	return attr
}

// applyMaterialAttrReplace validates a full attribute list against the locked
// structure of the existing list. Locked fields must survive with their
// type/label intact; their value may change. Order follows the incoming list.
func applyMaterialAttrReplace(existing, incoming []MaterialAttr, actor, op, now string) ([]MaterialAttr, error) {
	index := materialAttrIndex(existing)
	seen := make(map[string]bool, len(incoming))
	result := make([]MaterialAttr, 0, len(incoming))
	for _, attr := range incoming {
		attr.Key = strings.TrimSpace(attr.Key)
		if err := validateMaterialAttr(attr); err != nil {
			return nil, err
		}
		if seen[attr.Key] {
			return nil, fmt.Errorf("material attribute key %q appears twice", attr.Key)
		}
		seen[attr.Key] = true
		prev, hasPrev := index[attr.Key]
		if hasPrev && prev.Locked {
			if attr.Type != prev.Type {
				return nil, fmt.Errorf("material attribute %q is locked and its type cannot change", attr.Key)
			}
			if attr.Label == "" {
				attr.Label = prev.Label
			} else if attr.Label != prev.Label {
				return nil, fmt.Errorf("material attribute %q is locked and its label cannot change", attr.Key)
			}
		}
		// Locked 与 source 由服务端裁决：只有 system 能创建锁定字段；字段来源一经创建不因后续写入改变。
		if hasPrev {
			attr.Locked = prev.Locked
			attr.Source = prev.Source
		} else {
			attr.Locked = attr.Locked && actor == MaterialActorSystem
			attr.Source = actor
		}
		attr = withMaterialProvenance(attr, prev, hasPrev, actor, op, now)
		result = append(result, attr)
	}
	for key, prev := range index {
		if prev.Locked && !seen[key] {
			return nil, fmt.Errorf("locked material attribute %q cannot be removed", key)
		}
	}
	return result, nil
}

// applyMaterialAttrPatch merges patch items by key (new keys append). Locked
// structure is enforced the same way as a full replace.
func applyMaterialAttrPatch(existing, patch []MaterialAttr, actor, op, now string) ([]MaterialAttr, error) {
	result := append([]MaterialAttr(nil), existing...)
	positions := make(map[string]int, len(result))
	for index, attr := range result {
		positions[strings.TrimSpace(attr.Key)] = index
	}
	for _, item := range patch {
		key := strings.TrimSpace(item.Key)
		if key == "" {
			return nil, errors.New("material attribute patch requires a key")
		}
		item.Key = key
		position, found := positions[key]
		if !found {
			if strings.TrimSpace(item.Type) == "" {
				return nil, fmt.Errorf("new material attribute %q requires a type", key)
			}
			if err := validateMaterialAttr(item); err != nil {
				return nil, err
			}
			item.Source = actor
			item.Locked = item.Locked && actor == MaterialActorSystem
			item.Provenance = &MaterialProvenance{By: actor, Op: op, At: now}
			positions[key] = len(result)
			result = append(result, item)
			continue
		}
		prev := result[position]
		merged := prev
		if strings.TrimSpace(item.Type) != "" {
			merged.Type = strings.TrimSpace(item.Type)
		}
		if item.Label != "" {
			merged.Label = item.Label
		}
		if item.Options != nil {
			merged.Options = item.Options
		}
		if item.Value != nil {
			merged.Value = item.Value
		}
		if prev.Locked {
			if merged.Type != prev.Type {
				return nil, fmt.Errorf("material attribute %q is locked and its type cannot change", key)
			}
			if merged.Label != prev.Label {
				return nil, fmt.Errorf("material attribute %q is locked and its label cannot change", key)
			}
			merged.Locked = true
		}
		if err := validateMaterialAttr(merged); err != nil {
			return nil, err
		}
		merged.Source = prev.Source
		merged = withMaterialProvenance(merged, prev, true, actor, op, now)
		result[position] = merged
	}
	return result, nil
}
