/*
 * [INPUT]: 依赖 testdata/*.contract.catalog.json（从真实 CDN 目录切片）与各 Provider 的
 *          纯请求体构造器（atlas.BuildImagePayload/BuildVideoPayload、skymind.BuildVideoPayload）
 * [OUTPUT]: catalog→wire 契约门禁：用真实目录的 parameters/referenceFields，经
 *          normalizeModelOutput/providerOutput/splitMetadataParams 后，最终请求体字段符合各
 *          Provider 文档；未知参数在生成前被 schema 拒绝。全程无网络、无 Store。
 * [POS]: media 的 provider 对接契约测试；与真实目录同源，不真实调用任何外部 Provider
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"recut-service/media/providers/atlas"
	"recut-service/media/providers/skymind"
)

func contractModels(t *testing.T) map[string]MediaModel {
	t.Helper()
	models := map[string]MediaModel{}
	for _, name := range []string{"atlas-cloud", "skymind-token", "minimax"} {
		data, err := os.ReadFile(filepath.Join("testdata", name+".contract.catalog.json"))
		if err != nil {
			t.Fatalf("contract catalog %s missing: %v", name, err)
		}
		provider, err := parseProviderCatalog(data)
		if err != nil {
			t.Fatalf("contract catalog %s invalid: %v", name, err)
		}
		for _, model := range provider.Models {
			models[model.ID] = model
		}
	}
	return models
}

func normalizedFor(t *testing.T, model MediaModel, output map[string]any) map[string]any {
	t.Helper()
	normalized, err := normalizeModelOutput(model, output)
	if err != nil {
		t.Fatalf("normalizeModelOutput(%s): %v", model.ID, err)
	}
	return normalized
}

// assertBody 校验文档要求的关键字段存在且取值正确；schema/template 派生的默认值额外出现是允许的。
func assertBody(t *testing.T, label string, got, want map[string]any) {
	t.Helper()
	for key, expected := range want {
		actual, present := got[key]
		if !present || !reflect.DeepEqual(actual, expected) {
			t.Fatalf("%s: %s = %#v, want %#v\n got  %#v", label, key, actual, expected, got)
		}
	}
}

func TestCatalogWireContract(t *testing.T) {
	models := contractModels(t)
	image := "data:image/png;base64,AAA"
	audio := "data:audio/mpeg;base64,BBB"

	atlasImage := func(t *testing.T, modelID, prompt string, output map[string]any, images []string) map[string]any {
		t.Helper()
		model := models[modelID]
		return atlas.BuildImagePayload(atlas.GenerateImageInput{
			Model: model.APIModelID, Prompt: prompt, Images: images,
			Params: providerOutput(model, normalizedFor(t, model, output)), ReferenceFields: model.ReferenceFields,
		})
	}
	atlasVideo := func(t *testing.T, modelID, prompt string, output map[string]any, images, videos, audios []string) map[string]any {
		t.Helper()
		model := models[modelID]
		body, err := atlas.BuildVideoPayload(atlas.GenerateInput{
			Model: model.APIModelID, Prompt: prompt, Images: images, Videos: videos, Audios: audios,
			Params: providerOutput(model, normalizedFor(t, model, output)), ReferenceFields: model.ReferenceFields,
		})
		if err != nil {
			t.Fatalf("%s: %v", modelID, err)
		}
		return body
	}

	// —— 图片：无参考 / 单数字段 / 复数字段 / 类型多样性 ——
	t.Run("image text-to-image enum boolean integer", func(t *testing.T) {
		body := atlasImage(t, "atlas-cloud/alibaba/qwen-image/text-to-image-max", "a cat",
			map[string]any{"size": "1664*928", "enable_prompt_expansion": true, "num_images": float64(1)}, nil)
		assertBody(t, "text-to-image-max", body, map[string]any{
			"model": "alibaba/qwen-image/text-to-image-max", "prompt": "a cat",
			"size": "1664*928", "enable_prompt_expansion": true, "num_images": float64(1),
		})
		if _, present := body["images"]; present {
			t.Fatalf("text-to-image must not carry images: %#v", body)
		}
	})
	t.Run("image enum output_format", func(t *testing.T) {
		body := atlasImage(t, "atlas-cloud/bytedance/seedream-v5.0-pro/text-to-image", "a dog",
			map[string]any{"output_format": "png", "size": "1024*1024"}, nil)
		assertBody(t, "seedream", body, map[string]any{
			"model": "bytedance/seedream-v5.0-pro/text-to-image", "output_format": "png", "size": "1024*1024",
		})
	})
	t.Run("image number params and singular reference", func(t *testing.T) {
		body := atlasImage(t, "atlas-cloud/black-forest-labs/flux-dev", "a fox",
			map[string]any{"strength": 0.6, "guidance_scale": 3.5, "num_inference_steps": float64(20)}, []string{image})
		assertBody(t, "flux-dev", body, map[string]any{
			"model": "black-forest-labs/flux-dev", "image": image,
			"strength": 0.6, "guidance_scale": 3.5, "num_inference_steps": float64(20),
		})
	})
	t.Run("image plural reference field", func(t *testing.T) {
		body := atlasImage(t, "atlas-cloud/alibaba/qwen-image/edit", "make it night",
			map[string]any{"negative_prompt": "blurry", "seed": float64(7)}, []string{image})
		assertBody(t, "qwen edit", body, map[string]any{
			"model": "alibaba/qwen-image/edit", "images": []string{image},
			"negative_prompt": "blurry", "seed": float64(7),
		})
	})
	t.Run("image singular reference field enum", func(t *testing.T) {
		body := atlasImage(t, "atlas-cloud/atlascloud/photo-cleanup", "clean", map[string]any{"output_format": "webp"}, []string{image})
		assertBody(t, "photo cleanup", body, map[string]any{
			"model": "atlascloud/photo-cleanup", "image": image, "output_format": "webp",
		})
	})

	// —— 视频：文生 / 图生 / 视频扩展 / 视频转视频 / 显式空参数 ——
	t.Run("video text-to-video enum and audio reference", func(t *testing.T) {
		body := atlasVideo(t, "atlas-cloud/alibaba/wan-2.7/text-to-video", "a city",
			map[string]any{"resolution": "1080P", "ratio": "9:16", "duration": float64(5), "prompt_extend": false, "seed": float64(11)}, nil, nil, []string{audio})
		assertBody(t, "wan text-to-video", body, map[string]any{
			"model": "alibaba/wan-2.7/text-to-video", "prompt": "a city",
			"resolution": "1080P", "ratio": "9:16", "duration": float64(5), "prompt_extend": false, "seed": float64(11),
			"audio": audio,
		})
	})
	t.Run("video image-to-video singular scalar", func(t *testing.T) {
		body := atlasVideo(t, "atlas-cloud/alibaba/wan-2.5/image-to-video", "move",
			map[string]any{"duration": float64(10), "resolution": "1080p"}, []string{image}, nil, nil)
		assertBody(t, "wan image-to-video", body, map[string]any{
			"model": "alibaba/wan-2.5/image-to-video", "image": image, "duration": float64(10), "resolution": "1080p",
		})
	})
	t.Run("video-extend trailing video scalar", func(t *testing.T) {
		videoURL := "https://cdn.recut.video/share/clip.mp4"
		body := atlasVideo(t, "atlas-cloud/alibaba/wan-2.5/video-extend", "extend",
			map[string]any{"duration": float64(8), "resolution": "720p"}, nil, []string{videoURL}, []string{audio})
		assertBody(t, "wan video-extend", body, map[string]any{
			"model": "alibaba/wan-2.5/video-extend", "video": videoURL, "audio": audio,
			"duration": float64(8), "resolution": "720p",
		})
	})
	t.Run("video-to-video plural videos and enums", func(t *testing.T) {
		videoURL := "https://cdn.recut.video/share/clip.mp4"
		body := atlasVideo(t, "atlas-cloud/alibaba/wan-2.6/video-to-video", "restyle",
			map[string]any{"duration": float64(5), "size": "1280*720", "shot_type": "multi"}, nil, []string{videoURL}, nil)
		assertBody(t, "wan video-to-video", body, map[string]any{
			"model": "alibaba/wan-2.6/video-to-video", "videos": []string{videoURL},
			"duration": float64(5), "size": "1280*720", "shot_type": "multi",
		})
	})
	t.Run("video explicit empty parameters keeps only references", func(t *testing.T) {
		body := atlasVideo(t, "atlas-cloud/kwaivgi/kling-v2.6-pro/avatar", "talk", map[string]any{}, []string{image}, nil, []string{audio})
		assertBody(t, "kling avatar", body, map[string]any{
			"model": "kwaivgi/kling-v2.6-pro/avatar", "image": image, "audio": audio,
		})
		if _, present := body["seed"]; present {
			t.Fatalf("parameterless model leaked a param: %#v", body)
		}
	})
	t.Run("seedance reference fields and provider keys", func(t *testing.T) {
		body := atlasVideo(t, "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", "cars move",
			map[string]any{"durationSeconds": float64(4), "generateAudio": false}, []string{image}, nil, []string{audio})
		assertBody(t, "seedance", body, map[string]any{
			"model":            "bytedance/seedance-2.0-mini/reference-to-video",
			"reference_images": []string{image}, "reference_audios": []string{audio},
			"duration": float64(4), "generate_audio": false, "resolution": "720p", "ratio": "adaptive", "watermark": false,
		})
	})
	t.Run("gemini defaults", func(t *testing.T) {
		body := atlasVideo(t, "atlas-cloud/google/gemini-omni-flash-reference-to-video", "doll moves", map[string]any{}, []string{image}, nil, nil)
		assertBody(t, "gemini", body, map[string]any{
			"images": []string{image}, "duration": float64(10), "aspect_ratio": "16:9",
			"resolution": "720p", "thinking_level": "default", "seed": float64(-1),
		})
	})

	// —— Skymind：模板参数面 + metadata 下沉 + 参考字段 ——
	t.Run("skymind video template and metadata", func(t *testing.T) {
		model := models["skymind-token/seedance-2.0"]
		params := providerOutput(model, normalizedFor(t, model, map[string]any{"durationSeconds": float64(6), "resolution": "720p", "seed": float64(9)}))
		top, metadata := splitMetadataParams(params)
		body := skymind.BuildVideoPayload(skymind.VideoRequest{
			Model: model.APIModelID, Prompt: "fox turns",
			Images: []string{"https://cdn.recut.video/share/x.png"},
			Videos: []string{"https://cdn.recut.video/share/v.mp4"},
			Params: top, ReferenceFields: model.ReferenceFields, Metadata: metadata,
		})
		assertBody(t, "skymind video", body, map[string]any{
			"model":    "doubao-seedance-2.0",
			"images":   []string{"https://cdn.recut.video/share/x.png"},
			"videos":   []string{"https://cdn.recut.video/share/v.mp4"},
			"duration": float64(6), "resolution": "720p",
			"metadata": map[string]any{"generate_audio": true, "seed": float64(9)},
		})
	})
	t.Run("skymind image template params", func(t *testing.T) {
		model := models["skymind-token/gpt-image-2"]
		body := skymind.BuildImagePayload(skymind.ImageRequest{
			Model: model.APIModelID, Prompt: "a fox",
			Output: providerOutput(model, normalizedFor(t, model, map[string]any{"size": "1024x1024", "quality": "high"})),
		})
		assertBody(t, "skymind image", body, map[string]any{
			"model": "gpt-image-2", "prompt": "a fox", "size": "1024x1024", "quality": "high",
		})
	})

	// —— 语音：平台 reserved 键 → 各 Provider 线协议 ——
	t.Run("atlas speech reserved keys", func(t *testing.T) {
		model := models["atlas-cloud/xai/tts-v1"]
		params := providerOutput(model, normalizedFor(t, model, map[string]any{"voiceId": "ara", "speed": 1.1}))
		if params["voiceId"] != "ara" {
			t.Fatalf("speech reserved key lost: %#v", params)
		}
		body := atlas.BuildSpeechPayload(atlas.SpeechInput{Model: model.APIModelID, Text: "你好", VoiceID: "ara", Speed: 1.1})
		assertBody(t, "atlas speech", body, map[string]any{
			"model": "xai/tts-v1", "text": "你好", "voice_id": "ara", "speed": 1.1,
			"language": "auto", "codec": "mp3", "sample_rate": 24000, "bit_rate": 128000,
		})
	})
	t.Run("minimax speech reserved keys", func(t *testing.T) {
		for _, modelID := range []string{"minimax/speech-2.8-hd", "minimax/speech-2.8-turbo"} {
			model := models[modelID]
			params := providerOutput(model, normalizedFor(t, model, map[string]any{"voiceId": "news"}))
			if params["voiceId"] != "news" {
				t.Fatalf("%s: reserved key lost: %#v", modelID, params)
			}
		}
	})
}

// 类型/enum/范围/未知键校验：错误必须在生成前被 catalog schema 拦下。
func TestCatalogWireContractRejectsInvalidParameters(t *testing.T) {
	models := contractModels(t)
	cases := []struct {
		modelID string
		output  map[string]any
	}{
		{"atlas-cloud/alibaba/wan-2.5/image-to-video", map[string]any{"bogus": float64(1)}},                // 未知键
		{"atlas-cloud/bytedance/seedream-v5.0-pro/text-to-image", map[string]any{"output_format": "webp"}}, // 字符串 enum
		{"atlas-cloud/alibaba/qwen-image/text-to-image-max", map[string]any{"size": "999*999"}},            // enum
		{"atlas-cloud/alibaba/qwen-image/text-to-image-max", map[string]any{"num_images": 1.5}},            // 非整数
		{"atlas-cloud/alibaba/wan-2.5/image-to-video", map[string]any{"duration": float64(7)}},             // 数值 enum 5/10
		{"atlas-cloud/alibaba/wan-2.7/text-to-video", map[string]any{"ratio": "21:9"}},                     // enum
		{"atlas-cloud/alibaba/wan-2.6/video-to-video", map[string]any{"shot_type": "triple"}},              // enum
		{"atlas-cloud/kwaivgi/kling-v2.6-pro/avatar", map[string]any{"seed": float64(1)}},                  // 无参数模型
	}
	for _, testCase := range cases {
		model, ok := models[testCase.modelID]
		if !ok {
			t.Fatalf("model %s missing from contract catalog", testCase.modelID)
		}
		if _, err := normalizeModelOutput(model, testCase.output); err == nil {
			t.Fatalf("%s accepted invalid output %#v", testCase.modelID, testCase.output)
		}
	}
}
