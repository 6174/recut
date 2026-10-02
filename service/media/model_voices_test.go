/*
 * [INPUT]: 依赖种子目录（atlasModelVoicesSeed）、mergeCatalogProviders 与 ListVoices 聚合
 * [OUTPUT]: 覆盖 per-model voices 契约：音色随模型走（带 modelId 标记）、CDN 目录缺 voices 时按种子表回填、
 *          无动态 voices API 的 provider 从目录 per-model 清单返回音色
 * [POS]: media 的 voices 按模型过滤回归测试；跨模型错配 voiceId 的缺陷由此门禁
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"testing"
)

// TestAtlasSeedModelVoicesArePerModel：种子表必须给每个 Atlas TTS 模型独立音色，
// 且不同模型的音色集互不重叠（防止再把一份音色挂到 provider 级）。
func TestAtlasSeedModelVoicesArePerModel(t *testing.T) {
	for modelID, raw := range atlasModelVoicesSeed {
		voices := []MediaVoice{}
		if err := json.Unmarshal([]byte(raw), &voices); err != nil {
			t.Fatalf("%s: invalid voices json: %v", modelID, err)
		}
		if len(voices) == 0 {
			t.Fatalf("%s: seed voices must not be empty", modelID)
		}
		for _, voice := range voices {
			if voice.ID == "" || voice.Name == "" {
				t.Fatalf("%s: voice missing id/name: %+v", modelID, voice)
			}
		}
	}
	xai := seedModelVoicesFor("atlas-cloud/xai/tts-v1")
	gemini := seedModelVoicesFor("atlas-cloud/google/gemini-2.5-pro-tts")
	if len(xai) == 0 || len(gemini) == 0 {
		t.Fatal("xai/gemini seed voices missing")
	}
	if xai[0].ID == gemini[0].ID {
		t.Fatalf("different models must not share voice ids: %s", xai[0].ID)
	}
}

// TestMergeCatalogProvidersBackfillsModelVoices：CDN 目录整体替换 provider 后，
// 缺 voices 的模型用种子表回填；CDN 已带的 voices 不被覆盖。
func TestMergeCatalogProvidersBackfillsModelVoices(t *testing.T) {
	cdn := []MediaProvider{{
		ID: "atlas-cloud", Name: "Atlas Cloud", Protocol: "atlas",
		Models: []MediaModel{
			{ID: "atlas-cloud/google/gemini-2.5-pro-tts", Provider: "atlas-cloud", Capability: SpeechGenerate},
			{ID: "atlas-cloud/xai/tts-v1", Provider: "atlas-cloud", Capability: SpeechGenerate, Voices: []MediaVoice{{ID: "cdn-voice", Name: "From CDN"}}},
		},
	}}
	merged := mergeCatalogProviders(seedProviders, cdn)
	var atlas MediaProvider
	for _, provider := range merged {
		if provider.ID == "atlas-cloud" {
			atlas = provider
		}
	}
	byID := map[string]MediaModel{}
	for _, model := range atlas.Models {
		byID[model.ID] = model
	}
	gemini, ok := byID["atlas-cloud/google/gemini-2.5-pro-tts"]
	if !ok || len(gemini.Voices) == 0 {
		t.Fatal("gemini tts voices were not backfilled from seed table")
	}
	xai := byID["atlas-cloud/xai/tts-v1"]
	if len(xai.Voices) != 1 || xai.Voices[0].ID != "cdn-voice" {
		t.Fatalf("cdn voices must win over seed backfill, got %+v", xai.Voices)
	}
}

// TestCatalogModelVoicesTagPerModel：目录 per-model 汇总给每条音色打上所属平台
// 模型 ID，且只收 TTS 模型。Gemini 模型是 CDN-only 条目：经 merge 回填后同样带 voices。
func TestCatalogModelVoicesTagPerModel(t *testing.T) {
	cdn := []MediaProvider{{ID: "atlas-cloud", Name: "Atlas Cloud", Protocol: "atlas", Models: []MediaModel{
		{ID: "atlas-cloud/google/gemini-2.5-pro-tts", Provider: "atlas-cloud", Capability: SpeechGenerate, Available: true},
		{ID: "atlas-cloud/xai/tts-v1", Provider: "atlas-cloud", Capability: SpeechGenerate, Available: true},
	}}}
	swapCatalog(mergeCatalogProviders(seedProviders, cdn))
	t.Cleanup(func() { swapCatalog(seedProviders) })
	voices := catalogModelVoices("atlas-cloud")
	seen := map[string]bool{}
	for _, voice := range voices {
		if voice.ModelID == "" {
			t.Fatalf("catalog voices must carry modelId, got %+v", voice)
		}
		if voice.Provider != "atlas-cloud" {
			t.Fatalf("provider not normalized: %+v", voice)
		}
		seen[voice.ModelID] = true
	}
	if !seen["atlas-cloud/xai/tts-v1"] || !seen["atlas-cloud/google/gemini-2.5-pro-tts"] {
		t.Fatalf("expected per-model voices for xai and gemini, saw %v", seen)
	}
	for modelID := range seen {
		if !isTextToSpeechModel(mustModel(t, modelID)) {
			t.Fatalf("non-TTS model %s leaked into voices", modelID)
		}
	}
}

// TestSeedAudioIsVoiceTTSWhenVoicesPresent：Seed Audio 的名字不含 tts/speech，
// 一旦目录/种子给出 per-model voices，isVoiceTTSModel 必须接纳它，否则它会从音频
// 选择器中消失（回归：曾因命名启发式被误判为通用音频理解模型而被过滤）。
func TestSeedAudioIsVoiceTTSWhenVoicesPresent(t *testing.T) {
	model := MediaModel{
		ID: "atlas-cloud/bytedance/seed-audio-1.0", Name: "Seed Audio 1.0",
		APIModelID: "bytedance/seed-audio-1.0", Capability: SpeechGenerate, Available: true,
		Voices: seedModelVoicesFor("atlas-cloud/bytedance/seed-audio-1.0"),
	}
	if len(model.Voices) == 0 {
		t.Fatal("seed-audio voices missing from seed table")
	}
	if !isTextToSpeechModel(model) {
		t.Fatal("seed-audio must not be filtered as non-TTS")
	}
	provider := MediaProvider{ID: "atlas-cloud", Name: "Atlas Cloud", Protocol: "atlas", Models: []MediaModel{model}}
	if !isVoiceTTSModel(provider, model) {
		t.Fatal("seed-audio with voices must be treated as a voice TTS model")
	}
	models := speechModelsFor(provider, SpeechGenerate)
	if len(models) != 1 || models[0].ID != model.ID {
		t.Fatalf("seed-audio dropped from speech models: %+v", models)
	}
}

func mustModel(t *testing.T, id string) MediaModel {
	t.Helper()
	model, ok := modelByID(id)
	if !ok {
		t.Fatalf("model %s missing from catalog", id)
	}
	return model
}
