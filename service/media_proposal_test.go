/*
 * [INPUT]: 依赖 MediaService、Store 与临时工作区
 * [OUTPUT]: 验证生成提案门禁（video/requiresProposal 默认 propose）、Propose 落 proposed 资产且不建 job、
 *   ConfirmProposal 复用同一 assetId 转 queued、UpdateProposal 仅对 proposed 生效、RejectProposal 软删与 role↔kind 自检；
 *   以及正文参考绑定的创建期门禁（Propose/asset.update 报 unbound_prompt_reference）与
 *   asset.update 原地改写提案配方（同 assetId）、配方冻结后 fail closed 为 validation 信封
 * [POS]: service 的媒体提案回归测试；不调用真实模型提供商
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	media "recut-service/media"
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

// TestGenerateInputCarriesFirstClassFields guards the direct-generate path: the
// top-level aspectRatio and durationSec must survive MCP mapping so
// applyAspectRatio/applyDurationSec can fold them into the model output instead
// of silently using the model defaults.
func TestGenerateInputCarriesFirstClassFields(t *testing.T) {
	input := mediaGenerationInput(map[string]any{
		"text":        "9:16 竖屏关键帧",
		"aspectRatio": "9:16",
		"durationSec": float64(15),
		"output":      map[string]any{"resolution": "480p"},
	}, VideoGenerate)
	if input.AspectRatio != "9:16" || input.DurationSec != 15 {
		t.Fatalf("first-class aspectRatio/durationSec dropped during MCP mapping: %#v", input)
	}
}

// The propose→confirm path must carry the first-class aspectRatio/durationSec
// all the way into the job Output, because that map is what the App receives as
// `params` — otherwise the agent-chosen clip length collapses to the App
// default (5s).
func TestConfirmProposalCarriesFirstClassFieldsIntoOutput(t *testing.T) {
	defer media.RegisterAppProviders(nil)
	media.RegisterAppProviders([]media.MediaProvider{{
		ID: "modal-cloud", Protocol: "local",
		Models: []media.MediaModel{{
			ID: "modal-cloud/minimax-h3-turbo", Provider: "modal-cloud", APIModelID: "minimax-h3-turbo",
			Capability: media.VideoGenerate, Available: true, PassthroughParams: true,
			Parameters: []media.MediaParameter{{Name: "aspectRatio", Type: "string"}, {Name: "durationSec", Type: "number"}},
		}},
	}})
	service := NewMediaService(NewStore(t.TempDir(), nil))
	proposed, err := service.Propose(ProposeInput{
		Capability: VideoGenerate, ModelID: "modal-cloud/minimax-h3-turbo",
		Prompt: "段1 15s 竖屏", AspectRatio: "9:16", DurationSec: 15,
	})
	if err != nil {
		t.Fatal(err)
	}
	job, err := service.ConfirmProposal(proposed.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if job.Output["aspectRatio"] != "9:16" || job.Output["durationSec"] != float64(15) {
		t.Fatalf("confirm dropped first-class fields; job.Output = %#v", job.Output)
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

// The prompt-reference binding gate must run at proposal creation, not only at
// confirmation: the agent has to learn about an unbound tag from the very call
// that created the proposal, in terms it can act on.
func TestProposeRejectsUnboundPromptReference(t *testing.T) {
	media, credential, reference := newProposalTestService(t)
	_, err := media.Propose(ProposeInput{
		Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID,
		Prompt: `<reference id="ghost-img" kind="image" role="pov" label="幻觉" /> 推进`,
	})
	var invalid *ValidationError
	if !errors.As(err, &invalid) || invalid.Code != "unbound_prompt_reference" {
		t.Fatalf("err = %v; want unbound_prompt_reference", err)
	}
	ids, _ := invalid.Data["unboundReferenceIds"].([]string)
	if len(ids) != 1 || ids[0] != "ghost-img" {
		t.Fatalf("unbound ids = %#v", invalid.Data)
	}
	// 绑定同一 id 后放行。
	bound := fmt.Sprintf(`<reference id=%q kind="image" role="style-ref" label="参考" /> 推进`, reference.ID)
	if _, err := media.Propose(ProposeInput{
		Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID, Prompt: bound,
		ReferencesMeta: []ProposalReference{{ID: reference.ID, Kind: "image", Role: "style-ref", Label: "参考"}},
	}); err != nil {
		t.Fatalf("bound prompt must propose: %v", err)
	}
}

// Editing a proposed asset's recipe through the one asset.update tool must
// rewrite the same assetId in place (no new proposal), and must fail closed once
// the recipe is frozen — while the creative-info layer keeps working.
func TestAssetUpdateEditsProposedRecipeInPlace(t *testing.T) {
	media, credential, reference := newProposalTestService(t)
	proposed, err := media.Propose(ProposeInput{
		Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID, Prompt: "初版提示词",
		ReferencesMeta: []ProposalReference{{ID: reference.ID, Kind: "image", Role: "style-ref", Label: "参考"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := mediaMCPTool(nil, media, AgentSession{ID: "s1"}, "recut.media.asset.update", map[string]any{
		"assetId": proposed.ID,
		"prompt":  "改写后的提示词",
		"note":    "换一个转场",
	})
	if err != nil {
		t.Fatalf("asset.update recipe edit failed: %v", err)
	}
	envelope, _ := result.(map[string]any)
	view, _ := envelope["structuredContent"].(map[string]any)
	if view["assetId"] != proposed.ID || view["prompt"] != "改写后的提示词" {
		t.Fatalf("edit view = %#v", view)
	}
	updated, err := media.GetAsset(proposed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if prompt, _ := updated.Metadata["prompt"].(string); prompt != "改写后的提示词" {
		t.Fatalf("stored prompt = %q", prompt)
	}
	if updated.Status != AssetStatusProposed {
		t.Fatalf("editing must keep the asset proposed, got %q", updated.Status)
	}
	generation, _ := updated.Metadata["generation"].(map[string]any)
	if note, _ := generation["note"].(string); note != "换一个转场" {
		t.Fatalf("recipe note = %#v", generation["note"])
	}
}

func TestAssetUpdateRecipeFailsClosedWhenNotProposed(t *testing.T) {
	media, completed := newMaterialTestService(t)
	_, err := mediaMCPTool(nil, media, AgentSession{ID: "s1"}, "recut.media.asset.update", map[string]any{
		"assetId": completed.ID, "prompt": "改配方",
	})
	var env *mcpError
	if !errors.As(err, &env) || env.Kind != "validation" || env.Code != "asset_not_editable" {
		t.Fatalf("err = %v; want validation/asset_not_editable", err)
	}
	if env.Hint == "" {
		t.Fatal("a validation envelope must carry an actionable hint")
	}
	// 创作信息层不受配方冻结影响。
	if _, err := mediaMCPTool(nil, media, AgentSession{ID: "s1"}, "recut.media.asset.update", map[string]any{
		"assetId": completed.ID, "name": "新名字",
	}); err != nil {
		t.Fatalf("material update on a completed asset must still work: %v", err)
	}
}

func TestAssetUpdateRequiresAField(t *testing.T) {
	media, completed := newMaterialTestService(t)
	_, err := mediaMCPTool(nil, media, AgentSession{ID: "s1"}, "recut.media.asset.update", map[string]any{"assetId": completed.ID})
	var env *mcpError
	if !errors.As(err, &env) || env.Code != "nothing_to_update" {
		t.Fatalf("err = %v; want nothing_to_update", err)
	}
}

// Only recipe keys count as a recipe edit: a material-only call must not touch
// (or be blocked by) the generation recipe.
func TestProposalPatchFromMCPMapsRecipeFields(t *testing.T) {
	if _, changed := proposalPatchFromMCP(map[string]any{"assetId": "a", "name": "n"}); changed {
		t.Fatal("material-only input must not read as a recipe edit")
	}
	patch, changed := proposalPatchFromMCP(map[string]any{
		"assetId": "a", "capability": "video.generate", "route": "direct", "prompt": "p",
		"references":   []any{map[string]any{"id": "r1", "kind": "image", "role": "style-ref"}},
		"referenceIds": []any{"r1"}, "modelId": "m", "credentialId": "c",
		"output": map[string]any{"resolution": "480p"}, "aspectRatio": "9:16", "durationSec": float64(5), "note": "n",
	})
	if !changed {
		t.Fatal("recipe fields must be detected")
	}
	if patch.Capability == nil || *patch.Capability != "video.generate" || patch.Route == nil || *patch.Route != "direct" {
		t.Fatalf("capability/route = %#v/%#v", patch.Capability, patch.Route)
	}
	if patch.Prompt == nil || *patch.Prompt != "p" || patch.ModelID == nil || *patch.ModelID != "m" {
		t.Fatalf("prompt/modelId = %#v/%#v", patch.Prompt, patch.ModelID)
	}
	if patch.References == nil || len(*patch.References) != 1 || (*patch.References)[0].ID != "r1" {
		t.Fatalf("references = %#v", patch.References)
	}
	if patch.ReferenceIDs == nil || len(*patch.ReferenceIDs) != 1 || (*patch.ReferenceIDs)[0] != "r1" {
		t.Fatalf("referenceIds = %#v", patch.ReferenceIDs)
	}
	if patch.DurationSec == nil || *patch.DurationSec != 5 || patch.AspectRatio == nil || *patch.AspectRatio != "9:16" {
		t.Fatalf("durationSec/aspectRatio = %#v/%#v", patch.DurationSec, patch.AspectRatio)
	}
	if patch.Note == nil || *patch.Note != "n" || patch.Output["resolution"] != "480p" {
		t.Fatalf("note/output = %#v/%#v", patch.Note, patch.Output)
	}
}
