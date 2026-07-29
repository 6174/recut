/*
 * [INPUT]: 依赖 MediaService、Store、测试 HTTP Provider 与异步任务辅助断言
 * [OUTPUT]: 验证本地排队 Asset、常驻协调器、恢复策略与基础媒体生命周期
 * [POS]: service/media_test 的生命周期拆分；覆盖 daemon 接管而非 MCP 子进程执行的契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

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

func TestStartReconcilerCompletesQueuedSpeechAssetFromSeparateSubmitter(t *testing.T) {
	providerRequest := make(chan struct{}, 1)
	releaseProvider := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseProvider) }) }
	defer release()

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/t2a_v2" || r.Header.Get("Authorization") != "Bearer minimax-key" {
			t.Fatalf("unexpected local async provider request: %s", r.URL.Path)
		}
		select {
		case providerRequest <- struct{}{}:
		default:
		}
		<-releaseProvider
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"audio": "010203"}, "base_resp": map[string]any{"status_code": 0}})
	}))
	defer provider.Close()

	store := NewStore(t.TempDir(), nil)
	daemon := NewMediaService(store)
	credential, err := daemon.SaveCredential(MediaCredential{Provider: "minimax", Name: "MiniMax", APIBase: provider.URL}, "minimax-key")
	if err != nil {
		t.Fatal(err)
	}
	submitter := NewMediaService(store)
	job, err := submitter.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好", ModelID: "minimax/speech-2.8-hd", CredentialID: credential.ID, Output: map[string]any{"voiceId": "news"}, IdempotencyKey: "speech-daemon-reconcile"})
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 || job.RemoteID != "" {
		t.Fatalf("queued speech submission = %#v, %v", job, err)
	}
	assetID := job.AssetIDs[0]
	asset, err := submitter.GetAsset(assetID)
	if err != nil || asset.Status != "queued" || asset.JobID != job.ID || asset.RemoteID != "" || asset.Kind != "audio" {
		t.Fatalf("queued speech Asset = %#v, %v", asset, err)
	}
	startedAt := assertRunningAssetGenerationTiming(t, asset)
	select {
	case <-providerRequest:
		t.Fatal("short-lived submitter executed the provider request")
	case <-time.After(80 * time.Millisecond):
	}

	stop := daemon.StartReconciler(10 * time.Millisecond)
	defer stop()
	select {
	case <-providerRequest:
	case <-time.After(time.Second):
		t.Fatal("daemon reconciler did not claim queued speech")
	}
	running := waitForMediaJobStatus(t, daemon, job.ID, "running")
	if len(running.AssetIDs) != 1 || running.AssetIDs[0] != assetID {
		t.Fatalf("claimed speech job lost asset identity: %#v", running)
	}
	asset, err = daemon.GetAsset(assetID)
	if err != nil || asset.Status != "running" || asset.JobID != job.ID {
		t.Fatalf("claimed speech Asset = %#v, %v", asset, err)
	}

	release()
	completed := waitForMediaJobStatus(t, daemon, job.ID, "completed")
	if len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != assetID {
		t.Fatalf("completed speech job lost asset identity: %#v", completed)
	}
	asset, err = daemon.GetAsset(assetID)
	if err != nil || asset.Status != "completed" || asset.ID != assetID || asset.Kind != "audio" {
		t.Fatalf("completed speech Asset = %#v, %v", asset, err)
	}
	assertCompletedAssetGenerationTiming(t, asset, startedAt)
}

func TestRecoverInterruptedJobsKeepsFreshQueuedSpeechAsset(t *testing.T) {
	providerRequest := make(chan struct{}, 1)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/t2a_v2" {
			t.Fatalf("unexpected recovery provider request: %s", r.URL.Path)
		}
		select {
		case providerRequest <- struct{}{}:
		default:
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"audio": "010203"}, "base_resp": map[string]any{"status_code": 0}})
	}))
	defer provider.Close()

	store := NewStore(t.TempDir(), nil)
	submitter := NewMediaService(store)
	credential, err := submitter.SaveCredential(MediaCredential{Provider: "minimax", Name: "MiniMax", APIBase: provider.URL}, "minimax-key")
	if err != nil {
		t.Fatal(err)
	}
	job, err := submitter.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好", ModelID: "minimax/speech-2.8-hd", CredentialID: credential.ID, Output: map[string]any{"voiceId": "news"}, IdempotencyKey: "speech-recover-queued"})
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued recovery speech = %#v, %v", job, err)
	}
	select {
	case <-providerRequest:
		t.Fatal("submitter executed the provider request before recovery")
	case <-time.After(80 * time.Millisecond):
	}

	restarted := NewMediaService(store)
	recovered, err := restarted.RecoverInterruptedJobs()
	if err != nil || recovered != 1 {
		t.Fatalf("RecoverInterruptedJobs() = %d, %v", recovered, err)
	}
	select {
	case <-providerRequest:
	case <-time.After(time.Second):
		t.Fatal("recovery did not resume the queued local task")
	}
	completed := waitForMediaJobStatus(t, restarted, job.ID, "completed")
	if len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != job.AssetIDs[0] {
		t.Fatalf("recovered queued job lost asset identity: %#v", completed)
	}
	asset, err := restarted.GetAsset(job.AssetIDs[0])
	if err != nil || asset.Status != "completed" {
		t.Fatalf("recovered queued Asset = %#v, %v", asset, err)
	}
}

func TestReconcilerFailsAtlasAssetWhenCredentialIsUnavailable(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/model/generateVideo" {
			t.Fatalf("unexpected Atlas request: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-orphaned-credential", "status": "processing"}})
	}))
	defer provider.Close()

	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: provider.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := media.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := media.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credential.ID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "atlas-missing-credential"})
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 || job.RemoteID != "" {
		t.Fatalf("queued Atlas job = %#v, %v", job, err)
	}
	db, err := media.Database()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("delete from media_credentials where id = ?", credential.ID); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if reconciled, err := media.ReconcilePendingJobs(); err != nil || reconciled != 1 {
		t.Fatalf("ReconcilePendingJobs() = %d, %v", reconciled, err)
	}
	failed := waitForMediaJobStatus(t, media, job.ID, "failed")
	if failed.Error == "" {
		t.Fatalf("unavailable Atlas credential did not produce a diagnostic: %#v", failed)
	}
	asset, err := media.GetAsset(job.AssetIDs[0])
	if err != nil || asset.Status != "failed" || asset.Error == "" {
		t.Fatalf("unavailable Atlas credential left Asset unresolved: %#v, %v", asset, err)
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

func TestLegacyUnboundMediaAssetStatusReadsCompleted(t *testing.T) {
	media := NewMediaService(NewStore(t.TempDir(), nil))
	asset, err := media.ImportImage("legacy.png", "image/png", []byte("legacy image"))
	if err != nil {
		t.Fatal(err)
	}
	db, err := media.Database()
	if err != nil {
		t.Fatal(err)
	}
	for _, legacyStatus := range []string{"", "running"} {
		if _, err := db.Exec("update media_assets set status = ?, job_id = '', remote_id = '' where id = ?", legacyStatus, asset.ID); err != nil {
			_ = db.Close()
			t.Fatal(err)
		}
		legacy, err := media.GetAsset(asset.ID)
		if err != nil || legacy.Status != "completed" {
			t.Fatalf("legacy %q asset = %#v, %v", legacyStatus, legacy, err)
		}
		assets, err := media.ListAssets("")
		if err != nil || len(assets) != 1 || assets[0].ID != asset.ID || assets[0].Status != "completed" {
			t.Fatalf("media library legacy %q asset = %#v, %v", legacyStatus, assets, err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestMediaRecoveryLeavesMalformedLegacyJobsUntouched(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	db, err := media.Database()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	then := time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339Nano)
	for _, status := range []string{"queued", "running", "completed"} {
		if _, err := db.Exec(`insert into media_jobs (id, idempotency_key, capability, status, prompt, model_id, credential_id, project_id, reference_ids_json, output_json, asset_ids_json, error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, status, "key-"+status, "image.generate", status, "test", "openai-compatible/image", "credential", "", "[]", "{}", "[]", "", then, then); err != nil {
			t.Fatal(err)
		}
	}
	recovered, err := media.RecoverInterruptedJobs()
	if err != nil || recovered != 0 {
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
	if got["queued"] != "queued:" || got["running"] != "running:" || got["completed"] != "completed:" {
		t.Fatalf("recovered job states = %#v", got)
	}
}

func TestMediaSystemProjectIsHiddenFromUserProjects(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	for _, app := range []struct{ dir, manifest string }{{"example", `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`}, {"media", `{"manifestVersion":1,"id":"recut.media-library","name":"Media","author":"Recut","description":"System media library.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`}} {
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
