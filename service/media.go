/*
 * [INPUT]: 依赖 Store 的工作区 SQLite、受控本地文件根和标准 HTTP 客户端
 * [OUTPUT]: 对外提供按 SHA-256 内容哈希去重的媒体资产、提供商凭据、能力路由、动态音色目录及同步/异步生成任务
 * [POS]: service 的 Media Platform 核心；普通 App 只通过 assetId 和 MCP/HTTP 使用，不持有供应商密钥
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type MediaCapability string

const (
	ImageGenerate  MediaCapability = "image.generate"
	VideoGenerate  MediaCapability = "video.generate"
	SpeechGenerate MediaCapability = "speech.generate"
)

type MediaModel struct {
	ID           string          `json:"id"`
	Provider     string          `json:"provider"`
	Name         string          `json:"name"`
	Capability   MediaCapability `json:"capability"`
	APIModelID   string          `json:"apiModelId"`
	InputModes   []string        `json:"inputModes"`
	Available    bool            `json:"available"`
	Configurable bool            `json:"configurable"`
}

type MediaProvider struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Protocol       string       `json:"protocol"`
	DefaultAPIBase string       `json:"defaultApiBase"`
	Models         []MediaModel `json:"models"`
}
type MediaConfiguration struct {
	Route           MediaRoute    `json:"route"`
	Provider        MediaProvider `json:"provider"`
	Model           MediaModel    `json:"model"`
	CredentialName  string        `json:"credentialName"`
	RequiredInputs  []string      `json:"requiredInputs"`
	OptionalOutputs []string      `json:"optionalOutputs"`
}

type MediaVoice struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Provider    string `json:"provider"`
	Category    string `json:"category,omitempty"`
}

var mediaProviders = []MediaProvider{
	{ID: "atlas-cloud", Name: "Atlas Cloud", Protocol: "openai-compatible", Models: []MediaModel{
		{ID: "atlas-cloud/openai/gpt-image-2", Provider: "atlas-cloud", Name: "GPT Image 2 · 文生图", Capability: ImageGenerate, APIModelID: "openai/gpt-image-2", InputModes: []string{"text"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/bytedance/seedream-v5.0-pro", Provider: "atlas-cloud", Name: "Seedream 5.0 Pro · 文生图", Capability: ImageGenerate, APIModelID: "bytedance/seedream-v5.0-pro", InputModes: []string{"text", "image"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/xai/grok-imagine-image", Provider: "atlas-cloud", Name: "Grok Imagine · 文生图", Capability: ImageGenerate, APIModelID: "xai/grok-imagine-image", InputModes: []string{"text"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/bytedance/seedance-2.0", Provider: "atlas-cloud", Name: "Seedance 2.0 · 文生视频", Capability: VideoGenerate, APIModelID: "bytedance/seedance-2.0", InputModes: []string{"text"}, Configurable: true},
		{ID: "atlas-cloud/bytedance/seedance-2.0-image", Provider: "atlas-cloud", Name: "Seedance 2.0 · 图生视频", Capability: VideoGenerate, APIModelID: "bytedance/seedance-2.0", InputModes: []string{"image"}, Configurable: true},
		{ID: "atlas-cloud/xai/tts-v1", Provider: "atlas-cloud", Name: "xAI TTS v1", Capability: SpeechGenerate, APIModelID: "xai/tts-v1", InputModes: []string{"text"}, Configurable: true},
	}},
	{ID: "openai", Name: "OpenAI", Protocol: "openai", DefaultAPIBase: "https://api.openai.com/v1", Models: []MediaModel{{ID: "openai/gpt-image-2", Provider: "openai", Name: "GPT Image 2", Capability: ImageGenerate, APIModelID: "gpt-image-2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "openai-compatible", Name: "OpenAI Compatible", Protocol: "openai-compatible", Models: []MediaModel{{ID: "openai-compatible/image", Provider: "openai-compatible", Name: "GPT Image 2 · OpenAI-compatible", Capability: ImageGenerate, APIModelID: "gpt-image-2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "gemini", Name: "Google Gemini", Protocol: "gemini", Models: []MediaModel{{ID: "gemini/image", Provider: "gemini", Name: "Gemini Image", Capability: ImageGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}, {ID: "gemini/video", Provider: "gemini", Name: "Gemini Video", Capability: VideoGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}}},
	{ID: "grok", Name: "xAI Grok", Protocol: "xai", Models: []MediaModel{{ID: "grok/image", Provider: "grok", Name: "Grok Image", Capability: ImageGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}, {ID: "grok/video", Provider: "grok", Name: "Grok Video", Capability: VideoGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}}},
	{ID: "elevenlabs", Name: "ElevenLabs", Protocol: "elevenlabs", DefaultAPIBase: "https://api.elevenlabs.io", Models: []MediaModel{{ID: "elevenlabs/eleven-multilingual-v2", Provider: "elevenlabs", Name: "Eleven Multilingual v2", Capability: SpeechGenerate, APIModelID: "eleven_multilingual_v2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "minimax", Name: "MiniMax", Protocol: "minimax", DefaultAPIBase: "https://api.minimaxi.com", Models: []MediaModel{{ID: "minimax/speech-2.8-hd", Provider: "minimax", Name: "MiniMax Speech 2.8 HD", Capability: SpeechGenerate, APIModelID: "speech-2.8-hd", InputModes: []string{"text"}, Available: true, Configurable: true}}},
}

type MediaCredential struct {
	ID        string    `json:"id"`
	Provider  string    `json:"provider"`
	Name      string    `json:"name"`
	APIBase   string    `json:"apiBase"`
	SecretSet bool      `json:"secretSet"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type MediaRoute struct {
	ID           string          `json:"id"`
	Capability   MediaCapability `json:"capability"`
	ModelID      string          `json:"modelId"`
	CredentialID string          `json:"credentialId"`
	Enabled      bool            `json:"enabled"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

type MediaAsset struct {
	ID          string         `json:"id"`
	Kind        string         `json:"kind"`
	Name        string         `json:"name"`
	MimeType    string         `json:"mimeType"`
	SizeBytes   int64          `json:"sizeBytes"`
	ContentHash string         `json:"contentHash"`
	Origin      string         `json:"origin"`
	ProjectIDs  []string       `json:"projectIds"`
	ParentID    string         `json:"parentId,omitempty"`
	Metadata    map[string]any `json:"metadata"`
	CreatedAt   time.Time      `json:"createdAt"`
}

type MediaJob struct {
	ID           string          `json:"id"`
	Capability   MediaCapability `json:"capability"`
	Status       string          `json:"status"`
	Prompt       string          `json:"prompt"`
	ModelID      string          `json:"modelId"`
	ProjectID    string          `json:"projectId,omitempty"`
	ReferenceIDs []string        `json:"referenceIds"`
	Output       map[string]any  `json:"output"`
	AssetIDs     []string        `json:"assetIds"`
	Error        string          `json:"error,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

type GenerateMediaInput struct {
	Capability     MediaCapability `json:"capability"`
	Route          string          `json:"route"`
	ModelID        string          `json:"modelId"`
	CredentialID   string          `json:"credentialId"`
	Prompt         string          `json:"prompt"`
	ReferenceIDs   []string        `json:"referenceIds"`
	Output         map[string]any  `json:"output"`
	ProjectID      string          `json:"projectId"`
	IdempotencyKey string          `json:"idempotencyKey"`
}

type MediaService struct {
	store *Store
	mu    sync.Mutex
}

const mediaRequestTimeout = 2 * time.Minute

const interruptedMediaJobMessage = "本地服务重启前任务未完成，请重新生成。"

var mediaHTTPClient = &http.Client{Timeout: mediaRequestTimeout}

func NewMediaService(store *Store) *MediaService { return &MediaService{store: store} }

func (m *MediaService) database() (*sql.DB, error) { return m.store.WorkspaceDatabase() }

func (m *MediaService) Providers() []MediaProvider {
	return append([]MediaProvider(nil), mediaProviders...)
}

func (m *MediaService) Models() []MediaModel {
	models := []MediaModel{}
	for _, provider := range mediaProviders {
		models = append(models, provider.Models...)
	}
	return models
}

func (m *MediaService) ConfiguredModels() ([]MediaConfiguration, error) {
	routes, err := m.ListRoutes()
	if err != nil {
		return nil, err
	}
	items := []MediaConfiguration{}
	for _, route := range routes {
		if !route.Enabled {
			continue
		}
		model, ok := modelByID(route.ModelID)
		if !ok {
			continue
		}
		provider, _ := providerByID(model.Provider)
		credential, err := m.credential(route.CredentialID)
		if err != nil {
			continue
		}
		items = append(items, MediaConfiguration{Route: route, Provider: provider, Model: model, CredentialName: credential.Name, RequiredInputs: modelInputFields(model.InputModes), OptionalOutputs: outputFields(model.Capability)})
	}
	return items, nil
}

func (m *MediaService) ListVoices(credentialID string) ([]MediaVoice, error) {
	credential, err := m.credential(credentialID)
	if err != nil {
		return nil, errors.New("speech credential is unavailable")
	}
	secret, err := m.secret(credential.ID)
	if err != nil {
		return nil, err
	}
	switch credential.Provider {
	case "minimax":
		return m.listMiniMaxVoices(credential, secret)
	case "elevenlabs":
		return m.listElevenLabsVoices(credential, secret)
	default:
		return nil, fmt.Errorf("provider %q does not expose speech voices", credential.Provider)
	}
}

func (m *MediaService) listMiniMaxVoices(credential MediaCredential, secret string) ([]MediaVoice, error) {
	body := strings.NewReader(`{"voice_type":"all"}`)
	response, err := m.providerRequest(http.MethodPost, credential, secret, "/v1/get_voice", "Bearer ", body)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	result := struct {
		System    []miniMaxVoice `json:"system_voice"`
		Cloning   []miniMaxVoice `json:"voice_cloning"`
		Generated []miniMaxVoice `json:"voice_generation"`
		BaseResp  struct {
			StatusCode    int    `json:"status_code"`
			StatusMessage string `json:"status_msg"`
		} `json:"base_resp"`
	}{}
	if err := json.Unmarshal(data, &result); err != nil || result.BaseResp.StatusCode != 0 {
		return nil, fmt.Errorf("MiniMax voice lookup failed: %s", result.BaseResp.StatusMessage)
	}
	voices := []MediaVoice{}
	for _, group := range []struct {
		category string
		items    []miniMaxVoice
	}{{"system", result.System}, {"voice-cloning", result.Cloning}, {"voice-generation", result.Generated}} {
		for _, voice := range group.items {
			name := voice.Name
			if name == "" {
				name = voice.ID
			}
			voices = append(voices, MediaVoice{ID: voice.ID, Name: name, Description: strings.Join(voice.Description, " · "), Provider: credential.Provider, Category: group.category})
		}
	}
	return voices, nil
}

type miniMaxVoice struct {
	ID          string   `json:"voice_id"`
	Name        string   `json:"voice_name"`
	Description []string `json:"description"`
}

func (m *MediaService) listElevenLabsVoices(credential MediaCredential, secret string) ([]MediaVoice, error) {
	response, err := m.providerRequest(http.MethodGet, credential, secret, "/v1/voices", "", nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	result := struct {
		Voices []struct {
			ID          string            `json:"voice_id"`
			Name        string            `json:"name"`
			Category    string            `json:"category"`
			Description string            `json:"description"`
			Labels      map[string]string `json:"labels"`
		} `json:"voices"`
	}{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	voices := make([]MediaVoice, 0, len(result.Voices))
	for _, voice := range result.Voices {
		description := voice.Description
		if description == "" {
			description = strings.Join([]string{voice.Labels["gender"], voice.Labels["accent"], voice.Labels["use_case"]}, " · ")
		}
		voices = append(voices, MediaVoice{ID: voice.ID, Name: voice.Name, Description: strings.Trim(description, " ·"), Provider: credential.Provider, Category: voice.Category})
	}
	return voices, nil
}

func (m *MediaService) ListCredentials() ([]MediaCredential, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query("select id, provider, name, api_base, secret_ciphertext, created_at, updated_at from media_credentials order by updated_at desc")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MediaCredential{}
	for rows.Next() {
		var item MediaCredential
		var ciphertext, created, updated string
		if err := rows.Scan(&item.ID, &item.Provider, &item.Name, &item.APIBase, &ciphertext, &created, &updated); err != nil {
			return nil, err
		}
		item.SecretSet = ciphertext != ""
		item.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		item.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (m *MediaService) SaveCredential(input MediaCredential, secret string) (MediaCredential, error) {
	if strings.TrimSpace(input.Provider) == "" || strings.TrimSpace(input.Name) == "" {
		return MediaCredential{}, errors.New("provider and name are required")
	}
	provider, ok := providerByID(input.Provider)
	if !ok {
		return MediaCredential{}, fmt.Errorf("unknown media provider %q", input.Provider)
	}
	if strings.TrimSpace(secret) == "" {
		return MediaCredential{}, errors.New("API key is required")
	}
	ciphertext, err := m.encrypt(secret)
	if err != nil {
		return MediaCredential{}, err
	}
	if input.ID == "" {
		input.ID, err = newID()
		if err != nil {
			return MediaCredential{}, err
		}
	}
	if input.APIBase == "" {
		input.APIBase = provider.DefaultAPIBase
	}
	now := time.Now().UTC()
	input.CreatedAt = now
	input.UpdatedAt = now
	input.SecretSet = true
	db, err := m.database()
	if err != nil {
		return MediaCredential{}, err
	}
	defer db.Close()
	_, err = db.Exec(`insert into media_credentials (id, provider, name, api_base, secret_ciphertext, created_at, updated_at)
values (?, ?, ?, ?, ?, ?, ?)
on conflict(id) do update set provider=excluded.provider, name=excluded.name, api_base=excluded.api_base, secret_ciphertext=excluded.secret_ciphertext, updated_at=excluded.updated_at`, input.ID, input.Provider, input.Name, strings.TrimRight(input.APIBase, "/"), ciphertext, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	return input, err
}

func (m *MediaService) ListRoutes() ([]MediaRoute, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query("select id, capability, model_id, credential_id, enabled, updated_at from media_routes order by capability")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MediaRoute{}
	for rows.Next() {
		var item MediaRoute
		var capability, updated string
		var enabled int
		if err := rows.Scan(&item.ID, &capability, &item.ModelID, &item.CredentialID, &enabled, &updated); err != nil {
			return nil, err
		}
		item.Capability = MediaCapability(capability)
		item.Enabled = enabled != 0
		item.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (m *MediaService) SaveRoute(input MediaRoute) (MediaRoute, error) {
	if !knownCapability(input.Capability) || !modelSupports(input.ModelID, input.Capability) {
		return MediaRoute{}, errors.New("model does not support this capability")
	}
	model, _ := modelByID(input.ModelID)
	credential, err := m.credential(input.CredentialID)
	if err != nil {
		return MediaRoute{}, errors.New("media route credential is unavailable")
	}
	if credential.Provider != model.Provider {
		return MediaRoute{}, errors.New("model must use a credential from the same provider")
	}
	if input.ID == "" {
		input.ID = string(input.Capability) + ".default"
	}
	now := time.Now().UTC()
	input.UpdatedAt = now
	db, err := m.database()
	if err != nil {
		return MediaRoute{}, err
	}
	defer db.Close()
	_, err = db.Exec(`insert into media_routes (id, capability, model_id, credential_id, enabled, updated_at) values (?, ?, ?, ?, ?, ?)
on conflict(id) do update set model_id=excluded.model_id, credential_id=excluded.credential_id, enabled=excluded.enabled, updated_at=excluded.updated_at`, input.ID, input.Capability, input.ModelID, input.CredentialID, input.Enabled, now.Format(time.RFC3339Nano))
	return input, err
}

func (m *MediaService) ListAssets(projectID string) ([]MediaAsset, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	query := `select a.id, a.kind, a.name, a.mime_type, a.size_bytes, a.content_hash, a.origin, a.parent_id, a.metadata_json, a.created_at from media_assets a`
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
	row := db.QueryRow("select id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, metadata_json, created_at from media_assets where id = ?", id)
	return scanAsset(db, row)
}

type mediaScanner interface{ Scan(...any) error }

func scanAsset(db *sql.DB, row mediaScanner) (MediaAsset, error) {
	var asset MediaAsset
	var metadataJSON, created string
	if err := row.Scan(&asset.ID, &asset.Kind, &asset.Name, &asset.MimeType, &asset.SizeBytes, &asset.ContentHash, &asset.Origin, &asset.ParentID, &metadataJSON, &created); err != nil {
		return MediaAsset{}, err
	}
	_ = json.Unmarshal([]byte(metadataJSON), &asset.Metadata)
	asset.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
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
	if _, err := m.store.Get(projectID); err != nil {
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
		if _, err := m.store.Get(input.ProjectID); err != nil {
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
	result, err := db.Exec("update media_jobs set status = ?, error = ?, updated_at = ? where status in ('queued', 'running')", "failed", interruptedMediaJobMessage, time.Now().UTC().Format(time.RFC3339Nano))
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

func (m *MediaService) validateReferences(input GenerateMediaInput) error {
	allowed := referenceKindsFor(input.Capability)
	for _, id := range input.ReferenceIDs {
		asset, err := m.GetAsset(id)
		if err != nil {
			return fmt.Errorf("reference asset %q is unavailable", id)
		}
		if !allowed[asset.Kind] {
			return fmt.Errorf("%s cannot use %s as reference context", input.Capability, asset.Kind)
		}
	}
	return nil
}

func referenceKindsFor(capability MediaCapability) map[string]bool {
	if capability == ImageGenerate {
		return map[string]bool{"image": true}
	}
	if capability == VideoGenerate {
		return map[string]bool{"image": true, "audio": true}
	}
	return map[string]bool{}
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
	base := credential.APIBase
	if base == "" {
		base = "https://api.openai.com/v1"
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
	base := credential.APIBase
	if base == "" {
		provider, _ := providerByID(credential.Provider)
		base = provider.DefaultAPIBase
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

func (m *MediaService) saveGeneratedAsset(job MediaJob, content []byte, kind, mimeType string, metadata map[string]any) (MediaAsset, error) {
	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	return m.saveAsset(content, kind, mimeType, "generated-"+id+extensionFor(mimeType), "generated", job.ProjectID, metadata, id)
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

func (m *MediaService) saveAsset(content []byte, kind, mimeType, name, origin, projectID string, metadata map[string]any, id string) (MediaAsset, error) {
	hash := sha256.Sum256(content)
	contentHash := hex.EncodeToString(hash[:])
	if projectID != "" {
		if _, err := m.store.Get(projectID); err != nil {
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
	existing, err := scanAsset(db, db.QueryRow("select id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, metadata_json, created_at from media_assets where content_hash = ?", contentHash))
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
	path := filepath.Join(m.store.root, "media", "assets", contentHash[:2], contentHash+ext)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return MediaAsset{}, err
	}
	if err := os.WriteFile(path, content, 0o600); err != nil && !os.IsExist(err) {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	metadata["path"] = path
	asset := MediaAsset{ID: id, Kind: kind, Name: name, MimeType: mimeType, SizeBytes: int64(len(content)), ContentHash: contentHash, Origin: origin, Metadata: metadata, CreatedAt: now}
	serialized, _ := json.Marshal(metadata)
	_, err = db.Exec("insert into media_assets (id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, metadata_json, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", asset.ID, asset.Kind, asset.Name, asset.MimeType, asset.SizeBytes, asset.ContentHash, asset.Origin, "", string(serialized), now.Format(time.RFC3339Nano))
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

func knownCapability(capability MediaCapability) bool {
	return capability == ImageGenerate || capability == VideoGenerate || capability == SpeechGenerate
}
func modelSupports(id string, capability MediaCapability) bool {
	model, ok := modelByID(id)
	return ok && model.Capability == capability
}
func providerByID(id string) (MediaProvider, bool) {
	for _, provider := range mediaProviders {
		if provider.ID == id {
			return provider, true
		}
	}
	return MediaProvider{}, false
}
func modelByID(id string) (MediaModel, bool) {
	for _, provider := range mediaProviders {
		for _, model := range provider.Models {
			if model.ID == id {
				return model, true
			}
		}
	}
	return MediaModel{}, false
}
func providerUsesOpenAIProtocol(id string) bool {
	provider, ok := providerByID(id)
	return ok && (provider.Protocol == "openai" || provider.Protocol == "openai-compatible")
}
func outputFields(capability MediaCapability) []string {
	switch capability {
	case ImageGenerate:
		return []string{"size", "quality", "background"}
	case VideoGenerate:
		return []string{"durationSeconds", "aspectRatio", "resolution"}
	case SpeechGenerate:
		return []string{"voice", "language", "speed", "format"}
	default:
		return nil
	}
}
func modelInputFields(modes []string) []string {
	fields := []string{}
	for _, mode := range modes {
		switch mode {
		case "text":
			fields = append(fields, "prompt")
		case "image":
			fields = append(fields, "referenceIds")
		case "video":
			fields = append(fields, "sourceVideoAssetId")
		case "audio":
			fields = append(fields, "sourceAudioAssetId")
		}
	}
	return fields
}

func (m *MediaService) credential(id string) (MediaCredential, error) {
	credentials, err := m.ListCredentials()
	if err != nil {
		return MediaCredential{}, err
	}
	for _, credential := range credentials {
		if credential.ID == id {
			return credential, nil
		}
	}
	return MediaCredential{}, sql.ErrNoRows
}
func extensionFor(mimeType string) string {
	if mimeType == "audio/mpeg" {
		return ".mp3"
	}
	extensions, _ := mime.ExtensionsByType(mimeType)
	if len(extensions) > 0 {
		return extensions[0]
	}
	return ".bin"
}

func (m *MediaService) secret(credentialID string) (string, error) {
	db, err := m.database()
	if err != nil {
		return "", err
	}
	defer db.Close()
	var ciphertext string
	if err := db.QueryRow("select secret_ciphertext from media_credentials where id = ?", credentialID).Scan(&ciphertext); err != nil {
		return "", err
	}
	return m.decrypt(ciphertext)
}

func (m *MediaService) key() ([]byte, error) {
	path := filepath.Join(m.store.root, "media.key")
	if key, err := os.ReadFile(path); err == nil {
		if len(key) == 32 {
			return key, nil
		}
		return nil, errors.New("invalid media credential key")
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(m.store.root, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func (m *MediaService) encrypt(value string) (string, error) {
	key, err := m.key()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(value), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (m *MediaService) decrypt(value string) (string, error) {
	key, err := m.key()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted media credential")
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], nil)
	return string(plain), err
}
