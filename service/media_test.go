/*
 * [INPUT]: 依赖 MediaService、Store 与测试目录中的临时工作区
 * [OUTPUT]: 验证媒体凭据加密保存、能力路由、受校验的模型/凭据直连、图片导入、幂等任务与中断恢复契约
 * [POS]: service 的 Media Platform 回归测试；不调用真实模型提供商
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMediaRouteAndJobUseOpaqueCredential(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "openai-compatible", Name: "Test", APIBase: "http://127.0.0.1:1"}, "secret-value")
	if err != nil {
		t.Fatal(err)
	}
	credentials, err := media.ListCredentials()
	if err != nil || len(credentials) != 1 || !credentials[0].SecretSet {
		t.Fatalf("credential metadata = %#v, %v", credentials, err)
	}
	if credentials[0].Name == "secret-value" {
		t.Fatal("credential leaked its secret")
	}
	if _, err := media.SaveRoute(MediaRoute{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	job, err := media.Generate(GenerateMediaInput{Capability: ImageGenerate, Prompt: "test", ProjectID: project.ID, IdempotencyKey: "idempotent"})
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := media.Generate(GenerateMediaInput{Capability: ImageGenerate, Prompt: "test", ProjectID: project.ID, IdempotencyKey: "idempotent"})
	if err != nil || duplicate.ID != job.ID {
		t.Fatalf("idempotency failed: %#v, %v", duplicate, err)
	}
	direct, _, err := media.ResolveRoute(GenerateMediaInput{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID})
	if err != nil || direct.ModelID != "openai-compatible/image" {
		t.Fatalf("direct model route = %#v, %v", direct, err)
	}
	if _, _, err := media.ResolveRoute(GenerateMediaInput{Capability: ImageGenerate, ModelID: "openai/gpt-image-2", CredentialID: credential.ID}); err == nil {
		t.Fatal("direct generation accepted a credential from a different provider")
	}
}

func TestSpeechProvidersExposeVoicesAndSaveAudio(t *testing.T) {
	miniMax := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer minimax-key" {
			t.Fatal("MiniMax request did not use bearer authentication")
		}
		switch r.URL.Path {
		case "/v1/get_voice":
			_ = json.NewEncoder(w).Encode(map[string]any{"system_voice": []map[string]any{{"voice_id": "news", "voice_name": "新闻女声", "description": []string{"专业", "普通话"}}}, "base_resp": map[string]any{"status_code": 0}})
		case "/v1/t2a_v2":
			input := map[string]any{}
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input["voice_setting"].(map[string]any)["voice_id"] != "news" {
				t.Fatal("MiniMax request lost voiceId")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"audio": "010203"}, "base_resp": map[string]any{"status_code": 0}})
		default:
			t.Fatalf("unexpected MiniMax path %s", r.URL.Path)
		}
	}))
	defer miniMax.Close()
	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "minimax", Name: "MiniMax", APIBase: miniMax.URL}, "minimax-key")
	if err != nil {
		t.Fatal(err)
	}
	voices, err := media.ListVoices(credential.ID)
	if err != nil || len(voices) != 1 || voices[0].ID != "news" {
		t.Fatalf("MiniMax voices = %#v, %v", voices, err)
	}
	job, err := media.GenerateSync(GenerateMediaInput{Capability: SpeechGenerate, ModelID: "minimax/speech-2.8-hd", CredentialID: credential.ID, Prompt: "你好", Output: map[string]any{"voiceId": "news"}, IdempotencyKey: "minimax-speech"})
	if err != nil || len(job.AssetIDs) != 1 {
		t.Fatalf("MiniMax speech job = %#v, %v", job, err)
	}
	asset, err := media.GetAsset(job.AssetIDs[0])
	if err != nil || asset.Kind != "audio" || asset.MimeType != "audio/mpeg" {
		t.Fatalf("MiniMax audio asset = %#v, %v", asset, err)
	}
	if filepath.Ext(asset.Name) != ".mp3" {
		t.Fatalf("MiniMax MP3 asset must use .mp3 extension, got %q", asset.Name)
	}
}

func TestElevenLabsVoiceLookupUsesCredentialKey(t *testing.T) {
	eleven := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/voices" || r.Header.Get("xi-api-key") != "eleven-key" {
			t.Fatalf("unexpected ElevenLabs request: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"voices": []map[string]any{{"voice_id": "rachel", "name": "Rachel", "category": "premade", "labels": map[string]string{"accent": "American", "gender": "female"}}}})
	}))
	defer eleven.Close()
	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "elevenlabs", Name: "ElevenLabs", APIBase: eleven.URL}, "eleven-key")
	if err != nil {
		t.Fatal(err)
	}
	voices, err := media.ListVoices(credential.ID)
	if err != nil || len(voices) != 1 || voices[0].Name != "Rachel" {
		t.Fatalf("ElevenLabs voices = %#v, %v", voices, err)
	}
}

func TestMediaProvidersOwnTheirModelLists(t *testing.T) {
	provider, ok := providerByID("atlas-cloud")
	if !ok || provider.Protocol != "openai-compatible" || provider.DefaultAPIBase != "https://api.atlascloud.ai" {
		t.Fatalf("Atlas provider = %#v", provider)
	}
	model, ok := modelByID("atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video")
	if !ok || model.Capability != VideoGenerate {
		t.Fatalf("Atlas model = %#v", model)
	}
	if model.Provider != provider.ID {
		t.Fatalf("model is not owned by Atlas: %#v", model)
	}
}

func TestAtlasReferenceModelsEnforceTheirInputContracts(t *testing.T) {
	seedance, _ := modelByID("atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video")
	if err := validateModelReferences(seedance, 9, 0, 3); err != nil {
		t.Fatalf("Seedance limits rejected valid references: %v", err)
	}
	if err := validateModelReferences(seedance, 0, 3, 3); err != nil {
		t.Fatalf("Seedance video references rejected: %v", err)
	}
	if err := validateModelReferences(seedance, 1, 0, 4); err == nil {
		t.Fatal("Seedance accepted too many audio references")
	}
	gemini, _ := modelByID("atlas-cloud/google/gemini-omni-flash-reference-to-video")
	if err := validateModelReferences(gemini, 10, 0, 0); err != nil {
		t.Fatalf("Gemini 10 reference images rejected: %v", err)
	}
	if err := validateModelReferences(gemini, 11, 0, 0); err == nil {
		t.Fatal("Gemini accepted more than 10 reference images")
	}
	if err := validateModelReferences(gemini, 1, 0, 1); err == nil {
		t.Fatal("Gemini accepted an audio reference")
	}
	if err := validateModelReferences(gemini, 0, 0, 0); err == nil {
		t.Fatal("Gemini accepted no reference images")
	}
}

func TestAtlasVideoAdapterSubmitsAndPollsPrediction(t *testing.T) {
	var submitted map[string]any
	var atlas *httptest.Server
	atlas = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Header.Get("Authorization") != "Bearer atlas-key" {
			t.Fatal("Atlas request did not use bearer authentication")
		}
		switch r.URL.Path {
		case "/api/v1/model/generateVideo":
			_ = json.NewDecoder(r.Body).Decode(&submitted)
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-1", "status": "processing"}})
		case "/api/v1/model/prediction/prediction-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "prediction-1", "status": "completed", "outputs": []string{atlas.URL + "/video.mp4"}})
		case "/video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			t.Fatalf("unexpected Atlas path %s", r.URL.Path)
		}
	}))
	defer atlas.Close()
	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: atlas.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := media.ImportImage("reference.png", "image/png", []byte("image"))
	if err != nil {
		t.Fatal(err)
	}
	secondImage, err := media.ImportImage("reference-2.png", "image/png", []byte("second image"))
	if err != nil {
		t.Fatal(err)
	}
	audio, err := media.ImportMedia("reference.mp3", "audio/mpeg", []byte("audio"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := media.GenerateSync(GenerateMediaInput{Capability: VideoGenerate, Prompt: "make it move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credential.ID, ReferenceIDs: []string{image.ID, secondImage.ID, audio.ID}, Output: map[string]any{"durationSeconds": 4}, IdempotencyKey: "atlas-video"})
	if err != nil || len(job.AssetIDs) != 1 {
		t.Fatalf("Atlas video job = %#v, %v", job, err)
	}
	if submitted["model"] != "bytedance/seedance-2.0-mini/reference-to-video" || len(submitted["reference_images"].([]any)) != 2 || len(submitted["reference_audios"].([]any)) != 1 || submitted["duration"] != float64(4) {
		t.Fatalf("unexpected Seedance payload: %#v", submitted)
	}
}

func TestAtlasDefaultRouteRejectsGeminiAudioBeforeSubmitting(t *testing.T) {
	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas"}, "atlas-key")
	if err != nil || credential.APIBase != "https://api.atlascloud.ai" {
		t.Fatalf("Atlas credential = %#v, %v", credential, err)
	}
	if _, err := media.SaveRoute(MediaRoute{Capability: VideoGenerate, ModelID: "atlas-cloud/google/gemini-omni-flash-reference-to-video", CredentialID: credential.ID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	image, err := media.ImportMedia("reference.png", "image/png", []byte("image"))
	if err != nil {
		t.Fatal(err)
	}
	audio, err := media.ImportMedia("reference.mp3", "audio/mpeg", []byte("audio"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ReferenceIDs: []string{image.ID, audio.ID}}); err == nil {
		t.Fatal("default Gemini route accepted an audio reference")
	}
}

func TestAtlasLegacyBlankAPIBaseUsesProviderDefault(t *testing.T) {
	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas"}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	db, err := media.Database()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("update media_credentials set api_base = '' where id = ?", credential.ID); err != nil {
		t.Fatal(err)
	}
	credentials, err := media.ListCredentials()
	if err != nil || len(credentials) != 1 || credentials[0].APIBase != "https://api.atlascloud.ai" {
		t.Fatalf("legacy Atlas credential = %#v, %v", credentials, err)
	}
}

func TestAtlasVideoReferenceUploadsBeforeGeneration(t *testing.T) {
	var atlas *httptest.Server
	atlas = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/model/uploadMedia":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Fatal(err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"download_url": atlas.URL + "/uploaded-reference.mp4"}})
		case "/api/v1/model/generateVideo":
			payload := map[string]any{}
			_ = json.NewDecoder(r.Body).Decode(&payload)
			videos := payload["reference_videos"].([]any)
			if len(videos) != 1 || videos[0] != atlas.URL+"/uploaded-reference.mp4" {
				t.Fatalf("reference video payload = %#v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-video-reference", "status": "succeeded", "outputs": []string{atlas.URL + "/video.mp4"}}})
		case "/video.mp4":
			_, _ = w.Write([]byte("video"))
		default:
			t.Fatalf("unexpected Atlas path %s", r.URL.Path)
		}
	}))
	defer atlas.Close()
	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: atlas.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := media.ImportMedia("reference.png", "image/png", []byte("image"))
	if err != nil {
		t.Fatal(err)
	}
	video, err := media.ImportMedia("reference.mp4", "video/mp4", []byte("reference video"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := media.GenerateSync(GenerateMediaInput{Capability: VideoGenerate, Prompt: "continue the shot", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credential.ID, ReferenceIDs: []string{image.ID, video.ID}, IdempotencyKey: "atlas-video-reference"})
	if err != nil || len(job.AssetIDs) != 1 {
		t.Fatalf("Atlas video reference job = %#v, %v", job, err)
	}
}

func TestOpenAICompatibleDefaultsToWorkingGPTImage2(t *testing.T) {
	model, ok := modelByID("openai-compatible/image")
	if !ok || model.APIModelID != "gpt-image-2" {
		t.Fatalf("OpenAI-compatible model = %#v", model)
	}
}

func TestMediaReferenceKindsFollowCreationCapability(t *testing.T) {
	if !referenceKindsFor(ImageGenerate)["image"] || referenceKindsFor(ImageGenerate)["audio"] {
		t.Fatal("image creation must accept images only")
	}
	if !referenceKindsFor(VideoGenerate)["image"] || !referenceKindsFor(VideoGenerate)["video"] || !referenceKindsFor(VideoGenerate)["audio"] {
		t.Fatal("video creation must accept image, video, and audio context")
	}
}

func TestGenerateSyncReturnsTerminalFailure(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "openai-compatible", Name: "Unavailable", APIBase: "http://127.0.0.1:1"}, "secret-value")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.SaveRoute(MediaRoute{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	job, err := media.GenerateSync(GenerateMediaInput{Capability: ImageGenerate, Prompt: "test", IdempotencyKey: "sync-terminal"})
	if err == nil || job.Status != "failed" || job.Error == "" {
		t.Fatalf("synchronous generation must return a terminal failure, got %#v, %v", job, err)
	}
}

func TestImportedImageRejectsNonImageContent(t *testing.T) {
	media := NewMediaService(nil)
	if _, err := media.ImportImage("note.txt", "text/plain", []byte("not an image")); err == nil {
		t.Fatal("non-image import was accepted")
	}
}

func TestImportedMediaPreservesReferenceKinds(t *testing.T) {
	media := NewMediaService(NewStore(t.TempDir(), nil))
	for _, input := range []struct {
		name, mimeType, wantKind string
	}{{"reference.png", "image/png", "image"}, {"reference.mp3", "audio/mpeg", "audio"}, {"reference.mp4", "video/mp4", "video"}} {
		asset, err := media.ImportMedia(input.name, input.mimeType, []byte(input.wantKind))
		if err != nil || asset.Kind != input.wantKind {
			t.Fatalf("ImportMedia(%s) = %#v, %v", input.mimeType, asset, err)
		}
	}
	if _, err := media.ImportMedia("reference.txt", "text/plain", []byte("text")); err == nil {
		t.Fatal("non-media content was accepted")
	}
}

func TestImportImageReusesAssetWithMatchingContentHash(t *testing.T) {
	media := NewMediaService(NewStore(t.TempDir(), nil))
	content := []byte("same image bytes")
	first, err := media.ImportImage("first.png", "image/png", content)
	if err != nil {
		t.Fatal(err)
	}
	second, err := media.ImportImage("renamed-copy.png", "image/png", content)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID || second.ContentHash != first.ContentHash {
		t.Fatalf("duplicate import created a new asset: first=%#v second=%#v", first, second)
	}
	assets, err := media.ListAssets("")
	if err != nil || len(assets) != 1 {
		t.Fatalf("assets = %#v, %v", assets, err)
	}
}

func TestMediaRecoversInterruptedJobs(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	db, err := media.Database()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, status := range []string{"queued", "running", "completed"} {
		if _, err := db.Exec(`insert into media_jobs (id, idempotency_key, capability, status, prompt, model_id, credential_id, project_id, reference_ids_json, output_json, asset_ids_json, error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, status, "key-"+status, "image.generate", status, "test", "openai-compatible/image", "credential", "", "[]", "{}", "[]", "", now, now); err != nil {
			t.Fatal(err)
		}
	}
	recovered, err := media.RecoverInterruptedJobs()
	if err != nil || recovered != 2 {
		t.Fatalf("recovered = %d, %v", recovered, err)
	}
	rows, err := db.Query("select id, status, error from media_jobs order by id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]string{}
	for rows.Next() {
		var id, status, message string
		if err := rows.Scan(&id, &status, &message); err != nil {
			t.Fatal(err)
		}
		got[id] = status + ":" + message
	}
	if got["queued"] != "failed:"+interruptedMediaJobMessage || got["running"] != "failed:"+interruptedMediaJobMessage || got["completed"] != "completed:" {
		t.Fatalf("recovered job states = %#v", got)
	}
}

func TestMediaSystemProjectIsHiddenFromUserProjects(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	for _, app := range []struct{ dir, manifest string }{{"example", `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`}, {"media", `{"manifestVersion":1,"id":"recut.media-library","name":"Media","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`}} {
		if err := os.MkdirAll(filepath.Join(appsDir, app.dir), 0o755); err != nil {
			t.Fatal(err)
		}
		writeTestFile(t, filepath.Join(appsDir, app.dir, "manifest.json"), app.manifest)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.EnsureMediaSystemProject()
	if err != nil || project.ID != mediaSystemProjectID {
		t.Fatalf("system project = %#v, %v", project, err)
	}
	projects, err := store.List()
	if err != nil || len(projects) != 0 {
		t.Fatalf("visible projects = %#v, %v", projects, err)
	}
}
