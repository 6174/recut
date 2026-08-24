/*
 * [INPUT]: 依赖 httptest 模拟的 Skymind 网关（双错误信封、统一任务状态机、/content 流）
 * [OUTPUT]: 对外提供协议适配器的 L1 行为验证：提交/轮询/下载线协议、b64 图片回收、
 *          双错误信封归一与 FriendlyError 映射、metadata 透传
 * [POS]: media/providers/skymind 的单测边界；不触碰网络与 Recut Store
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package skymind

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSubmitImageReturnsB64BytesAndUsage(t *testing.T) {
	png := []byte{0x89, 'P', 'N', 'G', 1, 2, 3}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("missing bearer auth: %q", r.Header.Get("Authorization"))
		}
		if r.URL.Path != "/v1/images/generations" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		if payload["model"] != "gpt-image-2" || payload["response_format"] != "b64_json" {
			t.Errorf("unexpected payload: %s", body)
		}
		response := map[string]any{
			"data":  []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(png)}},
			"usage": map[string]any{"total_tokens": 214},
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	result, err := SubmitImage(server.Client(), server.URL, "sk-test", ImageRequest{Model: "gpt-image-2", Prompt: "a fox", Output: map[string]any{"size": "1024x1024"}})
	if err != nil {
		t.Fatalf("SubmitImage: %v", err)
	}
	if string(result.Content) != string(png) || result.MimeType != "image/png" {
		t.Fatalf("image result mismatch: %q %s", result.Content, result.MimeType)
	}
	if result.Usage["total_tokens"] != float64(214) {
		t.Fatalf("usage not carried: %v", result.Usage)
	}
}

func TestSubmitVideoSendsUnifiedPayloadWithMetadata(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &received)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "task_abc", "task_id": "task_abc", "object": "video",
			"model": "doubao-seedance-2.0", "status": "queued", "progress": 0, "created_at": 1753948800,
		})
	}))
	defer server.Close()
	task, err := SubmitVideo(server.Client(), server.URL, "sk-test", VideoRequest{
		Model: "doubao-seedance-2.0", Prompt: "a fox turning",
		Images:     []string{"https://share.recut.video/tok/fox.png"},
		Resolution: "480p", Ratio: "16:9", Duration: 5,
		Metadata: map[string]any{"generate_audio": true, "seed": 42},
	})
	if err != nil {
		t.Fatalf("SubmitVideo: %v", err)
	}
	if task.ID != "task_abc" || !task.Queued() {
		t.Fatalf("unexpected task: %+v", task)
	}
	if received["model"] != "doubao-seedance-2.0" || received["duration"] != float64(5) {
		t.Fatalf("unexpected wire payload: %v", received)
	}
	if images, ok := received["images"].([]any); !ok || len(images) != 1 {
		t.Fatalf("images not forwarded: %v", received["images"])
	}
	metadata, ok := received["metadata"].(map[string]any)
	if !ok || metadata["generate_audio"] != true || metadata["seed"] != float64(42) {
		t.Fatalf("metadata not forwarded: %v", received["metadata"])
	}
	if _, present := received["videos"]; present {
		t.Fatalf("empty videos must be omitted: %v", received)
	}
}

func TestPollVideoNormalizesStatusAndExtra(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/openapi/v1/video/generations/task_abc" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "task_abc", "model": "doubao-seedance-2-5-260628", "status": "succeeded",
			"content": map[string]any{"video_url": "https://tos.example/video.mp4?sig=x"},
			"usage":   map[string]any{"total_tokens": 48437},
			"seed":    94620, "resolution": "480p", "duration": 5, "ratio": "16:9",
			"framespersecond": 24, "output_format": "mp4", "generate_audio": true,
			"created_at": 1753948800, "updated_at": 1753948923,
		})
	}))
	defer server.Close()
	task, err := PollVideo(server.Client(), server.URL, "sk-test", "task_abc")
	if err != nil {
		t.Fatalf("PollVideo: %v", err)
	}
	if !task.Succeeded() || task.VideoURL != "https://tos.example/video.mp4?sig=x" {
		t.Fatalf("unexpected task: %+v", task)
	}
	if task.Extra["seed"] != 94620 || task.Extra["resolution"] != "480p" || task.Extra["generate_audio"] != true {
		t.Fatalf("extra fields missing: %v", task.Extra)
	}
}

func TestPollVideoFailedCarriesUpstreamError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "task_abc", "model": "doubao-seedance-2.0", "status": "failed",
			"error": map[string]any{"code": "InvalidParameter", "message": "参考图片无法访问，请更换图片链接后重试"},
		})
	}))
	defer server.Close()
	task, err := PollVideo(server.Client(), server.URL, "sk-test", "task_abc")
	if err != nil {
		t.Fatalf("PollVideo: %v", err)
	}
	if !task.Failed() || task.ErrorCode != "InvalidParameter" || task.FailureMessage() == "" {
		t.Fatalf("unexpected failure task: %+v", task)
	}
}

func TestFetchVideoStreamsMP4(t *testing.T) {
	mp4 := []byte{0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p'}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/openapi/v1/video/generations/task_abc/content" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write(mp4)
	}))
	defer server.Close()
	content, err := FetchVideo(server.Client(), server.URL, "sk-test", "task_abc")
	if err != nil {
		t.Fatalf("FetchVideo: %v", err)
	}
	if string(content) != string(mp4) {
		t.Fatalf("content mismatch: %q", content)
	}
}

func TestProviderErrorNormalizesBothEnvelopes(t *testing.T) {
	// OpenAI-compatible envelope.
	openAI := ProviderError{}
	data := []byte(`{"error":{"code":"model_not_found","message":"No available channel for model seedance-2.5 under group default (distributor)","type":"new_api_error"}}`)
	if err := providerError(404, data); err == nil {
		t.Fatal("expected error")
	}
	openAI = providerError(404, data).(ProviderError)
	if openAI.Code != "model_not_found" || openAI.Status != 404 {
		t.Fatalf("openai envelope not normalized: %+v", openAI)
	}
	if got := FriendlyError(openAI); got != "该模型在当前 Skymind 账号/分组未开通（No available channel for model seedance-2.5 under group default (distributor)）" {
		t.Fatalf("friendly mapping wrong: %s", got)
	}
	// Unified task envelope.
	data = []byte(`{"code":"insufficient_user_quota","message":"预扣费额度失败, 用户剩余额度: ¥99.99","data":null}`)
	unified := providerError(400, data).(ProviderError)
	if unified.Code != "insufficient_user_quota" {
		t.Fatalf("unified envelope not normalized: %+v", unified)
	}
	if got := FriendlyError(errors.New("wrap: " + unified.Error())); got == "" {
		t.Fatal("expected friendly message")
	}
	// Non-JSON body.
	raw := providerError(502, []byte("bad gateway"))
	if raw.(ProviderError).Code != "http_502" {
		t.Fatalf("raw body not wrapped: %+v", raw)
	}
}

func TestSubmitVideoRejectsReferenceDataURLAtGateway(t *testing.T) {
	// Mirrors the measured gateway behavior: data URLs are rejected at
	// submission with invalid_reference_image_url (no billing).
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"invalid_reference_image_url","message":"reference image URL is invalid","data":null}`))
	}))
	defer server.Close()
	_, err := SubmitVideo(server.Client(), server.URL, "sk-test", VideoRequest{
		Model: "doubao-seedance-2.0", Prompt: "x", Images: []string{"data:image/png;base64,AAA"},
	})
	if err == nil {
		t.Fatal("expected data URL rejection")
	}
	providerErr, ok := err.(ProviderError)
	if !ok || providerErr.Code != "invalid_reference_image_url" {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := FriendlyError(err); got != "参考素材 URL 无效：Skymind 只接受公网可访问的图片 URL" {
		t.Fatalf("friendly mapping wrong: %s", got)
	}
}
