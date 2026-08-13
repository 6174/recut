/*
 * [INPUT]: 依赖 Atlas/OpenAI 策略与受控 HTTP 测试服务器
 * [OUTPUT]: 验证策略注册表、Atlas 原生预测提交/轮询/下载、OpenAI 兼容 JSON 与 multipart 路径
 * [POS]: model_providers 的策略回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package model_providers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRegistryForwardsAtlasCloud(t *testing.T) {
	provider, ok := For("atlas-cloud")
	if !ok || provider.ID() != "atlas-cloud" {
		t.Fatalf("atlas-cloud strategy = %#v, %v", provider, ok)
	}
}

func TestRegistryForwardsOpenAIAndCompatible(t *testing.T) {
	for _, id := range []string{"openai", "openai-compatible"} {
		provider, ok := For(id)
		if !ok || provider.ID() != id {
			t.Fatalf("%s strategy = %#v, %v", id, provider, ok)
		}
	}
}

func TestAtlasImageSubmitsPollsAndDownloads(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/model/generateImage":
			if request.Header.Get("Authorization") != "Bearer atlas-key" {
				t.Fatalf("missing auth on submit: %s", request.URL)
			}
			body, _ := io.ReadAll(request.Body)
			var payload map[string]any
			_ = json.Unmarshal(body, &payload)
			if payload["model"] != "openai/gpt-image-2/text-to-image" || payload["prompt"] != "a fox" {
				t.Fatalf("unexpected submit payload: %#v", payload)
			}
			if payload["size"] != "1024x1024" {
				t.Fatalf("submit must forward size: %#v", payload)
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": map[string]any{
				"id":     "pred-1",
				"status": "processing",
				"urls":   map[string]any{"get": server.URL + "/api/v1/model/prediction/pred-1"},
			}})
		case "/api/v1/model/prediction/pred-1":
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": map[string]any{
				"id":      "pred-1",
				"status":  "completed",
				"outputs": []string{server.URL + "/output.png"},
			}})
		case "/output.png":
			writer.Header().Set("Content-Type", "image/png")
			_, _ = writer.Write([]byte("png-bytes"))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	client := server.Client()
	result, err := (atlasCloudProvider{}).GenerateImage(ImageInput{
		Model:      "openai/gpt-image-2/text-to-image",
		Prompt:     "a fox",
		Output:     map[string]any{"size": "1024x1024"},
		APIBase:    server.URL,
		Secret:     "atlas-key",
		HTTPClient: client,
		PollClient: client,
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(result.Content) != "png-bytes" || result.MimeType != "image/png" {
		t.Fatalf("atlas image result = %#v", result)
	}
}

func TestAtlasImageEditUsesEditVariantAndReferenceImages(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/model/generateImage":
			body, _ := io.ReadAll(request.Body)
			var payload map[string]any
			_ = json.Unmarshal(body, &payload)
			if payload["model"] != "openai/gpt-image-2/edit" {
				t.Fatalf("edit generation must use the edit variant, got %#v", payload["model"])
			}
			images, ok := payload["images"].([]any)
			if !ok || len(images) != 1 || !strings.HasPrefix(images[0].(string), "data:image/png;base64,") {
				t.Fatalf("edit generation must pass reference images as data URLs: %#v", payload)
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": map[string]any{
				"id":     "pred-edit",
				"status": "processing",
				"urls":   map[string]any{"get": server.URL + "/api/v1/model/prediction/pred-edit"},
			}})
		case "/api/v1/model/prediction/pred-edit":
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": map[string]any{
				"id":      "pred-edit",
				"status":  "completed",
				"outputs": []string{server.URL + "/edited.png"},
			}})
		case "/edited.png":
			writer.Header().Set("Content-Type", "image/png")
			_, _ = writer.Write([]byte("edited-bytes"))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	client := server.Client()
	result, err := (atlasCloudProvider{}).GenerateImage(ImageInput{
		Model:      "openai/gpt-image-2/edit",
		Prompt:     "make it red",
		References: []ImageReference{{Kind: "image", Name: "base.png", MimeType: "image/png", Content: []byte("base")}},
		APIBase:    server.URL,
		Secret:     "atlas-key",
		HTTPClient: client,
		PollClient: client,
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(result.Content) != "edited-bytes" {
		t.Fatalf("atlas edit result = %#v", result)
	}
}

func TestAtlasImageSurfacesProviderFailure(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/model/generateImage":
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": map[string]any{
				"id":     "pred-fail",
				"status": "processing",
				"urls":   map[string]any{"get": server.URL + "/api/v1/model/prediction/pred-fail"},
			}})
		case "/api/v1/model/prediction/pred-fail":
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": map[string]any{
				"id":     "pred-fail",
				"status": "failed",
				"error":  "insufficient balance",
			}})
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	_, err := (atlasCloudProvider{}).GenerateImage(ImageInput{
		Model:      "openai/gpt-image-2/text-to-image",
		Prompt:     "a fox",
		APIBase:    server.URL,
		Secret:     "atlas-key",
		HTTPClient: server.Client(),
		PollClient: server.Client(),
	})
	if err == nil || !strings.Contains(err.Error(), "insufficient balance") {
		t.Fatalf("atlas failure error = %v", err)
	}
}

func TestOpenAIImageJSONWithoutReferences(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/images/generations" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer openai-key" {
			t.Fatalf("missing auth: %s", request.URL)
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []map[string]any{{"b64_json": "aGVsbG8="}}})
	}))
	defer server.Close()

	result, err := (openAIProvider{id: "openai-compatible"}).GenerateImage(ImageInput{
		Model:      "gpt-image-2",
		Prompt:     "a cat",
		APIBase:    server.URL,
		Secret:     "openai-key",
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(result.Content) != "hello" {
		t.Fatalf("openai image content = %q", result.Content)
	}
}

func TestOpenAIImageMultipartWithReferences(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/images/edits" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if !strings.HasPrefix(request.Header.Get("Content-Type"), "multipart/form-data") {
			t.Fatalf("content type = %s", request.Header.Get("Content-Type"))
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []map[string]any{{"b64_json": "Y2F0"}}})
	}))
	defer server.Close()

	result, err := (openAIProvider{id: "openai"}).GenerateImage(ImageInput{
		Model:      "gpt-image-2",
		Prompt:     "edit the cat",
		APIBase:    server.URL,
		Secret:     "openai-key",
		References: []ImageReference{{Kind: "image", Name: "cat.png", MimeType: "image/png", Content: []byte("ref")}},
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(result.Content) != "cat" {
		t.Fatalf("openai edited image content = %q", result.Content)
	}
}
