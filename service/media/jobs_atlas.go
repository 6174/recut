/*
 * [INPUT]: 依赖任务编排、Asset 持久化、凭据与 Atlas Provider 协议
 * [OUTPUT]: Atlas 视频提交、短超时 prediction 轮询、输出回收及图/视频/音频参考编码
 * [POS]: media/jobs 的 Atlas 专属适配层；将已持久化远端 prediction 原位兑现为 Asset
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"time"

	"recut-service/media/providers/atlas"
)

var errAtlasVideoOutputMissing = errors.New("Atlas Cloud completed without a video output")

const atlasPollingRetryLimit = 5

func isAtlasVideoJob(job MediaJob, credential MediaCredential) bool {
	return job.Capability == VideoGenerate && credential.Provider == "atlas-cloud"
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

func (m *MediaService) atlasReferenceData(job MediaJob) (atlasReferences, error) {
	references := atlasReferences{}
	for _, id := range job.ReferenceIDs {
		asset, err := m.GetAsset(id)
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
