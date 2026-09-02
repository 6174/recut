/*
 * [INPUT]: 依赖配置、资产、Provider 策略与 Provider 适配器
 * [OUTPUT]: 生成任务创建、同步执行、终态等待、结果持久化、无 prompt/凭据的状态审计与按策略分派的通用 Provider 调度；图片 job 带参考图时自动切换模型编辑变体；拒绝将 Codex 原生图片路由误送入 Provider
 * [POS]: media 的任务编排层；图片按 Provider ID 从 model_providers 注册表取策略执行，未注册的 OpenAI 协议 Provider 回退 OpenAI 兼容端点；scheduler 位于 jobs_scheduler，由其接管持久化异步任务，Codex 图片由 Agent 自行执行
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
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"recut-service/media/model_providers"
)

const jobColumns = `id, capability, status, prompt, model_id, project_id, reference_ids_json, output_json, asset_ids_json, remote_id, error, created_at, updated_at`

// atlasImagePollRetries bounds how many prediction polls a synchronous image
// strategy may attempt before failing. Image generation is fast relative to
// video, so a modest budget keeps recut.image.generate from blocking for the
// full five-minute mediaRequestTimeout on a stuck remote task.
const atlasImagePollRetries = 40

func (m *MediaService) Generate(input GenerateMediaInput) (MediaJob, error) {
	job, credential, created, err := m.createJob(input)
	if err != nil || !created {
		return job, err
	}
	// Async callers only publish durable work. Provider calls belong to the
	// long-lived daemon: a short-lived MCP/HTTP process can disappear at any
	// point, but the queued Asset keeps the project reference intact.
	kind, mimeType := queuedAssetSpec(job)
	if _, err := m.createQueuedAsset(job, credential.Provider, kind, mimeType); err != nil {
		m.setJobStatus(job.ID, "failed", nil, err.Error())
		if failed, getErr := m.getJob(job.ID); getErr == nil {
			return failed, err
		}
		return job, err
	}
	return m.getJob(job.ID)
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
		if isAtlasVideoJob(job, credential) {
			if job, err = m.submitAtlasVideo(job, credential, true); err != nil {
				return job, err
			}
		} else if isSkymindVideoJob(job, credential) {
			if job, err = m.submitSkymindVideo(job, credential, true); err != nil {
				return job, err
			}
		} else {
			m.execute(job, credential)
		}
	}
	return m.waitForJob(job.ID, mediaRequestTimeout)
}

func (m *MediaService) waitForJob(id string, timeout time.Duration) (MediaJob, error) {
	deadline := time.Now().Add(timeout)
	for {
		job, err := m.getJob(id)
		if err != nil {
			return MediaJob{}, err
		}
		if job.Status == "completed" {
			return job, nil
		}
		if job.Status == "failed" {
			if job.Error == "" {
				job.Error = "media generation did not reach a terminal state"
			}
			return job, fmt.Errorf("media job %s failed: %s", job.ID, job.Error)
		}
		if time.Now().After(deadline) {
			return job, fmt.Errorf("media job %s is still running", job.ID)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// WaitForTerminalJob waits only on Recut's durable local job record. The
// Daemon still owns provider execution, so an Agent can observe a definitive
// result without turning its MCP process into the provider worker.
func (m *MediaService) WaitForTerminalJob(id string, timeout time.Duration) (MediaJob, error) {
	if timeout <= 0 || timeout > mediaRequestTimeout {
		timeout = mediaRequestTimeout
	}
	deadline := time.Now().Add(timeout)
	for {
		job, err := m.getJob(id)
		if err != nil {
			return MediaJob{}, err
		}
		if job.Status == "completed" || job.Status == "failed" || time.Now().After(deadline) {
			return job, nil
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func queuedAssetSpec(job MediaJob) (string, string) {
	switch job.Capability {
	case ImageGenerate:
		return "image", "image/png"
	case SpeechGenerate:
		return "audio", mimeTypeForAudioFormat(outputString(job.Output, "format", "mp3"))
	default:
		return "video", "video/mp4"
	}
}

// normalizedGenerationOutput makes provider defaults explicit at task creation
// time. The saved Job and its Asset metadata therefore preserve the user-visible
// intent even if a provider later changes its own undocumented defaults.
func normalizedGenerationOutput(capability MediaCapability, modelID string, output map[string]any) map[string]any {
	normalized := make(map[string]any, len(output)+1)
	for key, value := range output {
		normalized[key] = value
	}
	model, ok := modelByID(modelID)
	if capability == VideoGenerate && ok && containsOutputMode(model, "generateAudio") {
		if _, present := normalized["generateAudio"]; !present {
			normalized["generateAudio"] = true
		}
	}
	return normalized
}

func containsOutputMode(model MediaModel, mode string) bool {
	for _, supported := range modelOutputFields(model) {
		if supported == mode {
			return true
		}
	}
	return false
}

func (m *MediaService) createJob(input GenerateMediaInput) (MediaJob, MediaCredential, bool, error) {
	if !knownCapability(input.Capability) || strings.TrimSpace(input.Prompt) == "" {
		return MediaJob{}, MediaCredential{}, false, errors.New("capability and prompt are required")
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
	input.Output = normalizedGenerationOutput(input.Capability, input.ModelID, input.Output)
	// 语音必需 voiceId：本地路由缺省用默认音；云端路由缺失则报错。
	if input.Capability == SpeechGenerate {
		if speechVoiceID(MediaJob{Output: input.Output}) == "" {
			if credential.Provider == "local-audio" {
				input.Output["voiceId"] = speechLocalVoiceDefault
			} else {
				return MediaJob{}, MediaCredential{}, false, errors.New("voiceId is required for speech generation")
			}
		}
	}
	normalized, err := m.validateReferences(input)
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	input.References = normalized
	db, err := m.database()
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	if existing, err := m.jobByKey(db, input.IdempotencyKey); err == nil {
		return existing, credential, false, nil
	}
	id, err := newID()
	if err != nil {
		return MediaJob{}, MediaCredential{}, false, err
	}
	now := time.Now().UTC()
	job := MediaJob{ID: id, Capability: input.Capability, Status: "queued", Prompt: input.Prompt, ModelID: route.ModelID, ProjectID: input.ProjectID, References: input.References, ReferenceIDs: input.ReferenceIDs, Output: input.Output, AssetIDs: []string{}, CreatedAt: now, UpdatedAt: now}
	if !input.References.Empty() {
		job.ReferenceIDs = input.References.Flat()
	}
	refs, _ := json.Marshal(job.ReferencesForStorage())
	output, _ := json.Marshal(job.Output)
	assets, _ := json.Marshal(job.AssetIDs)
	_, err = db.Exec(`insert into media_jobs (id, idempotency_key, capability, status, prompt, model_id, credential_id, project_id, reference_ids_json, output_json, asset_ids_json, remote_id, remote_poll_url, error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, job.ID, input.IdempotencyKey, job.Capability, job.Status, job.Prompt, job.ModelID, credential.ID, job.ProjectID, string(refs), string(output), string(assets), "", "", "", now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		// A concurrent submitter (daemon and MCP children share the workspace
		// SQLite file) may have won the idempotency-key race. Return their job
		// instead of failing the duplicate request.
		if existing, lookupErr := m.jobByKey(db, input.IdempotencyKey); lookupErr == nil {
			return existing, credential, false, nil
		}
		return MediaJob{}, MediaCredential{}, false, err
	}
	log.Printf("INFO media job queued job_id=%s project_id=%s capability=%s model_id=%s", job.ID, job.ProjectID, job.Capability, job.ModelID)
	return job, credential, true, nil
}

func (m *MediaService) GetJob(id string) (MediaJob, error) {
	return m.getJob(id)
}

func (m *MediaService) getJob(id string) (MediaJob, error) {
	db, err := m.database()
	if err != nil {
		return MediaJob{}, err
	}
	return scanJob(db.QueryRow("select "+jobColumns+" from media_jobs where id = ?", id))
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
		if route.ModelID == CodexImageModelID {
			return MediaRoute{}, MediaCredential{}, errors.New("image generation is configured for Codex; use Codex native image generation instead of recut.image.generate")
		}
		model, ok := modelByID(route.ModelID)
		if !ok {
			return MediaRoute{}, MediaCredential{}, errors.New("media route model is unknown")
		}
		if provider, ok := providerByID(model.Provider); ok && provider.Protocol == "local" {
			// 本地 provider（Audio Studio 本机 TTS）无需凭据。
			return route, MediaCredential{Provider: model.Provider}, nil
		}
		credential, err := m.credential(route.CredentialID)
		if err != nil {
			return MediaRoute{}, MediaCredential{}, errors.New("media route credential is unavailable")
		}
		if credential.Provider != model.Provider {
			return MediaRoute{}, MediaCredential{}, errors.New("media route model and credential provider do not match")
		}
		return route, credential, nil
	}
	return MediaRoute{}, MediaCredential{}, fmt.Errorf("no route configured for %s", input.Capability)
}

func (m *MediaService) execute(job MediaJob, credential MediaCredential) {
	if len(job.AssetIDs) == 0 {
		m.setJobStatus(job.ID, "running", nil, "")
	}
	model, ok := modelByID(job.ModelID)
	if !ok || !model.Available {
		m.failExecution(job, errors.New("this provider model adapter is not available yet"))
		return
	}
	if job.Capability == ImageGenerate {
		if provider, ok := model_providers.For(credential.Provider); ok {
			secret, err := m.secret(credential.ID)
			if err != nil {
				m.failExecution(job, err)
				return
			}
			asset, err := m.generateImage(job, credential, model, secret, provider)
			if err != nil {
				m.failExecution(job, err)
				return
			}
			m.completeExecution(job, asset)
			return
		}
		if providerUsesOpenAIProtocol(credential.Provider) {
			secret, err := m.secret(credential.ID)
			if err != nil {
				m.failExecution(job, err)
				return
			}
			asset, err := m.generateOpenAIImage(job, credential, model, secret)
			if err != nil {
				m.failExecution(job, err)
				return
			}
			m.completeExecution(job, asset)
			return
		}
		m.failExecution(job, errors.New("this provider image adapter is not available yet"))
		return
	}
	if credential.Provider == "local-audio" {
		// 本机 TTS（Audio Studio / CosyVoice2）：执行经 daemon 注入的本地执行桥；
		// 未注入时给可操作的引导错误，避免把素材伪装成可用。
		if m.localSpeechExec == nil {
			m.failExecution(job, errors.New("local speech route is not connected; install/start Audio Studio or switch the speech default route to a cloud provider in Recut settings"))
			return
		}
		asset, err := m.localSpeechExec(job, model, speechVoiceID(job))
		if err != nil {
			m.failExecution(job, err)
			return
		}
		m.completeExecution(job, asset)
		return
	}
	if job.Capability != SpeechGenerate || (credential.Provider != "minimax" && credential.Provider != "elevenlabs") {
		m.failExecution(job, errors.New("this provider capability adapter is not available yet"))
		return
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		m.failExecution(job, err)
		return
	}
	asset, err := m.generateSpeech(job, credential, model, secret)
	if err != nil {
		m.failExecution(job, err)
		return
	}
	m.completeExecution(job, asset)
}

func (m *MediaService) failExecution(job MediaJob, cause error) {
	if len(job.AssetIDs) == 1 {
		m.failRemoteAsset(job.ID, job.AssetIDs[0], cause.Error())
		return
	}
	m.setJobStatus(job.ID, "failed", nil, cause.Error())
}

func (m *MediaService) completeExecution(job MediaJob, asset MediaAsset) {
	if len(job.AssetIDs) == 1 && job.AssetIDs[0] == asset.ID {
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

// generateImage runs one image job through a registered provider strategy. The
// strategy owns the provider wire protocol (OpenAI-compatible JSON/multipart,
// Atlas native prediction, ...) and returns final bytes for Asset persistence.
func (m *MediaService) generateImage(job MediaJob, credential MediaCredential, model MediaModel, secret string, provider model_providers.Provider) (MediaAsset, error) {
	references, err := m.imageReferences(job)
	if err != nil {
		return MediaAsset{}, err
	}
	apiModelID := model.APIModelID
	if len(references) > 0 && model.EditModelID != "" {
		// Atlas and other providers expose image editing under a separate
		// model variant (…/edit) distinct from text-to-image (…/text-to-image).
		apiModelID = model.EditModelID
	}
	var recordPrediction func(string, string) error
	if len(job.AssetIDs) == 1 {
		assetID := job.AssetIDs[0]
		recordPrediction = func(remoteID, pollURL string) error {
			return m.bindRunningAtlasPrediction(job.ID, assetID, remoteID, pollURL)
		}
	}
	result, err := provider.GenerateImage(model_providers.ImageInput{
		Model:            apiModelID,
		Prompt:           job.Prompt,
		Output:           job.Output,
		References:       references,
		APIBase:          apiBaseFor(credential),
		Secret:           secret,
		HTTPClient:       mediaHTTPClient,
		PollClient:       atlasPollingHTTPClient,
		PollRetries:      atlasImagePollRetries,
		RecordPrediction: recordPrediction,
	})
	if err != nil {
		return MediaAsset{}, err
	}
	return m.saveGeneratedAsset(job, result.Content, "image", result.MimeType, map[string]any{
		"prompt":       job.Prompt,
		"modelId":      job.ModelID,
		"provider":     credential.Provider,
		"capability":   job.Capability,
		"referenceIds": job.ReferenceIDs,
	})
}

// imageReferences decodes a job's image references into the byte form a
// provider strategy consumes. Asset references read the content-addressed
// media store; url references resolve through the unified remote cache. Both
// sources converge on one local file per reference.
func (m *MediaService) imageReferences(job MediaJob) ([]model_providers.ImageReference, error) {
	references := []model_providers.ImageReference{}
	refs, err := m.jobReferences(job)
	if err != nil {
		return nil, err
	}
	for _, ref := range refs {
		if ref.Kind != "image" {
			continue
		}
		filePath, mimeType, name, err := m.referenceFile(ref)
		if err != nil {
			return nil, err
		}
		content, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("reference %q cannot be read", ref.Value)
		}
		references = append(references, model_providers.ImageReference{Kind: ref.Kind, Name: name, MimeType: mimeType, Content: content})
	}
	return references, nil
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
	if err := json.Unmarshal(data, &result); err != nil {
		return MediaAsset{}, fmt.Errorf("MiniMax speech response is invalid: %w", err)
	}
	if result.BaseResp.StatusCode != 0 {
		return MediaAsset{}, fmt.Errorf("MiniMax speech failed (status %d): %s", result.BaseResp.StatusCode, result.BaseResp.StatusMessage)
	}
	if result.Data.Audio == "" {
		return MediaAsset{}, errors.New("MiniMax speech response contained no audio")
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
	refs, err := m.jobReferences(job)
	if err != nil {
		return nil, "", "", err
	}
	for _, ref := range refs {
		filePath, _, name, err := m.referenceFile(ref)
		if err != nil {
			return nil, "", "", err
		}
		file, err := os.Open(filePath)
		if err != nil {
			return nil, "", "", fmt.Errorf("reference %q cannot be read", ref.Value)
		}
		part, err := writer.CreateFormFile("image[]", name)
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
	response.Body = cancelOnClose{ReadCloser: response.Body, cancel: cancel}
	return response, nil
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (body cancelOnClose) Close() error {
	defer body.cancel()
	return body.ReadCloser.Close()
}

// speechLocalVoiceDefault 是本机 TTS（Audio Studio / CosyVoice2）的默认音色 ID。
// 与 audio-studio 的 audio.synthesize 缺省音一致：角色未指定时使用官方默认声音。
const speechLocalVoiceDefault = "__cosyvoice_default__"

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
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if assetIDs == nil {
		if _, err := db.Exec("update media_jobs set status = ?, error = ?, updated_at = ? where id = ?", status, message, now, id); err != nil {
			log.Printf("ERROR media job status update failed job_id=%s status=%s", id, status)
			return
		}
	} else {
		assets, _ := json.Marshal(assetIDs)
		if _, err := db.Exec("update media_jobs set status = ?, asset_ids_json = ?, error = ?, updated_at = ? where id = ?", status, string(assets), message, now, id); err != nil {
			log.Printf("ERROR media job status update failed job_id=%s status=%s", id, status)
			return
		}
	}
	if status == "failed" {
		log.Printf("ERROR media job failed job_id=%s", id)
		return
	}
	log.Printf("INFO media job status changed job_id=%s status=%s", id, status)
}

func (m *MediaService) jobByKey(db *sql.DB, key string) (MediaJob, error) {
	return scanJob(db.QueryRow("select "+jobColumns+" from media_jobs where idempotency_key = ?", key))
}
func scanJob(row mediaScanner) (MediaJob, error) {
	var job MediaJob
	var capability, refs, output, assets, created, updated string
	if err := row.Scan(&job.ID, &capability, &job.Status, &job.Prompt, &job.ModelID, &job.ProjectID, &refs, &output, &assets, &job.RemoteID, &job.Error, &created, &updated); err != nil {
		return MediaJob{}, err
	}
	job.Capability = MediaCapability(capability)
	typedRefs, flatRefs := ParseJobReferences(refs)
	job.References = typedRefs
	job.ReferenceIDs = flatRefs
	_ = json.Unmarshal([]byte(output), &job.Output)
	_ = json.Unmarshal([]byte(assets), &job.AssetIDs)
	job.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	job.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return job, nil
}
