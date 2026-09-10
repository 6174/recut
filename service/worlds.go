/*
 * [INPUT]: 依赖 Store 的 workspace.sqlite、MediaService 的 Asset 校验与标准库 SQLite/JSON 能力
 * [OUTPUT]: 对外提供 Creation Worlds 的平台拥有 WorldStore：World/Entity/Relation/AssetRef/Revision 的读写、
 * 分页与乐观并发、确定性 Canon 序列化与 SHA-256 哈希、CreationContext 投影、Project/Job 绑定与结构化 WorldsError；
 * 创建不再 seed 模板空壳实体（Onboarding RFC），新世界从空开始由 readiness 驱动引导
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

// WorldOrigin is the closed set of World provenance. Local worlds are user
// authored and writable; platform worlds are daemon-synced from the platform
// catalog; published worlds are user-installed copies (P4). Origin is fixed at
// creation and never changes: non-local worlds are read-only and updates only
// arrive through their catalog-driven lifecycle.
const (
	WorldLocal     = "local"
	WorldPlatform  = "platform"
	WorldPublished = "published"
)

const (
	WorldCharacterIP  WorldKind = "character_ip"
	WorldCreatorBrand WorldKind = "creator_brand"
	WorldBrand        WorldKind = "brand"
	WorldFiction      WorldKind = "fiction_world"
	WorldCustom       WorldKind = "custom"
)

// WorldEntityTypeID names an entity's type inside the world's type directory.
// It is an open id: preset ids (character/location/object/story/style/rule) are
// seeded as builtin rows, any other string resolves to a world-local custom
// type. The old closed kind enum is gone (RFC 统一 Entity 模型).
type WorldEntityTypeID = string

const (
	EntityTypeCharacter = "character"
	EntityTypeLocation  = "location"
	EntityTypeObject    = "object"
	EntityTypeStory     = "story"
	EntityTypeStyle     = "style"
	EntityTypeRule      = "rule"
)

var worldKinds = map[WorldKind]bool{
	WorldCharacterIP: true, WorldCreatorBrand: true, WorldBrand: true, WorldFiction: true, WorldCustom: true,
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
	Origin            string                  `json:"origin"`
	OriginMeta        *WorldOriginMeta        `json:"originMeta,omitempty"`
	CoverAssetID      string                  `json:"coverAssetId,omitempty"`
	PreviewAssetIDs   []string                `json:"previewAssetIds,omitempty"`
	PreviewURLs       []string                `json:"previewUrls,omitempty"`
	CurrentRevisionID string                  `json:"currentRevisionId"`
	EntityCounts      map[string]int `json:"entityCounts"`
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
	SkillMd              string            `json:"skillMd"`
	Revision             WorldRevisionView `json:"revision"`
	AvailableEntityKinds []string `json:"availableEntityKinds"`
}

// WorldOriginMeta records where a World came from and how its lifecycle is
// managed. kind/publisher/version/manifestHash/catalogOrder/syncedAt are used
// by platform worlds; installedAt/uninstalled by published worlds (P4);
// forkedFrom only appears on local worlds forked from a non-local source;
// coverUrl/provenance carry the manifest's public presentation facts.
type WorldOriginMeta struct {
	Kind         string       `json:"kind,omitempty"`
	Publisher    string       `json:"publisher,omitempty"`
	Version      string       `json:"version,omitempty"`
	ManifestHash string       `json:"manifestHash,omitempty"`
	CatalogOrder int          `json:"catalogOrder,omitempty"`
	CoverURL     string       `json:"coverUrl,omitempty"`
	Provenance   *Provenance  `json:"provenance,omitempty"`
	PublishedAt  string       `json:"publishedAt,omitempty"`
	SyncedAt     string       `json:"syncedAt,omitempty"`
	InstalledAt  string       `json:"installedAt,omitempty"`
	Uninstalled  bool         `json:"uninstalled,omitempty"`
	ForkedFrom   *ForkSource  `json:"forkedFrom,omitempty"`
}

// Provenance is the attribution block every platform manifest must carry: the
// World content is redistributed, so its upstream source stays auditable.
type Provenance struct {
	Author         string `json:"author,omitempty"`
	License        string `json:"license,omitempty"`
	Repository     string `json:"repository,omitempty"`
	SourceRevision string `json:"sourceRevision,omitempty"`
	PublishedAt    string `json:"publishedAt,omitempty"`
}

// ForkSource pins the exact upstream revision a local World was forked from.
type ForkSource struct {
	WorldID    string `json:"worldId"`
	RevisionID string `json:"revisionId"`
}

// EntityAttr is one entry of an entity's ordered attribute list. Type is one
// of text | textarea | number | boolean | select | media; media values carry
// {assetId, name?, kind?, segment?} referencing a platform Asset. Key is a
// stable generated id (label renames never break references). Locked marks a
// type-preset attr: its structure (label/type) is pinned by the type schema,
// the value stays user-editable (RFC 统一 Entity 模型).
type EntityAttr struct {
	Key     string          `json:"key"`
	Label   string          `json:"label"`
	Type    string          `json:"type"`
	Value   any             `json:"value,omitempty"`
	Options []string        `json:"options,omitempty"`
	Locked  bool            `json:"locked,omitempty"`
	Segment *AttrMediaSegment `json:"segment,omitempty"`
}

// AttrMediaSegment pins the meaningful part of a long media asset (carried
// over from the retired evidence segment semantics).
type AttrMediaSegment struct {
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
}

// attrTypeSet is the closed set of attr value types.
var attrTypes = map[string]bool{
	"text": true, "textarea": true, "number": true, "boolean": true, "select": true, "media": true,
}

// attrMediaKinds narrows media attrs to the modalities a card can render.
var attrMediaKinds = map[string]bool{"image": true, "video": true, "audio": true}

// WorldEntitySummary is the list-row projection of an entity.
type WorldEntitySummary struct {
	ID            string `json:"id"`
	WorldID       string `json:"worldId"`
	TypeID        string `json:"typeId"`
	Name          string `json:"name"`
	Intro         string `json:"intro"`
	ParentID      string `json:"parentId,omitempty"`
	ContainerRole string `json:"containerRole,omitempty"`
	IsProvisional bool   `json:"isProvisional,omitempty"`
	UpdatedAt     string `json:"updatedAt"`
}

type WorldEntityRelation struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	FromEntityID  string `json:"fromEntityId"`
	ToEntityID    string `json:"toEntityId"`
	ScopeEntityID string `json:"scopeEntityId,omitempty"`
	// Direction is a read projection (out | in | scope) from the touched
	// entity's point of view; only ListRelations fills it.
	Direction string `json:"direction,omitempty"`
}

type WorldAssetReference struct {
	ID               string                `json:"id,omitempty"`
	Source           string                `json:"source"`
	AssetID          string                `json:"assetId,omitempty"`
	URL              string                `json:"url,omitempty"`
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

// Evidence sources: exactly one of asset (local, completed media) or url
// (remote, absolute http(s)) is populated per reference. URL evidence keeps
// the remote resource as truth and never pollutes the user's media library.
const (
	EvidenceSourceAsset = "asset"
	EvidenceSourceURL   = "url"
)

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
	Detail     string                `json:"detail"`
	Attrs      []EntityAttr          `json:"attrs"`
	Relations  []WorldEntityRelation `json:"relations"`
	References []WorldAssetReference `json:"references"`
	Children   []WorldEntitySummary  `json:"children,omitempty"`
}

type WorldContextIdentity struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Origin        string `json:"origin"`
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
	Skill       string                `json:"skill,omitempty"`
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
	WorldsErrCanvasConflict      = "CANVAS_VERSION_CONFLICT"
	// WorldsErrReadOnly is the hard write boundary for non-local worlds. The
	// error details always carry the fork escape hatch (hint + forkOperation)
	// so Agents can propose the legal exit instead of failing silently.
	WorldsErrReadOnly            = "WORLD_READ_ONLY"
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
	var createdAt, updatedAt, origin, originMetaJSON string
	var coverAssetID sql.NullString
	var currentRevisionID sql.NullString
	row := db.QueryRow("select id, name, type, description, origin, origin_meta_json, cover_asset_id, current_revision_id, created_at, updated_at from worlds where id = ?", worldID)
	if err := row.Scan(&summary.ID, &summary.Name, &summary.Type, &summary.Description, &origin, &originMetaJSON, &coverAssetID, &currentRevisionID, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorldSummary{}, worldsError(WorldsErrNotFound, "world not found")
		}
		return WorldSummary{}, err
	}
	summary.Origin = originOrDefault(origin)
	summary.EntityCounts = map[string]int{}
	countRows, err := db.Query("select coalesce(nullif(type_id, ''), kind) as type_id, count(*) from world_entities where world_id = ? and archived_at is null group by type_id", worldID)
	if err != nil {
		return WorldSummary{}, err
	}
	defer countRows.Close()
	for countRows.Next() {
		var typeID string
		var count int
		if err := countRows.Scan(&typeID, &count); err != nil {
			return WorldSummary{}, err
		}
		summary.EntityCounts[typeID] = count
	}
	if err := countRows.Err(); err != nil {
		return WorldSummary{}, err
	}
	if coverAssetID.Valid {
		summary.CoverAssetID = coverAssetID.String
	}
	// 卡片预览：取世界内前几张图片证据（本地素材取 assetId，平台世界取 CDN url），
	// 无显式封面时前端用它拼画廊。
	previewRows, err := db.Query("select asset_id, url from world_asset_refs where world_id = ? and archived_at is null and modality = 'image' and (asset_id != '' or url != '') order by sort_order, created_at limit 3", worldID)
	if err != nil {
		return WorldSummary{}, err
	}
	defer previewRows.Close()
	for previewRows.Next() {
		var assetID, evidenceURL string
		if err := previewRows.Scan(&assetID, &evidenceURL); err != nil {
			return WorldSummary{}, err
		}
		if assetID != "" {
			summary.PreviewAssetIDs = append(summary.PreviewAssetIDs, assetID)
		} else {
			summary.PreviewURLs = append(summary.PreviewURLs, evidenceURL)
		}
	}
	if err := previewRows.Err(); err != nil {
		return WorldSummary{}, err
	}
	if currentRevisionID.Valid {
		summary.CurrentRevisionID = currentRevisionID.String
	}
	summary.UpdatedAt = updatedAt
	if originMetaJSON != "" && originMetaJSON != "{}" {
		meta := WorldOriginMeta{}
		if err := json.Unmarshal([]byte(originMetaJSON), &meta); err == nil {
			summary.OriginMeta = &meta
		}
	}
	return summary, nil
}

// originOrDefault normalizes rows written before layout v4 (empty origin).
func originOrDefault(origin string) string {
	if origin == "" {
		return WorldLocal
	}
	return origin
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
	var identityJSON, skillMd string
	var revisionID, canonicalHash, revisionCreatedAt string
	var cover sql.NullString
	row := db.QueryRow("select identity_json, skill_md, current_revision_id, cover_asset_id from worlds where id = ?", worldID)
	if err := row.Scan(&identityJSON, &skillMd, &revisionID, &cover); err != nil {
		return WorldDetail{}, err
	}
	if err := json.Unmarshal([]byte(identityJSON), &detail.Identity); err != nil {
		return WorldDetail{}, err
	}
	if detail.Identity == nil {
		detail.Identity = map[string]any{}
	}
	detail.SkillMd = skillMd
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

// availableEntityKinds returns the preset type ids a World type surfaces first
// in its UI; the directory itself stays open (custom types always allowed).
func availableEntityKinds(kind WorldKind) []string {
	switch kind {
	case WorldCharacterIP:
		return []string{EntityTypeCharacter, EntityTypeStory, EntityTypeStyle, EntityTypeRule, EntityTypeLocation, EntityTypeObject}
	case WorldCreatorBrand:
		return []string{EntityTypeStyle, EntityTypeStory, EntityTypeRule, EntityTypeCharacter, EntityTypeObject}
	case WorldBrand:
		return []string{EntityTypeStyle, EntityTypeRule, EntityTypeStory, EntityTypeCharacter, EntityTypeObject}
	case WorldFiction:
		return []string{EntityTypeCharacter, EntityTypeLocation, EntityTypeStory, EntityTypeStyle, EntityTypeRule, EntityTypeObject}
	default:
		return []string{EntityTypeCharacter, EntityTypeLocation, EntityTypeStory, EntityTypeStyle, EntityTypeRule, EntityTypeObject}
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
	// Onboarding RFC (2026-08-28): worlds no longer seed template entities.
	// An empty shell that pretends to be a finished character was the single
	// worst first-run signal; a new world starts truly empty and the readiness
	// projection (worlds_readiness.go) drives the onboarding loop instead.
	if _, err := w.commitRevision(tx, worldID, "world.created", "system"); err != nil {
		return WorldDetail{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldDetail{}, err
	}
	// Seed the per-world preset entity type directory (best-effort; the type
	// surface lazily re-seeds on first access if this ever races).
	_ = w.EnsurePresetEntityTypes(worldID)
	logWorldEvent("world.created", map[string]string{"worldId": worldID})
	return w.GetWorld(worldID)
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
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return WorldDetail{}, err
	}
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
	if input.SkillMd != nil {
		if _, err := tx.Exec("update worlds set skill_md = ?, updated_at = ? where id = ?", *input.SkillMd, now, input.WorldID); err != nil {
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
	if !input.IncludeProvisional {
		where += " and is_provisional = 0"
	}
	if input.TypeID != "" {
		where += " and coalesce(nullif(type_id, ''), kind) = ?"
		args = append(args, input.TypeID)
	}
	if input.Text != "" {
		where += " and (title like ? or summary like ?)"
		pattern := "%" + input.Text + "%"
		args = append(args, pattern, pattern)
	}
	args = append(args, limit, offset)
	rows, err := db.Query("select id, coalesce(nullif(type_id, ''), kind), title, summary, parent_id, container_role, is_provisional, updated_at from world_entities where "+where+" order by updated_at desc limit ? offset ?", args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	items := make([]WorldEntitySummary, 0)
	for rows.Next() {
		var item WorldEntitySummary
		var parentID, containerRole sql.NullString
		var provisional int
		item.WorldID = input.WorldID
		if err := rows.Scan(&item.ID, &item.TypeID, &item.Name, &item.Intro, &parentID, &containerRole, &provisional, &item.UpdatedAt); err != nil {
			return nil, "", err
		}
		item.ParentID = nullStringValue(parentID)
		item.ContainerRole = nullStringValue(containerRole)
		item.IsProvisional = provisional != 0
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
	var detail string
	var attrsJSON string
	var createdAt, updatedAt string
	var parentID, containerRole sql.NullString
	var provisional int
	row := db.QueryRow("select id, coalesce(nullif(type_id, ''), kind), title, summary, detail, attrs_json, parent_id, container_role, is_provisional, created_at, updated_at from world_entities where id = ? and world_id = ? and archived_at is null", entityID, worldID)
	if err := row.Scan(&entity.ID, &entity.TypeID, &entity.Name, &entity.Intro, &detail, &attrsJSON, &parentID, &containerRole, &provisional, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorldEntity{}, worldsError(WorldsErrEntityNotFound, "entity not found in world")
		}
		return WorldEntity{}, err
	}
	entity.WorldID = worldID
	entity.Detail = detail
	entity.UpdatedAt = updatedAt
	entity.ParentID = nullStringValue(parentID)
	entity.ContainerRole = nullStringValue(containerRole)
	entity.IsProvisional = provisional != 0
	entity.Attrs = []EntityAttr{}
	if attrsJSON != "" {
		if err := json.Unmarshal([]byte(attrsJSON), &entity.Attrs); err != nil {
			return WorldEntity{}, err
		}
	}
	children, err := w.listChildren(db, worldID, entityID)
	if err != nil {
		return WorldEntity{}, err
	}
	entity.Children = children
	relationRows, err := db.Query("select id, relation_type, from_entity_id, to_entity_id, scope_entity_id from world_relations where world_id = ? and (from_entity_id = ? or to_entity_id = ?) and (scope_entity_id is null or scope_entity_id = ?) order by created_at", worldID, entityID, entityID, entityID)
	if err != nil {
		return WorldEntity{}, err
	}
	defer relationRows.Close()
	entity.Relations = []WorldEntityRelation{}
	for relationRows.Next() {
		var relation WorldEntityRelation
		var scopeEntityID sql.NullString
		if err := relationRows.Scan(&relation.ID, &relation.Type, &relation.FromEntityID, &relation.ToEntityID, &scopeEntityID); err != nil {
			return WorldEntity{}, err
		}
		relation.ScopeEntityID = nullStringValue(scopeEntityID)
		entity.Relations = append(entity.Relations, relation)
	}
	if err := relationRows.Err(); err != nil {
		return WorldEntity{}, err
	}
	refRows, err := db.Query("select "+worldEvidenceColumns+" from world_asset_refs where world_id = ? and entity_id = ? and archived_at is null order by sort_order, created_at", worldID, entityID)
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
	db, err := w.database()
	if err != nil {
		return WorldEntity{}, err
	}
	if _, err := w.summary(db, input.WorldID); err != nil {
		return WorldEntity{}, err
	}
	var existing WorldEntity
	if input.EntityID != "" {
		existing, err = w.getEntity(db, input.WorldID, input.EntityID)
		if err != nil {
			return WorldEntity{}, err
		}
		if input.TypeID != "" && input.TypeID != existing.TypeID {
			return WorldEntity{}, worldsError(WorldsErrContextInvalid, "entity type cannot change on update")
		}
		input.TypeID = existing.TypeID
	} else {
		input.TypeID = strings.TrimSpace(input.TypeID)
		if input.TypeID == "" {
			return WorldEntity{}, worldsError(WorldsErrContextInvalid, "entity typeId is required when creating an entity")
		}
	}
	now := iso(time.Now().UTC())
	tx, err := db.Begin()
	if err != nil {
		return WorldEntity{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return WorldEntity{}, err
	}
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return WorldEntity{}, err
	}
	// Entity type is an extensible type directory entry: preset ids are seeded
	// as builtin rows, unknown ids auto-create a minimal custom type so "create
	// on the canvas" never blocks on a missing type (RFC §5.4).
	if err := w.ensureEntityType(tx, input.WorldID, input.TypeID); err != nil {
		return WorldEntity{}, err
	}
	if input.ParentID != "" {
		if err := w.checkParent(tx, input.WorldID, input.ParentID); err != nil {
			return WorldEntity{}, err
		}
	}
	// Attr merge: locked preset fields of the type are enforced from the schema
	// (label/type pinned, value free); user attrs pass through validated.
	// The type row may have been created inside this transaction (a custom
	// type auto-created above), so it must be read through the tx.
	entityType, err := getEntityTypeQuerier(tx, input.WorldID, input.TypeID)
	if err != nil {
		return WorldEntity{}, err
	}
	attrs := existing.Attrs
	if input.Attrs != nil {
		attrs = input.Attrs
	}
	merged, err := w.mergeEntityAttrs(input.WorldID, entityType, attrs)
	if err != nil {
		return WorldEntity{}, err
	}
	attrsJSON, err := json.Marshal(merged)
	if err != nil {
		return WorldEntity{}, err
	}
	entityID := input.EntityID
	provisional := 0
	if input.IsProvisional {
		provisional = 1
	}
	if entityID == "" {
		entityID, err = newID()
		if err != nil {
			return WorldEntity{}, err
		}
		if _, err := tx.Exec("insert into world_entities (id, world_id, type_id, kind, title, summary, detail, attrs_json, content_json, parent_id, container_role, is_provisional, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)",
			entityID, input.WorldID, input.TypeID, input.TypeID, strings.TrimSpace(input.Name), strings.TrimSpace(input.Intro), input.Detail, string(attrsJSON), nullIfEmpty(input.ParentID), input.ContainerRole, provisional, now, now); err != nil {
			return WorldEntity{}, err
		}
	} else {
		if _, err := tx.Exec("update world_entities set type_id = ?, title = ?, summary = ?, detail = ?, attrs_json = ?, updated_at = ? where id = ? and world_id = ?",
			input.TypeID, strings.TrimSpace(input.Name), strings.TrimSpace(input.Intro), input.Detail, string(attrsJSON), now, entityID, input.WorldID); err != nil {
			return WorldEntity{}, err
		}
	}
	// Exploration drafts are not facts: only canonical writes produce a revision.
	if !input.IsProvisional {
		if _, err := w.commitRevision(tx, input.WorldID, "entity.upserted", input.CreatedBy); err != nil {
			return WorldEntity{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return WorldEntity{}, err
	}
	logWorldEvent("world.entity.upserted", map[string]string{"worldId": input.WorldID, "entityId": entityID})
	// Property-binding sync (panel → canvas): entity attrs are the shared data
	// source; refresh every attr projection bound to this entity.
	w.syncAttrProjections(input.WorldID, entityID, attrValueMap(merged))
	return w.getEntity(db, input.WorldID, entityID)
}

// mergeEntityAttrs applies the type schema to a candidate attr list:
// every locked preset field of the type is present with schema-pinned
// label/type; user attrs keep their own structure but must carry a valid,
// type-consistent value. Media values are verified against the platform
// asset library (assetId required, asset completed, modality renderable).
func (w *WorldStore) mergeEntityAttrs(worldID string, entityType WorldEntityType, candidate []EntityAttr) ([]EntityAttr, error) {
	merged := make([]EntityAttr, 0, len(candidate)+len(entityType.Fields))
	normalized := make([]EntityAttr, 0, len(candidate))
	byKey := map[string]EntityAttr{}
	for _, attr := range candidate {
		attr.Key = strings.TrimSpace(attr.Key)
		if attr.Key == "" {
			// Anonymous client attrs get a stable generated key so later
			// renames/updates address the same slot.
			id, err := newID()
			if err != nil {
				return nil, err
			}
			attr.Key = "a_" + id
		}
		attr.Label = strings.TrimSpace(attr.Label)
		if attr.Label == "" {
			attr.Label = attr.Key
		}
		if attr.Type == "" {
			attr.Type = "text"
		}
		if !attrTypes[attr.Type] {
			return nil, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid attr type %q", attr.Type))
		}
		if attr.Type == "select" && len(attr.Options) == 0 {
			return nil, worldsError(WorldsErrContextInvalid, "select attr needs options")
		}
		if _, dup := byKey[attr.Key]; dup {
			continue
		}
		normalized = append(normalized, attr)
		byKey[attr.Key] = attr
	}
	// Schema pass: locked preset fields exist and carry schema structure.
	for _, field := range entityType.Fields {
		if !field.Locked {
			continue
		}
		attr, ok := byKey[field.Key]
		if !ok {
			attr = EntityAttr{Value: nil}
		}
		attr.Key = field.Key
		attr.Label = field.Label
		attr.Type = field.Type
		attr.Locked = true
		attr.Options = field.Options
		byKey[field.Key] = attr
	}
	// Emit in candidate order first, then schema fields missing from it.
	seen := map[string]bool{}
	for _, attr := range normalized {
		if seen[attr.Key] {
			continue
		}
		merged = append(merged, byKey[attr.Key])
		seen[attr.Key] = true
	}
	for _, field := range entityType.Fields {
		if field.Locked && !seen[field.Key] {
			merged = append(merged, byKey[field.Key])
			seen[field.Key] = true
		}
	}
	for _, attr := range merged {
		if err := w.validateAttrValue(attr); err != nil {
			return nil, err
		}
	}
	return merged, nil
}

// validateAttrValue checks a single attr value against its declared type.
func (w *WorldStore) validateAttrValue(attr EntityAttr) error {
	switch attr.Type {
	case "text", "textarea":
		if attr.Value != nil {
			if _, ok := attr.Value.(string); !ok {
				return worldsError(WorldsErrContextInvalid, fmt.Sprintf("attr %q expects a text value", attr.Key))
			}
		}
	case "number":
		if attr.Value != nil {
			if _, ok := attr.Value.(float64); !ok {
				return worldsError(WorldsErrContextInvalid, fmt.Sprintf("attr %q expects a number value", attr.Key))
			}
		}
	case "boolean":
		if attr.Value != nil {
			if _, ok := attr.Value.(bool); !ok {
				return worldsError(WorldsErrContextInvalid, fmt.Sprintf("attr %q expects a boolean value", attr.Key))
			}
		}
	case "select":
		if attr.Value != nil {
			text, ok := attr.Value.(string)
			if !ok {
				return worldsError(WorldsErrContextInvalid, fmt.Sprintf("attr %q expects a select option", attr.Key))
			}
			matched := false
			for _, option := range attr.Options {
				if option == text {
					matched = true
					break
				}
			}
			if !matched {
				return worldsError(WorldsErrContextInvalid, fmt.Sprintf("attr %q value is not one of its options", attr.Key))
			}
		}
	case "media":
		if attr.Value == nil {
			return nil
		}
		payload, ok := attr.Value.(map[string]any)
		if !ok {
			return worldsError(WorldsErrContextInvalid, fmt.Sprintf("attr %q expects a media value {assetId}", attr.Key))
		}
		assetID, _ := payload["assetId"].(string)
		if strings.TrimSpace(assetID) == "" {
			return worldsError(WorldsErrContextInvalid, fmt.Sprintf("media attr %q needs an assetId", attr.Key))
		}
		if _, _, err := w.validateEvidenceAsset(assetID); err != nil {
			return err
		}
	}
	return nil
}

// attrValueMap flattens attrs into key→value for canvas attr projections.
func attrValueMap(attrs []EntityAttr) map[string]any {
	result := map[string]any{}
	for _, attr := range attrs {
		result[attr.Key] = attr.Value
	}
	return result
}

// patchEntityAttr returns a copy of attrs with one attr's value set, creating
// a plain text attr when the key is new (canvas-side creation path).
func patchEntityAttr(attrs []EntityAttr, key string, value any) []EntityAttr {
	result := make([]EntityAttr, 0, len(attrs)+1)
	found := false
	for _, attr := range attrs {
		if attr.Key == key {
			attr.Value = value
			found = true
		}
		result = append(result, attr)
	}
	if !found {
		result = append(result, EntityAttr{Key: key, Label: key, Type: "text", Value: value})
	}
	return result
}

type DeleteEntityInput struct {
	WorldID            string
	EntityID           string
	ExpectedRevisionID string
	CreatedBy          string
}

// DeleteEntityResult 回传删除影响范围，供确认对话框展示（「将一并删除 N 个子设定 / M 条关系 / K 份素材」）。
type DeleteEntityResult struct {
	Deleted       int `json:"deleted"`
	Children      int `json:"children"`
	Relations     int `json:"relations"`
	Evidences     int `json:"evidences"`
}

// DeleteEntity 归档实体及其整个子图（Q1：归档而非物理删除，恢复功能 P1）：
// 子实体级联归档；触及的关系物理删除（world_relations 无归档列）；证据引用归档；
// 画布实体投影与关系锚点元素删除；产 1 条 revision。
func (w *WorldStore) DeleteEntity(input DeleteEntityInput) (DeleteEntityResult, error) {
	db, err := w.database()
	if err != nil {
		return DeleteEntityResult{}, err
	}
	if _, err := w.summary(db, input.WorldID); err != nil {
		return DeleteEntityResult{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return DeleteEntityResult{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return DeleteEntityResult{}, err
	}
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return DeleteEntityResult{}, err
	}
	// 宽搜收集整个后代子图（仅未归档行）
	ids := map[string]bool{input.EntityID: true}
	frontier := []string{input.EntityID}
	for len(frontier) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(frontier)), ",")
		args := make([]any, 0, len(frontier)+1)
		args = append(args, input.WorldID)
		for _, id := range frontier {
			args = append(args, id)
		}
		rows, err := tx.Query("select id from world_entities where world_id = ? and archived_at is null and parent_id in ("+placeholders+")", args...)
		if err != nil {
			return DeleteEntityResult{}, err
		}
		next := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return DeleteEntityResult{}, err
			}
			if !ids[id] {
				ids[id] = true
				next = append(next, id)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return DeleteEntityResult{}, err
		}
		frontier = next
	}
	if !ids[input.EntityID] {
		return DeleteEntityResult{}, worldsError(WorldsErrEntityNotFound, "entity not found in world")
	}
	idList := make([]string, 0, len(ids))
	for id := range ids {
		idList = append(idList, id)
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(idList)), ",")
	args := make([]any, 0, len(idList))
	for _, id := range idList {
		args = append(args, id)
	}

	var childrenCount, relationCount, evidenceCount int
	if err := tx.QueryRow("select count(*) from world_entities where world_id = ? and archived_at is null and parent_id in ("+placeholders+")", append([]any{input.WorldID}, args...)...).Scan(&childrenCount); err != nil {
		return DeleteEntityResult{}, err
	}
	if err := tx.QueryRow("select count(*) from world_relations where world_id = ? and (from_entity_id in ("+placeholders+") or to_entity_id in ("+placeholders+"))", append(append([]any{input.WorldID}, args...), args...)...).Scan(&relationCount); err != nil {
		return DeleteEntityResult{}, err
	}
	if err := tx.QueryRow("select count(*) from world_asset_refs where world_id = ? and archived_at is null and entity_id in ("+placeholders+")", append([]any{input.WorldID}, args...)...).Scan(&evidenceCount); err != nil {
		return DeleteEntityResult{}, err
	}

	// 画布投影：实体元素（refKind=entity）与关系锚点（shape:rel-<relationId>，refId=relationId）一并删除；
	// 必须在删除关系行之前收集 relationID（锚点元素按 refId=relationId 清理）
	relationIDs := []string{}
	relationRows, err := tx.Query("select id from world_relations where world_id = ? and (from_entity_id in ("+placeholders+") or to_entity_id in ("+placeholders+"))", append(append([]any{input.WorldID}, args...), args...)...)
	if err != nil {
		return DeleteEntityResult{}, err
	}
	for relationRows.Next() {
		var id string
		if err := relationRows.Scan(&id); err != nil {
			relationRows.Close()
			return DeleteEntityResult{}, err
		}
		relationIDs = append(relationIDs, id)
	}
	relationRows.Close()
	if err := relationRows.Err(); err != nil {
		return DeleteEntityResult{}, err
	}

	now := iso(time.Now().UTC())
	if _, err := tx.Exec("update world_entities set archived_at = ?, updated_at = ? where world_id = ? and archived_at is null and id in ("+placeholders+")", append([]any{now, now, input.WorldID}, args...)...); err != nil {
		return DeleteEntityResult{}, err
	}
	// 关系触达被删实体即删除（无 archived_at 列；词表关系可重建，成本可接受）
	if _, err := tx.Exec("delete from world_relations where world_id = ? and (from_entity_id in ("+placeholders+") or to_entity_id in ("+placeholders+"))", append(append([]any{input.WorldID}, args...), args...)...); err != nil {
		return DeleteEntityResult{}, err
	}
	if _, err := tx.Exec("update world_asset_refs set archived_at = ? where world_id = ? and archived_at is null and entity_id in ("+placeholders+")", append([]any{now, input.WorldID}, args...)...); err != nil {
		return DeleteEntityResult{}, err
	}
	// 画布投影清理（文档版）：实体投影 + 指向被删关系的边从所有文档移除
	idSet := map[string]bool{}
	for _, arg := range args {
		if id, ok := arg.(string); ok {
			idSet[id] = true
		}
	}
	relationSet := map[string]bool{}
	for _, id := range relationIDs {
		relationSet[id] = true
	}
	if err := mutateCanvasDocsInTx(tx, input.WorldID, func(element WorldCanvasElement) bool {
		if element.RefKind == "entity" && idSet[element.RefID] {
			return true
		}
		return relationSet[element.RefID]
	}); err != nil {
		return DeleteEntityResult{}, err
	}
	// 被删实体的内层画布文档级联移除（RFC §1.4：实体删除不留下悬空文档）
	if len(idSet) > 0 {
		ctxPlaceholders := strings.TrimRight(strings.Repeat("?,", len(idSet)), ",")
		ctxArgs := append([]any{input.WorldID}, args...)
		if _, err := tx.Exec("delete from world_canvases where world_id = ? and context_id in ("+ctxPlaceholders+")", ctxArgs...); err != nil {
			return DeleteEntityResult{}, err
		}
	}

	if _, err := w.commitRevision(tx, input.WorldID, "entity.deleted", input.CreatedBy); err != nil {
		return DeleteEntityResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return DeleteEntityResult{}, err
	}
	logWorldEvent("world.entity.deleted", map[string]string{"worldId": input.WorldID, "entityId": input.EntityID, "cascade": fmt.Sprintf("%d", len(idList)-1)})
	return DeleteEntityResult{Deleted: len(idList), Children: childrenCount, Relations: relationCount, Evidences: evidenceCount}, nil
}

func (w *WorldStore) AttachReference(input AttachReferenceInput) (WorldAssetReference, error) {
	// Evidence writes are frozen (RFC 统一 Entity 模型): entity media lives in
	// media attrs now. Reads keep working so existing worlds and old revisions
	// stay browsable during the transition.
	return WorldAssetReference{}, worldsError(WorldsErrContextInvalid, "evidence writes are frozen: attach media to an entity as a media attr instead")
}
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

// worldEvidenceColumns is the single canonical column list every evidence
// reader scans, so the asset/url dual source can never drift between paths.
const worldEvidenceColumns = "id, asset_id, url, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, entity_id"

func scanWorldEvidence(row interface{ Scan(...any) error }) (WorldEvidence, error) {
	var evidence WorldEvidence
	var segmentJSON string
	var entityID sql.NullString
	if err := row.Scan(&evidence.ID, &evidence.AssetID, &evidence.URL, &evidence.AssetContentHash, &evidence.Modality, &evidence.Purpose, &evidence.Status, &evidence.Collection, &segmentJSON, &evidence.Role, &evidence.Label, &entityID); err != nil {
		return WorldEvidence{}, err
	}
	if strings.TrimSpace(evidence.URL) != "" {
		evidence.Source = EvidenceSourceURL
	} else {
		evidence.Source = EvidenceSourceAsset
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

// checkWritable enforces the platform write boundary inside the write
// transaction: any non-local World (platform/published) rejects every mutation
// with WORLD_READ_ONLY, whose details carry the fork escape hatch. Reads and
// bindings stay unrestricted.
func (w *WorldStore) checkWritable(db rowQuerier, worldID string) error {
	var origin string
	row := db.QueryRow("select origin from worlds where id = ?", worldID)
	if err := row.Scan(&origin); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return worldsError(WorldsErrNotFound, "world not found")
		}
		return err
	}
	if originOrDefault(origin) != WorldLocal {
		return &WorldsError{
			Code:    WorldsErrReadOnly,
			Message: "this world is owned by the platform catalog and is read-only",
			Details: map[string]any{"origin": originOrDefault(origin), "hint": "fork", "forkOperation": "recut.worlds.fork"},
		}
	}
	return nil
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
	var name, description, worldType, identityJSON, skillMd string
	if err := tx.QueryRow("select name, type, description, identity_json, skill_md from worlds where id = ?", worldID).Scan(&name, &worldType, &description, &identityJSON, &skillMd); err != nil {
		return "", "", err
	}
	_ = json.Unmarshal([]byte(identityJSON), &identity)

	entities := map[string][]map[string]any{}
	rows, err := tx.Query("select id, coalesce(nullif(type_id, ''), kind), title, summary, detail, attrs_json, parent_id from world_entities where world_id = ? and archived_at is null and is_provisional = 0 order by coalesce(nullif(type_id, ''), kind), id", worldID)
	if err != nil {
		return "", "", err
	}
	// base_kind per type id drives the CreationContext buckets (character/
	// location/...); custom types fall back to their own id.
	baseKinds := map[string]string{}
	typeRows, err := tx.Query("select id, base_kind from world_entity_types where world_id = ? and archived_at is null", worldID)
	if err != nil {
		return "", "", err
	}
	for typeRows.Next() {
		var id, baseKind string
		if err := typeRows.Scan(&id, &baseKind); err != nil {
			typeRows.Close()
			return "", "", err
		}
		baseKinds[id] = baseKind
	}
	typeRows.Close()
	if err := typeRows.Err(); err != nil {
		return "", "", err
	}
	for rows.Next() {
		var id, typeID, name, intro, detail, attrsJSON string
		var parentID sql.NullString
		if err := rows.Scan(&id, &typeID, &name, &intro, &detail, &attrsJSON, &parentID); err != nil {
			rows.Close()
			return "", "", err
		}
		attrs := []EntityAttr{}
		if attrsJSON != "" {
			_ = json.Unmarshal([]byte(attrsJSON), &attrs)
		}
		encodedAttrs, err := json.Marshal(attrs)
		if err != nil {
			rows.Close()
			return "", "", err
		}
		var decodedAttrs []any
		_ = json.Unmarshal(encodedAttrs, &decodedAttrs)
		baseKind := baseKinds[typeID]
		if baseKind == "" {
			baseKind = typeID
		}
		record := map[string]any{"id": id, "name": name, "intro": intro, "detail": detail,
			"typeId": typeID, "baseKind": baseKind, "attrs": decodedAttrs}
		if parentID.Valid && parentID.String != "" {
			record["parentId"] = parentID.String
		}
		entities[typeID] = append(entities[typeID], record)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", "", err
	}

	relations := []map[string]any{}
	relationRows, err := tx.Query("select id, relation_type, from_entity_id, to_entity_id, metadata_json from world_relations where world_id = ? and scope_entity_id is null order by id", worldID)
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
	refRows, err := tx.Query("select "+worldEvidenceColumns+" from world_asset_refs where world_id = ? and archived_at is null order by id", worldID)
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
		if evidence.URL != "" {
			record["url"] = evidence.URL
			record["source"] = evidence.Source
		}
		references = append(references, record)
	}
	refRows.Close()
	if err := refRows.Err(); err != nil {
		return "", "", err
	}

	// skill (world.md) is a first-class World field: the vertical production
	// workflow of this world. It enters the canonical like identity so
	// platform/local revisions stay fully isomorphic.
	canonical := map[string]any{
		"world": map[string]any{
			"name":        name,
			"type":        worldType,
			"description": description,
		},
		"skill":      skillMd,
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

func entityMap(entities map[string][]map[string]any) map[string]any {
	result := map[string]any{}
	typeIDs := make([]string, 0, len(entities))
	for typeID := range entities {
		typeIDs = append(typeIDs, typeID)
	}
	sort.Strings(typeIDs)
	for _, typeID := range typeIDs {
		result[typeID] = entities[typeID]
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
			ID: world.ID, Name: world.Name, Origin: originOrDefault(world.Origin), RevisionID: revisionID, CanonicalHash: canonicalHash,
		},
		Selection:  selection,
		Identity:   world.Identity,
		References: []WorldAssetReference{},
	}
	if skill, ok := canonical["skill"].(string); ok {
		context.Skill = skill
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
			// Canonical records carry their type's baseKind; the bucket key is
			// the (possibly custom) typeId.
			baseKind, _ := record["baseKind"].(string)
			if baseKind == "" {
				baseKind = kind
			}
			switch baseKind {
			case "character":
				context.Entities.Characters = append(context.Entities.Characters, w.entityView(record, "name"))
			case "location":
				context.Entities.Locations = append(context.Entities.Locations, w.entityView(record, "name"))
			case "story":
				view := w.entityView(record, "name")
				if selection.StoryID != "" && id == selection.StoryID {
					context.Entities.Story = view
				} else {
					context.Entities.Stories = append(context.Entities.Stories, view)
				}
			case "style":
				context.Entities.Styles = append(context.Entities.Styles, w.entityView(record, "name"))
			case "rule":
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
	rows, err := db.Query("select "+worldEvidenceColumns+" from world_asset_refs where world_id = ? and archived_at is null order by collection_name, sort_order, created_at", worldID)
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
		if err := w.checkWritable(tx, worldID); err != nil {
			_ = tx.Rollback()
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
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return err
	}
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
	// Evidence writes are frozen (RFC 统一 Entity 模型); see AttachReference.
	return WorldEvidence{}, worldsError(WorldsErrContextInvalid, "evidence writes are frozen: entity media lives in media attrs now")
}

// entityView projects a canonical record into the consumer-facing shape: the
// attrs are flattened to key→value so generation prompts read natural fields
// (appearance, voice, ...), name/intro/detail ride along as first-class keys.
func (w *WorldStore) entityView(record map[string]any, nameKey string) map[string]any {
	view := map[string]any{}
	if id, ok := record["id"].(string); ok {
		view["id"] = id
	}
	if name, ok := record["name"].(string); ok {
		view[nameKey] = name
	}
	for key, value := range record {
		if key == "id" || key == "name" || key == "attrs" {
			continue
		}
		view[key] = value
	}
	if attrs, ok := record["attrs"].([]any); ok {
		for _, raw := range attrs {
			attr, _ := raw.(map[string]any)
			key, _ := attr["key"].(string)
			if key == "" {
				continue
			}
			view[key] = attr["value"]
		}
	}
	return view
}

func ruleType(record map[string]any) string {
	if typed := attrRecordValue(record, "type"); typed != "" {
		switch typed {
		case "never", "prefer", "always":
			return typed
		}
	}
	return "always"
}

func ruleText(record map[string]any) string {
	if text := attrRecordValue(record, "text"); strings.TrimSpace(text) != "" {
		return text
	}
	if text := attrRecordValue(record, "guidance"); strings.TrimSpace(text) != "" {
		return text
	}
	if detail, ok := record["detail"].(string); ok && strings.TrimSpace(detail) != "" {
		return detail
	}
	name, _ := record["name"].(string)
	return name
}

// attrRecordValue reads one flattened attr value from a canonical record.
func attrRecordValue(record map[string]any, key string) string {
	attrs, _ := record["attrs"].([]any)
	for _, raw := range attrs {
		attr, _ := raw.(map[string]any)
		if attrKey, _ := attr["key"].(string); attrKey == key {
			value, _ := attr["value"].(string)
			return value
		}
	}
	value, _ := record[key].(string)
	return value
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
// WorldRevisionSummary is one row of the revision history (T12 快照/回滚面板).
type WorldRevisionSummary struct {
	ID        string `json:"id"`
	Hash      string `json:"hash"`
	Reason    string `json:"reason"`
	CreatedBy string `json:"createdBy"`
	CreatedAt string `json:"createdAt"`
}

// ListRevisions returns the world's revision history, newest first (limit 50).
func (w *WorldStore) ListRevisions(worldID string) ([]WorldRevisionSummary, error) {
	db, err := w.database()
	if err != nil {
		return nil, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, canonical_hash, reason, created_by, created_at from world_revisions where world_id = ? order by created_at desc, id desc limit 50", worldID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []WorldRevisionSummary{}
	for rows.Next() {
		var item WorldRevisionSummary
		if err := rows.Scan(&item.ID, &item.Hash, &item.Reason, &item.CreatedBy, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// RevertToRevision 回滚到历史版本（T12）：非破坏 —— 指针移到目标 revision（同 hash 不新建行），
// 实体/关系/证据按 canonical_json 重建（id 保留），画布投影不动；产前置冲突检查。
func (w *WorldStore) RevertToRevision(worldID, revisionID, expectedRevisionID, createdBy string) (WorldDetail, error) {
	db, err := w.database()
	if err != nil {
		return WorldDetail{}, err
	}
	if _, err := w.summary(db, worldID); err != nil {
		return WorldDetail{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return WorldDetail{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, worldID); err != nil {
		return WorldDetail{}, err
	}
	if err := w.checkWorldRevision(tx, worldID, expectedRevisionID); err != nil {
		return WorldDetail{}, err
	}
	var canonical string
	if err := tx.QueryRow("select canonical_json from world_revisions where id = ? and world_id = ?", revisionID, worldID).Scan(&canonical); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorldDetail{}, worldsError(WorldsErrRevisionNotFound, "revision not found in world")
		}
		return WorldDetail{}, err
	}
	var payload struct {
		World struct {
			Name        string         `json:"name"`
			Description string         `json:"description"`
		} `json:"world"`
		Skill      string                            `json:"skill"`
		Identity   map[string]any                    `json:"identity"`
		Entities   map[string][]map[string]any       `json:"entities"`
		Relations  []map[string]any                  `json:"relations"`
		References []map[string]any                  `json:"references"`
	}
	if err := json.Unmarshal([]byte(canonical), &payload); err != nil {
		return WorldDetail{}, err
	}
	now := iso(time.Now().UTC())
	// 语义表按 canonical 重建（历史冻结在该指针指向的 revision 里）；画布投影保留（实体 id 不变）。
	// 语义关系边的画布锚点清理（文档版）：kind=arrow 且 ref_id 指向旧 world_relations 的元素移除
	relationIDs := []string{}
	relationRows, err := tx.Query("select id from world_relations where world_id = ?", worldID)
	if err != nil {
		return WorldDetail{}, err
	}
	for relationRows.Next() {
		var id string
		if err := relationRows.Scan(&id); err != nil {
			relationRows.Close()
			return WorldDetail{}, err
		}
		relationIDs = append(relationIDs, id)
	}
	relationRows.Close()
	if err := relationRows.Err(); err != nil {
		return WorldDetail{}, err
	}
	relationSet := map[string]bool{}
	for _, id := range relationIDs {
		relationSet[id] = true
	}
	if err := mutateCanvasDocsInTx(tx, worldID, func(element WorldCanvasElement) bool {
		return element.Kind == "arrow" && relationSet[element.RefID]
	}); err != nil {
		return WorldDetail{}, err
	}
	if _, err := tx.Exec("delete from world_relations where world_id = ?", worldID); err != nil {
		return WorldDetail{}, err
	}
	if _, err := tx.Exec("delete from world_asset_refs where world_id = ?", worldID); err != nil {
		return WorldDetail{}, err
	}
	if _, err := tx.Exec("delete from world_entities where world_id = ?", worldID); err != nil {
		return WorldDetail{}, err
	}
	identityJSON, err := json.Marshal(payload.Identity)
	if err != nil {
		return WorldDetail{}, err
	}
	if _, err := tx.Exec("update worlds set name = ?, description = ?, identity_json = ?, skill_md = ?, current_revision_id = ?, updated_at = ? where id = ?",
		payload.World.Name, payload.World.Description, string(identityJSON), payload.Skill, revisionID, now, worldID); err != nil {
		return WorldDetail{}, err
	}
	// 实体：bucket key = typeId；record = id/name/intro/detail/typeId/attrs（统一实体模型）
	for typeID, records := range payload.Entities {
		for _, record := range records {
			id, _ := record["id"].(string)
			name, _ := record["name"].(string)
			intro, _ := record["intro"].(string)
			detail, _ := record["detail"].(string)
			rowTypeID, _ := record["typeId"].(string)
			if rowTypeID == "" {
				rowTypeID = typeID
			}
			if id == "" {
				continue
			}
			parentID, _ := record["parentId"].(string)
			attrs, err := json.Marshal(record["attrs"])
			if err != nil {
				return WorldDetail{}, err
			}
			if _, err := tx.Exec("insert into world_entities (id, world_id, type_id, kind, title, summary, detail, attrs_json, content_json, parent_id, container_role, is_provisional, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, '', 0, ?, ?)",
				id, worldID, rowTypeID, rowTypeID, name, intro, detail, string(attrs), nullIfEmpty(parentID), now, now); err != nil {
				return WorldDetail{}, err
			}
		}
	}
	// 关系（全局关系；局部关系不进 canonical，无法从历史恢复）
	for _, record := range payload.Relations {
		id, _ := record["id"].(string)
		relationType, _ := record["type"].(string)
		fromID, _ := record["from"].(string)
		toID, _ := record["to"].(string)
		if id == "" || relationType == "" || fromID == "" || toID == "" {
			continue
		}
		metadataJSON, err := json.Marshal(record["metadata"])
		if err != nil {
			return WorldDetail{}, err
		}
		if _, err := tx.Exec("insert into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json, created_at) values (?, ?, ?, ?, ?, ?, ?)",
			id, worldID, fromID, toID, relationType, string(metadataJSON), now); err != nil {
			return WorldDetail{}, err
		}
	}
	// 证据：unique(world_id, entity_id, asset_id, url, role) —— 旧行已物理删除，直接重插
	for _, record := range payload.References {
		id, _ := record["id"].(string)
		if id == "" {
			continue
		}
		assetID, _ := record["assetId"].(string)
		url, _ := record["url"].(string)
		contentHash, _ := record["assetContentHash"].(string)
		modality, _ := record["modality"].(string)
		purpose, _ := record["purpose"].(string)
		status, _ := record["status"].(string)
		collection, _ := record["collection"].(string)
		role, _ := record["role"].(string)
		label, _ := record["label"].(string)
		entityID, _ := record["entityId"].(string)
		source := record["source"]
		if source == nil {
			if assetID != "" {
				source = "asset"
			} else {
				source = "url"
			}
		}
		segmentJSON := ""
		if segment, ok := record["segment"].(map[string]any); ok {
			encoded, err := json.Marshal(segment)
			if err == nil {
				segmentJSON = string(encoded)
			}
		}
		if _, err := tx.Exec("insert into world_asset_refs (id, world_id, entity_id, asset_id, url, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, sort_order, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
			id, worldID, nullIfEmpty(entityID), assetID, url, contentHash, modality, purpose, status, collection, segmentJSON, role, label, now); err != nil {
			return WorldDetail{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return WorldDetail{}, err
	}
	logWorldEvent("world.reverted", map[string]string{"worldId": worldID, "revisionId": revisionID})
	return w.GetWorld(worldID)
}

func (w *WorldStore) GetProjectBinding(projectID string) (*CreationContextBinding, error) {	db, err := w.database()
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
	WorldID            string
	TypeID             string `json:"typeId"`
	Text               string `json:"text"`
	Cursor             string `json:"cursor"`
	Limit              int    `json:"limit"`
	IncludeProvisional bool   `json:"includeProvisional"`
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
	SkillMd            *string
	ExpectedRevisionID string
	CreatedBy          string
}

// UpsertEntityInput is the typed input of entity.upsert (RFC 统一 Entity 模型):
// name/intro/detail are the shared base; attrs is an ordered typed key-value
// list. A nil attrs list keeps the stored attrs untouched (partial updates
// from agents); a non-nil list replaces it wholesale (panel/canvas always hold
// the full entity).
type UpsertEntityInput struct {
	WorldID            string       `json:"worldId"`
	EntityID           string       `json:"entityId"`
	TypeID             string       `json:"typeId"`
	Name               string       `json:"name"`
	Intro              string       `json:"intro"`
	Detail             string       `json:"detail"`
	Attrs              []EntityAttr `json:"attrs"`
	ParentID           string       `json:"parentId"`
	ContainerRole      string       `json:"containerRole"`
	IsProvisional      bool         `json:"isProvisional"`
	ExpectedRevisionID string       `json:"expectedRevisionId"`
	CreatedBy          string       `json:"createdBy"`
}

// AttachReferenceInput is the typed input of reference.attach. Exactly one of
// AssetID (local completed media) or URL (absolute http(s)) must be set.
type AttachReferenceInput struct {
	WorldID            string
	EntityID           string
	AssetID            string
	URL                string
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
