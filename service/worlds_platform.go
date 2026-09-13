/*
 * [INPUT]: 依赖 WorldStore 的既有 worlds/world_entities/world_relations/world_asset_refs/world_revisions 表、
 * 确定性 canonical 序列化与 SHA-256 哈希
 * [OUTPUT]: 对外提供平台 World 内容层的领域原语：manifest 校验与确定性物化（materialize，manifest 实体/关系
 * ID 按 world 命名空间化存储，规避全局主键跨世界碰撞）、目录驱动的
 * 归档（archive）、brief v1 只读投影（skill/实体 body 内联）、Fork（非 local → local 可编辑副本）
 * [POS]: service 的 WorldStore 平台维度；物化/归档是 Catalog 同步器与未来 P4 install/update/uninstall
 * 共用的同一组原语，差异只在触发策略；运行时读取仍全部走既有单一路径
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
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Manifest size and content budgets. They are enforced at publish time (build
// script) and re-verified at materialization so a tampered or malformed CDN
// object can never reach the local store.
const (
	manifestMaxBytes   = 2 * 1024 * 1024 // manifest file ≤ 2MB
	skillMdMaxBytes    = 16 * 1024       // world.md ≤ 16KB
	entityBodyMaxBytes = 16 * 1024       // entity body 合计 ≤ 16KB
	evidenceMaxRows    = 200             // evidence 条目 ≤ 200
	briefEvidenceMax   = 100             // brief evidence ≤ 100 条
)

var worldEntityIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// WorldManifest is the published single-file format: canonical-complete, so the
// materializer performs zero network access beyond fetching this one file.
type WorldManifest struct {
	ManifestVersion int                     `json:"manifestVersion"`
	World           WorldManifestWorld      `json:"world"`
	Entities        []WorldManifestEntity   `json:"entities"`
	Relations       []WorldManifestRelation `json:"relations,omitempty"`
	Evidence        []WorldManifestEvidence `json:"evidence"`
	Provenance      *Provenance             `json:"provenance,omitempty"`
}

type WorldManifestWorld struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Type        WorldKind      `json:"type"`
	Description string         `json:"description"`
	CoverURL    string         `json:"coverUrl"`
	SkillMd     string         `json:"skillMd"`
	Identity    map[string]any `json:"identity"`
}

type WorldManifestEntity struct {
	ID      string         `json:"id"`
	Kind    string         `json:"kind"`
	Title   string         `json:"title"`
	Summary string         `json:"summary"`
	Content map[string]any `json:"content"`
}

type WorldManifestRelation struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	From  string `json:"from"`
	To    string `json:"to"`
	Scope string `json:"scope,omitempty"`
}

type WorldManifestEvidence struct {
	EntityID   string `json:"entityId"`
	URL        string `json:"url"`
	Modality   string `json:"modality"`
	Purpose    string `json:"purpose"`
	Status     string `json:"status"`
	Collection string `json:"collection"`
	Label      string `json:"label"`
}

// WorldManifestV2 is the unified content manifest (RFC world-content-format-v2):
// entityTypes + unified entities (attrs) + canvases, no evidence layer. Media
// attrs carry a CDN url and an optional generation recipe.
type WorldManifestV2 struct {
	ManifestVersion int                       `json:"manifestVersion"`
	World           WorldManifestWorld        `json:"world"`
	EntityTypes     []WorldManifestEntityType `json:"entityTypes,omitempty"`
	Entities        []WorldManifestEntityV2   `json:"entities"`
	Relations       []WorldManifestRelation   `json:"relations,omitempty"`
	Canvases        []WorldManifestCanvas     `json:"canvases,omitempty"`
	Provenance      *Provenance               `json:"provenance,omitempty"`
}

type WorldManifestEntityType struct {
	ID       string            `json:"id"`
	Scope    string            `json:"scope,omitempty"`
	Name     string            `json:"name"`
	Icon     string            `json:"icon,omitempty"`
	Color    string            `json:"color,omitempty"`
	BaseKind string            `json:"baseKind,omitempty"`
	Fields   []EntityTypeField `json:"fields"`
}

type WorldManifestEntityV2 struct {
	ID            string       `json:"id"`
	TypeID        string       `json:"typeId"`
	Name          string       `json:"name"`
	Intro         string       `json:"intro"`
	Detail        string       `json:"detail"`
	ParentID      string       `json:"parentId,omitempty"`
	ContainerRole string       `json:"containerRole,omitempty"`
	IsProvisional bool         `json:"isProvisional,omitempty"`
	Attrs         []EntityAttr `json:"attrs"`
}

type WorldManifestCanvas struct {
	ContextID string               `json:"contextId"`
	Elements  []WorldCanvasElement `json:"elements"`
}

// manifestVersionOf reads only the version header so MaterializeWorld can
// dispatch before fully decoding either shape.
func manifestVersionOf(data []byte) int {
	var header struct {
		ManifestVersion int `json:"manifestVersion"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		return 0
	}
	return header.ManifestVersion
}

// worldMediaURLRef extracts the remote url from a media attr value ({url,...}).
func worldMediaURLRef(value any) (string, bool) {
	record, ok := value.(map[string]any)
	if !ok {
		return "", false
	}
	raw, _ := record["url"].(string)
	return strings.TrimSpace(raw), raw != ""
}

// validateWorldManifestV2 enforces the published-format v2 rules: unified
// entities, media attrs referencing absolute CDN urls, canvases whose entity
// refs resolve inside the same manifest. It is the materialization-time second
// line of defense after the publish build script.
func validateWorldManifestV2(kind string, entryID string, manifest *WorldManifestV2) error {
	if manifest.ManifestVersion != 2 {
		return fmt.Errorf("unsupported manifestVersion %d", manifest.ManifestVersion)
	}
	prefix := "pgc."
	if kind == WorldPublished {
		prefix = "pub."
	}
	if !strings.HasPrefix(manifest.World.ID, prefix) {
		return fmt.Errorf("world id %q must start with %q for kind %q", manifest.World.ID, prefix, kind)
	}
	if manifest.World.ID != entryID {
		return fmt.Errorf("manifest world id %q does not match catalog entry %q", manifest.World.ID, entryID)
	}
	if strings.TrimSpace(manifest.World.Name) == "" {
		return errors.New("world name is required")
	}
	if !worldKinds[manifest.World.Type] {
		return fmt.Errorf("invalid world type %q", manifest.World.Type)
	}
	if len(manifest.World.SkillMd) > skillMdMaxBytes {
		return fmt.Errorf("skillMd exceeds %d bytes", skillMdMaxBytes)
	}
	seenType := map[string]bool{}
	for _, entityType := range manifest.EntityTypes {
		id := strings.TrimSpace(entityType.ID)
		if id == "" || seenType[id] {
			return fmt.Errorf("entity type id missing or duplicated: %q", entityType.ID)
		}
		if strings.TrimSpace(entityType.Name) == "" {
			return fmt.Errorf("entity type %q name is required", id)
		}
		for _, field := range entityType.Fields {
			if strings.TrimSpace(field.Key) == "" || !attrTypes[field.Type] {
				return fmt.Errorf("entity type %q has an invalid field %q/%q", id, field.Key, field.Type)
			}
		}
		seenType[id] = true
	}
	bodyTotal := 0
	seenEntity := map[string]bool{}
	for _, entity := range manifest.Entities {
		if !worldEntityIDPattern.MatchString(entity.ID) {
			return fmt.Errorf("entity id %q is not a stable slug", entity.ID)
		}
		if seenEntity[entity.ID] {
			return fmt.Errorf("duplicate entity id %q", entity.ID)
		}
		seenEntity[entity.ID] = true
		if strings.TrimSpace(entity.TypeID) == "" {
			return fmt.Errorf("entity %q typeId is required", entity.ID)
		}
		if strings.TrimSpace(entity.Name) == "" {
			return fmt.Errorf("entity %q name is required", entity.ID)
		}
		// A referenced type must be declared in the manifest or be a platform preset.
		if !seenType[entity.TypeID] {
			if _, preset := presetEntityTypeFields[entity.TypeID]; !preset {
				return fmt.Errorf("entity %q references undeclared type %q", entity.ID, entity.TypeID)
			}
		}
		bodyTotal += len(entity.Detail)
		if len(entity.Attrs) > 200 {
			return fmt.Errorf("entity %q has too many attrs (%d)", entity.ID, len(entity.Attrs))
		}
		for _, attr := range entity.Attrs {
			if strings.TrimSpace(attr.Key) == "" || !attrTypes[attr.Type] {
				return fmt.Errorf("entity %q attr %q has invalid type %q", entity.ID, attr.Key, attr.Type)
			}
			if attr.Type != "media" || attr.Value == nil {
				continue
			}
			rawURL, ok := worldMediaURLRef(attr.Value)
			if !ok {
				return fmt.Errorf("entity %q media attr %q must carry a url", entity.ID, attr.Key)
			}
			if parsed, err := url.Parse(rawURL); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
				return fmt.Errorf("entity %q media attr %q url must be absolute http(s): %q", entity.ID, attr.Key, rawURL)
			}
		}
	}
	if bodyTotal > entityBodyMaxBytes {
		return fmt.Errorf("entity detail total exceeds %d bytes", entityBodyMaxBytes)
	}
	seenRelation := map[string]bool{}
	for _, relation := range manifest.Relations {
		if relation.ID == "" || seenRelation[relation.ID] {
			return fmt.Errorf("relation id missing or duplicated: %q", relation.ID)
		}
		seenRelation[relation.ID] = true
		if relation.Type == "" {
			return fmt.Errorf("relation %q type is required", relation.ID)
		}
		if !seenEntity[relation.From] || !seenEntity[relation.To] {
			return fmt.Errorf("relation %q references unknown entities", relation.ID)
		}
	}
	canvasElementCount := 0
	for _, canvas := range manifest.Canvases {
		if canvas.ContextID != "" && !seenEntity[canvas.ContextID] {
			return fmt.Errorf("canvas context %q references an unknown entity", canvas.ContextID)
		}
		elementIDs := map[string]bool{}
		for _, element := range canvas.Elements {
			if strings.TrimSpace(element.ID) == "" || strings.TrimSpace(element.Kind) == "" {
				return fmt.Errorf("canvas %q has an element without id/kind", canvas.ContextID)
			}
			if elementIDs[element.ID] {
				return fmt.Errorf("canvas %q has a duplicate element id %q", canvas.ContextID, element.ID)
			}
			elementIDs[element.ID] = true
		}
		for _, element := range canvas.Elements {
			canvasElementCount++
			if element.Kind == "entity" || element.RefKind == "entity" {
				if element.RefID != "" && !seenEntity[element.RefID] {
					return fmt.Errorf("canvas %q entity element references unknown entity %q", canvas.ContextID, element.RefID)
				}
			}
			for _, key := range []string{"fromElementId", "toElementId"} {
				if ref, _ := element.Props[key].(string); ref != "" && !elementIDs[ref] {
					return fmt.Errorf("canvas %q element %q props.%s references a missing element", canvas.ContextID, element.ID, key)
				}
			}
			for _, key := range []string{"url"} {
				if raw, _ := element.Props[key].(string); raw != "" {
					if parsed, err := url.Parse(raw); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
						return fmt.Errorf("canvas %q element %q props.%s must be an absolute http(s) url: %q", canvas.ContextID, element.ID, key, raw)
					}
				}
			}
		}
	}
	if canvasElementCount > 2000 {
		return fmt.Errorf("canvas elements %d exceed 2000", canvasElementCount)
	}
	return nil
}


// ManifestHash is the hex SHA-256 of the manifest bytes exactly as served on
// the CDN. The catalog entry pins it; materialization is refused on mismatch.
func ManifestHash(manifest []byte) string {
	sum := sha256.Sum256(manifest)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// worldEvidenceRowID derives the deterministic local evidence row ID for a
// materialized reference. The same manifest therefore always yields the same
// canonical bytes on every device (cross-device consistency, idempotent sync).
// The label participates in the digest so two rows sharing (entity, url, role)
// but differing in presentation cannot collide on the primary key.
func worldEvidenceRowID(worldID, entityID, urlOrAsset, role, label string) string {
	sum := sha256.Sum256([]byte(worldID + "|" + entityID + "|" + urlOrAsset + "|" + role + "|" + label))
	return "ev-" + hex.EncodeToString(sum[:])[:20]
}

// validateWorldManifest enforces every published-format rule. It is the
// materialization-time second line of defense after the publish build script.
func validateWorldManifest(kind string, entryID string, manifest *WorldManifest) error {
	if manifest.ManifestVersion != 1 {
		return fmt.Errorf("unsupported manifestVersion %d", manifest.ManifestVersion)
	}
	prefix := "pgc."
	if kind == WorldPublished {
		prefix = "pub."
	}
	if !strings.HasPrefix(manifest.World.ID, prefix) {
		return fmt.Errorf("world id %q must start with %q for kind %q", manifest.World.ID, prefix, kind)
	}
	if manifest.World.ID != entryID {
		return fmt.Errorf("manifest world id %q does not match catalog entry %q", manifest.World.ID, entryID)
	}
	if strings.TrimSpace(manifest.World.Name) == "" {
		return errors.New("world name is required")
	}
	if !worldKinds[manifest.World.Type] {
		return fmt.Errorf("invalid world type %q", manifest.World.Type)
	}
	if len(manifest.World.SkillMd) > skillMdMaxBytes {
		return fmt.Errorf("skillMd exceeds %d bytes", skillMdMaxBytes)
	}
	bodyTotal := 0
	seenEntity := map[string]bool{}
	for _, entity := range manifest.Entities {
		if !worldEntityIDPattern.MatchString(entity.ID) {
			return fmt.Errorf("entity id %q is not a stable slug", entity.ID)
		}
		if seenEntity[entity.ID] {
			return fmt.Errorf("duplicate entity id %q", entity.ID)
		}
		seenEntity[entity.ID] = true
		if strings.TrimSpace(entity.Kind) == "" {
			return fmt.Errorf("entity %q kind is required", entity.ID)
		}
		if strings.TrimSpace(entity.Title) == "" {
			return fmt.Errorf("entity %q title is required", entity.ID)
		}
		if entity.Content != nil {
			if body, ok := entity.Content["body"].(string); ok {
				bodyTotal += len(body)
			}
		}
	}
	if bodyTotal > entityBodyMaxBytes {
		return fmt.Errorf("entity body total exceeds %d bytes", entityBodyMaxBytes)
	}
	if len(manifest.Evidence) > evidenceMaxRows {
		return fmt.Errorf("evidence rows %d exceed %d", len(manifest.Evidence), evidenceMaxRows)
	}
	seenEvidence := map[string]bool{}
	for _, evidence := range manifest.Evidence {
		if parsed, err := url.Parse(evidence.URL); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return fmt.Errorf("evidence url %q must be an absolute http(s) URL", evidence.URL)
		}
		if !evidenceModalities[evidence.Modality] {
			return fmt.Errorf("invalid evidence modality %q", evidence.Modality)
		}
		if !evidencePurposes[evidence.Purpose] {
			return fmt.Errorf("invalid evidence purpose %q", evidence.Purpose)
		}
		if !evidenceStatuses[evidence.Status] {
			return fmt.Errorf("invalid evidence status %q", evidence.Status)
		}
		if evidence.EntityID != "" && !seenEntity[evidence.EntityID] {
			return fmt.Errorf("evidence references unknown entity %q", evidence.EntityID)
		}
		// Deterministic row IDs key on (entity, url, role): duplicate triples
		// would collide at insert time and fail the whole materialization, so
		// they are rejected up front with a readable error instead.
		triple := evidence.EntityID + "|" + evidence.URL + "|" + "evidence:" + evidence.Purpose
		if seenEvidence[triple] {
			return fmt.Errorf("duplicate evidence row for entity %q url %q purpose %q", evidence.EntityID, evidence.URL, evidence.Purpose)
		}
		seenEvidence[triple] = true
	}
	seenRelation := map[string]bool{}
	for _, relation := range manifest.Relations {
		if relation.ID == "" || seenRelation[relation.ID] {
			return fmt.Errorf("relation id missing or duplicated: %q", relation.ID)
		}
		seenRelation[relation.ID] = true
		if relation.Type == "" {
			return fmt.Errorf("relation %q type is required", relation.ID)
		}
		if !seenEntity[relation.From] || !seenEntity[relation.To] {
			return fmt.Errorf("relation %q references unknown entities", relation.ID)
		}
	}
	return nil
}

// MaterializeWorld applies one catalog entry's manifest to the local store. It
// is idempotent: when the stored manifest hash already matches the entry, the
// world is untouched (zero revisions). Content changes produce exactly one new
// immutable revision, and old Project bindings keep resolving their pinned
// revision. Returns the revision ID and whether anything changed.
func (w *WorldStore) MaterializeWorld(entryID, entryKind, publisher, version, sha256Hex string, catalogOrder int, manifestBytes []byte) (string, bool, error) {
	if len(manifestBytes) > manifestMaxBytes {
		return "", false, fmt.Errorf("manifest exceeds %d bytes", manifestMaxBytes)
	}
	// Defense in depth: the syncer already enforces the catalog-pinned hash,
	// but the primitive re-verifies so a caller bypassing the syncer can never
	// materialize bytes that do not match the pinned digest.
	if normalized := strings.TrimPrefix(strings.ToLower(sha256Hex), "sha256:"); normalized != "" {
		sum := sha256.Sum256(manifestBytes)
		if !strings.EqualFold(hex.EncodeToString(sum[:]), normalized) {
			return "", false, fmt.Errorf("manifest hash mismatch: pinned %s, actual %s", sha256Hex, hex.EncodeToString(sum[:]))
		}
	}
	manifest := WorldManifest{}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return "", false, fmt.Errorf("parse manifest: %w", err)
	}
	// manifestVersion 2 is the unified document (entityTypes/attrs/canvases). The
	// v1 shape stays supported in place (evidence rows), so existing platform
	// content keeps materializing unchanged until the migration republishes it.
	var v2 *WorldManifestV2
	if manifest.ManifestVersion == 2 {
		decoded := WorldManifestV2{}
		if err := json.Unmarshal(manifestBytes, &decoded); err != nil {
			return "", false, fmt.Errorf("parse manifest v2: %w", err)
		}
		if err := validateWorldManifestV2(entryKind, entryID, &decoded); err != nil {
			return "", false, fmt.Errorf("invalid manifest v2: %w", err)
		}
		manifest.World = decoded.World
		manifest.Provenance = decoded.Provenance
		v2 = &decoded
	} else if err := validateWorldManifest(entryKind, entryID, &manifest); err != nil {
		return "", false, fmt.Errorf("invalid manifest: %w", err)
	}
	db, err := w.database()
	if err != nil {
		return "", false, err
	}
	// Normalize to the stored form: the catalog carries bare hex, origin meta
	// records "sha256:<hex>".
	manifestHash := sha256Hex
	if !strings.HasPrefix(manifestHash, "sha256:") {
		manifestHash = "sha256:" + manifestHash
	}
	var origin, originMetaJSON string
	row := db.QueryRow("select origin, origin_meta_json from worlds where id = ?", manifest.World.ID)
	scanErr := row.Scan(&origin, &originMetaJSON)
	if scanErr != nil && !errors.Is(scanErr, sql.ErrNoRows) {
		return "", false, scanErr
	}
	if !errors.Is(scanErr, sql.ErrNoRows) {
		// Row exists; normalize the stored origin ("" → local).
		origin = originOrDefault(origin)
	}
	// scanErr == sql.ErrNoRows: fresh materialization, origin stays "".
	if origin != "" && origin != entryKind {
		return "", false, fmt.Errorf("world %q already exists with origin %q, refusing to overwrite from kind %q", manifest.World.ID, origin, entryKind)
	}
	// Idempotency gate: same manifest, zero writes. A delisted-then-reactivated
	// entry must still revive the archived row, though: the canonical is
	// unchanged, so no new revision is needed — only archived_at clears.
	now := iso(time.Now().UTC())
	meta := WorldOriginMeta{}
	if originMetaJSON != "" {
		_ = json.Unmarshal([]byte(originMetaJSON), &meta)
	}
	if meta.ManifestHash != "" && meta.ManifestHash == manifestHash {
		if origin != "" && w.isArchived(manifest.World.ID) {
			if _, err := db.Exec("update worlds set archived_at = null, updated_at = ? where id = ?", now, manifest.World.ID); err != nil {
				return "", false, err
			}
			logWorldEvent("world.platform.unarchived", map[string]string{"worldId": manifest.World.ID})
			return "", true, nil
		}
		return "", false, nil
	}

	identityJSON, err := json.Marshal(manifest.World.Identity)
	if err != nil {
		return "", false, err
	}
	newMeta := WorldOriginMeta{
		Kind:         entryKind,
		Publisher:    publisher,
		Version:      version,
		ManifestHash: manifestHash,
		CatalogOrder: catalogOrder,
		CoverURL:     manifest.World.CoverURL,
		Provenance:   manifest.Provenance,
		SyncedAt:     now,
	}
	if entryKind == WorldPublished {
		newMeta.InstalledAt = now
	}
	if manifest.Provenance != nil && manifest.Provenance.PublishedAt != "" {
		newMeta.PublishedAt = manifest.Provenance.PublishedAt
	}
	originMetaOut, err := json.Marshal(newMeta)
	if err != nil {
		return "", false, err
	}

	tx, err := db.Begin()
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback()

	// Whole-transaction replace: non-local worlds are read-only for users, so
	// there is never a "local edits vs upstream update" merge problem.
	if origin == "" {
		if _, err := tx.Exec("insert into worlds (id, name, type, description, identity_json, origin, origin_meta_json, skill_md, current_revision_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)",
			manifest.World.ID, strings.TrimSpace(manifest.World.Name), string(manifest.World.Type), strings.TrimSpace(manifest.World.Description),
			string(identityJSON), entryKind, string(originMetaOut), manifest.World.SkillMd, now, now); err != nil {
			return "", false, err
		}
	} else {
		// Re-activating a delisted world clears its archived_at in the same
		// transaction that refreshes its content.
		if _, err := tx.Exec("update worlds set name = ?, type = ?, description = ?, identity_json = ?, origin = ?, origin_meta_json = ?, skill_md = ?, archived_at = null, updated_at = ? where id = ?",
			strings.TrimSpace(manifest.World.Name), string(manifest.World.Type), strings.TrimSpace(manifest.World.Description),
			string(identityJSON), entryKind, string(originMetaOut), manifest.World.SkillMd, now, manifest.World.ID); err != nil {
			return "", false, err
		}
	}
	// Manifest entity/relation IDs are unique per manifest, not globally:
	// generic ids like "style-dna" recur across platform worlds while the
	// storage PK is global. The stored form namespaces them with the world
	// id; every read API is world-scoped, so consumers only ever see the
	// stored form and the mapping is transparent.
	storedEntityID := func(entityID string) string { return manifest.World.ID + ":" + entityID }
	if v2 != nil {
		if err := insertManifestV2Tx(tx, manifest.World.ID, v2, now); err != nil {
			return "", false, err
		}
	} else {
		if _, err := tx.Exec("delete from world_asset_refs where world_id = ? and archived_at is null", manifest.World.ID); err != nil {
			return "", false, err
		}
		// Manifest rows are replaced wholesale, including archived ones: stale
		// archived rows would collide with re-inserted IDs on a re-activated
		// entry (world_entities.id is a global primary key).
		if _, err := tx.Exec("delete from world_entities where world_id = ?", manifest.World.ID); err != nil {
			return "", false, err
		}
		if _, err := tx.Exec("delete from world_relations where world_id = ?", manifest.World.ID); err != nil {
			return "", false, err
		}
		if err := ensurePresetEntityTypesInTx(tx, manifest.World.ID); err != nil {
			return "", false, err
		}
		for index, entity := range manifest.Entities {
			// Manifest wire format stays v1 (kind/title/summary/content); the
			// storage side is the unified entity model (typeId/name/intro/detail/
			// attrs). content.body → detail, remaining keys → text attrs.
			typeID := strings.TrimSpace(entity.Kind)
			if err := ensureEntityTypeInTx(tx, manifest.World.ID, typeID); err != nil {
				return "", false, err
			}
			detail := ""
			attrs := []EntityAttr{}
			for key, value := range entity.Content {
				if key == "body" {
					detail, _ = value.(string)
					continue
				}
				text, _ := value.(string)
				if text == "" {
					if encoded, err := json.Marshal(value); err == nil {
						text = string(encoded)
					}
				}
				attrs = append(attrs, EntityAttr{Key: key, Label: key, Type: "text", Value: text})
			}
			attrsJSON, err := json.Marshal(attrs)
			if err != nil {
				return "", false, err
			}
			if _, err := tx.Exec("insert into world_entities (id, world_id, type_id, kind, title, summary, detail, attrs_json, content_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)",
				storedEntityID(entity.ID), manifest.World.ID, typeID, typeID, strings.TrimSpace(entity.Title), strings.TrimSpace(entity.Summary), detail, string(attrsJSON), now, now); err != nil {
				return "", false, err
			}
			_ = index
		}
		for _, relation := range manifest.Relations {
			if _, err := tx.Exec("insert into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json, created_at) values (?, ?, ?, ?, ?, '{}', ?)",
				storedEntityID(relation.ID), manifest.World.ID, storedEntityID(relation.From), storedEntityID(relation.To), relation.Type, now); err != nil {
				return "", false, err
			}
		}
	}
	for index, evidence := range manifest.Evidence {
		role := "evidence:" + evidence.Purpose
		status := evidence.Status
		if status == "" {
			status = "supporting"
		}
		evidenceID := worldEvidenceRowID(manifest.World.ID, evidence.EntityID, evidence.URL, role, evidence.Label)
		entityRef := any(nil)
		if evidence.EntityID != "" {
			entityRef = storedEntityID(evidence.EntityID)
		}
		if _, err := tx.Exec("insert into world_asset_refs (id, world_id, entity_id, asset_id, url, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, sort_order, created_at) values (?, ?, ?, '', ?, '', ?, ?, ?, ?, '', ?, ?, ?, ?)",
			evidenceID, manifest.World.ID, entityRef, evidence.URL, evidence.Modality, evidence.Purpose, status, evidence.Collection, role, evidence.Label, index+1, now); err != nil {
			return "", false, err
		}
	}
	revisionID, err := w.commitRevision(tx, manifest.World.ID, "platform.sync", "platform")
	if err != nil {
		return "", false, err
	}
	if err := tx.Commit(); err != nil {
		return "", false, err
	}
	logWorldEvent("world.platform.materialized", map[string]string{"worldId": manifest.World.ID, "version": version, "revisionId": revisionID})
	if entryKind == WorldPublished {
		logWorldEvent("world.published.materialized", map[string]string{"worldId": manifest.World.ID, "version": version, "revisionId": revisionID, "op": "install"})
	}
	return revisionID, true, nil
}

// insertManifestV2Tx replaces a world's unified content inside the materialize
// transaction: entity type directory, entities (attrs), relations and canvas
// documents. IDs are namespaced with the world id exactly like the v1 path, so
// cross-world generic slugs never collide. Canvas is the expression layer: it
// is stored but never enters the Canon.
func insertManifestV2Tx(tx *sql.Tx, worldID string, manifest *WorldManifestV2, now string) error {
	storedID := func(id string) string { return worldID + ":" + id }
	provisional := func(flag bool) int {
		if flag {
			return 1
		}
		return 0
	}
	for _, statement := range []string{
		"delete from world_asset_refs where world_id = ?",
		"delete from world_entities where world_id = ?",
		"delete from world_relations where world_id = ?",
		"delete from world_canvases where world_id = ?",
	} {
		if _, err := tx.Exec(statement, worldID); err != nil {
			return err
		}
	}
	if err := ensurePresetEntityTypesInTx(tx, worldID); err != nil {
		return err
	}
	for _, entityType := range manifest.EntityTypes {
		if err := upsertManifestEntityTypeInTx(tx, worldID, entityType, now); err != nil {
			return err
		}
	}
	for _, entity := range manifest.Entities {
		if err := ensureEntityTypeInTx(tx, worldID, entity.TypeID); err != nil {
			return err
		}
		attrs := entity.Attrs
		if attrs == nil {
			attrs = []EntityAttr{}
		}
		attrsJSON, err := json.Marshal(attrs)
		if err != nil {
			return err
		}
		var parent any
		if strings.TrimSpace(entity.ParentID) != "" {
			parent = storedID(entity.ParentID)
		}
		if _, err := tx.Exec("insert into world_entities (id, world_id, type_id, kind, title, summary, detail, attrs_json, content_json, parent_id, container_role, is_provisional, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)",
			storedID(entity.ID), worldID, entity.TypeID, entity.TypeID, strings.TrimSpace(entity.Name), strings.TrimSpace(entity.Intro), entity.Detail, string(attrsJSON), parent, entity.ContainerRole, provisional(entity.IsProvisional), now, now); err != nil {
			return err
		}
	}
	for _, relation := range manifest.Relations {
		var scope any
		if strings.TrimSpace(relation.Scope) != "" {
			scope = storedID(relation.Scope)
		}
		if _, err := tx.Exec("insert into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json, scope_entity_id, created_at) values (?, ?, ?, ?, ?, '{}', ?, ?)",
			storedID(relation.ID), worldID, storedID(relation.From), storedID(relation.To), relation.Type, scope, now); err != nil {
			return err
		}
	}
	for _, canvas := range manifest.Canvases {
		contextID := ""
		if strings.TrimSpace(canvas.ContextID) != "" {
			contextID = storedID(canvas.ContextID)
		}
		elements := make([]WorldCanvasElement, 0, len(canvas.Elements))
		for _, element := range canvas.Elements {
			element.WorldID = worldID
			element.ContextID = contextID
			if element.Kind == "entity" || element.RefKind == "entity" {
				if strings.TrimSpace(element.RefID) != "" {
					element.RefID = storedID(element.RefID)
				}
			}
			elements = append(elements, element)
		}
		payload, err := encodeCanvasDocPayload(canvasDocPayload{DocVersion: 1, Elements: normalizeCanvasElements(elements)})
		if err != nil {
			return err
		}
		if _, err := tx.Exec("insert into world_canvases (id, world_id, context_id, doc_json, version, created_at, updated_at) values (?, ?, ?, ?, 1, ?, ?)",
			canvasDocID(worldID, contextID), worldID, contextID, payload, now, now); err != nil {
			return err
		}
	}
	return nil
}

// upsertManifestEntityTypeInTx writes one manifest entity type into the world's
// type directory. Preset ids stay builtin copies (overriding the seeded fields);
// other ids are world-local custom types.
func upsertManifestEntityTypeInTx(tx *sql.Tx, worldID string, entityType WorldManifestEntityType, now string) error {
	fields := entityType.Fields
	if fields == nil {
		fields = []EntityTypeField{}
	}
	fieldsJSON, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	scope := "custom"
	builtin := 0
	if _, preset := presetEntityTypeFields[entityType.ID]; preset {
		scope = "builtin"
		builtin = 1
	} else if entityType.Scope == "builtin" || entityType.Scope == "preset" {
		scope = entityType.Scope
	}
	var existing string
	err = tx.QueryRow("select id from world_entity_types where world_id = ? and id = ?", worldID, entityType.ID).Scan(&existing)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = tx.Exec("insert into world_entity_types (id, world_id, scope, name, icon, color, base_kind, fields_json, builtin, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			entityType.ID, worldID, scope, entityType.Name, entityType.Icon, entityType.Color, entityType.BaseKind, string(fieldsJSON), builtin, now, now)
		return err
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec("update world_entity_types set scope = ?, name = ?, icon = ?, color = ?, base_kind = ?, fields_json = ?, builtin = ?, updated_at = ? where world_id = ? and id = ?",
		scope, entityType.Name, entityType.Icon, entityType.Color, entityType.BaseKind, string(fieldsJSON), builtin, now, worldID, entityType.ID)
	return err
}

// isArchived reports whether the world row is currently archived.
func (w *WorldStore) isArchived(worldID string) bool {
	db, err := w.database()
	if err != nil {
		return false
	}
	var archivedAt sql.NullString
	if err := db.QueryRow("select archived_at from worlds where id = ?", worldID).Scan(&archivedAt); err != nil {
		return false
	}
	return archivedAt.Valid
}

// nullIfEmpty stores "" as SQL NULL so nullable FK columns keep their meaning.
func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// ArchiveWorld delists one non-local World from the current store state. The
// row is never hard-deleted: Project bindings pinned to its revisions keep
// resolving. It is idempotent for an already-archived world.
func (w *WorldStore) ArchiveWorld(worldID, reason, createdBy string) (bool, error) {
	return w.archiveWorld(worldID, reason, createdBy, false)
}

// ArchiveWorldForUser archives a world on explicit user request. Only local
// worlds (the user's own) can be archived: platform worlds are owned by the
// catalog lifecycle (delisted via sync), and published worlds are frozen for
// P4 manual install/uninstall. The row is never hard-deleted: Project
// bindings pinned to its revisions keep resolving. It is idempotent for an
// already-archived world.
func (w *WorldStore) ArchiveWorldForUser(worldID, createdBy string) (bool, error) {
	db, err := w.database()
	if err != nil {
		return false, err
	}
	var origin string
	if err := db.QueryRow("select origin from worlds where id = ?", worldID).Scan(&origin); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, worldsError(WorldsErrNotFound, "world not found")
		}
		return false, err
	}
	if originOrDefault(origin) != WorldLocal {
		return false, worldsError(WorldsErrContextInvalid, "only local worlds can be archived by the user")
	}
	return w.archiveWorld(worldID, "user", createdBy, true)
}

func (w *WorldStore) archiveWorld(worldID, reason, createdBy string, allowLocal bool) (bool, error) {
	db, err := w.database()
	if err != nil {
		return false, err
	}
	var origin, archivedAt string
	row := db.QueryRow("select origin, coalesce(archived_at, '') from worlds where id = ?", worldID)
	if err := row.Scan(&origin, &archivedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// A delisted entry whose world was never materialized locally is
			// already "absent": archiving is an idempotent no-op, not an error.
			return false, nil
		}
		return false, err
	}
	if !allowLocal && originOrDefault(origin) == WorldLocal {
		return false, worldsError(WorldsErrContextInvalid, "local worlds cannot be archived through the catalog lifecycle")
	}
	if archivedAt != "" {
		return false, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	now := iso(time.Now().UTC())
	if _, err := tx.Exec("update worlds set archived_at = ?, updated_at = ? where id = ?", now, now, worldID); err != nil {
		return false, err
	}
	// commitRevision reconciles the revision state; the canonical content is
	// unchanged by archiving, so hash de-duplication keeps this a no-op unless
	// the content concurrently changed.
	if _, err := w.commitRevision(tx, worldID, "world.archived:"+reason, createdBy); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	logWorldEvent("world.platform.archived", map[string]string{"worldId": worldID, "reason": reason})
	return true, nil
}

// UnarchiveWorld restores an active catalog entry's world.
func (w *WorldStore) UnarchiveWorld(worldID string) (bool, error) {
	db, err := w.database()
	if err != nil {
		return false, err
	}
	var origin, archivedAt string
	row := db.QueryRow("select origin, coalesce(archived_at, '') from worlds where id = ?", worldID)
	if err := row.Scan(&origin, &archivedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, worldsError(WorldsErrNotFound, "world not found")
		}
		return false, err
	}
	if originOrDefault(origin) == WorldLocal || archivedAt == "" {
		return false, nil
	}
	if _, err := db.Exec("update worlds set archived_at = null, updated_at = ? where id = ?", iso(time.Now().UTC()), worldID); err != nil {
		return false, err
	}
	return true, nil
}

// BriefInput is the typed input of recut.worlds.brief: the single default read
// entry that yields a production-ready context in one call.
type BriefInput struct {
	WorldID    string
	RevisionID string
	Selection  WorldSelection
}

// WorldBrief is the read-only projection an Agent consumes before producing.
// Skill (world.md) and entity bodies are inlined: practice + long factual text
// are the core PGC payload, and a second fetch would break "one call, can
// produce". Selection semantics mirror Resolve.
type WorldBrief struct {
	World       WorldBriefWorld     `json:"world"`
	Identity    map[string]any      `json:"identity"`
	Skill       string              `json:"skill,omitempty"`
	Facts       WorldBriefFacts     `json:"facts"`
	Constraints WorldConstraints    `json:"constraints"`
	Evidence    []WorldEvidence     `json:"evidence"`
	Missing     []WorldBriefMissing `json:"missing"`
}

type WorldBriefWorld struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Origin        string           `json:"origin"`
	OriginMeta    *WorldOriginMeta `json:"originMeta,omitempty"`
	Provenance    *Provenance      `json:"provenance,omitempty"`
	RevisionID    string           `json:"revisionId"`
	CanonicalHash string           `json:"canonicalHash"`
}

type WorldBriefFacts struct {
	Characters []map[string]any `json:"characters"`
	Stories    []map[string]any `json:"stories"`
	Locations  []map[string]any `json:"locations"`
	Styles     []map[string]any `json:"styles"`
}

// WorldBriefMissing is one actionable completeness gap, projected by the same
// readiness computation that drives the onboarding UI (worlds_readiness.go):
// UI and Agent always agree on what a world is missing and what to do next.
type WorldBriefMissing struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Reason     string `json:"reason,omitempty"`
	Suggestion string `json:"suggestion,omitempty"`
}

// Brief projects a production-ready context from the frozen revision canonical,
// exactly like Resolve, but inlines the world skill and entity bodies.
func (w *WorldStore) Brief(input BriefInput) (WorldBrief, error) {
	if input.WorldID == "" {
		return WorldBrief{}, worldsError(WorldsErrContextInvalid, "worldId is required")
	}
	if input.Selection.Purpose == "" {
		input.Selection.Purpose = "agent"
	}
	if !worldPurposeKinds[input.Selection.Purpose] {
		return WorldBrief{}, worldsError(WorldsErrContextInvalid, fmt.Sprintf("invalid selection purpose %q", input.Selection.Purpose))
	}
	db, err := w.database()
	if err != nil {
		return WorldBrief{}, err
	}
	world, err := w.GetWorld(input.WorldID)
	if err != nil {
		return WorldBrief{}, err
	}
	revisionID := input.RevisionID
	if revisionID == "" {
		revisionID = world.CurrentRevisionID
	}
	var canonicalJSON, canonicalHash string
	revRow := db.QueryRow("select canonical_json, canonical_hash from world_revisions where id = ? and world_id = ?", revisionID, input.WorldID)
	if err := revRow.Scan(&canonicalJSON, &canonicalHash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorldBrief{}, worldsError(WorldsErrRevisionNotFound, "world revision not found")
		}
		return WorldBrief{}, err
	}
	canonical := map[string]any{}
	if err := json.Unmarshal([]byte(canonicalJSON), &canonical); err != nil {
		return WorldBrief{}, err
	}
	selection, err := validateSelectionCanonical(canonical, input.Selection)
	if err != nil {
		return WorldBrief{}, err
	}

	brief := WorldBrief{
		World: WorldBriefWorld{
			ID: world.ID, Name: world.Name, Origin: world.Origin,
			OriginMeta:    world.OriginMeta,
			RevisionID:    revisionID,
			CanonicalHash: canonicalHash,
		},
		Identity: world.Identity,
		Skill:    canonicalString(canonical, "skill"),
		Facts:    WorldBriefFacts{Characters: []map[string]any{}, Stories: []map[string]any{}, Locations: []map[string]any{}, Styles: []map[string]any{}},
		Evidence: []WorldEvidence{},
		Missing:  []WorldBriefMissing{},
	}
	if world.OriginMeta != nil {
		brief.World.Provenance = world.OriginMeta.Provenance
	}

	selected := map[string]bool{}
	for _, id := range selection.EntityIDs {
		selected[id] = true
	}
	if selection.StoryID != "" {
		selected[selection.StoryID] = true
	}
	includeAll := len(selected) == 0

	entities, _ := canonical["entities"].(map[string]any)
	for kind, bucket := range entities {
		records, _ := bucket.([]any)
		for _, raw := range records {
			record, _ := raw.(map[string]any)
			id, _ := record["id"].(string)
			if !includeAll && !selected[id] {
				continue
			}
			// Brief facts share the Resolve entity projection: attrs are
			// flattened key→value so generation prompts read natural fields.
			view := w.entityView(record, "name")
			baseKind, _ := record["baseKind"].(string)
			if baseKind == "" {
				baseKind = kind
			}
			switch baseKind {
			case "character":
				brief.Facts.Characters = append(brief.Facts.Characters, view)
			case "story":
				brief.Facts.Stories = append(brief.Facts.Stories, view)
			case "location":
				brief.Facts.Locations = append(brief.Facts.Locations, view)
			case "style":
				brief.Facts.Styles = append(brief.Facts.Styles, view)
			case "rule":
				text := ruleText(record)
				switch ruleType(record) {
				case "never":
					brief.Constraints.Never = append(brief.Constraints.Never, text)
				case "prefer":
					brief.Constraints.Prefer = append(brief.Constraints.Prefer, text)
				default:
					brief.Constraints.Always = append(brief.Constraints.Always, text)
				}
			}
		}
	}

	desiredRoles := map[string]bool{}
	for _, role := range selection.AssetRoles {
		desiredRoles[role] = true
	}
	refs, _ := canonical["references"].([]any)
	for _, raw := range refs {
		if len(brief.Evidence) >= briefEvidenceMax {
			break
		}
		record, _ := raw.(map[string]any)
		encoded, _ := json.Marshal(record)
		evidence := WorldEvidence{}
		_ = json.Unmarshal(encoded, &evidence)
		if evidence.Source == "" {
			evidence.Source = EvidenceSourceAsset
		}
		entityMatches := evidence.EntityID == "" || includeAll || selected[evidence.EntityID]
		roleMatches := desiredRoles[evidence.Role] && evidence.EntityID == ""
		if entityMatches || roleMatches {
			brief.Evidence = append(brief.Evidence, evidence)
		}
	}
	// brief.missing shares the readiness computation with the onboarding UI so
	// Agent and UI never disagree. It is measured on this revision's canonical
	// (not the live head): a pinned brief stays consistent with its facts.
	brief.Missing = briefMissingFromCanonical(canonical, world)
	logWorldEvent("world.brief", map[string]string{"worldId": input.WorldID, "revisionId": revisionID})
	return brief, nil
}

// briefMissingFromCanonical builds a readiness snapshot from the frozen
// revision canonical and projects its missing list into the brief shape.
func briefMissingFromCanonical(canonical map[string]any, world WorldDetail) []WorldBriefMissing {
	snapshot := readinessSnapshot{
		WorldType: world.Type,
		SkillMd:   canonicalString(canonical, "skill"),
		Identity:  world.Identity,
	}
	if snapshot.Identity == nil {
		snapshot.Identity = map[string]any{}
	}
	entities, _ := canonical["entities"].(map[string]any)
	for kind, bucket := range entities {
		records, _ := bucket.([]any)
		for _, raw := range records {
			record, _ := raw.(map[string]any)
			baseKind, _ := record["baseKind"].(string)
			if baseKind == "" {
				baseKind = kind
			}
			// Readiness measures the same content projection as the live
			// Readiness endpoint: body = detail + flattened attrs (key→value).
			content := map[string]any{}
			if detail, ok := record["detail"].(string); ok {
				content["body"] = detail
			}
			if attrs, ok := record["attrs"].([]any); ok {
				for _, rawAttr := range attrs {
					attr, _ := rawAttr.(map[string]any)
					if key, _ := attr["key"].(string); key != "" {
						content[key] = attr["value"]
					}
				}
			}
			snapshot.Entities = append(snapshot.Entities, readinessEntitySnapshot{Kind: baseKind, Content: content})
		}
	}
	refs, _ := canonical["references"].([]any)
	for _, raw := range refs {
		record, _ := raw.(map[string]any)
		purpose, _ := record["purpose"].(string)
		modality, _ := record["modality"].(string)
		snapshot.Evidence = append(snapshot.Evidence, readinessEvidenceSnapshot{Purpose: purpose, Modality: modality})
	}
	readiness := computeReadiness(snapshot, "")
	missing := make([]WorldBriefMissing, 0, len(readiness.Missing))
	for _, item := range readiness.Missing {
		missing = append(missing, WorldBriefMissing{ID: item.ID, Kind: item.Kind, Title: item.Title, Reason: item.Reason, Suggestion: item.Suggestion})
	}
	return missing
}

func canonicalString(canonical map[string]any, key string) string {
	value, _ := canonical[key].(string)
	return value
}

// ForkWorldInput is the typed input of recut.worlds.fork.
type ForkWorldInput struct {
	WorldID string
	Name    string
}

// ForkWorld copies a World's current revision snapshot into a fresh local,
// fully editable World. Non-local worlds' entity IDs are remapped to new local
// IDs (relations remapped with them); evidence is copied as-is (asset or url).
// The copy is completely independent of upstream: later platform syncs never
// touch it. Forking is itself one normal revision (world.forked).
func (w *WorldStore) ForkWorld(input ForkWorldInput) (WorldDetail, error) {
	if strings.TrimSpace(input.WorldID) == "" {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "worldId is required")
	}
	db, err := w.database()
	if err != nil {
		return WorldDetail{}, err
	}
	var name, description string
	var worldType WorldKind
	var identityJSON, skillMd, revisionID string
	row := db.QueryRow("select name, type, description, identity_json, skill_md, current_revision_id, archived_at from worlds where id = ?", input.WorldID)
	var archivedAt sql.NullString
	if err := row.Scan(&name, &worldType, &description, &identityJSON, &skillMd, &revisionID, &archivedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorldDetail{}, worldsError(WorldsErrNotFound, "world not found")
		}
		return WorldDetail{}, err
	}
	if archivedAt.Valid {
		return WorldDetail{}, worldsError(WorldsErrNotFound, "world is offline")
	}
	newName := strings.TrimSpace(input.Name)
	if newName == "" {
		newName = name + " 副本"
	}
	newWorldID, err := newID()
	if err != nil {
		return WorldDetail{}, err
	}
	forkMeta, err := json.Marshal(WorldOriginMeta{ForkedFrom: &ForkSource{WorldID: input.WorldID, RevisionID: revisionID}})
	if err != nil {
		return WorldDetail{}, err
	}
	now := iso(time.Now().UTC())
	tx, err := db.Begin()
	if err != nil {
		return WorldDetail{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("insert into worlds (id, name, type, description, identity_json, origin, origin_meta_json, skill_md, current_revision_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)",
		newWorldID, newName, string(worldType), description, identityJSON, WorldLocal, string(forkMeta), skillMd, now, now); err != nil {
		return WorldDetail{}, err
	}
	entityRows, err := tx.Query("select id, coalesce(nullif(type_id, ''), kind), detail, attrs_json, parent_id, container_role, is_provisional from world_entities where world_id = ? and archived_at is null", input.WorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	idMap := map[string]string{}
	for entityRows.Next() {
		var oldID, typeID, detail, attrsJSON, parentID, containerRole string
		var provisional int
		var parentNull sql.NullString
		if err := entityRows.Scan(&oldID, &typeID, &detail, &attrsJSON, &parentNull, &containerRole, &provisional); err != nil {
			entityRows.Close()
			return WorldDetail{}, err
		}
		parentID = parentNull.String
		newEntityID, err := newID()
		if err != nil {
			entityRows.Close()
			return WorldDetail{}, err
		}
		idMap[oldID] = newEntityID
		if _, err := tx.Exec("insert into world_entities (id, world_id, type_id, kind, title, summary, detail, attrs_json, content_json, parent_id, container_role, is_provisional, created_at, updated_at) select ?, ?, ?, ?, title, summary, ?, ?, '{}', ?, ?, ?, ?, ? from world_entities where id = ?",
			newEntityID, newWorldID, typeID, typeID, detail, attrsJSON, nullIfEmpty(parentID), containerRole, provisional, now, now, oldID); err != nil {
			entityRows.Close()
			return WorldDetail{}, err
		}
	}
	entityRows.Close()
	if err := entityRows.Err(); err != nil {
		return WorldDetail{}, err
	}
	// Container parents are remapped in a second pass (a parent can appear
	// after its child in scan order, so idMap must be complete first).
	parentRows, err := tx.Query("select id, parent_id from world_entities where world_id = ? and parent_id is not null", newWorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	type parentRemap struct{ id, parent string }
	remaps := []parentRemap{}
	for parentRows.Next() {
		var id, parent string
		if err := parentRows.Scan(&id, &parent); err != nil {
			parentRows.Close()
			return WorldDetail{}, err
		}
		remaps = append(remaps, parentRemap{id: id, parent: parent})
	}
	parentRows.Close()
	for _, remap := range remaps {
		if _, err := tx.Exec("update world_entities set parent_id = ? where id = ? and world_id = ?", nullIfEmpty(remap.parent), remap.id, newWorldID); err != nil {
			return WorldDetail{}, err
		}
	}
	relationRows, err := tx.Query("select relation_type, from_entity_id, to_entity_id, metadata_json, scope_entity_id, created_at from world_relations where world_id = ?", input.WorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	for relationRows.Next() {
		var relationType, fromID, toID, metadataJSON, scopeID, createdAt string
		var scopeNull sql.NullString
		if err := relationRows.Scan(&relationType, &fromID, &toID, &metadataJSON, &scopeNull, &createdAt); err != nil {
			relationRows.Close()
			return WorldDetail{}, err
		}
		scopeID = scopeNull.String
		newRelationID, err := newID()
		if err != nil {
			relationRows.Close()
			return WorldDetail{}, err
		}
		if newFrom, ok := idMap[fromID]; ok {
			if newTo, ok := idMap[toID]; ok {
				newScope := ""
				if remapped, ok := idMap[scopeID]; ok {
					newScope = remapped
				}
				if _, err := tx.Exec("insert into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json, scope_entity_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
					newRelationID, newWorldID, newFrom, newTo, relationType, metadataJSON, nullIfEmpty(newScope), createdAt); err != nil {
					relationRows.Close()
					return WorldDetail{}, err
				}
			}
		}
	}
	relationRows.Close()
	if err := relationRows.Err(); err != nil {
		return WorldDetail{}, err
	}
	// Entity type directory travels with the world so custom types survive fork.
	typeRows, err := tx.Query("select id, scope, name, icon, color, base_kind, fields_json, builtin from world_entity_types where world_id = ?", input.WorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	for typeRows.Next() {
		var id, scope, name, icon, color, baseKind, fieldsJSON string
		var builtin int
		if err := typeRows.Scan(&id, &scope, &name, &icon, &color, &baseKind, &fieldsJSON, &builtin); err != nil {
			typeRows.Close()
			return WorldDetail{}, err
		}
		if _, err := tx.Exec("insert into world_entity_types (id, world_id, scope, name, icon, color, base_kind, fields_json, builtin, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			id, newWorldID, scope, name, icon, color, baseKind, fieldsJSON, builtin, now, now); err != nil {
			typeRows.Close()
			return WorldDetail{}, err
		}
	}
	typeRows.Close()
	if err := typeRows.Err(); err != nil {
		return WorldDetail{}, err
	}
	// Canvas elements travel too; entity refs are remapped to the fork ids.
	canvasRows, err := tx.Query("select id, context_id, kind, ref_kind, ref_id, name, props_json, geometry_json, style_json, layer, created_at from world_canvas where world_id = ?", input.WorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	for canvasRows.Next() {
		var id, contextID, kind, refKind, refID, name, propsJSON, geometryJSON, styleJSON, layer, createdAt string
		if err := canvasRows.Scan(&id, &contextID, &kind, &refKind, &refID, &name, &propsJSON, &geometryJSON, &styleJSON, &layer, &createdAt); err != nil {
			canvasRows.Close()
			return WorldDetail{}, err
		}
		if remapped, ok := idMap[refID]; ok {
			refID = remapped
		}
		if _, err := tx.Exec("insert into world_canvas (id, world_id, context_id, kind, ref_kind, ref_id, name, props_json, geometry_json, style_json, layer, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			id, newWorldID, contextID, kind, refKind, refID, name, propsJSON, geometryJSON, styleJSON, layer, createdAt, now); err != nil {
			canvasRows.Close()
			return WorldDetail{}, err
		}
	}
	canvasRows.Close()
	if err := canvasRows.Err(); err != nil {
		return WorldDetail{}, err
	}
	// Canvas documents travel too; entity refs are remapped to the fork ids.
	docRows, err := tx.Query("select context_id, doc_json, version, created_at from world_canvases where world_id = ?", input.WorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	for docRows.Next() {
		var contextID, raw, createdAt string
		var version int
		if err := docRows.Scan(&contextID, &raw, &version, &createdAt); err != nil {
			docRows.Close()
			return WorldDetail{}, err
		}
		payload, err := decodeCanvasDocPayload(raw)
		if err != nil {
			docRows.Close()
			return WorldDetail{}, err
		}
		for i := range payload.Elements {
			if remapped, ok := idMap[payload.Elements[i].RefID]; ok {
				payload.Elements[i].RefID = remapped
			}
		}
		encoded, err := encodeCanvasDocPayload(payload)
		if err != nil {
			docRows.Close()
			return WorldDetail{}, err
		}
		if _, err := tx.Exec("insert into world_canvases (id, world_id, context_id, doc_json, version, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
			canvasDocID(newWorldID, contextID), newWorldID, contextID, encoded, version, createdAt, now); err != nil {
			docRows.Close()
			return WorldDetail{}, err
		}
	}
	docRows.Close()
	if err := docRows.Err(); err != nil {
		return WorldDetail{}, err
	}
	refRows, err := tx.Query("select "+worldEvidenceColumns+" from world_asset_refs where world_id = ? and archived_at is null order by sort_order, created_at", input.WorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	forkOrder := 0
	for refRows.Next() {
		evidence, err := scanWorldEvidence(refRows)
		if err != nil {
			refRows.Close()
			return WorldDetail{}, err
		}
		forkOrder++
		newRefID, err := newID()
		if err != nil {
			refRows.Close()
			return WorldDetail{}, err
		}
		entityID := evidence.EntityID
		if remapped, ok := idMap[entityID]; ok {
			entityID = remapped
		}
		segmentJSON := ""
		if evidence.Segment != nil {
			encoded, _ := json.Marshal(evidence.Segment)
			segmentJSON = string(encoded)
		}
		if _, err := tx.Exec("insert into world_asset_refs (id, world_id, entity_id, asset_id, url, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, sort_order, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			newRefID, newWorldID, nullIfEmpty(entityID), evidence.AssetID, evidence.URL, evidence.AssetContentHash, evidence.Modality, evidence.Purpose, evidence.Status, evidence.Collection, segmentJSON, evidence.Role, evidence.Label, forkOrder, now); err != nil {
			refRows.Close()
			return WorldDetail{}, err
		}
	}
	refRows.Close()
	if err := refRows.Err(); err != nil {
		return WorldDetail{}, err
	}
	if _, err := w.commitRevision(tx, newWorldID, "world.forked", "user"); err != nil {
		return WorldDetail{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldDetail{}, err
	}
	_ = w.EnsurePresetEntityTypes(newWorldID)
	logWorldEvent("world.forked", map[string]string{"fromWorldId": input.WorldID, "toWorldId": newWorldID, "fromRevisionId": revisionID})
	return w.GetWorld(newWorldID)
}
