/*
 * [INPUT]: 依赖标准 HTTP 客户端、Atlas Cloud Bearer 凭据及已编码的媒体引用
 * [OUTPUT]: 对外提供 Seedance 2.0 Mini 与 Gemini Omni Flash 的视频预测提交和轮询、原生图片生成的提交与 prediction 输出回收，以及语音生成（xAI TTS / Seed Audio 两种请求形态）
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
	// SpeechStyleSeedAudio selects the ByteDance Seed Audio request shape: the
	// voice travels inside references[].speaker instead of a top-level voice_id,
	// and output knobs are format/sample_rate/pitch_rate/speech_rate/loudness_rate.
	SpeechStyleSeedAudio = "seed-audio"
)

type GenerateInput struct {
	Model  string
	Prompt string
	Images []string
	Videos []string
	Audios []string
	// Params are the model-native request fields already validated and mapped
	// by the media service (e.g. duration, aspect_ratio, generate_audio).
	Params map[string]any
	// ReferenceFields maps platform reference kinds (image/video/audio) to the
	// upstream request field carrying them. Missing kinds fall back to
	// images/videos/audios.
	ReferenceFields map[string]string
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

// GenerateImageInput is the native Atlas Cloud image-generation request. Image
// generation uses the same prediction lifecycle as video: submit returns a
// prediction ID and the caller polls until completed, then reads outputs[0].
type GenerateImageInput struct {
	Model  string
	Prompt string
	Images []string
	Params map[string]any
	// ReferenceFields maps platform reference kinds to the upstream request
	// field carrying them (edit variants split between images array and image
	// scalar). Missing image kind falls back to images.
	ReferenceFields map[string]string
}

// Prediction is the durable remote-task handle returned as soon as Atlas
// accepts a video request. Callers persist this before they start polling so a
// local timeout or restart never severs the Recut Asset from the Atlas task.
type Prediction struct {
	ID      string
	Status  string
	Outputs []string
	Error   string
	Message string
	PollURL string
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

// TerminalFailure marks a provider-reported terminal prediction failure (as
// opposed to a transport/transient status-read error). Callers must not keep
// polling or resubmit the same prediction; they surface the provider reason.
type TerminalFailure struct{ Message string }

func (e TerminalFailure) Error() string {
	if strings.TrimSpace(e.Message) == "" {
		return "Atlas Cloud prediction failed"
	}
	return e.Message
}

type predictionResponse struct {
	ID      string   `json:"id"`
	Status  string   `json:"status"`
	Outputs []string `json:"outputs"`
	Error   string   `json:"error"`
	Message string   `json:"message"`
	URLs    struct {
		Get string `json:"get"`
	} `json:"urls"`
	Data *predictionResponse `json:"data"`
}

// decodeFailedPrediction extracts an explicit terminal prediction failure from a
// response body. Atlas can report a failed prediction with a non-2xx status
// while still returning the failed prediction object; recognizing it here keeps
// the caller from retrying an already-dead prediction forever.
func decodeFailedPrediction(data []byte) (Prediction, bool) {
	value := predictionResponse{}
	if err := json.Unmarshal(data, &value); err != nil {
		return Prediction{}, false
	}
	if value.Data != nil {
		inner := *value.Data
		if inner.Message == "" {
			inner.Message = value.Message
		}
		if inner.Error == "" {
			inner.Error = value.Error
		}
		value = inner
	}
	prediction := Prediction{ID: value.ID, Status: value.Status, Outputs: value.Outputs, Error: value.Error, Message: value.Message, PollURL: value.URLs.Get}
	if prediction.ID == "" && prediction.Status == "" {
		return Prediction{}, false
	}
	if prediction.Failed() {
		return prediction, true
	}
	// An error payload without an explicit status is still a terminal failure;
	// normalize it so callers see Failed() instead of an endless "processing".
	if strings.TrimSpace(prediction.Error) != "" && !prediction.Completed() {
		prediction.Status = "failed"
		return prediction, true
	}
	return Prediction{}, false
}

// Submit performs only Atlas' POST /generateVideo request. A successful
// response contains the prediction ID even while the actual video is still
// processing; callers must persist that ID before returning to the user.
func Submit(client *http.Client, baseURL, secret string, input GenerateInput) (Prediction, error) {
	baseURL = normalizedBaseURL(baseURL)
	payload, err := payloadFor(input)
	if err != nil {
		return Prediction{}, err
	}
	body, _ := json.Marshal(payload)
	prediction, err := request(client, baseURL, secret, http.MethodPost, "/api/v1/model/generateVideo", bytes.NewReader(body))
	if err != nil {
		return Prediction{}, err
	}
	if strings.TrimSpace(prediction.ID) == "" {
		return Prediction{}, errors.New("Atlas Cloud submission returned no prediction ID")
	}
	return prediction, nil
}

// imagePayload builds the Atlas image request body: model/prompt, the
// catalog-declared reference field (images array or image scalar), and any
// already-validated provider parameters. Reference/model/prompt keys in Params
// are ignored so a parameter can never hijack the primary inputs.
func imagePayload(input GenerateImageInput) map[string]any {
	payload := map[string]any{"model": input.Model, "prompt": input.Prompt}
	if len(input.Images) > 0 {
		assignReference(payload, referenceField(input.ReferenceFields, "image", "images"), input.Images)
	}
	for key, value := range input.Params {
		switch key {
		case "model", "prompt", "image", "images":
			continue
		}
		payload[key] = value
	}
	return payload
}

// BuildImagePayload exposes the Atlas image request body for the media layer's
// catalog→wire contract tests (no network call).
func BuildImagePayload(input GenerateImageInput) map[string]any { return imagePayload(input) }

// BuildVideoPayload exposes the Atlas video request body for contract tests.
func BuildVideoPayload(input GenerateInput) (map[string]any, error) { return payloadFor(input) }

// SubmitImage performs Atlas' POST /generateImage request. A successful
// response contains a prediction ID that callers persist and poll, matching the
// video prediction lifecycle.
func SubmitImage(client *http.Client, baseURL, secret string, input GenerateImageInput) (Prediction, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return Prediction{}, errors.New("Atlas Cloud image prompt is required")
	}
	body, _ := json.Marshal(imagePayload(input))
	baseURL = normalizedBaseURL(baseURL)
	prediction, err := request(client, baseURL, secret, http.MethodPost, "/api/v1/model/generateImage", bytes.NewReader(body))
	if err != nil {
		return Prediction{}, err
	}
	if strings.TrimSpace(prediction.ID) == "" {
		return Prediction{}, errors.New("Atlas Cloud image submission returned no prediction ID")
	}
	return prediction, nil
}

// Poll reads one Atlas prediction state. It does not sleep or impose a local
// terminal deadline; task ownership belongs to the persistent caller.
func Poll(client *http.Client, baseURL, secret string, submitted Prediction) (Prediction, error) {
	if strings.TrimSpace(submitted.ID) == "" {
		return Prediction{}, errors.New("Atlas Cloud prediction ID is required")
	}
	endpoint := submitted.PollURL
	if endpoint == "" {
		endpoint = "/api/v1/model/prediction/" + submitted.ID
	}
	return request(client, normalizedBaseURL(baseURL), secret, http.MethodGet, endpoint, nil)
}

func Generate(client *http.Client, baseURL, secret string, input GenerateInput, timeout time.Duration) (Result, error) {
	prediction, err := Submit(client, baseURL, secret, input)
	if err != nil {
		return Result{}, err
	}
	deadline := time.Now().Add(timeout)
	for !prediction.Completed() {
		if prediction.Failed() {
			return Result{}, fmt.Errorf("Atlas Cloud prediction %s: %s", prediction.Status, prediction.FailureMessage())
		}
		if time.Now().After(deadline) {
			return Result{}, errors.New("Atlas Cloud video prediction timed out")
		}
		time.Sleep(predictionPollInterval)
		prediction, err = Poll(client, baseURL, secret, prediction)
		if err != nil {
			return Result{}, err
		}
	}
	if output := prediction.VideoURL(); output != "" {
		return Result{PredictionID: prediction.ID, VideoURL: output}, nil
	}
	return Result{}, errors.New("Atlas Cloud completed without a video output")
}

func (p Prediction) Completed() bool { return isCompleted(p.Status) }

func (p Prediction) Failed() bool {
	status := strings.ToLower(strings.TrimSpace(p.Status))
	return status == "failed" || status == "timeout"
}

func (p Prediction) FailureMessage() string {
	if strings.TrimSpace(p.Error) != "" {
		return p.Error
	}
	if strings.TrimSpace(p.Message) != "" {
		return p.Message
	}
	return "Atlas Cloud did not return an error message"
}

func (p Prediction) VideoURL() string {
	for _, output := range p.Outputs {
		if isVideoURL(output) {
			return output
		}
	}
	for _, output := range p.Outputs {
		if strings.TrimSpace(output) != "" {
			return output
		}
	}
	return ""
}

// FirstOutput returns the first non-empty generated output URL. Image
// generation places its image URL in outputs[0], so this is the image handle.
func (p Prediction) FirstOutput() string {
	for _, output := range p.Outputs {
		if strings.TrimSpace(output) != "" {
			return output
		}
	}
	return ""
}

// SubmitSpeech performs Atlas' POST /generateAudio request (async prediction,
// e.g. xAI TTS v1). A successful response contains a prediction ID that
// callers persist and poll, matching the video prediction lifecycle.
func SubmitSpeech(client *http.Client, baseURL, secret string, input SpeechInput) (Prediction, error) {
	if strings.TrimSpace(input.Text) == "" {
		return Prediction{}, errors.New("Atlas Cloud speech text is required")
	}
	body, _ := json.Marshal(BuildSpeechPayload(input))
	baseURL = normalizedBaseURL(baseURL)
	prediction, err := request(client, baseURL, secret, http.MethodPost, "/api/v1/model/generateAudio", bytes.NewReader(body))
	if err != nil {
		return Prediction{}, err
	}
	if strings.TrimSpace(prediction.ID) == "" {
		return Prediction{}, errors.New("Atlas Cloud speech submission returned no prediction ID")
	}
	return prediction, nil
}

// BuildSpeechPayload assembles the /api/v1/model/generateAudio body. Style picks
// the per-model wire shape: empty keeps the xAI TTS defaults (language auto,
// codec mp3, 24kHz/128kbps); SpeechStyleSeedAudio uses the Seed Audio shape.
// Exported for contract tests.
func BuildSpeechPayload(input SpeechInput) map[string]any {
	if input.Style == SpeechStyleSeedAudio {
		return seedAudioSpeechPayload(input)
	}
	payload := map[string]any{"model": input.Model, "text": input.Text, "language": input.Language, "codec": input.Codec, "sample_rate": input.SampleRate, "bit_rate": input.BitRate}
	if text, _ := payload["language"].(string); strings.TrimSpace(text) == "" {
		payload["language"] = "auto"
	}
	if text, _ := payload["codec"].(string); strings.TrimSpace(text) == "" {
		payload["codec"] = "mp3"
	}
	if input.SampleRate == 0 {
		payload["sample_rate"] = 24000
	}
	if input.BitRate == 0 {
		payload["bit_rate"] = 128000
	}
	if input.VoiceID != "" {
		payload["voice_id"] = input.VoiceID
	}
	if input.Speed > 0 {
		payload["speed"] = input.Speed
	}
	return payload
}

// seedAudioSpeechPayload builds the ByteDance Seed Audio 1.0 body: the voice is
// a preset speaker id submitted inside references[].speaker (omitted for
// text-only generation), and the output knobs are format/sample_rate plus rate
// offsets. There is no language/codec/bit_rate/voice_id field upstream.
func seedAudioSpeechPayload(input SpeechInput) map[string]any {
	format := strings.TrimSpace(input.Format)
	if format == "" {
		format = "mp3"
	}
	sampleRate := input.SampleRate
	if sampleRate == 0 {
		sampleRate = 24000
	}
	payload := map[string]any{
		"model": input.Model, "text": input.Text,
		"format": format, "sample_rate": sampleRate,
		"pitch_rate": input.PitchRate, "speech_rate": input.SpeechRate, "loudness_rate": input.LoudnessRate,
	}
	if input.VoiceID != "" {
		payload["references"] = []map[string]any{{"speaker": input.VoiceID}}
	}
	return payload
}

// SpeechInput carries an Atlas speech generation request. Style selects the
// per-model wire shape (empty = xAI TTS v1, SpeechStyleSeedAudio = Seed Audio).
type SpeechInput struct {
	Model      string
	Text       string
	Language   string
	VoiceID    string
	Codec      string
	Format     string
	SampleRate int
	BitRate    int
	Speed      float64
	Style      string
	PitchRate  float64
	SpeechRate float64
	// LoudnessRate is the Seed Audio loudness offset (mapped from Output.volume).
	LoudnessRate float64
}

// payloadFor builds the upstream video request from already-validated,
// model-native Params plus the reference field mapping. It does not switch on
// the model ID: the media service owns per-model validation via the catalog
// parameter schema, so a new Atlas video model needs catalog data, not code.
func payloadFor(input GenerateInput) (map[string]any, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("Atlas Cloud video prompt is required")
	}
	payload := map[string]any{"model": input.Model, "prompt": input.Prompt}
	for key, value := range input.Params {
		switch key {
		case "model", "prompt", "images", "videos", "audios":
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
	return payload, nil
}

// assignReference writes one reference kind. Upstream schemas split between a
// singular scalar field (image/video/audio) and a plural array (images/…): the
// singular form receives the first value, the plural form the whole list.
func assignReference(payload map[string]any, field string, values []string) {
	switch field {
	case "image", "video", "audio":
		payload[field] = values[0]
	default:
		payload[field] = values
	}
}

// referenceField returns the upstream field carrying one reference kind, or the
// generic fallback when the catalog does not override it.
func referenceField(fields map[string]string, kind, fallback string) string {
	if key := strings.TrimSpace(fields[kind]); key != "" {
		return key
	}
	return fallback
}

func request(client *http.Client, baseURL, secret, method, endpoint string, body io.Reader) (Prediction, error) {
	url := endpoint
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = normalizedBaseURL(baseURL) + endpoint
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return Prediction{}, err
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return Prediction{}, err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Atlas reports an explicit prediction failure with a non-2xx status and
		// the failed prediction in the body (e.g. 500 + status:"failed"). Return
		// that terminal state instead of a generic HTTP error so callers fail the
		// task with the provider's own reason rather than retrying it forever.
		if failure, ok := decodeFailedPrediction(data); ok {
			return failure, nil
		}
		return Prediction{}, fmt.Errorf("provider returned %s: %s", response.Status, string(data))
	}
	value := predictionResponse{}
	if err := json.Unmarshal(data, &value); err != nil {
		return Prediction{}, err
	}
	if value.Data != nil {
		inner := *value.Data
		if inner.Message == "" {
			inner.Message = value.Message
		}
		if inner.Error == "" {
			inner.Error = value.Error
		}
		value = inner
	}
	if value.ID == "" && value.Status == "" {
		return Prediction{}, errors.New("Atlas Cloud returned an invalid prediction")
	}
	return Prediction{ID: value.ID, Status: value.Status, Outputs: value.Outputs, Error: value.Error, Message: value.Message, PollURL: value.URLs.Get}, nil
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
	return status == "completed" || status == "succeeded"
}

func isVideoURL(value string) bool {
	path := strings.ToLower(strings.Split(value, "?")[0])
	return strings.HasSuffix(path, ".mp4") || strings.HasSuffix(path, ".mov") || strings.HasSuffix(path, ".webm")
}
