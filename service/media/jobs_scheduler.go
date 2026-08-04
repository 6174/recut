/*
 * [INPUT]: 依赖持久化 MediaJob/MediaAsset、SQLite lease、凭据与 Atlas/local 执行器
 * [OUTPUT]: 对外提供常驻任务扫描、跨进程原子认领、重启恢复、失败终态审计和单步 Atlas 回收
 * [POS]: media/jobs 的 durable scheduler；MCP 只提交 queued Asset，Daemon 独占任务推进
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"sync"
	"time"
)

// A provider request may occupy the HTTP client for mediaRequestTimeout. The
// initial lease covers that bound and a live worker renews it through longer
// uploads; a dead daemon naturally stops renewing and becomes recoverable.
const mediaTaskLeaseLifetime = mediaRequestTimeout + 30*time.Second
const mediaTaskLeaseRenewInterval = mediaTaskLeaseLifetime / 3

// RecoverInterruptedJobs is safe on every daemon start. It resumes persisted
// Atlas predictions and terminally marks unbound calls whose provider result
// can no longer be known without a documented idempotency contract.
func (m *MediaService) RecoverInterruptedJobs() (int64, error) {
	return m.reconcileDurableJobs()
}

// ReconcilePendingJobs advances each durable task at most one provider step.
// The periodic daemon owns invocation and polling; short-lived MCP/HTTP
// submitters only write a queued Asset and return its stable ID.
func (m *MediaService) ReconcilePendingJobs() (int64, error) {
	return m.reconcileDurableJobs()
}

func (m *MediaService) reconcileDurableJobs() (int64, error) {
	repaired, err := m.repairRunningAtlasBindings()
	if err != nil {
		return 0, err
	}
	uncertain, err := m.failUncertainUnboundTasks()
	if err != nil {
		return 0, err
	}
	unavailable, err := m.failUnavailableAtlasJobs()
	if err != nil {
		return 0, err
	}
	atlasIDs, err := m.runningAtlasJobIDs()
	if err != nil {
		return 0, err
	}
	queuedIDs, err := m.queuedJobIDs()
	if err != nil {
		return 0, err
	}
	for _, id := range atlasIDs {
		m.startAtlasReconciliation(id)
	}
	for _, id := range queuedIDs {
		m.startQueuedExecution(id)
	}
	return repaired + uncertain + unavailable + int64(len(atlasIDs)+len(queuedIDs)), nil
}

// StartReconciler runs only inside the long-lived Daemon. Each tick is an
// independent recovery pass, so a transient SQLite/provider failure cannot
// kill later task progress.
func (m *MediaService) StartReconciler(interval time.Duration) func() {
	if interval <= 0 {
		interval = atlasPollInterval
	}
	stop := make(chan struct{})
	run := func() {
		if _, err := m.ReconcilePendingJobs(); err != nil {
			log.Printf("WARN media task reconciliation failed: %v", err)
		}
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		run()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				run()
			case <-stop:
				return
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			close(stop)
			<-done
		})
	}
}

func (m *MediaService) runningAtlasJobIDs() ([]string, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`select distinct j.id from media_jobs j join media_assets a on a.job_id = j.id join media_credentials c on c.id = j.credential_id where j.status = 'running' and j.remote_id != '' and a.status = 'running' and c.provider = 'atlas-cloud'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJobIDs(rows)
}

// Atlas acceptance has one canonical remote handle: the job record. Current
// submissions bind job and Asset atomically, but this repair lets a daemon
// recover historical one-sided writes instead of silently leaving an already
// completed prediction in running forever.
func (m *MediaService) repairRunningAtlasBindings() (int64, error) {
	db, err := m.database()
	if err != nil {
		return 0, err
	}
	rows, err := db.Query(`select j.id, a.id, j.remote_id, j.remote_poll_url, a.remote_id, a.remote_poll_url from media_jobs j join media_assets a on a.job_id = j.id where j.status = 'running' and a.status = 'running' and j.model_id like 'atlas-cloud/%'`)
	if err != nil {
		return 0, err
	}
	bindings := []atlasBinding{}
	for rows.Next() {
		var binding atlasBinding
		if err := rows.Scan(&binding.jobID, &binding.assetID, &binding.jobRemoteID, &binding.jobPollURL, &binding.assetRemoteID, &binding.assetPollURL); err != nil {
			return 0, err
		}
		bindings = append(bindings, binding)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	var repaired int64
	for _, binding := range bindings {
		changed, err := m.repairAtlasBinding(binding)
		if err != nil {
			return repaired, err
		}
		if changed {
			repaired++
		}
	}
	return repaired, nil
}

type atlasBinding struct {
	jobID, assetID, jobRemoteID, jobPollURL, assetRemoteID, assetPollURL string
}

func (b atlasBinding) canonical() (string, string) {
	remoteID := strings.TrimSpace(b.jobRemoteID)
	if remoteID == "" {
		remoteID = strings.TrimSpace(b.assetRemoteID)
	}
	pollURL := strings.TrimSpace(b.jobPollURL)
	if pollURL == "" {
		pollURL = strings.TrimSpace(b.assetPollURL)
	}
	return remoteID, pollURL
}

func (m *MediaService) repairAtlasBinding(binding atlasBinding) (bool, error) {
	remoteID, pollURL := binding.canonical()
	if remoteID == "" || (binding.jobRemoteID == remoteID && binding.assetRemoteID == remoteID && binding.jobPollURL == pollURL && binding.assetPollURL == pollURL) {
		return false, nil
	}
	db, err := m.database()
	if err != nil {
		return false, err
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	rollback := func(cause error) (bool, error) { _ = tx.Rollback(); return false, cause }
	now := time.Now().UTC()
	result, err := tx.Exec("update media_jobs set remote_id = ?, remote_poll_url = ?, updated_at = ? where id = ? and status = 'running'", remoteID, pollURL, now.Format(time.RFC3339Nano), binding.jobID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("running Atlas job changed before binding repair"))
	}
	result, err = tx.Exec("update media_assets set remote_id = ?, remote_poll_url = ?, updated_at = ? where id = ? and job_id = ? and status = 'running'", remoteID, pollURL, now.Format(time.RFC3339Nano), binding.assetID, binding.jobID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("running Atlas asset changed before binding repair"))
	}
	if err := recordAssetEvent(tx, binding.assetID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	m.publishAssetChange()
	return true, nil
}

func (m *MediaService) queuedJobIDs() ([]string, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`select distinct j.id from media_jobs j join media_assets a on a.job_id = j.id where j.status = 'queued' and j.remote_id = '' and j.submission_started_at = '' and a.status = 'queued' and a.remote_id = ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJobIDs(rows)
}

func scanJobIDs(rows *sql.Rows) ([]string, error) {
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (m *MediaService) failUnavailableAtlasJobs() (int64, error) {
	db, err := m.database()
	if err != nil {
		return 0, err
	}
	rows, err := db.Query(`select j.id, a.id, j.credential_id from media_jobs j join media_assets a on a.job_id = j.id where j.status = 'running' and j.remote_id != '' and a.status = 'running' and j.model_id like 'atlas-cloud/%'`)
	if err != nil {
		return 0, err
	}
	type pendingAtlasJob struct{ jobID, assetID, credentialID string }
	tasks := []pendingAtlasJob{}
	for rows.Next() {
		var task pendingAtlasJob
		if err := rows.Scan(&task.jobID, &task.assetID, &task.credentialID); err != nil {
			_ = rows.Close()
			return 0, err
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	failed := int64(0)
	for _, task := range tasks {
		credential, credentialErr := m.credential(task.credentialID)
		if credentialErr == nil && credential.Provider == "atlas-cloud" {
			_, credentialErr = m.secret(credential.ID)
		}
		if credentialErr == nil && credential.Provider != "atlas-cloud" {
			credentialErr = errors.New("credential no longer belongs to Atlas Cloud")
		}
		if credentialErr == nil {
			continue
		}
		m.failRemoteAsset(task.jobID, task.assetID, "Atlas Cloud credential is unavailable: "+credentialErr.Error())
		failed++
	}
	return failed, nil
}

// startTask owns the in-memory fast path while claimTaskLease protects two
// Daemons that happen to point at the same workspace SQLite database.
func (m *MediaService) startTask(jobID string, run func()) {
	workerID := "durable-task:" + jobID
	if _, loaded := m.pollers.LoadOrStore(workerID, struct{}{}); loaded {
		return
	}
	go func() {
		defer m.pollers.Delete(workerID)
		claimed, err := m.claimTaskLease(jobID)
		if err != nil || !claimed {
			return
		}
		defer m.releaseTaskLease(jobID)
		stopRenewal := m.renewTaskLease(jobID)
		defer stopRenewal()
		run()
	}()
}

func (m *MediaService) startQueuedExecution(jobID string) {
	m.startTask(jobID, func() { m.executeQueuedTask(jobID) })
}

// startAtlasReconciliation does one non-blocking provider poll. The next
// Daemon tick schedules the next poll, keeping remote state ownership in the
// durable scheduler rather than a browser or an unbounded request goroutine.
func (m *MediaService) startAtlasReconciliation(jobID string) {
	m.startTask(jobID, func() {
		task, active := m.atlasTask(jobID)
		if !active {
			return
		}
		_, _ = m.reconcileAtlasTask(task)
	})
}

func (m *MediaService) executeQueuedTask(jobID string) {
	job, credential, active, err := m.queuedTask(jobID)
	if err != nil || !active {
		if err != nil {
			log.Printf("WARN media queued task lookup failed job_id=%s: %v", jobID, err)
		}
		return
	}
	if isAtlasVideoJob(job, credential) {
		job, active, err = m.checkpointQueuedSubmission(job)
		if err != nil || !active {
			if err != nil {
				log.Printf("WARN media Atlas submission checkpoint failed job_id=%s: %v", jobID, err)
			}
			return
		}
		_, _ = m.submitAtlasVideo(job, credential, false)
		return
	}
	gate := m.oneRequestGate(credential.ID)
	gate <- struct{}{}
	defer func() { <-gate }()
	job, credential, active, err = m.activateQueuedTask(jobID)
	if err != nil || !active {
		if err != nil {
			log.Printf("WARN media one-request task activation failed job_id=%s: %v", jobID, err)
		}
		return
	}
	m.execute(job, credential)
}

// checkpointQueuedSubmission records the non-replayable boundary before every
// external provider call. A provider may opt into safe replay only after this
// contract gains an explicit idempotency capability; until then recovery must
// never turn an uncertain paid call into a second submission.
func (m *MediaService) checkpointQueuedSubmission(job MediaJob) (MediaJob, bool, error) {
	if len(job.AssetIDs) != 1 {
		return MediaJob{}, false, errors.New("queued media job has no single pending asset")
	}
	db, err := m.database()
	if err != nil {
		return MediaJob{}, false, err
	}
	tx, err := db.Begin()
	if err != nil {
		return MediaJob{}, false, err
	}
	now := time.Now().UTC()
	result, err := tx.Exec(`update media_jobs set submission_started_at = ?, updated_at = ? where id = ? and status = 'queued' and remote_id = '' and submission_started_at = '' and exists (select 1 from media_assets a where a.id = ? and a.job_id = media_jobs.id and a.status = 'queued' and a.remote_id = '')`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), job.ID, job.AssetIDs[0])
	if err != nil {
		_ = tx.Rollback()
		return MediaJob{}, false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		_ = tx.Rollback()
		return MediaJob{}, false, err
	}
	if changed != 1 {
		_ = tx.Rollback()
		return MediaJob{}, false, nil
	}
	if err := tx.Commit(); err != nil {
		return MediaJob{}, false, err
	}
	job.UpdatedAt = now
	return job, true, nil
}

func (m *MediaService) queuedTask(jobID string) (MediaJob, MediaCredential, bool, error) {
	db, err := m.database()
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	job, err := scanJob(db.QueryRow("select "+jobColumns+" from media_jobs where id = ? and status = 'queued' and remote_id = '' and submission_started_at = ''", jobID))
	if errors.Is(err, sql.ErrNoRows) {
		return MediaJob{}, MediaCredential{}, false, nil
	}
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	if len(job.AssetIDs) != 1 {
		return MediaJob{}, MediaCredential{}, false, errors.New("queued media job has no single pending asset")
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ? and job_id = ? and status = 'queued' and remote_id = ''", job.AssetIDs[0], job.ID))
	if errors.Is(err, sql.ErrNoRows) {
		return MediaJob{}, MediaCredential{}, false, nil
	}
	if err != nil || asset.ID != job.AssetIDs[0] {
		return MediaJob{}, MediaCredential{}, false, err
	}
	var credentialID string
	if err := db.QueryRow("select credential_id from media_jobs where id = ?", job.ID).Scan(&credentialID); err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	credential, err := m.credential(credentialID)
	if err == nil {
		return job, credential, true, nil
	}
	m.failQueuedAsset(job.ID, asset.ID, err.Error())
	return job, MediaCredential{}, false, nil
}

// activateQueuedTask is used by providers that return final bytes in one
// request. It atomically crosses the non-replayable boundary and marks the
// local Asset running before the provider call. There is therefore no local
// checkpointed-but-queued state that a SQLite write conflict can mistake for
// an interrupted external request on the next reconciliation tick.
func (m *MediaService) activateQueuedTask(jobID string) (MediaJob, MediaCredential, bool, error) {
	db, err := m.database()
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	tx, err := db.Begin()
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	rollback := func(cause error) (MediaJob, MediaCredential, bool, error) {
		_ = tx.Rollback()
		return MediaJob{}, MediaCredential{}, false, cause
	}
	now := time.Now().UTC()
	result, err := tx.Exec(`update media_jobs set status = ?, submission_started_at = ?, error = ?, updated_at = ? where id = ? and status = 'queued' and remote_id = '' and submission_started_at = '' and exists (select 1 from media_assets a where a.job_id = media_jobs.id and a.status = 'queued' and a.remote_id = '')`, "running", now.Format(time.RFC3339Nano), "", now.Format(time.RFC3339Nano), jobID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		_ = tx.Rollback()
		return MediaJob{}, MediaCredential{}, false, nil
	}
	job, err := scanJob(tx.QueryRow("select "+jobColumns+" from media_jobs where id = ? and status = 'running' and remote_id = '' and submission_started_at != ''", jobID))
	if err != nil {
		return rollback(err)
	}
	if len(job.AssetIDs) != 1 {
		return rollback(errors.New("queued media job has no single pending asset"))
	}
	result, err = tx.Exec("update media_assets set status = ?, error = ?, updated_at = ? where id = ? and job_id = ? and status = 'queued' and remote_id = ''", "running", "", now.Format(time.RFC3339Nano), job.AssetIDs[0], job.ID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("queued media asset changed before execution"))
	}
	if err := recordAssetEvent(tx, job.AssetIDs[0], now); err != nil {
		return rollback(err)
	}
	var credentialID string
	if err := tx.QueryRow("select credential_id from media_jobs where id = ?", job.ID).Scan(&credentialID); err != nil {
		return rollback(err)
	}
	job.Status = "running"
	job.Error = ""
	job.UpdatedAt = now
	if err := tx.Commit(); err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	m.publishAssetChange()
	credential, err := m.credential(credentialID)
	if err == nil {
		return job, credential, true, nil
	}
	m.failRemoteAsset(job.ID, job.AssetIDs[0], err.Error())
	return job, MediaCredential{}, false, nil
}

// bindQueuedAtlasPrediction is the external-side-effect checkpoint. It keeps
// the existing Asset ID, persists the Atlas prediction, and makes both job and
// Asset running in the same transaction before any poll can observe it.
func (m *MediaService) bindQueuedAtlasPrediction(job MediaJob, assetID, remoteID, pollURL string) (MediaAsset, error) {
	asset, err := m.getAsset(assetID)
	if err != nil {
		return MediaAsset{}, err
	}
	if asset.JobID != job.ID || asset.Status != "queued" || asset.RemoteID != "" {
		return MediaAsset{}, errors.New("queued Atlas asset changed before prediction binding")
	}
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["atlasPredictionId"] = remoteID
	serialized, _ := json.Marshal(metadata)
	now := time.Now().UTC()
	result, err := tx.Exec("update media_assets set status = ?, remote_id = ?, remote_poll_url = ?, error = ?, metadata_json = ?, updated_at = ? where id = ? and job_id = ? and status = 'queued' and remote_id = ''", "running", remoteID, pollURL, "", string(serialized), now.Format(time.RFC3339Nano), asset.ID, job.ID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("queued Atlas asset changed before prediction binding"))
	}
	assetIDs, _ := json.Marshal([]string{asset.ID})
	result, err = tx.Exec("update media_jobs set status = ?, asset_ids_json = ?, remote_id = ?, remote_poll_url = ?, error = ?, updated_at = ? where id = ? and status = 'queued' and remote_id = '' and submission_started_at != ''", "running", string(assetIDs), remoteID, pollURL, "", now.Format(time.RFC3339Nano), job.ID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("queued Atlas job changed before prediction binding"))
	}
	if err := recordAssetEvent(tx, asset.ID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	asset.Status, asset.RemoteID, asset.Error, asset.Metadata, asset.UpdatedAt = "running", remoteID, "", metadata, now
	return asset, nil
}

func (m *MediaService) failQueuedAsset(jobID, assetID, message string) {
	asset, err := m.getAsset(assetID)
	if err != nil || asset.JobID != jobID || asset.Status != "queued" {
		return
	}
	db, err := m.database()
	if err != nil {
		return
	}
	tx, err := db.Begin()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	metadata := completedGenerationMetadata(asset.Metadata, asset.CreatedAt, now)
	serialized, _ := json.Marshal(metadata)
	result, err := tx.Exec("update media_assets set status = ?, error = ?, metadata_json = ?, updated_at = ? where id = ? and job_id = ? and status = 'queued'", "failed", message, string(serialized), now.Format(time.RFC3339Nano), assetID, jobID)
	if err != nil {
		_ = tx.Rollback()
		return
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		_ = tx.Rollback()
		return
	}
	result, err = tx.Exec("update media_jobs set status = ?, error = ?, updated_at = ? where id = ? and status = 'queued'", "failed", message, now.Format(time.RFC3339Nano), jobID)
	if err != nil {
		_ = tx.Rollback()
		return
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		_ = tx.Rollback()
		return
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		_ = tx.Rollback()
		return
	}
	_, _ = tx.Exec("delete from media_task_leases where job_id = ?", jobID)
	if err := tx.Commit(); err != nil {
		return
	}
	m.publishAssetChange()
	log.Printf("ERROR media job failed job_id=%s asset_id=%s", jobID, assetID)
}

// A provider call with no durable remote ID is an external-transaction gap.
// The checkpoint tells us it may already have been billed; after owner loss we
// preserve the Asset reference but fail it rather than replay an unknown call.
func (m *MediaService) failUncertainUnboundTasks() (int64, error) {
	db, err := m.database()
	if err != nil {
		return 0, err
	}
	now := time.Now().UTC()
	rows, err := db.Query(`select j.id, a.id, j.status, j.model_id from media_jobs j join media_assets a on a.job_id = j.id left join media_task_leases l on l.job_id = j.id where j.remote_id = '' and a.remote_id = '' and ((j.status = 'queued' and j.submission_started_at != '' and a.status = 'queued') or (j.status = 'running' and a.status = 'running')) and (l.job_id is null or l.expires_at_ms <= ?)`, now.UnixMilli())
	if err != nil {
		return 0, err
	}
	type uncertainTask struct{ jobID, assetID, status, modelID string }
	tasks := []uncertainTask{}
	for rows.Next() {
		var task uncertainTask
		if err := rows.Scan(&task.jobID, &task.assetID, &task.status, &task.modelID); err != nil {
			_ = rows.Close()
			return 0, err
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	for _, task := range tasks {
		message := "媒体提交结果不确定，请用新任务重试。"
		if strings.HasPrefix(task.modelID, "atlas-cloud/") {
			message = "Atlas 提交结果不确定，请用新任务重试。"
		}
		if task.status == "queued" {
			m.failQueuedAsset(task.jobID, task.assetID, message)
			continue
		}
		m.failRemoteAsset(task.jobID, task.assetID, message)
	}
	return int64(len(tasks)), nil
}

func (m *MediaService) claimTaskLease(jobID string) (bool, error) {
	db, err := m.database()
	if err != nil {
		return false, err
	}
	now := time.Now().UTC()
	result, err := db.Exec(`insert into media_task_leases (job_id, owner_id, expires_at_ms, updated_at) values (?, ?, ?, ?) on conflict(job_id) do update set owner_id = excluded.owner_id, expires_at_ms = excluded.expires_at_ms, updated_at = excluded.updated_at where media_task_leases.expires_at_ms <= ? or media_task_leases.owner_id = ?`, jobID, m.schedulerID, now.Add(mediaTaskLeaseLifetime).UnixMilli(), now.Format(time.RFC3339Nano), now.UnixMilli(), m.schedulerID)
	if err != nil {
		return false, err
	}
	claimed, err := result.RowsAffected()
	return claimed == 1, err
}

// renewTaskLease lets a healthy daemon keep ownership through slow uploads or
// provider calls. A crashed process stops renewing naturally, which makes the
// checkpoint visible to the next recovery pass after one lease lifetime.
func (m *MediaService) renewTaskLease(jobID string) func() {
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(mediaTaskLeaseRenewInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if !m.extendTaskLease(jobID) {
					return
				}
			case <-stop:
				return
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			close(stop)
			<-done
		})
	}
}

func (m *MediaService) extendTaskLease(jobID string) bool {
	db, err := m.database()
	if err != nil {
		return false
	}
	now := time.Now().UTC()
	result, err := db.Exec("update media_task_leases set expires_at_ms = ?, updated_at = ? where job_id = ? and owner_id = ?", now.Add(mediaTaskLeaseLifetime).UnixMilli(), now.Format(time.RFC3339Nano), jobID, m.schedulerID)
	if err != nil {
		return false
	}
	changed, err := result.RowsAffected()
	return err == nil && changed == 1
}

func (m *MediaService) releaseTaskLease(jobID string) {
	db, err := m.database()
	if err != nil {
		return
	}
	_, _ = db.Exec("delete from media_task_leases where job_id = ? and owner_id = ?", jobID, m.schedulerID)
}
