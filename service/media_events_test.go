/*
 * [INPUT]: 依赖 MediaService、Server 路由与内存 SSE ResponseWriter
 * [OUTPUT]: 验证 Asset 事件账本的 snapshot、生成计时元数据 update、cursor replay、Last-Event-ID 和错误游标契约
 * [POS]: service 的媒体 SSE 回归测试；确保前端只订阅本地 Asset 真相而不轮询 Provider
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMediaAssetEventsStreamSnapshotAndReplay(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	first, err := media.ImportImage("first.png", "image/png", []byte("first"))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(nil, store, nil, nil, nil, nil, media).routes()
	initial, stopInitial := startMediaSSE(t, handler, httptest.NewRequest(http.MethodGet, "/v1/media/events", nil))
	defer stopInitial()
	snapshot := readMediaSSE(t, initial)
	if contentType := initial.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("SSE Content-Type = %q", contentType)
	}
	if initial.Header().Get("X-Accel-Buffering") != "no" {
		t.Fatalf("SSE buffering header = %q", initial.Header().Get("X-Accel-Buffering"))
	}
	if snapshot.Event != "media.snapshot" || snapshot.ID != "" {
		t.Fatalf("initial SSE message = %#v", snapshot)
	}
	var state mediaAssetSnapshot
	if err := json.Unmarshal(snapshot.Data, &state); err != nil {
		t.Fatal(err)
	}
	if state.Cursor < 1 || len(state.Assets) != 1 || state.Assets[0].ID != first.ID {
		t.Fatalf("SSE snapshot = %#v", state)
	}

	second, err := media.ImportImage("second.png", "image/png", []byte("second"))
	if err != nil {
		t.Fatal(err)
	}
	update := readMediaSSE(t, initial)
	if update.Event != "asset.updated" || update.ID == "" {
		t.Fatalf("SSE asset update = %#v", update)
	}
	var changed mediaAssetUpdate
	if err := json.Unmarshal(update.Data, &changed); err != nil {
		t.Fatal(err)
	}
	if changed.Asset.ID != second.ID || changed.ID != mustParseMediaEventID(t, update.ID) {
		t.Fatalf("SSE changed Asset = %#v", changed)
	}
	if changed.Asset.Metadata["path"] == "" {
		t.Fatalf("SSE update did not contain the current Asset: %#v", changed.Asset)
	}

	third, err := media.ImportImage("third.png", "image/png", []byte("third"))
	if err != nil {
		t.Fatal(err)
	}
	replayRequest := httptest.NewRequest(http.MethodGet, "/v1/media/events?after="+update.ID, nil)
	replay, stopReplay := startMediaSSE(t, handler, replayRequest)
	defer stopReplay()
	replayed := readMediaSSE(t, replay)
	if replayed.Event != "asset.updated" || replayed.ID == "" {
		t.Fatalf("Last-Event-ID replay = %#v", replayed)
	}
	var replayedChange mediaAssetUpdate
	if err := json.Unmarshal(replayed.Data, &replayedChange); err != nil {
		t.Fatal(err)
	}
	if replayedChange.Asset.ID != third.ID {
		t.Fatalf("after cursor did not replay the missing Asset: %#v", replayedChange)
	}

	fourth, err := media.ImportImage("fourth.png", "image/png", []byte("fourth"))
	if err != nil {
		t.Fatal(err)
	}
	lastEventRequest := httptest.NewRequest(http.MethodGet, "/v1/media/events", nil)
	lastEventRequest.Header.Set("Last-Event-ID", replayed.ID)
	lastEvent, stopLastEvent := startMediaSSE(t, handler, lastEventRequest)
	defer stopLastEvent()
	lastEventUpdate := readMediaSSE(t, lastEvent)
	var lastEventChange mediaAssetUpdate
	if err := json.Unmarshal(lastEventUpdate.Data, &lastEventChange); err != nil {
		t.Fatal(err)
	}
	if lastEventUpdate.Event != "asset.updated" || lastEventChange.Asset.ID != fourth.ID {
		t.Fatalf("Last-Event-ID did not replay the missing Asset: %#v", lastEventChange)
	}

	invalid := httptest.NewRecorder()
	handler.ServeHTTP(invalid, httptest.NewRequest(http.MethodGet, "/v1/media/events?after=not-a-cursor", nil))
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid SSE cursor status = %d body=%s", invalid.Code, invalid.Body.String())
	}
}

func TestCompletedMediaContentIsImmutable(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	asset, err := media.ImportMedia("preview.mp4", "video/mp4", []byte("video bytes"))
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	NewServer(nil, store, nil, nil, nil, nil, media).routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/media/assets/"+asset.ID+"/content", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("content status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != completedMediaCacheControl {
		t.Fatalf("Cache-Control = %q", cacheControl)
	}
}

func TestDeletedMediaAssetKeepsTombstoneAndRejectsContent(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	asset, err := media.ImportMedia("deleted.mp4", "video/mp4", []byte("video bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if err := media.DeleteAsset(asset.ID); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(nil, store, nil, nil, nil, nil, media).routes()
	metadata := httptest.NewRecorder()
	handler.ServeHTTP(metadata, httptest.NewRequest(http.MethodGet, "/v1/media/assets/"+asset.ID, nil))
	if metadata.Code != http.StatusOK || !strings.Contains(metadata.Body.String(), `"status":"deleted"`) {
		t.Fatalf("deleted metadata = %d %s", metadata.Code, metadata.Body.String())
	}
	content := httptest.NewRecorder()
	handler.ServeHTTP(content, httptest.NewRequest(http.MethodGet, "/v1/media/assets/"+asset.ID+"/content", nil))
	if content.Code != http.StatusGone || !strings.Contains(content.Body.String(), `"code":"asset_deleted"`) {
		t.Fatalf("deleted content = %d %s", content.Code, content.Body.String())
	}
}

func TestMediaAssetEventsCarryGenerationTiming(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	media := NewMediaService(store)
	atlas := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/model/generateVideo" {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "test failure", http.StatusServiceUnavailable)
	}))
	defer atlas.Close()
	credential, err := media.SaveCredential(MediaCredential{Provider: "atlas-cloud", Name: "Atlas", APIBase: atlas.URL}, "atlas-key")
	if err != nil {
		t.Fatal(err)
	}
	reference, err := media.ImportImage("reference.png", "image/png", []byte("reference"))
	if err != nil {
		t.Fatal(err)
	}
	job, err := media.Generate(GenerateMediaInput{
		Capability:     VideoGenerate,
		Prompt:         "move",
		ModelID:        "atlas-cloud/bytedance/seedance-2.0-mini-reference-to-video",
		CredentialID:   credential.ID,
		ReferenceIDs:   []string{reference.ID},
		IdempotencyKey: "asset-event-timing",
	})
	if err != nil || len(job.AssetIDs) != 1 {
		t.Fatalf("queued media job = %#v, %v", job, err)
	}

	handler := NewServer(nil, store, nil, nil, nil, nil, media).routes()
	stream, stop := startMediaSSE(t, handler, httptest.NewRequest(http.MethodGet, "/v1/media/events", nil))
	defer stop()
	snapshot := readMediaSSE(t, stream)
	var state mediaAssetSnapshot
	if err := json.Unmarshal(snapshot.Data, &state); err != nil {
		t.Fatal(err)
	}
	asset, found := mediaAssetByID(state.Assets, job.AssetIDs[0])
	if !found || asset.Status != "queued" {
		t.Fatalf("SSE snapshot missing queued Asset: %#v", state)
	}
	started, ok := asset.Metadata["generationStartedAt"].(string)
	if !ok || started == "" {
		t.Fatalf("SSE snapshot missing generation start: %#v", asset.Metadata)
	}

	if _, err := media.ReconcilePendingJobs(); err != nil {
		t.Fatal(err)
	}
	update := readMediaSSE(t, stream)
	var changed mediaAssetUpdate
	if err := json.Unmarshal(update.Data, &changed); err != nil {
		t.Fatal(err)
	}
	if changed.Asset.ID != asset.ID || changed.Asset.Status != "failed" {
		t.Fatalf("SSE timing update = %#v", changed)
	}
	if changed.Asset.Metadata["generationStartedAt"] != started || changed.Asset.Metadata["generationCompletedAt"] == "" {
		t.Fatalf("SSE timing timestamps = %#v", changed.Asset.Metadata)
	}
	if duration, ok := changed.Asset.Metadata["generationDurationMs"].(float64); !ok || duration < 0 {
		t.Fatalf("SSE timing duration = %#v", changed.Asset.Metadata)
	}
}

type mediaSSEMessage struct {
	ID    string
	Event string
	Data  json.RawMessage
}

type mediaSSETestWriter struct {
	header  http.Header
	mu      sync.Mutex
	pending bytes.Buffer
	flushes chan string
}

func newMediaSSETestWriter() *mediaSSETestWriter {
	return &mediaSSETestWriter{header: make(http.Header), flushes: make(chan string, 8)}
}

func (w *mediaSSETestWriter) Header() http.Header { return w.header }

func (w *mediaSSETestWriter) Write(value []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.pending.Write(value)
}

func (w *mediaSSETestWriter) WriteHeader(int) {}

func (w *mediaSSETestWriter) Flush() {
	w.mu.Lock()
	value := w.pending.String()
	w.pending.Reset()
	w.mu.Unlock()
	if value == "" {
		return
	}
	w.flushes <- value
}

func startMediaSSE(t *testing.T, handler http.Handler, request *http.Request) (*mediaSSETestWriter, func()) {
	t.Helper()
	streamContext, cancel := context.WithCancel(request.Context())
	writer := newMediaSSETestWriter()
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.ServeHTTP(writer, request.WithContext(streamContext))
	}()
	return writer, func() {
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("media SSE handler did not stop")
		}
	}
}

func readMediaSSE(t *testing.T, writer *mediaSSETestWriter) mediaSSEMessage {
	t.Helper()
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case value := <-writer.flushes:
			message := parseMediaSSE(value)
			if message.Event != "" {
				return message
			}
		case <-deadline.C:
			t.Fatal("timed out waiting for media SSE event")
			return mediaSSEMessage{}
		}
	}
}

func parseMediaSSE(value string) mediaSSEMessage {
	message := mediaSSEMessage{}
	for _, line := range strings.Split(value, "\n") {
		switch {
		case strings.HasPrefix(line, "id: "):
			message.ID = strings.TrimPrefix(line, "id: ")
		case strings.HasPrefix(line, "event: "):
			message.Event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			message.Data = json.RawMessage(strings.TrimPrefix(line, "data: "))
		}
	}
	return message
}

func mustParseMediaEventID(t *testing.T, value string) int64 {
	t.Helper()
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id < 1 {
		t.Fatalf("invalid media SSE event ID %q: %v", value, err)
	}
	return id
}
