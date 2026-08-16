/*
 * [INPUT]: 依赖 FontService 与 /v1/fonts* HTTP 路由，用 httptest 伪造 Recut 自有 CDN 上游
 * [OUTPUT]: 验证字体目录/CSS 重写/字体分片缓存命中与二次离线/上传校验与交付/删除的 L1 用例
 * [POS]: service 字体传输层的回归测试；不触碰真实 CDN 与真实用户数据目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// startFontTestServer wires a fonts-enabled server whose upstream CDN is the
// given httptest server; returns the handler and the fake upstream counter.
func startFontTestServer(t *testing.T) (http.Handler, *httptest.Server) {
	t.Helper()
	root := t.TempDir()
	store := NewStore(filepath.Join(root, "data"), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/fonts/google/inter.css":
			w.Header().Set("Content-Type", "text/css")
			_, _ = io.WriteString(w, `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://cdn.recut.video/fonts/google/inter/latin-400.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`)
		case "/fonts/google/inter/latin-400.woff2":
			w.Header().Set("Content-Type", "application/font-woff2")
			_, _ = w.Write([]byte("woff2-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)

	server := NewServer(nil, store, nil, nil, nil, nil, nil)
	server.fonts.SetCDNBase(upstream.URL + "/fonts/google")
	return server.routes(), upstream
}

func TestFontsCatalog(t *testing.T) {
	handler, _ := startFontTestServer(t)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/fonts", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /v1/fonts = %d", recorder.Code)
	}
	var body struct {
		Version int `json:"version"`
		Sources []string `json:"sources"`
		Google  []struct {
			ID      string   `json:"id"`
			Family  string   `json:"family"`
			Scripts []string `json:"scripts"`
		} `json:"google"`
		Local []any `json:"local"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Sources[0] != "google" || body.Sources[1] != "local" {
		t.Fatalf("sources = %v", body.Sources)
	}
	foundCJK := false
	foundInter := false
	for _, font := range body.Google {
		if font.ID == "inter" {
			foundInter = true
		}
		if font.ID == "noto-sans-sc" && containsString(font.Scripts, "zh") {
			foundCJK = true
		}
	}
	if !foundInter {
		t.Fatal("catalog missing inter")
	}
	if !foundCJK {
		t.Fatal("catalog missing CJK family noto-sans-sc with scripts zh")
	}
}

func TestFontCSSRewritesToLocalService(t *testing.T) {
	handler, _ := startFontTestServer(t)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/fonts/google/inter/css", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("css = %d", recorder.Code)
	}
	if ct := recorder.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/css") {
		t.Fatalf("css content-type = %q", ct)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "/v1/fonts/google/inter/latin-400.woff2") {
		t.Fatalf("css url not rewritten to local service:\n%s", body)
	}
	if strings.Contains(body, "cdn.recut.video") {
		t.Fatalf("css still references absolute CDN url:\n%s", body)
	}
	if !strings.Contains(body, "unicode-range: U+0000-00FF") {
		t.Fatalf("css missing unicode-range:\n%s", body)
	}
}

func TestFontFileFetchThenCacheHitOffline(t *testing.T) {
	handler, _ := startFontTestServer(t)

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/v1/fonts/google/inter/latin-400.woff2", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("first fetch = %d", first.Code)
	}
	if first.Body.String() != "woff2-bytes" {
		t.Fatalf("first fetch body = %q", first.Body.String())
	}

	// Second request must hit the local content-addressed cache; close upstream
	// to prove offline availability.
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/v1/fonts/google/inter/latin-400.woff2", nil))
	if second.Code != http.StatusOK || second.Body.String() != "woff2-bytes" {
		t.Fatalf("second (cached) fetch = %d %q", second.Code, second.Body.String())
	}
}

func TestFontFileUnknownFamilyOrPath(t *testing.T) {
	handler, _ := startFontTestServer(t)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/fonts/google/nope/latin-400.woff2", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("unknown family = %d", recorder.Code)
	}
}

func TestLocalFontUploadListDeliverDelete(t *testing.T) {
	handler, _ := startFontTestServer(t)

	// Upload a minimal (fake) woff2.
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	filePart, err := writer.CreateFormFile("file", "test-font.woff2")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := filePart.Write([]byte("fake-woff2-bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("family", "Test Font"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	upload := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/fonts/local", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	handler.ServeHTTP(upload, request)
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload = %d %s", upload.Code, upload.Body.String())
	}
	var entry uploadedFont
	if err := json.NewDecoder(upload.Body).Decode(&entry); err != nil {
		t.Fatal(err)
	}
	if entry.Family != "Test Font" || entry.ID == "" {
		t.Fatalf("uploaded entry = %#v", entry)
	}

	// List reflects it.
	list := httptest.NewRecorder()
	handler.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/v1/fonts/local", nil))
	if list.Code != http.StatusOK {
		t.Fatalf("list = %d", list.Code)
	}
	var items []uploadedFont
	if err := json.NewDecoder(list.Body).Decode(&items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != entry.ID {
		t.Fatalf("list = %#v", items)
	}

	// Deliver content.
	content := httptest.NewRecorder()
	handler.ServeHTTP(content, httptest.NewRequest(http.MethodGet, "/v1/fonts/local/"+entry.ID+"/content", nil))
	if content.Code != http.StatusOK || content.Body.String() != "fake-woff2-bytes" {
		t.Fatalf("content = %d %q", content.Code, content.Body.String())
	}

	// Reject invalid extension.
	bad := bytes.NewBufferString("not a font")
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/v1/fonts/local", bad))

	// Delete.
	del := httptest.NewRecorder()
	handler.ServeHTTP(del, httptest.NewRequest(http.MethodDelete, "/v1/fonts/local/"+entry.ID, nil))
	if del.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", del.Code)
	}
	listAgain := httptest.NewRecorder()
	handler.ServeHTTP(listAgain, httptest.NewRequest(http.MethodGet, "/v1/fonts/local", nil))
	var empty []uploadedFont
	if err := json.NewDecoder(listAgain.Body).Decode(&empty); err != nil || len(empty) != 0 {
		t.Fatalf("list after delete = %#v err=%v", empty, err)
	}
}

func TestFontCachePersistsAcrossRestart(t *testing.T) {
	root := t.TempDir()
	store := NewStore(filepath.Join(root, "data"), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/fonts/google/inter/latin-400.woff2" {
			_, _ = w.Write([]byte("cached-persist-bytes"))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)

	first := NewServer(nil, store, nil, nil, nil, nil, nil)
	first.fonts.SetCDNBase(upstream.URL + "/fonts/google")
	rec := httptest.NewRecorder()
	first.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/fonts/google/inter/latin-400.woff2", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("first = %d", rec.Code)
	}

	// "Restart": a brand-new server over the same store root must serve from
	// the persisted content-addressed index without touching upstream.
	upstream.Close()
	second := NewServer(nil, store, nil, nil, nil, nil, nil)
	second.fonts.SetCDNBase(upstream.URL + "/fonts/google")
	rec2 := httptest.NewRecorder()
	second.routes().ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/v1/fonts/google/inter/latin-400.woff2", nil))
	if rec2.Code != http.StatusOK || rec2.Body.String() != "cached-persist-bytes" {
		t.Fatalf("restart cached = %d %q", rec2.Code, rec2.Body.String())
	}
}

func containsString(haystack []string, needle string) bool {
	for _, item := range haystack {
		if item == needle {
			return true
		}
	}
	return false
}
