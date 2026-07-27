/*
 * [INPUT]: 依赖标准 HTTP 客户端、Atlas Cloud Bearer 凭据及已编码的媒体引用
 * [OUTPUT]: 对外提供 Seedance 2.0 Mini 与 Gemini Omni Flash 的视频预测提交和轮询
 * [POS]: media/providers/atlas 的协议适配器；不访问 Recut 的 Store、任务或 Asset
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package atlas

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

const (
	DefaultAPIBase               = "https://api.atlascloud.ai"
	SeedanceMiniReferenceToVideo = "bytedance/seedance-2.0-mini/reference-to-video"
	GeminiOmniReferenceToVideo   = "google/gemini-omni-flash/reference-to-video"
	predictionPollInterval       = 2 * time.Second
)

type GenerateInput struct {
	Model  string
	Prompt string
	Images []string
	Videos []string
	Audios []string
	Output map[string]any
}

type MediaUpload struct {
	Name        string
	ContentType string
	Content     []byte
}

type Result struct {
	PredictionID string
	VideoURL     string
}

func UploadMedia(client *http.Client, baseURL, secret string, input MediaUpload) (string, error) {
	if len(input.Content) == 0 || strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.ContentType) == "" {
		return "", errors.New("Atlas Cloud media upload requires name, content type, and content")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreatePart(uploadPartHeader(input))
	if err != nil {
		return "", err
	}
	if _, err := part.Write(input.Content); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	request, err := http.NewRequest(http.MethodPost, normalizedBaseURL(baseURL)+"/api/v1/model/uploadMedia", &body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+secret)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	result := uploadResult{}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", err
	}
	if url := result.url(); url != "" {
		return url, nil
	}
	return "", errors.New("Atlas Cloud media upload returned no download URL")
}

type uploadResult struct {
	URL  string `json:"url"`
	Data struct {
		URL         string `json:"url"`
		DownloadURL string `json:"download_url"`
	} `json:"data"`
}

func (r uploadResult) url() string {
	if r.Data.DownloadURL != "" {
		return r.Data.DownloadURL
	}
	if r.Data.URL != "" {
		return r.Data.URL
	}
	return r.URL
}

func uploadPartHeader(input MediaUpload) textproto.MIMEHeader {
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, input.Name))
	header.Set("Content-Type", input.ContentType)
	return header
}

type prediction struct {
	ID      string   `json:"id"`
	Status  string   `json:"status"`
	Outputs []string `json:"outputs"`
	Error   string   `json:"error"`
	Message string   `json:"message"`
	URLs    struct {
		Get string `json:"get"`
	} `json:"urls"`
	Data *prediction `json:"data"`
}

func Generate(client *http.Client, baseURL, secret string, input GenerateInput, timeout time.Duration) (Result, error) {
	baseURL = normalizedBaseURL(baseURL)
	payload, err := payloadFor(input)
	if err != nil {
		return Result{}, err
	}
	body, _ := json.Marshal(payload)
	prediction, err := request(client, baseURL, secret, http.MethodPost, "/api/v1/model/generateVideo", bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	deadline := time.Now().Add(timeout)
	for !isCompleted(prediction.Status) {
		if prediction.Status == "failed" || prediction.Status == "timeout" {
			if prediction.Error == "" {
				prediction.Error = prediction.Message
			}
			return Result{}, fmt.Errorf("Atlas Cloud prediction %s: %s", prediction.Status, prediction.Error)
		}
		if time.Now().After(deadline) {
			return Result{}, errors.New("Atlas Cloud video prediction timed out")
		}
		endpoint := prediction.URLs.Get
		if endpoint == "" {
			endpoint = "/api/v1/model/prediction/" + prediction.ID
		}
		time.Sleep(predictionPollInterval)
		prediction, err = request(client, baseURL, secret, http.MethodGet, endpoint, nil)
		if err != nil {
			return Result{}, err
		}
	}
	for _, output := range prediction.Outputs {
		if isVideoURL(output) {
			return Result{PredictionID: prediction.ID, VideoURL: output}, nil
		}
	}
	return Result{}, errors.New("Atlas Cloud completed without a video output")
}

func payloadFor(input GenerateInput) (map[string]any, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("Atlas Cloud video prompt is required")
	}
	payload := map[string]any{"model": input.Model, "prompt": input.Prompt}
	switch input.Model {
	case SeedanceMiniReferenceToVideo:
		if err := validateSeedanceInput(input); err != nil {
			return nil, err
		}
		return seedancePayload(payload, input)
	case GeminiOmniReferenceToVideo:
		if err := validateGeminiInput(input); err != nil {
			return nil, err
		}
		return geminiPayload(payload, input)
	default:
		return nil, fmt.Errorf("Atlas Cloud video adapter does not support %s", input.Model)
	}
	return payload, nil
}

func seedancePayload(payload map[string]any, input GenerateInput) (map[string]any, error) {
	duration, err := outputInteger(input.Output, 5, "duration", "durationSeconds")
	if err != nil {
		return nil, err
	}
	resolution, err := outputString(input.Output, "720p", "resolution")
	if err != nil {
		return nil, err
	}
	ratio, err := outputString(input.Output, "adaptive", "ratio", "aspectRatio")
	if err != nil {
		return nil, err
	}
	bitrate, err := outputString(input.Output, "standard", "bitrateMode")
	if err != nil {
		return nil, err
	}
	generateAudio, err := outputBool(input.Output, true, "generateAudio")
	if err != nil {
		return nil, err
	}
	watermark, err := outputBool(input.Output, false, "watermark")
	if err != nil {
		return nil, err
	}
	lastFrame, err := outputBool(input.Output, false, "returnLastFrame")
	if err != nil {
		return nil, err
	}
	seed, err := outputInteger(input.Output, -1, "seed")
	if err != nil {
		return nil, err
	}
	if err := validateSeedanceOutput(duration, resolution, ratio, bitrate, seed); err != nil {
		return nil, err
	}
	if len(input.Images) > 0 {
		payload["reference_images"] = input.Images
	}
	if len(input.Videos) > 0 {
		payload["reference_videos"] = input.Videos
	}
	if len(input.Audios) > 0 {
		payload["reference_audios"] = input.Audios
	}
	payload["duration"] = duration
	payload["resolution"] = resolution
	payload["ratio"] = ratio
	payload["bitrate_mode"] = bitrate
	payload["generate_audio"] = generateAudio
	payload["watermark"] = watermark
	payload["return_last_frame"] = lastFrame
	payload["seed"] = seed
	return payload, nil
}

func geminiPayload(payload map[string]any, input GenerateInput) (map[string]any, error) {
	duration, err := outputInteger(input.Output, 10, "duration", "durationSeconds")
	if err != nil {
		return nil, err
	}
	aspectRatio, err := outputString(input.Output, "16:9", "aspectRatio")
	if err != nil {
		return nil, err
	}
	resolution, err := outputString(input.Output, "720p", "resolution")
	if err != nil {
		return nil, err
	}
	thinking, err := outputString(input.Output, "default", "thinkingLevel")
	if err != nil {
		return nil, err
	}
	seed, err := outputInteger(input.Output, -1, "seed")
	if err != nil {
		return nil, err
	}
	if err := validateGeminiOutput(duration, aspectRatio, resolution, thinking, seed); err != nil {
		return nil, err
	}
	payload["images"] = input.Images
	payload["duration"] = duration
	payload["aspect_ratio"] = aspectRatio
	payload["resolution"] = resolution
	payload["thinking_level"] = thinking
	payload["seed"] = seed
	return payload, nil
}

func validateSeedanceInput(input GenerateInput) error {
	if (len(input.Images) == 0 && len(input.Videos) == 0) || len(input.Images) > 9 || len(input.Videos) > 3 || len(input.Audios) > 3 {
		return errors.New("Seedance 2.0 Mini requires 1-9 images or 1-3 reference videos and accepts at most 3 audio references")
	}
	return nil
}

func validateGeminiInput(input GenerateInput) error {
	if len(input.Images) == 0 || len(input.Images) > 10 || len(input.Videos) > 0 || len(input.Audios) > 0 {
		return errors.New("Gemini Omni Flash requires 1-10 reference images and accepts no audio or video references")
	}
	return nil
}

func validateSeedanceOutput(duration int, resolution, ratio, bitrate string, seed int) error {
	if duration != -1 && (duration < 4 || duration > 15) {
		return errors.New("Seedance 2.0 Mini duration must be -1 or 4-15 seconds")
	}
	if !oneOf(resolution, "480p", "720p", "720p-SR", "1080p-SR", "1440p-SR") {
		return errors.New("Seedance 2.0 Mini resolution is unsupported")
	}
	if !oneOf(ratio, "16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive") || !oneOf(bitrate, "standard", "high") {
		return errors.New("Seedance 2.0 Mini ratio or bitrate mode is unsupported")
	}
	if seed < -1 || seed > 4294967295 {
		return errors.New("Seedance 2.0 Mini seed must be between -1 and 4294967295")
	}
	return nil
}

func validateGeminiOutput(duration int, aspectRatio, resolution, thinking string, seed int) error {
	if duration < 3 || duration > 10 {
		return errors.New("Gemini Omni Flash duration must be 3-10 seconds")
	}
	if !oneOf(aspectRatio, "16:9", "9:16") || resolution != "720p" || !oneOf(thinking, "default", "high", "low") || seed < -1 {
		return errors.New("Gemini Omni Flash output option is unsupported")
	}
	return nil
}

func oneOf(value string, options ...string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
}

func request(client *http.Client, baseURL, secret, method, endpoint string, body io.Reader) (prediction, error) {
	url := endpoint
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = normalizedBaseURL(baseURL) + endpoint
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return prediction{}, err
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return prediction{}, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return prediction{}, fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	value := prediction{}
	if err := json.Unmarshal(data, &value); err != nil {
		return prediction{}, err
	}
	if value.Data != nil {
		data := *value.Data
		if data.Message == "" {
			data.Message = value.Message
		}
		value = data
	}
	if value.ID == "" && value.Status == "" {
		return prediction{}, errors.New("Atlas Cloud returned an invalid prediction")
	}
	return value, nil
}

func normalizedBaseURL(baseURL string) string {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = DefaultAPIBase
	}
	return strings.TrimRight(baseURL, "/")
}

func isCompleted(status string) bool {
	return status == "completed" || status == "succeeded"
}

func isVideoURL(value string) bool {
	path := strings.ToLower(strings.Split(value, "?")[0])
	return strings.HasSuffix(path, ".mp4") || strings.HasSuffix(path, ".mov") || strings.HasSuffix(path, ".webm")
}
func outputInteger(values map[string]any, fallback int, names ...string) (int, error) {
	for _, name := range names {
		value, ok := values[name]
		if !ok {
			continue
		}
		switch value := value.(type) {
		case int:
			return value, nil
		case float64:
			if math.Trunc(value) == value {
				return int(value), nil
			}
		}
		return 0, fmt.Errorf("%s must be an integer", name)
	}
	return fallback, nil
}

func outputString(values map[string]any, fallback string, names ...string) (string, error) {
	for _, name := range names {
		value, ok := values[name]
		if !ok {
			continue
		}
		if value, ok := value.(string); ok && strings.TrimSpace(value) != "" {
			return value, nil
		}
		return "", fmt.Errorf("%s must be a non-empty string", name)
	}
	return fallback, nil
}

func outputBool(values map[string]any, fallback bool, names ...string) (bool, error) {
	for _, name := range names {
		value, ok := values[name]
		if !ok {
			continue
		}
		if value, ok := value.(bool); ok {
			return value, nil
		}
		return false, fmt.Errorf("%s must be a boolean", name)
	}
	return fallback, nil
}
