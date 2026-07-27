/*
 * [INPUT]: 无运行时依赖
 * [OUTPUT]: 媒体能力、模型、配置、资产、任务和生成请求的 JSON 契约
 * [POS]: media 的稳定 DTO 边界；被服务、HTTP/MCP 和 Provider 共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import "time"

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
