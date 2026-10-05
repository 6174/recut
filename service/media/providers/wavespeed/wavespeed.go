/*
 * [INPUT]: 依赖标准 HTTP 客户端、WaveSpeed Bearer 凭据（API key）及已编码/已发布的媒体引用
 * [OUTPUT]: 对外提供 WaveSpeed 统一预测协议的提交（POST /api/v3/{model}）、结果轮询
 *          （GET /api/v3/predictions/{id}/result）、媒体上传（POST /api/v3/media/uploads
 *          领取上传票据后 PUT 到票据地址）与供应商响应归一（{code,message,data} 信封 → Prediction）
 * [POS]: media/providers/wavespeed 的协议适配器；只负责线协议与响应归一化，不访问 Recut 的
 *        Store、任务或 Asset；参考素材鉴权下载由 media 层完成，这里只做 multipart 上传
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package wavespeed

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// DefaultAPIBase is the WaveSpeed REST API root. Every model shares one
// interface: POST /api/v3/{model_id} to submit, then poll the returned
// data.urls.get (or GET /api/v3/predictions/{id}/result).
const DefaultAPIBase = "https://api.wavespeed.ai"

// TerminalFailure marks a provider-reported terminal prediction failure (as
// opposed to a transport/transient status-read error). Callers must not keep
// polling or resubmit the same prediction; they surface the provider reason.
type TerminalFailure struct{ Message string }

func (e TerminalFailure) Error() string {
	if strings.TrimSpace(e.Message) == "" {
		return "WaveSpeed prediction failed"
	}
	return e.Message
}

// RateLimitError marks an HTTP 429 from the provider: the account's concurrent
// prediction ceiling is reached. It is retryable — the caller must NOT fail the
// job; it leaves the submission queued and lets the next scheduler tick retry
// once a slot frees up.
type RateLimitError struct{ Message string }

func (e RateLimitError) Error() string {
	if strings.TrimSpace(e.Message) == "" {
		return "WaveSpeed rate limit reached"
	}
	return e.Message
}

// GenerateInput is one WaveSpeed prediction submission. Model is the upstream
// model ID (path segment, e.g. bytedance/seedance-2.5/text-to-video). Params
// carries already-validated, model-native fields; Images/Videos/Audios are
// reference URLs grouped by kind and placed under ReferenceFields.
type GenerateInput struct {
	Model           string
	Prompt          string
	Images          []string
	Videos          []string
	Audios          []string
	Params          map[string]any
	ReferenceFields map[string]string
}

// MediaUpload is one reference binary to publish to WaveSpeed's CDN.
type MediaUpload struct {
	Name        string
	ContentType string
	Content     []byte
}

// Prediction is the durable remote-task handle. WaveSpeed returns the task ID
// as soon as it accepts the request; callers persist it before polling.
type Prediction struct {
	ID      string
	Status  string
	Outputs []string
	Error   string
	Message string
	PollURL string
}

func (p Prediction) Completed() bool { return isCompleted(p.Status) }

// Failed reports a terminal failure status. WaveSpeed documents failed,
// cancelled, timeout and deleted as terminal.
func (p Prediction) Failed() bool {
	status := strings.ToLower(strings.TrimSpace(p.Status))
	return status == "failed" || status == "cancelled" || status == "canceled" || status == "timeout" || status == "deleted"
}

func (p Prediction) FailureMessage() string {
	if strings.TrimSpace(p.Error) != "" {
		return p.Error
	}
	if strings.TrimSpace(p.Message) != "" {
		return p.Message
	}
	return "WaveSpeed did not return an error message"
}

// FirstOutput returns the first non-empty output URL. Image, video and audio
// results all place their output URL (or naked base64) in outputs[0].
func (p Prediction) FirstOutput() string {
	for _, output := range p.Outputs {
		if strings.TrimSpace(output) != "" {
			return output
		}
	}
	return ""
}

// VideoURL prefers an output that looks like a video, falling back to the first
// non-empty output.
func (p Prediction) VideoURL() string {
	for _, output := range p.Outputs {
		if isVideoURL(output) {
			return output
		}
	}
	return p.FirstOutput()
}

// AudioURL prefers an output that looks like an audio file, falling back to the
// first non-empty output.
func (p Prediction) AudioURL() string {
	for _, output := range p.Outputs {
		if isAudioURL(output) {
			return output
		}
	}
	return p.FirstOutput()
}

// Submit performs only the POST /api/v3/{model} request. A successful response
// contains the prediction ID even while generation is still processing.
func Submit(client *http.Client, baseURL, secret string, input GenerateInput) (Prediction, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return Prediction{}, errors.New("WaveSpeed prompt is required")
	}
	if strings.TrimSpace(input.Model) == "" {
		return Prediction{}, errors.New("WaveSpeed model is required")
	}
	body, _ := json.Marshal(BuildPayload(input))
	prediction, err := request(client, normalizedBaseURL(baseURL), secret, http.MethodPost, "/api/v3/"+strings.TrimLeft(input.Model, "/"), bytes.NewReader(body))
	if err != nil {
		return Prediction{}, err
	}
	if strings.TrimSpace(prediction.ID) == "" {
		return Prediction{}, errors.New("WaveSpeed submission returned no prediction ID")
	}
	return prediction, nil
}

// Poll reads one prediction state. It does not sleep or impose a local terminal
// deadline; task ownership belongs to the persistent caller. The submit
// response's data.urls.get is preferred; otherwise the canonical result path is
// rebuilt from the ID.
func Poll(client *http.Client, baseURL, secret string, submitted Prediction) (Prediction, error) {
	if strings.TrimSpace(submitted.ID) == "" {
		return Prediction{}, errors.New("WaveSpeed prediction ID is required")
	}
	endpoint := strings.TrimSpace(submitted.PollURL)
	if endpoint == "" {
		endpoint = "/api/v3/predictions/" + submitted.ID + "/result"
	}
	return request(client, normalizedBaseURL(baseURL), secret, http.MethodGet, endpoint, nil)
}

// ListPredictions returns recent prediction history for one model, newest
// first. It is the recovery primitive for an orphaned submission: when the
// submit HTTP response was lost before the prediction ID could be persisted,
// the caller can match the task by model + creation window instead of
// resubmitting a paid call. createdAfter is an RFC3339 timestamp (empty = let
// the server use its default window).
func ListPredictions(client *http.Client, baseURL, secret, model, createdAfter string, pageSize int) ([]Prediction, error) {
	if strings.TrimSpace(model) == "" {
		return nil, errors.New("WaveSpeed model is required to list predictions")
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	body := map[string]any{"page": 1, "page_size": pageSize, "model": model}
	if strings.TrimSpace(createdAfter) != "" {
		body["created_after"] = createdAfter
	}
	payload, _ := json.Marshal(body)
	return listRequest(client, normalizedBaseURL(baseURL), secret, payload)
}

type predictionsListResponse struct {
	Data *struct {
		Items []predictionResponse `json:"items"`
	} `json:"data"`
}

func listRequest(client *http.Client, baseURL, secret string, payload []byte) ([]Prediction, error) {
	if client == nil {
		client = http.DefaultClient
	}
	request, err := http.NewRequest(http.MethodPost, baseURL+"/api/v3/predictions", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+secret)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode == http.StatusTooManyRequests {
		return nil, RateLimitError{Message: strings.TrimSpace(string(data))}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	value := predictionsListResponse{}
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	if value.Data == nil {
		return nil, nil
	}
	predictions := make([]Prediction, 0, len(value.Data.Items))
	for _, item := range value.Data.Items {
		prediction, err := normalizeEnvelope(item)
		if err != nil {
			continue
		}
		predictions = append(predictions, prediction)
	}
	return predictions, nil
}

// BuildPayload assembles the upstream request body: model, prompt, any
// already-validated provider params, and the reference arrays under their
// catalog-declared fields. Reference/model/prompt keys in Params are ignored so
// a parameter can never hijack the primary inputs. Exported for contract tests.
func BuildPayload(input GenerateInput) map[string]any {
	payload := map[string]any{"model": input.Model, "prompt": input.Prompt}
	for key, value := range input.Params {
		switch key {
		case "model", "prompt", "image", "images", "video", "videos", "audio", "audios":
			continue
		}
		payload[key] = value
	}
	if len(input.Images) > 0 {
		assignReference(payload, referenceField(input.ReferenceFields, "image", "images"), input.Images)
	}
	if len(input.Videos) > 0 {
		assignReference(payload, referenceField(input.ReferenceFields, "video", "videos"), input.Videos)
	}
	if len(input.Audios) > 0 {
		assignReference(payload, referenceField(input.ReferenceFields, "audio", "audios"), input.Audios)
	}
	return payload
}

// assignReference writes one reference kind. WaveSpeed schemas split between a
// singular scalar field (image/video/audio) and a plural array
// (images/reference_images/…): the singular form receives the first value, the
// plural form the whole list.
func assignReference(payload map[string]any, field string, values []string) {
	switch field {
	case "image", "video", "audio":
		payload[field] = values[0]
	default:
		payload[field] = values
	}
}

// uploadTicket is the direct-upload ticket returned by
// POST /api/v3/media/uploads. The client sends the file bytes to Upload.URL
// using Upload's headers, then passes DownloadURL to the model input.
type uploadTicket struct {
	Data struct {
		DownloadURL string `json:"download_url"`
		Upload      struct {
			Method  string            `json:"method"`
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		} `json:"upload"`
	} `json:"data"`
}

// UploadMedia publishes one reference binary and returns its public download
// URL, which is what the model endpoints accept. It follows the recommended
// two-step flow: request a short-lived upload ticket from
// POST /api/v3/media/uploads (JSON), then PUT the raw bytes to the signed URL.
// The single-request multipart endpoint (POST /api/v3/media/upload/binary) no
// longer accepts multipart at /api/v3/media/upload, which returns a JSON parse
// error.
func UploadMedia(client *http.Client, baseURL, secret string, input MediaUpload) (string, error) {
	if len(input.Content) == 0 || strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.ContentType) == "" {
		return "", errors.New("WaveSpeed media upload requires name, content type, and content")
	}
	if client == nil {
		client = http.DefaultClient
	}
	ticket, err := requestUploadTicket(client, normalizedBaseURL(baseURL), secret, input)
	if err != nil {
		return "", err
	}
	return putUploadTicket(client, ticket, input)
}

// requestUploadTicket asks WaveSpeed for a signed upload slot. filename and the
// exact byte size are required; content_type is optional upstream but always
// sent here so the stored object keeps the reference's MIME type.
func requestUploadTicket(client *http.Client, baseURL, secret string, input MediaUpload) (uploadTicket, error) {
	body, _ := json.Marshal(map[string]any{
		"filename":     input.Name,
		"size":         len(input.Content),
		"content_type": input.ContentType,
	})
	request, err := http.NewRequest(http.MethodPost, baseURL+"/api/v3/media/uploads", bytes.NewReader(body))
	if err != nil {
		return uploadTicket{}, err
	}
	request.Header.Set("Authorization", "Bearer "+secret)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return uploadTicket{}, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return uploadTicket{}, fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	ticket := uploadTicket{}
	if err := json.Unmarshal(data, &ticket); err != nil {
		return uploadTicket{}, err
	}
	if strings.TrimSpace(ticket.Data.Upload.URL) == "" || strings.TrimSpace(ticket.Data.DownloadURL) == "" {
		return uploadTicket{}, errors.New("WaveSpeed upload ticket returned no upload URL")
	}
	return ticket, nil
}

// putUploadTicket sends the raw file bytes to the signed storage URL using the
// headers from the ticket. The WaveSpeed credential must never be forwarded to
// the storage host.
func putUploadTicket(client *http.Client, ticket uploadTicket, input MediaUpload) (string, error) {
	method := strings.ToUpper(strings.TrimSpace(ticket.Data.Upload.Method))
	if method == "" {
		method = http.MethodPut
	}
	request, err := http.NewRequest(method, ticket.Data.Upload.URL, bytes.NewReader(input.Content))
	if err != nil {
		return "", err
	}
	for key, value := range ticket.Data.Upload.Headers {
		request.Header.Set(key, value)
	}
	request.Header.Del("Authorization")
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("provider storage returned %s: %s", response.Status, string(data))
	}
	return ticket.Data.DownloadURL, nil
}

// predictionResponse is the WaveSpeed envelope. Most responses nest the task
// under data; some (legacy) shapes place fields at the top level, so both are
// merged in normalizeEnvelope.
type predictionResponse struct {
	Code    int      `json:"code"`
	Message string   `json:"message"`
	ID      string   `json:"id"`
	Status  string   `json:"status"`
	Outputs []string `json:"outputs"`
	Error   any      `json:"error"`
	URLs    struct {
		Get      string `json:"get"`
		Download string `json:"download"`
		Upload   string `json:"upload"`
		MediaURL string `json:"media_url"`
	} `json:"urls"`
	URL  string              `json:"url"`
	Data *predictionResponse `json:"data"`
}

func request(client *http.Client, baseURL, secret, method, endpoint string, body io.Reader) (Prediction, error) {
	if client == nil {
		client = http.DefaultClient
	}
	url := endpoint
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = normalizedBaseURL(baseURL) + endpoint
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return Prediction{}, err
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	if method != http.MethodGet {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(req)
	if err != nil {
		return Prediction{}, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode == http.StatusTooManyRequests {
		// The account's concurrent prediction ceiling is reached. This is
		// retryable: a failed submission was never accepted or billed, so the
		// caller must requeue, not fail.
		message := strings.TrimSpace(string(data))
		var envelope predictionResponse
		if json.Unmarshal(data, &envelope) == nil && strings.TrimSpace(envelope.Message) != "" {
			message = envelope.Message
		}
		return Prediction{}, RateLimitError{Message: message}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// WaveSpeed can report a terminal prediction failure with a non-2xx
		// status while still returning the task object; surface it as a
		// terminal failure so callers do not retry a dead (and billed) task.
		if failure, ok := decodeFailedPrediction(data); ok {
			return failure, nil
		}
		return Prediction{}, fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	value := predictionResponse{}
	if err := json.Unmarshal(data, &value); err != nil {
		return Prediction{}, err
	}
	return normalizeEnvelope(value)
}

// decodeFailedPrediction extracts an explicit terminal prediction failure from
// a non-2xx body. It returns false when the body is not a recognizable failed
// task (a generic HTTP error is then reported by the caller).
func decodeFailedPrediction(data []byte) (Prediction, bool) {
	value := predictionResponse{}
	if err := json.Unmarshal(data, &value); err != nil {
		return Prediction{}, false
	}
	prediction, err := normalizeEnvelope(value)
	if err != nil {
		return Prediction{}, false
	}
	if prediction.Failed() {
		return prediction, true
	}
	return Prediction{}, false
}

// normalizeEnvelope flattens the {code,message,data} envelope (or a top-level
// task object) into one Prediction. data wins over the outer wrapper; outer
// message/code backfill missing inner fields.
func normalizeEnvelope(value predictionResponse) (Prediction, error) {
	if value.Data != nil {
		inner := *value.Data
		if inner.Message == "" {
			inner.Message = value.Message
		}
		if inner.ID == "" {
			inner.ID = value.ID
		}
		if inner.Status == "" {
			inner.Status = value.Status
		}
		if inner.Error == nil {
			inner.Error = value.Error
		}
		value = inner
	}
	if value.ID == "" && value.Status == "" {
		if value.Message != "" {
			return Prediction{}, errors.New("WaveSpeed: " + value.Message)
		}
		return Prediction{}, errors.New("WaveSpeed returned an invalid prediction")
	}
	return Prediction{
		ID:      value.ID,
		Status:  value.Status,
		Outputs: value.Outputs,
		Error:   errorString(value.Error),
		Message: value.Message,
		PollURL: value.URLs.Get,
	}, nil
}

// errorString renders the `error` field, which WaveSpeed types as a string but
// some models return as an object {code,message}.
func errorString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case map[string]any:
		if message, _ := typed["message"].(string); message != "" {
			return message
		}
		if code, _ := typed["code"].(string); code != "" {
			return code
		}
		encoded, _ := json.Marshal(typed)
		return string(encoded)
	default:
		encoded, _ := json.Marshal(typed)
		return string(encoded)
	}
}

func normalizedBaseURL(baseURL string) string {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = DefaultAPIBase
	}
	return strings.TrimRight(baseURL, "/")
}

func isCompleted(status string) bool {
	status = strings.ToLower(strings.TrimSpace(status))
	return status == "completed" || status == "succeeded" || status == "success"
}

func isVideoURL(value string) bool {
	path := strings.ToLower(strings.Split(value, "?")[0])
	return strings.HasSuffix(path, ".mp4") || strings.HasSuffix(path, ".mov") || strings.HasSuffix(path, ".webm")
}

func isAudioURL(value string) bool {
	path := strings.ToLower(strings.Split(value, "?")[0])
	for _, extension := range []string{".mp3", ".wav", ".ogg", ".opus", ".m4a", ".aac", ".flac", ".pcm"} {
		if strings.HasSuffix(path, extension) {
			return true
		}
	}
	return false
}

func referenceField(fields map[string]string, kind, fallback string) string {
	if key := strings.TrimSpace(fields[kind]); key != "" {
		return key
	}
	return fallback
}
