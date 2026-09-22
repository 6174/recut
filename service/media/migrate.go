/*
 * [INPUT]: 依赖 MediaService 的 Asset 列表/解挂与 workspace_preferences 键值表
 * [OUTPUT]: 一次性幂等迁移 MigrateDetachAnalysisAssets：把理解产物（origin=understand）
 *   与参考资产（attributes.role=reference）从所有项目解挂，保持 workspace 级；不删字节
 * [POS]: media 包的数据迁移；修正 Layer 1 参考理解产物被错误挂进项目素材库的历史状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"database/sql"
	"time"
)

// analysisDetachMigrationKey records that the one-time detach migration ran.
const analysisDetachMigrationKey = "media_analysis_detach_migrated_v1"

// MigrateDetachAnalysisAssets is a one-time, idempotent migration. Reference
// understanding is a global platform capability (Layer 1): its intermediates
// (origin=understand) and the reference asset itself (attributes.role=reference)
// belong to the workspace library, never to a project. Historical builds
// attached them to whatever project the session targeted, polluting the editor
// asset panel. This detaches them from every project without deleting bytes.
//
// It returns the number of project references removed. A second call is a no-op.
func (m *MediaService) MigrateDetachAnalysisAssets() (int, error) {
	if m == nil || m.store == nil {
		return 0, nil
	}
	db, err := m.database()
	if err != nil {
		return 0, err
	}
	if preferenceSet(db, analysisDetachMigrationKey) {
		return 0, nil
	}
	assets, err := m.ListAssets("")
	if err != nil {
		return 0, err
	}
	detached := 0
	for _, asset := range assets {
		if !isWorkspaceLevelAnalysisAsset(asset) {
			continue
		}
		projectIDs, err := m.assetProjectIDs(asset.ID)
		if err != nil {
			return detached, err
		}
		for _, projectID := range projectIDs {
			if projectID == "" {
				continue
			}
			if err := m.DetachProjectAsset(asset.ID, projectID); err != nil {
				return detached, err
			}
			detached++
		}
	}
	setPreference(db, analysisDetachMigrationKey, "1")
	return detached, nil
}

// isWorkspaceLevelAnalysisAsset reports whether an asset is a reference
// understanding product that must stay workspace-level.
func isWorkspaceLevelAnalysisAsset(asset MediaAsset) bool {
	if asset.Origin == "understand" {
		return true
	}
	attrs, err := MaterialAttrsFromMetadata(asset.Metadata)
	if err != nil {
		return false
	}
	for _, attr := range attrs {
		if attr.Key != "role" {
			continue
		}
		if value, ok := attr.Value.(string); ok && value == "reference" {
			return true
		}
	}
	return false
}

func preferenceSet(db *sql.DB, key string) bool {
	var raw string
	if err := db.QueryRow("select value_json from workspace_preferences where key = ?", key).Scan(&raw); err != nil {
		return false
	}
	return true
}

func setPreference(db *sql.DB, key, value string) {
	_, _ = db.Exec(
		"insert into workspace_preferences (key, value_json, updated_at) values (?, ?, ?) on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at",
		key, value, time.Now().UTC().Format(time.RFC3339Nano),
	)
}
