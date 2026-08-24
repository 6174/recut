/*
 * [INPUT]: 依赖标准 HTTP 客户端、Skymind Token API Bearer 凭据（sk- key）及公网参考素材 URL
 * [OUTPUT]: 对外提供统一任务协议的图片生成（OpenAI 兼容 /v1/images/generations）、视频任务
 *          提交/查询/下载（/openapi/v1/video/generations 族）与供应商错误归一（双错误信封 → 单一
 *          ProviderError + 可操作中文提示）
 * [POS]: media/providers/skymind 的协议适配器；只负责线协议与供应商响应归一化，不访问 Recut 的
 *        Store、任务或 Asset，不持有分享/上传能力（公网 URL 由 media 层发布后传入）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package skymind

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// DefaultAPIBase is the Skymind Token API gateway (one interface for every
// model). Credentials may override it per provider connection.
const DefaultAPIBase = "https://token-api.skymind.pro"

// ProviderError is the normalized wire error. The gateway mixes two envelopes:
// OpenAI-compatible endpoints return {"error":{"code","message","type"}} while
// the unified task endpoints return {"code","message","data"}. Both funnel
// here so the media layer maps to user-facing messages in one place.
type ProviderError struct {
	Code    string
	Message string
	Status  int
}

func (e ProviderError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("skymind %s: %s", e.Code, e.Message)
	}
	return fmt.Sprintf("skymind: %s", e.Message)
}

// ImageResult is the final image a synchronous request returned.
type ImageResult struct {
	Content  []byte
	MimeType string
	Usage    map[string]any
}

// ImageRequest is one synchronous image generation.
type ImageRequest struct {
	Model  string
	Prompt string
	Output map[string]any
}

// VideoTask is the durable remote-task handle. Status transitions:
// queued -> running -> succeeded | failed (gateway wording, not OpenAI's
// in_progress/completed). Missing fields simply stay zero: the gateway only
// returns usage/seed/resolution once they exist.
type VideoTask struct {
	ID           string
	Model        string
	Status       string
	VideoURL     string
	ErrorCode    string
	ErrorMessage string
	Usage        map[string]any
	// Extra carries provider-observed fields (seed, resolution, duration,
	// ratio, framespersecond, output_format, generate_audio, ...) for Asset
	// metadata; keys are the gateway's snake_case names.
	Extra map[string]any
}

func (t VideoTask) Queued() bool    { return t.Status == "queued" || t.Status == "running" }
func (t VideoTask) Succeeded() bool { return t.Status == "succeeded" }
func (t VideoTask) Failed() bool    { return t.Status == "failed" }

// FailureMessage is the terminal error text for Asset/job records.
func (t VideoTask) FailureMessage() string {
	if strings.TrimSpace(t.ErrorMessage) != "" {
		return t.ErrorMessage
	}
	return "skymind video task failed"
}

// VideoRequest is the unified video-generation submission. Images/Videos/Audios
// must already be public URLs (the gateway rejects data URLs with
// invalid_reference_image_url); publishing them is the media layer's job.
type VideoRequest struct {
	Model      string
	Prompt     string
	Images     []string
	Videos     []string
	Audios     []string
	Resolution string
	Ratio      string
	Duration   int
	Metadata   map[string]any
}

// SubmitImage performs POST /v1/images/generations and returns the final image
// bytes (b64_json preferred, URL fallback). One request, one image.
func SubmitImage(client *http.Client, baseURL, secret string, input ImageRequest) (ImageResult, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return ImageResult{}, errors.New("skymind image prompt is required")
	}
	payload := map[string]any{"model": input.Model, "prompt": input.Prompt, "n": 1, "response_format": "b64_json"}
	for _, key := range []string{"size", "quality", "background"} {
		if value, ok := input.Output[key]; ok {
			payload[key] = value
		}
	}
	body, _ := json.Marshal(payload)
	response, err := do(client, baseURL, secret, http.MethodPost, "/v1/images/generations", bytes.NewReader(body))
	if err != nil {
		return ImageResult{}, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ImageResult{}, providerError(response.StatusCode, data)
	}
	result := struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
		Usage map[string]any `json:"usage"`
	}{}
	if err := json.Unmarshal(data, &result); err != nil || len(result.Data) == 0 {
		return ImageResult{}, errors.New("skymind returned no image")
	}
	item := result.Data[0]
	var content []byte
	if item.B64JSON != "" {
		content, err = base64.StdEncoding.DecodeString(item.B64JSON)
	} else if item.URL != "" {
		content, err = fetchBytes(client, item.URL)
	} else {
		err = errors.New("skymind returned no image data")
	}
	if err != nil {
		return ImageResult{}, err
	}
	return ImageResult{Content: content, MimeType: "image/png", Usage: result.Usage}, nil
}

// SubmitVideo performs POST /openapi/v1/video/generations. A 2xx response means
// the task was accepted (and pre-billed); the caller must persist the returned
// task ID before polling begins.
func SubmitVideo(client *http.Client, baseURL, secret string, input VideoRequest) (VideoTask, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return VideoTask{}, errors.New("skymind video prompt is required")
	}
	payload := map[string]any{"model": input.Model, "prompt": input.Prompt}
	if len(input.Images) > 0 {
		payload["images"] = input.Images
	}
	if len(input.Videos) > 0 {
		payload["videos"] = input.Videos
	}
	if len(input.Audios) > 0 {
		payload["audios"] = input.Audios
	}
	if input.Resolution != "" {
		payload["resolution"] = input.Resolution
	}
	if input.Ratio != "" {
		payload["ratio"] = input.Ratio
	}
	if input.Duration != 0 {
		payload["duration"] = input.Duration
	}
	if len(input.Metadata) > 0 {
		payload["metadata"] = input.Metadata
	}
	body, _ := json.Marshal(payload)
	response, err := do(client, baseURL, secret, http.MethodPost, "/openapi/v1/video/generations", bytes.NewReader(body))
	if err != nil {
		return VideoTask{}, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return VideoTask{}, providerError(response.StatusCode, data)
	}
	task := taskWire{}
	if err := json.Unmarshal(data, &task); err != nil {
		return VideoTask{}, fmt.Errorf("skymind video submission is invalid: %w", err)
	}
	result := task.toTask()
	if strings.TrimSpace(result.ID) == "" {
		return VideoTask{}, errors.New("skymind video submission returned no task ID")
	}
	return result, nil
}

// PollVideo performs one GET /openapi/v1/video/generations/{task_id} read. It
// never sleeps; task ownership belongs to the durable caller.
func PollVideo(client *http.Client, baseURL, secret, taskID string) (VideoTask, error) {
	if strings.TrimSpace(taskID) == "" {
		return VideoTask{}, errors.New("skymind task ID is required")
	}
	response, err := do(client, baseURL, secret, http.MethodGet, "/openapi/v1/video/generations/"+taskID, nil)
	if err != nil {
		return VideoTask{}, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return VideoTask{}, providerError(response.StatusCode, data)
	}
	task := taskWire{}
	if err := json.Unmarshal(data, &task); err != nil {
		return VideoTask{}, fmt.Errorf("skymind video task response is invalid: %w", err)
	}
	result := task.toTask()
	result.Extra = task.extraFields()
	return result, nil
}

// FetchVideo downloads the finished video via GET
// /openapi/v1/video/generations/{task_id}/content. Measured byte-identical to
// content.video_url and immune to the 24h TOS signature expiry; the media
// layer falls back to VideoURL when this endpoint misbehaves.
func FetchVideo(client *http.Client, baseURL, secret, taskID string) ([]byte, error) {
	if strings.TrimSpace(taskID) == "" {
		return nil, errors.New("skymind task ID is required")
	}
	response, err := do(client, baseURL, secret, http.MethodGet, "/openapi/v1/video/generations/"+taskID+"/content", nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
		return nil, providerError(response.StatusCode, data)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, 1<<30))
	if err != nil {
		return nil, err
	}
	if len(content) == 0 {
		return nil, errors.New("skymind video download returned no data")
	}
	return content, nil
}

// FriendlyError maps the gateway's error codes to actionable user-facing
// messages (zh first; the UI surface is zh-dominant today). Unknown codes pass
// through with the raw message so diagnostics are never swallowed.
func FriendlyError(err error) string {
	var providerErr ProviderError
	if !errors.As(err, &providerErr) {
		return err.Error()
	}
	switch providerErr.Code {
	case "model_not_found":
		return "该模型在当前 Skymind 账号/分组未开通（" + providerErr.Message + "）"
	case "insufficient_user_quota":
		return "Skymind 余额不足，预扣费失败：" + providerErr.Message
	case "invalid_reference_image_url":
		return "参考素材 URL 无效：Skymind 只接受公网可访问的图片 URL"
	case "invalid_request":
		return "Skymind 拒绝了请求参数：" + providerErr.Message
	case "fail_to_fetch_task":
		return "Skymind 上游调用失败：" + providerErr.Message
	}
	return providerErr.Error()
}

func (t *taskWire) extraFields() map[string]any {
	extra := map[string]any{}
	candidates := map[string]any{
		"seed":                    t.seedValue(),
		"resolution":              t.Resolution,
		"duration":                t.durationValue(),
		"ratio":                   t.Ratio,
		"framespersecond":         t.fpsValue(),
		"output_format":           t.OutputFormat,
		"service_tier":            t.ServiceTier,
		"draft":                   t.draftValue(),
		"generate_audio":          t.audioValue(),
		"created_at":              t.CreatedAt,
		"updated_at":              t.UpdatedAt,
		"execution_expires_after": t.expiresValue(),
	}
	for key, value := range candidates {
		if value == nil {
			continue
		}
		switch v := value.(type) {
		case string:
			if v == "" {
				continue
			}
		case int:
			if v == 0 {
				continue
			}
		case int64:
			if v == 0 {
				continue
			}
		}
		extra[key] = value
	}
	return extra
}

// taskWire is the union of submit/status fields. Pointer/numeric defaults keep
// "field absent" distinguishable from "field zero". Terminal failures nest the
// upstream error under `error`; HTTP-level rejections use top-level
// {code,message}, so toTask prefers the nested object and falls back.
type taskWire struct {
	ID       string `json:"id"`
	TaskID   string `json:"task_id"`
	Object   string `json:"object"`
	Model    string `json:"model"`
	Status   string `json:"status"`
	Progress int    `json:"progress"`
	Content  *struct {
		VideoURL string `json:"video_url"`
	} `json:"content"`
	Usage map[string]any `json:"usage"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	ErrorCode             string `json:"code"`
	ErrorMessage          string `json:"message"`
	Seed                  *int   `json:"seed"`
	Resolution            string `json:"resolution"`
	Duration              *int   `json:"duration"`
	Ratio                 string `json:"ratio"`
	FramesPerSecond       *int   `json:"framespersecond"`
	OutputFormat          string `json:"output_format"`
	ServiceTier           string `json:"service_tier"`
	Draft                 *bool  `json:"draft"`
	GenerateAudio         *bool  `json:"generate_audio"`
	ExecutionExpiresAfter *int   `json:"execution_expires_after"`
	CreatedAt             int64  `json:"created_at"`
	UpdatedAt             int64  `json:"updated_at"`
}

func (t *taskWire) toTask() VideoTask {
	task := VideoTask{
		ID:     t.ID,
		Model:  t.Model,
		Status: t.Status,
		Usage:  t.Usage,
		Extra:  map[string]any{},
	}
	if task.ID == "" {
		task.ID = t.TaskID
	}
	if t.Content != nil {
		task.VideoURL = t.Content.VideoURL
	}
	if t.Error != nil && (t.Error.Code != "" || t.Error.Message != "") {
		task.ErrorCode = t.Error.Code
		task.ErrorMessage = t.Error.Message
	} else if t.ErrorCode != "" {
		task.ErrorCode = t.ErrorCode
		task.ErrorMessage = t.ErrorMessage
	}
	return task
}

func (t *taskWire) seedValue() any {
	if t.Seed != nil {
		return *t.Seed
	}
	return nil
}
func (t *taskWire) durationValue() any {
	if t.Duration != nil {
		return *t.Duration
	}
	return nil
}
func (t *taskWire) fpsValue() any {
	if t.FramesPerSecond != nil {
		return *t.FramesPerSecond
	}
	return nil
}
func (t *taskWire) draftValue() any {
	if t.Draft != nil {
		return *t.Draft
	}
	return nil
}
func (t *taskWire) audioValue() any {
	if t.GenerateAudio != nil {
		return *t.GenerateAudio
	}
	return nil
}
func (t *taskWire) expiresValue() any {
	if t.ExecutionExpiresAfter != nil {
		return *t.ExecutionExpiresAfter
	}
	return nil
}

// do performs one authenticated request against the gateway.
func do(client *http.Client, baseURL, secret, method, endpoint string, body io.Reader) (*http.Response, error) {
	if client == nil {
		client = http.DefaultClient
	}
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = DefaultAPIBase
	}
	baseURL = strings.TrimRight(baseURL, "/")
	request, err := http.NewRequest(method, baseURL+endpoint, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+secret)
	if method != http.MethodGet {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	return response, nil
}

func fetchBytes(client *http.Client, url string) ([]byte, error) {
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("skymind image download returned %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 128<<20))
}

// providerError normalizes both gateway envelopes (and the legacy
// {code,message} status-error shape) into one ProviderError.
func providerError(status int, data []byte) error {
	text := strings.TrimSpace(string(data))
	if text == "" {
		return ProviderError{Code: fmt.Sprintf("http_%d", status), Message: fmt.Sprintf("skymind returned %d", status), Status: status}
	}
	var openAIError struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Type    string `json:"type"`
		} `json:"error"`
	}
	var unifiedError struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(data, &openAIError); err == nil && openAIError.Error.Message != "" {
		code := openAIError.Error.Code
		if code == "" {
			code = openAIError.Error.Type
		}
		return ProviderError{Code: code, Message: openAIError.Error.Message, Status: status}
	}
	if err := json.Unmarshal(data, &unifiedError); err == nil && unifiedError.Message != "" {
		return ProviderError{Code: unifiedError.Code, Message: unifiedError.Message, Status: status}
	}
	return ProviderError{Code: fmt.Sprintf("http_%d", status), Message: text, Status: status}
}
