/*
 * [INPUT]: 依赖任务编排、Asset 持久化、凭据、临时公网分享（ShareClient）与 skymind 协议适配器
 * [OUTPUT]: 对外提供 Skymind 视频任务的提交（参考素材先发布为公网 URL）、任务绑定 checkpoint、
 *          短超时轮询与 /content 优先的结果回收；纪律与 Atlas 路径一致：远端 task id 与本地
 *          running 状态同事务落库，「未知提交」只查询不重发
 * [POS]: media/jobs 的 skymind-token 专属适配层；将已持久化远端任务原位兑现为 Asset
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"recut-service/media/providers/skymind"
)

var errSkymindVideoOutputMissing = errors.New("Skymind completed without a video output")

const skymindPollInterval = 15 * time.Second

// skymindDefaultResolution keeps the first-run cost minimal (measured ≈¥5 per
// 480p/5s video); users raise it via the job output parameter.
const skymindDefaultResolution = "480p"

func isSkymindVideoJob(job MediaJob, credential MediaCredential) bool {
	return job.Capability == VideoGenerate && credential.Provider == "skymind-token"
}

// submitSkymindVideo runs under the daemon's task lease (or synchronously for
// GenerateSync compatibility). Reference assets are published to temporary
// public URLs first: the gateway rejects data URLs at submission.
func (m *MediaService) submitSkymindVideo(job MediaJob, credential MediaCredential, pollLocally bool) (MediaJob, error) {
	model, ok := modelByID(job.ModelID)
	if !ok || !model.Available {
		return m.failSubmittedJob(job, errors.New("this provider model adapter is not available yet"))
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	references, err := m.skymindReferenceURLs(job)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	request := skymind.VideoRequest{
		Model:      apiModelIDFor(model, credential),
		Prompt:     job.Prompt,
		Images:     references.Images,
		Videos:     references.Videos,
		Audios:     references.Audios,
		Resolution: skymindOutputString(job.Output, "480p", "resolution"),
		Ratio:      skymindOutputString(job.Output, "16:9", "aspectRatio", "ratio"),
		Duration:   skymindOutputInteger(job.Output, 5, "durationSeconds", "duration"),
		Metadata:   skymindMetadata(job),
	}
	base := apiBaseFor(credential)
	task, err := skymind.SubmitVideo(mediaHTTPClient, base, secret, request)
	if err != nil {
		return m.failSubmittedJob(job, fmt.Errorf("%s", skymind.FriendlyError(err)))
	}
	var asset MediaAsset
	if len(job.AssetIDs) == 1 {
		asset, err = m.bindQueuedRemoteTask(job, job.AssetIDs[0], task.ID, "")
	} else {
		asset, err = m.createRemoteAsset(job, credential.Provider, task.ID, "")
	}
	if err != nil {
		return MediaJob{}, err
	}
	job, err = m.getJob(job.ID)
	if err != nil {
		return MediaJob{}, err
	}
	if len(job.AssetIDs) == 0 || job.AssetIDs[0] != asset.ID {
		return MediaJob{}, errors.New("running Skymind asset was not linked to its media job")
	}
	if task.Failed() {
		m.failRemoteAsset(job.ID, asset.ID, skymindTaskFailureMessage(task))
		return m.getJob(job.ID)
	}
	if task.Succeeded() {
		if err := m.collectSkymindOutput(job.ID, asset.ID, task); err != nil {
			if !errors.Is(err, errSkymindVideoOutputMissing) {
				m.failRemoteAsset(job.ID, asset.ID, err.Error())
			}
		}
		return m.getJob(job.ID)
	}
	if pollLocally {
		m.startSkymindPolling(job.ID)
	}
	return job, nil
}

type skymindReferences struct {
	Images []string
	Videos []string
	Audios []string
}

// skymindReferenceURLs groups the job's references by kind as public URLs.
// Asset references are published as temporary public URLs (deduplicated by
// content hash, so prompt-iteration re-submissions do not re-upload); URL
// references are passed through directly — the remote resource (e.g. a World
// evidence image on the platform CDN) is already public.
func (m *MediaService) skymindReferenceURLs(job MediaJob) (skymindReferences, error) {
	references := skymindReferences{}
	refs, err := m.jobReferences(job)
	if err != nil {
		return skymindReferences{}, err
	}
	for _, ref := range refs {
		if ref.Source == "url" {
			switch ref.Kind {
			case "image":
				references.Images = append(references.Images, ref.Value)
			case "video":
				references.Videos = append(references.Videos, ref.Value)
			case "audio":
				references.Audios = append(references.Audios, ref.Value)
			}
			continue
		}
		asset, err := m.GetAsset(ref.Value)
		if err != nil {
			return skymindReferences{}, err
		}
		share, err := m.SharePublish(asset, 7)
		if err != nil {
			return skymindReferences{}, fmt.Errorf("reference %q cannot be made public: %s", asset.Name, err)
		}
		switch asset.Kind {
		case "image":
			references.Images = append(references.Images, share.URL)
		case "video":
			references.Videos = append(references.Videos, share.URL)
		case "audio":
			references.Audios = append(references.Audios, share.URL)
		}
	}
	return references, nil
}

func skymindMetadata(job MediaJob) map[string]any {
	metadata := map[string]any{}
	if value, ok := job.Output["generateAudio"]; ok {
		metadata["generate_audio"] = value
	}
	if value, ok := job.Output["watermark"]; ok {
		metadata["watermark"] = value
	}
	if seed := skymindOutputInteger(job.Output, -1, "seed"); seed >= 0 {
		metadata["seed"] = seed
	}
	return metadata
}

func skymindTaskFailureMessage(task skymind.VideoTask) string {
	if task.ErrorCode != "" || task.ErrorMessage != "" {
		return "Skymind 任务失败（" + task.ErrorCode + "）：" + task.FailureMessage()
	}
	return "Skymind 任务失败"
}

// bindQueuedRemoteTask is the external-side-effect checkpoint: the gateway has
// accepted (and pre-billed) the task, so the remote task ID must land in the
// job and its Asset in one transaction before any poll can observe it.
func (m *MediaService) bindQueuedRemoteTask(job MediaJob, assetID, remoteID, pollURL string) (MediaAsset, error) {
	asset, err := m.getAsset(assetID)
	if err != nil {
		return MediaAsset{}, err
	}
	if asset.JobID != job.ID || asset.Status != "queued" || asset.RemoteID != "" {
		return MediaAsset{}, errors.New("queued asset changed before remote task binding")
	}
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["providerTaskId"] = remoteID
	serialized, _ := json.Marshal(metadata)
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	result, err := tx.Exec("update media_assets set status = ?, remote_id = ?, remote_poll_url = ?, error = ?, metadata_json = ?, updated_at = ? where id = ? and job_id = ? and status = 'queued' and remote_id = ''", "running", remoteID, pollURL, "", string(serialized), now.Format(time.RFC3339Nano), assetID, job.ID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("queued asset changed before remote task binding"))
	}
	assetIDs, _ := json.Marshal([]string{assetID})
	result, err = tx.Exec("update media_jobs set status = ?, asset_ids_json = ?, remote_id = ?, remote_poll_url = ?, error = ?, updated_at = ? where id = ? and status = 'queued' and remote_id = '' and submission_started_at != ''", "running", string(assetIDs), remoteID, pollURL, "", now.Format(time.RFC3339Nano), job.ID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		return rollback(errors.New("queued job changed before remote task binding"))
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	asset.Status, asset.RemoteID, asset.Error, asset.Metadata, asset.UpdatedAt = "running", remoteID, "", metadata, now
	return asset, nil
}

type skymindTask struct {
	job        MediaJob
	asset      MediaAsset
	credential MediaCredential
	secret     string
}

func (m *MediaService) skymindTask(jobID string) (skymindTask, bool) {
	job, err := m.getJob(jobID)
	if err != nil || job.Status != "running" || job.RemoteID == "" {
		return skymindTask{}, false
	}
	db, err := m.database()
	if err != nil {
		return skymindTask{}, false
	}
	var credentialID string
	if err := db.QueryRow("select credential_id from media_jobs where id = ?", jobID).Scan(&credentialID); err != nil {
		return skymindTask{}, false
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where job_id = ?", jobID))
	if err != nil || asset.Status != "running" || asset.RemoteID == "" {
		return skymindTask{}, false
	}
	credential, err := m.credential(credentialID)
	if err != nil || credential.Provider != "skymind-token" {
		return skymindTask{}, false
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return skymindTask{}, false
	}
	return skymindTask{job: job, asset: asset, credential: credential, secret: secret}, true
}

// startSkymindPolling drives one local poll loop (GenerateSync compatibility);
// durable ownership always stays with the scheduler's one-poll-per-tick path.
func (m *MediaService) startSkymindPolling(jobID string) {
	workerID := "skymind-poll:" + jobID
	if _, loaded := m.pollers.LoadOrStore(workerID, struct{}{}); loaded {
		return
	}
	go func() {
		defer m.pollers.Delete(workerID)
		for {
			task, active := m.skymindTask(jobID)
			if !active {
				return
			}
			terminal := m.reconcileSkymindTask(task)
			if terminal {
				return
			}
			time.Sleep(skymindPollInterval)
		}
	}()
}

// reconcileSkymindTask advances exactly one poll step. It returns true only
// once the Asset reached a terminal state.
func (m *MediaService) reconcileSkymindTask(task skymindTask) bool {
	taskStatus, err := skymind.PollVideo(atlasPollingHTTPClient, apiBaseFor(task.credential), task.secret, task.asset.RemoteID)
	if err != nil {
		m.recordSkymindPollingDiagnostic(task.job.ID, task.asset.ID, err.Error())
		return false
	}
	if taskStatus.Failed() {
		m.clearSkymindPollingDiagnostic(task.job.ID, task.asset.ID)
		m.failRemoteAsset(task.job.ID, task.asset.ID, skymindTaskFailureMessage(taskStatus))
		return true
	}
	if !taskStatus.Succeeded() {
		m.clearSkymindPollingDiagnostic(task.job.ID, task.asset.ID)
		return false
	}
	if err := m.collectSkymindOutput(task.job.ID, task.asset.ID, taskStatus); err != nil {
		m.failRemoteAsset(task.job.ID, task.asset.ID, err.Error())
		return true
	}
	return true
}

// collectSkymindOutput downloads the finished video. The gateway's /content
// endpoint is preferred (measured byte-identical, no TOS signature expiry);
// content.video_url is the fallback. Provider-observed fields are preserved
// in the Asset metadata for billing and reproducibility.
func (m *MediaService) collectSkymindOutput(jobID, assetID string, taskStatus skymind.VideoTask) error {
	base := ""
	secret := ""
	if db, err := m.database(); err == nil {
		var credentialID string
		if err := db.QueryRow("select credential_id from media_jobs where id = ?", jobID).Scan(&credentialID); err == nil {
			if credential, err := m.credential(credentialID); err == nil {
				base = apiBaseFor(credential)
				secret, _ = m.secret(credential.ID)
			}
		}
	}
	content, err := skymind.FetchVideo(mediaHTTPClient, base, secret, taskStatus.ID)
	if err != nil && taskStatus.VideoURL != "" {
		log.Printf("WARN skymind /content fetch failed job_id=%s: %v; falling back to video_url", jobID, err)
		content, err = fetchMedia(taskStatus.VideoURL)
	}
	if err != nil {
		return err
	}
	if len(content) == 0 {
		return errSkymindVideoOutputMissing
	}
	metadata := map[string]any{
		"providerTaskId": taskStatus.ID,
		"videoUrl":       taskStatus.VideoURL,
	}
	for key, value := range taskStatus.Extra {
		metadata[key] = value
	}
	if taskStatus.Usage != nil {
		metadata["usage"] = taskStatus.Usage
	}
	_, err = m.completePendingAsset(jobID, assetID, content, "video/mp4", metadata)
	return err
}

func (m *MediaService) recordSkymindPollingDiagnostic(jobID, assetID, message string) {
	db, err := m.database()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	_, _ = db.Exec(`update media_assets set metadata_json = json_set(coalesce(metadata_json, '{}'), '$.skymindPollError', ?, '$.skymindPollErrorAt', ?), updated_at = ? where id = ? and job_id = ?`, message, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), assetID, jobID)
}

func (m *MediaService) clearSkymindPollingDiagnostic(jobID, assetID string) {
	db, err := m.database()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	_, _ = db.Exec(`update media_assets set metadata_json = json_remove(coalesce(metadata_json, '{}'), '$.skymindPollError', '$.skymindPollErrorAt'), updated_at = ? where id = ? and job_id = ?`, now.Format(time.RFC3339Nano), assetID, jobID)
}

func skymindOutputString(output map[string]any, fallback string, names ...string) string {
	for _, name := range names {
		if value, ok := output[name].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return fallback
}

func skymindOutputInteger(output map[string]any, fallback int, names ...string) int {
	for _, name := range names {
		value, ok := output[name]
		if !ok {
			continue
		}
		switch v := value.(type) {
		case int:
			return v
		case float64:
			if v == float64(int64(v)) {
				return int(v)
			}
		}
	}
	return fallback
}
