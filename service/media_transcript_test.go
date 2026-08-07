/*
 * [INPUT]: 依赖 MediaService、Server 路由与临时工作区
 * [OUTPUT]: 验证 ASR 转写 bundle Asset 的导入、parts 读取、内容/parts HTTP 交付与 App 侧 importTranscript bridge
 * [POS]: service 的 transcript 素材回归测试；不调用真实转写模型
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
)

func TestImportTranscriptBundleServesAudioAndParts(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	audio := []byte("RIFF....WAVEfake-audio")
	srt := "1\n00:00:00,000 --> 00:00:01,000\nhello\n"
	transcriptJSON := `{"model":"whisper-small","language":"en","duration":1,"segments":[{"start":0,"end":1,"text":"hello"}]}`
	asset, err := media.ImportTranscript(TranscriptImport{Name: "transcript-test.wav", SourceAssetID: "source-1", Audio: audio, SRT: []byte(srt), TranscriptJSON: []byte(transcriptJSON), AudioMimeType: "audio/wav", Model: "whisper-small", Language: "en", Duration: 1})
	if err != nil {
		t.Fatal(err)
	}
	if asset.Kind != "transcript" || asset.MimeType != "audio/wav" || asset.ParentID != "source-1" {
		t.Fatalf("transcript asset = %#v", asset)
	}
	bundle, ok := asset.Metadata["transcript"].(map[string]any)
	if !ok {
		t.Fatalf("transcript metadata missing: %#v", asset.Metadata)
	}
	if bundle["parts"] == nil {
		t.Fatalf("transcript parts missing: %#v", bundle)
	}

	srtPart, srtContent, err := media.GetAssetPart(asset.ID, "srt")
	if err != nil || string(srtContent) != srt || srtPart.MimeType != "text/plain" {
		t.Fatalf("GetAssetPart(srt) = %#v %q %v", srtPart, srtContent, err)
	}
	jsonPart, jsonContent, err := media.GetAssetPart(asset.ID, "json")
	if err != nil || string(jsonContent) != transcriptJSON || jsonPart.MimeType != "application/json" {
		t.Fatalf("GetAssetPart(json) = %#v %q %v", jsonPart, jsonContent, err)
	}
	if _, _, err := media.GetAssetPart(asset.ID, "missing"); err == nil {
		t.Fatalf("GetAssetPart(missing) should fail")
	}

	handler := NewServer(nil, store, nil, nil, nil, nil, media).routes()
	content := httptest.NewRecorder()
	handler.ServeHTTP(content, httptest.NewRequest(http.MethodGet, "/v1/media/assets/"+asset.ID+"/content", nil))
	if content.Code != http.StatusOK || content.Body.String() != string(audio) {
		t.Fatalf("content = %d %q", content.Code, content.Body.String())
	}
	srtRequest := httptest.NewRecorder()
	handler.ServeHTTP(srtRequest, httptest.NewRequest(http.MethodGet, "/v1/media/assets/"+asset.ID+"/parts/srt", nil))
	if srtRequest.Code != http.StatusOK || srtRequest.Body.String() != srt {
		t.Fatalf("srt part = %d %q", srtRequest.Code, srtRequest.Body.String())
	}
	jsonRequest := httptest.NewRecorder()
	handler.ServeHTTP(jsonRequest, httptest.NewRequest(http.MethodGet, "/v1/media/assets/"+asset.ID+"/parts/json", nil))
	if jsonRequest.Code != http.StatusOK {
		t.Fatalf("json part = %d", jsonRequest.Code)
	}
	var parsed map[string]any
	if err := json.Unmarshal(jsonRequest.Body.Bytes(), &parsed); err != nil || parsed["model"] != "whisper-small" {
		t.Fatalf("json part payload = %s", jsonRequest.Body.String())
	}
	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/v1/media/assets/"+asset.ID+"/parts/nope", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing part = %d", missing.Code)
	}
}

func TestAppImportTranscriptBridgeCreatesBundle(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "transcribe")
	if err := os.MkdirAll(filepath.Join(appDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.transcribe","name":"Transcribe","author":"Test","description":"Test App.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"},"permissions":["files","media.write"],"operations":[{"name":"transcribe.save","description":"Save a transcript bundle.","surfaces":["api"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "ui", "index.html"), "ok")
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("transcribe.save", function(input, ctx) {
		ctx.files.writeText("out/audio.wav", "wav-bytes");
		ctx.files.writeText("out/sub.srt", "1\n00:00:00,000 --> 00:00:01,000\nhello");
		ctx.files.writeText("out/sub.json", JSON.stringify({model:"whisper-small",language:"en",duration:1,segments:[{start:0,end:1,text:"hello"}]}));
		const asset = ctx.media.importTranscript({name:"transcript-test.wav", sourceAssetId: input.sourceAssetId, audioPath:"out/audio.wav", srtPath:"out/sub.srt", jsonPath:"out/sub.json", mimeType:"audio/wav", model:"whisper-small", language:"en", duration:1});
		return {assetId: asset.id, kind: asset.kind, mimeType: asset.mimeType, status: asset.status};
	});`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	host := NewAppHost(apps, store, media)
	result, err := host.InvokeAPI(Target{AppID: "example.transcribe"}, "example.transcribe", "transcribe.save", map[string]any{"sourceAssetId": "source-1"})
	if err != nil {
		t.Fatal(err)
	}
	output := result.(map[string]any)
	assetID, _ := output["assetId"].(string)
	if assetID == "" || output["kind"] != "transcript" || output["mimeType"] != "audio/wav" || output["status"] != "completed" {
		t.Fatalf("unexpected bridge result: %#v", output)
	}
	asset, err := media.GetAsset(assetID)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Kind != "transcript" || asset.ParentID != "source-1" {
		t.Fatalf("bridge asset = %#v", asset)
	}
	srtPart, srtContent, err := media.GetAssetPart(assetID, "srt")
	if err != nil || !strings.Contains(string(srtContent), "hello") {
		t.Fatalf("bridge srt part = %#v %q %v", srtPart, srtContent, err)
	}
}
