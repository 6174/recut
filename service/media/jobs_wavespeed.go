/*
 * [INPUT]: 依赖任务编排、Asset 持久化、凭据与 WaveSpeed 统一预测协议
 * [OUTPUT]: WaveSpeed 视频提交、短超时 prediction 轮询、输出回收、参考素材发布（图片 data URL /
 *          视频·音频票据上传）、音频结果的真实类型探测，以及提交响应丢失（client timeout /
 *          传输中断）后的「提交结果不确定」识别、历史找回与后台重试恢复（绝不重发付费提交）
 * [POS]: media/jobs 的 WaveSpeed 专属适配层；将已持久化远端 prediction 原位兑现为 Asset
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"recut-service/media/providers/wavespeed"
)

var errWavespeedOutputMissing = errors.New("WaveSpeed completed without an output")

const wavespeedPollInterval = 3 * time.Second

func isWavespeedVideoJob(job MediaJob, credential MediaCredential) bool {
	return job.Capability == VideoGenerate && credential.Provider == "wavespeed"
}

// isWavespeedSpeechJob hits WaveSpeed's asynchronous audio predictions (e.g.
// ByteDance Seed Audio 1.0).
func isWavespeedSpeechJob(job MediaJob, credential MediaCredential) bool {
	return job.Capability == SpeechGenerate && credential.Provider == "wavespeed"
}

// submitWavespeedSpeech mirrors submitWavespeedVideo: submit the prediction,
// bind the queued Asset to running with the prediction ID, then let the poller
// (or the synchronous caller) collect the output.
func (m *MediaService) submitWavespeedSpeech(job MediaJob, credential MediaCredential, pollLocally bool) (MediaJob, error) {
	model, ok := modelByID(job.ModelID)
	if !ok || !model.Available {
		return m.failSubmittedJob(job, errors.New("this provider model adapter is not available yet"))
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	input := wavespeed.GenerateInput{
		Model:  model.APIModelID,
		Prompt: job.Prompt,
		Params: wavespeedSpeechParams(model, job),
	}
	prediction, err := wavespeed.Submit(mediaHTTPClient, apiBaseFor(credential), secret, input)
	if err != nil {
		if requeued, requeueErr := m.requeueWavespeedRateLimit(job, err); requeued {
			return job, requeueErr
		}
		if wavespeedUncertainSubmission(err) {
			return m.recoverUncertainWavespeedSubmission(job, err)
		}
		return m.failSubmittedJob(job, err)
	}
	return m.bindAndTrackWavespeedPrediction(job, credential, secret, prediction, pollLocally)
}

// submitWavespeedVideo runs under the daemon's task lease. Async jobs already
// own a queued Asset; WaveSpeed acceptance promotes that same Asset to running
// and records the prediction ID in one local transaction.
func (m *MediaService) submitWavespeedVideo(job MediaJob, credential MediaCredential, pollLocally bool) (MediaJob, error) {
	model, ok := modelByID(job.ModelID)
	if !ok || !model.Available {
		return m.failSubmittedJob(job, errors.New("this provider model adapter is not available yet"))
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	references, err := m.wavespeedReferenceData(model, credential, secret, job)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	prediction, err := wavespeed.Submit(mediaHTTPClient, apiBaseFor(credential), secret, wavespeed.GenerateInput{
		Model:           model.APIModelID,
		Prompt:          job.Prompt,
		Images:          references.Images,
		Videos:          references.Videos,
		Audios:          references.Audios,
		Params:          providerOutput(model, job.Output),
		ReferenceFields: model.ReferenceFields,
	})
	if err != nil {
		if requeued, requeueErr := m.requeueWavespeedRateLimit(job, err); requeued {
			return job, requeueErr
		}
		if wavespeedUncertainSubmission(err) {
			return m.recoverUncertainWavespeedSubmission(job, err)
		}
		return m.failSubmittedJob(job, err)
	}
	return m.bindAndTrackWavespeedPrediction(job, credential, secret, prediction, pollLocally)
}

// wavespeedUncertainSubmission reports whether a submit failure leaves the
// provider call's outcome unknown. A transport-level failure (client timeout,
// truncated response) can happen after WaveSpeed has already accepted the
// prediction; the submit POST is a paid, non-idempotent call, so converting
// this into a hard failure would orphan a generation the account is charged
// for. Such errors are routed to the recoverable path instead of failing
// outright.
func wavespeedUncertainSubmission(err error) bool {
	if err == nil {
		return false
	}
	// http.Client.Timeout surfaces as a *url.Error implementing net.Error with
	// Timeout() == true; the request was fully sent, so the provider may have
	// received it even though the response never arrived.
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		return true
	}
	return false
}

// recoverUncertainWavespeedSubmission handles a submit whose response was lost
// after the non-replayable checkpoint. It marks the asset recoverable (so the
// UI can still surface a manual retry) and tries to re-attach the paid
// prediction by provider history lookup. It never resubmits.
func (m *MediaService) recoverUncertainWavespeedSubmission(job MediaJob, cause error) (MediaJob, error) {
	if len(job.AssetIDs) != 1 {
		return m.failSubmittedJob(job, cause)
	}
	assetID := job.AssetIDs[0]
	m.failQueuedAssetWith(job.ID, assetID, "WaveSpeed 提交结果不确定，正在尝试恢复远端任务；若恢复失败可重新生成。", map[string]any{submissionUncertainMetadataKey: true})
	if m.recoverWavespeedUnboundTask(job.ID, assetID, job.ModelID) {
		if recovered, err := m.getJob(job.ID); err == nil {
			return recovered, nil
		}
	}
	// The provider may still be creating the prediction the instant the client
	// gave up; retry in the background so a slow accept is not lost.
	m.scheduleWavespeedUncertainRecovery(job.ID, assetID, job.ModelID)
	if failed, err := m.GetJob(job.ID); err == nil {
		return failed, cause
	}
	return job, cause
}

// scheduleWavespeedUncertainRecovery retries the history lookup for a bounded
// window. It stops as soon as the asset is recovered, released, or removed.
func (m *MediaService) scheduleWavespeedUncertainRecovery(jobID, assetID, modelID string) {
	go func() {
		for attempt := 0; attempt < 6; attempt++ {
			if attempt > 0 {
				time.Sleep(time.Duration(attempt) * 5 * time.Second)
			}
			if m.recoverWavespeedUnboundTask(jobID, assetID, modelID) {
				return
			}
			asset, err := m.getAsset(assetID)
			if err != nil || asset.JobID != jobID || asset.RemoteID != "" || asset.Status != "failed" {
				return
			}
		}
	}()
}

// requeueWavespeedRateLimit handles a provider 429: the submission was never
// accepted or billed, so the job must return to a re-claimable queued state
// (clearing the submission checkpoint) instead of failing. It reports whether
// the error was a rate limit and it was requeued.
func (m *MediaService) requeueWavespeedRateLimit(job MediaJob, cause error) (bool, error) {
	var rateLimit wavespeed.RateLimitError
	if !errors.As(cause, &rateLimit) {
		return false, nil
	}
	if len(job.AssetIDs) != 1 {
		return false, nil
	}
	db, err := m.database()
	if err != nil {
		return true, err
	}
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return true, err
	}
	rollback := func(cause error) (bool, error) { _ = tx.Rollback(); return true, cause }
	if _, err := tx.Exec("update media_jobs set status = 'queued', submission_started_at = '', error = ?, updated_at = ? where id = ? and status = 'queued'", rateLimit.Error(), now.Format(time.RFC3339Nano), job.ID); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return true, err
	}
	// Re-arming submission_started_at = '' makes the next scheduler tick
	// re-claim this job; no local Asset state changed, so nothing else to do.
	return true, nil
}

// bindAndTrackWavespeedPrediction checkpoints the prediction ID onto the job and
// its running Asset, then either collects a completed result inline or hands the
// task to durable polling.
func (m *MediaService) bindAndTrackWavespeedPrediction(job MediaJob, credential MediaCredential, secret string, prediction wavespeed.Prediction, pollLocally bool) (MediaJob, error) {
	if strings.TrimSpace(prediction.ID) == "" {
		return m.failSubmittedJob(job, errors.New("WaveSpeed returned a prediction without an ID"))
	}
	var asset MediaAsset
	var err error
	if len(job.AssetIDs) == 1 {
		asset, err = m.bindQueuedRemoteTask(job, job.AssetIDs[0], prediction.ID, prediction.PollURL)
	} else {
		asset, err = m.createRemoteAsset(job, credential.Provider, prediction.ID, prediction.PollURL)
	}
	if err != nil {
		return MediaJob{}, err
	}
	// The prediction ID is known from the moment the provider accepts, so record
	// the upstream task anchor now: the running asset (and its detail panel) can
	// already link out to the provider's task page while generation is still in
	// flight, not only after the bytes land.
	m.recordWavespeedTaskAnchor(job.ID, asset.ID, prediction)
	job, err = m.getJob(job.ID)
	if err != nil {
		return MediaJob{}, err
	}
	if len(job.AssetIDs) == 0 || job.AssetIDs[0] != asset.ID {
		return MediaJob{}, errors.New("running WaveSpeed asset was not linked to its media job")
	}
	if prediction.Failed() {
		m.failRemoteAssetTerminal(job.ID, asset.ID, prediction.FailureMessage())
		return m.getJob(job.ID)
	}
	if prediction.Completed() {
		task := wavespeedTask{job: job, asset: asset, credential: credential, secret: secret, pollURL: prediction.PollURL}
		if err := m.collectWavespeedOutput(task, prediction); err != nil {
			if errors.Is(err, errWavespeedOutputMissing) {
				m.failRemoteAsset(job.ID, asset.ID, err.Error())
			} else if terminal, _ := m.retryWavespeedOutputCollection(task, err); !terminal && pollLocally {
				m.startWavespeedPolling(job.ID)
			}
		}
		return m.getJob(job.ID)
	}
	if pollLocally {
		m.startWavespeedPolling(job.ID)
	}
	return job, nil
}

func (m *MediaService) startWavespeedPolling(jobID string) {
	workerID := "wavespeed-poll:" + jobID
	if _, loaded := m.pollers.LoadOrStore(workerID, struct{}{}); loaded {
		return
	}
	go func() {
		defer m.pollers.Delete(workerID)
		for {
			task, active := m.wavespeedTask(jobID)
			if !active {
				return
			}
			terminal, delay := m.reconcileWavespeedTask(task)
			if terminal {
				return
			}
			time.Sleep(delay)
		}
	}()
}

func (m *MediaService) reconcileWavespeedTask(task wavespeedTask) (bool, time.Duration) {
	// Pending-stage invariant: a submitted task must always expose its provider
	// task URL. Repair it before polling so a lost initial write is recovered.
	m.ensureWavespeedTaskAnchor(task.job.ID, task.asset.ID)
	prediction, err := wavespeed.Poll(atlasPollingHTTPClient, apiBaseFor(task.credential), task.secret, wavespeed.Prediction{ID: task.asset.RemoteID, PollURL: task.pollURL})
	if err != nil {
		attempt, _ := m.recordWavespeedPollingDiagnostic(task.job.ID, task.asset.ID, err.Error())
		return false, wavespeedPollingRetryDelay(attempt)
	}
	if prediction.Failed() {
		m.failRemoteAssetTerminal(task.job.ID, task.asset.ID, prediction.FailureMessage())
		return true, 0
	}
	if !prediction.Completed() {
		m.clearWavespeedPollingDiagnostic(task.job.ID, task.asset.ID)
		return false, wavespeedPollInterval
	}
	if err := m.collectWavespeedOutput(task, prediction); err != nil {
		if errors.Is(err, errWavespeedOutputMissing) {
			m.failRemoteAsset(task.job.ID, task.asset.ID, err.Error())
			return true, 0
		}
		return m.retryWavespeedOutputCollection(task, err)
	}
	return true, 0
}

func (m *MediaService) retryWavespeedOutputCollection(task wavespeedTask, cause error) (bool, time.Duration) {
	attempt, err := m.recordWavespeedPollingDiagnostic(task.job.ID, task.asset.ID, cause.Error())
	if err != nil || attempt < atlasPollingRetryLimit {
		return false, wavespeedPollingRetryDelay(attempt)
	}
	m.failRemoteAsset(task.job.ID, task.asset.ID, fmt.Sprintf("WaveSpeed reconciliation stopped after %d retries: %s", attempt, cause))
	return true, 0
}

func wavespeedPollingRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		return wavespeedPollInterval
	}
	delay := wavespeedPollInterval
	for retry := 1; retry < attempt && delay < 30*time.Second; retry++ {
		delay *= 2
	}
	if delay > 30*time.Second {
		return 30 * time.Second
	}
	return delay
}

type wavespeedTask struct {
	job        MediaJob
	asset      MediaAsset
	credential MediaCredential
	secret     string
	pollURL    string
}

func (m *MediaService) wavespeedTask(jobID string) (wavespeedTask, bool) {
	job, err := m.getJob(jobID)
	if err != nil || job.Status != "running" || job.RemoteID == "" {
		return wavespeedTask{}, false
	}
	db, err := m.database()
	if err != nil {
		return wavespeedTask{}, false
	}
	var credentialID, pollURL string
	if err := db.QueryRow("select credential_id, remote_poll_url from media_jobs where id = ?", job.ID).Scan(&credentialID, &pollURL); err != nil {
		return wavespeedTask{}, false
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where job_id = ?", job.ID))
	if err != nil || asset.Status != "running" || asset.RemoteID == "" {
		return wavespeedTask{}, false
	}
	credential, err := m.credential(credentialID)
	if err != nil || credential.Provider != "wavespeed" {
		return wavespeedTask{}, false
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return wavespeedTask{}, false
	}
	return wavespeedTask{job: job, asset: asset, credential: credential, secret: secret, pollURL: pollURL}, true
}

func (m *MediaService) collectWavespeedOutput(task wavespeedTask, prediction wavespeed.Prediction) error {
	switch task.job.Capability {
	case ImageGenerate:
		url := prediction.FirstOutput()
		if url == "" {
			return errors.New("WaveSpeed image completed without an output URL")
		}
		client := *mediaHTTPClient
		client.Timeout = atlasDownloadTimeout
		content, mimeType, err := fetchMediaDetect(&client, url)
		if err != nil {
			return err
		}
		_, err = m.completePendingAsset(task.job.ID, task.asset.ID, content, mimeType, wavespeedShareMetadata(prediction))
		return err
	case SpeechGenerate:
		url := prediction.AudioURL()
		if url == "" {
			return errWavespeedOutputMissing
		}
		content, err := fetchMedia(url)
		if err != nil {
			return err
		}
		return m.completeWavespeedAudio(task.job.ID, task.asset.ID, content, prediction)
	default:
		url := prediction.VideoURL()
		if url == "" {
			return errWavespeedOutputMissing
		}
		content, err := fetchMedia(url)
		if err != nil {
			return err
		}
		_, err = m.completePendingAsset(task.job.ID, task.asset.ID, content, "video/mp4", wavespeedShareMetadata(prediction))
		return err
	}
}

// wavespeedShareMetadata anchors the asset back to its upstream task so the UI
// can offer a "view on provider" jump. providerTaskId/providerTaskUrl are the
// provider-neutral fields (see assets.RecordGenerationProvenance for the App
// equivalent); for WaveSpeed the dashboard task page is
// https://wavespeed.ai/predictions/{predictionId}.
func wavespeedShareMetadata(prediction wavespeed.Prediction) map[string]any {
	metadata := map[string]any{"providerTaskId": prediction.ID}
	if strings.TrimSpace(prediction.ID) != "" {
		metadata["providerTaskUrl"] = "https://wavespeed.ai/predictions/" + prediction.ID
	}
	if output := prediction.FirstOutput(); output != "" {
		metadata["providerOutputUrl"] = output
	}
	return metadata
}

// recoverWavespeedUnboundTask attempts to re-attach an orphaned WaveSpeed
// submission: when a job crossed the submission checkpoint but the prediction ID
// was never persisted (the submit response was lost), the paid call may still be
// running upstream. Instead of failing the asset — or blindly resubmitting and
// double-billing — list the model's recent predictions in the job's creation
// window and bind the newest match. Returns true when a prediction was found and
// bound.
func (m *MediaService) recoverWavespeedUnboundTask(jobID, assetID, modelID string) bool {
	model, ok := modelByID(modelID)
	if !ok || model.Provider != "wavespeed" || strings.TrimSpace(model.APIModelID) == "" {
		return false
	}
	db, err := m.database()
	if err != nil {
		return false
	}
	var credentialID, created, submissionStarted string
	if err := db.QueryRow("select credential_id, created_at, submission_started_at from media_jobs where id = ?", jobID).Scan(&credentialID, &created, &submissionStarted); err != nil {
		return false
	}
	credential, err := m.credential(credentialID)
	if err != nil || credential.Provider != "wavespeed" {
		return false
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return false
	}
	// Anchor the history window on the non-replayable submit checkpoint when it
	// exists; created_at only bounds jobs that never reached it.
	windowStart := created
	if strings.TrimSpace(submissionStarted) != "" {
		windowStart = submissionStarted
	}
	predictions, err := wavespeed.ListPredictions(mediaHTTPClient, apiBaseFor(credential), secret, model.APIModelID, wavespeedLookupWindowStart(windowStart), 20)
	if err != nil || len(predictions) == 0 {
		return false
	}
	asset, err := m.getAsset(assetID)
	if err != nil || asset.JobID != jobID || asset.RemoteID != "" {
		return false
	}
	prediction, ok := selectUnboundWavespeedPrediction(db, predictions)
	if !ok {
		return false
	}
	bound, err := m.bindRecoveredWavespeedPrediction(jobID, assetID, prediction.ID, prediction.PollURL)
	if err != nil {
		return false
	}
	if prediction.Failed() {
		m.failRemoteAssetTerminal(jobID, assetID, prediction.FailureMessage())
		return true
	}
	if prediction.Completed() {
		task := wavespeedTask{job: MediaJob{ID: jobID, AssetIDs: []string{assetID}, Capability: model.Capability}, asset: bound, credential: credential, secret: secret, pollURL: prediction.PollURL}
		_ = m.collectWavespeedOutput(task, prediction)
		return true
	}
	m.startWavespeedPolling(jobID)
	return true
}

// selectUnboundWavespeedPrediction returns the newest history prediction that is
// not already attached to a local asset or job. Recovery must never bind a
// prediction that belongs to a concurrent submission of the same model, so a
// claimed prediction is skipped in favor of the next candidate.
func selectUnboundWavespeedPrediction(db *sql.DB, predictions []wavespeed.Prediction) (wavespeed.Prediction, bool) {
	for _, prediction := range predictions {
		id := strings.TrimSpace(prediction.ID)
		if id == "" {
			continue
		}
		var claimed int
		if err := db.QueryRow("select (select count(*) from media_assets where remote_id = ?) + (select count(*) from media_jobs where remote_id = ?)", id, id).Scan(&claimed); err != nil {
			continue
		}
		if claimed == 0 {
			return prediction, true
		}
	}
	return wavespeed.Prediction{}, false
}

// bindRecoveredWavespeedPrediction re-attaches a recovered prediction to an
// asset whose uncertain submission was previously marked failed. It clears the
// failed state, the visible error, and the uncertainty flag, and promotes the
// asset and its job to running with the recovered remote handle in one
// transaction so the durable poller can collect it. Unlike
// bindQueuedRemoteTask it accepts a failed asset, because recovery runs long
// after the initial failure was surfaced.
func (m *MediaService) bindRecoveredWavespeedPrediction(jobID, assetID, remoteID, pollURL string) (MediaAsset, error) {
	asset, err := m.getAsset(assetID)
	if err != nil {
		return MediaAsset{}, err
	}
	if asset.JobID != jobID || asset.RemoteID != "" {
		return MediaAsset{}, errors.New("asset changed before recovered prediction binding")
	}
	switch asset.Status {
	case "failed", "queued", "running":
	default:
		return MediaAsset{}, errors.New("asset is not in a recoverable state")
	}
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	delete(metadata, submissionUncertainMetadataKey)
	metadata["providerTaskId"] = remoteID
	metadata["providerTaskUrl"] = "https://wavespeed.ai/predictions/" + remoteID
	serialized, _ := json.Marshal(metadata)
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	result, err := tx.Exec("update media_assets set status = ?, remote_id = ?, remote_poll_url = ?, error = ?, metadata_json = ?, updated_at = ? where id = ? and job_id = ? and remote_id = '' and status in ('failed', 'queued', 'running')", "running", remoteID, pollURL, "", string(serialized), now.Format(time.RFC3339Nano), assetID, jobID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("asset changed before recovered prediction binding"))
	}
	result, err = tx.Exec("update media_jobs set status = ?, remote_id = ?, remote_poll_url = ?, error = ?, updated_at = ? where id = ? and remote_id = '' and status in ('failed', 'queued', 'running')", "running", remoteID, pollURL, "", now.Format(time.RFC3339Nano), jobID)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("job changed before recovered prediction binding"))
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

// wavespeedLookupWindowStart returns an RFC3339 lower bound for the prediction
// history lookup: the job's creation time, backdated a minute to tolerate clock
// skew and the time spent uploading references before the submit.
func wavespeedLookupWindowStart(created string) string {
	parsed, err := time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return ""
	}
	return parsed.Add(-time.Minute).UTC().Format(time.RFC3339)
}

// recordWavespeedTaskAnchor writes the provider task anchor onto a still-running
// asset as soon as the prediction is accepted, so the detail panel can link to
// the upstream task page during generation. The anchor is an invariant of the
// pending stage: once a remote ID exists, the task URL must be visible. When the
// best-effort write fails, ensureWavespeedTaskAnchor retries on the next poll
// instead of leaving a submitted task with no link.
func (m *MediaService) recordWavespeedTaskAnchor(jobID, assetID string, prediction wavespeed.Prediction) {
	if m.writeWavespeedTaskAnchor(jobID, assetID, prediction.ID) {
		return
	}
	m.ensureWavespeedTaskAnchor(jobID, assetID)
}

// ensureWavespeedTaskAnchor re-reads the running asset's remote ID and, when the
// task anchor is missing, repairs it. It is called by the poller before each
// poll so a transient metadata write failure cannot leave a submitted task
// without its provider task URL for the whole pending stage.
func (m *MediaService) ensureWavespeedTaskAnchor(jobID, assetID string) {
	asset, err := m.getAsset(assetID)
	if err != nil || asset.JobID != jobID || asset.Status != "running" || strings.TrimSpace(asset.RemoteID) == "" {
		return
	}
	if url, _ := asset.Metadata["providerTaskUrl"].(string); strings.TrimSpace(url) != "" {
		return
	}
	m.writeWavespeedTaskAnchor(jobID, assetID, asset.RemoteID)
}

// writeWavespeedTaskAnchor persists the provider task anchor onto a running
// asset in one transaction with its change event. It reports whether the anchor
// is now present.
func (m *MediaService) writeWavespeedTaskAnchor(jobID, assetID, predictionID string) bool {
	if strings.TrimSpace(predictionID) == "" {
		return false
	}
	db, err := m.database()
	if err != nil {
		return false
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ?", assetID))
	if err != nil || asset.JobID != jobID || asset.Status != "running" {
		return false
	}
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["providerTaskId"] = predictionID
	metadata["providerTaskUrl"] = "https://wavespeed.ai/predictions/" + predictionID
	serialized, _ := json.Marshal(metadata)
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return false
	}
	if _, err := tx.Exec("update media_assets set metadata_json = ?, updated_at = ? where id = ? and job_id = ? and status = ?", string(serialized), now.Format(time.RFC3339Nano), assetID, jobID, "running"); err != nil {
		_ = tx.Rollback()
		return false
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		_ = tx.Rollback()
		return false
	}
	if err := tx.Commit(); err != nil {
		return false
	}
	m.publishAssetChange()
	return true
}

// completeWavespeedAudio stores an audio prediction result with its real MIME
// type detected from the bytes (WaveSpeed may return wav/mp3/ogg_opus).
func (m *MediaService) completeWavespeedAudio(jobID, assetID string, content []byte, prediction wavespeed.Prediction) error {
	mimeType := detectAudioMime(content, prediction.FirstOutput())
	_, err := m.completePendingAsset(jobID, assetID, content, mimeType, wavespeedShareMetadata(prediction))
	return err
}

type wavespeedReferences struct {
	Images []string
	Videos []string
	Audios []string
}

// wavespeedReferenceData resolves every reference to a form the WaveSpeed API
// accepts. Images are inlined as data URLs (WaveSpeed decodes them without a
// public URL); video/audio references exceed practical inline sizes and are
// published to WaveSpeed's own CDN via multipart upload. URL references pass
// through directly.
func (m *MediaService) wavespeedReferenceData(model MediaModel, credential MediaCredential, secret string, job MediaJob) (wavespeedReferences, error) {
	references := wavespeedReferences{}
	refs, err := m.jobReferences(job)
	if err != nil {
		return wavespeedReferences{}, err
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
			return wavespeedReferences{}, err
		}
		content, mimeType, err := wavespeedAssetContent(asset)
		if err != nil {
			return wavespeedReferences{}, err
		}
		switch asset.Kind {
		case "image":
			references.Images = append(references.Images, "data:"+mimeType+";base64,"+base64.StdEncoding.EncodeToString(content))
		case "video", "audio":
			url, err := wavespeed.UploadMedia(mediaHTTPClient, apiBaseFor(credential), secret, wavespeed.MediaUpload{Name: asset.Name, ContentType: mimeType, Content: content})
			if err != nil {
				return wavespeedReferences{}, fmt.Errorf("reference %q cannot be uploaded: %s", asset.Name, err)
			}
			if asset.Kind == "video" {
				references.Videos = append(references.Videos, url)
			} else {
				references.Audios = append(references.Audios, url)
			}
		}
	}
	return references, nil
}

func wavespeedAssetContent(asset MediaAsset) ([]byte, string, error) {
	path, _ := asset.Metadata["path"].(string)
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, "", fmt.Errorf("reference asset %q cannot be read", asset.ID)
	}
	mimeType := strings.TrimSpace(asset.MimeType)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return content, mimeType, nil
}

// wavespeedSpeechParams maps the platform speech Output onto the WaveSpeed Seed
// Audio request shape. Seed Audio carries the preset voice in the `voice` field
// and exposes output_format/sample_rate/speed/volume/pitch.
func wavespeedSpeechParams(model MediaModel, job MediaJob) map[string]any {
	if strings.Contains(strings.ToLower(model.APIModelID), "seed-audio") {
		params := map[string]any{
			"output_format": outputString(job.Output, "format", "mp3"),
			"sample_rate":   int(outputNumber(job.Output, "sampleRate", 24000)),
		}
		if voice := speechVoiceID(job); voice != "" {
			params["voice"] = voice
		}
		if speed := outputNumber(job.Output, "speed", 0); speed > 0 {
			params["speed"] = speed
		}
		if volume := outputNumber(job.Output, "volume", 0); volume > 0 {
			params["volume"] = volume
		}
		if pitch := outputNumber(job.Output, "pitch", 0); pitch != 0 {
			params["pitch"] = pitch
		}
		return params
	}
	params := map[string]any{}
	for key, value := range job.Output {
		switch key {
		case "voiceId":
			if voice := speechVoiceID(job); voice != "" {
				params["voice"] = voice
			}
		default:
			params[key] = value
		}
	}
	return params
}

// detectAudioMime sniffs the container from content, falling back to the output
// URL extension and finally mp3.
func detectAudioMime(content []byte, url string) string {
	if len(content) >= 12 && string(content[0:4]) == "RIFF" && string(content[8:12]) == "WAVE" {
		return "audio/wav"
	}
	if len(content) >= 4 && string(content[0:4]) == "OggS" {
		return "audio/ogg"
	}
	if len(content) >= 3 && string(content[0:3]) == "ID3" {
		return "audio/mpeg"
	}
	if len(content) >= 2 && content[0] == 0xFF && content[1]&0xE0 == 0xE0 {
		return "audio/mpeg"
	}
	path := strings.ToLower(strings.Split(url, "?")[0])
	switch {
	case strings.HasSuffix(path, ".wav"):
		return "audio/wav"
	case strings.HasSuffix(path, ".ogg"), strings.HasSuffix(path, ".opus"):
		return "audio/ogg"
	case strings.HasSuffix(path, ".flac"):
		return "audio/flac"
	}
	return "audio/mpeg"
}

// The polling diagnostics reuse the shared Atlas counters (one running-task
// poll-error ledger for every remote provider): record increments the retry
// count and surfaces it on the job error; clear removes it once a poll
// succeeds. Both are no-ops when the asset is no longer running.
func (m *MediaService) recordWavespeedPollingDiagnostic(jobID, assetID, message string) (int, error) {
	return m.recordAtlasPollingDiagnostic(jobID, assetID, message)
}

func (m *MediaService) clearWavespeedPollingDiagnostic(jobID, assetID string) {
	m.clearAtlasPollingDiagnostic(jobID, assetID)
}
