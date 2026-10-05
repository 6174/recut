/*
 * [INPUT]: 依赖 WaveSpeed 协议的提交、prediction 轮询与结果下载
 * [OUTPUT]: WaveSpeed 图片生成策略：提交 POST /api/v3/{model} → 按墙钟预算轮询 prediction（任何状态查询错误都在预算内自动重试，绝不因一次 poll 失败误判任务）→ 下载 outputs[0]
 * [POS]: media/model_providers 的 wavespeed 实现；负责把 ImageInput 归一化为 WaveSpeed 统一预测协议并取回最终字节
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package model_providers

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"recut-service/media/providers/wavespeed"
)

const defaultWavespeedPollBudget = 30 * time.Minute

type wavespeedProvider struct{}

func init() {
	Register(wavespeedProvider{})
}

func (wavespeedProvider) ID() string { return "wavespeed" }

// GenerateImage implements the WaveSpeed unified prediction protocol. Image
// generation is asynchronous: POST /api/v3/{model} returns a prediction ID,
// then the result endpoint is polled until completed, and the final image URL
// is outputs[0].
func (wavespeedProvider) GenerateImage(input ImageInput) (ImageResult, error) {
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
	prediction, err := wavespeed.Submit(client, input.APIBase, input.Secret, wavespeed.GenerateInput{
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
		if err := input.RecordPrediction(PredictionCheckpoint{
			RemoteID: prediction.ID,
			PollURL:  prediction.PollURL,
			Metadata: wavespeedResultMetadata(prediction),
		}); err != nil {
			return ImageResult{}, err
		}
	}
	pollClient := input.PollClient
	if pollClient == nil {
		pollClient = client
	}
	budget := input.PollBudget
	if budget <= 0 {
		budget = defaultWavespeedPollBudget
	}
	// Bound by wall-clock, not by a retry count: WaveSpeed owns how long it
	// queues the prediction, so the only decision left to us is how long to
	// wait. A status read can fail without saying anything about the remote
	// prediction, so never fail a paid task on one poll error — keep re-reading
	// within the budget. Only an explicit terminal failure or the budget
	// running out ends it.
	deadline := time.Now().Add(budget)
	pollErrorAttempt := 0
	for attempt := 0; ; attempt++ {
		next, pollErr := wavespeed.Poll(pollClient, input.APIBase, input.Secret, prediction)
		if pollErr != nil {
			err = pollErr
			pollErrorAttempt++
		} else {
			err = nil
			pollErrorAttempt = 0
			prediction = next
			if prediction.Failed() {
				return ImageResult{}, wavespeed.TerminalFailure{Message: "WaveSpeed image generation failed: " + prediction.FailureMessage()}
			}
			if prediction.Completed() {
				url := prediction.FirstOutput()
				if url == "" {
					return ImageResult{}, wavespeed.TerminalFailure{Message: "WaveSpeed image completed without an output URL"}
				}
				result, err := downloadWavespeedOutput(client, url)
				if err != nil {
					return ImageResult{}, err
				}
				result.Metadata = wavespeedResultMetadata(prediction)
				return result, nil
			}
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			if err != nil {
				return ImageResult{}, err
			}
			break
		}
		delay := wavespeedPollDelay(attempt)
		if pollErrorAttempt > 0 {
			delay = wavespeedTransientPollDelay(pollErrorAttempt)
		}
		if delay < remaining {
			time.Sleep(delay)
		} else {
			time.Sleep(remaining)
		}
	}
	return ImageResult{}, errors.New("WaveSpeed image generation did not finish in time")
}

func wavespeedResultMetadata(prediction wavespeed.Prediction) map[string]any {
	metadata := map[string]any{"providerTaskId": prediction.ID}
	if strings.TrimSpace(prediction.ID) != "" {
		metadata["providerTaskUrl"] = "https://wavespeed.ai/predictions/" + prediction.ID
	}
	if output := prediction.FirstOutput(); output != "" {
		metadata["providerOutputUrl"] = output
	}
	return metadata
}

func wavespeedPollDelay(attempt int) time.Duration {
	delay := 2 * time.Second
	for i := 0; i < attempt && delay < 30*time.Second; i++ {
		delay *= 2
	}
	if delay > 30*time.Second {
		return 30 * time.Second
	}
	return delay
}

func wavespeedTransientPollDelay(attempt int) time.Duration {
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
	wavespeedDownloadAttempts = 5
	wavespeedDownloadTimeout  = 60 * time.Second
	wavespeedDownloadDelay    = 2 * time.Second
)

// downloadWavespeedOutput fetches the completed prediction output with bounded
// retries. Only transport errors and 5xx responses retry; 4xx failures are
// terminal.
func downloadWavespeedOutput(client *http.Client, url string) (ImageResult, error) {
	var lastErr error
	for attempt := 0; attempt < wavespeedDownloadAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(wavespeedDownloadDelay)
		}
		attemptClient := *client
		attemptClient.Timeout = wavespeedDownloadTimeout
		result, err := downloadWavespeedOutputOnce(&attemptClient, url)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if strings.Contains(err.Error(), "download returned 4") || strings.Contains(err.Error(), "download returned 3") {
			return ImageResult{}, err
		}
	}
	return ImageResult{}, lastErr
}

func downloadWavespeedOutputOnce(client *http.Client, url string) (ImageResult, error) {
	response, err := client.Get(url)
	if err != nil {
		return ImageResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ImageResult{}, errors.New("image download returned " + response.Status)
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
