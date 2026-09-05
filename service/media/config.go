/*
 * [INPUT]: 依赖媒体数据库、模型目录与 Provider HTTP 辅助
 * [OUTPUT]: 凭据、音色、路由与加密密钥管理；Codex 图片路由无需凭据
 * [POS]: media 的配置边界；不处理资产或任务生命周期，原生 Codex 图片仅作为 Agent 选择信号
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (m *MediaService) ListVoices(credentialID string) ([]MediaVoice, error) {
	if credentialID == "local-audio" || credentialID == "" {
		// 本机 TTS：固定返回默认音；用户已验收的声音角色由 audio-studio 的
		// audio.characters 通过其 MCP 面提供，这里只保证平台默认音契约。
		return []MediaVoice{
			{ID: "__cosyvoice_default__", Name: "Audio Studio 默认音", Description: "本机 CosyVoice2 官方默认声音", Provider: "local-audio", Category: "local"},
		}, nil
	}
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
		// 没有动态 voices API 的 provider 优先用模型目录的 per-model voices
		// （如 Atlas 各 TTS 模型 schema 的 voice 枚举，音色随模型走）；
		// 再回退 provider 级 extensions.voices 静态清单（legacy）。
		if voices := catalogModelVoices(credential.Provider); len(voices) > 0 {
			return voices, nil
		}
		if voices, ok := catalogExtensionVoices(credential.Provider); ok {
			return voices, nil
		}
		return nil, fmt.Errorf("provider %q does not expose speech voices", credential.Provider)
	}
}

// catalogModelVoices 汇总 provider 目录中每个语音模型自带的 voices 清单，
// 并给每条音色打上所属平台模型 ID（modelId）——音色集随模型走，UI 按选中模型过滤。
func catalogModelVoices(providerID string) []MediaVoice {
	provider, ok := providerByID(providerID)
	if !ok {
		return nil
	}
	voices := []MediaVoice{}
	for _, model := range provider.Models {
		if model.Capability != SpeechGenerate || !model.Available || !isTextToSpeechModel(model) {
			continue
		}
		for _, voice := range model.Voices {
			if voice.ID == "" {
				continue
			}
			tagged := voice
			tagged.Provider = providerID
			tagged.ModelID = model.ID
			voices = append(voices, tagged)
		}
	}
	return voices
}

// catalogExtensionVoices 读取模型目录中 provider 的 extensions.voices 静态音色清单。
// 清单项契约：{id, name, category?, description?, previewUrl?}；解析失败视为无清单。
func catalogExtensionVoices(providerID string) ([]MediaVoice, bool) {
	provider, ok := providerByID(providerID)
	if !ok {
		return nil, false
	}
	raw, ok := provider.Extensions["voices"]
	if !ok || len(raw) == 0 {
		return nil, false
	}
	var items []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Category    string `json:"category"`
		Description string `json:"description"`
		PreviewURL  string `json:"previewUrl"`
	}
	if err := json.Unmarshal(raw, &items); err != nil || len(items) == 0 {
		return nil, false
	}
	voices := make([]MediaVoice, 0, len(items))
	for _, item := range items {
		if item.ID == "" {
			continue
		}
		voices = append(voices, MediaVoice{ID: item.ID, Name: item.Name, Description: item.Description, Provider: providerID, Category: item.Category, PreviewURL: item.PreviewURL})
	}
	return voices, len(voices) > 0
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
			PreviewURL  string            `json:"preview_url"`
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
		voices = append(voices, MediaVoice{ID: voice.ID, Name: voice.Name, Description: strings.Trim(description, " ·"), Provider: credential.Provider, Category: voice.Category, PreviewURL: voice.PreviewURL})
	}
	return voices, nil
}

func (m *MediaService) ListCredentials() ([]MediaCredential, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, provider, name, api_base, secret_ciphertext, model_overrides_json, created_at, updated_at from media_credentials order by updated_at desc")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MediaCredential{}
	for rows.Next() {
		var item MediaCredential
		var ciphertext, overrides, created, updated string
		if err := rows.Scan(&item.ID, &item.Provider, &item.Name, &item.APIBase, &ciphertext, &overrides, &created, &updated); err != nil {
			return nil, err
		}
		item.SecretSet = ciphertext != ""
		item.APIBase = apiBaseFor(item)
		if strings.TrimSpace(overrides) != "" {
			_ = json.Unmarshal([]byte(overrides), &item.ModelOverrides)
		}
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
	if input.Provider == codexImageProvider.ID {
		return MediaCredential{}, errors.New("Codex native image generation does not use a provider credential")
	}
	_, ok := providerByID(input.Provider)
	if !ok {
		return MediaCredential{}, fmt.Errorf("unknown media provider %q", input.Provider)
	}
	if strings.TrimSpace(secret) == "" {
		return MediaCredential{}, errors.New("API key is required")
	}
	if err := validateModelOverrides(input.Provider, input.ModelOverrides); err != nil {
		return MediaCredential{}, err
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
	input.APIBase = apiBaseFor(input)
	overrides, err := json.Marshal(input.ModelOverrides)
	if err != nil {
		return MediaCredential{}, err
	}
	now := time.Now().UTC()
	input.CreatedAt = now
	input.UpdatedAt = now
	input.SecretSet = true
	db, err := m.database()
	if err != nil {
		return MediaCredential{}, err
	}
	_, err = db.Exec(`insert into media_credentials (id, provider, name, api_base, secret_ciphertext, model_overrides_json, created_at, updated_at)
values (?, ?, ?, ?, ?, ?, ?, ?)
on conflict(id) do update set provider=excluded.provider, name=excluded.name, api_base=excluded.api_base, secret_ciphertext=excluded.secret_ciphertext, model_overrides_json=excluded.model_overrides_json, updated_at=excluded.updated_at`, input.ID, input.Provider, input.Name, strings.TrimRight(input.APIBase, "/"), ciphertext, string(overrides), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	return input, err
}

// DeleteCredential removes a BYOK credential together with every route that
// points at it. Routes are the only references validated against credentials,
// so dropping them in the same transaction keeps the route table consistent.
func (m *MediaService) DeleteCredential(id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("credential id is required")
	}
	db, err := m.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("delete from media_routes where credential_id = ?", id); err != nil {
		return err
	}
	result, err := tx.Exec("delete from media_credentials where id = ?", id)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil || affected == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func apiBaseFor(credential MediaCredential) string {
	if base := strings.TrimSpace(credential.APIBase); base != "" {
		return strings.TrimRight(base, "/")
	}
	provider, _ := providerByID(credential.Provider)
	return strings.TrimRight(provider.DefaultAPIBase, "/")
}

// apiModelIDFor resolves the upstream model ID for one job: credential-level
// override first (gateway model IDs drift with dated releases and channel
// variants), catalog default second.
func apiModelIDFor(model MediaModel, credential MediaCredential) string {
	if override := strings.TrimSpace(credential.ModelOverrides[model.ID]); override != "" {
		return override
	}
	return model.APIModelID
}

// validateModelOverrides keeps credential overrides scoped to their own
// provider so a typo cannot point one provider's request at another protocol.
func validateModelOverrides(provider string, overrides map[string]string) error {
	for modelID, apiModelID := range overrides {
		model, ok := modelByID(modelID)
		if !ok {
			return fmt.Errorf("unknown media model %q in model overrides", modelID)
		}
		if model.Provider != provider {
			return fmt.Errorf("model %q belongs to provider %q, not %q", modelID, model.Provider, provider)
		}
		if strings.TrimSpace(apiModelID) == "" {
			return fmt.Errorf("model override for %q must not be empty", modelID)
		}
	}
	return nil
}

func (m *MediaService) ListRoutes() ([]MediaRoute, error) {
	db, err := m.database()
	if err != nil {
		return nil, err
	}
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
	if model.ID == CodexImageModelID {
		input.CredentialID = ""
		return m.saveRoute(input)
	}
	if provider, ok := providerByID(model.Provider); ok && provider.Protocol == "local" {
		// 本地 provider（如 Audio Studio 本机 TTS）无需凭据：路由可空凭据。
		input.CredentialID = ""
		return m.saveRoute(input)
	}
	credential, err := m.credential(input.CredentialID)
	if err != nil {
		return MediaRoute{}, errors.New("media route credential is unavailable")
	}
	if credential.Provider != model.Provider {
		return MediaRoute{}, errors.New("model must use a credential from the same provider")
	}
	return m.saveRoute(input)
}

func (m *MediaService) saveRoute(input MediaRoute) (MediaRoute, error) {
	if input.ID == "" {
		input.ID = string(input.Capability) + ".default"
	}
	now := time.Now().UTC()
	input.UpdatedAt = now
	db, err := m.database()
	if err != nil {
		return MediaRoute{}, err
	}
	_, err = db.Exec(`insert into media_routes (id, capability, model_id, credential_id, enabled, updated_at) values (?, ?, ?, ?, ?, ?)
on conflict(id) do update set model_id=excluded.model_id, credential_id=excluded.credential_id, enabled=excluded.enabled, updated_at=excluded.updated_at`, input.ID, input.Capability, input.ModelID, input.CredentialID, input.Enabled, now.Format(time.RFC3339Nano))
	return input, err
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
	var ciphertext string
	if err := db.QueryRow("select secret_ciphertext from media_credentials where id = ?", credentialID).Scan(&ciphertext); err != nil {
		return "", err
	}
	return m.decrypt(ciphertext)
}

func (m *MediaService) key() ([]byte, error) {
	path := filepath.Join(m.store.MediaRoot(), "media.key")
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
	if err := os.MkdirAll(m.store.MediaRoot(), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

// SigningKey 返回持久化的 32 字节签名密钥（media.key，缺失时创建）。
// 平台用它为跨 App 能力调用的授权声明签名，提供方可经 ctx.platform.verifyCapabilityGrant 校验。
func (m *MediaService) SigningKey() ([]byte, error) { return m.key() }

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
