/*
 * [INPUT]: 依赖 httptest 模拟的 R2 S3 端点与 Skymind 网关（统一任务状态机）、真实 workspace SQLite
 * [OUTPUT]: 对外提供媒体层的 L1 验证：临时分享的发布/复用/吊销/级联与 S3 签名线协议、
 *          skymind 图片策略全链路、skymind 视频任务（参考图自动发布为公网 URL → 提交 →
 *          checkpoint → 轮询 → /content 回收）与错误映射/分享缺失降级
 * [POS]: service 的媒体层验证；不触碰真实 R2 与真实网关（真实 key E2E 见 skymind_e2e_test.go）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"recut-service/media"
)

// --- fake R2 S3 endpoint -------------------------------------------------

type fakeS3 struct {
	mu      sync.Mutex
	objects map[string][]byte
	heads   map[string]http.Header
	// verifySig recomputes the SigV4 signature from the request to prove the
	// client signs correctly (canonical request per the S3 spec).
	verifySig func(r *http.Request) error
}

func newFakeS3(secret string) *fakeS3 {
	return &fakeS3{objects: map[string][]byte{}, heads: map[string]http.Header{}, verifySig: func(r *http.Request) error {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 Credential=test-key/") {
			return fmt.Errorf("bad authorization prefix: %s", auth)
		}
		if !strings.Contains(auth, "SignedHeaders=host;x-amz-content-sha256;x-amz-date") {
			return fmt.Errorf("bad signed headers: %s", auth)
		}
		payloadHash := sha256.Sum256(nil)
		if r.Method == http.MethodPut {
			data, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(data))
			payloadHash = sha256.Sum256(data)
		}
		canonical := r.Method + "\n" + r.URL.Path + "\n\n" +
			"host:" + r.Host + "\n" +
			"x-amz-content-sha256:" + hex.EncodeToString(payloadHash[:]) + "\n" +
			"x-amz-date:" + r.Header.Get("X-Amz-Date") + "\n" +
			"\n" +
			"host;x-amz-content-sha256;x-amz-date\n" +
			hex.EncodeToString(payloadHash[:])
		scope := r.Header.Get("X-Amz-Date")[:8] + "/auto/s3/aws4_request"
		stringToSign := "AWS4-HMAC-SHA256\n" + r.Header.Get("X-Amz-Date") + "\n" + scope + "\n" + sha256hex(canonical)
		key := []byte("AWS4" + secret)
		for _, part := range strings.Split(scope, "/") {
			key = hmac256(key, []byte(part))
		}
		sig := hex.EncodeToString(hmac256(key, []byte(stringToSign)))
		if !strings.HasSuffix(auth, "Signature="+sig) {
			return fmt.Errorf("signature mismatch: want %s", sig)
		}
		return nil
	}}
}

func (s *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := s.verifySig(r); err != nil {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"Code":"SignatureDoesNotMatch","Message":"` + err.Error() + `"}`))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch r.Method {
	case http.MethodPut:
		data, _ := io.ReadAll(r.Body)
		s.objects[r.URL.Path] = data
		s.heads[r.URL.Path] = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	case http.MethodDelete:
		delete(s.objects, r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	case http.MethodGet:
		if data, ok := s.objects[r.URL.Path]; ok {
			w.Write(data)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func hmac256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

func sha256hex(data string) string {
	sum := sha256.Sum256([]byte(data))
	return hex.EncodeToString(sum[:])
}

func testShareClient(server *httptest.Server) *media.ShareClient {
	// Host must match the request Host exactly (as with real R2), so the
	// fake endpoint can recompute the SigV4 signature from the wire.
	host := strings.TrimPrefix(server.URL, "http://")
	return &media.ShareClient{
		Endpoint:  server.URL,
		Host:      host,
		Bucket:    "recut-assets",
		Prefix:    "share",
		BaseURL:   "https://cdn.recut.video",
		AccessKey: "test-key",
		SecretKey: "test-secret",
		HTTP:      server.Client(),
	}
}

func TestSkymindSharePublishReuseRevokeAndCascade(t *testing.T) {
	fake := newFakeS3("test-secret")
	server := httptest.NewServer(fake)
	defer server.Close()

	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	mediaService := NewMediaService(store)
	mediaService.SetShareClient(testShareClient(server))

	asset, err := mediaService.ImportMedia("fox.png", "image/png", []byte{0x89, 'P', 'N', 'G', 1})
	if err != nil {
		t.Fatal(err)
	}
	share, err := mediaService.SharePublish(asset, 7)
	if err != nil {
		t.Fatalf("SharePublish: %v", err)
	}
	if !strings.HasPrefix(share.URL, "https://cdn.recut.video/share/") || strings.Count(share.URL, "/") < 4 {
		t.Fatalf("unexpected share URL: %s", share.URL)
	}
	objectKey := share.ObjectKey
	if len(fake.objects) != 1 {
		t.Fatalf("expected one uploaded object, got %d: %v", len(fake.objects), fake.objects)
	}
	if _, ok := fake.objects["/recut-assets/"+objectKey]; !ok {
		t.Fatalf("object missing under /recut-assets/%s; uploaded: %v", objectKey, fake.objects)
	}
	headers := fake.heads["/recut-assets/"+objectKey]
	if !strings.HasPrefix(headers.Get("Cache-Control"), "public, max-age=") {
		t.Fatalf("share object must carry a bounded cache policy: %q", headers.Get("Cache-Control"))
	}
	if headers.Get("Content-Type") != "image/png" {
		t.Fatalf("content type not forwarded: %q", headers.Get("Content-Type"))
	}
	if time.Until(share.ExpiresAt) < 6*24*time.Hour {
		t.Fatalf("7-day TTL not applied: %v", share.ExpiresAt)
	}

	// Reuse: same content hash, second asset → same URL, no second upload.
	asset2, err := mediaService.ImportMedia("fox-copy.png", "image/png", []byte{0x89, 'P', 'N', 'G', 1})
	if err != nil {
		t.Fatal(err)
	}
	share2, err := mediaService.SharePublish(asset2, 7)
	if err != nil {
		t.Fatal(err)
	}
	if share2.URL != share.URL || len(fake.objects) != 1 {
		t.Fatalf("share must be reused by content hash: %s vs %s (%d objects)", share2.URL, share.URL, len(fake.objects))
	}

	// Revoke: object deleted, ledger tombstoned.
	if err := mediaService.RevokeShare(share.ID); err != nil {
		t.Fatalf("RevokeShare: %v", err)
	}
	if _, ok := fake.objects["/recut-assets/"+objectKey]; ok {
		t.Fatal("revoked share object must be deleted from R2")
	}
	live, err := mediaService.ListShares(asset.ID)
	if err != nil || len(live) != 0 {
		t.Fatalf("revoked share must not list: %v (%v)", live, err)
	}

	// Cascade: deleting an asset revokes its live share.
	asset3, err := mediaService.ImportMedia("other.png", "image/png", []byte{0x89, 'P', 'N', 'G', 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mediaService.SharePublish(asset3, 7); err != nil {
		t.Fatal(err)
	}
	if err := mediaService.DeleteAsset(asset3.ID); err != nil {
		t.Fatal(err)
	}
	third, err := mediaService.ListShares(asset3.ID)
	if err != nil || len(third) != 0 {
		t.Fatalf("asset delete must cascade-revoke shares: %v (%v)", third, err)
	}
}

func TestSkymindShareUnconfiguredIsActionable(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	mediaService := NewMediaService(store)
	asset, err := mediaService.ImportMedia("fox.png", "image/png", []byte{0x89, 'P', 'N', 'G'})
	if err != nil {
		t.Fatal(err)
	}
	_, err = mediaService.SharePublish(asset, 7)
	if err == nil || !strings.Contains(err.Error(), "R2 凭据缺失") {
		t.Fatalf("expected actionable share-unavailable error, got: %v", err)
	}
}

// --- fake skymind gateway -------------------------------------------------

type fakeSkymind struct {
	mu          sync.Mutex
	videoStatus map[string]string
	submits     []map[string]any
	content     []byte
	imagesResp  []byte
	submitErr   int
	submitBody  string
}

func newFakeSkymind() *fakeSkymind {
	return &fakeSkymind{
		videoStatus: map[string]string{},
		content:     []byte{0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'},
		imagesResp:  []byte{0x89, 'P', 'N', 'G', 9, 9},
	}
}

func (g *fakeSkymind) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer sk-fake" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
		if g.submitErr != 0 {
			w.WriteHeader(g.submitErr)
			_, _ = w.Write([]byte(g.submitBody))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data":  []any{map[string]any{"b64_json": hex.EncodeToString(g.imagesResp)}},
			"usage": map[string]any{"total_tokens": 214},
		})
	case r.Method == http.MethodPost && r.URL.Path == "/openapi/v1/video/generations":
		if g.submitErr != 0 {
			w.WriteHeader(g.submitErr)
			_, _ = w.Write([]byte(g.submitBody))
			return
		}
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		g.mu.Lock()
		g.submits = append(g.submits, payload)
		id := fmt.Sprintf("task_fake_%d", len(g.submits))
		g.videoStatus[id] = "queued"
		g.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "task_id": id, "object": "video", "model": payload["model"], "status": "queued", "created_at": 1753948800})
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/openapi/v1/video/generations/") && !strings.HasSuffix(r.URL.Path, "/content"):
		id := strings.TrimPrefix(r.URL.Path, "/openapi/v1/video/generations/")
		g.mu.Lock()
		status := g.videoStatus[id]
		switch status {
		case "queued":
			g.videoStatus[id] = "running"
		case "running":
			g.videoStatus[id] = "succeeded"
		}
		g.mu.Unlock()
		if status == "succeeded" || g.videoStatus[id] == "succeeded" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": id, "model": "doubao-seedance-2.0", "status": g.videoStatus[id],
				"content": map[string]any{"video_url": "https://tos.example/" + id + ".mp4"},
				"usage":   map[string]any{"total_tokens": 50638}, "seed": 77, "resolution": "480p", "duration": 5, "ratio": "16:9",
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "model": "doubao-seedance-2.0", "status": g.videoStatus[id]})
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/content"):
		w.Header().Set("Content-Type", "video/mp4")
		w.Write(g.content)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func waitForMediaJob(t *testing.T, m *MediaService, jobID string, terminal bool, timeout time.Duration) MediaJob {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		job, err := m.GetJob(jobID)
		if err == nil && terminal && (job.Status == "completed" || job.Status == "failed") {
			return job
		}
		if _, err := m.ReconcilePendingJobs(); err != nil {
			t.Fatalf("ReconcilePendingJobs: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	job, _ := m.GetJob(jobID)
	return job
}

func TestSkymindImageJobThroughStrategy(t *testing.T) {
	gateway := newFakeSkymind()
	server := httptest.NewServer(gateway)
	defer server.Close()

	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	mediaService := NewMediaService(store)
	credential, err := mediaService.SaveCredential(MediaCredential{Provider: "skymind-token", Name: "Fake", APIBase: server.URL}, "sk-fake")
	if err != nil {
		t.Fatal(err)
	}
	job, err := mediaService.Generate(GenerateMediaInput{
		Capability: ImageGenerate, ModelID: "skymind-token/gpt-image-2", CredentialID: credential.ID,
		Prompt: "a fox in snow", IdempotencyKey: "skymind-img-1",
		Output: map[string]any{"size": "1024x1024", "quality": "low"},
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	final := waitForMediaJob(t, mediaService, job.ID, true, 10*time.Second)
	if final.Status != "completed" {
		t.Fatalf("image job not completed: %+v", final)
	}
	if len(final.AssetIDs) != 1 {
		t.Fatalf("no asset: %+v", final)
	}
	asset, err := mediaService.GetAsset(final.AssetIDs[0])
	if err != nil || asset.Kind != "image" || asset.MimeType != "image/png" {
		t.Fatalf("asset mismatch: %+v (%v)", asset, err)
	}
}

func TestSkymindVideoJobPublishesReferencesAndCollects(t *testing.T) {
	s3 := newFakeS3("test-secret")
	s3Server := httptest.NewServer(s3)
	defer s3Server.Close()
	gateway := newFakeSkymind()
	gatewayServer := httptest.NewServer(gateway)
	defer gatewayServer.Close()

	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	mediaService := NewMediaService(store)
	mediaService.SetShareClient(testShareClient(s3Server))
	credential, err := mediaService.SaveCredential(MediaCredential{
		Provider: "skymind-token", Name: "Fake", APIBase: gatewayServer.URL,
		ModelOverrides: map[string]string{"skymind-token/seedance-2.0": "doubao-seedance-2-0-override"},
	}, "sk-fake")
	if err != nil {
		t.Fatal(err)
	}
	reference, err := mediaService.ImportMedia("fox.png", "image/png", []byte{0x89, 'P', 'N', 'G', 42})
	if err != nil {
		t.Fatal(err)
	}
	job, err := mediaService.Generate(GenerateMediaInput{
		Capability: VideoGenerate, ModelID: "skymind-token/seedance-2.0", CredentialID: credential.ID,
		Prompt: "让狐狸转身", ReferenceIDs: []string{reference.ID},
		IdempotencyKey: "skymind-vid-1",
		Output:         map[string]any{"durationSeconds": 5, "aspectRatio": "16:9", "resolution": "480p", "seed": 20250731},
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	final := waitForMediaJob(t, mediaService, job.ID, true, 20*time.Second)
	if final.Status != "completed" {
		t.Fatalf("video job not completed: %+v", final)
	}
	// 1) The submission carried the published public URL and the overridden model ID.
	if len(gateway.submits) != 1 {
		t.Fatalf("expected exactly one upstream submission (no resubmits), got %d", len(gateway.submits))
	}
	submit := gateway.submits[0]
	if submit["model"] != "doubao-seedance-2-0-override" {
		t.Fatalf("model override not applied: %v", submit["model"])
	}
	images, _ := submit["images"].([]any)
	if len(images) != 1 {
		t.Fatalf("reference URL not forwarded: %v", submit)
	}
	refURL, _ := images[0].(string)
	if !strings.HasPrefix(refURL, "https://cdn.recut.video/share/") {
		t.Fatalf("reference must be a published share URL: %s", refURL)
	}
	metadata, _ := submit["metadata"].(map[string]any)
	if metadata["generate_audio"] != true || metadata["seed"] != float64(20250731) {
		t.Fatalf("metadata not forwarded: %v", metadata)
	}
	// 2) The finished video bytes came back and the task metadata is preserved.
	asset, err := mediaService.GetAsset(final.AssetIDs[0])
	if err != nil || asset.Kind != "video" {
		t.Fatalf("video asset mismatch: %+v (%v)", asset, err)
	}
	if asset.Metadata["providerTaskId"] == "" {
		t.Fatalf("provider task id missing from asset metadata: %v", asset.Metadata)
	}
	if asset.Metadata["usage"] == nil || asset.Metadata["seed"] == nil {
		t.Fatalf("usage/seed not preserved: %v", asset.Metadata)
	}
	// 3) Exactly one R2 object was uploaded for the reference.
	if len(s3.objects) != 1 {
		t.Fatalf("expected one shared object, got %d", len(s3.objects))
	}
}

func TestSkymindVideoJobSurfacesGatewayErrors(t *testing.T) {
	gateway := newFakeSkymind()
	gateway.submitErr = http.StatusNotFound
	gateway.submitBody = `{"error":{"code":"model_not_found","message":"No available channel for model doubao-seedance-2.5 under group default (distributor)","type":"new_api_error"}}`
	server := httptest.NewServer(gateway)
	defer server.Close()

	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	mediaService := NewMediaService(store)
	credential, err := mediaService.SaveCredential(MediaCredential{Provider: "skymind-token", Name: "Fake", APIBase: server.URL}, "sk-fake")
	if err != nil {
		t.Fatal(err)
	}
	job, err := mediaService.Generate(GenerateMediaInput{
		Capability: VideoGenerate, ModelID: "skymind-token/seedance-2.5", CredentialID: credential.ID,
		Prompt: "t", IdempotencyKey: "skymind-vid-err",
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	final := waitForMediaJob(t, mediaService, job.ID, true, 10*time.Second)
	if final.Status != "failed" {
		t.Fatalf("expected failed job: %+v", final)
	}
	if !strings.Contains(final.Error, "未开通") {
		t.Fatalf("friendly error mapping missing: %s", final.Error)
	}
}

func TestSkymindVideoJobFailsActionablyWithoutShare(t *testing.T) {
	gateway := newFakeSkymind()
	server := httptest.NewServer(gateway)
	defer server.Close()

	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	mediaService := NewMediaService(store) // no share client configured
	credential, err := mediaService.SaveCredential(MediaCredential{Provider: "skymind-token", Name: "Fake", APIBase: server.URL}, "sk-fake")
	if err != nil {
		t.Fatal(err)
	}
	reference, err := mediaService.ImportMedia("fox.png", "image/png", []byte{0x89, 'P', 'N', 'G'})
	if err != nil {
		t.Fatal(err)
	}
	job, err := mediaService.Generate(GenerateMediaInput{
		Capability: VideoGenerate, ModelID: "skymind-token/seedance-2.0", CredentialID: credential.ID,
		Prompt: "t", ReferenceIDs: []string{reference.ID}, IdempotencyKey: "skymind-vid-noshare",
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	final := waitForMediaJob(t, mediaService, job.ID, true, 10*time.Second)
	if final.Status != "failed" || !strings.Contains(final.Error, "R2 凭据缺失") {
		t.Fatalf("expected actionable share-unavailable failure: %+v", final)
	}
	if len(gateway.submits) != 0 {
		t.Fatalf("no upstream submission must happen before references are public: %d", len(gateway.submits))
	}
}

func TestSkymindCredentialModelOverrideValidation(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	mediaService := NewMediaService(store)
	if _, err := mediaService.SaveCredential(MediaCredential{
		Provider: "skymind-token", Name: "Bad",
		ModelOverrides: map[string]string{"openai/gpt-image-2": "x"},
	}, "sk-fake"); err == nil || !strings.Contains(err.Error(), "belongs to provider") {
		t.Fatalf("cross-provider override must be rejected, got: %v", err)
	}
	credential, err := mediaService.SaveCredential(MediaCredential{
		Provider: "skymind-token", Name: "Good",
		ModelOverrides: map[string]string{"skymind-token/seedance-2.5": "doubao-seedance-2-5-260715"},
	}, "sk-fake")
	if err != nil {
		t.Fatalf("valid override rejected: %v", err)
	}
	listed, err := mediaService.ListCredentials()
	if err != nil || len(listed) != 1 || listed[0].ModelOverrides["skymind-token/seedance-2.5"] != "doubao-seedance-2-5-260715" {
		t.Fatalf("override not persisted: %+v (%v)", listed, err)
	}
	_ = credential
}

var _ = media.MediaShare{}
