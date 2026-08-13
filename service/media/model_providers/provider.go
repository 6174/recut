/*
 * [INPUT]: 依赖 Provider 注册与标准 HTTP 客户端、凭据、引用字节
 * [OUTPUT]: 媒体 Provider 策略接口、注册表与图片生成请求/结果 DTO；按 provider ID 分派到各自协议
 * [POS]: media/model_providers 的策略边界；每个 Provider 只实现自己的线协议，不接触工作区 SQLite、密钥存储或 Asset 持久化
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package model_providers

import "net/http"

// ImageReference is a decoded reference asset passed to a provider strategy.
// Byte decoding happens in the media service; strategies only serialize it
// according to their own protocol (data URL, multipart part, ...).
type ImageReference struct {
	Kind     string
	Name     string
	MimeType string
	Content  []byte
}

// ImageInput carries everything a strategy needs to generate one image.
type ImageInput struct {
	Model       string
	Prompt      string
	Output      map[string]any
	References  []ImageReference
	APIBase     string
	Secret      string
	HTTPClient  *http.Client
	PollClient  *http.Client
	PollRetries int
}

// ImageResult is the final bytes a provider returned for an image job.
type ImageResult struct {
	Content  []byte
	MimeType string
}

// Provider is a per-provider generation strategy. Implementations own only the
// provider wire protocol and return final media bytes; jobs, assets, secrets
// and workspace SQLite stay in the media service.
type Provider interface {
	ID() string
	// GenerateImage runs one synchronous image generation and returns the
	// final image bytes or a terminal provider error.
	GenerateImage(input ImageInput) (ImageResult, error)
}

var registry = map[string]Provider{}

// Register makes a provider strategy available by its provider ID.
func Register(provider Provider) {
	if provider != nil && provider.ID() != "" {
		registry[provider.ID()] = provider
	}
}

// For returns the strategy registered for a provider ID, if any.
func For(id string) (Provider, bool) {
	provider, ok := registry[id]
	return provider, ok
}
