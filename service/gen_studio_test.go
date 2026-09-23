/*
 * [INPUT]: 依赖 BuiltinAppManager/LoadCatalog、gen-studio 的 contributes.media 声明与 media 包的
 *          RegisterAppProviders/CapabilityModelGroups
 * [OUTPUT]: 验证 gen-studio 随客户端内置安装、其 contributes.media 声明的 local-gen provider 被映射为
 *          平台模型 local-gen/qwen-image，并进入能力模型聚合
 * [POS]: service 的「App 贡献本地 media provider」回归测试；不访问真实用户目录或网络
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"path/filepath"
	"testing"

	"recut-service/media"
)

func TestGenStudioContributesLocalMediaProvider(t *testing.T) {
	appsDir := filepath.Join(t.TempDir(), "apps")
	if err := NewBuiltinAppManager(appsDir).Ensure(); err != nil {
		t.Fatal(err)
	}
	// RegisterAppProviders mutates the global catalog; restore it for other tests.
	defer media.RegisterAppProviders(nil)

	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	app, ok := catalog.Get("recut.gen-studio")
	if !ok {
		t.Fatal("gen-studio was not installed as a built-in App")
	}
	if app.Manifest.Contributes == nil || app.Manifest.Contributes.Media == nil {
		t.Fatal("gen-studio must declare contributes.media")
	}
	providers := app.Manifest.Contributes.Media.Providers
	if len(providers) != 1 || providers[0].ID != "local-gen" || providers[0].Protocol != "local" {
		t.Fatalf("unexpected contributed providers: %#v", providers)
	}
	mapped := mediaProviderFromContribution(providers[0])
	if mapped.Protocol != "local" || len(mapped.Models) != 1 {
		t.Fatalf("mapped provider = %#v", mapped)
	}
	if mapped.Models[0].ID != "local-gen/qwen-image" || string(mapped.Models[0].Capability) != "image.generate" {
		t.Fatalf("mapped model = %#v", mapped.Models[0])
	}

	// 走真实桥接装配：App 贡献 provider → 合并目录 + 注册执行桥 + 动态就绪面。
	store := NewStore(t.TempDir(), nil)
	host := NewAppHost(catalog, store)
	service := NewMediaService(store)
	wireAppMediaProviders(host, service)

	found := false
	for _, model := range service.Models() {
		if model.ID == "local-gen/qwen-image" && model.Provider == "local-gen" {
			found = true
		}
	}
	if !found {
		t.Fatal("local-gen/qwen-image must resolve in the merged catalog")
	}
	if service.LocalAppExecutor("local-gen") == nil {
		t.Fatal("wireAppMediaProviders must register the local-gen executor")
	}
	groups, err := service.CapabilityModelGroups(media.ImageGenerate)
	if err != nil {
		t.Fatal(err)
	}
	listed := false
	for _, group := range groups {
		if group.Provider == "local-gen" && len(group.LocalModels) == 1 && group.LocalModels[0].Model == "qwen-image" {
			listed = true
		}
	}
	if !listed {
		t.Fatalf("local-gen must appear with its local model readiness: %#v", groups)
	}
}
