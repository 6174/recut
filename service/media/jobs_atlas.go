/*
 * [INPUT]: 依赖任务编排、Asset 持久化、凭据与 Atlas Provider 协议
 * [OUTPUT]: Atlas 视频提交、短超时 prediction 轮询、输出回收及图/视频/音频参考编码
 * [POS]: media/jobs 的 Atlas 专属适配层；将已持久化远端 prediction 原位兑现为 Asset
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"recut-service/media/providers/atlas"
)

var errAtlasVideoOutputMissing = errors.New("Atlas Cloud completed without a video output")

const (
	atlasDownloadAttempts = 5
	// One attempt must finish within this budget; a slow body read retries on
	// a fresh connection instead of holding one for minutes.
	atlasDownloadTimeout = 60 * time.Second
	atlasDownloadDelay   = 2 * time.Second
)

const atlasPollingRetryLimit = 5

func isAtlasVideoJob(job MediaJob, credential MediaCredential) bool {
	return job.Capability == VideoGenerate && credential.Provider == "atlas-cloud"
}

// isAtlasSpeechJob 命中 Atlas Cloud 的异步语音生成（如 xAI TTS v1）。
func isAtlasSpeechJob(job MediaJob, credential MediaCredential) bool {
	return job.Capability == SpeechGenerate && credential.Provider == "atlas-cloud"
}

// submitAtlasSpeech 与 submitAtlasVideo 同构：提交 generateAudio prediction，
// 把排队 Asset 原位绑定为 running 并记录 prediction ID，随后由 poller 或同步调用方回收。
func (m *MediaService) submitAtlasSpeech(job MediaJob, credential MediaCredential, pollLocally bool) (MediaJob, error) {
	model, ok := modelByID(job.ModelID)
	if !ok || !model.Available {
		return m.failSubmittedJob(job, errors.New("this provider model adapter is not available yet"))
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	codec := outputString(job.Output, "codec", "mp3")
	prediction, err := atlas.SubmitSpeech(mediaHTTPClient, apiBaseFor(credential), secret, atlas.SpeechInput{
		Model: model.APIModelID, Text: job.Prompt, Language: outputString(job.Output, "language", "auto"),
		VoiceID: speechVoiceID(job), Codec: codec,
		SampleRate: int(outputNumber(job.Output, "sampleRate", 24000)),
		BitRate:    int(outputNumber(job.Output, "bitRate", 128000)),
		Speed:      outputNumber(job.Output, "speed", 0),
	})
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	var asset MediaAsset
	if len(job.AssetIDs) == 1 {
		asset, err = m.bindQueuedAtlasPrediction(job, job.AssetIDs[0], prediction.ID, prediction.PollURL)
	} else {
		asset, err = m.createRemoteAsset(job, credential.Provider, prediction.ID, prediction.PollURL)
	}
	if err != nil {
		return MediaJob{}, err
	}
	job, err = m.getJob(job.ID)
	if err != nil {
		return MediaJob{}, err
	}
	if prediction.Failed() {
		m.failRemoteAsset(job.ID, asset.ID, prediction.FailureMessage())
		return m.getJob(job.ID)
	}
	if prediction.Completed() {
		task := atlasTask{job: job, asset: asset, credential: credential, secret: secret, pollURL: prediction.PollURL}
		if err := m.collectAtlasOutput(task, prediction); err != nil {
			if terminal, _ := m.retryAtlasOutputCollection(task, err); !terminal && pollLocally {
				m.startAtlasPolling(job.ID)
			}
		}
		return m.getJob(job.ID)
	}
	if pollLocally {
		m.startAtlasPolling(job.ID)
	}
	return job, nil
}

// submitAtlasVideo runs under the daemon's task lease. Async jobs already own
// a queued Asset; Atlas acceptance promotes that same Asset to running and
// records the prediction ID in one local transaction. Synchronous callers do
// not pre-publish an Asset and use the same provider path for compatibility.
func (m *MediaService) submitAtlasVideo(job MediaJob, credential MediaCredential, pollLocally bool) (MediaJob, error) {
	model, ok := modelByID(job.ModelID)
	if !ok || !model.Available {
		return m.failSubmittedJob(job, errors.New("this provider model adapter is not available yet"))
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	references, err := m.atlasReferenceData(job)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	baseURL := apiBaseFor(credential)
	videos, err := uploadAtlasVideos(baseURL, secret, references.Videos)
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	prediction, err := atlas.Submit(mediaHTTPClient, baseURL, secret, atlas.GenerateInput{Model: model.APIModelID, Prompt: job.Prompt, Images: references.Images, Videos: videos, Audios: references.Audios, Output: job.Output})
	if err != nil {
		return m.failSubmittedJob(job, err)
	}
	if prediction.ID == "" {
		return m.failSubmittedJob(job, errors.New("Atlas Cloud returned a prediction without an ID"))
	}
	var asset MediaAsset
	if len(job.AssetIDs) == 1 {
		asset, err = m.bindQueuedAtlasPrediction(job, job.AssetIDs[0], prediction.ID, prediction.PollURL)
	} else {
		asset, err = m.createRemoteAsset(job, credential.Provider, prediction.ID, prediction.PollURL)
	}
	if err != nil {
		return MediaJob{}, err
	}
	job, err = m.getJob(job.ID)
	if err != nil {
		return MediaJob{}, err
	}
	if len(job.AssetIDs) == 0 || job.AssetIDs[0] != asset.ID {
		return MediaJob{}, errors.New("running Atlas asset was not linked to its media job")
	}
	if prediction.Failed() {
		m.failRemoteAsset(job.ID, asset.ID, prediction.FailureMessage())
		return m.getJob(job.ID)
	}
	if prediction.Completed() {
		task := atlasTask{job: job, asset: asset, credential: credential, secret: secret, pollURL: prediction.PollURL}
		if err := m.collectAtlasOutput(task, prediction); err != nil {
			if errors.Is(err, errAtlasVideoOutputMissing) {
				m.failRemoteAsset(job.ID, asset.ID, err.Error())
			} else if terminal, _ := m.retryAtlasOutputCollection(task, err); !terminal && pollLocally {
				m.startAtlasPolling(job.ID)
			}
		}
		return m.getJob(job.ID)
	}
	if pollLocally {
		m.startAtlasPolling(job.ID)
	}
	return job, nil
}

func (m *MediaService) failSubmittedJob(job MediaJob, cause error) (MediaJob, error) {
	if len(job.AssetIDs) == 1 {
		m.failQueuedAsset(job.ID, job.AssetIDs[0], cause.Error())
	} else {
		m.setJobStatus(job.ID, "failed", nil, cause.Error())
	}
	if failed, err := m.GetJob(job.ID); err == nil {
		return failed, cause
	}
	return job, cause
}

func (m *MediaService) startAtlasPolling(jobID string) {
	if _, loaded := m.pollers.LoadOrStore(jobID, struct{}{}); loaded {
		return
	}
	go func() {
		defer m.pollers.Delete(jobID)
		m.pollAtlasJob(jobID)
	}()
}

func (m *MediaService) pollAtlasJob(jobID string) {
	for {
		task, active := m.atlasTask(jobID)
		if !active {
			return
		}
		terminal, delay := m.reconcileAtlasTask(task)
		if terminal {
			return
		}
		time.Sleep(delay)
	}
}

// reconcileAtlasTask advances exactly one Atlas state transition. It returns
// true only once the local Asset reached a terminal result or output retry budget.
func (m *MediaService) reconcileAtlasTask(task atlasTask) (bool, time.Duration) {
	prediction, err := atlas.Poll(atlasPollingHTTPClient, apiBaseFor(task.credential), task.secret, atlas.Prediction{ID: task.asset.RemoteID, PollURL: task.pollURL})
	if err != nil {
		attempt, _ := m.recordAtlasPollingDiagnostic(task.job.ID, task.asset.ID, err.Error())
		return false, atlasPollingRetryDelay(attempt)
	}
	if prediction.Failed() {
		m.failRemoteAsset(task.job.ID, task.asset.ID, prediction.FailureMessage())
		return true, 0
	}
	if !prediction.Completed() {
		m.clearAtlasPollingDiagnostic(task.job.ID, task.asset.ID)
		return false, atlasPollInterval
	}
	if err := m.collectAtlasOutput(task, prediction); err != nil {
		if errors.Is(err, errAtlasVideoOutputMissing) {
			m.failRemoteAsset(task.job.ID, task.asset.ID, err.Error())
			return true, 0
		}
		return m.retryAtlasOutputCollection(task, err)
	}
	return true, 0
}

func (m *MediaService) retryAtlasOutputCollection(task atlasTask, cause error) (bool, time.Duration) {
	attempt, err := m.recordAtlasPollingDiagnostic(task.job.ID, task.asset.ID, cause.Error())
	if err != nil || attempt < atlasPollingRetryLimit {
		return false, atlasPollingRetryDelay(attempt)
	}
	m.failRemoteAsset(task.job.ID, task.asset.ID, fmt.Sprintf("Atlas Cloud reconciliation stopped after %d retries: %s", attempt, cause))
	return true, 0
}

func atlasPollingRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		return atlasPollInterval
	}
	delay := atlasPollInterval
	for retry := 1; retry < attempt && delay < 30*time.Second; retry++ {
		delay *= 2
	}
	if delay > 30*time.Second {
		return 30 * time.Second
	}
	return delay
}

type atlasTask struct {
	job        MediaJob
	asset      MediaAsset
	credential MediaCredential
	secret     string
	pollURL    string
}

func (m *MediaService) atlasTask(jobID string) (atlasTask, bool) {
	job, err := m.getJob(jobID)
	if err != nil || job.Status != "running" || job.RemoteID == "" {
		return atlasTask{}, false
	}
	db, err := m.database()
	if err != nil {
		return atlasTask{}, false
	}
	var credentialID, pollURL string
	if err := db.QueryRow("select credential_id, remote_poll_url from media_jobs where id = ?", job.ID).Scan(&credentialID, &pollURL); err != nil {
		return atlasTask{}, false
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where job_id = ?", job.ID))
	if err != nil || asset.Status != "running" || asset.RemoteID == "" {
		return atlasTask{}, false
	}
	credential, err := m.credential(credentialID)
	if err != nil || credential.Provider != "atlas-cloud" {
		return atlasTask{}, false
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return atlasTask{}, false
	}
	return atlasTask{job: job, asset: asset, credential: credential, secret: secret, pollURL: pollURL}, true
}

func (m *MediaService) collectAtlasOutput(task atlasTask, prediction atlas.Prediction) error {
	if task.job.Capability == SpeechGenerate {
		url := prediction.FirstOutput()
		if url == "" {
			return errAtlasVideoOutputMissing
		}
		content, err := fetchMedia(url)
		if err != nil {
			return err
		}
		_, err = m.completeRemoteAsset(task.job.ID, task.asset.ID, content, "audio/mpeg")
		return err
	}
	url := prediction.VideoURL()
	if url == "" {
		return errAtlasVideoOutputMissing
	}
	content, err := fetchMedia(url)
	if err != nil {
		return err
	}
	_, err = m.completeRemoteAsset(task.job.ID, task.asset.ID, content, "video/mp4")
	return err
}

type atlasReferences struct {
	Images []string
	Videos []atlas.MediaUpload
	Audios []string
}

// atlasReferenceData resolves every reference to provider bytes: asset
// references read the media store, url references flow through the unified
// remote cache (first use downloads, later uses are filesystem hits).
func (m *MediaService) atlasReferenceData(job MediaJob) (atlasReferences, error) {
	references := atlasReferences{}
	refs, err := m.jobReferences(job)
	if err != nil {
		return atlasReferences{}, err
	}
	for _, ref := range refs {
		if ref.Source == "url" {
			filePath, mimeType, name, err := m.referenceFile(ref)
			if err != nil {
				return atlasReferences{}, err
			}
			content, err := os.ReadFile(filePath)
			if err != nil {
				return atlasReferences{}, fmt.Errorf("reference %q cannot be read", ref.Value)
			}
			encoded := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(content)
			switch ref.Kind {
			case "image":
				references.Images = append(references.Images, encoded)
			case "audio":
				references.Audios = append(references.Audios, encoded)
			case "video":
				references.Videos = append(references.Videos, atlas.MediaUpload{Name: name, ContentType: mimeType, Content: content})
			}
			continue
		}
		asset, err := m.GetAsset(ref.Value)
		if err != nil {
			return atlasReferences{}, err
		}
		switch asset.Kind {
		case "image":
			encoded, err := encodeAtlasReference(asset)
			if err != nil {
				return atlasReferences{}, err
			}
			references.Images = append(references.Images, encoded)
		case "video":
			upload, err := atlasUploadReference(asset)
			if err != nil {
				return atlasReferences{}, err
			}
			references.Videos = append(references.Videos, upload)
		case "audio":
			encoded, err := encodeAtlasReference(asset)
			if err != nil {
				return atlasReferences{}, err
			}
			references.Audios = append(references.Audios, encoded)
		}
	}
	return references, nil
}

func encodeAtlasReference(asset MediaAsset) (string, error) {
	content, err := atlasReferenceContent(asset)
	if err != nil {
		return "", err
	}
	return "data:" + asset.MimeType + ";base64," + base64.StdEncoding.EncodeToString(content), nil
}

func atlasUploadReference(asset MediaAsset) (atlas.MediaUpload, error) {
	content, err := atlasReferenceContent(asset)
	if err != nil {
		return atlas.MediaUpload{}, err
	}
	return atlas.MediaUpload{Name: asset.Name, ContentType: asset.MimeType, Content: content}, nil
}

func atlasReferenceContent(asset MediaAsset) ([]byte, error) {
	path, _ := asset.Metadata["path"].(string)
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reference asset %q cannot be read", asset.ID)
	}
	return content, nil
}

func uploadAtlasVideos(baseURL, secret string, uploads []atlas.MediaUpload) ([]string, error) {
	urls := make([]string, 0, len(uploads))
	for _, upload := range uploads {
		url, err := atlas.UploadMedia(mediaHTTPClient, baseURL, secret, upload)
		if err != nil {
			return nil, err
		}
		urls = append(urls, url)
	}
	return urls, nil
}

// bindRunningAtlasPrediction checkpoints the Atlas prediction ID onto an
// already-running image job/asset (activateQueuedTask path) so a failed
// output download can be retried without resubmitting the generation.
func (m *MediaService) bindRunningAtlasPrediction(jobID, assetID, remoteID, pollURL string) error {
	db, err := m.database()
	if err != nil {
		return err
	}
	asset, err := m.getAsset(assetID)
	if err != nil {
		return err
	}
	if asset.JobID != jobID {
		return errors.New("running asset does not belong to this job")
	}
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["atlasPredictionId"] = remoteID
	serialized, _ := json.Marshal(metadata)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	rollback := func(cause error) error { _ = tx.Rollback(); return cause }
	if _, err := tx.Exec("update media_assets set remote_id = ?, remote_poll_url = ?, metadata_json = ?, updated_at = ? where id = ? and status = 'running' and remote_id = ''", remoteID, pollURL, string(serialized), now, assetID); err != nil {
		return rollback(err)
	}
	if _, err := tx.Exec("update media_jobs set remote_id = ?, remote_poll_url = ?, updated_at = ? where id = ? and status = 'running' and remote_id = ''", remoteID, pollURL, now, jobID); err != nil {
		return rollback(err)
	}
	return tx.Commit()
}

// RetryAssetDownload re-collects the output of a failed generated asset whose
// remote prediction may already be completed (e.g. the image download timed
// out after Atlas Cloud finished). The remote task itself is never resubmitted.
func (m *MediaService) RetryAssetDownload(assetID string) (MediaAsset, error) {
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ?", assetID))
	if err != nil {
		return MediaAsset{}, err
	}
	if asset.Status != "failed" {
		return MediaAsset{}, errors.New("只有失败的素材可以重新下载")
	}
	if asset.JobID == "" {
		return MediaAsset{}, errors.New("该素材没有关联的生成任务")
	}
	job, err := m.getJob(asset.JobID)
	if err != nil {
		return MediaAsset{}, err
	}
	if job.RemoteID == "" || !strings.HasPrefix(job.ModelID, "atlas-cloud/") {
		return MediaAsset{}, errors.New("该任务没有可恢复的远端输出")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if _, err := tx.Exec("update media_assets set status = 'running', error = '', updated_at = ? where id = ? and status = 'failed'", now, asset.ID); err != nil {
		return rollback(err)
	}
	if _, err := tx.Exec("update media_jobs set status = 'running', error = '', updated_at = ? where id = ? and status = 'failed'", now, job.ID); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	task, ok := m.atlasTask(job.ID)
	if !ok {
		cause := errors.New("远端任务暂不可恢复，请稍后重试")
		m.failRemoteAsset(job.ID, asset.ID, cause.Error())
		return MediaAsset{}, cause
	}
	content, mimeType, err := m.redownloadAtlasOutput(task)
	if err != nil {
		m.failRemoteAsset(job.ID, asset.ID, err.Error())
		return MediaAsset{}, err
	}
	return m.completeRemoteAsset(job.ID, asset.ID, content, mimeType)
}

// redownloadAtlasOutput re-fetches a completed prediction's output with
// bounded retries. Only transport errors and 5xx responses retry; 3xx/4xx
// failures are terminal.
func (m *MediaService) redownloadAtlasOutput(task atlasTask) ([]byte, string, error) {
	prediction, err := atlas.Poll(atlasPollingHTTPClient, apiBaseFor(task.credential), task.secret, atlas.Prediction{ID: task.asset.RemoteID, PollURL: task.pollURL})
	if err != nil {
		return nil, "", err
	}
	if prediction.Failed() {
		return nil, "", errors.New("Atlas Cloud image generation failed: " + prediction.FailureMessage())
	}
	if !prediction.Completed() {
		return nil, "", errors.New("Atlas Cloud prediction is not completed yet")
	}
	url := prediction.FirstOutput()
	if url == "" {
		return nil, "", errors.New("Atlas Cloud prediction completed without an output URL")
	}
	var lastErr error
	for attempt := 0; attempt < atlasDownloadAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(atlasDownloadDelay)
		}
		client := *mediaHTTPClient
		client.Timeout = atlasDownloadTimeout
		content, mimeType, err := fetchMediaDetect(&client, url)
		if err == nil {
			return content, mimeType, nil
		}
		lastErr = err
		if strings.HasPrefix(err.Error(), "media download returned 2") || strings.HasPrefix(err.Error(), "media download returned 3") || strings.HasPrefix(err.Error(), "media download returned 4") {
			return nil, "", err
		}
	}
	return nil, "", lastErr
}

func fetchMediaDetect(client *http.Client, url string) ([]byte, string, error) {
	response, err := client.Get(url)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("media download returned %s", response.Status)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, 128<<20))
	if err != nil {
		return nil, "", err
	}
	mimeType := strings.TrimSpace(response.Header.Get("Content-Type"))
	if mimeType == "" || strings.HasPrefix(mimeType, "application/octet-stream") {
		mimeType = http.DetectContentType(content)
	}
	return content, mimeType, nil
}
