/*
 * [INPUT]: 依赖持久化 MediaJob/MediaAsset、按 provider 协议的远端任务协调器与凭据
 * [OUTPUT]: 对外提供通用远端任务恢复入口：对已 checkpoint 付费远端 job 的失败 Asset 原位恢复轮询，绝不重发
 * [POS]: media 的远端任务恢复边界；把 atlas/skymind 等 provider 专属的 poll/reconcile 分派收敛为一个 provider-agnostic 入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"errors"
	"time"
)

// RetryRemoteJob re-collects the output of a generated asset whose remote job
// was already checkpointed, dispatching to whichever provider protocol owns that
// remote task. The generic invariant: a checkpointed remote ID means the paid
// call already happened, so this path only polls/collects and never resubmits.
// It accepts both failed assets (a poll/download gave up) and running assets
// (the UI's own generation timeout paused tracking while the remote task may
// still be alive), so it doubles as the manual "sync now" affordance. A
// still-running remote task returns to the durable reconciler.
func (m *MediaService) RetryRemoteJob(assetID string) (MediaAsset, error) {
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ?", assetID))
	if err != nil {
		return MediaAsset{}, err
	}
	if asset.Status != "failed" && asset.Status != "running" {
		return MediaAsset{}, errors.New("只有生成中或失败的素材可以同步远端任务")
	}
	if asset.JobID == "" {
		return MediaAsset{}, errors.New("该素材没有关联的生成任务")
	}
	job, err := m.getJob(asset.JobID)
	if err != nil {
		return MediaAsset{}, err
	}
	if job.RemoteID == "" {
		return MediaAsset{}, errors.New("该任务没有可恢复的远端任务")
	}
	var credentialID string
	if err := db.QueryRow("select credential_id from media_jobs where id = ?", job.ID).Scan(&credentialID); err != nil {
		return MediaAsset{}, err
	}
	provider, err := m.remoteRecoveryProvider(credentialID)
	if err != nil {
		return MediaAsset{}, err
	}
	// Restart the client-side generation-timeout window: a manual sync means the
	// remote task is being actively watched again, so the asset must not be
	// re-marked timed-out from its original start time the moment it resumes.
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	now := time.Now().UTC()
	metadata[generationResumedAtMetadataKey] = now.Format(time.RFC3339Nano)
	serialized, _ := json.Marshal(metadata)
	nowText := now.Format(time.RFC3339Nano)
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if asset.Status == "failed" {
		if _, err := tx.Exec("update media_assets set status = 'running', error = '', metadata_json = ?, updated_at = ? where id = ? and status = 'failed'", string(serialized), nowText, asset.ID); err != nil {
			return rollback(err)
		}
		if _, err := tx.Exec("update media_jobs set status = 'running', error = '', updated_at = ? where id = ? and status = 'failed'", nowText, job.ID); err != nil {
			return rollback(err)
		}
	} else {
		if _, err := tx.Exec("update media_assets set metadata_json = ?, updated_at = ? where id = ? and status = 'running'", string(serialized), nowText, asset.ID); err != nil {
			return rollback(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	if err := m.advanceRemoteJob(provider, job.ID); err != nil {
		m.failRemoteAsset(job.ID, asset.ID, err.Error())
		return MediaAsset{}, err
	}
	updated, err := m.getAsset(asset.ID)
	if err != nil {
		return MediaAsset{}, err
	}
	if updated.Status == "failed" {
		if updated.Error == "" {
			updated.Error = "远端任务同步失败"
		}
		return MediaAsset{}, errors.New(updated.Error)
	}
	return updated, nil
}

// RetryAssetDownload is retained for callers built around the original
// Atlas-only name; recovery is now provider-agnostic via RetryRemoteJob.
func (m *MediaService) RetryAssetDownload(assetID string) (MediaAsset, error) {
	return m.RetryRemoteJob(assetID)
}

// remoteRecoveryProvider reports whether the credential's provider has a
// remote-job reconciler this service can drive. Unknown providers fail closed
// rather than silently resubmitting a paid task.
func (m *MediaService) remoteRecoveryProvider(credentialID string) (string, error) {
	credential, err := m.credential(credentialID)
	if err != nil {
		return "", errors.New("该任务的凭据不可用，无法恢复远端任务")
	}
	if !supportsRemoteRecovery(credential.Provider) {
		return "", errors.New("该 provider 暂不支持远端任务恢复")
	}
	return credential.Provider, nil
}

func supportsRemoteRecovery(providerID string) bool {
	switch providerID {
	case "atlas-cloud", "skymind-token":
		return true
	default:
		return false
	}
}

// advanceRemoteJob performs exactly one reconciliation step for the provider
// that owns jobID. A still-running remote task is handed back to durable
// polling; a completed one is collected inline.
func (m *MediaService) advanceRemoteJob(provider, jobID string) error {
	switch provider {
	case "atlas-cloud":
		task, ok := m.atlasTask(jobID)
		if !ok {
			return errors.New("远端任务暂不可恢复，请稍后重试")
		}
		if terminal, _ := m.reconcileAtlasTask(task); !terminal {
			m.startAtlasPolling(jobID)
		}
	case "skymind-token":
		task, ok := m.skymindTask(jobID)
		if !ok {
			return errors.New("远端任务暂不可恢复，请稍后重试")
		}
		if !m.reconcileSkymindTask(task) {
			m.startSkymindPolling(jobID)
		}
	default:
		return errors.New("该 provider 暂不支持远端任务恢复")
	}
	return nil
}
