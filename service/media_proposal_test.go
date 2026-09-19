/*
 * [INPUT]: 依赖 MediaService、Store 与临时工作区
 * [OUTPUT]: 验证生成提案门禁（video/requiresProposal 默认 propose）、Propose 落 proposed 资产且不建 job、
 *   ConfirmProposal 复用同一 assetId 转 queued、UpdateProposal 仅对 proposed 生效、RejectProposal 软删与 role↔kind 自检
 * [POS]: service 的媒体提案回归测试；不调用真实模型提供商
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"strings"
	"testing"
)

const (
	testVideoModelID = "skymind-token/seedance-2.0"
	testImageModelID = "skymind-token/gpt-image-2"
)

func newProposalTestService(t *testing.T) (*MediaService, MediaCredential, MediaAsset) {
	t.Helper()
	media := NewMediaService(NewStore(t.TempDir(), nil))
	credential, err := media.SaveCredential(MediaCredential{Provider: "skymind-token", Name: "Skymind", APIBase: "http://127.0.0.1:1"}, "skymind-key")
	if err != nil {
		t.Fatal(err)
	}
	reference, err := media.ImportImage("anchor.png", "image/png", []byte("fake-png-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	return media, credential, reference
}

func TestGenerationProposalGateDefaults(t *testing.T) {
	media, credential, _ := newProposalTestService(t)
	video := GenerateMediaInput{Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID}
	if propose, err := media.ShouldPropose(video, ""); err != nil || !propose {
		t.Fatalf("video default must propose, got %v, %v", propose, err)
	}
	if propose, err := media.ShouldPropose(video, "generate"); err != nil || propose {
		t.Fatalf("explicit mode=generate must bypass the gate, got %v, %v", propose, err)
	}
	image := GenerateMediaInput{Capability: ImageGenerate, ModelID: testImageModelID, CredentialID: credential.ID}
	if propose, err := media.ShouldPropose(image, ""); err != nil || propose {
		t.Fatalf("image default must generate, got %v, %v", propose, err)
	}
	if propose, err := media.ShouldPropose(image, "propose"); err != nil || !propose {
		t.Fatalf("explicit mode=propose must gate image too, got %v, %v", propose, err)
	}
}

// TestVideoProposalGatePreference 验证用户偏好能关闭视频确认门禁：
// 关闭后 video.generate 直接提交生成，图片/显式 mode 不受影响。
func TestVideoProposalGatePreference(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	credential, err := media.SaveCredential(MediaCredential{Provider: "skymind-token", Name: "Skymind", APIBase: "http://127.0.0.1:1"}, "skymind-key")
	if err != nil {
		t.Fatal(err)
	}
	video := GenerateMediaInput{Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID}
	if propose, err := media.ShouldPropose(video, ""); err != nil || !propose {
		t.Fatalf("default gate must propose, got %v, %v", propose, err)
	}
	if err := store.SaveVideoProposalGate(false); err != nil {
		t.Fatal(err)
	}
	if propose, err := media.ShouldPropose(video, ""); err != nil || propose {
		t.Fatalf("gate off must generate directly, got %v, %v", propose, err)
	}
	if propose, err := media.ShouldPropose(video, "propose"); err != nil || !propose {
		t.Fatalf("explicit mode=propose must still gate, got %v, %v", propose, err)
	}
	if err := store.SaveVideoProposalGate(true); err != nil {
		t.Fatal(err)
	}
	if propose, err := media.ShouldPropose(video, ""); err != nil || !propose {
		t.Fatalf("gate on must propose, got %v, %v", propose, err)
	}
}

func TestProposeLandsProposedAssetWithoutJob(t *testing.T) {
	media, credential, reference := newProposalTestService(t)
	asset, err := media.Propose(ProposeInput{
		Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID,
		Prompt: "第 3 镜，雨夜电台门口", AspectRatio: "9:16", DurationSec: 5, Note: "承接上一场",
		ReferencesMeta: []ProposalReference{{ID: reference.ID, Kind: "image", Role: "character", Label: "林小满"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if asset.Status != AssetStatusProposed || asset.Origin != "proposed" || asset.JobID != "" {
		t.Fatalf("proposed asset = %#v", asset)
	}
	if asset.Kind != "video" {
		t.Fatalf("proposed video kind = %q", asset.Kind)
	}
	loaded, proposal, err := media.ProposalOf(asset.ID)
	if err != nil || loaded.Status != AssetStatusProposed {
		t.Fatalf("ProposalOf = %#v, %v", loaded, err)
	}
	if len(proposal.References) != 1 || proposal.References[0].Role != "character" || proposal.References[0].ID != reference.ID {
		t.Fatalf("proposal references = %#v", proposal.References)
	}
	if proposal.AspectRatio != "9:16" || proposal.DurationSec != 5 || proposal.ProposedBy != "agent" {
		t.Fatalf("proposal spec = %#v", proposal)
	}
	page, err := media.ListProposals("", MediaAssetFilter{})
	if err != nil || page.Total != 1 || page.Items[0].ID != asset.ID {
		t.Fatalf("listed proposals = %#v, %v", page, err)
	}
}

func TestConfirmProposalReusesAssetID(t *testing.T) {
	media, credential, _ := newProposalTestService(t)
	asset, err := media.Propose(ProposeInput{Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID, Prompt: "镜头 A"})
	if err != nil {
		t.Fatal(err)
	}
	job, err := media.ConfirmProposal(asset.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(job.AssetIDs) != 1 || job.AssetIDs[0] != asset.ID {
		t.Fatalf("confirm allocated a new asset: job=%#v proposal=%s", job.AssetIDs, asset.ID)
	}
	confirmed, err := media.GetAsset(asset.ID)
	if err != nil || confirmed.Status != "queued" || confirmed.JobID != job.ID {
		t.Fatalf("confirmed asset = %#v, %v", confirmed, err)
	}
	if _, err := media.ConfirmProposal(asset.ID, nil); err == nil {
		t.Fatal("confirming an already-queued asset must fail")
	}
}

func TestUpdateProposalOnlyForProposed(t *testing.T) {
	media, credential, _ := newProposalTestService(t)
	asset, err := media.Propose(ProposeInput{Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID, Prompt: "旧提示词"})
	if err != nil {
		t.Fatal(err)
	}
	updated := "新提示词，加一个雨夜转场"
	patched, err := media.UpdateProposal(asset.ID, ProposalPatch{Prompt: &updated})
	if err != nil {
		t.Fatal(err)
	}
	if prompt, _ := patched.Metadata["prompt"].(string); prompt != updated {
		t.Fatalf("updated prompt = %q", prompt)
	}
	if _, err := media.ConfirmProposal(asset.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := media.UpdateProposal(asset.ID, ProposalPatch{Prompt: &updated}); err == nil {
		t.Fatal("editing a confirmed proposal must fail")
	}
}

func TestProposalRejectsRoleKindMismatch(t *testing.T) {
	media, credential, reference := newProposalTestService(t)
	_, err := media.Propose(ProposeInput{
		Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID, Prompt: "错配",
		ReferencesMeta: []ProposalReference{{ID: reference.ID, Kind: "image", Role: "voice"}},
	})
	if err == nil || !strings.Contains(err.Error(), "role") {
		t.Fatalf("role↔kind mismatch must fail closed, got %v", err)
	}
	if _, err := media.Propose(ProposeInput{
		Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID, Prompt: "未知 role",
		ReferencesMeta: []ProposalReference{{ID: reference.ID, Kind: "image", Role: "not-a-role"}},
	}); err == nil {
		t.Fatal("unknown role must fail closed")
	}
}

func TestRejectProposalSoftDeletes(t *testing.T) {
	media, credential, _ := newProposalTestService(t)
	asset, err := media.Propose(ProposeInput{Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID, Prompt: "放弃"})
	if err != nil {
		t.Fatal(err)
	}
	if err := media.RejectProposal(asset.ID); err != nil {
		t.Fatal(err)
	}
	rejected, err := media.GetAsset(asset.ID)
	if err != nil || rejected.Status != "deleted" {
		t.Fatalf("rejected asset = %#v, %v", rejected, err)
	}
	page, err := media.ListProposals("", MediaAssetFilter{})
	if err != nil || page.Total != 0 {
		t.Fatalf("rejected proposal still listed: %#v, %v", page, err)
	}
}

// TestGenerateInputCarriesAspectRatio guards the direct-generate path: the
// top-level aspectRatio must survive MCP mapping so applyAspectRatio can fold
// it into the model output instead of silently using the model default.
func TestGenerateInputCarriesAspectRatio(t *testing.T) {
	input := mediaGenerationInput(map[string]any{
		"text":        "9:16 竖屏关键帧",
		"aspectRatio": "9:16",
		"output":      map[string]any{"resolution": "480p"},
	}, VideoGenerate)
	if input.AspectRatio != "9:16" {
		t.Fatalf("aspectRatio dropped during MCP mapping: %#v", input)
	}
}

func TestProposalMCPToolSurface(t *testing.T) {
	tools := map[string]map[string]any{}
	for _, tool := range mediaMCPToolDefinitions(DefaultLocale) {
		tools[tool["name"].(string)] = tool
	}
	// 提案词汇不再暴露给 AI：对 AI 而言所有素材都是「generate → assetId → 落位」，
	// propose/confirm 只是平台内部策略与 UI 动作。
	for _, name := range []string{"recut.media.propose", "recut.media.list_proposals", "recut.media.update_proposal", "recut.media.confirm_proposal", "recut.media.reject_proposal"} {
		if _, ok := tools[name]; ok {
			t.Fatalf("proposal tool %q must not be exposed to the agent surface", name)
		}
		if isMediaMCPTool(name) {
			t.Fatalf("proposal tool %q must not be recognized as an agent media tool", name)
		}
	}
	video := tools["recut.video.generate"]["inputSchema"].(map[string]any)["properties"].(map[string]any)
	if _, ok := video["mode"]; ok {
		t.Fatal("generation tools must not expose mode; propose/generate is a platform policy, not an agent choice")
	}
	if _, ok := video["references"]; !ok {
		t.Fatal("generation tools must accept role-bound references")
	}
}
