/*
 * [INPUT]: 依赖 Workspace 数据库与受控媒体根
 * [OUTPUT]: Asset 导入、查询、重命名、安全删除、去重或按交付强制新建、带正文/图片 content-addressed parts 的全局 reference 研究资料 Asset、ASR 转写 bundle（源声音 + SRT + JSON parts）导入与 parts 读取、受控落盘、项目关联、异步生成时间/输出/诊断 metadata、终态审计及 durable 更新事件
 * [POS]: media 的资产真相源；Provider 与本地两轨导出均不直接访问存储，终态与 SSE 事件在此原位回写
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	generationStartedAtMetadataKey   = "generationStartedAt"
	generationCompletedAtMetadataKey = "generationCompletedAt"
	generationDurationMsMetadataKey  = "generationDurationMs"
	generationPollErrorCountKey      = "generationPollErrorCount"
	generationLastPollErrorKey       = "generationLastPollError"
	generationLastPollErrorAtKey     = "generationLastPollErrorAt"
)

const atlasPollingDiagnosticPrefix = "Atlas Cloud reconciliation retry"

const assetColumns = `id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, error, metadata_json, created_at, updated_at`

// MediaAssetEvent is a durable cursor entry. The SSE server reads the current
// Asset by ID after commit, so separate MCP and daemon processes share one
// notification truth without an in-memory broadcaster.
type MediaAssetEvent struct {
	ID        int64     `json:"id"`
	AssetID   string    `json:"assetId"`
	CreatedAt time.Time `json:"createdAt"`
}

func (m *MediaService) AssetEvents(after int64) ([]MediaAssetEvent, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, asset_id, created_at from media_asset_events where id > ? order by id", after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []MediaAssetEvent{}
	for rows.Next() {
		var event MediaAssetEvent
		var createdAt string
		if err := rows.Scan(&event.ID, &event.AssetID, &createdAt); err != nil {
			return nil, err
		}
		event.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
		events = append(events, event)
	}
	return events, rows.Err()
}

func (m *MediaService) LatestAssetEventID() (int64, error) {
	db, err := m.database()
	if err != nil {
		return 0, err
	}
	var id int64
	if err := db.QueryRow("select coalesce(max(id), 0) from media_asset_events").Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

func recordAssetEvent(tx *sql.Tx, assetID string, now time.Time) error {
	_, err := tx.Exec("insert into media_asset_events (asset_id, created_at) values (?, ?)", assetID, now.UTC().Format(time.RFC3339Nano))
	return err
}

func (m *MediaService) ListAssets(projectID string) ([]MediaAsset, error) {
	return m.listAssets(projectID)
}

func (m *MediaService) listAssets(projectID string) ([]MediaAsset, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	query := `select a.` + strings.ReplaceAll(assetColumns, ", ", ", a.") + ` from media_assets a`
	args := []any{}
	if projectID != "" {
		query += " join media_asset_projects p on p.asset_id = a.id where p.project_id = ?"
		args = append(args, projectID)
	}
	query += " order by a.created_at desc"
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	assets := []MediaAsset{}
	for rows.Next() {
		asset, err := scanAssetRow(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	// Project attachments are loaded in one batched query after the result set
	// is closed. A per-row query while the result set is still open requires a
	// second pooled connection; enough concurrent listers can exhaust the pool
	// and deadlock every reader.
	if err := loadAssetsProjects(db, assets); err != nil {
		return nil, err
	}
	return assets, nil
}

func loadAssetsProjects(db *sql.DB, assets []MediaAsset) error {
	if len(assets) == 0 {
		return nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(assets)), ",")
	args := make([]any, len(assets))
	indexByID := make(map[string]int, len(assets))
	for index, asset := range assets {
		args[index] = asset.ID
		indexByID[asset.ID] = index
	}
	rows, err := db.Query("select asset_id, project_id from media_asset_projects where asset_id in ("+placeholders+") order by project_id", args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var assetID, projectID string
		if err := rows.Scan(&assetID, &projectID); err != nil {
			return err
		}
		if index, ok := indexByID[assetID]; ok {
			assets[index].ProjectIDs = append(assets[index].ProjectIDs, projectID)
		}
	}
	return rows.Err()
}

func (m *MediaService) GetAsset(id string) (MediaAsset, error) {
	return m.getAsset(id)
}

// RenameAsset changes presentation metadata without changing immutable bytes,
// content identity or any project attachment.
func (m *MediaService) RenameAsset(id, name string) (MediaAsset, error) {
	id, name = strings.TrimSpace(id), strings.TrimSpace(name)
	if id == "" || name == "" {
		return MediaAsset{}, errors.New("asset name is required")
	}
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	result, err := tx.Exec("update media_assets set name = ?, updated_at = ? where id = ?", name, now.Format(time.RFC3339Nano), id)
	if err == nil {
		var changed int64
		changed, err = result.RowsAffected()
		if changed == 0 && err == nil {
			err = errors.New("media asset not found")
		}
	}
	if err == nil {
		err = recordAssetEvent(tx, id, now)
	}
	if err != nil {
		_ = tx.Rollback()
		return MediaAsset{}, err
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return m.GetAsset(id)
}

// DeleteAsset removes the Asset record and every platform reference to it. The
// content-addressed files are deliberately retained because several records
// can share bytes; a later garbage collector may reclaim unreferenced blobs.
func (m *MediaService) DeleteAsset(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("media asset not found")
	}
	m.dedupeMu.Lock()
	defer m.dedupeMu.Unlock()
	asset, err := m.GetAsset(id)
	if err != nil {
		return errors.New("media asset not found")
	}
	if asset.Status == "queued" || asset.Status == "running" {
		return errors.New("generating media cannot be deleted")
	}
	db, err := m.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	for _, query := range []string{
		"delete from project_covers where asset_id = ?",
		"update worlds set cover_asset_id = null where cover_asset_id = ?",
		"delete from media_asset_projects where asset_id = ?",
		"delete from world_asset_refs where asset_id = ?",
		"delete from agent_turn_attachments where asset_id = ?",
		"delete from media_assets where id = ?",
	} {
		if _, err := tx.Exec(query, id); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	if err := recordAssetEvent(tx, id, time.Now().UTC()); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	m.publishAssetChange()
	return nil
}

func (m *MediaService) getAsset(id string) (MediaAsset, error) {
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	row := db.QueryRow("select "+assetColumns+" from media_assets where id = ?", id)
	return scanAsset(db, row)
}

type mediaScanner interface{ Scan(...any) error }

// scanAssetRow scans the core Asset columns only. It never runs a nested query
// so it is safe to call while the source *sql.Rows is still open.
func scanAssetRow(row mediaScanner) (MediaAsset, error) {
	var asset MediaAsset
	var metadataJSON, created, updated string
	if err := row.Scan(&asset.ID, &asset.Kind, &asset.Name, &asset.MimeType, &asset.SizeBytes, &asset.ContentHash, &asset.Origin, &asset.ParentID, &asset.Status, &asset.JobID, &asset.RemoteID, &asset.Error, &metadataJSON, &created, &updated); err != nil {
		return MediaAsset{}, err
	}
	// Lifecycle fields were introduced after existing workspaces already held
	// completed files. A pending Asset needs a durable local job binding; a
	// remote prediction ID is optional because some providers execute locally.
	if strings.TrimSpace(asset.Status) == "" || ((asset.Status == "queued" || asset.Status == "running") && asset.JobID == "") {
		asset.Status = "completed"
	}
	_ = json.Unmarshal([]byte(metadataJSON), &asset.Metadata)
	asset.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	asset.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	if asset.UpdatedAt.IsZero() {
		asset.UpdatedAt = asset.CreatedAt
	}
	return asset, nil
}

// scanAsset augments a core scan with the Asset's project attachments. It is
// only safe when the source row was already consumed (a *sql.Row after Scan),
// because it opens a second pooled connection.
func scanAsset(db *sql.DB, row mediaScanner) (MediaAsset, error) {
	asset, err := scanAssetRow(row)
	if err != nil {
		return MediaAsset{}, err
	}
	if err := loadAssetProjects(db, &asset); err != nil {
		return MediaAsset{}, err
	}
	return asset, nil
}

func loadAssetProjects(db *sql.DB, asset *MediaAsset) error {
	projectRows, err := db.Query("select project_id from media_asset_projects where asset_id = ? order by project_id", asset.ID)
	if err != nil {
		return err
	}
	defer projectRows.Close()
	for projectRows.Next() {
		var projectID string
		_ = projectRows.Scan(&projectID)
		asset.ProjectIDs = append(asset.ProjectIDs, projectID)
	}
	return projectRows.Err()
}

func (m *MediaService) Attach(assetID, projectID string) error {
	if _, err := projectExists(m.store, projectID); err != nil {
		return err
	}
	if _, err := m.GetAsset(assetID); err != nil {
		return err
	}
	db, err := m.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if err := attachTx(tx, assetID, projectID, now); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	m.publishAssetChange()
	return nil
}

// CreateReferenceAsset creates a workspace-level research citation. The URL is
// the source of truth and identity for de-duplication; the Agent additionally
// supplies reviewable metadata plus, when available, the full body text and an
// image. Body text and image bytes are persisted as immutable content-addressed
// parts served by the parts endpoint, mirroring transcript bundles, so research
// content survives locally without re-fetching the origin.
func (m *MediaService) CreateReferenceAsset(input ReferenceAssetInput) (MediaAsset, error) {
	name := strings.TrimSpace(input.Name)
	referenceURL := strings.TrimSpace(input.URL)
	parsed, err := url.Parse(referenceURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return MediaAsset{}, errors.New("reference URL must be an absolute http(s) URL")
	}
	if name == "" {
		name = parsed.Host
	}
	sourceKind := strings.TrimSpace(input.SourceKind)
	if sourceKind == "" {
		sourceKind = "web"
	}
	canonicalURL := parsed.String()
	hash := sha256.Sum256([]byte("reference:" + canonicalURL))
	contentHash := hex.EncodeToString(hash[:])

	m.dedupeMu.Lock()
	defer m.dedupeMu.Unlock()
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	existing, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where content_hash = ?", contentHash))
	if err == nil {
		return m.fillReferenceAsset(existing, input, db)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MediaAsset{}, err
	}
	// Content-addressed parts keep the Asset record's URL identity while body
	// text and image bytes become immutable files served by the parts endpoint.
	parts, err := m.referenceContentParts(input)
	if err != nil {
		return MediaAsset{}, err
	}
	reference := map[string]any{
		"url":          canonicalURL,
		"sourceKind":   sourceKind,
		"title":        name,
		"summary":      strings.TrimSpace(input.Summary),
		"description":  strings.TrimSpace(input.Description),
		"excerpt":      strings.TrimSpace(input.Excerpt),
		"author":       strings.TrimSpace(input.Author),
		"publishedAt":  strings.TrimSpace(input.PublishedAt),
		"siteName":     strings.TrimSpace(input.SiteName),
		"language":     strings.TrimSpace(input.Language),
		"thumbnailUrl": strings.TrimSpace(input.ThumbnailURL),
	}
	if contentPart, ok := parts["content"]; ok {
		reference["contentMimeType"] = contentPart.MimeType
		reference["contentLength"] = contentPart.SizeBytes
		reference["contentWordCount"] = wordCount(input.Content)
	}
	if mediaMeta := referenceMediaMetadata(input); len(mediaMeta) > 0 {
		reference["media"] = mediaMeta
	}
	if len(parts) > 0 {
		reference["parts"] = parts
	}
	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	metadata := map[string]any{"source": "research", "reference": reference}
	serialized, _ := json.Marshal(metadata)
	asset := MediaAsset{ID: id, Kind: "reference", Name: name, MimeType: "application/vnd.recut.reference+json", ContentHash: contentHash, Origin: "research", Status: "completed", Metadata: metadata, CreatedAt: now, UpdatedAt: now}
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if _, err = tx.Exec("insert into media_assets (id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, remote_poll_url, error, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", asset.ID, asset.Kind, asset.Name, asset.MimeType, 0, asset.ContentHash, asset.Origin, "", asset.Status, "", "", "", "", string(serialized), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return rollback(err)
	}
	if err := recordAssetEvent(tx, asset.ID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return asset, nil
}

const (
	referenceContentMaxBytes = 4 << 20
	referenceImageMaxBytes   = 20 << 20
)

// referenceContentParts persists the Agent-supplied body text and image bytes
// as content-addressed parts. Persisting happens before the transaction so a
// rejected URL or oversized payload never writes to the database.
func (m *MediaService) referenceContentParts(input ReferenceAssetInput) (map[string]TranscriptPart, error) {
	parts := map[string]TranscriptPart{}
	if strings.TrimSpace(input.Content) != "" {
		part, err := m.referenceContentPart(input.Content, input.ContentMimeType)
		if err != nil {
			return nil, err
		}
		parts["content"] = part
	}
	if strings.TrimSpace(input.ImageData) != "" {
		part, err := m.referenceImagePart(input.ImageData, input.ImageMimeType)
		if err != nil {
			return nil, err
		}
		parts["image"] = part
	}
	return parts, nil
}

func (m *MediaService) referenceContentPart(contentText, contentMimeType string) (TranscriptPart, error) {
	text := strings.TrimSpace(contentText)
	if text == "" {
		return TranscriptPart{}, errors.New("reference content is empty")
	}
	mimeType := strings.TrimSpace(contentMimeType)
	if mimeType == "" {
		mimeType = "text/markdown"
	}
	if !referenceTextMimeType(mimeType) {
		return TranscriptPart{}, fmt.Errorf("reference content mime type %q is not a supported text type", mimeType)
	}
	content := []byte(text)
	if len(content) > referenceContentMaxBytes {
		return TranscriptPart{}, fmt.Errorf("reference content exceeds the %d-byte limit", referenceContentMaxBytes)
	}
	partPath, partHash, err := m.persistContentPart(m.store.MediaRoot(), content, extensionFor(mimeType))
	if err != nil {
		return TranscriptPart{}, err
	}
	return TranscriptPart{Name: "content" + extensionFor(mimeType), ContentHash: partHash, MimeType: mimeType, SizeBytes: int64(len(content)), Path: partPath}, nil
}

func (m *MediaService) referenceImagePart(imageData, imageMimeType string) (TranscriptPart, error) {
	content, mimeType, err := decodeReferenceImage(imageData, imageMimeType)
	if err != nil {
		return TranscriptPart{}, err
	}
	partPath, partHash, err := m.persistContentPart(m.store.MediaRoot(), content, extensionFor(mimeType))
	if err != nil {
		return TranscriptPart{}, err
	}
	return TranscriptPart{Name: "image" + extensionFor(mimeType), ContentHash: partHash, MimeType: mimeType, SizeBytes: int64(len(content)), Path: partPath}, nil
}

// missingReferenceParts returns the content/image parts a later registration
// supplies that the existing reference Asset does not already carry.
func (m *MediaService) missingReferenceParts(reference map[string]any, input ReferenceAssetInput) (map[string]TranscriptPart, error) {
	existingParts, _ := reference["parts"].(map[string]any)
	has := func(name string) bool {
		if existingParts == nil {
			return false
		}
		_, ok := existingParts[name].(map[string]any)
		return ok
	}
	missing := map[string]TranscriptPart{}
	if strings.TrimSpace(input.Content) != "" && !has("content") {
		part, err := m.referenceContentPart(input.Content, input.ContentMimeType)
		if err != nil {
			return nil, err
		}
		missing["content"] = part
	}
	if strings.TrimSpace(input.ImageData) != "" && !has("image") {
		part, err := m.referenceImagePart(input.ImageData, input.ImageMimeType)
		if err != nil {
			return nil, err
		}
		missing["image"] = part
	}
	return missing, nil
}

// fillReferenceAsset merges content, metadata and media fields from a later
// registration of the same URL into the existing reference Asset. The URL
// identity stays immutable; only gaps are filled, never overwritten.
func (m *MediaService) fillReferenceAsset(existing MediaAsset, input ReferenceAssetInput, db *sql.DB) (MediaAsset, error) {
	reference, ok := existing.Metadata["reference"].(map[string]any)
	if !ok {
		return existing, nil
	}
	missing, err := m.missingReferenceParts(reference, input)
	if err != nil {
		return MediaAsset{}, err
	}
	changed := false
	if len(missing) > 0 {
		parts, _ := reference["parts"].(map[string]any)
		if parts == nil {
			parts = map[string]any{}
			reference["parts"] = parts
		}
		for name, part := range missing {
			parts[name] = part
		}
		if contentPart, ok := missing["content"]; ok {
			reference["contentMimeType"] = contentPart.MimeType
			reference["contentLength"] = contentPart.SizeBytes
			reference["contentWordCount"] = wordCount(input.Content)
		}
		changed = true
	}
	for key, value := range map[string]string{
		"summary": input.Summary, "description": input.Description, "excerpt": input.Excerpt,
		"author": input.Author, "publishedAt": input.PublishedAt, "siteName": input.SiteName,
		"language": input.Language, "thumbnailUrl": input.ThumbnailURL,
	} {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if current, _ := reference[key].(string); strings.TrimSpace(current) == "" {
			reference[key] = value
			changed = true
		}
	}
	if mediaMeta := referenceMediaMetadata(input); len(mediaMeta) > 0 {
		existingMedia, _ := reference["media"].(map[string]any)
		for key, value := range mediaMeta {
			if existingMedia == nil {
				existingMedia = map[string]any{}
				reference["media"] = existingMedia
			}
			if current, present := existingMedia[key]; !present || emptyMetadataValue(current) {
				existingMedia[key] = value
				changed = true
			}
		}
	}
	if !changed {
		return existing, nil
	}
	serialized, _ := json.Marshal(existing.Metadata)
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	if _, err := tx.Exec("update media_assets set metadata_json = ?, updated_at = ? where id = ?", string(serialized), now.Format(time.RFC3339Nano), existing.ID); err != nil {
		_ = tx.Rollback()
		return MediaAsset{}, err
	}
	if err := recordAssetEvent(tx, existing.ID, now); err != nil {
		_ = tx.Rollback()
		return MediaAsset{}, err
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	existing.UpdatedAt = now
	m.publishAssetChange()
	return existing, nil
}

func emptyMetadataValue(value any) bool {
	switch value := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(value) == ""
	case int:
		return value == 0
	case int64:
		return value == 0
	case float64:
		return value == 0
	default:
		return false
	}
}

func referenceTextMimeType(mimeType string) bool {
	lower := strings.ToLower(mimeType)
	return strings.HasPrefix(lower, "text/") || lower == "application/json" || lower == "application/xml"
}

func wordCount(text string) int64 {
	return int64(len(strings.Fields(text)))
}

// decodeReferenceImage accepts base64-encoded image bytes (or a data: URL) and
// validates the decoded payload is a real image within the reference size limit.
func decodeReferenceImage(data, mimeType string) ([]byte, string, error) {
	raw := strings.TrimSpace(data)
	if rest, ok := strings.CutPrefix(raw, "data:"); ok {
		if payload, _, ok := strings.Cut(rest, ","); ok && strings.Contains(payload, "base64") {
			raw = strings.TrimSpace(strings.TrimPrefix(rest, payload+","))
		}
	}
	content, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, "", errors.New("imageData must be base64-encoded image bytes")
	}
	if len(content) == 0 || len(content) > referenceImageMaxBytes {
		return nil, "", fmt.Errorf("reference image exceeds the %d-byte limit", referenceImageMaxBytes)
	}
	detected := http.DetectContentType(content)
	if !strings.HasPrefix(detected, "image/") {
		return nil, "", errors.New("imageData must decode to an image")
	}
	if strings.TrimSpace(mimeType) == "" {
		mimeType = detected
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "image/") {
		return nil, "", errors.New("imageMimeType must be an image/* type")
	}
	return content, strings.TrimSpace(mimeType), nil
}

// referenceMediaMetadata collects the platform-specific fields (channel,
// duration, engagement) only when the Agent supplied them.
func referenceMediaMetadata(input ReferenceAssetInput) map[string]any {
	media := map[string]any{}
	if value := strings.TrimSpace(input.ChannelName); value != "" {
		media["channelName"] = value
	}
	if value := strings.TrimSpace(input.ChannelURL); value != "" {
		media["channelUrl"] = value
	}
	if input.DurationSec > 0 {
		media["durationSeconds"] = input.DurationSec
	}
	if input.ViewCount > 0 {
		media["viewCount"] = input.ViewCount
	}
	if input.LikeCount > 0 {
		media["likeCount"] = input.LikeCount
	}
	if value := strings.TrimSpace(input.Language); value != "" {
		media["language"] = value
	}
	return media
}

func attachTx(tx *sql.Tx, assetID, projectID string, now time.Time) error {
	_, err := tx.Exec("insert or ignore into media_asset_projects (asset_id, project_id, created_at) values (?, ?, ?)", assetID, projectID, now.UTC().Format(time.RFC3339Nano))
	return err
}

func (m *MediaService) saveGeneratedAsset(job MediaJob, content []byte, kind, mimeType string, metadata map[string]any) (MediaAsset, error) {
	if len(job.AssetIDs) == 1 {
		return m.completePendingAsset(job.ID, job.AssetIDs[0], content, mimeType, metadata)
	}
	// 同步生成没有预先可见的 pending Asset。仍以 Job 创建时刻为起点，
	// 让每一类生成素材都拥有同一种最终耗时契约。
	metadata = completedGenerationMetadata(metadata, job.CreatedAt, time.Now().UTC())
	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	return m.saveAsset(content, kind, mimeType, "generated-"+id+extensionFor(mimeType), "generated", job.ProjectID, metadata, id)
}

// createRemoteAsset commits the stable local reference immediately after a
// provider accepts an asynchronous task.
func (m *MediaService) createRemoteAsset(job MediaJob, provider, remoteID, remotePollURL string) (MediaAsset, error) {
	return m.createPendingAsset(job, provider, "video", "video/mp4", "running", remoteID, remotePollURL)
}

// createQueuedAsset publishes a stable reference before a daemon executes a
// provider request that has no provider-side prediction ID to persist.
func (m *MediaService) createQueuedAsset(job MediaJob, provider, kind, mimeType string) (MediaAsset, error) {
	return m.createPendingAsset(job, provider, kind, mimeType, "queued", "", "")
}

// createPendingAsset is the single transaction that binds a submitted job to
// its visible Asset. Pending assets deliberately bypass content-hash
// de-duplication: they have no bytes yet and every task must retain identity.
func (m *MediaService) createPendingAsset(job MediaJob, provider, kind, mimeType, status, remoteID, remotePollURL string) (MediaAsset, error) {
	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	metadata := map[string]any{
		"prompt":                       job.Prompt,
		"modelId":                      job.ModelID,
		"provider":                     provider,
		"capability":                   job.Capability,
		"output":                       job.Output,
		"referenceIds":                 job.ReferenceIDs,
		generationStartedAtMetadataKey: now.Format(time.RFC3339Nano),
	}
	if remoteID != "" {
		metadata["atlasPredictionId"] = remoteID
	}
	serialized, _ := json.Marshal(metadata)
	asset := MediaAsset{ID: id, Kind: kind, Name: "generated-" + id + extensionFor(mimeType), MimeType: mimeType, Origin: "generated", Status: status, JobID: job.ID, RemoteID: remoteID, Metadata: metadata, CreatedAt: now, UpdatedAt: now}

	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if _, err := tx.Exec("insert into media_assets (id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, remote_poll_url, error, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", asset.ID, asset.Kind, asset.Name, asset.MimeType, 0, "", asset.Origin, "", asset.Status, asset.JobID, asset.RemoteID, remotePollURL, "", string(serialized), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return rollback(err)
	}
	assetIDs, _ := json.Marshal([]string{asset.ID})
	if _, err := tx.Exec("update media_jobs set status = ?, asset_ids_json = ?, remote_id = ?, remote_poll_url = ?, error = ?, updated_at = ? where id = ?", status, string(assetIDs), remoteID, remotePollURL, "", now.Format(time.RFC3339Nano), job.ID); err != nil {
		return rollback(err)
	}
	if job.ProjectID != "" {
		if _, err := tx.Exec("insert or ignore into media_asset_projects (asset_id, project_id, created_at) values (?, ?, ?)", asset.ID, job.ProjectID, now.Format(time.RFC3339Nano)); err != nil {
			return rollback(err)
		}
		asset.ProjectIDs = []string{job.ProjectID}
	}
	if err := recordAssetEvent(tx, asset.ID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return asset, nil
}

// completeRemoteAsset writes a remote provider result into the already-
// published Asset. It never allocates a second asset ID.
func (m *MediaService) completeRemoteAsset(jobID, assetID string, content []byte, mimeType string) (MediaAsset, error) {
	return m.completePendingAsset(jobID, assetID, content, mimeType, nil)
}

// completePendingAsset resolves either a remote prediction or a queued local
// task in place, preserving the identity already referenced by the project.
func (m *MediaService) completePendingAsset(jobID, assetID string, content []byte, mimeType string, generatedMetadata map[string]any) (MediaAsset, error) {
	if len(content) == 0 {
		return MediaAsset{}, errors.New("generated media output is empty")
	}
	hash := sha256.Sum256(content)
	contentHash := hex.EncodeToString(hash[:])
	path := filepath.Join(m.store.MediaRoot(), "media", "assets", contentHash[:2], contentHash+extensionFor(mimeType))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return MediaAsset{}, err
	}
	if err := os.WriteFile(path, content, 0o600); err != nil && !os.IsExist(err) {
		return MediaAsset{}, err
	}

	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ?", assetID))
	if err != nil {
		return MediaAsset{}, err
	}
	if asset.JobID != jobID {
		return MediaAsset{}, errors.New("pending asset does not belong to this job")
	}
	if asset.Status == "completed" {
		return asset, nil
	}
	if asset.Status != "running" {
		return MediaAsset{}, fmt.Errorf("pending asset is already %s", asset.Status)
	}
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	for key, value := range generatedMetadata {
		metadata[key] = value
	}
	now := time.Now().UTC()
	clearAtlasPollingMetadata(metadata)
	metadata = completedGenerationMetadata(metadata, asset.CreatedAt, now)
	metadata["path"] = path
	serialized, _ := json.Marshal(metadata)
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	result, err := tx.Exec("update media_assets set mime_type = ?, size_bytes = ?, content_hash = ?, status = ?, error = ?, metadata_json = ?, updated_at = ? where id = ? and job_id = ? and status = ?", mimeType, len(content), contentHash, "completed", "", string(serialized), now.Format(time.RFC3339Nano), assetID, jobID, "running")
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("pending asset changed before completion"))
	}
	assetIDs, _ := json.Marshal([]string{assetID})
	result, err = tx.Exec("update media_jobs set status = ?, asset_ids_json = ?, error = ?, updated_at = ? where id = ? and status = ?", "completed", string(assetIDs), "", now.Format(time.RFC3339Nano), jobID, "running")
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("media job changed before asset completion"))
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	asset.MimeType, asset.SizeBytes, asset.ContentHash, asset.Status, asset.Error, asset.Metadata, asset.UpdatedAt = mimeType, int64(len(content)), contentHash, "completed", "", metadata, now
	m.publishAssetChange()
	log.Printf("INFO media job completed job_id=%s asset_id=%s", jobID, assetID)
	return asset, nil
}

func (m *MediaService) failRemoteAsset(jobID, assetID, message string) {
	db, err := m.database()
	if err != nil {
		return
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ?", assetID))
	if err != nil || asset.JobID != jobID || asset.Status != "running" {
		return
	}
	completedAt := time.Now().UTC()
	metadata := completedGenerationMetadata(asset.Metadata, asset.CreatedAt, completedAt)
	serialized, _ := json.Marshal(metadata)
	now := completedAt.Format(time.RFC3339Nano)
	tx, err := db.Begin()
	if err != nil {
		return
	}
	result, err := tx.Exec("update media_assets set status = ?, error = ?, metadata_json = ?, updated_at = ? where id = ? and job_id = ? and status = ?", "failed", message, string(serialized), now, assetID, jobID, "running")
	if err != nil {
		_ = tx.Rollback()
		return
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		_ = tx.Rollback()
		return
	}
	result, err = tx.Exec("update media_jobs set status = ?, error = ?, updated_at = ? where id = ? and status = ?", "failed", message, now, jobID, "running")
	if err != nil {
		_ = tx.Rollback()
		return
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		_ = tx.Rollback()
		return
	}
	if err := recordAssetEvent(tx, assetID, completedAt); err != nil {
		_ = tx.Rollback()
		return
	}
	if err := tx.Commit(); err != nil {
		return
	}
	m.publishAssetChange()
	log.Printf("ERROR media job failed job_id=%s asset_id=%s", jobID, assetID)
}

// completedGenerationMetadata keeps the clock anchored to durable Asset
// creation, not to a later provider poll. Older Assets without a recorded
// start fall back to their durable creation timestamp so every terminal Asset
// has one shape.
func completedGenerationMetadata(metadata map[string]any, createdAt, completedAt time.Time) map[string]any {
	if metadata == nil {
		metadata = map[string]any{}
	}
	startedAt := recordedGenerationStart(metadata, createdAt)
	if startedAt.IsZero() || startedAt.After(completedAt) {
		startedAt = completedAt
	}
	metadata[generationStartedAtMetadataKey] = startedAt.Format(time.RFC3339Nano)
	metadata[generationCompletedAtMetadataKey] = completedAt.Format(time.RFC3339Nano)
	metadata[generationDurationMsMetadataKey] = completedAt.Sub(startedAt).Milliseconds()
	return metadata
}

func recordedGenerationStart(metadata map[string]any, fallback time.Time) time.Time {
	value, ok := metadata[generationStartedAtMetadataKey].(string)
	if !ok {
		return fallback.UTC()
	}
	startedAt, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return fallback.UTC()
	}
	return startedAt.UTC()
}

// recordAtlasPollingDiagnostic persists retries outside the visible Asset
// error field. Running means the remote task is still recoverable; the job
// error carries a concise diagnostic while metadata retains the retry state.
func (m *MediaService) recordAtlasPollingDiagnostic(jobID, assetID, message string) (int, error) {
	db, err := m.database()
	if err != nil {
		return 0, err
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ?", assetID))
	if err != nil {
		return 0, err
	}
	if asset.JobID != jobID || asset.Status != "running" {
		return 0, nil
	}
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	attempt := metadataInteger(metadata[generationPollErrorCountKey]) + 1
	now := time.Now().UTC()
	metadata[generationPollErrorCountKey] = attempt
	metadata[generationLastPollErrorKey] = boundedPollingDiagnostic(message)
	metadata[generationLastPollErrorAtKey] = now.Format(time.RFC3339Nano)
	serialized, _ := json.Marshal(metadata)
	diagnostic := fmt.Sprintf("%s %d/%d: %s", atlasPollingDiagnosticPrefix, attempt, atlasPollingRetryLimit, boundedPollingDiagnostic(message))
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	rollback := func(cause error) (int, error) { _ = tx.Rollback(); return 0, cause }
	if _, err := tx.Exec("update media_assets set metadata_json = ?, updated_at = ? where id = ? and job_id = ? and status = ?", string(serialized), now.Format(time.RFC3339Nano), assetID, jobID, "running"); err != nil {
		return rollback(err)
	}
	if _, err := tx.Exec("update media_jobs set error = ?, updated_at = ? where id = ? and status = ?", diagnostic, now.Format(time.RFC3339Nano), jobID, "running"); err != nil {
		return rollback(err)
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	m.publishAssetChange()
	return attempt, nil
}

func (m *MediaService) clearAtlasPollingDiagnostic(jobID, assetID string) {
	db, err := m.database()
	if err != nil {
		return
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ?", assetID))
	if err != nil || asset.JobID != jobID || asset.Status != "running" || !clearAtlasPollingMetadata(asset.Metadata) {
		return
	}
	serialized, _ := json.Marshal(asset.Metadata)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := db.Begin()
	if err != nil {
		return
	}
	if _, err := tx.Exec("update media_assets set metadata_json = ?, updated_at = ? where id = ? and job_id = ? and status = ?", string(serialized), now, assetID, jobID, "running"); err != nil {
		_ = tx.Rollback()
		return
	}
	if _, err := tx.Exec("update media_jobs set error = ?, updated_at = ? where id = ? and status = ? and error like ?", "", now, jobID, "running", atlasPollingDiagnosticPrefix+"%"); err != nil {
		_ = tx.Rollback()
		return
	}
	if err := recordAssetEvent(tx, assetID, time.Now().UTC()); err != nil {
		_ = tx.Rollback()
		return
	}
	if err := tx.Commit(); err == nil {
		m.publishAssetChange()
	}
}

func clearAtlasPollingMetadata(metadata map[string]any) bool {
	if metadata == nil {
		return false
	}
	changed := false
	for _, key := range []string{generationPollErrorCountKey, generationLastPollErrorKey, generationLastPollErrorAtKey} {
		if _, ok := metadata[key]; ok {
			delete(metadata, key)
			changed = true
		}
	}
	return changed
}

func metadataInteger(value any) int {
	switch value := value.(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	default:
		return 0
	}
}

func boundedPollingDiagnostic(message string) string {
	message = strings.TrimSpace(message)
	if len(message) <= 800 {
		return message
	}
	return message[:800] + "…"
}

func (m *MediaService) ImportImage(name, mimeType string, content []byte) (MediaAsset, error) {
	if !strings.HasPrefix(mimeType, "image/") || len(content) == 0 || len(content) > 20<<20 {
		return MediaAsset{}, errors.New("only images up to 20 MB can be imported")
	}
	if strings.TrimSpace(name) == "" {
		name = "reference" + extensionFor(mimeType)
	}
	return m.saveAsset(content, "image", mimeType, name, "user-upload", "", map[string]any{"source": "user-upload"}, "")
}

// ImportNativeImage records a Codex-native image as a project Asset. Native
// generation writes its file before this boundary; callers must not invent an
// Asset ID or treat a chat preview as a deliverable.
func (m *MediaService) ImportNativeImage(projectID, name, mimeType string, content []byte) (MediaAsset, error) {
	if !strings.HasPrefix(mimeType, "image/") || len(content) == 0 || len(content) > 20<<20 {
		return MediaAsset{}, errors.New("only images up to 20 MB can be imported")
	}
	if strings.TrimSpace(name) == "" {
		name = "codex-image" + extensionFor(mimeType)
	}
	return m.saveAsset(content, "image", mimeType, name, "codex-native", projectID, map[string]any{"source": "codex-native"}, "")
}

func (m *MediaService) ImportMedia(name, mimeType string, content []byte) (MediaAsset, error) {
	return m.ImportMediaReader(name, mimeType, bytes.NewReader(content))
}

// ImportMediaReader streams a user-selected file into the content-addressed
// store. Video imports must not be held in RAM simply because the browser
// selected a longer clip.
func (m *MediaService) ImportMediaReader(name, mimeType string, content io.Reader) (MediaAsset, error) {
	kind, err := importedMediaKind(mimeType)
	if err != nil {
		return MediaAsset{}, err
	}
	if strings.TrimSpace(name) == "" {
		name = "reference" + extensionFor(mimeType)
	}
	return m.persistImportedMedia(content, kind, mimeType, name)
}

func importedMediaKind(mimeType string) (string, error) {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image", nil
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio", nil
	case strings.HasPrefix(mimeType, "video/"):
		return "video", nil
	default:
		return "", errors.New("unsupported media type")
	}
}

func (m *MediaService) persistImportedMedia(content io.Reader, kind, mimeType, name string) (MediaAsset, error) {
	root := filepath.Join(m.store.MediaRoot(), "media", "assets")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return MediaAsset{}, err
	}
	temporary, err := os.CreateTemp(root, ".upload-*")
	if err != nil {
		return MediaAsset{}, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(temporary, hash), content)
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return MediaAsset{}, err
	}
	if size == 0 {
		return MediaAsset{}, errors.New("media file is empty")
	}
	return m.persistImportedFile(temporaryPath, hex.EncodeToString(hash.Sum(nil)), size, kind, mimeType, name)
}

func (m *MediaService) persistImportedFile(temporaryPath, contentHash string, size int64, kind, mimeType, name string) (MediaAsset, error) {
	m.dedupeMu.Lock()
	defer m.dedupeMu.Unlock()

	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	existing, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where content_hash = ?", contentHash))
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MediaAsset{}, err
	}
	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	path := filepath.Join(m.store.MediaRoot(), "media", "assets", contentHash[:2], contentHash+extensionFor(mimeType))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return MediaAsset{}, err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return MediaAsset{}, err
	}

	now := time.Now().UTC()
	metadata := map[string]any{"source": "user-upload", "path": path}
	asset := MediaAsset{ID: id, Kind: kind, Name: name, MimeType: mimeType, SizeBytes: size, ContentHash: contentHash, Origin: "user-upload", Status: "completed", Metadata: metadata, CreatedAt: now, UpdatedAt: now}
	serialized, _ := json.Marshal(metadata)
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if _, err = tx.Exec("insert into media_assets (id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, remote_poll_url, error, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", asset.ID, asset.Kind, asset.Name, asset.MimeType, asset.SizeBytes, asset.ContentHash, asset.Origin, "", asset.Status, "", "", "", "", string(serialized), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return rollback(err)
	}
	if err := recordAssetEvent(tx, asset.ID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return asset, nil
}

func (m *MediaService) saveAsset(content []byte, kind, mimeType, name, origin, projectID string, metadata map[string]any, id string) (MediaAsset, error) {
	return m.persistAsset(content, kind, mimeType, name, origin, projectID, metadata, id, true)
}

// saveDerivedAsset always creates a new Asset record. A repeated export may
// produce identical bytes, but it is still a distinct user-visible delivery
// with its own timeline metadata and project history.
func (m *MediaService) saveDerivedAsset(content []byte, kind, mimeType, name, origin, projectID string, metadata map[string]any) (MediaAsset, error) {
	return m.persistAsset(content, kind, mimeType, name, origin, projectID, metadata, "", false)
}

func (m *MediaService) persistAsset(content []byte, kind, mimeType, name, origin, projectID string, metadata map[string]any, id string, deduplicate bool) (MediaAsset, error) {
	hash := sha256.Sum256(content)
	contentHash := hex.EncodeToString(hash[:])
	if projectID != "" {
		if _, err := projectExists(m.store, projectID); err != nil {
			return MediaAsset{}, err
		}
	}
	// Only the content-hash dedup check-and-insert needs mutual exclusion. Every
	// other media write is already a guarded single transaction, so a global
	// lock would only serialize unrelated imports behind a large disk write.
	m.dedupeMu.Lock()
	defer m.dedupeMu.Unlock()

	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	if deduplicate {
		existing, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where content_hash = ?", contentHash))
		if err == nil {
			if projectID != "" {
				now := time.Now().UTC()
				tx, err := db.Begin()
				if err != nil {
					return MediaAsset{}, err
				}
				if err := attachTx(tx, existing.ID, projectID, now); err != nil {
					_ = tx.Rollback()
					return MediaAsset{}, err
				}
				if err := recordAssetEvent(tx, existing.ID, now); err != nil {
					_ = tx.Rollback()
					return MediaAsset{}, err
				}
				if err := tx.Commit(); err != nil {
					return MediaAsset{}, err
				}
				existing.ProjectIDs = appendUnique(existing.ProjectIDs, projectID)
			}
			return existing, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return MediaAsset{}, err
		}
	}
	if id == "" {
		id, err = newID()
		if err != nil {
			return MediaAsset{}, err
		}
	}
	ext := extensionFor(mimeType)
	path := filepath.Join(m.store.MediaRoot(), "media", "assets", contentHash[:2], contentHash+ext)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return MediaAsset{}, err
	}
	if err := os.WriteFile(path, content, 0o600); err != nil && !os.IsExist(err) {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["path"] = path
	asset := MediaAsset{ID: id, Kind: kind, Name: name, MimeType: mimeType, SizeBytes: int64(len(content)), ContentHash: contentHash, Origin: origin, Status: "completed", Metadata: metadata, CreatedAt: now, UpdatedAt: now}
	serialized, _ := json.Marshal(metadata)
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if _, err = tx.Exec("insert into media_assets (id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, remote_poll_url, error, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", asset.ID, asset.Kind, asset.Name, asset.MimeType, asset.SizeBytes, asset.ContentHash, asset.Origin, "", asset.Status, "", "", "", "", string(serialized), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return rollback(err)
	}
	if projectID != "" {
		if err := attachTx(tx, asset.ID, projectID, now); err != nil {
			return rollback(err)
		}
		asset.ProjectIDs = []string{projectID}
	}
	if err := recordAssetEvent(tx, asset.ID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return asset, nil
}

// TranscriptPart is one non-primary file of a transcript Asset bundle. The
// primary Asset content is the aligned source audio track served by the content
// endpoint; SRT and JSON transcript payloads are content-addressed parts
// referenced from metadata and served by the parts endpoint. Paths stay
// platform-internal and are only used to serve bytes, mirroring metadata["path"].
type TranscriptPart struct {
	Name        string `json:"name"`
	ContentHash string `json:"contentHash"`
	MimeType    string `json:"mimeType"`
	SizeBytes   int64  `json:"sizeBytes"`
	Path        string `json:"path,omitempty"`
}

// TranscriptImport describes a platform-owned ASR bundle Asset: an aligned
// source audio track plus its SRT and JSON transcript payloads. Audio is the
// primary content so the content endpoint can play it directly.
type TranscriptImport struct {
	Name           string
	SourceAssetID  string
	Audio          []byte
	SRT            []byte
	TranscriptJSON []byte
	AudioMimeType  string
	Model          string
	Language       string
	LanguageProb   float64
	Duration       float64
}

// ImportTranscript persists an ASR bundle as a single transcript Asset. Unlike
// imports of user files this is a generated delivery: every call creates a new
// Asset record while still sharing content-addressed bytes on disk.
func (m *MediaService) ImportTranscript(input TranscriptImport) (MediaAsset, error) {
	if len(input.Audio) == 0 || len(input.SRT) == 0 || len(input.TranscriptJSON) == 0 {
		return MediaAsset{}, errors.New("transcript bundle requires audio, srt and json content")
	}
	if strings.TrimSpace(input.AudioMimeType) == "" {
		input.AudioMimeType = "audio/wav"
	}
	root := m.store.MediaRoot()
	audioPath, audioHash, err := m.persistContentPart(root, input.Audio, extensionFor(input.AudioMimeType))
	if err != nil {
		return MediaAsset{}, err
	}
	srtPath, srtHash, err := m.persistContentPart(root, input.SRT, ".srt")
	if err != nil {
		return MediaAsset{}, err
	}
	jsonPath, jsonHash, err := m.persistContentPart(root, input.TranscriptJSON, ".json")
	if err != nil {
		return MediaAsset{}, err
	}

	duration := input.Duration
	segmentCount := 0
	var parsedTranscript struct {
		Duration float64 `json:"duration"`
		Segments []any   `json:"segments"`
	}
	if json.Unmarshal(input.TranscriptJSON, &parsedTranscript) == nil {
		segmentCount = len(parsedTranscript.Segments)
		if parsedTranscript.Duration > 0 {
			duration = parsedTranscript.Duration
		}
	}

	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "transcript-" + id + extensionFor(input.AudioMimeType)
	}
	metadata := map[string]any{
		"path":   audioPath,
		"source": "transcript",
		"transcript": map[string]any{
			"sourceAssetId":       input.SourceAssetID,
			"model":               input.Model,
			"language":            input.Language,
			"languageProbability": input.LanguageProb,
			"duration":            duration,
			"segmentCount":        segmentCount,
			"parts": map[string]TranscriptPart{
				"srt":  {Name: "transcript.srt", ContentHash: srtHash, MimeType: "text/plain", SizeBytes: int64(len(input.SRT)), Path: srtPath},
				"json": {Name: "transcript.json", ContentHash: jsonHash, MimeType: "application/json", SizeBytes: int64(len(input.TranscriptJSON)), Path: jsonPath},
			},
		},
	}
	serialized, _ := json.Marshal(metadata)
	asset := MediaAsset{ID: id, Kind: "transcript", Name: name, MimeType: input.AudioMimeType, SizeBytes: int64(len(input.Audio)), ContentHash: audioHash, Origin: "generated", Status: "completed", Metadata: metadata, CreatedAt: now, UpdatedAt: now}

	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if _, err = tx.Exec("insert into media_assets (id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, remote_poll_url, error, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", asset.ID, asset.Kind, asset.Name, asset.MimeType, asset.SizeBytes, asset.ContentHash, asset.Origin, "", asset.Status, "", "", "", "", string(serialized), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return rollback(err)
	}
	if input.SourceAssetID != "" {
		if _, err = tx.Exec("update media_assets set parent_id = ? where id = ?", input.SourceAssetID, asset.ID); err != nil {
			return rollback(err)
		}
		asset.ParentID = input.SourceAssetID
	}
	if err := recordAssetEvent(tx, asset.ID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return asset, nil
}

func (m *MediaService) persistContentPart(root string, content []byte, ext string) (path, contentHash string, err error) {
	hash := sha256.Sum256(content)
	contentHash = hex.EncodeToString(hash[:])
	path = filepath.Join(root, "media", "assets", contentHash[:2], contentHash+ext)
	if err = os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", "", err
	}
	if err = os.WriteFile(path, content, 0o600); err != nil && !os.IsExist(err) {
		return "", "", err
	}
	return path, contentHash, nil
}

// GetAssetPart returns one named content part of a completed Asset bundle:
// transcript Assets expose srt/json parts while reference Assets expose body
// text (content) and image parts. Parts are content-addressed and immutable
// like the primary content.
func (m *MediaService) GetAssetPart(id, partName string) (TranscriptPart, []byte, error) {
	asset, err := m.getAsset(id)
	if err != nil {
		return TranscriptPart{}, nil, err
	}
	if asset.Status != "completed" {
		return TranscriptPart{}, nil, errors.New("media asset is not ready")
	}
	parts, err := assetContentParts(asset)
	if err != nil {
		return TranscriptPart{}, nil, err
	}
	raw, ok := parts[partName].(map[string]any)
	if !ok {
		return TranscriptPart{}, nil, fmt.Errorf("asset part %q was not found", partName)
	}
	path, _ := raw["path"].(string)
	if path == "" {
		return TranscriptPart{}, nil, errors.New("asset part file is missing")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return TranscriptPart{}, nil, err
	}
	return TranscriptPart{
		Name:        metadataString(raw["name"]),
		ContentHash: metadataString(raw["contentHash"]),
		MimeType:    metadataString(raw["mimeType"]),
		SizeBytes:   metadataFloat(raw["sizeBytes"]),
		Path:        path,
	}, content, nil
}

// assetContentParts resolves the content-addressed parts map from either a
// transcript or a reference Asset bundle.
func assetContentParts(asset MediaAsset) (map[string]any, error) {
	if bundle, ok := asset.Metadata["transcript"].(map[string]any); ok {
		parts, ok := bundle["parts"].(map[string]any)
		if !ok {
			return nil, errors.New("media asset has no transcript parts")
		}
		return parts, nil
	}
	if reference, ok := asset.Metadata["reference"].(map[string]any); ok {
		parts, ok := reference["parts"].(map[string]any)
		if !ok {
			return nil, errors.New("media asset has no reference content parts")
		}
		return parts, nil
	}
	return nil, errors.New("media asset is not a transcript bundle or reference")
}

func metadataString(value any) string {
	text, _ := value.(string)
	return text
}

func metadataFloat(value any) int64 {
	switch value := value.(type) {
	case int:
		return int64(value)
	case int64:
		return value
	case float64:
		return int64(value)
	default:
		return 0
	}
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
