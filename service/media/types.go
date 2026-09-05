/*
 * [INPUT]: 无运行时依赖
 * [OUTPUT]: 媒体能力、含输入/输出参数能力的模型、配置、图片/视频/音频/转写/研究资料资产、任务和生成请求 JSON 契约
 * [POS]: media 的稳定 DTO 边界；被服务、HTTP/MCP 和 Provider 共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"time"
)

type MediaCapability string

const (
	ImageGenerate  MediaCapability = "image.generate"
	VideoGenerate  MediaCapability = "video.generate"
	SpeechGenerate MediaCapability = "speech.generate"
)

// ReferenceKindSpec is the per-reference-kind constraint of one budget: an
// optional size ceiling and a mime allowlist. Both fields are optional; a spec
// with neither accepts everything of its kind.
type ReferenceKindSpec struct {
	MaxBytes int64    `json:"maxBytes,omitempty"`
	Mimes    []string `json:"mimes,omitempty"`
}

// ReferenceBudget is one declarative constraint block for a model's reference
// inputs, carried by the catalog instead of per-model code switches. Count
// ceilings of zero mean "no ceiling"; Requirements are simple predicates over
// the reference counts (e.g. "images+videos>=1", "videos==0").
type ReferenceBudget struct {
	Requirements []string           `json:"requirements,omitempty"`
	MaxImages    int                `json:"maxImages,omitempty"`
	MaxVideos    int                `json:"maxVideos,omitempty"`
	MaxAudios    int                `json:"maxAudios,omitempty"`
	Image        *ReferenceKindSpec `json:"image,omitempty"`
	Video        *ReferenceKindSpec `json:"video,omitempty"`
	Audio        *ReferenceKindSpec `json:"audio,omitempty"`
}

// MediaModelMeta is display-only catalog data (never consumed by generation).
type MediaModelMeta struct {
	DocsURL string   `json:"docsUrl,omitempty"`
	Summary string   `json:"summary,omitempty"`
	Pricing string   `json:"pricing,omitempty"`
	Tags    []string `json:"tags,omitempty"`
}

type MediaModel struct {
	ID           string          `json:"id"`
	Provider     string          `json:"provider"`
	Name         string          `json:"name"`
	Capability   MediaCapability `json:"capability"`
	APIModelID   string          `json:"apiModelId"`
	EditModelID  string          `json:"editModelId,omitempty"`
	InputModes   []string        `json:"inputModes"`
	OutputModes  []string        `json:"outputModes"`
	Available    bool            `json:"available"`
	Configurable bool            `json:"configurable"`
	// Status is the catalog lifecycle marker: stable (default when empty) |
	// new | deprecated | retired. Retired models keep resolving for existing
	// routes but reject new route assignments.
	Status           string            `json:"status,omitempty"`
	ReferenceBudgets []ReferenceBudget `json:"referenceBudgets,omitempty"`
	Meta             *MediaModelMeta   `json:"meta,omitempty"`
	// Voices 是该模型自己的内置音色清单（如 Atlas 各 TTS 模型 schema 的 voice 枚举）。
	// 空表示模型不声明 per-model 音色：调用方回退到 provider 级动态 voices 或扩展清单。
	Voices []MediaVoice `json:"voices,omitempty"`
}

type MediaProvider struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Protocol       string       `json:"protocol"`
	DefaultAPIBase string       `json:"defaultApiBase"`
	Models         []MediaModel `json:"models"`
	// Catalog provenance, filled by the CDN catalog loader; seed entries leave
	// them empty. Source is "cdn" or "seed".
	Revision  int    `json:"revision,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
	Source    string `json:"source,omitempty"`
	// Extensions carries per-provider catalog extension data (e.g. MiniMax
	// voice previews). The schema does not constrain the internals; consumers
	// parse what they need and broken payloads never block the model catalog.
	Extensions map[string]json.RawMessage `json:"extensions,omitempty"`
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
	// PreviewURL 是 provider 直接提供的试听音频地址（如 ElevenLabs preview_url）；
	// 缺失时 UI 走平台的懒生成预览端点补一段短句试听。
	PreviewURL string `json:"previewUrl,omitempty"`
	// ModelID 是该音色归属的平台模型 ID（voices 随模型走，不同 TTS 模型的音色集不通用）。
	// 空表示 provider 级音色（如动态 voices API 拉取的清单），对该 provider 所有语音模型可用。
	ModelID string `json:"modelId,omitempty"`
}

type MediaCredential struct {
	ID        string `json:"id"`
	Provider  string `json:"provider"`
	Name      string `json:"name"`
	APIBase   string `json:"apiBase"`
	SecretSet bool   `json:"secretSet"`
	// ModelOverrides maps platform model ID -> upstream API model ID for this
	// credential only. Gateway model IDs drift (dated releases, channel
	// variants), so a per-credential override is the stable configuration
	// surface; it wins over the catalog default when present.
	ModelOverrides map[string]string `json:"modelOverrides,omitempty"`
	CreatedAt      time.Time         `json:"createdAt"`
	UpdatedAt      time.Time         `json:"updatedAt"`
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
	DeletedAt   *time.Time     `json:"deletedAt,omitempty"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

// ReferenceAssetInput records a web-native research source in the global Asset
// library. The Asset identity stays a canonical URL so the same source dedups
// across projects and Apps; the Agent also attaches as much reviewable content
// as the origin provides: full body text for articles/webpages, decoded image
// bytes, and complete platform metadata for video/social sources. Nothing is
// scraped or downloaded by the service itself, and the URL remains the source
// of truth. Any project can attach the resulting immutable Asset by ID.
type ReferenceAssetInput struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	// SourceKind distinguishes the origin platform: article, web, youtube,
	// xiaohongshu, douyin, image or similar. It defaults to "web".
	SourceKind string `json:"sourceKind"`
	// Summary is the Agent's short factual summary of the source.
	Summary string `json:"summary,omitempty"`
	// Description is the source's own meta description or video description.
	Description string `json:"description,omitempty"`
	// Excerpt is a direct quote pulled from the source for review.
	Excerpt string `json:"excerpt,omitempty"`
	Author  string `json:"author,omitempty"`
	// PublishedAt is the source publication/upload time in ISO-8601 form.
	PublishedAt  string `json:"publishedAt,omitempty"`
	SiteName     string `json:"siteName,omitempty"`
	Language     string `json:"language,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	// Content is the full body text of an article or webpage. It is persisted
	// as a content-addressed part so research survives without re-fetching.
	Content string `json:"content,omitempty"`
	// ContentMimeType overrides the default text/markdown part type.
	ContentMimeType string `json:"contentMimeType,omitempty"`
	// ImageData is base64-encoded image bytes (or a data: URL). When present the
	// decoded image is persisted as a content-addressed image part.
	ImageData     string `json:"imageData,omitempty"`
	ImageMimeType string `json:"imageMimeType,omitempty"`
	// ChannelName/ChannelURL name the publisher for YouTube or other video
	// platforms; duration, view and like counts complete the platform metadata.
	ChannelName string  `json:"channelName,omitempty"`
	ChannelURL  string  `json:"channelUrl,omitempty"`
	DurationSec float64 `json:"durationSeconds,omitempty"`
	ViewCount   int64   `json:"viewCount,omitempty"`
	LikeCount   int64   `json:"likeCount,omitempty"`
}

type MediaShare struct {
	ID          string     `json:"id"`
	AssetID     string     `json:"assetId"`
	ContentHash string     `json:"contentHash"`
	Token       string     `json:"token"`
	URL         string     `json:"url"`
	ObjectKey   string     `json:"objectKey"`
	ExpiresAt   time.Time  `json:"expiresAt"`
	RevokedAt   *time.Time `json:"revokedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type MediaJob struct {
	ID           string          `json:"id"`
	Capability   MediaCapability `json:"capability"`
	Status       string          `json:"status"`
	Prompt       string          `json:"prompt"`
	ModelID      string          `json:"modelId"`
	ProjectID    string          `json:"projectId,omitempty"`
	References   MediaReferences `json:"references,omitempty"`
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
	References     MediaReferences `json:"references,omitempty"`
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
