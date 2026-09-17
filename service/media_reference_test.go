/*
 * [INPUT]: 依赖 MediaService、Store 与临时工作区
 * [OUTPUT]: 验证参考证据与 content-first 计划层：asset.create 落无字节 proposed、reference.create 只接受真实媒体、
 *   reference.attach 幂等合并、观察只装指针、MCP 理解工具面已注册
 * [POS]: service 的参考/计划回归测试；不调用 ffmpeg/Python、不触发任何生成
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"strings"
	"testing"

	"recut-service/media/understand"
)

func newUnderstandTestService(t *testing.T) (*MediaService, MediaAsset) {
	t.Helper()
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	service := NewMediaService(store)
	asset, err := service.ImportMedia("reference.mp4", "video/mp4", []byte("understand-test-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	return service, asset
}

func TestCreateReferenceMarksRealMediaOnly(t *testing.T) {
	service, asset := newUnderstandTestService(t)
	marked, err := service.CreateReference(asset.ID, "https://example.com/source")
	if err != nil {
		t.Fatalf("create reference: %v", err)
	}
	if marked.Kind != "video" {
		t.Fatalf("reference must keep its byte kind, got %q", marked.Kind)
	}
	evidence := ReadReferenceEvidence(marked)
	if evidence.Source == nil || evidence.Source.AssetID != asset.ID {
		t.Fatalf("source pointer missing: %+v", evidence.Source)
	}
	if evidence.Provenance == nil || evidence.Provenance.SourceURL != "https://example.com/source" {
		t.Fatalf("sourceUrl must be recorded as provenance only: %+v", evidence.Provenance)
	}
	if _, err := service.CreateReference("missing", ""); err == nil {
		t.Fatal("expected missing asset error")
	}
}

func TestAttachReferenceEvidenceIsIdempotent(t *testing.T) {
	service, asset := newUnderstandTestService(t)
	score := 22.5
	payload := ReferenceAttachInput{
		AssetID: asset.ID,
		Source:  &ReferenceSource{AssetID: asset.ID, DurationSec: 30, Width: 1080, Height: 1920, FPS: 30, HasAudio: true},
		Frames: []ReferenceFrame{
			{AtSec: 1, AssetID: "frame-a"},
			{AtSec: 2, AssetID: "frame-b"},
		},
		Sheets:     []ReferenceSheet{{Range: [2]float64{0, 10}, AssetID: "sheet-a"}},
		Boundaries: []understand.Boundary{{AtSec: 4.2, Kind: "hard-cut", Score: &score}},
		Clips:      []ReferenceClip{{StartSec: 0, EndSec: 4, AssetID: "clip-a", Label: "hook"}},
	}
	if _, err := service.AttachReferenceEvidence(payload); err != nil {
		t.Fatalf("attach: %v", err)
	}
	second, err := service.AttachReferenceEvidence(payload)
	if err != nil {
		t.Fatalf("re-attach: %v", err)
	}
	evidence := ReadReferenceEvidence(second)
	if len(evidence.Frames) != 2 {
		t.Fatalf("frames must dedupe by assetId, got %d", len(evidence.Frames))
	}
	if len(evidence.Sheets) != 1 || len(evidence.Boundaries) != 1 || len(evidence.Clips) != 1 {
		t.Fatalf("evidence must stay idempotent: %+v", evidence)
	}
	if evidence.Source == nil || evidence.Source.DurationSec != 30 || !evidence.Source.HasAudio {
		t.Fatalf("source observations must merge: %+v", evidence.Source)
	}
	if evidence.UnderstoodAt == "" || evidence.ToolVersion == "" {
		t.Fatalf("understoodAt/toolVersion must be stamped: %+v", evidence)
	}
}

func TestCreatePlaceholderAssetIsByteLessProposal(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	service := NewMediaService(store)
	asset, err := service.CreatePlaceholderAsset(PlaceholderAssetInput{
		Name:    "换主体的开场镜头",
		Kind:    "video",
		Content: "一个 3 秒开场：主体在黄昏天台转身。@ 证据 <media frame-a>",
		Attributes: []MaterialAttr{
			{Key: "role", Label: "角色", Type: "select", Value: "b-roll", Options: []string{"a-roll", "b-roll"}},
		},
	})
	if err != nil {
		t.Fatalf("create placeholder: %v", err)
	}
	if asset.Status != AssetStatusProposed {
		t.Fatalf("placeholder must be proposed, got %q", asset.Status)
	}
	if asset.SizeBytes != 0 || asset.ContentHash != "" {
		t.Fatalf("placeholder must have no bytes: size=%d hash=%q", asset.SizeBytes, asset.ContentHash)
	}
	content, _ := asset.Metadata[MetadataKeyContent].(string)
	if !strings.Contains(content, "黄昏天台") {
		t.Fatalf("content spec missing: %q", content)
	}
	attrs, err := MaterialAttrsFromMetadata(asset.Metadata)
	if err != nil || len(attrs) != 1 {
		t.Fatalf("attributes must persist: %v %+v", err, attrs)
	}
	if _, err := service.CreatePlaceholderAsset(PlaceholderAssetInput{Name: "bad", Kind: "pdf"}); err == nil {
		t.Fatal("expected unsupported kind error")
	}
	if _, err := service.CreatePlaceholderAsset(PlaceholderAssetInput{Kind: "video"}); err == nil {
		t.Fatal("expected missing name error")
	}
}

func TestUnderstandMCPToolsAreRegistered(t *testing.T) {
	for _, name := range []string{
		"recut.media.probe", "recut.media.frames", "recut.media.contactSheet",
		"recut.media.boundaries", "recut.media.clip", "recut.media.words", "recut.media.measure",
		"recut.media.reference.create", "recut.media.reference.attach",
		"recut.media.asset.create", "recut.media.import_media",
		"recut.media.understand.status", "recut.media.understand.prepare",
	} {
		if !isMediaMCPTool(name) {
			t.Fatalf("MCP tool %q is not registered", name)
		}
	}
}
