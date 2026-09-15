/*
 * [INPUT]: 依赖媒体 DTO 与 per-model 参数规范化/映射实现
 * [OUTPUT]: 覆盖默认值注入、类型/enum/范围校验、未知键拒绝、reserved 键透传与 Name→ProviderKey 映射
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
