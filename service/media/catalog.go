/*
 * [INPUT]: 依赖媒体 DTO、凭据和资产查询
 * [OUTPUT]: Provider/模型目录（Atlas 图片使用原生 prediction 模型 ID，协议为 atlas）、无凭据 Codex 原生图片路由、模型配置和引用能力校验
 * [POS]: media 的声明式模型契约层；Codex 图片能力仅供 Agent 指令选择，不经 Provider 调度
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"errors"
	"fmt"
	"strings"

	"recut-service/media/providers/atlas"
)

const seedanceVideoReferenceMaxBytes = 50 << 20

var mediaProviders = []MediaProvider{
	{ID: "atlas-cloud", Name: "Atlas Cloud", Protocol: "atlas", DefaultAPIBase: atlas.DefaultAPIBase, Models: []MediaModel{
		{ID: "atlas-cloud/openai/gpt-image-2", Provider: "atlas-cloud", Name: "GPT Image 2 · 文生图", Capability: ImageGenerate, APIModelID: "openai/gpt-image-2/text-to-image", EditModelID: "openai/gpt-image-2/edit", InputModes: []string{"text"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/bytedance/seedream-v5.0-pro", Provider: "atlas-cloud", Name: "Seedream 5.0 Pro · 文生图", Capability: ImageGenerate, APIModelID: "bytedance/seedream-v5.0-pro/text-to-image", EditModelID: "bytedance/seedream-v5.0-pro/edit", InputModes: []string{"text", "image"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/xai/grok-imagine-image", Provider: "atlas-cloud", Name: "Grok Imagine · 文生图", Capability: ImageGenerate, APIModelID: "xai/grok-imagine-image/text-to-image", EditModelID: "xai/grok-imagine-image/edit", InputModes: []string{"text"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", Provider: "atlas-cloud", Name: "Seedance 2.0 Mini · 多参考视频", Capability: VideoGenerate, APIModelID: "bytedance/seedance-2.0-mini/reference-to-video", InputModes: []string{"text", "image", "video", "audio"}, OutputModes: []string{"durationSeconds", "resolution", "aspectRatio", "bitrateMode", "generateAudio", "seed", "watermark", "returnLastFrame"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/google/gemini-omni-flash-reference-to-video", Provider: "atlas-cloud", Name: "Gemini Omni Flash · 参考图视频", Capability: VideoGenerate, APIModelID: "google/gemini-omni-flash/reference-to-video", InputModes: []string{"text", "image"}, OutputModes: []string{"durationSeconds", "aspectRatio", "resolution", "thinkingLevel", "seed"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/xai/tts-v1", Provider: "atlas-cloud", Name: "xAI TTS v1", Capability: SpeechGenerate, APIModelID: "xai/tts-v1", InputModes: []string{"text"}, Configurable: true},
	}},
	{ID: "openai", Name: "OpenAI", Protocol: "openai", DefaultAPIBase: "https://api.openai.com/v1", Models: []MediaModel{{ID: "openai/gpt-image-2", Provider: "openai", Name: "GPT Image 2", Capability: ImageGenerate, APIModelID: "gpt-image-2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "openai-compatible", Name: "OpenAI Compatible", Protocol: "openai-compatible", Models: []MediaModel{{ID: "openai-compatible/image", Provider: "openai-compatible", Name: "GPT Image 2 · OpenAI-compatible", Capability: ImageGenerate, APIModelID: "gpt-image-2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "gemini", Name: "Google Gemini", Protocol: "gemini", Models: []MediaModel{{ID: "gemini/image", Provider: "gemini", Name: "Gemini Image", Capability: ImageGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}, {ID: "gemini/video", Provider: "gemini", Name: "Gemini Video", Capability: VideoGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}}},
	{ID: "grok", Name: "xAI Grok", Protocol: "xai", Models: []MediaModel{{ID: "grok/image", Provider: "grok", Name: "Grok Image", Capability: ImageGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}, {ID: "grok/video", Provider: "grok", Name: "Grok Video", Capability: VideoGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}}},
	{ID: "elevenlabs", Name: "ElevenLabs", Protocol: "elevenlabs", DefaultAPIBase: "https://api.elevenlabs.io", Models: []MediaModel{{ID: "elevenlabs/eleven-multilingual-v2", Provider: "elevenlabs", Name: "Eleven Multilingual v2", Capability: SpeechGenerate, APIModelID: "eleven_multilingual_v2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "minimax", Name: "MiniMax", Protocol: "minimax", DefaultAPIBase: "https://api.minimaxi.com", Models: []MediaModel{{ID: "minimax/speech-2.8-hd", Provider: "minimax", Name: "MiniMax Speech 2.8 HD", Capability: SpeechGenerate, APIModelID: "speech-2.8-hd", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "local-audio", Name: "Audio Studio（本机）", Protocol: "local", DefaultAPIBase: "", Models: []MediaModel{{ID: "local-audio/cosyvoice2", Provider: "local-audio", Name: "CosyVoice2 · 本机 TTS", Capability: SpeechGenerate, APIModelID: "cosyvoice2", InputModes: []string{"text"}, Available: true, Configurable: false}}},
}

const CodexImageModelID = "codex/image"

var codexImageModel = MediaModel{
	ID:           CodexImageModelID,
	Provider:     "codex",
	Name:         "Codex",
	Capability:   ImageGenerate,
	InputModes:   []string{"text", "image"},
	Available:    true,
	Configurable: true,
}

var codexImageProvider = MediaProvider{
	ID:       "codex",
	Name:     "Codex",
	Protocol: "native",
	Models:   []MediaModel{codexImageModel},
}

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
		configuration, ok := m.configuredModelFor(route)
		if ok {
			items = append(items, configuration)
		}
	}
	return items, nil
}

// configuredModelFor 把一条已启用路由解析为配置视图；本地 provider（无凭据，
// 如 Audio Studio 本机 TTS）与 Codex 原生图同样不需要查询凭据。
func (m *MediaService) configuredModelFor(route MediaRoute) (MediaConfiguration, bool) {
	model, ok := modelByID(route.ModelID)
	if !ok {
		return MediaConfiguration{}, false
	}
	provider, _ := providerByID(model.Provider)
	configuration := MediaConfiguration{Route: route, Provider: provider, Model: model, RequiredInputs: modelInputFields(model.InputModes), OptionalOutputs: modelOutputFields(model)}
	if model.ID == CodexImageModelID {
		return configuration, true
	}
	if p, ok := providerByID(model.Provider); ok && p.Protocol == "local" {
		configuration.CredentialName = "Audio Studio（本机）"
		return configuration, true
	}
	credential, err := m.credential(route.CredentialID)
	if err != nil {
		return MediaConfiguration{}, false
	}
	configuration.CredentialName = credential.Name
	return configuration, true
}

func (m *MediaService) validateReferences(input GenerateMediaInput) error {
	allowed := referenceKindsFor(input.Capability)
	imageCount, videoCount, audioCount := 0, 0, 0
	assets := make([]MediaAsset, 0, len(input.ReferenceIDs))
	for _, id := range input.ReferenceIDs {
		asset, err := m.GetAsset(id)
		if err != nil {
			return fmt.Errorf("reference asset %q is unavailable", id)
		}
		if asset.Status != "completed" {
			return fmt.Errorf("reference asset %q is still %s", id, asset.Status)
		}
		if !allowed[asset.Kind] {
			return fmt.Errorf("%s cannot use %s as reference context", input.Capability, asset.Kind)
		}
		assets = append(assets, asset)
		if asset.Kind == "image" {
			imageCount++
		}
		if asset.Kind == "video" {
			videoCount++
		}
		if asset.Kind == "audio" {
			audioCount++
		}
	}
	model, ok := modelByID(input.ModelID)
	if !ok {
		return nil
	}
	if err := validateModelReferences(model, imageCount, videoCount, audioCount); err != nil {
		return err
	}
	return validateModelReferenceAssets(model, assets)
}

func validateModelReferences(model MediaModel, images, videos, audios int) error {
	switch model.ID {
	case "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video":
		if (images == 0 && videos == 0) || images > 9 || videos > 3 || audios > 3 {
			return errors.New("Seedance 2.0 Mini requires 1-9 images or 1-3 reference videos and accepts at most 3 audio references")
		}
	case "atlas-cloud/google/gemini-omni-flash-reference-to-video":
		if images == 0 || images > 10 || videos != 0 || audios != 0 {
			return errors.New("Gemini Omni Flash requires 1-10 reference images and accepts no audio or video references")
		}
	}
	return nil
}

func validateModelReferenceAssets(model MediaModel, assets []MediaAsset) error {
	for _, asset := range assets {
		mimeType := strings.ToLower(strings.Split(asset.MimeType, ";")[0])
		switch model.ID {
		case "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video":
			if !validSeedanceReference(asset.Kind, mimeType, asset.SizeBytes) {
				return fmt.Errorf("Seedance 2.0 Mini cannot use %s reference %q", asset.Kind, asset.Name)
			}
		case "atlas-cloud/google/gemini-omni-flash-reference-to-video":
			if asset.Kind != "image" || asset.SizeBytes > 20<<20 || !oneOf(mimeType, "image/png", "image/jpeg", "image/jpg", "image/webp") {
				return fmt.Errorf("Gemini Omni Flash cannot use reference image %q", asset.Name)
			}
		}
	}
	return nil
}

func validSeedanceReference(kind, mimeType string, size int64) bool {
	switch kind {
	case "image":
		return size < 30<<20 && oneOf(mimeType, "image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/gif", "image/heic", "image/heif")
	case "video":
		return size <= seedanceVideoReferenceMaxBytes && oneOf(mimeType, "video/mp4", "video/quicktime")
	case "audio":
		return size <= 15<<20 && oneOf(mimeType, "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3")
	default:
		return false
	}
}

func oneOf(value string, options ...string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
}

func referenceKindsFor(capability MediaCapability) map[string]bool {
	if capability == ImageGenerate {
		return map[string]bool{"image": true}
	}
	if capability == VideoGenerate {
		return map[string]bool{"image": true, "video": true, "audio": true}
	}
	return map[string]bool{}
}

func knownCapability(capability MediaCapability) bool {
	return capability == ImageGenerate || capability == VideoGenerate || capability == SpeechGenerate
}
func modelSupports(id string, capability MediaCapability) bool {
	model, ok := modelByID(id)
	return ok && model.Capability == capability
}
func providerByID(id string) (MediaProvider, bool) {
	if id == codexImageProvider.ID {
		return codexImageProvider, true
	}
	for _, provider := range mediaProviders {
		if provider.ID == id {
			return provider, true
		}
	}
	return MediaProvider{}, false
}
func modelByID(id string) (MediaModel, bool) {
	if id == CodexImageModelID {
		return codexImageModel, true
	}
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

func modelOutputFields(model MediaModel) []string {
	if len(model.OutputModes) > 0 {
		return append([]string(nil), model.OutputModes...)
	}
	return outputFields(model.Capability)
}

func modelInputFields(modes []string) []string {
	fields := []string{}
	for _, mode := range modes {
		switch mode {
		case "text":
			fields = append(fields, "prompt")
		case "image":
			fields = append(fields, "imageAssetIds")
		case "video":
			fields = append(fields, "videoAssetIds")
		case "audio":
			fields = append(fields, "audioAssetIds")
		}
	}
	return fields
}
