/*
 * [INPUT]: 依赖 Atlas 协议适配器的图片提交与 prediction 轮询
 * [OUTPUT]: Atlas Cloud 原生图片生成策略：提交 generateImage → 轮询 prediction → 下载 outputs[0]
 * [POS]: media/model_providers 的 atlas-cloud 实现；负责把 ImageInput 归一化为 Atlas 协议并取回最终字节
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package model_providers

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"recut-service/media/providers/atlas"
)

const defaultAtlasPollRetries = 60

type atlasCloudProvider struct{}

func init() {
	Register(atlasCloudProvider{})
}

func (atlasCloudProvider) ID() string { return "atlas-cloud" }

// GenerateImage implements the native Atlas Cloud image protocol. Atlas image
// generation is asynchronous: POST /api/v1/model/generateImage returns a
// prediction ID, then GET /api/v1/model/prediction/{id} is polled until
// completed, and the final image URL is outputs[0].
func (atlasCloudProvider) GenerateImage(input ImageInput) (ImageResult, error) {
	images := make([]string, 0, len(input.References))
	for _, reference := range input.References {
		if reference.Kind != "image" || len(reference.Content) == 0 {
			continue
		}
		images = append(images, "data:"+reference.MimeType+";base64,"+base64.StdEncoding.EncodeToString(reference.Content))
	}
	client := input.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	prediction, err := atlas.SubmitImage(client, input.APIBase, input.Secret, atlas.GenerateImageInput{
		Model:  input.Model,
		Prompt: input.Prompt,
		Images: images,
		Output: input.Output,
	})
	if err != nil {
		return ImageResult{}, err
	}
	if input.RecordPrediction != nil {
		if err := input.RecordPrediction(prediction.ID, prediction.PollURL); err != nil {
			return ImageResult{}, err
		}
	}
	pollClient := input.PollClient
	if pollClient == nil {
		pollClient = client
	}
	retries := input.PollRetries
	if retries <= 0 {
		retries = defaultAtlasPollRetries
	}
	for attempt := 0; attempt < retries; attempt++ {
		prediction, err = atlas.Poll(pollClient, input.APIBase, input.Secret, prediction)
		if err != nil {
			return ImageResult{}, err
		}
		if prediction.Failed() {
			return ImageResult{}, errors.New("Atlas Cloud image generation failed: " + prediction.FailureMessage())
		}
		if prediction.Completed() {
			url := prediction.FirstOutput()
			if url == "" {
				return ImageResult{}, errors.New("Atlas Cloud image completed without an output URL")
			}
			return downloadImage(client, url)
		}
		time.Sleep(atlasPollDelay(attempt))
	}
	return ImageResult{}, errors.New("Atlas Cloud image generation did not finish in time")
}

func atlasPollDelay(attempt int) time.Duration {
	delay := 2 * time.Second
	for i := 0; i < attempt && delay < 30*time.Second; i++ {
		delay *= 2
	}
	if delay > 30*time.Second {
		return 30 * time.Second
	}
	return delay
}

const (
	atlasImageDownloadAttempts = 5
	// One attempt must finish within this budget; a slow body read resets it
	// on the next attempt instead of holding one connection for minutes.
	atlasImageDownloadTimeout = 60 * time.Second
	atlasImageDownloadDelay   = 2 * time.Second
)

// downloadImage fetches the completed prediction output with bounded retries.
// Only transport errors and 5xx responses retry; 4xx failures are terminal.
func downloadImage(client *http.Client, url string) (ImageResult, error) {
	var lastErr error
	for attempt := 0; attempt < atlasImageDownloadAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(atlasImageDownloadDelay)
		}
		attemptClient := *client
		attemptClient.Timeout = atlasImageDownloadTimeout
		result, err := downloadImageOnce(&attemptClient, url)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if strings.Contains(err.Error(), "image download returned 4") || strings.Contains(err.Error(), "image download returned 3") {
			return ImageResult{}, err
		}
	}
	return ImageResult{}, lastErr
}

func downloadImageOnce(client *http.Client, url string) (ImageResult, error) {
	response, err := client.Get(url)
	if err != nil {
		return ImageResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ImageResult{}, fmt.Errorf("image download returned %s", response.Status)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, 128<<20))
	if err != nil {
		return ImageResult{}, err
	}
	mimeType := response.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "image/png"
	}
	return ImageResult{Content: content, MimeType: strings.TrimSpace(mimeType)}, nil
}
