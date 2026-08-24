/*
 * [INPUT]: 依赖标准 HTTP 客户端、Skymind Bearer 凭据与 skymind 协议适配器
 * [OUTPUT]: 对外提供 skymind-token 的图片生成策略：OpenAI 兼容 /v1/images/generations，
 *          同步返回最终字节（b64_json 优先）
 * [POS]: media/model_providers 的 skymind-token 策略实现；只负责线协议与取回最终字节，
 *        不接触工作区 SQLite、密钥存储或 Asset 持久化
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package model_providers

import (
	"recut-service/media/providers/skymind"
)

type skymindProvider struct{}

func init() {
	Register(skymindProvider{})
}

func (skymindProvider) ID() string { return "skymind-token" }

// GenerateImage runs one synchronous image generation on the Skymind gateway.
// The gateway's OpenAI-compatible endpoint returns b64_json inline, so there
// is no poll phase; references are unsupported by this strategy (the current
// skymind image model is text-to-image only).
func (skymindProvider) GenerateImage(input ImageInput) (ImageResult, error) {
	result, err := skymind.SubmitImage(input.HTTPClient, input.APIBase, input.Secret, skymind.ImageRequest{
		Model:  input.Model,
		Prompt: input.Prompt,
		Output: input.Output,
	})
	if err != nil {
		return ImageResult{}, err
	}
	return ImageResult{Content: result.Content, MimeType: result.MimeType}, nil
}
