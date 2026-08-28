/*
 * [INPUT]: 依赖 WorldStore 的既有 worlds/world_entities/world_relations/world_asset_refs/world_revisions 表、
 * 确定性 canonical 序列化与 SHA-256 哈希
 * [OUTPUT]: 对外提供平台 World 内容层的领域原语：manifest 校验与确定性物化（materialize）、目录驱动的
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
	ID      string          `json:"id"`
	Kind    WorldEntityKind `json:"kind"`
	Title   string          `json:"title"`
	Summary string          `json:"summary"`
	Content map[string]any  `json:"content"`
}

type WorldManifestRelation struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	From string `json:"from"`
	To   string `json:"to"`
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
		if !worldEntityKinds[entity.Kind] {
			return fmt.Errorf("invalid entity kind %q", entity.Kind)
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
	if err := validateWorldManifest(entryKind, entryID, &manifest); err != nil {
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
	if _, err := tx.Exec("delete from world_asset_refs where world_id = ? and archived_at is null", manifest.World.ID); err != nil {
		return "", false, err
	}
	if _, err := tx.Exec("delete from world_entities where world_id = ? and archived_at is null", manifest.World.ID); err != nil {
		return "", false, err
	}
	if _, err := tx.Exec("delete from world_relations where world_id = ?", manifest.World.ID); err != nil {
		return "", false, err
	}
	for index, entity := range manifest.Entities {
		contentJSON, err := json.Marshal(entity.Content)
		if err != nil {
			return "", false, err
		}
		if _, err := tx.Exec("insert into world_entities (id, world_id, kind, title, summary, content_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
			entity.ID, manifest.World.ID, string(entity.Kind), strings.TrimSpace(entity.Title), strings.TrimSpace(entity.Summary), string(contentJSON), now, now); err != nil {
			return "", false, err
		}
		_ = index
	}
	for _, relation := range manifest.Relations {
		if _, err := tx.Exec("insert into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json, created_at) values (?, ?, ?, ?, ?, '{}', ?)",
			relation.ID, manifest.World.ID, relation.From, relation.To, relation.Type, now); err != nil {
			return "", false, err
		}
	}
	for index, evidence := range manifest.Evidence {
		role := "evidence:" + evidence.Purpose
		status := evidence.Status
		if status == "" {
			status = "supporting"
		}
		evidenceID := worldEvidenceRowID(manifest.World.ID, evidence.EntityID, evidence.URL, role, evidence.Label)
		if _, err := tx.Exec("insert into world_asset_refs (id, world_id, entity_id, asset_id, url, asset_content_hash, modality, purpose, evidence_status, collection_name, segment_json, role, label, sort_order, created_at) values (?, ?, ?, '', ?, '', ?, ?, ?, ?, '', ?, ?, ?, ?)",
			evidenceID, manifest.World.ID, nullIfEmpty(evidence.EntityID), evidence.URL, evidence.Modality, evidence.Purpose, status, evidence.Collection, role, evidence.Label, index+1, now); err != nil {
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
	if originOrDefault(origin) == WorldLocal {
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
			view := map[string]any{}
			for key, value := range record {
				view[key] = value
			}
			switch WorldEntityKind(kind) {
			case EntityCharacter:
				brief.Facts.Characters = append(brief.Facts.Characters, view)
			case EntityStory:
				brief.Facts.Stories = append(brief.Facts.Stories, view)
			case EntityLocation:
				brief.Facts.Locations = append(brief.Facts.Locations, view)
			case EntityStyle:
				brief.Facts.Styles = append(brief.Facts.Styles, view)
			case EntityRule:
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
			snapshot.Entities = append(snapshot.Entities, readinessEntitySnapshot{Kind: WorldEntityKind(kind), Content: record})
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
	entityRows, err := tx.Query("select id, kind, title, summary, content_json from world_entities where world_id = ? and archived_at is null", input.WorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	idMap := map[string]string{}
	for entityRows.Next() {
		var oldID, kind, title, summary, contentJSON string
		if err := entityRows.Scan(&oldID, &kind, &title, &summary, &contentJSON); err != nil {
			entityRows.Close()
			return WorldDetail{}, err
		}
		newEntityID, err := newID()
		if err != nil {
			entityRows.Close()
			return WorldDetail{}, err
		}
		idMap[oldID] = newEntityID
		if _, err := tx.Exec("insert into world_entities (id, world_id, kind, title, summary, content_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
			newEntityID, newWorldID, kind, title, summary, contentJSON, now, now); err != nil {
			entityRows.Close()
			return WorldDetail{}, err
		}
	}
	entityRows.Close()
	if err := entityRows.Err(); err != nil {
		return WorldDetail{}, err
	}
	relationRows, err := tx.Query("select relation_type, from_entity_id, to_entity_id, metadata_json, created_at from world_relations where world_id = ?", input.WorldID)
	if err != nil {
		return WorldDetail{}, err
	}
	for relationRows.Next() {
		var relationType, fromID, toID, metadataJSON, createdAt string
		if err := relationRows.Scan(&relationType, &fromID, &toID, &metadataJSON, &createdAt); err != nil {
			relationRows.Close()
			return WorldDetail{}, err
		}
		newRelationID, err := newID()
		if err != nil {
			relationRows.Close()
			return WorldDetail{}, err
		}
		if newFrom, ok := idMap[fromID]; ok {
			if newTo, ok := idMap[toID]; ok {
				if _, err := tx.Exec("insert into world_relations (id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json, created_at) values (?, ?, ?, ?, ?, ?, ?)",
					newRelationID, newWorldID, newFrom, newTo, relationType, metadataJSON, createdAt); err != nil {
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
	logWorldEvent("world.forked", map[string]string{"fromWorldId": input.WorldID, "toWorldId": newWorldID, "fromRevisionId": revisionID})
	return w.GetWorld(newWorldID)
}
