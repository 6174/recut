/*
 * [INPUT]: 依赖 MediaService、Store 与测试目录中的临时工作区
 * [OUTPUT]: 验证媒体凭据加密保存、能力路由、受校验的模型/凭据直连、图片导入、幂等任务及 Atlas 异步 Asset 状态、生成耗时、常驻协调器和历史状态恢复契约
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
	"sync"
	"testing"
	"time"
)

func TestMediaRouteAndJobUseOpaqueCredential(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
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
	if _, err := media.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	if failed := waitForMediaJobStatus(t, media, job.ID, "failed"); failed.Error == "" {
		t.Fatalf("unavailable async image job lost its terminal error: %#v", failed)
	}
	direct, _, err := media.ResolveRoute(GenerateMediaInput{Capability: ImageGenerate, ModelID: "openai-compatible/image", CredentialID: credential.ID})
	if err != nil || direct.ModelID != "openai-compatible/image" {
		t.Fatalf("direct model route = %#v, %v", direct, err)
	}
	if _, _, err := media.ResolveRoute(GenerateMediaInput{Capability: ImageGenerate, ModelID: "openai/gpt-image-2", CredentialID: credential.ID}); err == nil {
		t.Fatal("direct generation accepted a credential from a different provider")
	}
}

func TestCodexImageRouteRequiresNoProviderCredential(t *testing.T) {
	media := NewMediaService(NewStore(t.TempDir(), nil))
	route, err := media.SaveRoute(MediaRoute{Capability: ImageGenerate, ModelID: CodexImageModelID, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if route.CredentialID != "" {
		t.Fatalf("Codex image route stored a credential: %#v", route)
	}
	configured, err := media.ConfiguredModels()
	if err != nil || len(configured) != 1 {
		t.Fatalf("configured Codex route = %#v, %v", configured, err)
	}
	if configured[0].Model.ID != CodexImageModelID || configured[0].CredentialName != "" {
		t.Fatalf("Codex configuration = %#v", configured[0])
	}
	if _, _, err := media.ResolveRoute(GenerateMediaInput{Capability: ImageGenerate}); err == nil || !strings.Contains(err.Error(), "configured for Codex") {
		t.Fatalf("Codex route must direct Agent to native image generation, got %v", err)
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

func TestAtlasAsyncVideoPublishesQueuedAssetThenCompletesInPlace(t *testing.T) {
	submissionStarted := make(chan struct{}, 1)
	pollStarted := make(chan struct{}, 1)
	releasePoll := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releasePoll) }) }

	var atlas *httptest.Server
	atlas = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/model/generateVideo":
			select {
			case submissionStarted <- struct{}{}:
			default:
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id":     "prediction-running",
				"status": "processing",
				"urls":   map[string]any{"get": atlas.URL + "/prediction-running"},
			}})
		case "/prediction-running":
			select {
			case pollStarted <- struct{}{}:
			default:
			}
			<-releasePoll
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id":      "prediction-running",
				"status":  "completed",
				"outputs": []string{atlas.URL + "/generated.mp4"},
			}})
		case "/generated.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("completed video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer atlas.Close()
	defer release()

	media, credentialID := newAtlasVideoMediaService(t, atlas.URL)
	image, err := media.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := media.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credentialID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "atlas-async-running"})
	if err != nil || job.Status != "queued" || job.RemoteID != "" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued Atlas job = %#v, %v", job, err)
	}
	assetID := job.AssetIDs[0]
	asset, err := media.GetAsset(assetID)
	if err != nil || asset.ID != assetID || asset.JobID != job.ID || asset.Status != "queued" || asset.RemoteID != "" {
		t.Fatalf("published queued Atlas asset = %#v, %v", asset, err)
	}
	startedAt := assertRunningAssetGenerationTiming(t, asset)
	select {
	case <-submissionStarted:
		t.Fatal("short-lived async submitter called Atlas before the daemon claimed the task")
	default:
	}

	stop := media.StartReconciler(10 * time.Millisecond)
	defer stop()
	select {
	case <-submissionStarted:
	case <-time.After(time.Second):
		t.Fatal("daemon did not submit queued Atlas task")
	}
	waitForAtlasPoll(t, pollStarted)
	running := waitForMediaJobStatus(t, media, job.ID, "running")
	if running.RemoteID != "prediction-running" || len(running.AssetIDs) != 1 || running.AssetIDs[0] != assetID {
		t.Fatalf("daemon did not bind the stable Atlas Asset: %#v", running)
	}
	asset, err = media.GetAsset(assetID)
	if err != nil || asset.Status != "running" || asset.RemoteID != running.RemoteID {
		t.Fatalf("running Atlas asset was not updated in place: %#v, %v", asset, err)
	}

	release()
	completed := waitForMediaJobStatus(t, media, job.ID, "completed")
	if completed.ID != job.ID || len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != assetID || completed.RemoteID != running.RemoteID {
		t.Fatalf("completed Atlas job lost its stable identity: queued=%#v after=%#v", job, completed)
	}
	asset, err = media.GetAsset(assetID)
	if err != nil || asset.Status != "completed" || asset.ID != assetID || asset.JobID != job.ID || asset.RemoteID != running.RemoteID || asset.SizeBytes == 0 {
		t.Fatalf("completed Atlas asset was not updated in place: %#v, %v", asset, err)
	}
	assertCompletedAssetGenerationTiming(t, asset, startedAt)
	assets, err := media.ListAssets("")
	if err != nil {
		t.Fatal(err)
	}
	listed, ok := mediaAssetByID(assets, assetID)
	if !ok {
		t.Fatalf("completed Atlas asset %q missing from list: %#v", assetID, assets)
	}
	assertCompletedAssetGenerationTiming(t, listed, startedAt)
}

func TestAtlasAsyncVideoMarksPublishedAssetFailed(t *testing.T) {
	pollStarted := make(chan struct{}, 1)
	releasePoll := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releasePoll) }) }

	var atlas *httptest.Server
	atlas = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/model/generateVideo":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-failed", "status": "accepted", "urls": map[string]any{"get": atlas.URL + "/prediction-failed"}}})
		case "/prediction-failed":
			select {
			case pollStarted <- struct{}{}:
			default:
			}
			<-releasePoll
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-failed", "status": "failed", "error": "Atlas credits exhausted"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer atlas.Close()
	defer release()

	media, credentialID := newAtlasVideoMediaService(t, atlas.URL)
	image, err := media.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := media.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credentialID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "atlas-async-failed"})
	if err != nil || job.Status != "queued" || job.RemoteID != "" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued Atlas job = %#v, %v", job, err)
	}
	assetID := job.AssetIDs[0]
	queuedAsset, err := media.GetAsset(assetID)
	if err != nil || queuedAsset.Status != "queued" || queuedAsset.RemoteID != "" {
		t.Fatalf("published queued Atlas asset = %#v, %v", queuedAsset, err)
	}
	startedAt := assertRunningAssetGenerationTiming(t, queuedAsset)
	stop := media.StartReconciler(10 * time.Millisecond)
	defer stop()
	waitForAtlasPoll(t, pollStarted)
	running := waitForMediaJobStatus(t, media, job.ID, "running")
	if running.RemoteID != "prediction-failed" || len(running.AssetIDs) != 1 || running.AssetIDs[0] != assetID {
		t.Fatalf("daemon did not bind failed prediction to stable Asset: %#v", running)
	}

	release()
	failed := waitForMediaJobStatus(t, media, job.ID, "failed")
	if failed.ID != job.ID || len(failed.AssetIDs) != 1 || failed.AssetIDs[0] != assetID || !strings.Contains(failed.Error, "credits exhausted") {
		t.Fatalf("failed Atlas job = %#v", failed)
	}
	asset, err := media.GetAsset(assetID)
	if err != nil || asset.ID != assetID || asset.Status != "failed" || asset.JobID != job.ID || asset.RemoteID != running.RemoteID || !strings.Contains(asset.Error, "credits exhausted") {
		t.Fatalf("failed Atlas asset = %#v, %v", asset, err)
	}
	assertCompletedAssetGenerationTiming(t, asset, startedAt)
}

func TestAtlasAsyncRecoveryResumesPersistedPrediction(t *testing.T) {
	pollRequests := make(chan int, 2)
	allowRecoveredPoll := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(allowRecoveredPoll) }) }
	var pollMu sync.Mutex
	polls := 0

	var atlas *httptest.Server
	atlas = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/model/generateVideo":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id":     "prediction-recover",
				"status": "processing",
				"urls":   map[string]any{"get": atlas.URL + "/prediction-recover"},
			}})
		case "/prediction-recover":
			pollMu.Lock()
			polls++
			poll := polls
			pollMu.Unlock()
			pollRequests <- poll
			<-allowRecoveredPoll
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"id":      "prediction-recover",
				"status":  "succeeded",
				"outputs": []string{atlas.URL + "/recovered.mp4"},
			}})
		case "/recovered.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("recovered video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer atlas.Close()
	defer release()

	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: atlas.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := media.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := media.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credential.ID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "atlas-async-recover"})
	if err != nil || job.Status != "queued" || job.RemoteID != "" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued Atlas job = %#v, %v", job, err)
	}
	assetID := job.AssetIDs[0]
	if asset, err := media.GetAsset(assetID); err != nil || asset.Status != "queued" || asset.RemoteID != "" {
		t.Fatalf("durable queued Atlas asset = %#v, %v", asset, err)
	}
	daemon := NewMediaService(store)
	if _, err := daemon.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	running := waitForMediaJobStatus(t, daemon, job.ID, "running")
	if running.RemoteID != "prediction-recover" || len(running.AssetIDs) != 1 || running.AssetIDs[0] != assetID {
		t.Fatalf("daemon did not bind durable Atlas prediction: %#v", running)
	}
	restarted := NewMediaService(store)
	recovered, err := restarted.RecoverInterruptedJobs()
	if err != nil || recovered != 1 {
		t.Fatalf("RecoverInterruptedJobs() = %d, %v", recovered, err)
	}
	if poll := waitForAtlasPollNumber(t, pollRequests); poll != 1 {
		t.Fatalf("recovered Atlas poll = %d, want 1", poll)
	}

	release()
	completed := waitForMediaJobStatus(t, restarted, job.ID, "completed")
	if completed.ID != job.ID || completed.RemoteID != "prediction-recover" || len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != assetID {
		t.Fatalf("recovered Atlas job = %#v", completed)
	}
	asset, err := restarted.GetAsset(assetID)
	if err != nil || asset.Status != "completed" || asset.ID != assetID || asset.RemoteID != "prediction-recover" || asset.JobID != job.ID {
		t.Fatalf("recovered Atlas asset = %#v, %v", asset, err)
	}
}

func TestStartReconcilerDiscoversAtlasSubmissionAfterStartup(t *testing.T) {
	initialPoll := make(chan struct{}, 1)
	completedPoll := make(chan struct{}, 1)
	releaseInitialPoll := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseInitialPoll) }) }
	var pollMu sync.Mutex
	polls := 0

	var atlas *httptest.Server
	atlas = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/model/generateVideo":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-daemon", "status": "processing"}})
		case "/api/v1/model/prediction/prediction-daemon":
			pollMu.Lock()
			polls++
			poll := polls
			pollMu.Unlock()
			if poll == 1 {
				initialPoll <- struct{}{}
				<-releaseInitialPoll
				_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-daemon", "status": "completed", "outputs": []string{atlas.URL + "/daemon.mp4"}}})
				select {
				case completedPoll <- struct{}{}:
				default:
				}
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-daemon", "status": "completed", "outputs": []string{atlas.URL + "/daemon.mp4"}}})
			select {
			case completedPoll <- struct{}{}:
			default:
			}
		case "/daemon.mp4":
			_, _ = w.Write([]byte("daemon video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer atlas.Close()
	defer release()

	store := NewStore(t.TempDir(), nil)
	daemon := NewMediaService(store)
	credential, err := daemon.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: atlas.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := daemon.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	submitter := NewMediaService(store)
	job, err := submitter.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credential.ID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "atlas-daemon-reconcile"})
	if err != nil || job.Status != "queued" || job.RemoteID != "" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued Atlas job = %#v, %v", job, err)
	}
	if asset, err := submitter.GetAsset(job.AssetIDs[0]); err != nil || asset.Status != "queued" || asset.RemoteID != "" {
		t.Fatalf("queued Atlas asset = %#v, %v", asset, err)
	}
	stop := daemon.StartReconciler(100 * time.Millisecond)
	defer stop()
	waitForAtlasPoll(t, initialPoll)
	release()
	select {
	case <-completedPoll:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("periodic reconciliation did not start a durable Atlas poller")
	}
	completed := waitForMediaJobStatus(t, daemon, job.ID, "completed")
	if len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != job.AssetIDs[0] {
		t.Fatalf("daemon reconciliation lost asset reference: %#v", completed)
	}
}

func newAtlasVideoMediaService(t *testing.T, apiBase string) (*MediaService, string) {
	t.Helper()
	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: apiBase}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	return media, credential.ID
}

func waitForAtlasPoll(t *testing.T, polls <-chan struct{}) {
	t.Helper()
	select {
	case <-polls:
	case <-time.After(time.Second):
		t.Fatal("Atlas poll did not start")
	}
}

func waitForAtlasPollNumber(t *testing.T, polls <-chan int) int {
	t.Helper()
	select {
	case poll := <-polls:
		return poll
	case <-time.After(time.Second):
		t.Fatal("Atlas poll did not start")
		return 0
	}
}

func waitForMediaJobStatus(t *testing.T, media *MediaService, jobID, want string) MediaJob {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var last MediaJob
	var lastErr error
	for time.Now().Before(deadline) {
		job, err := media.GetJob(jobID)
		if err == nil {
			last = job
			if job.Status == want {
				return job
			}
		} else {
			lastErr = err
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("media job %s never reached %q: last=%#v err=%v", jobID, want, last, lastErr)
	return MediaJob{}
}

func assertRunningAssetGenerationTiming(t *testing.T, asset MediaAsset) time.Time {
	t.Helper()
	value, ok := asset.Metadata["generationStartedAt"].(string)
	if !ok || value == "" {
		t.Fatalf("running Asset has no generationStartedAt: %#v", asset.Metadata)
	}
	startedAt, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		t.Fatalf("invalid generationStartedAt %q: %v", value, err)
	}
	for _, key := range []string{"generationCompletedAt", "generationDurationMs"} {
		if _, exists := asset.Metadata[key]; exists {
			t.Fatalf("running Asset unexpectedly has %s: %#v", key, asset.Metadata)
		}
	}
	return startedAt
}

func assertCompletedAssetGenerationTiming(t *testing.T, asset MediaAsset, startedAt time.Time) {
	t.Helper()
	started, ok := asset.Metadata["generationStartedAt"].(string)
	if !ok || started != startedAt.Format(time.RFC3339Nano) {
		t.Fatalf("generation start changed: want=%s metadata=%#v", startedAt.Format(time.RFC3339Nano), asset.Metadata)
	}
	completed, ok := asset.Metadata["generationCompletedAt"].(string)
	if !ok {
		t.Fatalf("terminal Asset has no generationCompletedAt: %#v", asset.Metadata)
	}
	completedAt, err := time.Parse(time.RFC3339Nano, completed)
	if err != nil || completedAt.Before(startedAt) {
		t.Fatalf("invalid generation completion %q after %s: %v", completed, startedAt, err)
	}
	duration, ok := asset.Metadata["generationDurationMs"].(float64)
	want := float64(completedAt.Sub(startedAt).Milliseconds())
	if !ok || duration != want || duration < 0 {
		t.Fatalf("generationDurationMs = %#v, want %.0f in %#v", asset.Metadata["generationDurationMs"], want, asset.Metadata)
	}
}

func mediaAssetByID(assets []MediaAsset, id string) (MediaAsset, bool) {
	for _, asset := range assets {
		if asset.ID == id {
			return asset, true
		}
	}
	return MediaAsset{}, false
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
	if submitted["generate_audio"] != true || job.Output["generateAudio"] != true {
		t.Fatalf("Seedance synchronized audio default was not persisted: payload=%#v job=%#v", submitted, job.Output)
	}
	asset, err := media.GetAsset(job.AssetIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	output, _ := asset.Metadata["output"].(map[string]any)
	if output["generateAudio"] != true {
		t.Fatalf("generated asset lost synchronized audio intent: %#v", asset.Metadata)
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
