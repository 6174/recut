/*
 * [INPUT]: 依赖 Workspace 数据库与受控媒体根
 * [OUTPUT]: Asset 导入、查询、去重、落盘与项目关联
 * [POS]: media 的资产真相源；Provider 不直接访问该层
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const MaxMediaUploadBytes = 50 << 20

const assetColumns = `id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, error, metadata_json, created_at, updated_at`

func (m *MediaService) ListAssets(projectID string) ([]MediaAsset, error) {
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
	// completed files. A pending Asset is valid only with a durable remote task
	// binding; blank or unbound legacy values are not in-flight work.
	if strings.TrimSpace(asset.Status) == "" || ((asset.Status == "queued" || asset.Status == "running") && (asset.JobID == "" || asset.RemoteID == "")) {
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
	db, err := m.database()
	if err != nil {
		return err
	}
	defer db.Close()
	return m.attach(db, assetID, projectID)
}

func (m *MediaService) attach(db *sql.DB, assetID, projectID string) error {
	_, err := db.Exec("insert or ignore into media_asset_projects (asset_id, project_id, created_at) values (?, ?, ?)", assetID, projectID, time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func (m *MediaService) saveGeneratedAsset(job MediaJob, content []byte, kind, mimeType string, metadata map[string]any) (MediaAsset, error) {
	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	return m.saveAsset(content, kind, mimeType, "generated-"+id+extensionFor(mimeType), "generated", job.ProjectID, metadata, id)
}

// createRemoteAsset commits the stable local reference immediately after a
// provider accepts an asynchronous task. Pending assets deliberately bypass
// content-hash de-duplication: they have no bytes yet and every remote task
// must retain its own identity.
func (m *MediaService) createRemoteAsset(job MediaJob, provider, remoteID, remotePollURL string) (MediaAsset, error) {
	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	metadata := map[string]any{
		"prompt":            job.Prompt,
		"modelId":           job.ModelID,
		"provider":          provider,
		"capability":        job.Capability,
		"referenceIds":      job.ReferenceIDs,
		"atlasPredictionId": remoteID,
	}
	serialized, _ := json.Marshal(metadata)
	asset := MediaAsset{ID: id, Kind: "video", Name: "generated-" + id + ".mp4", MimeType: "video/mp4", Origin: "generated", Status: "running", JobID: job.ID, RemoteID: remoteID, Metadata: metadata, CreatedAt: now, UpdatedAt: now}

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
	if _, err := tx.Exec("update media_jobs set status = ?, asset_ids_json = ?, remote_id = ?, remote_poll_url = ?, error = ?, updated_at = ? where id = ?", "running", string(assetIDs), remoteID, remotePollURL, "", now.Format(time.RFC3339Nano), job.ID); err != nil {
		return rollback(err)
	}
	if job.ProjectID != "" {
		if _, err := tx.Exec("insert or ignore into media_asset_projects (asset_id, project_id, created_at) values (?, ?, ?)", asset.ID, job.ProjectID, now.Format(time.RFC3339Nano)); err != nil {
			return rollback(err)
		}
		asset.ProjectIDs = []string{job.ProjectID}
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	return asset, nil
}

// completeRemoteAsset writes the provider result into the already-published
// Asset. It never calls saveAsset, which would allocate a second asset ID and
// break B-roll's scene reference.
func (m *MediaService) completeRemoteAsset(jobID, assetID string, content []byte, mimeType string) (MediaAsset, error) {
	if len(content) == 0 {
		return MediaAsset{}, errors.New("remote media output is empty")
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
		return MediaAsset{}, errors.New("remote asset does not belong to this job")
	}
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["path"] = path
	serialized, _ := json.Marshal(metadata)
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if _, err := tx.Exec("update media_assets set mime_type = ?, size_bytes = ?, content_hash = ?, status = ?, error = ?, metadata_json = ?, updated_at = ? where id = ? and job_id = ?", mimeType, len(content), contentHash, "completed", "", string(serialized), now.Format(time.RFC3339Nano), assetID, jobID); err != nil {
		return rollback(err)
	}
	assetIDs, _ := json.Marshal([]string{assetID})
	if _, err := tx.Exec("update media_jobs set status = ?, asset_ids_json = ?, error = ?, updated_at = ? where id = ?", "completed", string(assetIDs), "", now.Format(time.RFC3339Nano), jobID); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	asset.MimeType, asset.SizeBytes, asset.ContentHash, asset.Status, asset.Error, asset.Metadata, asset.UpdatedAt = mimeType, int64(len(content)), contentHash, "completed", "", metadata, now
	return asset, nil
}

func (m *MediaService) failRemoteAsset(jobID, assetID, message string) {
	db, err := m.database()
	if err != nil {
		return
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := db.Begin()
	if err != nil {
		return
	}
	if _, err := tx.Exec("update media_assets set status = ?, error = ?, updated_at = ? where id = ? and job_id = ? and status != ?", "failed", message, now, assetID, jobID, "completed"); err != nil {
		_ = tx.Rollback()
		return
	}
	if _, err := tx.Exec("update media_jobs set status = ?, error = ?, updated_at = ? where id = ? and status != ?", "failed", message, now, jobID, "completed"); err != nil {
		_ = tx.Rollback()
		return
	}
	_ = tx.Commit()
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
			if err := m.attach(db, existing.ID, projectID); err != nil {
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
	metadata["path"] = path
	asset := MediaAsset{ID: id, Kind: kind, Name: name, MimeType: mimeType, SizeBytes: int64(len(content)), ContentHash: contentHash, Origin: origin, Status: "completed", Metadata: metadata, CreatedAt: now, UpdatedAt: now}
	serialized, _ := json.Marshal(metadata)
	_, err = db.Exec("insert into media_assets (id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, remote_poll_url, error, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", asset.ID, asset.Kind, asset.Name, asset.MimeType, asset.SizeBytes, asset.ContentHash, asset.Origin, "", asset.Status, "", "", "", "", string(serialized), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return MediaAsset{}, err
	}
	if projectID != "" {
		err = m.attach(db, asset.ID, projectID)
	}
	return asset, err
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
