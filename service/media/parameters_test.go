/*
 * [INPUT]: 依赖媒体 DTO 与 per-model 参数规范化/映射实现
 * [OUTPUT]: 覆盖默认值注入、类型/enum/范围校验、未知键拒绝、reserved 键透传与 Name→ProviderKey 映射；
 *          以及 App 贡献模型（PassthroughParams）的透传语义与一等字段 aspectRatio 折叠
 * [POS]: media 参数契约层的回归门禁；模型参数错配在生成前被拦下
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import "testing"

func testParameterModel() MediaModel {
	return MediaModel{
		ID: "atlas-cloud/mock", Provider: "atlas-cloud", Capability: VideoGenerate,
		Parameters: []MediaParameter{
			{Name: "durationSeconds", ProviderKey: "duration", Type: "integer", Default: float64(5), Minimum: floatPtr(-1), Maximum: floatPtr(15)},
			{Name: "aspectRatio", ProviderKey: "ratio", Type: "string", Enum: []string{"16:9", "9:16"}, Default: "16:9"},
			{Name: "generateAudio", ProviderKey: "generate_audio", Type: "boolean", Default: true},
		},
	}
}

func TestNormalizeModelOutputAppliesDefaultsAndRejectsBadValues(t *testing.T) {
	model := testParameterModel()
	normalized, err := normalizeModelOutput(model, map[string]any{"durationSeconds": float64(8)})
	if err != nil {
		t.Fatal(err)
	}
	if normalized["durationSeconds"] != float64(8) || normalized["aspectRatio"] != "16:9" || normalized["generateAudio"] != true {
		t.Fatalf("defaults not applied: %#v", normalized)
	}
	for _, output := range []map[string]any{
		{"bogus": 1},
		{"durationSeconds": float64(99)},
		{"durationSeconds": 4.5},
		{"aspectRatio": "1:1"},
		{"generateAudio": "yes"},
	} {
		if _, err := normalizeModelOutput(model, output); err == nil {
			t.Fatalf("invalid output accepted: %#v", output)
		}
	}
}

func TestProviderOutputMapsNamesAndPassesReservedKeys(t *testing.T) {
	model := testParameterModel()
	params := providerOutput(model, map[string]any{"durationSeconds": float64(4), "generateAudio": false, "voiceId": "v1"})
	if params["duration"] != float64(4) || params["generate_audio"] != false || params["voiceId"] != "v1" {
		t.Fatalf("provider mapping wrong: %#v", params)
	}
	if _, leaked := params["durationSeconds"]; leaked {
		t.Fatalf("user-facing key leaked into provider params: %#v", params)
	}
}

func TestNormalizeModelOutputPassesThroughWithoutParameters(t *testing.T) {
	model := MediaModel{ID: "local-audio/cosyvoice2", Capability: SpeechGenerate}
	output := map[string]any{"voiceId": "news", "speed": float64(1)}
	normalized, err := normalizeModelOutput(model, output)
	if err != nil || normalized["voiceId"] != "news" || normalized["speed"] != float64(1) {
		t.Fatalf("speech pass-through broken: %#v, %v", normalized, err)
	}
}

// An App-contributed model carries its declared Parameters (so the platform can
// fold first-class fields and expose the option surface) yet must still pass
// Output through: the App's form contract validates, not the platform. Unknown
// keys survive and declared defaults are NOT injected, so enabling the schema
// cannot silently change what the App receives.
func TestNormalizeModelOutputPassthroughKeepsUnknownKeysWithoutDefaults(t *testing.T) {
	model := MediaModel{
		ID: "modal-cloud/qwen-image", Provider: "modal-cloud", Capability: ImageGenerate,
		PassthroughParams: true,
		Parameters: []MediaParameter{
			{Name: "aspectRatio", Type: "string", Enum: []string{"9:16", "16:9"}},
			{Name: "resolution", Type: "string", Default: "1024"},
		},
	}
	normalized, err := normalizeModelOutput(model, map[string]any{"aspectRatio": "9:16", "durationSeconds": float64(6)})
	if err != nil {
		t.Fatal(err)
	}
	if normalized["aspectRatio"] != "9:16" || normalized["durationSeconds"] != float64(6) {
		t.Fatalf("passthrough must keep keys the App may consume: %#v", normalized)
	}
	if _, injected := normalized["resolution"]; injected {
		t.Fatalf("passthrough must not default-inject declared parameters: %#v", normalized)
	}
}

// The first-class aspectRatio must fold into Output for an App-contributed
// model that declares it, even though the platform does not validate it: the
// App applies the ratio (Qwen-Image-2.1 edit) or ignores it.
func TestApplyAspectRatioFoldsForPassthroughAppModel(t *testing.T) {
	defer RegisterAppProviders(nil)
	RegisterAppProviders([]MediaProvider{{
		ID: "modal-cloud", Protocol: "local",
		Models: []MediaModel{{
			ID: "modal-cloud/qwen-image", Provider: "modal-cloud", APIModelID: "qwen-image",
			Capability: ImageGenerate, Available: true, PassthroughParams: true,
			Parameters: []MediaParameter{{Name: "aspectRatio", Type: "string", Enum: []string{"9:16", "16:9"}}},
		}},
	}})
	output := map[string]any{}
	applyAspectRatio("modal-cloud/qwen-image", "9:16", output)
	if output["aspectRatio"] != "9:16" {
		t.Fatalf("first-class aspectRatio was not folded into Output: %#v", output)
	}
}

// The first-class durationSec must fold into Output for an App-contributed
// model that declares it, so the caller-chosen clip length drives the request
// instead of the App's own default (5s). Models that do not declare the
// parameter (cloud catalogs name it differently) stay untouched, and a value
// already present in Output wins.
func TestApplyDurationSecFoldsForDeclaringModel(t *testing.T) {
	defer RegisterAppProviders(nil)
	RegisterAppProviders([]MediaProvider{{
		ID: "modal-cloud", Protocol: "local",
		Models: []MediaModel{
			{ID: "modal-cloud/minimax-h3-turbo", Provider: "modal-cloud", APIModelID: "minimax-h3-turbo",
				Capability: VideoGenerate, Available: true, PassthroughParams: true,
				Parameters: []MediaParameter{{Name: "durationSec", Type: "number"}}},
			{ID: "modal-cloud/qwen-image", Provider: "modal-cloud", APIModelID: "qwen-image",
				Capability: ImageGenerate, Available: true, PassthroughParams: true,
				Parameters: []MediaParameter{{Name: "aspectRatio", Type: "string"}}},
			// Cloud catalogs name the same slot "durationSeconds"; the first-class
			// durationSec must fold there too, or the request keeps the 5s default.
			{ID: "wavespeed/mock-video", Provider: "wavespeed", APIModelID: "mock-video",
				Capability: VideoGenerate, Available: true,
				Parameters: []MediaParameter{{Name: "durationSeconds", ProviderKey: "duration", Type: "integer", Default: float64(5), Minimum: floatPtr(4), Maximum: floatPtr(15)}}},
		},
	}})
	output := map[string]any{}
	applyDurationSec("modal-cloud/minimax-h3-turbo", 15, output)
	if output["durationSec"] != float64(15) {
		t.Fatalf("first-class durationSec was not folded into Output: %#v", output)
	}
	cloud := map[string]any{}
	applyDurationSec("wavespeed/mock-video", 10, cloud)
	if cloud["durationSeconds"] != float64(10) {
		t.Fatalf("first-class durationSec was not folded into cloud durationSeconds: %#v", cloud)
	}
	// A model that does not declare a duration parameter is left untouched, not rejected.
	other := map[string]any{}
	applyDurationSec("modal-cloud/qwen-image", 15, other)
	if _, present := other["durationSec"]; present {
		t.Fatalf("a model without a duration parameter must not receive it: %#v", other)
	}
	// An explicit Output value wins over the first-class field.
	preset := map[string]any{"durationSec": float64(8)}
	applyDurationSec("modal-cloud/minimax-h3-turbo", 15, preset)
	if preset["durationSec"] != float64(8) {
		t.Fatalf("existing Output durationSec must win: %#v", preset)
	}
	// Zero means "unset" and must not overwrite the model default.
	zero := map[string]any{}
	applyDurationSec("modal-cloud/minimax-h3-turbo", 0, zero)
	if _, present := zero["durationSec"]; present {
		t.Fatalf("zero durationSec must be treated as unset: %#v", zero)
	}
}
