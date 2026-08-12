/*
 * [INPUT]: 无运行时依赖
 * [OUTPUT]: 媒体能力、含输入/输出参数能力的模型、配置、图片/视频/音频/转写/研究资料资产、任务和生成请求 JSON 契约
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
	OutputModes  []string        `json:"outputModes"`
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
	Status      string         `json:"status"`
	JobID       string         `json:"jobId,omitempty"`
	RemoteID    string         `json:"remoteId,omitempty"`
	Error       string         `json:"error,omitempty"`
	ProjectIDs  []string       `json:"projectIds"`
	ParentID    string         `json:"parentId,omitempty"`
	Metadata    map[string]any `json:"metadata"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

// ReferenceAssetInput records a web-native research source in the global Asset
// library. It deliberately stores a canonical URL and metadata rather than
// scraping, downloading, or pretending an external page is a local media file.
// Any project can attach the resulting immutable Asset by ID.
type ReferenceAssetInput struct {
	Name         string `json:"name"`
	URL          string `json:"url"`
	SourceKind   string `json:"sourceKind"`
	Summary      string `json:"summary,omitempty"`
	Author       string `json:"author,omitempty"`
	PublishedAt  string `json:"publishedAt,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
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
	RemoteID     string          `json:"remoteId,omitempty"`
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

// TimelineClip is one sequential segment on a composition track. The B-roll
// editor deliberately uses two fixed tracks, so each segment starts where the
// previous segment ends and needs no arbitrary layer or transition model.
type TimelineClip struct {
	AssetID     string  `json:"assetId"`
	StartSec    float64 `json:"startSec"`
	DurationSec float64 `json:"durationSec"`
}

// CompositionSettings contains the small, stable export surface exposed by
// the platform. Codec choices remain platform-owned so App UI cannot create
// non-portable FFmpeg command lines.
type CompositionSettings struct {
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	FPS     int    `json:"fps"`
	Quality string `json:"quality"`
}

// ComposeMediaInput describes a deterministic video/audio timeline. It is
// intentionally separate from provider generation: all source IDs already
// refer to completed local Assets and the result is a new local video Asset.
type ComposeMediaInput struct {
	ProjectID     string              `json:"projectId"`
	VideoTimeline []TimelineClip      `json:"videoTimeline"`
	AudioTimeline []TimelineClip      `json:"audioTimeline"`
	Settings      CompositionSettings `json:"settings"`
}
