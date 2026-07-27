/*
 * [INPUT]: 依赖媒体数据库、模型目录与 Provider HTTP 辅助
 * [OUTPUT]: 凭据、音色、路由与加密密钥管理
 * [POS]: media 的配置边界；不处理资产或任务生命周期
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
		item.APIBase = apiBaseFor(item)
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
	_, ok := providerByID(input.Provider)
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
	input.APIBase = apiBaseFor(input)
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

func apiBaseFor(credential MediaCredential) string {
	if base := strings.TrimSpace(credential.APIBase); base != "" {
		return strings.TrimRight(base, "/")
	}
	provider, _ := providerByID(credential.Provider)
	return strings.TrimRight(provider.DefaultAPIBase, "/")
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
