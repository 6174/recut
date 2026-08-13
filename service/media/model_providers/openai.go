/*
 * [INPUT]: 依赖标准 HTTP 客户端与解码后的引用字节
 * [OUTPUT]: OpenAI 兼容图片策略：无引用走 JSON /images/generations，有引用走 multipart /images/edits，均返回最终字节
 * [POS]: media/model_providers 的 openai / openai-compatible 实现；与 OpenAI SDK 的 images API 对齐
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package model_providers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

type openAIProvider struct {
	id string
}

func init() {
	Register(openAIProvider{id: "openai"})
	Register(openAIProvider{id: "openai-compatible"})
}

func (provider openAIProvider) ID() string { return provider.id }

// GenerateImage matches the OpenAI images API: one synchronous POST that
// returns the final image (base64 or URL) directly. Reference images use the
// multipart /images/edits variant.
func (provider openAIProvider) GenerateImage(input ImageInput) (ImageResult, error) {
	base := strings.TrimRight(input.APIBase, "/")
	if base == "" {
		return ImageResult{}, fmt.Errorf("%s API address is required", provider.id)
	}
	payload := map[string]any{"model": input.Model, "prompt": input.Prompt, "n": 1, "response_format": "b64_json"}
	for _, key := range []string{"size", "quality", "background"} {
		if value, ok := input.Output[key]; ok {
			payload[key] = value
		}
	}
	var body io.Reader
	var contentType string
	endpoint := "/images/generations"
	if len(input.References) == 0 {
		encoded, _ := json.Marshal(payload)
		body = bytes.NewReader(encoded)
		contentType = "application/json"
	} else {
		var buffer bytes.Buffer
		writer := multipart.NewWriter(&buffer)
		for key, value := range payload {
			if err := writer.WriteField(key, fmt.Sprint(value)); err != nil {
				return ImageResult{}, err
			}
		}
		for _, reference := range input.References {
			if reference.Kind != "image" || len(reference.Content) == 0 {
				continue
			}
			part, err := writer.CreateFormFile("image[]", reference.Name)
			if err != nil {
				return ImageResult{}, err
			}
			if _, err := part.Write(reference.Content); err != nil {
				return ImageResult{}, err
			}
		}
		if err := writer.Close(); err != nil {
			return ImageResult{}, err
		}
		body = &buffer
		contentType = writer.FormDataContentType()
		endpoint = "/images/edits"
	}
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, base+endpoint, body)
	if err != nil {
		return ImageResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+input.Secret)
	request.Header.Set("Content-Type", contentType)
	client := input.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return ImageResult{}, err
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ImageResult{}, fmt.Errorf("provider returned %s: %s", response.Status, string(responseBody))
	}
	result := struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}{}
	if err := json.Unmarshal(responseBody, &result); err != nil || len(result.Data) == 0 {
		return ImageResult{}, errors.New("provider returned no image")
	}
	image := result.Data[0]
	var content []byte
	if image.B64JSON != "" {
		content, err = base64.StdEncoding.DecodeString(image.B64JSON)
	} else if image.URL != "" {
		content, err = fetchImageBytes(input.HTTPClient, image.URL)
	} else {
		err = errors.New("provider returned no image data")
	}
	if err != nil {
		return ImageResult{}, err
	}
	return ImageResult{Content: content, MimeType: "image/png"}, nil
}

func fetchImageBytes(client *http.Client, url string) ([]byte, error) {
	response, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("media download returned %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 128<<20))
}
