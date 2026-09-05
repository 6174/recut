/*
 * [INPUT]: 依赖媒体 DTO 与 providers/atlas 默认 APIBase
 * [OUTPUT]: 编译期内嵌种子目录（Provider/模型清单与参考预算），CDN 目录不可用时的最终回退
 * [POS]: media 目录的种子数据面；CDN catalog（providers/<id>.catalog.json）按 provider 整体覆盖种子，codex/local-audio 不参与
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"sync"

	"recut-service/media/providers/atlas"
)

// seedModelVoicesFor 返回种子快照里某平台模型的 per-model 音色清单；未知模型返回 nil。
// 惰性解析：seedProviders 的 var 初始化顺序不保证 atlasModelVoicesSeed 先就绪，
// 不能在包初始化期直接展开。
var seedModelVoicesOnce sync.Once

func seedModelVoicesFor(modelID string) []MediaVoice {
	seedModelVoicesOnce.Do(func() {
		for id, raw := range atlasModelVoicesSeed {
			voices := []MediaVoice{}
			if err := json.Unmarshal([]byte(raw), &voices); err != nil {
				panic("media seed: invalid model voices for " + id + ": " + err.Error())
			}
			parsed := map[string][]MediaVoice{}
			for _, voice := range voices {
				tagged := voice
				tagged.ModelID = id
				parsed[id] = append(parsed[id], tagged)
			}
			for id, tagged := range parsed {
				seedModelVoicesParsed[id] = tagged
			}
		}
	})
	return seedModelVoicesParsed[modelID]
}

var seedModelVoicesParsed = map[string][]MediaVoice{}

// seedanceVideoReferenceMaxBytes 是 Seedance 系列参考视频的大小上限（50MB）。
const seedanceVideoReferenceMaxBytes = 50 << 20

// skymindSeedance20 / skymindSeedance25 是平台侧稳定的模型 ID；上游 APIModelID
// （doubao-seedance-2.0 / doubao-seedance-2-5-260628）会随网关渠道版本漂移，
// 凭据级 modelOverrides 是唯一稳定的覆盖面。
const (
	skymindSeedance20 = "skymind-token/seedance-2.0"
	skymindSeedance25 = "skymind-token/seedance-2.5"
)

// seedanceReferenceBudget 是 Seedance 系列统一的参考素材预算（图 ≤9 / 视频 ≤3 /
// 音频 ≤3，mime 与大小白名单一致），从原 catalog.go 的 per-model switch 迁移为数据。
func seedanceReferenceBudget(requireAtLeastOne bool) []ReferenceBudget {
	budget := ReferenceBudget{
		MaxImages: 9,
		MaxVideos: 3,
		MaxAudios: 3,
		Image:     &ReferenceKindSpec{MaxBytes: 30 << 20, Mimes: []string{"image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/gif", "image/heic", "image/heif"}},
		Video:     &ReferenceKindSpec{MaxBytes: seedanceVideoReferenceMaxBytes, Mimes: []string{"video/mp4", "video/quicktime"}},
		Audio:     &ReferenceKindSpec{MaxBytes: 15 << 20, Mimes: []string{"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"}},
	}
	if requireAtLeastOne {
		budget.Requirements = []string{"images+videos>=1"}
	}
	return []ReferenceBudget{budget}
}

// geminiOmniFlashReferenceBudget：必须 1-10 张参考图，且不接受任何视频/音频参考。
func geminiOmniFlashReferenceBudget() []ReferenceBudget {
	return []ReferenceBudget{{
		Requirements: []string{"images>=1", "videos==0", "audios==0"},
		MaxImages:    10,
		Image:        &ReferenceKindSpec{MaxBytes: 20 << 20, Mimes: []string{"image/png", "image/jpeg", "image/jpg", "image/webp"}},
	}}
}

// seedProviders 是编译期内嵌种子目录：CDN providers/<id>.catalog.json 加载失败
// 时的最终回退，契约与 CDN 目录一致（新增模型优先走 CDN，不再改这里发版）。
var seedProviders = []MediaProvider{
	{ID: "atlas-cloud", Name: "Atlas Cloud", Protocol: "atlas", DefaultAPIBase: atlas.DefaultAPIBase, Models: []MediaModel{
		{ID: "atlas-cloud/openai/gpt-image-2", Provider: "atlas-cloud", Name: "GPT Image 2 · 文生图", Capability: ImageGenerate, APIModelID: "openai/gpt-image-2/text-to-image", EditModelID: "openai/gpt-image-2/edit", InputModes: []string{"text"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/bytedance/seedream-v5.0-pro", Provider: "atlas-cloud", Name: "Seedream 5.0 Pro · 文生图", Capability: ImageGenerate, APIModelID: "bytedance/seedream-v5.0-pro/text-to-image", EditModelID: "bytedance/seedream-v5.0-pro/edit", InputModes: []string{"text", "image"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/xai/grok-imagine-image", Provider: "atlas-cloud", Name: "Grok Imagine · 文生图", Capability: ImageGenerate, APIModelID: "xai/grok-imagine-image/text-to-image", EditModelID: "xai/grok-imagine-image/edit", InputModes: []string{"text"}, Available: true, Configurable: true},
		{ID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", Provider: "atlas-cloud", Name: "Seedance 2.0 Mini · 多参考视频", Capability: VideoGenerate, APIModelID: "bytedance/seedance-2.0-mini/reference-to-video", InputModes: []string{"text", "image", "video", "audio"}, OutputModes: []string{"durationSeconds", "resolution", "aspectRatio", "bitrateMode", "generateAudio", "seed", "watermark", "returnLastFrame"}, Available: true, Configurable: true, ReferenceBudgets: seedanceReferenceBudget(true)},
		{ID: "atlas-cloud/google/gemini-omni-flash-reference-to-video", Provider: "atlas-cloud", Name: "Gemini Omni Flash · 参考图视频", Capability: VideoGenerate, APIModelID: "google/gemini-omni-flash/reference-to-video", InputModes: []string{"text", "image"}, OutputModes: []string{"durationSeconds", "aspectRatio", "resolution", "thinkingLevel", "seed"}, Available: true, Configurable: true, ReferenceBudgets: geminiOmniFlashReferenceBudget()},
		// 音色随模型走：xAI TTS v1 的内置音色（schema voice_id 枚举）挂在该模型的
		// Voices 上，与其他 TTS 模型（Gemini/MiniMax/ElevenLabs）互不通用；
		// 清单在下方 init 里回填（规避 var 初始化顺序的不确定性，见 seedModelVoicesFor）。
		{ID: "atlas-cloud/xai/tts-v1", Provider: "atlas-cloud", Name: "xAI TTS v1", Capability: SpeechGenerate, APIModelID: "xai/tts-v1", InputModes: []string{"text"}, Available: true, Configurable: true},
	},
	},
	{ID: "skymind-token", Name: "Skymind Token API", Protocol: "skymind", DefaultAPIBase: "https://token-api.skymind.pro", Models: []MediaModel{
		{ID: "skymind-token/gpt-image-2", Provider: "skymind-token", Name: "GPT Image 2", Capability: ImageGenerate, APIModelID: "gpt-image-2", InputModes: []string{"text"}, Available: true, Configurable: true},
		{ID: skymindSeedance20, Provider: "skymind-token", Name: "Seedance 2.0 · 文/参考视频", Capability: VideoGenerate, APIModelID: "doubao-seedance-2.0", InputModes: []string{"text", "image", "video", "audio"}, OutputModes: []string{"durationSeconds", "aspectRatio", "resolution", "generateAudio", "seed"}, Available: true, Configurable: true, ReferenceBudgets: seedanceReferenceBudget(false)},
		{ID: skymindSeedance25, Provider: "skymind-token", Name: "Seedance 2.5 · 文/参考视频", Capability: VideoGenerate, APIModelID: "doubao-seedance-2-5-260628", InputModes: []string{"text", "image", "video", "audio"}, OutputModes: []string{"durationSeconds", "aspectRatio", "resolution", "generateAudio", "seed"}, Available: true, Configurable: true, ReferenceBudgets: seedanceReferenceBudget(false)},
	}},
	{ID: "openai", Name: "OpenAI", Protocol: "openai", DefaultAPIBase: "https://api.openai.com/v1", Models: []MediaModel{{ID: "openai/gpt-image-2", Provider: "openai", Name: "GPT Image 2", Capability: ImageGenerate, APIModelID: "gpt-image-2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "openai-compatible", Name: "OpenAI Compatible", Protocol: "openai-compatible", Models: []MediaModel{{ID: "openai-compatible/image", Provider: "openai-compatible", Name: "GPT Image 2 · OpenAI-compatible", Capability: ImageGenerate, APIModelID: "gpt-image-2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "gemini", Name: "Google Gemini", Protocol: "gemini", Models: []MediaModel{{ID: "gemini/image", Provider: "gemini", Name: "Gemini Image", Capability: ImageGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}, {ID: "gemini/video", Provider: "gemini", Name: "Gemini Video", Capability: VideoGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}}},
	{ID: "grok", Name: "xAI Grok", Protocol: "xai", Models: []MediaModel{{ID: "grok/image", Provider: "grok", Name: "Grok Image", Capability: ImageGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}, {ID: "grok/video", Provider: "grok", Name: "Grok Video", Capability: VideoGenerate, APIModelID: "", InputModes: []string{"text", "image"}, Configurable: true}}},
	{ID: "elevenlabs", Name: "ElevenLabs", Protocol: "elevenlabs", DefaultAPIBase: "https://api.elevenlabs.io", Models: []MediaModel{{ID: "elevenlabs/eleven-multilingual-v2", Provider: "elevenlabs", Name: "Eleven Multilingual v2", Capability: SpeechGenerate, APIModelID: "eleven_multilingual_v2", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "minimax", Name: "MiniMax", Protocol: "minimax", DefaultAPIBase: "https://api.minimaxi.com", Models: []MediaModel{{ID: "minimax/speech-2.8-hd", Provider: "minimax", Name: "MiniMax Speech 2.8 HD", Capability: SpeechGenerate, APIModelID: "speech-2.8-hd", InputModes: []string{"text"}, Available: true, Configurable: true}}},
	{ID: "local-audio", Name: "Audio Studio（本机）", Protocol: "local", DefaultAPIBase: "", Models: []MediaModel{{ID: "local-audio/cosyvoice2", Provider: "local-audio", Name: "CosyVoice2 · 本机 TTS", Capability: SpeechGenerate, APIModelID: "cosyvoice2", InputModes: []string{"text"}, Available: true, Configurable: false}}},
}

// init 把种子快照的 per-model 音色回填进 seedProviders。init 在全部包级变量
// （含 atlasModelVoicesSeed）初始化完成后运行。
func init() {
	for pi := range seedProviders {
		for mi := range seedProviders[pi].Models {
			model := &seedProviders[pi].Models[mi]
			if len(model.Voices) == 0 {
				model.Voices = seedModelVoicesFor(model.ID)
			}
		}
	}
}
