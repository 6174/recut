/*
 * [INPUT]: 依赖 Atlas 协议适配器的图片提交与 prediction 轮询
 * [OUTPUT]: Atlas Cloud 原生图片生成策略：提交 generateImage → 轮询 prediction（任何状态查询错误都在墙钟预算内自动重试，绝不因一次 poll 失败误判任务）→ 下载 outputs[0]
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

const defaultAtlasPollBudget = 30 * time.Minute

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
		Model:           input.Model,
		Prompt:          input.Prompt,
		Images:          images,
		Params:          input.Output,
		ReferenceFields: input.ReferenceFields,
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
	budget := input.PollBudget
	if budget <= 0 {
		budget = defaultAtlasPollBudget
	}
	// Bound by wall-clock, not by a retry count: Atlas owns how long it queues
	// the prediction, so the only decision left to us is how long to wait. The
	// last sleep is capped at the remaining budget so a spent budget returns
	// immediately instead of sleeping one more interval first.
	deadline := time.Now().Add(budget)
	pollErrorAttempt := 0
	for attempt := 0; ; attempt++ {
		next, pollErr := atlas.Poll(pollClient, input.APIBase, input.Secret, prediction)
		if pollErr != nil {
			// A status read can fail without saying anything about the remote
			// prediction: a dropped keep-alive connection, a gateway 5xx, or a
			// truncated body all surface here. The prediction is already
			// checkpointed and paid for, so never fail it on one poll error —
			// keep re-reading within the wall-clock budget. Only Atlas explicitly
			// reporting the prediction failed, or the budget running out, ends it.
			err = pollErr
			pollErrorAttempt++
		} else {
			err = nil
			pollErrorAttempt = 0
			prediction = next
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
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			if err != nil {
				return ImageResult{}, err
			}
			break
		}
		delay := atlasPollDelay(attempt)
		if pollErrorAttempt > 0 {
			// A read blip is not a queueing signal: probe again promptly
			// instead of waiting a full poll interval while status is unknown.
			delay = atlasTransientPollDelay(pollErrorAttempt)
		}
		if delay < remaining {
			time.Sleep(delay)
		} else {
			time.Sleep(remaining)
		}
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

// atlasTransientPollDelay backs off consecutive transient read failures starting
// from a short base so a merely dropped connection is retried promptly.
func atlasTransientPollDelay(attempt int) time.Duration {
	delay := 250 * time.Millisecond
	for i := 1; i < attempt && delay < 30*time.Second; i++ {
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
