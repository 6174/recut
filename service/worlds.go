/*
 * [INPUT]: 依赖 Store 的 workspace.sqlite、MediaService 的 Asset 校验与标准库 SQLite/JSON 能力
 * [OUTPUT]: 对外提供 Creation Worlds 的平台拥有 WorldStore：World/Entity/Relation/AssetRef/Revision 的读写、
 * 分页与乐观并发、确定性 Canon 序列化与 SHA-256 哈希、CreationContext 投影、Project/Job 绑定与结构化 WorldsError
 * [POS]: service 的 Creation Worlds 存储边界；world_* 与 creation_context_bindings 表归平台 WorldStore 独占，
 * 普通 App 的 ctx.sqlite 永远看不到它们；所有跨 App 读取必须经 WorldsFacade（HTTP/MCP/ctx.worlds）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"
)

// WorldKind is the closed set of World creation templates. Templates only
// influence seed entities and defaults; the underlying model stays identical.
type WorldKind string

const (
	WorldCharacterIP  WorldKind = "character_ip"
	WorldCreatorBrand WorldKind = "creator_brand"
	WorldBrand        WorldKind = "brand"
	WorldFiction      WorldKind = "fiction_world"
	WorldCustom       WorldKind = "custom"
)

// WorldEntityKind is the closed set of Entity kinds every World may hold.
type WorldEntityKind string

const (
	EntityCharacter WorldEntityKind = "character"
	EntityLocation  WorldEntityKind = "location"
	EntityStory     WorldEntityKind = "story"
	EntityStyle     WorldEntityKind = "style"
	EntityRule      WorldEntityKind = "rule"
	EntityReference WorldEntityKind = "reference"
)

var worldKinds = map[WorldKind]bool{
	WorldCharacterIP: true, WorldCreatorBrand: true, WorldBrand: true, WorldFiction: true, WorldCustom: true,
}

var worldEntityKinds = map[WorldEntityKind]bool{
	EntityCharacter: true, EntityLocation: true, EntityStory: true, EntityStyle: true, EntityRule: true, EntityReference: true,
}

// assetReferenceRoles is the first-version closed set of semantic roles a
// completed global Asset can play inside a World.
var assetReferenceRoles = map[string]bool{
	"character_reference": true, "voice_reference": true, "location_reference": true,
	"style_reference": true, "story_reference": true, "brand_reference": true,
}

// Evidence describes why an asset belongs to a World. Role is kept solely as
// the legacy transport shape; purpose, modality and status are the Canon.
var evidencePurposes = map[string]bool{
	"identity": true, "appearance": true, "wardrobe": true, "voice": true,
	"motion": true, "scene": true, "mood": true, "visual_style": true,
	"sound_style": true, "narrative": true, "rule_evidence": true,
}

var evidenceStatuses = map[string]bool{
	"primary": true, "supporting": true, "counterexample": true, "archived": true,
}

var evidenceModalities = map[string]bool{
	"image": true, "video": true, "audio": true, "text": true, "research": true,
}

// WorldSelection is the explicit selection a consumer passes to resolve or
// binding. It never implies a global active World; worldId always accompanies it.
type WorldSelection struct {
	StoryID    string   `json:"storyId,omitempty"`
	EntityIDs  []string `json:"entityIds,omitempty"`
	AssetRoles []string `json:"assetRoles,omitempty"`
	Purpose    string   `json:"purpose"`
}

var worldPurposeKinds = map[string]bool{"chat": true, "video": true, "voice": true, "image": true, "cover": true, "agent": true}

type WorldSummary struct {
	ID                string                  `json:"id"`
	Name              string                  `json:"name"`
	Type              WorldKind               `json:"type"`
	Description       string                  `json:"description"`
	CoverAssetID      string                  `json:"coverAssetId,omitempty"`
	CurrentRevisionID string                  `json:"currentRevisionId"`
	EntityCounts      map[WorldEntityKind]int `json:"entityCounts"`
	UpdatedAt         string                  `json:"updatedAt"`
}

type WorldRevisionView struct {
	ID            string `json:"id"`
	CanonicalHash string `json:"canonicalHash"`
	CreatedAt     string `json:"createdAt"`
}

type WorldDetail struct {
	WorldSummary
	Identity             map[string]any    `json:"identity"`
	Revision             WorldRevisionView `json:"revision"`
	AvailableEntityKinds []WorldEntityKind `json:"availableEntityKinds"`
}

type WorldEntitySummary struct {
	ID        string          `json:"id"`
	WorldID   string          `json:"worldId"`
	Kind      WorldEntityKind `json:"kind"`
	Title     string          `json:"title"`
	Summary   string          `json:"summary"`
	UpdatedAt string          `json:"updatedAt"`
}

type WorldEntityRelation struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	FromEntityID string `json:"fromEntityId"`
	ToEntityID   string `json:"toEntityId"`
}

type WorldAssetReference struct {
	ID               string                `json:"id,omitempty"`
	AssetID          string                `json:"assetId"`
	AssetContentHash string                `json:"assetContentHash,omitempty"`
	Modality         string                `json:"modality"`
	Purpose          string                `json:"purpose"`
	Status           string                `json:"status"`
	Collection       string                `json:"collection,omitempty"`
	Segment          *WorldEvidenceSegment `json:"segment,omitempty"`
	Role             string                `json:"role,omitempty"`
	Label            string                `json:"label,omitempty"`
	EntityID         string                `json:"entityId,omitempty"`
}

// WorldEvidenceSegment pins the meaningful part of a long audio or video
// asset. A revision therefore freezes both bytes and the chosen moment.
type WorldEvidenceSegment struct {
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
}

// WorldEvidence is the product name for the previously under-specified asset
// reference. The alias preserves existing App/runtime callers while exposing a
// single richer Canon model everywhere else.
type WorldEvidence = WorldAssetReference

type WorldEntity struct {
	WorldEntitySummary
	Content    map[string]any        `json:"content"`
	Relations  []WorldEntityRelation `json:"relations"`
	References []WorldAssetReference `json:"references"`
}

type WorldContextIdentity struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	RevisionID    string `json:"revisionId"`
	CanonicalHash string `json:"canonicalHash"`
}

type WorldConstraints struct {
	Always []string `json:"always,omitempty"`
	Never  []string `json:"never,omitempty"`
	Prefer []string `json:"prefer,omitempty"`
}

type ResolvedWorldEntities struct {
	Characters []map[string]any `json:"characters,omitempty"`
	Locations  []map[string]any `json:"locations,omitempty"`
	Stories    []map[string]any `json:"stories,omitempty"`
	Styles     []map[string]any `json:"styles,omitempty"`
	Rules      []map[string]any `json:"rules,omitempty"`
	Story      map[string]any   `json:"story,omitempty"`
}

type CreationContext struct {
	World       WorldContextIdentity  `json:"world"`
	Selection   WorldSelection        `json:"selection"`
	Identity    map[string]any        `json:"identity"`
	Entities    ResolvedWorldEntities `json:"entities"`
	Constraints WorldConstraints      `json:"constraints"`
	References  []WorldAssetReference `json:"references"`
}

type CreationContextBinding struct {
	ID         string         `json:"id"`
	TargetType string         `json:"targetType"`
	TargetID   string         `json:"targetId"`
	WorldID    string         `json:"worldId"`
	RevisionID string         `json:"revisionId"`
	Selection  WorldSelection `json:"selection"`
	Role       string         `json:"role"`
	CreatedAt  string         `json:"createdAt"`
}

// WorldsError is the structured compatibility surface shared by HTTP, MCP and
// the SDK adapters. Go error strings are never a public contract.
type WorldsError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func (e *WorldsError) Error() string { return e.Message }

const (
	WorldsErrNotFound            = "WORLD_NOT_FOUND"
	WorldsErrEntityNotFound      = "ENTITY_NOT_FOUND"
	WorldsErrEntityWorldMismatch = "ENTITY_WORLD_MISMATCH"
	WorldsErrRevisionNotFound    = "WORLD_REVISION_NOT_FOUND"
	WorldsErrRevisionConflict    = "WORLD_REVISION_CONFLICT"
	WorldsErrContextInvalid      = "WORLD_CONTEXT_INVALID"
	WorldsErrAssetNotFound       = "ASSET_NOT_FOUND"
	WorldsErrAssetNotReady       = "ASSET_NOT_READY"
	WorldsErrProjectAlreadyBound = "PROJECT_WORLD_ALREADY_BOUND"
	WorldsErrAccessDenied        = "WORLD_ACCESS_DENIED"
)

func worldsError(code, message string) *WorldsError {
	return &WorldsError{Code: code, Message: message}
}

func asWorldsError(err error) *WorldsError {
	var worldErr *WorldsError
	if errors.As(err, &worldErr) {
		return worldErr
	}
	return &WorldsError{Code: "WORLD_CONTEXT_INVALID", Message: err.Error()}
}

// WorldStore owns every Creation Worlds table. It accepts only *Store and
// *MediaService, never an AppHost, HTTP request or MCP session, keeping it
// unit-testable and free of cyclic dependencies.
type WorldStore struct {
	store *Store
	media *MediaService
}

func NewWorldStore(store *Store, media *MediaService) *WorldStore {
	return &WorldStore{store: store, media: media}
}

func (w *WorldStore) database() (*sql.DB, error) {
	return w.store.WorkspaceDatabase()
}

// ListWorlds returns World summaries ordered by updated_at desc, with explicit
// pagination. World.get stays light on purpose: consumers call entity.list.
func (w *WorldStore) ListWorlds(input ListWorldsInput) ([]WorldSummary, string, error) {
	db, err := w.database()
	if err != nil {
		return nil, "", err
	}
	offset, limit := resolvePage(input.Cursor, input.Limit)
	where := []string{"archived_at is null"}
	args := []any{}
	if input.Type != "" {
		if !worldKinds[input.Type] {
			return nil, "", worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid world type %q", input.Type))
		}
		where = append(where, "type = ?")
		args = append(args, string(input.Type))
	}
	if input.Text != "" {
		where = append(where, "(name like ? or description like ?)")
		pattern := "%" + input.Text + "%"
		args = append(args, pattern, pattern)
	}
	args = append(args, limit, offset)
	rows, err := db.Query("select id from worlds where "+strings.Join(where, " and ")+" order by updated_at desc limit ? offset ?", args...)
	if err != nil {
		return nil, "", err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, "", err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	items := make([]WorldSummary, 0, len(ids))
	for _, id := range ids {
		summary, err := w.summary(db, id)
		if err != nil {
			return nil, "", err
		}
		items = append(items, summary)
	}
	nextCursor := ""
	if len(items) == limit {
		nextCursor = strconv.Itoa(offset + limit)
	}
	return items, nextCursor, nil
}

func (w *WorldStore) summary(db *sql.DB, worldID string) (WorldSummary, error) {
	var summary WorldSummary
	var createdAt, updatedAt string
	var coverAssetID sql.NullString
	var currentRevisionID sql.NullString
	row := db.QueryRow("select id, name, type, description, cover_asset_id, current_revision_id, created_at, updated_at from worlds where id = ?", worldID)
	if err := row.Scan(&summary.ID, &summary.Name, &summary.Type, &summary.Description, &coverAssetID, &currentRevisionID, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorldSummary{}, worldsError(WorldsErrNotFound, "world not found")
		}
		return WorldSummary{}, err
	}
	summary.EntityCounts = map[WorldEntityKind]int{}
	countRows, err := db.Query("select kind, count(*) from world_entities where world_id = ? and archived_at is null group by kind", worldID)
	if err != nil {
		return WorldSummary{}, err
	}
	defer countRows.Close()
	for countRows.Next() {
		var kind WorldEntityKind
		var count int
		if err := countRows.Scan(&kind, &count); err != nil {
			return WorldSummary{}, err
		}
		summary.EntityCounts[kind] = count
	}
	if err := countRows.Err(); err != nil {
		return WorldSummary{}, err
	}
	if coverAssetID.Valid {
		summary.CoverAssetID = coverAssetID.String
	}
	if currentRevisionID.Valid {
		summary.CurrentRevisionID = currentRevisionID.String
	}
	summary.UpdatedAt = updatedAt
	return summary, nil
}

func (w *WorldStore) GetWorld(worldID string) (WorldDetail, error) {
	db, err := w.database()
	if err != nil {
		return WorldDetail{}, err
	}
	detail := WorldDetail{}
	summary, err := w.summary(db, worldID)
	if err != nil {
		return WorldDetail{}, err
	}
	detail.WorldSummary = summary
	var identityJSON string
	var revisionID, canonicalHash, revisionCreatedAt string
	var cover sql.NullString
	row := db.QueryRow("select identity_json, current_revision_id, cover_asset_id from worlds where id = ?", worldID)
	if err := row.Scan(&identityJSON, &revisionID, &cover); err != nil {
		return WorldDetail{}, err
	}
	if err := json.Unmarshal([]byte(identityJSON), &detail.Identity); err != nil {
		return WorldDetail{}, err
	}
	if detail.Identity == nil {
		detail.Identity = map[string]any{}
	}
	if revisionID != "" {
		revRow := db.QueryRow("select id, canonical_hash, created_at from world_revisions where id = ?", revisionID)
		if err := revRow.Scan(&revisionID, &canonicalHash, &revisionCreatedAt); err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return WorldDetail{}, err
			}
		}
	}
	detail.Revision = WorldRevisionView{ID: revisionID, CanonicalHash: canonicalHash, CreatedAt: revisionCreatedAt}
	detail.AvailableEntityKinds = availableEntityKinds(detail.Type)
	return detail, nil
}

func availableEntityKinds(kind WorldKind) []WorldEntityKind {
	switch kind {
	case WorldCharacterIP:
		return []WorldEntityKind{EntityCharacter, EntityStory, EntityStyle, EntityRule, EntityReference, EntityLocation}
	case WorldCreatorBrand:
		return []WorldEntityKind{EntityStyle, EntityStory, EntityRule, EntityReference, EntityCharacter}
	case WorldBrand:
		return []WorldEntityKind{EntityStyle, EntityRule, EntityStory, EntityReference, EntityCharacter}
	case WorldFiction:
		return []WorldEntityKind{EntityCharacter, EntityLocation, EntityStory, EntityStyle, EntityRule, EntityReference}
	default:
		return []WorldEntityKind{EntityCharacter, EntityLocation, EntityStory, EntityStyle, EntityRule, EntityReference}
	}
}

func (w *WorldStore) CreateWorld(input CreateWorldInput) (WorldDetail, error) {
	if strings.TrimSpace(input.Name) == "" {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "world name is required")
	}
	if !worldKinds[input.Type] {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid world type %q", input.Type))
	}
	if input.Identity == nil {
		input.Identity = map[string]any{}
	}
	db, err := w.database()
	if err != nil {
		return WorldDetail{}, err
	}
	worldID, err := newID()
	if err != nil {
		return WorldDetail{}, err
	}
	now := iso(time.Now().UTC())
	identityJSON, err := json.Marshal(input.Identity)
	if err != nil {
		return WorldDetail{}, err
	}
	if input.CoverAssetID != "" {
		if _, _, err := w.validateEvidenceAsset(input.CoverAssetID); err != nil {
			return WorldDetail{}, err
		}
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldDetail{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("insert into worlds (id, name, type, description, identity_json, cover_asset_id, current_revision_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, '', ?, ?)",
		worldID, strings.TrimSpace(input.Name), string(input.Type), strings.TrimSpace(input.Description), string(identityJSON), input.CoverAssetID, now, now); err != nil {
		return WorldDetail{}, err
	}
	for _, template := range templateEntities(input.Type) {
		entityID, err := newID()
		if err != nil {
			return WorldDetail{}, err
		}
		contentJSON, _ := json.Marshal(template.Content)
		if _, err := tx.Exec("insert into world_entities (id, world_id, kind, title, summary, content_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
			entityID, worldID, string(template.Kind), template.Title, template.Summary, string(contentJSON), now, now); err != nil {
			return WorldDetail{}, err
		}
	}
	if _, err := w.commitRevision(tx, worldID, "world.created", "system"); err != nil {
		return WorldDetail{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldDetail{}, err
	}
	logWorldEvent("world.created", map[string]string{"worldId": worldID})
	return w.GetWorld(worldID)
}

func templateEntities(kind WorldKind) []struct {
	Kind    WorldEntityKind
	Title   string
	Summary string
	Content map[string]any
} {
	switch kind {
	case WorldCharacterIP:
		return []struct {
			Kind    WorldEntityKind
			Title   string
			Summary string
			Content map[string]any
		}{{Kind: EntityCharacter, Title: "主角角色", Summary: "角色的身份中心：性格、外观与声音的不可变事实。", Content: map[string]any{"appearance": "", "personality": "", "voice": ""}}}
	case WorldCreatorBrand:
		return []struct {
			Kind    WorldEntityKind
			Title   string
			Summary string
			Content map[string]any
		}{{Kind: EntityStyle, Title: "内容风格", Summary: "账号的编辑规范与表达风格。", Content: map[string]any{"kind": "text", "guidance": ""}}}
	case WorldBrand:
		return []struct {
			Kind    WorldEntityKind
			Title   string
			Summary string
			Content map[string]any
		}{{Kind: EntityStyle, Title: "视觉系统", Summary: "品牌的视觉与文案规范。", Content: map[string]any{"kind": "visual", "guidance": ""}}}
	case WorldFiction:
		return []struct {
			Kind    WorldEntityKind
			Title   string
			Summary string
			Content map[string]any
		}{{Kind: EntityLocation, Title: "初始地点", Summary: "世界观发生的初始地点。", Content: map[string]any{"description": ""}}}
	default:
		return []struct {
			Kind    WorldEntityKind
			Title   string
			Summary string
			Content map[string]any
		}{{Kind: EntityRule, Title: "核心规则", Summary: "这个世界最重要的约束。", Content: map[string]any{"type": "always", "text": ""}}}
	}
}

func (w *WorldStore) UpdateWorld(input UpdateWorldInput) (WorldDetail, error) {
	db, err := w.database()
	if err != nil {
		return WorldDetail{}, err
	}
	changed := false
	tx, err := db.Begin()
	if err != nil {
		return WorldDetail{}, err
	}
	defer tx.Rollback()
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return WorldDetail{}, err
	}
	now := iso(time.Now().UTC())
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return WorldDetail{}, worldsError(WorldsErrContextInvalid, "world name is required")
		}
		if _, err := tx.Exec("update worlds set name = ?, updated_at = ? where id = ?", name, now, input.WorldID); err != nil {
			return WorldDetail{}, err
		}
		changed = true
	}
	if input.Description != nil {
		if _, err := tx.Exec("update worlds set description = ?, updated_at = ? where id = ?", strings.TrimSpace(*input.Description), now, input.WorldID); err != nil {
			return WorldDetail{}, err
		}
		changed = true
	}
	if input.Identity != nil {
		identityJSON, err := json.Marshal(input.Identity)
		if err != nil {
			return WorldDetail{}, err
		}
		if _, err := tx.Exec("update worlds set identity_json = ?, updated_at = ? where id = ?", string(identityJSON), now, input.WorldID); err != nil {
			return WorldDetail{}, err
		}
		changed = true
	}
	if !changed {
		return w.GetWorld(input.WorldID)
	}
	if _, err := w.commitRevision(tx, input.WorldID, "world.updated", input.CreatedBy); err != nil {
		return WorldDetail{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldDetail{}, err
	}
	logWorldEvent("world.updated", map[string]string{"worldId": input.WorldID})
	return w.GetWorld(input.WorldID)
}

func (w *WorldStore) ListEntities(input ListEntitiesInput) ([]WorldEntitySummary, string, error) {
	db, err := w.database()
	if err != nil {
		return nil, "", err
	}
	if _, err := w.summary(db, input.WorldID); err != nil {
		return nil, "", err
	}
	offset, limit := resolvePage(input.Cursor, input.Limit)
	where := "world_id = ? and archived_at is null"
	args := []any{input.WorldID}
	if input.Kind != "" {
		if !worldEntityKinds[input.Kind] {
			return nil, "", worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid entity kind %q", input.Kind))
		}
		where += " and kind = ?"
		args = append(args, string(input.Kind))
	}
	if input.Text != "" {
		where += " and (title like ? or summary like ?)"
		pattern := "%" + input.Text + "%"
		args = append(args, pattern, pattern)
	}
	args = append(args, limit, offset)
	rows, err := db.Query("select id, kind, title, summary, updated_at from world_entities where "+where+" order by updated_at desc limit ? offset ?", args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	items := make([]WorldEntitySummary, 0)
	for rows.Next() {
		var item WorldEntitySummary
		item.WorldID = input.WorldID
		if err := rows.Scan(&item.ID, &item.Kind, &item.Title, &item.Summary, &item.UpdatedAt); err != nil {
			return nil, "", err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	nextCursor := ""
	if len(items) == limit {
		nextCursor = strconv.Itoa(offset + limit)
	}
	return items, nextCursor, nil
}

func (w *WorldStore) GetEntity(worldID, entityID string) (WorldEntity, error) {
	db, err := w.database()
	if err != nil {
		return WorldEntity{}, err
	}
	return w.getEntity(db, worldID, entityID)
}

func (w *WorldStore) getEntity(db *sql.DB, worldID, entityID string) (WorldEntity, error) {
	var entity WorldEntity
	var contentJSON string
	var createdAt, updatedAt string
	row := db.QueryRow("select id, kind, title, summary, content_json, created_at, updated_at from world_entities where id = ? and world_id = ? and archived_at is null", entityID, worldID)
	if err := row.Scan(&entity.ID, &entity.Kind, &entity.Title, &entity.Summary, &contentJSON, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorldEntity{}, worldsError(WorldsErrEntityNotFound, "entity not found in world")
		}
		return WorldEntity{}, err
	}
	entity.WorldID = worldID
	entity.UpdatedAt = updatedAt
	if err := json.Unmarshal([]byte(contentJSON), &entity.Content); err != nil {
		return WorldEntity{}, err
	}
	if entity.Content == nil {
		entity.Content = map[string]any{}
	}
	relationRows, err := db.Query("select id, relation_type, from_entity_id, to_entity_id from world_relations where world_id = ? and (from_entity_id = ? or to_entity_id = ?) order by created_at", worldID, entityID, entityID)
	if err != nil {
		return WorldEntity{}, err
	}
	defer relationRows.Close()
	entity.Relations = []WorldEntityRelation{}
	for relationRows.Next() {
		var relation WorldEntityRelation
		if err := relationRows.Scan(&relation.ID, &relation.Type, &relation.FromEntityID, &relation.ToEntityID); err != nil {
			return WorldEntity{}, err
		}
		entity.Relations = append(entity.Relations, relation)
	}
	if err := relationRows.Err(); err != nil {
		return WorldEntity{}, err
	}
	refRows, err := db.Query("select id, asset_id, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, entity_id from world_asset_refs where world_id = ? and entity_id = ? and archived_at is null order by sort_order, created_at", worldID, entityID)
	if err != nil {
		return WorldEntity{}, err
	}
	defer refRows.Close()
	entity.References = []WorldAssetReference{}
	for refRows.Next() {
		reference, err := scanWorldEvidence(refRows)
		if err != nil {
			return WorldEntity{}, err
		}
		entity.References = append(entity.References, reference)
	}
	if err := refRows.Err(); err != nil {
		return WorldEntity{}, err
	}
	return entity, nil
}

func (w *WorldStore) UpsertEntity(input UpsertEntityInput) (WorldEntity, error) {
	if input.Kind != "" && !worldEntityKinds[input.Kind] {
		return WorldEntity{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid entity kind %q", input.Kind))
	}
	if input.Content == nil {
		input.Content = map[string]any{}
	}
	db, err := w.database()
	if err != nil {
		return WorldEntity{}, err
	}
	if _, err := w.summary(db, input.WorldID); err != nil {
		return WorldEntity{}, err
	}
	if input.EntityID != "" {
		var existing WorldEntity
		existing, err = w.getEntity(db, input.WorldID, input.EntityID)
		if err != nil {
			return WorldEntity{}, err
		}
		if input.Kind != "" && input.Kind != existing.Kind {
			return WorldEntity{}, worldsError(WorldsErrContextInvalid, "entity kind cannot change on update")
		}
		input.Kind = existing.Kind
	} else if input.Kind == "" {
		return WorldEntity{}, worldsError(WorldsErrContextInvalid, "entity kind is required when creating an entity")
	}
	now := iso(time.Now().UTC())
	contentJSON, err := json.Marshal(input.Content)
	if err != nil {
		return WorldEntity{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldEntity{}, err
	}
	defer tx.Rollback()
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return WorldEntity{}, err
	}
	entityID := input.EntityID
	if entityID == "" {
		entityID, err = newID()
		if err != nil {
			return WorldEntity{}, err
		}
		if _, err := tx.Exec("insert into world_entities (id, world_id, kind, title, summary, content_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
			entityID, input.WorldID, string(input.Kind), strings.TrimSpace(input.Title), strings.TrimSpace(input.Summary), string(contentJSON), now, now); err != nil {
			return WorldEntity{}, err
		}
	} else {
		if _, err := tx.Exec("update world_entities set title = ?, summary = ?, content_json = ?, updated_at = ? where id = ? and world_id = ?",
			strings.TrimSpace(input.Title), strings.TrimSpace(input.Summary), string(contentJSON), now, entityID, input.WorldID); err != nil {
			return WorldEntity{}, err
		}
	}
	if _, err := w.commitRevision(tx, input.WorldID, "entity.upserted", input.CreatedBy); err != nil {
		return WorldEntity{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldEntity{}, err
	}
	logWorldEvent("world.entity.upserted", map[string]string{"worldId": input.WorldID, "entityId": entityID})
	return w.getEntity(db, input.WorldID, entityID)
}

func (w *WorldStore) AttachReference(input AttachReferenceInput) (WorldAssetReference, error) {
	if input.Purpose == "" {
		input.Purpose = legacyPurpose(input.Role)
	}
	if input.Status == "" {
		input.Status = "supporting"
	}
	if !evidencePurposes[input.Purpose] {
		return WorldAssetReference{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid evidence purpose %q", input.Purpose))
	}
	if !evidenceStatuses[input.Status] {
		return WorldAssetReference{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid evidence status %q", input.Status))
	}
	if input.Role == "" {
		// The old unique key includes role. Make the invisible storage key follow
		// purpose so one asset can honestly serve, for example, both appearance
		// and wardrobe evidence without pretending those are the same fact.
		input.Role = "evidence:" + input.Purpose
	}
	if !assetReferenceRoles[input.Role] && !strings.HasPrefix(input.Role, "evidence:") {
		return WorldAssetReference{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid asset reference role %q", input.Role))
	}
	if strings.TrimSpace(input.AssetID) == "" {
		return WorldAssetReference{}, worldsError(WorldsErrContextInvalid, "assetId is required")
	}
	db, err := w.database()
	if err != nil {
		return WorldAssetReference{}, err
	}
	if _, err := w.summary(db, input.WorldID); err != nil {
		return WorldAssetReference{}, err
	}
	if input.EntityID != "" {
		if _, err := w.getEntity(db, input.WorldID, input.EntityID); err != nil {
			return WorldAssetReference{}, err
		}
	}
	modality, contentHash, err := w.validateEvidenceAsset(input.AssetID)
	if err != nil {
		return WorldAssetReference{}, err
	}
	if input.Modality != "" && input.Modality != modality {
		return WorldAssetReference{}, worldsError(WorldsErrContextInvalid, "evidence modality must match the selected asset")
	}
	if input.Segment != nil && (modality != "audio" && modality != "video" || input.Segment.StartSec < 0 || input.Segment.EndSec <= input.Segment.StartSec) {
		return WorldAssetReference{}, worldsError(WorldsErrContextInvalid, "a segment must be a valid audio or video time range")
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldAssetReference{}, err
	}
	defer tx.Rollback()
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return WorldAssetReference{}, err
	}
	now := iso(time.Now().UTC())
	var nextSort sql.NullInt64
	if err := tx.QueryRow("select max(sort_order) + 1 from world_asset_refs where world_id = ?", input.WorldID).Scan(&nextSort); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return WorldAssetReference{}, err
	}
	sortOrder := 0
	if nextSort.Valid {
		sortOrder = int(nextSort.Int64)
	}
	segmentJSON := ""
	if input.Segment != nil {
		encoded, err := json.Marshal(input.Segment)
		if err != nil {
			return WorldAssetReference{}, err
		}
		segmentJSON = string(encoded)
	}
	reference := WorldAssetReference{AssetID: input.AssetID, AssetContentHash: contentHash, Modality: modality,
		Purpose: input.Purpose, Status: input.Status, Collection: strings.TrimSpace(input.Collection), Segment: input.Segment,
		Role: input.Role, Label: strings.TrimSpace(input.Label), EntityID: input.EntityID}
	reference.ID, err = newID()
	if err != nil {
		return WorldAssetReference{}, err
	}
	if _, err := tx.Exec("insert into world_asset_refs (id, world_id, entity_id, asset_id, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, sort_order, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		reference.ID, input.WorldID, reference.EntityID, reference.AssetID, reference.AssetContentHash, reference.Modality, reference.Purpose, reference.Status, reference.Collection, segmentJSON, reference.Role, reference.Label, sortOrder, now); err != nil {
		return WorldAssetReference{}, err
	}
	revisionID, err := w.commitRevision(tx, input.WorldID, "reference.attached", input.CreatedBy)
	if err != nil {
		return WorldAssetReference{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldAssetReference{}, err
	}
	logWorldEvent("world.reference.attached", map[string]string{"worldId": input.WorldID, "assetId": reference.AssetID})
	_ = revisionID
	return reference, nil
}

// validateEvidenceAsset freezes the immutable binary identity and derives the
// modality from the Asset truth; clients never get to claim one arbitrarily.
func (w *WorldStore) validateEvidenceAsset(assetID string) (string, string, error) {
	if w.media == nil {
		return "", "", worldsError(WorldsErrAccessDenied, "media service is unavailable")
	}
	asset, err := w.media.GetAsset(strings.TrimSpace(assetID))
	if err != nil {
		return "", "", worldsError(WorldsErrAssetNotFound, "asset not found")
	}
	if asset.Status != "completed" {
		return "", "", worldsError(WorldsErrAssetNotReady, "asset is not ready")
	}
	modality := asset.Kind
	if modality == "reference" {
		modality = "research"
	}
	if !evidenceModalities[modality] {
		return "", "", worldsError(WorldsErrContextInvalid, "asset cannot be used as World evidence")
	}
	return modality, asset.ContentHash, nil
}

func legacyPurpose(role string) string {
	switch role {
	case "character_reference":
		return "appearance"
	case "voice_reference":
		return "voice"
	case "location_reference":
		return "scene"
	case "style_reference":
		return "visual_style"
	case "story_reference":
		return "narrative"
	case "brand_reference":
		return "identity"
	default:
		return "visual_style"
	}
}

func scanWorldEvidence(row interface{ Scan(...any) error }) (WorldEvidence, error) {
	var evidence WorldEvidence
	var segmentJSON string
	var entityID sql.NullString
	if err := row.Scan(&evidence.ID, &evidence.AssetID, &evidence.AssetContentHash, &evidence.Modality, &evidence.Purpose, &evidence.Status, &evidence.Collection, &segmentJSON, &evidence.Role, &evidence.Label, &entityID); err != nil {
		return WorldEvidence{}, err
	}
	if evidence.Purpose == "" {
		evidence.Purpose = legacyPurpose(evidence.Role)
	}
	if evidence.Status == "" {
		evidence.Status = "supporting"
	}
	if strings.TrimSpace(segmentJSON) != "" {
		_ = json.Unmarshal([]byte(segmentJSON), &evidence.Segment)
	}
	if entityID.Valid {
		evidence.EntityID = entityID.String
	}
	return evidence, nil
}

// rowQuerier is satisfied by both *sql.DB and *sql.Tx, so optimistic revision
// checks can run inside the write transaction that applies the mutation.
type rowQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

// checkWorldRevision enforces optimistic concurrency: an expected revision that
// no longer matches returns a structured conflict, never a silent overwrite.
func (w *WorldStore) checkWorldRevision(db rowQuerier, worldID, expectedRevisionID string) error {
	if expectedRevisionID == "" {
		return nil
	}
	var current string
	row := db.QueryRow("select current_revision_id from worlds where id = ?", worldID)
	if err := row.Scan(&current); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return worldsError(WorldsErrNotFound, "world not found")
		}
		return err
	}
	if current != expectedRevisionID {
		return &WorldsError{
			Code:    WorldsErrRevisionConflict,
			Message: "world revision has changed since the caller's snapshot",
			Details: map[string]any{"expectedRevisionId": expectedRevisionID, "currentRevisionId": current},
		}
	}
	return nil
}

// commitRevision recomputes the deterministic Canon from the transaction state,
// inserts a new immutable revision only when the canonical hash differs, and
// advances worlds.current_revision_id. Pure UI ordering never changes the hash.
func (w *WorldStore) commitRevision(tx *sql.Tx, worldID, reason, createdBy string) (string, error) {
	canonical, hash, err := w.computeCanonicalTx(tx, worldID)
	if err != nil {
		return "", err
	}
	var currentHash string
	row := tx.QueryRow("select current_revision_id from worlds where id = ?", worldID)
	var currentRevisionID string
	if err := row.Scan(&currentRevisionID); err != nil {
		return "", err
	}
	if currentRevisionID != "" {
		if err := tx.QueryRow("select canonical_hash from world_revisions where id = ?", currentRevisionID).Scan(&currentHash); err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return "", err
			}
		}
	}
	if currentHash == hash && currentRevisionID != "" {
		return currentRevisionID, nil
	}
	// A semantic edit can deliberately return Canon to a previous state (for
	// example, archiving the last added reference). Revisions are immutable and
	// de-duplicated by hash, so move the head back to that existing snapshot
	// rather than attempting an identical insert.
	var existingRevisionID string
	if err := tx.QueryRow("select id from world_revisions where world_id = ? and canonical_hash = ?", worldID, hash).Scan(&existingRevisionID); err == nil {
		now := iso(time.Now().UTC())
		if _, err := tx.Exec("update worlds set current_revision_id = ?, updated_at = ? where id = ?", existingRevisionID, now, worldID); err != nil {
			return "", err
		}
		return existingRevisionID, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	revisionID, err := newID()
	if err != nil {
		return "", err
	}
	now := iso(time.Now().UTC())
	if _, err := tx.Exec("insert into world_revisions (id, world_id, canonical_json, canonical_hash, reason, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?)",
		revisionID, worldID, canonical, hash, reason, createdBy, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec("update worlds set current_revision_id = ?, updated_at = ? where id = ?", revisionID, now, worldID); err != nil {
		return "", err
	}
	return revisionID, nil
}

// computeCanonicalTx loads the full World state through the transaction so the
// Canon always matches exactly what is about to be committed.
func (w *WorldStore) computeCanonicalTx(tx *sql.Tx, worldID string) (string, string, error) {
	identity := map[string]any{}
	var name, description, worldType, identityJSON string
	if err := tx.QueryRow("select name, type, description, identity_json from worlds where id = ?", worldID).Scan(&name, &worldType, &description, &identityJSON); err != nil {
		return "", "", err
	}
	_ = json.Unmarshal([]byte(identityJSON), &identity)

	entities := map[WorldEntityKind][]map[string]any{}
	rows, err := tx.Query("select id, kind, title, summary, content_json from world_entities where world_id = ? and archived_at is null order by kind, id", worldID)
	if err != nil {
		return "", "", err
	}
	for rows.Next() {
		var id, kind, title, summary, contentJSON string
		if err := rows.Scan(&id, &kind, &title, &summary, &contentJSON); err != nil {
			rows.Close()
			return "", "", err
		}
		content := map[string]any{}
		_ = json.Unmarshal([]byte(contentJSON), &content)
		record := map[string]any{"id": id, "title": title, "summary": summary}
		for key, value := range content {
			record[key] = value
		}
		entities[WorldEntityKind(kind)] = append(entities[WorldEntityKind(kind)], record)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", "", err
	}

	relations := []map[string]any{}
	relationRows, err := tx.Query("select id, relation_type, from_entity_id, to_entity_id, metadata_json from world_relations where world_id = ? order by id", worldID)
	if err != nil {
		return "", "", err
	}
	for relationRows.Next() {
		var id, relationType, fromEntityID, toEntityID, metadataJSON string
		if err := relationRows.Scan(&id, &relationType, &fromEntityID, &toEntityID, &metadataJSON); err != nil {
			relationRows.Close()
			return "", "", err
		}
		metadata := map[string]any{}
		_ = json.Unmarshal([]byte(metadataJSON), &metadata)
		relations = append(relations, map[string]any{"id": id, "type": relationType, "from": fromEntityID, "to": toEntityID, "metadata": metadata})
	}
	relationRows.Close()
	if err := relationRows.Err(); err != nil {
		return "", "", err
	}

	references := []map[string]any{}
	refRows, err := tx.Query("select id, asset_id, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, entity_id from world_asset_refs where world_id = ? and archived_at is null order by id", worldID)
	if err != nil {
		return "", "", err
	}
	for refRows.Next() {
		evidence, err := scanWorldEvidence(refRows)
		if err != nil {
			refRows.Close()
			return "", "", err
		}
		record := map[string]any{"id": evidence.ID, "assetId": evidence.AssetID, "assetContentHash": evidence.AssetContentHash,
			"modality": evidence.Modality, "purpose": evidence.Purpose, "status": evidence.Status,
			"collection": evidence.Collection, "role": evidence.Role, "label": evidence.Label}
		if evidence.Segment != nil {
			record["segment"] = evidence.Segment
		}
		if evidence.EntityID != "" {
			record["entityId"] = evidence.EntityID
		}
		references = append(references, record)
	}
	refRows.Close()
	if err := refRows.Err(); err != nil {
		return "", "", err
	}

	canonical := map[string]any{
		"world": map[string]any{
			"name":        name,
			"type":        worldType,
			"description": description,
		},
		"identity":   identity,
		"entities":   entityMap(entities),
		"relations":  relations,
		"references": references,
	}
	encoded, err := canonicalJSON(canonical)
	if err != nil {
		return "", "", err
	}
	hash := sha256.Sum256(encoded)
	return string(encoded), "sha256:" + hex.EncodeToString(hash[:]), nil
}

func entityMap(entities map[WorldEntityKind][]map[string]any) map[string]any {
	result := map[string]any{}
	kinds := make([]string, 0, len(entities))
	for kind := range entities {
		kinds = append(kinds, string(kind))
	}
	sort.Strings(kinds)
	for _, kind := range kinds {
		result[kind] = entities[WorldEntityKind(kind)]
	}
	return result
}

// canonicalJSON marshals a value with recursively sorted map keys, producing the
// deterministic UTF-8 byte stream that canonical_hash commits to.
func canonicalJSON(value any) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var normalized any
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return nil, err
	}
	return json.Marshal(sortJSONKeys(normalized))
}

func sortJSONKeys(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		sorted := make(map[string]any, len(typed))
		for _, key := range keys {
			sorted[key] = sortJSONKeys(typed[key])
		}
		return sorted
	case []any:
		for index := range typed {
			typed[index] = sortJSONKeys(typed[index])
		}
		return typed
	default:
		return value
	}
}

// Resolve projects a stable, consumer-facing CreationContext from the World's
// canonical state and an explicit selection. It never exposes world_* tables.
func (w *WorldStore) Resolve(input ResolveInput) (CreationContext, error) {
	if input.WorldID == "" {
		return CreationContext{}, worldsError(WorldsErrContextInvalid, "worldId is required")
	}
	if input.Selection.Purpose == "" {
		input.Selection.Purpose = "agent"
	}
	if !worldPurposeKinds[input.Selection.Purpose] {
		return CreationContext{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid selection purpose %q", input.Selection.Purpose))
	}
	db, err := w.database()
	if err != nil {
		return CreationContext{}, err
	}
	world, err := w.GetWorld(input.WorldID)
	if err != nil {
		return CreationContext{}, err
	}
	revisionID := input.RevisionID
	if revisionID == "" {
		revisionID = world.CurrentRevisionID
	}
	var canonicalJSON string
	var canonicalHash string
	revRow := db.QueryRow("select canonical_json, canonical_hash from world_revisions where id = ? and world_id = ?", revisionID, input.WorldID)
	if err := revRow.Scan(&canonicalJSON, &canonicalHash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CreationContext{}, worldsError(WorldsErrRevisionNotFound, "world revision not found")
		}
		return CreationContext{}, err
	}
	canonical := map[string]any{}
	if err := json.Unmarshal([]byte(canonicalJSON), &canonical); err != nil {
		return CreationContext{}, err
	}
	selection, err := validateSelectionCanonical(canonical, input.Selection)
	if err != nil {
		return CreationContext{}, err
	}
	context := w.projectContext(world, canonical, revisionID, canonicalHash, selection)
	logWorldEvent("world.context.resolved", map[string]string{"worldId": input.WorldID, "revisionId": revisionID})
	return context, nil
}

// validateSelectionCanonical verifies every selected entity exists inside the
// frozen revision's canonical payload. A bound Project therefore keeps resolving
// its original Context even after the World is edited or an entity is deleted.
func validateSelectionCanonical(canonical map[string]any, selection WorldSelection) (WorldSelection, error) {
	entityIDs := map[string]bool{}
	entities, _ := canonical["entities"].(map[string]any)
	for _, bucket := range entities {
		records, _ := bucket.([]any)
		for _, raw := range records {
			record, _ := raw.(map[string]any)
			if id, ok := record["id"].(string); ok {
				entityIDs[id] = true
			}
		}
	}
	candidates := append([]string{}, selection.EntityIDs...)
	if selection.StoryID != "" {
		candidates = append(candidates, selection.StoryID)
	}
	for _, entityID := range candidates {
		if !entityIDs[entityID] {
			return WorldSelection{}, &WorldsError{
				Code:    WorldsErrEntityWorldMismatch,
				Message: "selected entity is not part of this world revision",
				Details: map[string]any{"entityId": entityID},
			}
		}
	}
	deduped := make([]string, 0, len(selection.EntityIDs))
	seen := map[string]bool{}
	for _, id := range selection.EntityIDs {
		if !seen[id] {
			seen[id] = true
			deduped = append(deduped, id)
		}
	}
	selection.EntityIDs = deduped
	return selection, nil
}

// validateSelection verifies every selected entity belongs to the World, so a
// consumer can never pull entities across World boundaries.
func (w *WorldStore) validateSelection(db *sql.DB, worldID string, selection WorldSelection) (WorldSelection, error) {
	candidates := append([]string{}, selection.EntityIDs...)
	if selection.StoryID != "" {
		candidates = append(candidates, selection.StoryID)
	}
	for _, entityID := range candidates {
		var count int
		if err := db.QueryRow("select count(*) from world_entities where id = ? and world_id = ? and archived_at is null", entityID, worldID).Scan(&count); err != nil {
			return WorldSelection{}, err
		}
		if count == 0 {
			return WorldSelection{}, &WorldsError{
				Code:    WorldsErrEntityWorldMismatch,
				Message: "selected entity does not belong to the world",
				Details: map[string]any{"worldId": worldID, "entityId": entityID},
			}
		}
	}
	deduped := make([]string, 0, len(selection.EntityIDs))
	seen := map[string]bool{}
	for _, id := range selection.EntityIDs {
		if !seen[id] {
			seen[id] = true
			deduped = append(deduped, id)
		}
	}
	selection.EntityIDs = deduped
	return selection, nil
}

func (w *WorldStore) projectContext(world WorldDetail, canonical map[string]any, revisionID, canonicalHash string, selection WorldSelection) CreationContext {
	context := CreationContext{
		World: WorldContextIdentity{
			ID: world.ID, Name: world.Name, RevisionID: revisionID, CanonicalHash: canonicalHash,
		},
		Selection:  selection,
		Identity:   world.Identity,
		References: []WorldAssetReference{},
	}
	entities, _ := canonical["entities"].(map[string]any)
	references, _ := canonical["references"].([]any)

	selected := map[string]bool{}
	for _, id := range selection.EntityIDs {
		selected[id] = true
	}
	if selection.StoryID != "" {
		selected[selection.StoryID] = true
	}
	includeAll := len(selected) == 0

	for kind, bucket := range entities {
		records, _ := bucket.([]any)
		for _, raw := range records {
			record, _ := raw.(map[string]any)
			id, _ := record["id"].(string)
			if !includeAll && !selected[id] {
				continue
			}
			switch WorldEntityKind(kind) {
			case EntityCharacter:
				context.Entities.Characters = append(context.Entities.Characters, w.entityView(record, "name"))
			case EntityLocation:
				context.Entities.Locations = append(context.Entities.Locations, w.entityView(record, "name"))
			case EntityStory:
				view := w.entityView(record, "name")
				if selection.StoryID != "" && id == selection.StoryID {
					context.Entities.Story = view
				} else {
					context.Entities.Stories = append(context.Entities.Stories, view)
				}
			case EntityStyle:
				context.Entities.Styles = append(context.Entities.Styles, w.entityView(record, "name"))
			case EntityRule:
				view := w.entityView(record, "title")
				context.Entities.Rules = append(context.Entities.Rules, view)
				text := ruleText(record)
				switch ruleType(record) {
				case "never":
					context.Constraints.Never = append(context.Constraints.Never, text)
				case "prefer":
					context.Constraints.Prefer = append(context.Constraints.Prefer, text)
				default:
					context.Constraints.Always = append(context.Constraints.Always, text)
				}
			}
		}
	}
	desiredRoles := map[string]bool{}
	for _, role := range selection.AssetRoles {
		desiredRoles[role] = true
	}
	for _, raw := range references {
		record, _ := raw.(map[string]any)
		encoded, _ := json.Marshal(record)
		reference := WorldAssetReference{}
		_ = json.Unmarshal(encoded, &reference)
		entityMatches := reference.EntityID == "" || includeAll || selected[reference.EntityID]
		roleMatches := desiredRoles[reference.Role] && reference.EntityID == ""
		if entityMatches || roleMatches {
			context.References = append(context.References, reference)
		}
	}
	return context
}

// ListEvidence exposes all current evidence, including World-level evidence
// that cannot appear in an individual entity response.
func (w *WorldStore) ListEvidence(worldID string) ([]WorldEvidence, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, asset_id, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, entity_id from world_asset_refs where world_id = ? and archived_at is null order by collection_name, sort_order, created_at", worldID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []WorldEvidence{}
	for rows.Next() {
		evidence, err := scanWorldEvidence(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, evidence)
	}
	return items, rows.Err()
}

// ArchiveEvidenceForAsset is called before a user removes an Asset. Archiving
// is itself a Canon mutation: the next revision records why current creation
// no longer uses the evidence, while older revisions remain reproducible.
func (w *WorldStore) ArchiveEvidenceForAsset(assetID string) error {
	db, err := w.database()
	if err != nil {
		return err
	}
	rows, err := db.Query("select distinct world_id from world_asset_refs where asset_id = ? and archived_at is null", assetID)
	if err != nil {
		return err
	}
	worldIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		worldIDs = append(worldIDs, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, worldID := range worldIDs {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		now := iso(time.Now().UTC())
		if _, err = tx.Exec("update world_asset_refs set evidence_status = 'archived', archived_at = ? where world_id = ? and asset_id = ? and archived_at is null", now, worldID, assetID); err == nil {
			_, err = w.commitRevision(tx, worldID, "evidence.archived", "media")
		}
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		logWorldEvent("world.evidence.archived", map[string]string{"worldId": worldID, "assetId": assetID})
	}
	return nil
}

// ArchiveEvidence removes one evidence item from the current Canon without
// erasing the frozen revisions that already used it.
func (w *WorldStore) ArchiveEvidence(input ArchiveEvidenceInput) error {
	db, err := w.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return err
	}
	now := iso(time.Now().UTC())
	result, err := tx.Exec("update world_asset_refs set evidence_status = 'archived', archived_at = ? where id = ? and world_id = ? and archived_at is null", now, input.EvidenceID, input.WorldID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return worldsError(WorldsErrNotFound, "world evidence not found")
	}
	if _, err := w.commitRevision(tx, input.WorldID, "evidence.archived", input.CreatedBy); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	logWorldEvent("world.evidence.archived", map[string]string{"worldId": input.WorldID, "evidenceId": input.EvidenceID})
	return nil
}

// UpdateEvidence changes how an existing piece of media describes a World.
// The media bytes and its frozen content hash remain untouched.
func (w *WorldStore) UpdateEvidence(input UpdateEvidenceInput) (WorldEvidence, error) {
	if !evidencePurposes[input.Purpose] {
		return WorldEvidence{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid evidence purpose %q", input.Purpose))
	}
	if !evidenceStatuses[input.Status] {
		return WorldEvidence{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid evidence status %q", input.Status))
	}
	db, err := w.database()
	if err != nil {
		return WorldEvidence{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldEvidence{}, err
	}
	defer tx.Rollback()
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return WorldEvidence{}, err
	}
	result, err := tx.Exec("update world_asset_refs set purpose = ?, evidence_status = ?, role = ?, label = ? where id = ? and world_id = ? and archived_at is null", input.Purpose, input.Status, "evidence:"+input.Purpose, strings.TrimSpace(input.Label), input.EvidenceID, input.WorldID)
	if err != nil {
		return WorldEvidence{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return WorldEvidence{}, err
	}
	if changed == 0 {
		return WorldEvidence{}, worldsError(WorldsErrNotFound, "world evidence not found")
	}
	if _, err := w.commitRevision(tx, input.WorldID, "evidence.updated", input.CreatedBy); err != nil {
		return WorldEvidence{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldEvidence{}, err
	}
	row := db.QueryRow("select id, asset_id, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, entity_id from world_asset_refs where id = ? and world_id = ?", input.EvidenceID, input.WorldID)
	evidence, err := scanWorldEvidence(row)
	if err != nil {
		return WorldEvidence{}, err
	}
	logWorldEvent("world.evidence.updated", map[string]string{"worldId": input.WorldID, "evidenceId": input.EvidenceID})
	return evidence, nil
}

func (w *WorldStore) entityView(record map[string]any, nameKey string) map[string]any {
	view := map[string]any{}
	if id, ok := record["id"].(string); ok {
		view["id"] = id
	}
	if title, ok := record["title"].(string); ok {
		view[nameKey] = title
	}
	for key, value := range record {
		if key == "id" || key == "title" || key == "summary" {
			continue
		}
		view[key] = value
	}
	return view
}

func ruleType(record map[string]any) string {
	switch typed := record["type"].(string); typed {
	case "never", "prefer", "always":
		return typed
	default:
		return "always"
	}
}

func ruleText(record map[string]any) string {
	if text, ok := record["text"].(string); ok && strings.TrimSpace(text) != "" {
		return text
	}
	if guidance, ok := record["guidance"].(string); ok && strings.TrimSpace(guidance) != "" {
		return guidance
	}
	title, _ := record["title"].(string)
	return title
}

// BindMediaJob freezes a World revision to a media generation Job target so
// downstream Asset metadata and Artifacts can trace their World source.
func (w *WorldStore) BindMediaJob(jobID, worldID, revisionID string, selection WorldSelection, replace bool, createdBy string) (CreationContextBinding, error) {
	if strings.TrimSpace(jobID) == "" {
		return CreationContextBinding{}, worldsError(WorldsErrContextInvalid, "jobId is required")
	}
	if w.media != nil {
		if _, err := w.media.GetJob(jobID); err != nil {
			return CreationContextBinding{}, worldsError(WorldsErrContextInvalid, "media job not found")
		}
	}
	return w.bindTarget("media_job", jobID, worldID, revisionID, selection, replace, createdBy)
}

// BindProject freezes a World revision to a Project target under one
// transaction. A Project already holding a primary binding is rejected unless
// the caller explicitly replaces it. Returns the platform-owned binding row.
func (w *WorldStore) BindProject(input BindProjectInput) (CreationContextBinding, error) {
	if input.ProjectID == "" {
		return CreationContextBinding{}, worldsError(WorldsErrContextInvalid, "projectId is required")
	}
	if input.AppID != "" {
		if err := w.store.projectOwnedBy(input.ProjectID, input.AppID); err != nil {
			return CreationContextBinding{}, worldsError(WorldsErrAccessDenied, err.Error())
		}
	} else if _, err := w.store.Get(input.ProjectID); err != nil {
		return CreationContextBinding{}, worldsError(WorldsErrContextInvalid, "project not found")
	}
	return w.bindTarget("project", input.ProjectID, input.WorldID, input.RevisionID, input.Selection, input.Replace, input.CreatedBy)
}

func (w *WorldStore) bindTarget(targetType, targetID, worldID, revisionID string, selection WorldSelection, replace bool, createdBy string) (CreationContextBinding, error) {
	db, err := w.database()
	if err != nil {
		return CreationContextBinding{}, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return CreationContextBinding{}, err
	}
	revision, err := w.resolveRevision(db, worldID, revisionID)
	if err != nil {
		return CreationContextBinding{}, err
	}
	if _, err := w.validateSelection(db, worldID, selection); err != nil {
		return CreationContextBinding{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return CreationContextBinding{}, err
	}
	defer tx.Rollback()
	var existingID string
	row := tx.QueryRow("select id from creation_context_bindings where target_type = ? and target_id = ? and role = ?", targetType, targetID, "primary")
	if err := row.Scan(&existingID); err == nil {
		if !replace {
			return CreationContextBinding{}, worldsError(WorldsErrProjectAlreadyBound, "target already has a primary world binding")
		}
		if _, err := tx.Exec("delete from creation_context_bindings where id = ?", existingID); err != nil {
			return CreationContextBinding{}, err
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CreationContextBinding{}, err
	}
	bindingID, err := newID()
	if err != nil {
		return CreationContextBinding{}, err
	}
	selectionJSON, err := json.Marshal(selection)
	if err != nil {
		return CreationContextBinding{}, err
	}
	now := iso(time.Now().UTC())
	if _, err := tx.Exec("insert into creation_context_bindings (id, target_type, target_id, world_id, revision_id, selection_json, role, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
		bindingID, targetType, targetID, worldID, revision.ID, string(selectionJSON), "primary", now); err != nil {
		return CreationContextBinding{}, err
	}
	if err := tx.Commit(); err != nil {
		return CreationContextBinding{}, err
	}
	binding := CreationContextBinding{
		ID: bindingID, TargetType: targetType, TargetID: targetID,
		WorldID: worldID, RevisionID: revision.ID, Selection: selection, Role: "primary", CreatedAt: now,
	}
	eventType := "creation_context.bound"
	if existingID != "" {
		eventType = "creation_context.replaced"
	}
	logWorldEvent(eventType, map[string]string{"targetType": targetType, "targetId": targetID, "worldId": worldID})
	return binding, nil
}

func (w *WorldStore) resolveRevision(db *sql.DB, worldID, revisionID string) (WorldRevisionView, error) {
	if revisionID == "" {
		var current string
		if err := db.QueryRow("select current_revision_id from worlds where id = ?", worldID).Scan(&current); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return WorldRevisionView{}, worldsError(WorldsErrNotFound, "world not found")
			}
			return WorldRevisionView{}, err
		}
		revisionID = current
	}
	var revision WorldRevisionView
	var createdAt string
	if err := db.QueryRow("select id, canonical_hash, created_at from world_revisions where id = ? and world_id = ?", revisionID, worldID).Scan(&revision.ID, &revision.CanonicalHash, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorldRevisionView{}, worldsError(WorldsErrRevisionNotFound, "world revision not found")
		}
		return WorldRevisionView{}, err
	}
	revision.CreatedAt = createdAt
	return revision, nil
}

// GetProjectBinding returns the primary binding of a Project, or nil when the
// Project is unbound. A missing binding is a value, never an error.
func (w *WorldStore) GetProjectBinding(projectID string) (*CreationContextBinding, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	var binding CreationContextBinding
	var selectionJSON, createdAt string
	row := db.QueryRow("select id, target_type, target_id, world_id, revision_id, selection_json, role, created_at from creation_context_bindings where target_type = ? and target_id = ? and role = ?", "project", projectID, "primary")
	if err := row.Scan(&binding.ID, &binding.TargetType, &binding.TargetID, &binding.WorldID, &binding.RevisionID, &selectionJSON, &binding.Role, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if err := json.Unmarshal([]byte(selectionJSON), &binding.Selection); err != nil {
		return nil, err
	}
	binding.CreatedAt = createdAt
	return &binding, nil
}

// GetProjectContext resolves the fixed revision stored on the Project binding.
// An unbound Project returns a nil context without error.
func (w *WorldStore) GetProjectContext(projectID string) (*CreationContext, error) {
	binding, err := w.GetProjectBinding(projectID)
	if err != nil || binding == nil {
		return nil, err
	}
	context, err := w.Resolve(ResolveInput{WorldID: binding.WorldID, RevisionID: binding.RevisionID, Selection: binding.Selection})
	if err != nil {
		return nil, err
	}
	return &context, nil
}

// ListWorldBindings reports every target bound to a World revision (Project,
// Artifact or media Job), powering the World detail "created from this world"
// read-only aggregate. It is deliberately light: IDs and revision only.
func (w *WorldStore) ListWorldBindings(worldID string) ([]CreationContextBinding, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, target_type, target_id, world_id, revision_id, selection_json, role, created_at from creation_context_bindings where world_id = ? order by created_at desc", worldID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bindings := []CreationContextBinding{}
	for rows.Next() {
		var binding CreationContextBinding
		var selectionJSON string
		if err := rows.Scan(&binding.ID, &binding.TargetType, &binding.TargetID, &binding.WorldID, &binding.RevisionID, &selectionJSON, &binding.Role, &binding.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(selectionJSON), &binding.Selection)
		bindings = append(bindings, binding)
	}
	return bindings, rows.Err()
}

// ListWorldsInput is the typed input of world.list.
type ListWorldsInput struct {
	Text   string
	Type   WorldKind
	Cursor string
	Limit  int
}

// ListEntitiesInput is the typed input of entity.list.
type ListEntitiesInput struct {
	WorldID string
	Kind    WorldEntityKind
	Text    string
	Cursor  string
	Limit   int
}

// CreateWorldInput is the typed input of world.create.
type CreateWorldInput struct {
	Name         string
	Type         WorldKind
	Description  string
	Identity     map[string]any
	CoverAssetID string
}

// UpdateWorldInput is the typed input of world.update. Pointer fields keep the
// "absent means untouched" contract distinct from "set to empty".
type UpdateWorldInput struct {
	WorldID            string
	Name               *string
	Description        *string
	Identity           map[string]any
	ExpectedRevisionID string
	CreatedBy          string
}

// UpsertEntityInput is the typed input of entity.upsert.
type UpsertEntityInput struct {
	WorldID            string
	EntityID           string
	Kind               WorldEntityKind
	Title              string
	Summary            string
	Content            map[string]any
	ExpectedRevisionID string
	CreatedBy          string
}

// AttachReferenceInput is the typed input of reference.attach.
type AttachReferenceInput struct {
	WorldID            string
	EntityID           string
	AssetID            string
	Role               string
	Label              string
	Purpose            string
	Status             string
	Collection         string
	Modality           string
	Segment            *WorldEvidenceSegment
	ExpectedRevisionID string
	CreatedBy          string
}

type ArchiveEvidenceInput struct {
	WorldID            string
	EvidenceID         string
	ExpectedRevisionID string
	CreatedBy          string
}

type UpdateEvidenceInput struct {
	WorldID            string
	EvidenceID         string
	Purpose            string
	Status             string
	Label              string
	ExpectedRevisionID string
	CreatedBy          string
}

// BindProjectInput is the typed input of bind_project.
type BindProjectInput struct {
	ProjectID  string
	AppID      string
	WorldID    string
	RevisionID string
	Selection  WorldSelection
	Replace    bool
	CreatedBy  string
}

// ResolveInput is the typed input of canon.resolve.
type ResolveInput struct {
	WorldID    string
	RevisionID string
	Selection  WorldSelection
}

// resolvePage normalizes cursor (decimal offset) and limit (1..50, default 50).
func resolvePage(cursor string, limit int) (int, int) {
	offset := 0
	if cursor != "" {
		if parsed, err := strconv.Atoi(cursor); err == nil && parsed > 0 {
			offset = parsed
		}
	}
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	return offset, limit
}

// logWorldEvent emits concise ID-only observability lines; canonical JSON,
// prompts and private Asset metadata never reach the log.
func logWorldEvent(event string, fields map[string]string) {
	parts := make([]string, 0, len(fields)+1)
	parts = append(parts, event)
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", key, fields[key]))
	}
	log.Printf("INFO %s", strings.Join(parts, " "))
}
