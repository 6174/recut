/*
 * [INPUT]: 依赖 Atlas 适配器的内部请求映射与受控 HTTP 测试客户端
 * [OUTPUT]: 验证 Atlas payload、默认地址、异步终态和上传媒体协议
 * [POS]: atlas provider 的协议回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package atlas

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGeminiPayloadUsesOnlyImageReferences(t *testing.T) {
	payload, err := payloadFor(GenerateInput{Model: GeminiOmniReferenceToVideo, Prompt: "a moving doll", Images: []string{"data:image/png;base64,aW1hZ2U="}, Output: map[string]any{"durationSeconds": 3, "aspectRatio": "9:16", "thinkingLevel": "high"}})
	if err != nil {
		t.Fatal(err)
	}
	if payload["model"] != GeminiOmniReferenceToVideo || len(payload["images"].([]string)) != 1 || payload["duration"] != 3 || payload["aspect_ratio"] != "9:16" || payload["thinking_level"] != "high" {
		t.Fatalf("unexpected Gemini payload: %#v", payload)
	}
	if _, err := payloadFor(GenerateInput{Model: GeminiOmniReferenceToVideo, Prompt: "a moving doll", Images: []string{"image"}, Audios: []string{"audio"}}); err == nil {
		t.Fatal("Gemini payload accepted an audio reference")
	}
}

func TestSeedancePayloadMapsImagesVideosAndAudio(t *testing.T) {
	payload, err := payloadFor(GenerateInput{Model: SeedanceMiniReferenceToVideo, Prompt: "make the cars move", Images: []string{"image-1", "image-2"}, Videos: []string{"https://atlas.example/reference.mp4"}, Audios: []string{"data:audio/mpeg;base64,YXVkaW8="}, Output: map[string]any{"durationSeconds": 4, "resolution": "1080p-SR", "aspectRatio": "16:9", "bitrateMode": "high", "generateAudio": false, "returnLastFrame": true, "seed": 7}})
	if err != nil {
		t.Fatal(err)
	}
	if len(payload["reference_images"].([]string)) != 2 || len(payload["reference_videos"].([]string)) != 1 || len(payload["reference_audios"].([]string)) != 1 || payload["resolution"] != "1080p-SR" || payload["generate_audio"] != false || payload["return_last_frame"] != true {
		t.Fatalf("unexpected Seedance payload: %#v", payload)
	}
}

func TestSeedancePayloadEnablesSynchronizedAudioByDefault(t *testing.T) {
	payload, err := payloadFor(GenerateInput{Model: SeedanceMiniReferenceToVideo, Prompt: "make the cars move", Images: []string{"image"}})
	if err != nil {
		t.Fatal(err)
	}
	if payload["generate_audio"] != true {
		t.Fatalf("generate_audio = %#v, want true", payload["generate_audio"])
	}
}

func TestAtlasPayloadRejectsUnsupportedOutputOptions(t *testing.T) {
	for _, input := range []GenerateInput{
		{Model: SeedanceMiniReferenceToVideo, Prompt: "move", Images: []string{"image"}, Output: map[string]any{"durationSeconds": 3}},
		{Model: SeedanceMiniReferenceToVideo, Prompt: "move", Images: []string{"image"}, Output: map[string]any{"resolution": "1080p"}},
		{Model: GeminiOmniReferenceToVideo, Prompt: "move", Images: []string{"image"}, Output: map[string]any{"durationSeconds": 11}},
		{Model: GeminiOmniReferenceToVideo, Prompt: "move", Images: []string{"image"}, Output: map[string]any{"aspectRatio": "1:1"}},
		{Model: GeminiOmniReferenceToVideo, Prompt: "move", Images: []string{"image"}, Output: map[string]any{"thinkingLevel": "maximum"}},
	} {
		if _, err := payloadFor(input); err == nil {
			t.Fatalf("unsupported output was accepted: %#v", input.Output)
		}
	}
}

func TestGenerateUsesDefaultBaseAndAcceptsSucceeded(t *testing.T) {
	requests := 0
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.String() != DefaultAPIBase+"/api/v1/model/generateVideo" || request.Header.Get("Authorization") != "Bearer atlas-key" {
			t.Fatalf("unexpected Atlas request: %s %#v", request.URL, request.Header)
		}
		return jsonResponse(`{"data":{"id":"prediction-1","status":"succeeded","outputs":["https://cdn.example/video.mp4"]}}`), nil
	})}
	result, err := Generate(client, "", "atlas-key", GenerateInput{Model: GeminiOmniReferenceToVideo, Prompt: "move", Images: []string{"image"}}, time.Second)
	if err != nil || result.VideoURL != "https://cdn.example/video.mp4" || requests != 1 {
		t.Fatalf("Generate() = %#v, %v, requests=%d", result, err, requests)
	}
}

func TestUploadMediaReturnsAtlasDownloadURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/model/uploadMedia" || request.Header.Get("Authorization") != "Bearer atlas-key" {
			t.Fatalf("unexpected upload request: %s", request.URL)
		}
		if err := request.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		file, header, err := request.FormFile("file")
		if err != nil || header.Filename != "reference.mp4" {
			t.Fatalf("uploaded file = %#v, %v", header, err)
		}
		defer file.Close()
		content, _ := io.ReadAll(file)
		if string(content) != "video" {
			t.Fatalf("uploaded content = %q", content)
		}
		_, _ = w.Write([]byte(`{"data":{"download_url":"https://storage.example/reference.mp4"}}`))
	}))
	defer server.Close()
	url, err := UploadMedia(server.Client(), server.URL, "atlas-key", MediaUpload{Name: "reference.mp4", ContentType: "video/mp4", Content: []byte("video")})
	if err != nil || url != "https://storage.example/reference.mp4" {
		t.Fatalf("UploadMedia() = %q, %v", url, err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func jsonResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}
