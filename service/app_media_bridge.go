/*
 * [INPUT]: 依赖 AppHost（遍历已安装 App 的 manifest contributes.media、InvokeMCP 到 App 的 generate/save/
 *          catalog/status/voices operation）、ShellJobManager（等待 generate 提交的 shell job）、MediaService
 *          （注册本地 provider/模型/声音、读取/挂载产物 Asset）与 media 包的本地执行契约。
 * [OUTPUT]: 把每个已安装 App 声明的本地 media provider（contributes.media）接到平台，完全由 manifest 驱动、
 *           无 per-app 代码：① 静态 provider/模型目录合并进全局 media 目录（media.RegisterAppProviders）；
 *           ② 通用执行桥（按 App 的 executor 声明组装输入 → generate/synthesize → 等 shell job 终态 →
 *           save 授权落库 → 返回平台 Asset），图片/视频/语音共用同一条路径；
 *           ③ 声音面（App 的 voices 声明，preset:/character: 前缀编码）；④ 动态模型就绪面（调用 App 的
 *           catalog/status op）供 capability model 聚合展示。App 未安装时无 provider 注册，本地路由提交得到引导错误。
 * [POS]: service 的通用「App 贡献本地 provider」桥；不含任何具体 App 常量（Audio Studio / ComfyUI Studio 都只是
 *        注册了 contributes.media 的普通 App）；只经 App 公开 operation 契约，不触碰其私有 SQLite。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"fmt"
	"strings"
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
			registerAppProviderVoices(host, platformMedia, app.Manifest.ID, provider)
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
// that invokes the App's declared generate/save operations using the provider's
// declared executor shape (input map + result id path + save kind).
func registerAppProviderExecutor(host *AppHost, platformMedia *media.MediaService, appID string, contribution ContributedMediaProvider) {
	platformMedia.SetLocalAppExecutor(contribution.ID, func(job media.MediaJob, model media.MediaModel, output map[string]any) (media.MediaAsset, error) {
		return runAppProvider(host, platformMedia, appID, contribution, job, model, output)
	})
}

// registerAppProviderVoices wires a provider's declared voice operations into the
// platform voice catalog, prefixing ids with preset:/character: so the generic
// executor can pass the raw voiceId back to the App.
func registerAppProviderVoices(host *AppHost, platformMedia *media.MediaService, appID string, contribution ContributedMediaProvider) {
	if contribution.Voices == nil || (contribution.Voices.Presets == "" && contribution.Voices.Characters == "") {
		return
	}
	voices := contribution.Voices
	platformMedia.SetLocalVoiceProvider(contribution.ID, func() []media.MediaVoice {
		app, ok := host.catalog.Get(appID)
		if !ok {
			return nil
		}
		target := Target{AppID: appID}
		out := []media.MediaVoice{}
		if voices.Presets != "" && operationIsCapability(app.Manifest, voices.Presets) {
			if raw, err := host.InvokeMCP(target, appID, voices.Presets, map[string]any{}); err == nil {
				for _, item := range sliceField(raw, "presets") {
					id := mapString(jsonMap(item), "id")
					if id == "" {
						continue
					}
					out = append(out, media.MediaVoice{ID: "preset:" + id, Name: voiceName(jsonMap(item)["name"], id), Category: mapString(jsonMap(item), "scene"), Provider: contribution.ID})
				}
			}
		}
		if voices.Characters != "" && operationIsCapability(app.Manifest, voices.Characters) {
			if raw, err := host.InvokeMCP(target, appID, voices.Characters, map[string]any{}); err == nil {
				for _, item := range sliceField(raw, "characters") {
					id := mapString(jsonMap(item), "id")
					if id == "" {
						continue
					}
					out = append(out, media.MediaVoice{ID: "character:" + id, Name: voiceName(jsonMap(item)["name"], id), Category: mapString(jsonMap(item), "origin"), Provider: contribution.ID})
				}
			}
		}
		return out
	})
}

// runAppProvider executes one local generation through the App's public MCP
// operations: generate (submit) → wait shell job → save (authorized import).
// The input shape and result id path come from the provider's executor
// declaration; absent an executor it falls back to the default generation shape.
func runAppProvider(host *AppHost, platformMedia *media.MediaService, appID string, contribution ContributedMediaProvider, job media.MediaJob, model media.MediaModel, output map[string]any) (media.MediaAsset, error) {
	app, ok := host.catalog.Get(appID)
	if !ok || !operationIsCapability(app.Manifest, contribution.Operations.Generate) || !operationIsCapability(app.Manifest, contribution.Operations.Save) {
		return media.MediaAsset{}, fmt.Errorf("App %s is not installed or its capabilities are unavailable; install it or switch the default route to a cloud provider", appID)
	}
	input := buildProviderInput(contribution, job, model, output)
	target := Target{AppID: appID}
	raw, err := host.InvokeMCP(target, appID, contribution.Operations.Generate, input)
	if err != nil {
		return media.MediaAsset{}, fmt.Errorf("local generation failed: %w", err)
	}
	recordID := providerResultID(contribution, raw)
	shellJobID := mapString(jsonMap(jsonMap(raw)["job"]), "id")
	if recordID == "" {
		return media.MediaAsset{}, fmt.Errorf("local generation did not return a record id")
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
	// 把平台为该 Job 预建的 pending Asset 一并交给 App 的 save：App 用 ctx.media.completeAsset
	// 原地补全同一 assetId，平台不会再落一张重复成品。
	saveInput := map[string]any{"id": recordID, "kind": providerSaveKind(contribution, job)}
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
			code = "media.save.failed"
		}
		message := mapString(providerErr, "message")
		if message == "" {
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
			Hint:      loc(DefaultLocale, "本机生成已完成但平台授权落库失败；可改用 App 的 generate + save，或把默认路由切到云端 provider。", "Local generation completed but the platform save failed; use the App's generate + save, or switch the default route to a cloud provider."),
			Retryable: true,
		}
	}
	assetID := mapString(jsonMap(jsonMap(invoked)["result"]), "assetId")
	if assetID == "" {
		return media.MediaAsset{}, fmt.Errorf("local generation save did not return an asset id")
	}
	asset, err := platformMedia.CompleteGenerationFromImport(job, assetID)
	if err != nil {
		return media.MediaAsset{}, fmt.Errorf("local generation asset unavailable: %w", err)
	}
	if job.ProjectID != "" {
		_ = platformMedia.Attach(asset.ID, job.ProjectID)
	}
	return asset, nil
}

// buildProviderInput assembles the App generate/save input. job.Output is merged
// first (aspectRatio/seed/voiceId/... params), then the provider's InputMap
// overrides/adds the well-known keys. Absent an executor, the default generation
// shape (model/prompt/referenceAssetIds) is used.
func buildProviderInput(contribution ContributedMediaProvider, job media.MediaJob, model media.MediaModel, output map[string]any) map[string]any {
	input := map[string]any{}
	for key, value := range output {
		input[key] = value
	}
	if contribution.Executor == nil || len(contribution.Executor.InputMap) == 0 {
		input["model"] = model.APIModelID
		input["prompt"] = job.Prompt
		if len(job.ReferenceIDs) > 0 {
			input["referenceAssetIds"] = append([]string(nil), job.ReferenceIDs...)
		}
		return input
	}
	for key, token := range contribution.Executor.InputMap {
		if value, ok := resolveProviderToken(token, job, model, output); ok {
			input[key] = value
		}
	}
	return input
}

func resolveProviderToken(token string, job media.MediaJob, model media.MediaModel, output map[string]any) (any, bool) {
	switch token {
	case "model.apiModelId":
		return model.APIModelID, true
	case "job.prompt":
		return job.Prompt, true
	case "job.referenceIds":
		if len(job.ReferenceIDs) == 0 {
			return nil, false
		}
		return append([]string(nil), job.ReferenceIDs...), true
	case "job.voiceId":
		if value, ok := output["voiceId"]; ok {
			return value, true
		}
		return nil, false
	case "job.output":
		return output, true
	default:
		return nil, false
	}
}

// providerResultID reads the record id from the App generate result using the
// executor's ResultIDPath (dot path); default "generation.id".
func providerResultID(contribution ContributedMediaProvider, raw any) string {
	path := "generation.id"
	if contribution.Executor != nil && contribution.Executor.ResultIDPath != "" {
		path = contribution.Executor.ResultIDPath
	}
	return stringByPath(raw, path)
}

// providerSaveKind resolves the kind passed to the App save op.
func providerSaveKind(contribution ContributedMediaProvider, job media.MediaJob) string {
	if contribution.Executor != nil && contribution.Executor.SaveKind != "" {
		return contribution.Executor.SaveKind
	}
	if job.Capability == media.VideoGenerate {
		return "video"
	}
	if job.Capability == media.SpeechGenerate {
		return "synthesis"
	}
	return "image"
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
// weight.installed / top-level ready). It also accepts apps[] (ComfyUI Studio).
func localModelsFromCatalog(raw any) []media.LocalModelInfo {
	models := sliceField(jsonMap(raw), "models")
	if models == nil {
		models = sliceField(jsonMap(raw), "apps")
	}
	if models == nil {
		return nil
	}
	infos := make([]media.LocalModelInfo, 0, len(models))
	for _, item := range models {
		entry := jsonMap(item)
		id := mapString(entry, "model")
		if id == "" {
			id = mapString(entry, "app")
		}
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

// stringByPath resolves a dot path (e.g. "generation.id") to the string value
// stored at that path in a decoded JSON payload.
func stringByPath(raw any, path string) string {
	current := raw
	for _, segment := range strings.Split(path, ".") {
		if segment == "" {
			continue
		}
		current = jsonMap(current)[segment]
		if current == nil {
			return ""
		}
	}
	switch value := current.(type) {
	case string:
		return value
	case fmt.Stringer:
		return value.String()
	default:
		return ""
	}
}

// sliceField 读一个 result 负载里的数组：既接受裸数组，也接受 {key:[...]} / {items:[...]}。
func sliceField(raw any, key string) []any {
	if list, ok := raw.([]any); ok {
		return list
	}
	if m := jsonMap(raw); m != nil {
		if list, ok := m[key].([]any); ok {
			return list
		}
		if list, ok := m["items"].([]any); ok {
			return list
		}
	}
	return nil
}

// voiceName 解析声音名称：字符串直接返回，{zh,en} 对象优先中文，缺省回退 id。
func voiceName(value any, fallback string) string {
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) != "" {
			return typed
		}
	case map[string]any:
		for _, key := range []string{"zh", "en"} {
			if text, ok := typed[key].(string); ok && strings.TrimSpace(text) != "" {
				return text
			}
		}
	}
	return fallback
}

// boolMap 读 map 的布尔字段，缺省 false。
func boolMap(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	if b, ok := m[key].(bool); ok {
		return b
	}
	return false
}

func jsonMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func mapString(m map[string]any, key string) string {
	if s, ok := m[key].(string); ok {
		return s
	}
	if s, ok := m[key].(fmt.Stringer); ok {
		return s.String()
	}
	return ""
}
