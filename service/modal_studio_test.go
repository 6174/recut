/*
 * [INPUT]: 依赖 LoadCatalog、modal-studio 的 contributes.media 声明（provider modal-cloud + 由 modalapps
 *          expose 生成的模型）与 media 包的 RegisterAppProviders/CapabilityModelGroups
 * [OUTPUT]: 验证 modal-studio 作为标准 App 安装后，其 contributes.media 被映射为平台模型
 *          modal-cloud/<expose.model>（图片与视频都注册）并注册通用执行桥
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

	// 能力聚合：image/video 两个能力下都应出现 modal-cloud 分组及其平台模型。
	for capability, want := range map[media.MediaCapability][]string{
		media.ImageGenerate: {"modal-cloud/qwen-image", "modal-cloud/sd-turbo"},
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
