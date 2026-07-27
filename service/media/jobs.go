/*
 * [INPUT]: 依赖配置、资产与 Provider 适配器
 * [OUTPUT]: 生成任务创建、执行、状态恢复和结果持久化
 * [POS]: media 的任务编排层；不持有配置或资产存储实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"recut-service/media/providers/atlas"
)

func (m *MediaService) Generate(input GenerateMediaInput) (MediaJob, error) {
	job, credential, created, err := m.createJob(input)
	if err != nil || !created {
		return job, err
	}
	go m.execute(job, credential)
	return job, nil
}

// GenerateSync is for short, stage-critical media operations. It waits for the
// provider request to finish, so callers receive either usable asset IDs or a
// terminal error instead of owning a polling loop.
func (m *MediaService) GenerateSync(input GenerateMediaInput) (MediaJob, error) {
	job, credential, created, err := m.createJob(input)
	if err != nil {
		return MediaJob{}, err
	}
	if created {
		m.execute(job, credential)
	}
	job, err = m.GetJob(job.ID)
	if err != nil {
		return MediaJob{}, err
	}
	if job.Status != "completed" {
		if job.Error == "" {
			job.Error = "media generation did not reach a terminal state"
		}
		return job, fmt.Errorf("media job %s failed: %s", job.ID, job.Error)
	}
	return job, nil
}

func (m *MediaService) createJob(input GenerateMediaInput) (MediaJob, MediaCredential, bool, error) {
	if !knownCapability(input.Capability) || strings.TrimSpace(input.Prompt) == "" {
		return MediaJob{}, MediaCredential{}, false, errors.New("capability and prompt are required")
	}
	if input.Capability == SpeechGenerate && speechVoiceID(MediaJob{Output: input.Output}) == "" {
		return MediaJob{}, MediaCredential{}, false, errors.New("voiceId is required for speech generation")
	}
	if input.ProjectID != "" {
		if _, err := projectExists(m.store, input.ProjectID); err != nil {
			return MediaJob{}, MediaCredential{}, false, err
		}
	}
	if input.IdempotencyKey == "" {
		input.IdempotencyKey, _ = newID()
	}
	route, credential, err := m.resolveRoute(input)
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	input.ModelID = route.ModelID
	if err := m.validateReferences(input); err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	db, err := m.database()
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	defer db.Close()
	if existing, err := m.jobByKey(db, input.IdempotencyKey); err == nil {
		return existing, credential, false, nil
	}
	id, err := newID()
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	now := time.Now().UTC()
	job := MediaJob{ID: id, Capability: input.Capability, Status: "queued", Prompt: input.Prompt, ModelID: route.ModelID, ProjectID: input.ProjectID, ReferenceIDs: input.ReferenceIDs, Output: input.Output, CreatedAt: now, UpdatedAt: now}
	refs, _ := json.Marshal(job.ReferenceIDs)
	output, _ := json.Marshal(job.Output)
	assets, _ := json.Marshal(job.AssetIDs)
	_, err = db.Exec(`insert into media_jobs (id, idempotency_key, capability, status, prompt, model_id, credential_id, project_id, reference_ids_json, output_json, asset_ids_json, error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, job.ID, input.IdempotencyKey, job.Capability, job.Status, job.Prompt, job.ModelID, credential.ID, job.ProjectID, string(refs), string(output), string(assets), "", now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	return job, credential, true, nil
}

func (m *MediaService) GetJob(id string) (MediaJob, error) {
	db, err := m.database()
	if err != nil {
		return MediaJob{}, err
	}
	defer db.Close()
	return scanJob(db.QueryRow("select id, capability, status, prompt, model_id, project_id, reference_ids_json, output_json, asset_ids_json, error, created_at, updated_at from media_jobs where id = ?", id))
}

// RecoverInterruptedJobs closes jobs whose in-memory workers were lost during
// a local service restart. A job is immutable once submitted, so retrying it
// silently would create an unexpected second image; the caller must submit a
// new generation explicitly.
func (m *MediaService) RecoverInterruptedJobs() (int64, error) {
	db, err := m.database()
	if err != nil {
		return 0, err
	}
	defer db.Close()
	result, err := db.Exec("update media_jobs set status = ?, error = ?, updated_at = ? where status in ('queued', 'running')", "failed", InterruptedMediaJobMessage, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (m *MediaService) resolveRoute(input GenerateMediaInput) (MediaRoute, MediaCredential, error) {
	if input.ModelID != "" || input.CredentialID != "" {
		if input.ModelID == "" || input.CredentialID == "" {
			return MediaRoute{}, MediaCredential{}, errors.New("modelId and credentialId must be supplied together")
		}
		model, ok := modelByID(input.ModelID)
		if !ok || model.Capability != input.Capability {
			return MediaRoute{}, MediaCredential{}, errors.New("media model is unavailable for this capability")
		}
		credential, err := m.credential(input.CredentialID)
		if err != nil || credential.Provider != model.Provider {
			return MediaRoute{}, MediaCredential{}, errors.New("media model and credential provider do not match")
		}
		return MediaRoute{ID: "direct", Capability: input.Capability, ModelID: model.ID, CredentialID: credential.ID, Enabled: true}, credential, nil
	}
	routes, err := m.ListRoutes()
	if err != nil {
		return MediaRoute{}, MediaCredential{}, err
	}
	routeID := input.Route
	if routeID == "" {
		routeID = string(input.Capability) + ".default"
	}
	for _, route := range routes {
		if route.ID != routeID {
			continue
		}
		if !route.Enabled || route.Capability != input.Capability {
			return MediaRoute{}, MediaCredential{}, errors.New("media route is unavailable")
		}
		credential, err := m.credential(route.CredentialID)
		if err != nil {
			return MediaRoute{}, MediaCredential{}, errors.New("media route credential is unavailable")
		}
		model, _ := modelByID(route.ModelID)
		if credential.Provider != model.Provider {
			return MediaRoute{}, MediaCredential{}, errors.New("media route model and credential provider do not match")
		}
		return route, credential, nil
	}
	return MediaRoute{}, MediaCredential{}, fmt.Errorf("no route configured for %s", input.Capability)
}

func (m *MediaService) execute(job MediaJob, credential MediaCredential) {
	m.setJobStatus(job.ID, "running", nil, "")
	model, ok := modelByID(job.ModelID)
	if !ok || !model.Available {
		m.setJobStatus(job.ID, "failed", nil, "this provider model adapter is not available yet")
		return
	}
	if job.Capability == ImageGenerate && providerUsesOpenAIProtocol(credential.Provider) {
		secret, err := m.secret(credential.ID)
		if err != nil {
			m.setJobStatus(job.ID, "failed", nil, err.Error())
			return
		}
		asset, err := m.generateOpenAIImage(job, credential, model, secret)
		if err != nil {
			m.setJobStatus(job.ID, "failed", nil, err.Error())
			return
		}
		m.setJobStatus(job.ID, "completed", []string{asset.ID}, "")
		return
	}
	if job.Capability == VideoGenerate && credential.Provider == "atlas-cloud" {
		secret, err := m.secret(credential.ID)
		if err != nil {
			m.setJobStatus(job.ID, "failed", nil, err.Error())
			return
		}
		asset, err := m.generateAtlasVideo(job, credential, model, secret)
		if err != nil {
			m.setJobStatus(job.ID, "failed", nil, err.Error())
			return
		}
		m.setJobStatus(job.ID, "completed", []string{asset.ID}, "")
		return
	}
	if job.Capability != SpeechGenerate || (credential.Provider != "minimax" && credential.Provider != "elevenlabs") {
		m.setJobStatus(job.ID, "failed", nil, "this provider capability adapter is not available yet")
		return
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		m.setJobStatus(job.ID, "failed", nil, err.Error())
		return
	}
	asset, err := m.generateSpeech(job, credential, model, secret)
	if err != nil {
		m.setJobStatus(job.ID, "failed", nil, err.Error())
		return
	}
	m.setJobStatus(job.ID, "completed", []string{asset.ID}, "")
}

func (m *MediaService) generateOpenAIImage(job MediaJob, credential MediaCredential, model MediaModel, secret string) (MediaAsset, error) {
	base := apiBaseFor(credential)
	if base == "" {
		return MediaAsset{}, fmt.Errorf("%s API address is required", credential.Provider)
	}
	body, contentType, endpoint, err := m.openAIImageBody(job, model)
	if err != nil {
		return MediaAsset{}, err
	}
	requestContext, cancel := context.WithTimeout(context.Background(), mediaRequestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestContext, http.MethodPost, strings.TrimRight(base, "/")+endpoint, body)
	if err != nil {
		return MediaAsset{}, err
	}
	request.Header.Set("Authorization", "Bearer "+secret)
	request.Header.Set("Content-Type", contentType)
	response, err := mediaHTTPClient.Do(request)
	if err != nil {
		return MediaAsset{}, err
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return MediaAsset{}, fmt.Errorf("provider returned %s: %s", response.Status, string(responseBody))
	}
	result := struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}{}
	if err := json.Unmarshal(responseBody, &result); err != nil || len(result.Data) == 0 {
		return MediaAsset{}, errors.New("provider returned no image")
	}
	image := result.Data[0]
	var content []byte
	if image.B64JSON != "" {
		content, err = base64.StdEncoding.DecodeString(image.B64JSON)
	} else if image.URL != "" {
		content, err = fetchMedia(image.URL)
	} else {
		err = errors.New("provider returned no image data")
	}
	if err != nil {
		return MediaAsset{}, err
	}
	return m.saveGeneratedAsset(job, content, "image", "image/png", map[string]any{
		"prompt":       job.Prompt,
		"modelId":      job.ModelID,
		"provider":     credential.Provider,
		"capability":   job.Capability,
		"referenceIds": job.ReferenceIDs,
	})
}

func (m *MediaService) generateAtlasVideo(job MediaJob, credential MediaCredential, model MediaModel, secret string) (MediaAsset, error) {
	references, err := m.atlasReferenceData(job)
	if err != nil {
		return MediaAsset{}, err
	}
	baseURL := apiBaseFor(credential)
	videos, err := uploadAtlasVideos(baseURL, secret, references.Videos)
	if err != nil {
		return MediaAsset{}, err
	}
	result, err := atlas.Generate(mediaHTTPClient, baseURL, secret, atlas.GenerateInput{Model: model.APIModelID, Prompt: job.Prompt, Images: references.Images, Videos: videos, Audios: references.Audios, Output: job.Output}, mediaRequestTimeout)
	if err != nil {
		return MediaAsset{}, err
	}
	content, err := fetchMedia(result.VideoURL)
	if err != nil {
		return MediaAsset{}, err
	}
	return m.saveGeneratedAsset(job, content, "video", "video/mp4", map[string]any{"prompt": job.Prompt, "modelId": job.ModelID, "provider": credential.Provider, "capability": job.Capability, "referenceIds": job.ReferenceIDs, "atlasPredictionId": result.PredictionID})
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

func (m *MediaService) generateSpeech(job MediaJob, credential MediaCredential, model MediaModel, secret string) (MediaAsset, error) {
	if credential.Provider == "minimax" {
		return m.generateMiniMaxSpeech(job, credential, model, secret)
	}
	return m.generateElevenLabsSpeech(job, credential, model, secret)
}

func (m *MediaService) generateMiniMaxSpeech(job MediaJob, credential MediaCredential, model MediaModel, secret string) (MediaAsset, error) {
	voiceID := speechVoiceID(job)
	if voiceID == "" {
		return MediaAsset{}, errors.New("voiceId is required for speech generation")
	}
	format := outputString(job.Output, "format", "mp3")
	payload := map[string]any{"model": model.APIModelID, "text": job.Prompt, "stream": false, "output_format": "hex", "voice_setting": map[string]any{"voice_id": voiceID, "speed": outputNumber(job.Output, "speed", 1), "vol": outputNumber(job.Output, "volume", 1), "pitch": outputNumber(job.Output, "pitch", 0)}, "audio_setting": map[string]any{"format": format, "sample_rate": int(outputNumber(job.Output, "sampleRate", 32000)), "bitrate": int(outputNumber(job.Output, "bitrate", 128000)), "channel": int(outputNumber(job.Output, "channel", 1))}}
	if emotion := outputString(job.Output, "emotion", ""); emotion != "" {
		payload["voice_setting"].(map[string]any)["emotion"] = emotion
	}
	body, _ := json.Marshal(payload)
	response, err := m.providerRequest(http.MethodPost, credential, secret, "/v1/t2a_v2", "Bearer ", bytes.NewReader(body))
	if err != nil {
		return MediaAsset{}, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return MediaAsset{}, fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	result := struct {
		Data struct {
			Audio string `json:"audio"`
		} `json:"data"`
		BaseResp struct {
			StatusCode    int    `json:"status_code"`
			StatusMessage string `json:"status_msg"`
		} `json:"base_resp"`
	}{}
	if err := json.Unmarshal(data, &result); err != nil || result.BaseResp.StatusCode != 0 || result.Data.Audio == "" {
		return MediaAsset{}, fmt.Errorf("MiniMax speech failed: %s", result.BaseResp.StatusMessage)
	}
	audio, err := hex.DecodeString(result.Data.Audio)
	if err != nil {
		return MediaAsset{}, err
	}
	return m.saveGeneratedAsset(job, audio, "audio", mimeTypeForAudioFormat(format), map[string]any{"prompt": job.Prompt, "modelId": job.ModelID, "provider": credential.Provider, "capability": job.Capability, "voiceId": voiceID})
}

func (m *MediaService) generateElevenLabsSpeech(job MediaJob, credential MediaCredential, model MediaModel, secret string) (MediaAsset, error) {
	voiceID := speechVoiceID(job)
	if voiceID == "" {
		return MediaAsset{}, errors.New("voiceId is required for speech generation")
	}
	format := outputString(job.Output, "format", "mp3_44100_128")
	payload := map[string]any{"text": job.Prompt, "model_id": model.APIModelID, "voice_settings": map[string]any{"speed": outputNumber(job.Output, "speed", 1), "stability": outputNumber(job.Output, "stability", 0.5), "similarity_boost": outputNumber(job.Output, "similarityBoost", 0.75), "style": outputNumber(job.Output, "style", 0)}}
	body, _ := json.Marshal(payload)
	response, err := m.providerRequest(http.MethodPost, credential, secret, "/v1/text-to-speech/"+voiceID+"?output_format="+format, "", bytes.NewReader(body))
	if err != nil {
		return MediaAsset{}, err
	}
	defer response.Body.Close()
	audio, _ := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return MediaAsset{}, fmt.Errorf("provider returned %s: %s", response.Status, string(audio))
	}
	return m.saveGeneratedAsset(job, audio, "audio", mimeTypeForAudioFormat(format), map[string]any{"prompt": job.Prompt, "modelId": job.ModelID, "provider": credential.Provider, "capability": job.Capability, "voiceId": voiceID})
}

func (m *MediaService) openAIImageBody(job MediaJob, model MediaModel) (io.Reader, string, string, error) {
	payload := map[string]any{"model": model.APIModelID, "prompt": job.Prompt, "n": 1, "response_format": "b64_json"}
	for _, key := range []string{"size", "quality", "background"} {
		if value, ok := job.Output[key]; ok {
			payload[key] = value
		}
	}
	if len(job.ReferenceIDs) == 0 {
		body, _ := json.Marshal(payload)
		return bytes.NewReader(body), "application/json", "/images/generations", nil
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range payload {
		if err := writer.WriteField(key, fmt.Sprint(value)); err != nil {
			return nil, "", "", err
		}
	}
	for _, id := range job.ReferenceIDs {
		asset, err := m.GetAsset(id)
		if err != nil {
			return nil, "", "", err
		}
		path, _ := asset.Metadata["path"].(string)
		file, err := os.Open(path)
		if err != nil {
			return nil, "", "", fmt.Errorf("reference asset %q cannot be read", id)
		}
		part, err := writer.CreateFormFile("image[]", asset.Name)
		if err == nil {
			_, err = io.Copy(part, file)
		}
		closeErr := file.Close()
		if err != nil {
			return nil, "", "", err
		}
		if closeErr != nil {
			return nil, "", "", closeErr
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", "", err
	}
	return &body, writer.FormDataContentType(), "/images/edits", nil
}

func (m *MediaService) providerRequest(method string, credential MediaCredential, secret, endpoint, authorizationPrefix string, body io.Reader) (*http.Response, error) {
	base := apiBaseFor(credential)
	if base == "" {
		return nil, fmt.Errorf("%s API address is required", credential.Provider)
	}
	requestContext, cancel := context.WithTimeout(context.Background(), mediaRequestTimeout)
	request, err := http.NewRequestWithContext(requestContext, method, strings.TrimRight(base, "/")+endpoint, body)
	if err != nil {
		cancel()
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if credential.Provider == "elevenlabs" {
		request.Header.Set("xi-api-key", secret)
	} else {
		request.Header.Set("Authorization", authorizationPrefix+secret)
	}
	response, err := mediaHTTPClient.Do(request)
	if err != nil {
		cancel()
		return nil, err
	}
	return response, nil
}

func speechVoiceID(job MediaJob) string { return outputString(job.Output, "voiceId", "") }

func outputString(output map[string]any, key, fallback string) string {
	if value, ok := output[key].(string); ok && strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func outputNumber(output map[string]any, key string, fallback float64) float64 {
	if value, ok := output[key].(float64); ok {
		return value
	}
	return fallback
}

func mimeTypeForAudioFormat(format string) string {
	if strings.HasPrefix(format, "wav") {
		return "audio/wav"
	}
	if strings.HasPrefix(format, "opus") {
		return "audio/ogg"
	}
	if strings.HasPrefix(format, "flac") {
		return "audio/flac"
	}
	return "audio/mpeg"
}

func fetchMedia(url string) ([]byte, error) {
	response, err := mediaHTTPClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("media download returned %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 128<<20))
}

func (m *MediaService) setJobStatus(id, status string, assetIDs []string, message string) {
	db, err := m.database()
	if err != nil {
		return
	}
	defer db.Close()
	assets, _ := json.Marshal(assetIDs)
	_, _ = db.Exec("update media_jobs set status = ?, asset_ids_json = ?, error = ?, updated_at = ? where id = ?", status, string(assets), message, time.Now().UTC().Format(time.RFC3339Nano), id)
}

func (m *MediaService) jobByKey(db *sql.DB, key string) (MediaJob, error) {
	return scanJob(db.QueryRow("select id, capability, status, prompt, model_id, project_id, reference_ids_json, output_json, asset_ids_json, error, created_at, updated_at from media_jobs where idempotency_key = ?", key))
}
func scanJob(row mediaScanner) (MediaJob, error) {
	var job MediaJob
	var capability, refs, output, assets, created, updated string
	if err := row.Scan(&job.ID, &capability, &job.Status, &job.Prompt, &job.ModelID, &job.ProjectID, &refs, &output, &assets, &job.Error, &created, &updated); err != nil {
		return MediaJob{}, err
	}
	job.Capability = MediaCapability(capability)
	_ = json.Unmarshal([]byte(refs), &job.ReferenceIDs)
	_ = json.Unmarshal([]byte(output), &job.Output)
	_ = json.Unmarshal([]byte(assets), &job.AssetIDs)
	job.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	job.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return job, nil
}
