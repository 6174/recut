/*
 * [INPUT]: 依赖 Workspace 数据库与受控媒体根
 * [OUTPUT]: Asset 导入、查询、去重、落盘、项目关联、异步生成时间/输出/诊断元数据及 durable 更新事件
 * [POS]: media 的资产真相源；Provider 不直接访问该层，终态与 SSE 事件在此原位回写
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const MaxMediaUploadBytes = 50 << 20

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
	defer db.Close()
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
	defer db.Close()
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
	defer db.Close()
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
	defer rows.Close()
	assets := []MediaAsset{}
	for rows.Next() {
		asset, err := scanAsset(db, rows)
		if err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func (m *MediaService) GetAsset(id string) (MediaAsset, error) {
	return m.getAsset(id)
}

func (m *MediaService) getAsset(id string) (MediaAsset, error) {
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	defer db.Close()
	row := db.QueryRow("select "+assetColumns+" from media_assets where id = ?", id)
	return scanAsset(db, row)
}

type mediaScanner interface{ Scan(...any) error }

func scanAsset(db *sql.DB, row mediaScanner) (MediaAsset, error) {
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
	projectRows, err := db.Query("select project_id from media_asset_projects where asset_id = ? order by project_id", asset.ID)
	if err != nil {
		return asset, nil
	}
	defer projectRows.Close()
	for projectRows.Next() {
		var projectID string
		_ = projectRows.Scan(&projectID)
		asset.ProjectIDs = append(asset.ProjectIDs, projectID)
	}
	return asset, nil
}

func (m *MediaService) Attach(assetID, projectID string) error {
	if _, err := projectExists(m.store, projectID); err != nil {
		return err
	}
	if _, err := m.GetAsset(assetID); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	db, err := m.database()
	if err != nil {
		return err
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	if err := attachTx(tx, assetID, projectID, time.Now().UTC()); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := recordAssetEvent(tx, assetID, time.Now().UTC()); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
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

	m.mu.Lock()
	defer m.mu.Unlock()
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	defer db.Close()
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

	m.mu.Lock()
	defer m.mu.Unlock()
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	defer db.Close()
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
	return asset, nil
}

func (m *MediaService) failRemoteAsset(jobID, assetID, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	db, err := m.database()
	if err != nil {
		return
	}
	defer db.Close()
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
	_ = tx.Commit()
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
	m.mu.Lock()
	defer m.mu.Unlock()
	db, err := m.database()
	if err != nil {
		return 0, err
	}
	defer db.Close()
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
	return attempt, nil
}

func (m *MediaService) clearAtlasPollingDiagnostic(jobID, assetID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	db, err := m.database()
	if err != nil {
		return
	}
	defer db.Close()
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
	_ = tx.Commit()
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

func (m *MediaService) ImportMedia(name, mimeType string, content []byte) (MediaAsset, error) {
	kind, maxBytes, err := importedMediaKind(mimeType)
	if err != nil || len(content) == 0 || len(content) > maxBytes {
		return MediaAsset{}, errors.New("only supported images, videos, or audio within their upload limits can be imported")
	}
	if strings.TrimSpace(name) == "" {
		name = "reference" + extensionFor(mimeType)
	}
	return m.saveAsset(content, kind, mimeType, name, "user-upload", "", map[string]any{"source": "user-upload"}, "")
}

func importedMediaKind(mimeType string) (string, int, error) {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image", 30 << 20, nil
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio", 15 << 20, nil
	case strings.HasPrefix(mimeType, "video/"):
		return "video", MaxMediaUploadBytes, nil
	default:
		return "", 0, errors.New("unsupported media type")
	}
}

func (m *MediaService) saveAsset(content []byte, kind, mimeType, name, origin, projectID string, metadata map[string]any, id string) (MediaAsset, error) {
	hash := sha256.Sum256(content)
	contentHash := hex.EncodeToString(hash[:])
	if projectID != "" {
		if _, err := projectExists(m.store, projectID); err != nil {
			return MediaAsset{}, err
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	defer db.Close()
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
	return asset, nil
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
