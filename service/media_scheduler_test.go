/*
 * [INPUT]: 依赖 MediaService、共享 SQLite Store 与可控 Atlas/MiniMax HTTP 测试服务
 * [OUTPUT]: 验证提交 checkpoint 不重放、one-request 任务原子激活及按凭据限流、Atlas 单边远端关联自愈、多 Daemon lease 独占提交、本地 provider 无凭据直连，以及无凭据本地 provider 不共用全局一次请求槽位（跨 App 不互相阻塞）
 * [POS]: service 的 durable scheduler 回归测试；补足媒体生命周期测试的跨进程安全边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	media "recut-service/media"
)

func TestExpiredAtlasSubmissionCheckpointFailsWithoutRepeatPost(t *testing.T) {
	var calls int
	var callsMu sync.Mutex
	atlas := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/model/generateVideo" {
			http.NotFound(w, r)
			return
		}
		callsMu.Lock()
		calls++
		callsMu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "must-not-exist", "status": "processing"}})
	}))
	defer atlas.Close()

	store := NewStore(t.TempDir(), nil)
	submitter := NewMediaService(store)
	credential, err := submitter.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: atlas.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := submitter.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := submitter.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credential.ID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "atlas-uncertain-checkpoint"})
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued Atlas job = %#v, %v", job, err)
	}

	// This is the durable state left by a daemon that wrote its checkpoint and
	// then died before it could commit Atlas' prediction ID.
	db, err := submitter.Database()
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-3 * time.Minute)
	if _, err := db.Exec("update media_jobs set submission_started_at = ?, updated_at = ? where id = ?", past.Format(time.RFC3339Nano), past.Format(time.RFC3339Nano), job.ID); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into media_task_leases (job_id, owner_id, expires_at_ms, updated_at) values (?, ?, ?, ?)", job.ID, "dead-daemon", past.UnixMilli(), past.Format(time.RFC3339Nano)); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	daemon := NewMediaService(store)
	if reconciled, err := daemon.ReconcilePendingJobs(); err != nil || reconciled != 1 {
		t.Fatalf("ReconcilePendingJobs() = %d, %v", reconciled, err)
	}
	failed := waitForMediaJobStatus(t, daemon, job.ID, "failed")
	if failed.RemoteID != "" || failed.AssetIDs[0] != job.AssetIDs[0] || failed.Error != "Atlas 提交结果不确定，请用新任务重试。" {
		t.Fatalf("uncertain Atlas submission = %#v", failed)
	}
	asset, err := daemon.GetAsset(job.AssetIDs[0])
	if err != nil || asset.Status != "failed" || asset.ID != job.AssetIDs[0] || asset.Error != failed.Error {
		t.Fatalf("uncertain Atlas Asset = %#v, %v", asset, err)
	}
	callsMu.Lock()
	defer callsMu.Unlock()
	if calls != 0 {
		t.Fatalf("expired Atlas checkpoint was submitted %d time(s)", calls)
	}
}

func TestExpiredOneRequestSubmissionCheckpointFailsWithoutReplay(t *testing.T) {
	var calls int
	var callsMu sync.Mutex
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/t2a_v2" {
			http.NotFound(w, r)
			return
		}
		callsMu.Lock()
		calls++
		callsMu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"audio": "010203"}, "base_resp": map[string]any{"status_code": 0}})
	}))
	defer provider.Close()

	store := NewStore(t.TempDir(), nil)
	submitter := NewMediaService(store)
	credential, err := submitter.SaveCredential(MediaCredential{Provider: "minimax", Name: "MiniMax", APIBase: provider.URL}, "minimax-key")
	if err != nil {
		t.Fatal(err)
	}
	input := GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好", ModelID: "minimax/speech-2.8-hd", CredentialID: credential.ID, Output: map[string]any{"voiceId": "news"}, IdempotencyKey: "minimax-uncertain-checkpoint"}
	job, err := submitter.Generate(input)
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued MiniMax job = %#v, %v", job, err)
	}

	// The durable checkpoint means this one-request call may already have
	// reached MiniMax. Recovery must preserve the same local reference and
	// never make a second potentially billable request.
	db, err := submitter.Database()
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-3 * time.Minute)
	if _, err := db.Exec("update media_jobs set submission_started_at = ?, updated_at = ? where id = ?", past.Format(time.RFC3339Nano), past.Format(time.RFC3339Nano), job.ID); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into media_task_leases (job_id, owner_id, expires_at_ms, updated_at) values (?, ?, ?, ?)", job.ID, "dead-daemon", past.UnixMilli(), past.Format(time.RFC3339Nano)); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	daemon := NewMediaService(store)
	if reconciled, err := daemon.ReconcilePendingJobs(); err != nil || reconciled != 1 {
		t.Fatalf("ReconcilePendingJobs() = %d, %v", reconciled, err)
	}
	failed := waitForMediaJobStatus(t, daemon, job.ID, "failed")
	const message = "媒体提交结果不确定，请用新任务重试。"
	if failed.RemoteID != "" || len(failed.AssetIDs) != 1 || failed.AssetIDs[0] != job.AssetIDs[0] || failed.Error != message {
		t.Fatalf("uncertain MiniMax submission = %#v", failed)
	}
	asset, err := daemon.GetAsset(job.AssetIDs[0])
	if err != nil || asset.Status != "failed" || asset.ID != job.AssetIDs[0] || asset.Error != message {
		t.Fatalf("uncertain MiniMax Asset = %#v, %v", asset, err)
	}

	// Repeating either recovery or the original idempotent submission may only
	// return the terminal task; it must not revive or replay the provider call.
	if reconciled, err := daemon.ReconcilePendingJobs(); err != nil || reconciled != 0 {
		t.Fatalf("second ReconcilePendingJobs() = %d, %v", reconciled, err)
	}
	again, err := daemon.Generate(input)
	if err != nil || again.ID != job.ID || again.Status != "failed" || len(again.AssetIDs) != 1 || again.AssetIDs[0] != job.AssetIDs[0] {
		t.Fatalf("idempotent MiniMax retry = %#v, %v", again, err)
	}
	callsMu.Lock()
	defer callsMu.Unlock()
	if calls != 0 {
		t.Fatalf("expired MiniMax checkpoint was submitted %d time(s)", calls)
	}
}

func TestConcurrentOneRequestSpeechTasksActivateAtomically(t *testing.T) {
	const taskCount = 6
	var calls, concurrent, maximumConcurrent int
	var providerMu sync.Mutex

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/t2a_v2" {
			http.NotFound(w, r)
			return
		}
		providerMu.Lock()
		calls++
		concurrent++
		if concurrent > maximumConcurrent {
			maximumConcurrent = concurrent
		}
		providerMu.Unlock()
		time.Sleep(20 * time.Millisecond)
		providerMu.Lock()
		concurrent--
		providerMu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"audio": "010203"}, "base_resp": map[string]any{"status_code": 0}})
	}))
	defer provider.Close()

	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "minimax", Name: "MiniMax", APIBase: provider.URL}, "minimax-key")
	if err != nil {
		t.Fatal(err)
	}
	jobs := make([]MediaJob, 0, taskCount)
	for index := 0; index < taskCount; index++ {
		job, err := media.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好", ModelID: "minimax/speech-2.8-hd", CredentialID: credential.ID, Output: map[string]any{"voiceId": "news"}, IdempotencyKey: "concurrent-speech-" + string(rune('a'+index))})
		if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 {
			t.Fatalf("queued speech job %d = %#v, %v", index, job, err)
		}
		jobs = append(jobs, job)
	}

	if _, err := media.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	for _, job := range jobs {
		completed := waitForMediaJobStatus(t, media, job.ID, "completed")
		if len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != job.AssetIDs[0] {
			t.Fatalf("completed concurrent speech job lost Asset identity: %#v", completed)
		}
	}
	providerMu.Lock()
	defer providerMu.Unlock()
	if calls != taskCount || maximumConcurrent != 1 {
		t.Fatalf("one-request provider calls = %d, max concurrent = %d; want %d, 1", calls, maximumConcurrent, taskCount)
	}
}

func TestRecoverAtlasPredictionFromOneSidedBinding(t *testing.T) {
	var submits, polls int
	var callsMu sync.Mutex
	var atlas *httptest.Server
	atlas = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callsMu.Lock()
		defer callsMu.Unlock()
		switch r.URL.Path {
		case "/api/v1/model/generateVideo":
			submits++
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-one-sided", "status": "processing"}})
		case "/api/v1/model/prediction/prediction-one-sided":
			polls++
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-one-sided", "status": "completed", "outputs": []string{atlas.URL + "/one-sided.mp4"}}})
		case "/one-sided.mp4":
			_, _ = w.Write([]byte("one-sided video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer atlas.Close()

	store := NewStore(t.TempDir(), nil)
	submitter := NewMediaService(store)
	credential, err := submitter.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: atlas.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := submitter.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := submitter.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credential.ID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "atlas-one-sided-binding"})
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued Atlas job = %#v, %v", job, err)
	}

	daemon := NewMediaService(store)
	if _, err := daemon.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	running := waitForMediaJobStatus(t, daemon, job.ID, "running")
	waitForMediaTaskLeaseRelease(t, daemon, job.ID)

	// Simulate a legacy/partial write: the Asset still has the Atlas prediction
	// but the job lost its matching handle. Before repair this state was never
	// selected for polling and could remain running after Atlas had completed.
	db, err := daemon.Database()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("update media_jobs set remote_id = '', remote_poll_url = '' where id = ?", running.ID); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	if recovered, err := daemon.RecoverInterruptedJobs(); err != nil || recovered == 0 {
		t.Fatalf("RecoverInterruptedJobs() = %d, %v", recovered, err)
	}
	completed := waitForMediaJobStatus(t, daemon, job.ID, "completed")
	asset, err := daemon.GetAsset(job.AssetIDs[0])
	if err != nil || completed.RemoteID != "prediction-one-sided" || asset.Status != "completed" || asset.RemoteID != "prediction-one-sided" {
		t.Fatalf("repaired Atlas prediction = job=%#v asset=%#v err=%v", completed, asset, err)
	}
	callsMu.Lock()
	defer callsMu.Unlock()
	if submits != 1 || polls == 0 {
		t.Fatalf("one-sided recovery calls = submits:%d polls:%d", submits, polls)
	}
}

func TestRecoverWavespeedUncertainSubmissionFromHistory(t *testing.T) {
	var submits int
	var callsMu sync.Mutex
	var wavespeed *httptest.Server
	wavespeed = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callsMu.Lock()
		defer callsMu.Unlock()
		switch r.URL.Path {
		case "/api/v3/openai/gpt-image-2.5-flare/edit":
			// A recovery must never reach the paid submit path; the counter
			// guards that invariant.
			submits++
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-orphan", "status": "processing", "urls": map[string]any{"get": "/api/v3/predictions/prediction-orphan/result"}}})
		case "/api/v3/predictions":
			// History lookup: the paid call is still processing upstream.
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"items": []map[string]any{{"id": "prediction-orphan", "status": "processing", "urls": map[string]any{"get": "/api/v3/predictions/prediction-orphan/result"}}}}})
		case "/api/v3/predictions/prediction-orphan/result":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "prediction-orphan", "status": "completed", "outputs": []string{wavespeed.URL + "/orphan.png"}}})
		case "/orphan.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("recovered image"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer wavespeed.Close()

	store := NewStore(t.TempDir(), nil)
	submitter := NewMediaService(store)
	credential, err := submitter.SaveCredential(MediaCredential{Provider: "wavespeed", Name: "WaveSpeed", APIBase: wavespeed.URL}, "wavespeed-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := submitter.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := submitter.Generate(GenerateMediaInput{Capability: ImageGenerate, Prompt: "edit", ModelID: "wavespeed/openai/gpt-image-2.5-flare/edit", CredentialID: credential.ID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "wavespeed-uncertain-recover"})
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued WaveSpeed job = %#v, %v", job, err)
	}

	// Simulate a daemon that wrote its submission checkpoint and then died
	// before it could persist the prediction ID returned by a successful submit.
	db, err := submitter.Database()
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-3 * time.Minute)
	if _, err := db.Exec("update media_jobs set submission_started_at = ?, updated_at = ? where id = ?", past.Format(time.RFC3339Nano), past.Format(time.RFC3339Nano), job.ID); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into media_task_leases (job_id, owner_id, expires_at_ms, updated_at) values (?, ?, ?, ?)", job.ID, "dead-daemon", past.UnixMilli(), past.Format(time.RFC3339Nano)); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	daemon := NewMediaService(store)
	if reconciled, err := daemon.ReconcilePendingJobs(); err != nil || reconciled != 1 {
		t.Fatalf("ReconcilePendingJobs() = %d, %v", reconciled, err)
	}
	failed := waitForMediaJobStatus(t, daemon, job.ID, "failed")
	if failed.RemoteID != "" || len(failed.AssetIDs) != 1 || failed.AssetIDs[0] != job.AssetIDs[0] {
		t.Fatalf("uncertain WaveSpeed job = %#v", failed)
	}
	asset, err := daemon.GetAsset(job.AssetIDs[0])
	if err != nil || asset.Status != "failed" {
		t.Fatalf("uncertain WaveSpeed asset = %#v, %v", asset, err)
	}
	// The unsafe "new task retry" is demoted: the asset is flagged recoverable.
	if asset.Metadata["submissionUncertain"] != true {
		t.Fatalf("uncertain WaveSpeed asset missing recoverable flag: %#v", asset.Metadata)
	}
	if asset.RemoteID != "" {
		t.Fatalf("uncertain WaveSpeed asset must not carry a remote id: %#v", asset)
	}

	// Recovery re-attaches the orphaned paid prediction from history — without
	// a second submission — and collects the completed output in place.
	recovered, err := daemon.RecoverGeneration(asset.ID)
	if err != nil {
		t.Fatalf("RecoverGeneration() = %#v, %v", recovered, err)
	}
	completed := waitForMediaJobStatus(t, daemon, job.ID, "completed")
	if completed.RemoteID != "prediction-orphan" || len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != asset.ID {
		t.Fatalf("recovered WaveSpeed job = %#v", completed)
	}
	final, err := daemon.GetAsset(asset.ID)
	if err != nil || final.Status != "completed" || final.RemoteID != "prediction-orphan" || final.ID != asset.ID {
		t.Fatalf("recovered WaveSpeed asset = %#v, %v", final, err)
	}
	if _, flagged := final.Metadata["submissionUncertain"]; flagged {
		t.Fatalf("recovered WaveSpeed asset kept the uncertainty flag: %#v", final.Metadata)
	}
	callsMu.Lock()
	defer callsMu.Unlock()
	if submits != 0 {
		t.Fatalf("recovery must not submit; WaveSpeed submits = %d, want 0", submits)
	}
}

func TestRecoverWavespeedUncertainSubmissionFailsClosedWithoutHistory(t *testing.T) {
	wavespeed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v3/predictions" {
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"items": []map[string]any{}}})
			return
		}
		http.NotFound(w, r)
	}))
	defer wavespeed.Close()

	store := NewStore(t.TempDir(), nil)
	submitter := NewMediaService(store)
	credential, err := submitter.SaveCredential(MediaCredential{Provider: "wavespeed", Name: "WaveSpeed", APIBase: wavespeed.URL}, "wavespeed-key")
	if err != nil {
		t.Fatal(err)
	}
	job, err := submitter.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好", ModelID: "wavespeed/bytedance/seed-audio-1.0", CredentialID: credential.ID, Output: map[string]any{"voiceId": "x"}, IdempotencyKey: "wavespeed-uncertain-no-history"})
	if err != nil || len(job.AssetIDs) != 1 {
		t.Fatalf("queued WaveSpeed speech job = %#v, %v", job, err)
	}
	db, err := submitter.Database()
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-3 * time.Minute)
	if _, err := db.Exec("update media_jobs set submission_started_at = ?, updated_at = ? where id = ?", past.Format(time.RFC3339Nano), past.Format(time.RFC3339Nano), job.ID); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into media_task_leases (job_id, owner_id, expires_at_ms, updated_at) values (?, ?, ?, ?)", job.ID, "dead-daemon", past.UnixMilli(), past.Format(time.RFC3339Nano)); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	_ = db.Close()

	daemon := NewMediaService(store)
	if _, err := daemon.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	waitForMediaJobStatus(t, daemon, job.ID, "failed")

	// No matching remote task: recovery fails closed (no resubmission), leaving
	// the asset failed so the user can still explicitly regenerate.
	if _, err := daemon.RecoverGeneration(job.AssetIDs[0]); err == nil {
		t.Fatal("recovery without a matching remote task must report failure")
	}
	asset, err := daemon.GetAsset(job.AssetIDs[0])
	if err != nil || asset.Status != "failed" || asset.RemoteID != "" {
		t.Fatalf("asset after failed recovery = %#v, %v", asset, err)
	}
}

func TestTwoDaemonsSubmitQueuedAtlasTaskOnlyOnce(t *testing.T) {
	postStarted := make(chan struct{}, 2)
	releasePost := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(releasePost) })
	var calls int
	var callsMu sync.Mutex
	atlas := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/model/generateVideo" {
			http.NotFound(w, r)
			return
		}
		callsMu.Lock()
		calls++
		callsMu.Unlock()
		postStarted <- struct{}{}
		<-releasePost
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "single-prediction", "status": "processing"}})
	}))
	defer atlas.Close()

	store := NewStore(t.TempDir(), nil)
	submitter := NewMediaService(store)
	credential, err := submitter.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: atlas.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	image, err := submitter.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := submitter.Generate(GenerateMediaInput{Capability: VideoGenerate, Prompt: "move", ModelID: "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video", CredentialID: credential.ID, ReferenceIDs: []string{image.ID}, IdempotencyKey: "atlas-two-daemons"})
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued Atlas job = %#v, %v", job, err)
	}

	first := NewMediaService(store)
	second := NewMediaService(store)
	if _, err := first.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	if _, err := second.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-postStarted:
	case <-time.After(time.Second):
		t.Fatal("no daemon submitted queued Atlas work")
	}
	time.Sleep(80 * time.Millisecond)
	callsMu.Lock()
	if calls != 1 {
		callsMu.Unlock()
		t.Fatalf("SQLite lease allowed %d concurrent Atlas submissions", calls)
	}
	callsMu.Unlock()
	releaseOnce.Do(func() { close(releasePost) })
	running := waitForMediaJobStatus(t, first, job.ID, "running")
	if running.RemoteID != "single-prediction" || len(running.AssetIDs) != 1 || running.AssetIDs[0] != job.AssetIDs[0] {
		t.Fatalf("single daemon bind = %#v", running)
	}
	waitForMediaTaskLeaseRelease(t, first, job.ID)
}

// 本地 TTS 无凭据直连：显式 modelId（local-audio/cosyvoice2）不带 credentialId
// 也必须被 durable scheduler 选中并执行，voiceId 原样透传给本地执行桥。
func TestLocalSpeechDirectRouteRunsWithoutCredential(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	service := NewMediaService(store)
	executed := false
	service.SetLocalAppExecutor("local-audio", func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error) {
		voiceID := output["voiceId"]
		executed = true
		if voiceID != "preset:neutral-female" {
			t.Fatalf("executor voiceID = %q, want preset:neutral-female", voiceID)
		}
		return service.SaveGeneratedAudio(job, []byte("RIFF...."), "audio/wav", nil)
	})
	job, err := service.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好", ModelID: "local-audio/cosyvoice2", Output: map[string]any{"voiceId": "preset:neutral-female"}, IdempotencyKey: "local-direct-speech"})
	if err != nil || job.Status != "queued" || len(job.AssetIDs) != 1 {
		t.Fatalf("queued local direct speech job = %#v, %v", job, err)
	}
	daemon := NewMediaService(store)
	daemon.SetLocalAppExecutor("local-audio", service.LocalAppExecutor("local-audio"))
	if _, err := daemon.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	completed := waitForMediaJobStatus(t, daemon, job.ID, "completed")
	if !executed || len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != job.AssetIDs[0] {
		t.Fatalf("local direct speech did not complete: %#v executed=%v", completed, executed)
	}
}

// 回归：App 贡献的本地 provider 经 ctx.media.importFile 落库必然产出新 Asset；
// 执行桥必须把它归并回 Job 预建的 pending Asset，否则素材库会同时留下一张永远
// “生成中”的占位卡和一张重复成品卡。
func TestLocalImportMergesIntoPendingAsset(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	service := NewMediaService(store)
	var importedID string
	service.SetLocalAppExecutor("local-audio", func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error) {
		// 模拟 App 的 save：导入一份全新素材（与 pending 不同 id），再交回平台归并。
		imported, err := service.ImportMedia("gen-output.wav", "audio/wav", []byte("RIFF....imported"))
		if err != nil {
			return MediaAsset{}, err
		}
		importedID = imported.ID
		return service.CompleteGenerationFromImport(job, imported.ID)
	})
	job, err := service.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好", ModelID: "local-audio/cosyvoice2", Output: map[string]any{"voiceId": "preset:neutral-female"}, IdempotencyKey: "local-import-merge"})
	if err != nil || len(job.AssetIDs) != 1 {
		t.Fatalf("queued local job = %#v, %v", job, err)
	}
	pendingID := job.AssetIDs[0]
	daemon := NewMediaService(store)
	daemon.SetLocalAppExecutor("local-audio", service.LocalAppExecutor("local-audio"))
	if _, err := daemon.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	completed := waitForMediaJobStatus(t, daemon, job.ID, "completed")
	if len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != pendingID {
		t.Fatalf("job must complete in place on its pending asset: %#v (pending=%s)", completed.AssetIDs, pendingID)
	}
	asset, err := daemon.GetAsset(pendingID)
	if err != nil || asset.Status != "completed" {
		t.Fatalf("pending asset = %#v, %v", asset, err)
	}
	if importedID == "" {
		t.Fatal("executor must import a distinct asset")
	}
	dup, err := daemon.GetAsset(importedID)
	if err != nil || dup.Status != "deleted" {
		t.Fatalf("imported duplicate must be retired: %#v, %v", dup, err)
	}
}

// 回归：ctx.media.completeAsset 契约（平台侧 CompletePendingAssetFromBytes）把字节原地补全到
// Job 预建的 pending Asset，保持同一 assetId、不新建行；并拒绝补全已完成的素材。
func TestCompletePendingAssetFromBytesKeepsIdentity(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	service := NewMediaService(store)
	service.SetLocalAppExecutor("local-audio", func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error) {
		if len(job.AssetIDs) != 1 {
			t.Fatalf("job must carry its pending asset: %#v", job.AssetIDs)
		}
		return service.CompletePendingAssetFromBytes(job.AssetIDs[0], []byte("RIFF....bound"), "audio/wav")
	})
	job, err := service.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "你好", ModelID: "local-audio/cosyvoice2", Output: map[string]any{"voiceId": "preset:neutral-female"}, IdempotencyKey: "local-complete-asset"})
	if err != nil || len(job.AssetIDs) != 1 {
		t.Fatalf("queued local job = %#v, %v", job, err)
	}
	pendingID := job.AssetIDs[0]
	daemon := NewMediaService(store)
	daemon.SetLocalAppExecutor("local-audio", service.LocalAppExecutor("local-audio"))
	if _, err := daemon.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	completed := waitForMediaJobStatus(t, daemon, job.ID, "completed")
	if len(completed.AssetIDs) != 1 || completed.AssetIDs[0] != pendingID {
		t.Fatalf("completeAsset must keep the pending asset id: %#v (pending=%s)", completed.AssetIDs, pendingID)
	}
	if asset, err := daemon.GetAsset(pendingID); err != nil || asset.Status != "completed" {
		t.Fatalf("pending asset = %#v, %v", asset, err)
	}
	if _, err := daemon.CompletePendingAssetFromBytes(pendingID, []byte("again"), "audio/wav"); err == nil {
		t.Fatal("completing a finished asset must be rejected")
	}
}

// 回归：一次请求闸门只串行化「同一凭据」的云端调用，不能把无凭据的本地 provider 也折叠进同一个
// 空 credential_id 槽位——否则一张本机任务会把另一个 App 的任务挡在槽外直到它跑完（曾表现为
// Modal 侧毫无记录：平台任务根本没被派发到 App）。两个不同本地 provider 的任务必须能同时推进。
func TestLocalProvidersDoNotShareOneRequestSlot(t *testing.T) {
	defer media.RegisterAppProviders(nil)
	media.RegisterAppProviders([]MediaProvider{
		{ID: "local-one", Protocol: "local", Name: "Local One", Models: []MediaModel{{ID: "local-one/model", Provider: "local-one", APIModelID: "model", Capability: SpeechGenerate, Available: true}}},
		{ID: "local-two", Protocol: "local", Name: "Local Two", Models: []MediaModel{{ID: "local-two/model", Provider: "local-two", APIModelID: "model", Capability: SpeechGenerate, Available: true}}},
	})

	store := NewStore(t.TempDir(), nil)
	service := NewMediaService(store)
	// 两个执行器必须「同时」在跑到才算通过：用 barrier 把两者都卡住，只有都进入闸门后才放行。
	// 这样断言不依赖 goroutine 调度顺序——若二者共用同一个槽位，任何时刻只有一个能进入，barrier
	// 永远合不上，测试在超时处失败。
	bothRunning := make(chan struct{})
	var entered atomic.Int32
	barrier := func() {
		if entered.Add(1) == 2 {
			close(bothRunning)
		}
		<-bothRunning
	}
	service.SetLocalAppExecutor("local-one", func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error) {
		barrier()
		return service.SaveGeneratedAudio(job, []byte("RIFF....one"), "audio/wav", nil)
	})
	service.SetLocalAppExecutor("local-two", func(job MediaJob, model MediaModel, output map[string]any) (MediaAsset, error) {
		barrier()
		return service.SaveGeneratedAudio(job, []byte("RIFF....two"), "audio/wav", nil)
	})

	first, err := service.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "一", ModelID: "local-one/model", IdempotencyKey: "local-slot-one"})
	if err != nil || len(first.AssetIDs) != 1 {
		t.Fatalf("queued local-one job = %#v, %v", first, err)
	}
	second, err := service.Generate(GenerateMediaInput{Capability: SpeechGenerate, Prompt: "二", ModelID: "local-two/model", IdempotencyKey: "local-slot-two"})
	if err != nil || len(second.AssetIDs) != 1 {
		t.Fatalf("queued local-two job = %#v, %v", second, err)
	}

	daemon := NewMediaService(store)
	daemon.SetLocalAppExecutor("local-one", service.LocalAppExecutor("local-one"))
	daemon.SetLocalAppExecutor("local-two", service.LocalAppExecutor("local-two"))
	if _, err := daemon.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-bothRunning:
	case <-time.After(3 * time.Second):
		t.Fatal("两个本地 provider 无法同时执行，说明它们共用了同一个全局一次请求槽位")
	}
	waitForMediaJobStatus(t, daemon, first.ID, "completed")
	waitForMediaJobStatus(t, daemon, second.ID, "completed")
}

func waitForMediaTaskLeaseRelease(t *testing.T, media *MediaService, jobID string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		db, err := media.Database()
		if err == nil {
			var count int
			err = db.QueryRow("select count(*) from media_task_leases where job_id = ?", jobID).Scan(&count)
			_ = db.Close()
			if err == nil && count == 0 {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("media task lease for %s was not released", jobID)
}
