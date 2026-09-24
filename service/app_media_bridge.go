/*
 * [INPUT]: 依赖 AppHost（遍历已安装 App 的 manifest contributes.media、InvokeMCP 到 App 的 generate/save/
 *          catalog operation）、ShellJobManager（等待 generate 提交的 shell job）、MediaService（注册本地
 *          provider/模型、读取/挂载产物 Asset）与 media 包的本地执行契约。
 * [OUTPUT]: 把每个已安装 App 声明的本地 media provider（contributes.media）接到平台：
 *          ① 静态 provider/模型目录合并进全局 media 目录（media.RegisterAppProviders）；
 *          ② 通用执行桥（generate → 等 shell job 终态 → save 授权落库 → 返回平台 Asset），按 provider id 注册；
 *          ③ 动态模型就绪面（调用 App 的 catalog/status op）供 capability model 聚合展示。
 *          App 未安装时无 provider 注册，本地路由提交得到引导错误。
 * [POS]: service 的通用「App 贡献本地 provider」桥；与 local_speech_bridge 的 local-audio 硬编码并列，
 *        但完全由 manifest 驱动，无 per-app Go 代码；只经 App 公开 operation 契约，不触碰其私有 SQLite。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"fmt"
	"time"

	"recut-service/media"
)

// wireAppMediaProviders registers every installed App's contributed local media
// providers with the platform media service. Called once at daemon start, after
// the AppHost (catalog) is ready and before media jobs are reconciled.
func wireAppMediaProviders(host *AppHost, platformMedia *media.MediaService) {
	if host == nil || platformMedia == nil {
		return
	}
	apps, err := host.catalog.List()
	if err != nil {
		return
	}
	providers := []media.MediaProvider{}
	for _, app := range apps {
		contribution := app.Manifest.Contributes
		if contribution == nil || contribution.Media == nil {
			continue
		}
		for _, provider := range contribution.Media.Providers {
			providers = append(providers, mediaProviderFromContribution(provider))
			registerAppProviderExecutor(host, platformMedia, app.Manifest.ID, provider)
		}
	}
	media.RegisterAppProviders(providers)
	// 动态就绪面：聚合所有 App 的本地模型就绪度，供 list_capability_models 展示。
	platformMedia.SetLocalModelProvider(func() []media.LocalModelInfo {
		return appLocalModels(host, apps)
	})
}

// mediaProviderFromContribution maps a manifest contributes.media provider to the
// platform MediaProvider contract. Platform model IDs are namespaced as
// "<providerID>/<modelID>" so routes resolve like any other provider.
func mediaProviderFromContribution(contribution ContributedMediaProvider) media.MediaProvider {
	models := make([]media.MediaModel, 0, len(contribution.Models))
	for _, model := range contribution.Models {
		models = append(models, media.MediaModel{
			ID:           contribution.ID + "/" + model.ID,
			Provider:     contribution.ID,
			Name:         model.Name,
			Capability:   media.MediaCapability(model.Capability),
			APIModelID:   model.ID,
			InputModes:   append([]string(nil), model.InputModes...),
			OutputModes:  append([]string(nil), model.OutputModes...),
			Available:    true,
			Configurable: false,
		})
	}
	return media.MediaProvider{
		ID:       contribution.ID,
		Name:     contribution.Name,
		Protocol: contribution.Protocol,
		Models:   models,
		Source:   "app",
	}
}

// registerAppProviderExecutor wires one contributed provider to a generic bridge
// that invokes the App's declared generate/save operations.
func registerAppProviderExecutor(host *AppHost, platformMedia *media.MediaService, appID string, contribution ContributedMediaProvider) {
	platformMedia.SetLocalAppExecutor(contribution.ID, func(job media.MediaJob, model media.MediaModel, output map[string]any) (media.MediaAsset, error) {
		return runAppGeneration(host, platformMedia, appID, contribution, job, model, output)
	})
}

// runAppGeneration executes one local generation through the App's public MCP
// operations: generate (submit) → wait shell job → save (authorized import).
func runAppGeneration(host *AppHost, platformMedia *media.MediaService, appID string, contribution ContributedMediaProvider, job media.MediaJob, model media.MediaModel, output map[string]any) (media.MediaAsset, error) {
	app, ok := host.catalog.Get(appID)
	if !ok || !operationIsCapability(app.Manifest, contribution.Operations.Generate) || !operationIsCapability(app.Manifest, contribution.Operations.Save) {
		return media.MediaAsset{}, fmt.Errorf("App %s is not installed or its capabilities are unavailable; install it or switch the default route to a cloud provider", appID)
	}
	input := map[string]any{
		"model":  model.APIModelID,
		"prompt": job.Prompt,
	}
	if len(job.ReferenceIDs) > 0 {
		input["referenceAssetIds"] = append([]string(nil), job.ReferenceIDs...)
	}
	for _, key := range []string{"aspectRatio", "seed", "negativePrompt", "steps", "cfg", "width", "height", "durationSec"} {
		if value, ok := output[key]; ok {
			input[key] = value
		}
	}
	target := Target{AppID: appID}
	raw, err := host.InvokeMCP(target, appID, contribution.Operations.Generate, input)
	if err != nil {
		return media.MediaAsset{}, fmt.Errorf("local generation failed: %w", err)
	}
	generationID := mapString(jsonMap(jsonMap(raw)["generation"]), "id")
	shellJobID := mapString(jsonMap(jsonMap(raw)["job"]), "id")
	if generationID == "" {
		return media.MediaAsset{}, fmt.Errorf("local generation did not return a generation id")
	}
	if shellJobID == "" {
		return media.MediaAsset{}, fmt.Errorf("local generation did not return a job id")
	}
	if _, err := host.jobs.WaitByID(shellJobID, 30*time.Minute); err != nil {
		return media.MediaAsset{}, fmt.Errorf("local generation job failed: %w", err)
	}
	shell, err := host.jobs.FindByID(shellJobID)
	if err != nil || shell.Status != ShellJobCompleted {
		status := "unknown"
		if err == nil {
			status = string(shell.Status)
		}
		return media.MediaAsset{}, fmt.Errorf("local generation job did not complete (status=%s)", status)
	}
	kind := "image"
	if job.Capability == media.VideoGenerate {
		kind = "video"
	}
	// 把平台为该 Job 预建的 pending Asset 一并交给 App 的 save：App 用 ctx.media.completeAsset
	// 原地补全同一 assetId，平台不会再落一张重复成品；不支持的 App 忽略该字段，由下方
	// CompleteGenerationFromImport 兜底归并。
	saveInput := map[string]any{"id": generationID, "kind": kind}
	if len(job.AssetIDs) == 1 {
		saveInput["assetId"] = job.AssetIDs[0]
	}
	invoked, err := host.capabilityInvoke(Target{ProjectID: job.ProjectID}, appID, contribution.Operations.Save,
		saveInput, "default-generation-route", DefaultLocale)
	if err != nil || !boolMap(invoked, "ok") {
		providerErr := map[string]any(nil)
		if invoked != nil {
			providerErr = jsonMap(jsonMap(invoked)["error"])
		}
		code := mapString(providerErr, "code")
		if code == "" {
			code = "gen.save.failed"
		}
		message := mapString(providerErr, "message")
		if message == "" {
			// err 通常为 nil（capabilityInvoke 把失败装进 invoked.error）；不要用 %v 直接格式化，
			// 否则会产出 "<nil>" 这类无信息错误。
			if err != nil {
				message = err.Error()
			} else {
				message = "the provider did not report a reason"
			}
		}
		return media.MediaAsset{}, &mcpError{
			Kind:      "provider",
			Code:      code,
			Message:   "local generation save failed: " + message,
			Hint:      loc(DefaultLocale, "本地生成已完成但平台授权落库失败；可改用 App 的 generate + save，或把默认路由切到云端 provider。", "Local generation completed but the platform save failed; use the App's generate + save, or switch the default route to a cloud provider."),
			Retryable: true,
		}
	}
	assetID := mapString(jsonMap(jsonMap(invoked)["result"]), "assetId")
	if assetID == "" {
		return media.MediaAsset{}, fmt.Errorf("local generation save did not return an asset id")
	}
	// 把 App 导入的成品归并回 Job 预建的 pending Asset：否则平台的「生成中」占位卡会永远
	// 停留在 running，同时 App 又导入出一张重复成品卡。
	asset, err := platformMedia.CompleteGenerationFromImport(job, assetID)
	if err != nil {
		return media.MediaAsset{}, fmt.Errorf("local generation asset unavailable: %w", err)
	}
	if job.ProjectID != "" {
		_ = platformMedia.Attach(asset.ID, job.ProjectID)
	}
	return asset, nil
}

// appLocalModels aggregates each App's dynamic model readiness by calling its
// contributed catalog (or status) operation. Static model identity comes from
// the manifest; only readiness (downloaded/runtime) is dynamic.
func appLocalModels(host *AppHost, apps []App) []media.LocalModelInfo {
	infos := []media.LocalModelInfo{}
	for _, app := range apps {
		contribution := app.Manifest.Contributes
		if contribution == nil || contribution.Media == nil {
			continue
		}
		for _, provider := range contribution.Media.Providers {
			op := provider.Operations.Catalog
			if op == "" {
				op = provider.Operations.Status
			}
			if op == "" || !operationIsCapability(app.Manifest, op) {
				continue
			}
			raw, err := host.InvokeMCP(Target{AppID: app.Manifest.ID}, app.Manifest.ID, op, map[string]any{})
			if err != nil {
				continue
			}
			infos = append(infos, localModelsFromCatalog(raw)...)
		}
	}
	return infos
}

// localModelsFromCatalog projects an App catalog operation's models[] into
// media.LocalModelInfo (label accepts a string or {zh,en}; readiness from
// weight.installed / top-level ready).
func localModelsFromCatalog(raw any) []media.LocalModelInfo {
	models := sliceField(jsonMap(raw), "models")
	if models == nil {
		return nil
	}
	infos := make([]media.LocalModelInfo, 0, len(models))
	for _, item := range models {
		entry := jsonMap(item)
		id := mapString(entry, "model")
		if id == "" {
			continue
		}
		weight := jsonMap(entry["weight"])
		infos = append(infos, media.LocalModelInfo{
			Model:      id,
			Capability: mapString(entry, "capability"),
			Runtime:    mapString(entry, "runtime"),
			Label:      voiceName(entry["label"], id),
			Ready:      boolMap(entry, "ready"),
			Installed:  boolMap(weight, "installed"),
			SizeGB:     numberField(weight, "sizeGb"),
		})
	}
	return infos
}

// numberField reads a numeric map field (JSON decodes numbers as float64).
func numberField(m map[string]any, key string) float64 {
	if m == nil {
		return 0
	}
	if value, ok := m[key].(float64); ok {
		return value
	}
	return 0
}
