/*
 * [INPUT]: 依赖 LoadCatalog、modal-studio 的 contributes.media 声明（provider modal-cloud + 由 modalapps
 *          expose 生成的模型）与 media 包的 RegisterAppProviders/CapabilityModelGroups
 * [OUTPUT]: 验证 modal-studio 作为标准 App 安装后，其 contributes.media 被映射为平台模型
 *          modal-cloud/<expose.model>（每个 expose 条目一个平台模型，图片与视频都注册）并注册通用执行桥；
 *          App 模型参数声明（含 aspectRatio）进入平台目录且标记 PassthroughParams
 * [POS]: service 的「App 贡献本地 media provider」回归测试（modal-studio 版）；不访问真实用户目录或网络
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"

	"recut-service/media"
)

func TestModalStudioContributesLocalMediaProvider(t *testing.T) {
	appRoot, err := filepath.Abs(filepath.Join("..", "apps", "modal-studio"))
	if err != nil {
		t.Fatal(err)
	}
	appsDir := t.TempDir()
	if err := os.Symlink(appRoot, filepath.Join(appsDir, "modal-studio")); err != nil {
		t.Fatal(err)
	}
	// RegisterAppProviders mutates the global catalog; restore it for other tests.
	defer media.RegisterAppProviders(nil)

	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	app, ok := catalog.Get("recut.modal-studio")
	if !ok {
		t.Fatal("modal-studio was not discovered in the catalog")
	}
	if app.Manifest.Contributes == nil || app.Manifest.Contributes.Media == nil {
		t.Fatal("modal-studio must declare contributes.media")
	}
	providers := app.Manifest.Contributes.Media.Providers
	if len(providers) != 1 || providers[0].ID != "modal-cloud" || providers[0].Protocol != "local" {
		t.Fatalf("unexpected contributed providers: %#v", providers)
	}
	if providers[0].Operations.Generate != "modal.generate" || providers[0].Operations.Save != "modal.save" {
		t.Fatalf("provider must route generate/save to modal operations: %#v", providers[0].Operations)
	}

	mapped := mediaProviderFromContribution(providers[0])
	if mapped.Protocol != "local" || len(mapped.Models) == 0 {
		t.Fatalf("mapped provider = %#v", mapped)
	}
	capabilityByID := map[string]string{}
	for _, model := range mapped.Models {
		capabilityByID[model.ID] = string(model.Capability)
	}
	for id, capability := range map[string]string{
		"modal-cloud/qwen-image":       "image.generate",
		"modal-cloud/qwen-image-edit":  "image.generate",
		"modal-cloud/sd-turbo":         "image.generate",
		"modal-cloud/minimax-h3":       "video.generate",
		"modal-cloud/minimax-h3-one":   "video.generate",
		"modal-cloud/minimax-h3-turbo": "video.generate",
	} {
		if capabilityByID[id] != capability {
			t.Fatalf("model %s capability = %q, want %q (mapped=%#v)", id, capabilityByID[id], capability, capabilityByID)
		}
	}

	// 走真实桥接装配：App 贡献 provider → 合并目录 + 注册执行桥。
	store := NewStore(t.TempDir(), nil)
	host := NewAppHost(catalog, store)
	service := NewMediaService(store)
	wireAppMediaProviders(host, service)

	found := false
	for _, model := range service.Models() {
		if model.ID == "modal-cloud/qwen-image" && model.Provider == "modal-cloud" {
			found = true
		}
	}
	if !found {
		t.Fatal("modal-cloud/qwen-image must resolve in the merged catalog")
	}
	if service.LocalAppExecutor("modal-cloud") == nil {
		t.Fatal("wireAppMediaProviders must register the modal-cloud executor")
	}

	// 参考能力标注必须随 App 声明进入平台目录：平台的「参考图/参考视频/参考音频」输入提示
	// 来源于 MediaModel.InputModes 与 ReferenceBudgets；缺一即退化为纯文本输入
	// （reference-to-video / reference-to-image 不可见）。
	byID := map[string]media.MediaModel{}
	for _, model := range service.Models() {
		byID[model.ID] = model
	}
	// 同一预设包可暴露多个平台模型：Qwen-Image-2.1 拆成文生图（qwen-image，纯文本）与图像编辑
	// （qwen-image-edit，参考型）两个模型，使平台「按用途配置模型」在「图片生成」与「图片编辑」
	// 两处都能选中它。
	for id, wantModes := range map[string][]string{
		"modal-cloud/minimax-h3":       {"text", "image", "video", "audio"},
		"modal-cloud/minimax-h3-one":   {"text", "image", "video", "audio"},
		"modal-cloud/minimax-h3-turbo": {"text", "image", "video", "audio"},
		"modal-cloud/qwen-image":       {"text"},
		"modal-cloud/qwen-image-edit":  {"text", "image"},
	} {
		model, ok := byID[id]
		if !ok {
			t.Fatalf("model %s missing from the merged catalog", id)
		}
		for _, mode := range wantModes {
			if !stringIn(model.InputModes, mode) {
				t.Fatalf("model %s inputModes = %v, missing %q", id, model.InputModes, mode)
			}
		}
	}
	// 文生图条目必须是「只吃文本」的纯文本模型（否则平台会把它归到「图片编辑」用途）：
	// 不带任何参考输入能力与 referenceBudgets。
	textModel, ok := byID["modal-cloud/qwen-image"]
	if !ok {
		t.Fatal("modal-cloud/qwen-image missing from the merged catalog")
	}
	if stringIn(textModel.InputModes, "image") || len(textModel.ReferenceBudgets) != 0 {
		t.Fatalf("modal-cloud/qwen-image must be pure text-to-image so it can be the global 文生图 route: %#v", textModel)
	}
	// 参考型模型必须带 referenceBudgets（平台据此约束参考数量）。
	// 参考是可选输入：budget 只能设上限，不能要求「≥1 个参考」，否则平台会在提交前拒绝
	// 纯文本请求，App 的「无参考自动回退 text-to-* 」就永远走不到。
	for _, id := range []string{"modal-cloud/minimax-h3", "modal-cloud/minimax-h3-one", "modal-cloud/minimax-h3-turbo", "modal-cloud/qwen-image-edit"} {
		model := byID[id]
		if len(model.ReferenceBudgets) == 0 {
			t.Fatalf("model %s must carry referenceBudgets so the platform enforces its reference inputs", id)
		}
		for _, budget := range model.ReferenceBudgets {
			if len(budget.Requirements) != 0 {
				t.Fatalf("model %s reference budget %q must not require references (text-only must fall back)", id, budget.Requirements)
			}
		}
	}

	// App 模型把 manifest 的参数声明带进平台目录，并标记为 passthrough：平台据此折叠一等字段
	// （把顶层 aspectRatio/durationSec 折进 Output），但输出参数仍由 App 校验（App 表单是唯一真相）。
	// 模型必须声明 aspectRatio，否则 applyAspectRatio 会静默丢弃画幅（参考/首尾帧生视频就设不了画幅）。
	for _, id := range []string{"modal-cloud/qwen-image", "modal-cloud/qwen-image-edit", "modal-cloud/minimax-h3", "modal-cloud/minimax-h3-one", "modal-cloud/minimax-h3-turbo"} {
		model := byID[id]
		if !model.PassthroughParams {
			t.Fatalf("app-contributed model %s must be marked PassthroughParams", id)
		}
		aspectRatioDeclared := false
		for _, parameter := range model.Parameters {
			if parameter.Name == "prompt" {
				t.Fatalf("prompt is a first-class platform input, not an Output parameter: %#v", model.Parameters)
			}
			if parameter.Name == "aspectRatio" {
				aspectRatioDeclared = stringIn(parameter.Enum, "9:16")
			}
		}
		if !aspectRatioDeclared {
			t.Fatalf("model %s must declare aspectRatio (enum 9:16) so the platform folds the first-class field: %#v", id, model.Parameters)
		}
	}
	// 视频模型还要声明 durationSec：否则 agent 传的时长会被丢弃、App 回落到默认 5s。
	for _, id := range []string{"modal-cloud/minimax-h3", "modal-cloud/minimax-h3-one", "modal-cloud/minimax-h3-turbo"} {
		declared := false
		for _, parameter := range byID[id].Parameters {
			if parameter.Name == "durationSec" {
				declared = true
				break
			}
		}
		if !declared {
			t.Fatalf("video model %s must declare durationSec so the platform folds the first-class field: %#v", id, byID[id].Parameters)
		}
	}

	// 能力聚合：image/video 两个能力下都应出现 modal-cloud 分组及其平台模型。
	for capability, want := range map[media.MediaCapability][]string{
		media.ImageGenerate: {"modal-cloud/qwen-image", "modal-cloud/qwen-image-edit", "modal-cloud/sd-turbo"},
		media.VideoGenerate: {"modal-cloud/minimax-h3", "modal-cloud/minimax-h3-one", "modal-cloud/minimax-h3-turbo"},
	} {
		groups, err := service.CapabilityModelGroups(capability)
		if err != nil {
			t.Fatal(err)
		}
		ids := map[string]bool{}
		listed := false
		for _, group := range groups {
			if group.Provider != "modal-cloud" {
				continue
			}
			listed = true
			for _, model := range group.Models {
				ids[model.ID] = true
			}
		}
		if !listed {
			t.Fatalf("%s must list the modal-cloud group: %#v", capability, groups)
		}
		for _, id := range want {
			if !ids[id] {
				t.Fatalf("%s group is missing %s: %#v", capability, id, ids)
			}
		}
	}
}

func stringIn(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
