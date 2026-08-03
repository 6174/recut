/*
 * [INPUT]: 依赖 MediaService、共享 SQLite Store 与可控 Atlas/MiniMax HTTP 测试服务
 * [OUTPUT]: 验证提交 checkpoint 不重放、one-request 任务原子激活及按凭据限流、Atlas 单边远端关联自愈和多 Daemon lease 独占提交
 * [POS]: service 的 durable scheduler 回归测试；补足媒体生命周期测试的跨进程安全边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
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
