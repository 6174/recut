/*
 * [INPUT]: 依赖 WorldStore 的 worlds/world_canvases 表（文档粒度画布存储）、既有 world_canvas 行（惰性迁移源）
 * 与 checkWritable/summary 协议
 * [OUTPUT]: 对外提供文档粒度画布能力面（RFC 2026-09-09）：GetCanvasDocument（读 + 惰性迁移 + 懒创建）、
 * SaveCanvasDocument（整包保存 + version 乐观锁）、ListCanvasDocuments（文档索引）、UpdateCanvasDocumentOps
 * （元素级 ops 操作面，AI/MCP 用：实体卡只给 refId 即补 shape:<entityId>/名称/默认几何，非实体元素补默认几何，
 * 并提供 canvasLayoutSummary 只读回执）；并承载语义侧的画布联动（promote 投影写回、实体删除投影清理、
 * attr 投影同步、fork 文档复制）
 * [POS]: service 的 World Canvas 文档存储层；world_canvas element 级表保留只读作迁移源，30 天后清理
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// WorldCanvasDocument is one canvas document: a whole canvas (root or inner)
// stored as a single row. Elements reuse the legacy WorldCanvasElement shape so
// the front-end type surface is unchanged.
type WorldCanvasDocument struct {
	WorldID   string               `json:"worldId"`
	ContextID string               `json:"contextId"`
	Version   int                  `json:"version"`
	Elements  []WorldCanvasElement `json:"elements"`
	CreatedAt string               `json:"createdAt"`
	UpdatedAt string               `json:"updatedAt"`
}

// canvasDocPayload is the persisted doc_json envelope.
type canvasDocPayload struct {
	DocVersion int                  `json:"docVersion"`
	Elements   []WorldCanvasElement `json:"elements"`
}

// CanvasDocOp is one element-level operation applied inside a document
// (canvas.doc.update). Storage is document-granularity; the operation surface
// stays element-granularity for AI/MCP parity with the old upsert/remove.
type CanvasDocOp struct {
	Op      string                 `json:"op"` // insert | update | remove
	Element *UpsertCanvasElementInput `json:"element"`
}

const canvasDocMaxBytes = 2 << 20 // 2MB doc_json safety ceiling

func emptyCanvasDocPayload() canvasDocPayload {
	return canvasDocPayload{DocVersion: 1, Elements: []WorldCanvasElement{}}
}

func decodeCanvasDocPayload(raw string) (canvasDocPayload, error) {
	payload := emptyCanvasDocPayload()
	if strings.TrimSpace(raw) == "" {
		return payload, nil
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return payload, err
	}
	if payload.Elements == nil {
		payload.Elements = []WorldCanvasElement{}
	}
	return payload, nil
}

func encodeCanvasDocPayload(payload canvasDocPayload) (string, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	if len(encoded) > canvasDocMaxBytes {
		return "", worldsError(WorldsErrContextInvalid, fmt.Sprintf("canvas document exceeds %d bytes", canvasDocMaxBytes))
	}
	return string(encoded), nil
}

type canvasDocRow struct {
	version   int
	payload   canvasDocPayload
	createdAt string
	updatedAt string
	exists    bool
}

// ensureCanvasDocInTx resolves the document row for one context, lazily
// migrating legacy world_canvas element rows on first touch (RFC M2). When
// neither a doc row nor legacy rows exist it returns version=0 without
// persisting anything (lazy creation on first save).
func ensureCanvasDocInTx(tx *sql.Tx, worldID, contextID string) (canvasDocRow, error) {
	var raw, createdAt, updatedAt string
	var version int
	err := tx.QueryRow("select doc_json, version, created_at, updated_at from world_canvases where world_id = ? and context_id = ?", worldID, contextID).Scan(&raw, &version, &createdAt, &updatedAt)
	if err == nil {
		payload, decodeErr := decodeCanvasDocPayload(raw)
		if decodeErr != nil {
			return canvasDocRow{}, decodeErr
		}
		return canvasDocRow{version: version, payload: payload, createdAt: createdAt, updatedAt: updatedAt, exists: true}, nil
	}
	if err != sql.ErrNoRows {
		return canvasDocRow{}, err
	}
	// Legacy migration: group world_canvas rows of this context into a doc.
	rows, err := tx.Query("select id, world_id, context_id, kind, ref_kind, ref_id, name, props_json, geometry_json, style_json, layer, created_at, updated_at from world_canvas where world_id = ? and context_id = ? order by layer, created_at", worldID, contextID)
	if err != nil {
		return canvasDocRow{}, err
	}
	defer rows.Close()
	elements := []WorldCanvasElement{}
	for rows.Next() {
		element, scanErr := scanCanvasElement(rows)
		if scanErr != nil {
			return canvasDocRow{}, scanErr
		}
		elements = append(elements, element)
	}
	if err := rows.Err(); err != nil {
		return canvasDocRow{}, err
	}
	rows.Close()
	if len(elements) == 0 {
		return canvasDocRow{version: 0, payload: emptyCanvasDocPayload()}, nil
	}
	now := iso(time.Now().UTC())
	payload := canvasDocPayload{DocVersion: 1, Elements: elements}
	encoded, err := encodeCanvasDocPayload(payload)
	if err != nil {
		return canvasDocRow{}, err
	}
	if _, err := tx.Exec("insert into world_canvases (id, world_id, context_id, doc_json, version, created_at, updated_at) values (?, ?, ?, ?, 1, ?, ?)",
		canvasDocID(worldID, contextID), worldID, contextID, encoded, now, now); err != nil {
		return canvasDocRow{}, err
	}
	return canvasDocRow{version: 1, payload: payload, createdAt: now, updatedAt: now, exists: true}, nil
}

// canvasDocID is the deterministic primary key of a canvas document row.
func canvasDocID(worldID, contextID string) string {
	return worldID + ":ctx:" + contextID
}

// writeCanvasDocInTx persists a document payload inside an existing tx,
// bumping version. Doc must have been resolved via ensureCanvasDocInTx.
func writeCanvasDocInTx(tx *sql.Tx, worldID, contextID string, row canvasDocRow, payload canvasDocPayload) (canvasDocRow, error) {
	encoded, err := encodeCanvasDocPayload(payload)
	if err != nil {
		return row, err
	}
	now := iso(time.Now().UTC())
	if row.exists {
		if _, err := tx.Exec("update world_canvases set doc_json = ?, version = ?, updated_at = ? where world_id = ? and context_id = ?", encoded, row.version+1, now, worldID, contextID); err != nil {
			return row, err
		}
	} else {
		if _, err := tx.Exec("insert into world_canvases (id, world_id, context_id, doc_json, version, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
			canvasDocID(worldID, contextID), worldID, contextID, encoded, row.version+1, now, now); err != nil {
			return row, err
		}
	}
	return canvasDocRow{version: row.version + 1, payload: payload, createdAt: row.createdAt, updatedAt: now, exists: true}, nil
}

// GetCanvasDocument returns one canvas document (root when contextId is
// empty), lazily migrating legacy element rows on first touch.
func (w *WorldStore) GetCanvasDocument(worldID, contextID string) (WorldCanvasDocument, error) {
	db, err := w.database()
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return WorldCanvasDocument{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	defer tx.Rollback()
	row, err := ensureCanvasDocInTx(tx, worldID, contextID)
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldCanvasDocument{}, err
	}
	return WorldCanvasDocument{
		WorldID: worldID, ContextID: contextID, Version: row.version,
		Elements: row.payload.Elements, CreatedAt: row.createdAt, UpdatedAt: row.updatedAt,
	}, nil
}

// SaveCanvasDocument writes a whole document with optimistic version check.
// expectedVersion=0 means "create fresh" (no prior read); any other value must
// match the stored version or CANVAS_VERSION_CONFLICT is returned.
func (w *WorldStore) SaveCanvasDocument(worldID, contextID string, elements []WorldCanvasElement, expectedVersion int) (WorldCanvasDocument, error) {
	db, err := w.database()
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return WorldCanvasDocument{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, worldID); err != nil {
		return WorldCanvasDocument{}, err
	}
	row, err := ensureCanvasDocInTx(tx, worldID, contextID)
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	// 乐观锁：文档已存在时 version 必须精确匹配（含 0——"没读过就保存"一律冲突，
	// 防止盲写覆盖）；仅当文档尚不存在（懒创建）时接受 version=0
	if row.exists && expectedVersion != row.version {
		return WorldCanvasDocument{}, worldsError(WorldsErrCanvasConflict, fmt.Sprintf("canvas version conflict: expected %d, current %d", expectedVersion, row.version))
	}
	payload := canvasDocPayload{DocVersion: 1, Elements: normalizeCanvasElements(elements)}
	row, err = writeCanvasDocInTx(tx, worldID, contextID, row, payload)
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldCanvasDocument{}, err
	}
	return WorldCanvasDocument{
		WorldID: worldID, ContextID: contextID, Version: row.version,
		Elements: row.payload.Elements, CreatedAt: row.createdAt, UpdatedAt: row.updatedAt,
	}, nil
}

// normalizeCanvasElements enforces the element contract at the document edge:
// every element needs a stable id and kind; map fields are never nil.
func normalizeCanvasElements(elements []WorldCanvasElement) []WorldCanvasElement {
	normalized := make([]WorldCanvasElement, 0, len(elements))
	for _, element := range elements {
		if strings.TrimSpace(element.ID) == "" || strings.TrimSpace(element.Kind) == "" {
			continue
		}
		if element.Props == nil {
			element.Props = map[string]any{}
		}
		if element.Geometry == nil {
			element.Geometry = map[string]any{}
		}
		if element.Style == nil {
			element.Style = map[string]any{}
		}
		normalized = append(normalized, element)
	}
	return normalized
}

// fillCanvasElementGeometry fills the frontend-mirrored defaults an AI-placed
// element needs to render like an interactively-created one: entity cards get
// 264x328 (RFC 统一 Entity 模型 card size) and a grid slot when x/y are absent.
// Explicit geometry always wins, so partial updates (e.g. only x/y) are safe.
func fillCanvasElementGeometry(element *WorldCanvasElement, index int) {
	if element.Geometry == nil {
		element.Geometry = map[string]any{}
	}
	if element.Kind != "entity" {
		return
	}
	if _, ok := element.Geometry["width"]; !ok {
		element.Geometry["width"] = float64(264)
	}
	if _, ok := element.Geometry["height"]; !ok {
		element.Geometry["height"] = float64(328)
	}
	if _, ok := element.Geometry["x"]; !ok {
		element.Geometry["x"] = float64(40 + (index%4)*260)
	}
	if _, ok := element.Geometry["y"]; !ok {
		element.Geometry["y"] = float64(40 + (index/4)*180)
	}
	if _, ok := element.Geometry["zIndex"]; !ok {
		element.Geometry["zIndex"] = float64(1)
	}
}

// canvasLayoutSummary is a cheap, render-free receipt of a document's layout so
// a headless Agent can sanity-check what it just wrote: element count, kind
// distribution, overall bounding box, and how many elements lack usable
// geometry. It is a projection, not truth.
func canvasLayoutSummary(elements []WorldCanvasElement) map[string]any {
	kinds := map[string]int{}
	missingGeometry := 0
	minX, minY := 0.0, 0.0
	maxX, maxY := 0.0, 0.0
	hasBounds := false
	for _, element := range elements {
		kinds[element.Kind]++
		x, okX := numericGeometry(element.Geometry["x"])
		y, okY := numericGeometry(element.Geometry["y"])
		w, okW := numericGeometry(element.Geometry["width"])
		h, okH := numericGeometry(element.Geometry["height"])
		if !okX || !okY || !okW || !okH {
			missingGeometry++
			continue
		}
		if !hasBounds {
			minX, minY, maxX, maxY = x, y, x+w, y+h
			hasBounds = true
			continue
		}
		if x < minX {
			minX = x
		}
		if y < minY {
			minY = y
		}
		if x+w > maxX {
			maxX = x + w
		}
		if y+h > maxY {
			maxY = y + h
		}
	}
	summary := map[string]any{
		"elementCount":    len(elements),
		"kinds":           kinds,
		"missingGeometry": missingGeometry,
	}
	if hasBounds {
		summary["bounds"] = map[string]float64{"minX": minX, "minY": minY, "maxX": maxX, "maxY": maxY, "width": maxX - minX, "height": maxY - minY}
	}
	return summary
}

func numericGeometry(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

// ListCanvasDocuments returns the document index of one world (no bodies).
func (w *WorldStore) ListCanvasDocuments(worldID string) ([]map[string]any, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return nil, err
	}
	rows, err := db.Query("select context_id, version, updated_at, doc_json from world_canvases where world_id = ? order by context_id", worldID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var contextID, updatedAt, raw string
		var version int
		if err := rows.Scan(&contextID, &version, &updatedAt, &raw); err != nil {
			return nil, err
		}
		payload, err := decodeCanvasDocPayload(raw)
		if err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"contextId": contextID, "version": version, "updatedAt": updatedAt, "elementCount": len(payload.Elements),
		})
	}
	return items, rows.Err()
}

// UpdateCanvasDocumentOps applies element-level ops inside one document
// (AI/MCP surface). Link starts must be entity elements of the same document;
// attr element writes sync values back into entity content (canvas-side
// create/update only, mirroring the legacy upsert contract).
func (w *WorldStore) UpdateCanvasDocumentOps(worldID, contextID string, ops []CanvasDocOp) (WorldCanvasDocument, error) {
	db, err := w.database()
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return WorldCanvasDocument{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, worldID); err != nil {
		return WorldCanvasDocument{}, err
	}
	row, err := ensureCanvasDocInTx(tx, worldID, contextID)
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	elements := append([]WorldCanvasElement{}, row.payload.Elements...)
	attrWrites := [][2]any{}
	for _, op := range ops {
		switch op.Op {
		case "insert", "update":
			if op.Element == nil {
				return WorldCanvasDocument{}, worldsError(WorldsErrContextInvalid, "canvas op needs an element")
			}
			element := WorldCanvasElement{
				ID: op.Element.ElementID, WorldID: worldID, ContextID: contextID, Kind: op.Element.Kind,
				RefKind: op.Element.RefKind, RefID: op.Element.RefID, Name: op.Element.Name,
				Props: op.Element.Props, Geometry: op.Element.Geometry, Style: op.Element.Style,
				Layer: op.Element.Layer,
			}
			if element.Kind == "" {
				return WorldCanvasDocument{}, worldsError(WorldsErrContextInvalid, "canvas op element needs a kind")
			}
			// 实体投影卡：id/name 可由 refId 推导，AI 只给 {kind:"entity", refId} 即可放卡
			// （id = `shape:<entityId>` 是前端与 vello block 约定的镜像 id）。
			if element.Kind == "entity" && element.RefID != "" {
				if element.ID == "" {
					element.ID = "shape:" + element.RefID
				}
				var entityName string
				nameErr := tx.QueryRow("select title from world_entities where id = ? and world_id = ? and archived_at is null", element.RefID, worldID).Scan(&entityName)
				if nameErr == sql.ErrNoRows {
					return WorldCanvasDocument{}, worldsError(WorldsErrEntityNotFound, "referenced entity does not belong to the world")
				}
				if nameErr != nil {
					return WorldCanvasDocument{}, nameErr
				}
				if strings.TrimSpace(element.Name) == "" {
					element.Name = entityName
				}
			}
			if element.ID == "" {
				id, idErr := newID()
				if idErr != nil {
					return WorldCanvasDocument{}, idErr
				}
				element.ID = id
			}
			if element.Kind == "arrow" || element.Kind == "link" {
				if err := validateCanvasDocLinkStart(elements, element); err != nil {
					return WorldCanvasDocument{}, err
				}
			}
			// 非实体引用（如 attr 绑定实体）保持既有存活校验。
			if element.Kind != "entity" && op.Element.RefID != "" && op.Element.RefKind != "" {
				var count int
				if err := tx.QueryRow("select count(*) from world_entities where id = ? and world_id = ? and archived_at is null", op.Element.RefID, worldID).Scan(&count); err != nil {
					return WorldCanvasDocument{}, err
				}
				if count == 0 {
					return WorldCanvasDocument{}, worldsError(WorldsErrEntityNotFound, "referenced entity does not belong to the world")
				}
			}
			fillCanvasElementGeometry(&element, len(elements))
			replaced := false
			for i, existing := range elements {
				if existing.ID == element.ID {
					if op.Op == "insert" {
						return WorldCanvasDocument{}, worldsError(WorldsErrContextInvalid, "canvas element already exists: "+element.ID)
					}
					element.CreatedAt = existing.CreatedAt
					elements[i] = element
					replaced = true
					break
				}
			}
			if !replaced {
				if op.Op == "update" {
					return WorldCanvasDocument{}, worldsError(WorldsErrContextInvalid, "canvas element not found: "+element.ID)
				}
				element.CreatedAt = iso(time.Now().UTC())
				elements = append(elements, element)
			}
			if element.Kind == "attr" && element.RefID != "" {
				attrWrites = append(attrWrites, [2]any{element.RefID, element.Props})
			}
		case "remove":
			if op.Element == nil || strings.TrimSpace(op.Element.ElementID) == "" {
				return WorldCanvasDocument{}, worldsError(WorldsErrContextInvalid, "canvas remove op needs an element id")
			}
			kept := elements[:0]
			for _, existing := range elements {
				if existing.ID != op.Element.ElementID {
					kept = append(kept, existing)
				}
			}
			elements = append([]WorldCanvasElement{}, kept...)
		default:
			return WorldCanvasDocument{}, worldsError(WorldsErrContextInvalid, "unknown canvas op: "+op.Op)
		}
	}
	row, err = writeCanvasDocInTx(tx, worldID, contextID, row, canvasDocPayload{DocVersion: 1, Elements: normalizeCanvasElements(elements)})
	if err != nil {
		return WorldCanvasDocument{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldCanvasDocument{}, err
	}
	for _, write := range attrWrites {
		entityID, _ := write[0].(string)
		props, _ := write[1].(map[string]any)
		if err := w.syncAttrElementValue(worldID, entityID, props); err != nil {
			return WorldCanvasDocument{}, err
		}
	}
	return WorldCanvasDocument{
		WorldID: worldID, ContextID: contextID, Version: row.version,
		Elements: row.payload.Elements, CreatedAt: row.createdAt, UpdatedAt: row.updatedAt,
	}, nil
}

// validateCanvasDocLinkStart enforces that a doc-level link/arrow starts from
// an entity element of the same document (edge ≠ free line).
func validateCanvasDocLinkStart(elements []WorldCanvasElement, element WorldCanvasElement) error {
	fromID := stringProp(element.Props, "fromElementId")
	if strings.TrimSpace(fromID) == "" {
		return worldsError(WorldsErrContextInvalid, "link needs a fromElementId start point")
	}
	for _, candidate := range elements {
		if candidate.ID == fromID {
			if candidate.Kind != "entity" || candidate.RefID == "" {
				return worldsError(WorldsErrContextInvalid, "only entity elements can be a link start point")
			}
			return nil
		}
	}
	return worldsError(WorldsErrContextInvalid, "link start element not found")
}

// ---- 元素级适配层：旧 canvas.upsert/list/remove 契约在文档存储上的投影 ----

// ListCanvasElements returns the elements of one document (legacy surface).
func (w *WorldStore) ListCanvasElements(worldID, contextID string) ([]WorldCanvasElement, error) {
	doc, err := w.GetCanvasDocument(worldID, contextID)
	if err != nil {
		return nil, err
	}
	return doc.Elements, nil
}

// UpsertCanvasElement writes one element into its context's document
// (legacy surface): link-start validation, entity-ref validation and attr
// value sync keep the original contract.
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
	if _, err := w.summary(db, input.WorldID); err != nil {
		return WorldCanvasElement{}, err
	}
	contextID := input.ContextID
	doc, err := w.GetCanvasDocument(input.WorldID, contextID)
	if err != nil {
		return WorldCanvasElement{}, err
	}
	element := WorldCanvasElement{
		ID: input.ElementID, WorldID: input.WorldID, ContextID: contextID, Kind: input.Kind,
		RefKind: input.RefKind, RefID: input.RefID, Name: input.Name,
		Props: input.Props, Geometry: input.Geometry, Style: input.Style, Layer: input.Layer,
	}
	if element.ID == "" {
		id, err := newID()
		if err != nil {
			return WorldCanvasElement{}, err
		}
		element.ID = id
	}
	if input.Kind == "arrow" || input.Kind == "link" {
		if err := validateCanvasDocLinkStart(doc.Elements, element); err != nil {
			return WorldCanvasElement{}, err
		}
	}
	if input.RefID != "" && input.RefKind != "" {
		var count int
		if err := db.QueryRow("select count(*) from world_entities where id = ? and world_id = ? and archived_at is null", input.RefID, input.WorldID).Scan(&count); err != nil {
			return WorldCanvasElement{}, err
		}
		if count == 0 {
			return WorldCanvasElement{}, worldsError(WorldsErrEntityNotFound, "referenced entity does not belong to the world")
		}
	}
	if err := w.writeCanvasDocElement(input.WorldID, contextID, element); err != nil {
		return WorldCanvasElement{}, err
	}
	// Property binding sync (canvas-side create/update only).
	if input.Kind == "attr" && input.RefID != "" {
		if err := w.syncAttrElementValue(input.WorldID, input.RefID, input.Props); err != nil {
			return WorldCanvasElement{}, err
		}
	}
	return w.getCanvasDocElement(input.WorldID, contextID, element.ID)
}

// DeleteCanvasElement removes one element from its document (legacy surface).
func (w *WorldStore) DeleteCanvasElement(worldID, elementID, createdBy string) error {
	db, err := w.database()
	if err != nil {
		return err
	}
	contextID, _, err := w.findCanvasDocElement(db, worldID, elementID)
	if err != nil {
		return worldsError(WorldsErrContextInvalid, "canvas element not found")
	}
	doc, err := w.GetCanvasDocument(worldID, contextID)
	if err != nil {
		return err
	}
	kept := make([]WorldCanvasElement, 0, len(doc.Elements))
	found := false
	for _, element := range doc.Elements {
		if element.ID == elementID {
			found = true
			continue
		}
		kept = append(kept, element)
	}
	if !found {
		return worldsError(WorldsErrContextInvalid, "canvas element not found")
	}
	if _, err := w.SaveCanvasDocument(worldID, contextID, kept, doc.Version); err != nil {
		return err
	}
	return nil
}

// getCanvasDocElement re-reads one element from a document.
func (w *WorldStore) getCanvasDocElement(worldID, contextID, elementID string) (WorldCanvasElement, error) {
	doc, err := w.GetCanvasDocument(worldID, contextID)
	if err != nil {
		return WorldCanvasElement{}, err
	}
	for _, element := range doc.Elements {
		if element.ID == elementID {
			return element, nil
		}
	}
	return WorldCanvasElement{}, sql.ErrNoRows
}

// ---- 语义侧画布联动（文档版） ----

// findCanvasDocElement locates one element across the world's documents
// (promote carries worldId + elementId only). Returns the owning context.
func (w *WorldStore) findCanvasDocElement(db *sql.DB, worldID, elementID string) (string, WorldCanvasElement, error) {
	rows, err := db.Query("select context_id, doc_json from world_canvases where world_id = ? order by context_id", worldID)
	if err != nil {
		return "", WorldCanvasElement{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var contextID, raw string
		if err := rows.Scan(&contextID, &raw); err != nil {
			return "", WorldCanvasElement{}, err
		}
		payload, err := decodeCanvasDocPayload(raw)
		if err != nil {
			return "", WorldCanvasElement{}, err
		}
		for _, element := range payload.Elements {
			if element.ID == elementID {
				return contextID, element, nil
			}
		}
	}
	if err := rows.Err(); err != nil {
		return "", WorldCanvasElement{}, err
	}
	// Legacy fallback: migrated-late worlds may still carry the element only
	// in world_canvas rows.
	legacy, err := w.getCanvasElement(db, worldID, elementID)
	if err == nil {
		return legacy.ContextID, legacy, nil
	}
	return "", WorldCanvasElement{}, sql.ErrNoRows
}

// writeCanvasDocElement upserts one element into a document without an
// external version check (internal projection writes). Returns the doc.
func (w *WorldStore) writeCanvasDocElement(worldID, contextID string, element WorldCanvasElement) error {
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
	row, err := ensureCanvasDocInTx(tx, worldID, contextID)
	if err != nil {
		return err
	}
	elements := append([]WorldCanvasElement{}, row.payload.Elements...)
	element.WorldID = worldID
	element.ContextID = contextID
	replaced := false
	for i, existing := range elements {
		if existing.ID == element.ID {
			element.CreatedAt = existing.CreatedAt
			elements[i] = element
			replaced = true
			break
		}
	}
	if !replaced {
		element.CreatedAt = iso(time.Now().UTC())
		elements = append(elements, element)
	}
	if _, err := writeCanvasDocInTx(tx, worldID, contextID, row, canvasDocPayload{DocVersion: 1, Elements: elements}); err != nil {
		return err
	}
	return tx.Commit()
}

// removeCanvasDocElementsByRef removes projection elements matching a
// predicate from every document of the world (entity delete / revert cleanup).
func mutateCanvasDocsInTx(tx *sql.Tx, worldID string, drop func(WorldCanvasElement) bool) error {
	rows, err := tx.Query("select id, context_id, doc_json, version from world_canvases where world_id = ?", worldID)
	if err != nil {
		return err
	}
	type pendingDoc struct {
		id        string
		contextID string
		payload   canvasDocPayload
		version   int
	}
	pending := []pendingDoc{}
	for rows.Next() {
		var id, contextID, raw string
		var version int
		if err := rows.Scan(&id, &contextID, &raw, &version); err != nil {
			rows.Close()
			return err
		}
		payload, err := decodeCanvasDocPayload(raw)
		if err != nil {
			rows.Close()
			return err
		}
		pending = append(pending, pendingDoc{id: id, contextID: contextID, payload: payload, version: version})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, doc := range pending {
		kept := make([]WorldCanvasElement, 0, len(doc.payload.Elements))
		changed := false
		for _, element := range doc.payload.Elements {
			if drop(element) {
				changed = true
				continue
			}
			kept = append(kept, element)
		}
		if !changed {
			continue
		}
		encoded, err := encodeCanvasDocPayload(canvasDocPayload{DocVersion: 1, Elements: kept})
		if err != nil {
			return err
		}
		if _, err := tx.Exec("update world_canvases set doc_json = ?, version = version + 1, updated_at = ? where id = ?", encoded, iso(time.Now().UTC()), doc.id); err != nil {
			return err
		}
	}
	return nil
}

// syncAttrDocProjections is the panel → canvas half of the property-binding
// sync over documents: every attr element bound to the entity gets its
// props.value refreshed from the shared entity.content truth.
func (w *WorldStore) syncAttrDocProjections(worldID, entityID string, content map[string]any) {
	db, err := w.database()
	if err != nil {
		return
	}
	rows, err := db.Query("select id, context_id, doc_json from world_canvases where world_id = ?", worldID)
	if err != nil {
		return
	}
	type pendingDoc struct {
		id        string
		contextID string
		payload   canvasDocPayload
	}
	pending := []pendingDoc{}
	for rows.Next() {
		var id, contextID, raw string
		if err := rows.Scan(&id, &contextID, &raw); err != nil {
			rows.Close()
			return
		}
		payload, err := decodeCanvasDocPayload(raw)
		if err != nil {
			rows.Close()
			return
		}
		pending = append(pending, pendingDoc{id: id, contextID: contextID, payload: payload})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return
	}
	now := iso(time.Now().UTC())
	for _, doc := range pending {
		changed := false
		for i, element := range doc.payload.Elements {
			if element.Kind != "attr" || element.RefID != entityID {
				continue
			}
			field := strings.TrimSpace(stringProp(element.Props, "field"))
			if field == "" {
				continue
			}
			if current, ok := element.Props["value"]; ok && current == content[field] {
				continue
			}
			props := map[string]any{}
			for key, item := range element.Props {
				props[key] = item
			}
			props["value"] = content[field]
			doc.payload.Elements[i].Props = props
			changed = true
		}
		if !changed {
			continue
		}
		encoded, err := encodeCanvasDocPayload(doc.payload)
		if err != nil {
			continue
		}
		_, _ = db.Exec("update world_canvases set doc_json = ?, version = version + 1, updated_at = ? where id = ?", encoded, now, doc.id)
	}
}
