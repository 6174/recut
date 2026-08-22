/*
 * [INPUT]: 依赖 AppHost（InvokeMCP 到 recut.audio-studio）、ShellJobManager（等待 audio.synthesize
 *          提交的 shell job）、MediaService（读取/挂载产物 Asset）与 media 包的本地执行契约。
 * [OUTPUT]: 把 media 服务的 local-audio（本机 TTS）路由接到已安装的 Audio Studio：通过其公开 MCP 面
 *          audio.synthesize（合成+ASR 回读验收）→ 等待 shell job 终态 → audio.save（平台授权的落库）
 *          → 返回平台 media Asset。Audio Studio 未安装时保持占位不接线，本地路由会得到引导错误。
 * [POS]: service 的本地语音执行桥；只经 Audio Studio 公开 operation 契约，不触碰其私有 SQLite。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"fmt"
	"time"

	"recut-service/media"
)

// audioStudioAppID 是 Audio Studio 的 manifest id（独立 App，不经项目 scope）。
const audioStudioAppID = "recut.audio-studio"

// wireLocalSpeechBridge 在 AppHost 构建完成后把 local-audio 路由接到 Audio Studio。
// MediaService 早于 AppHost 构建（main.go），因此执行桥在这里注入；Audio Studio 未安装时
// 保持噪音最小：不接线，本地路由提交会由 media 服务给出可操作的引导错误。
func wireLocalSpeechBridge(host *AppHost, platformMedia *media.MediaService) {
	if host == nil || platformMedia == nil {
		return
	}
	platformMedia.SetLocalSpeechExecutor(func(job media.MediaJob, model media.MediaModel, voiceID string) (media.MediaAsset, error) {
		target := Target{AppID: audioStudioAppID}
		// 校验 Audio Studio 已安装且暴露能力面（capability 或 mcp，与 capabilityInvoke 同一判定）。
		app, ok := host.catalog.Get(audioStudioAppID)
		if !ok || !operationIsCapability(app.Manifest, "audio.synthesize") || !operationIsCapability(app.Manifest, "audio.save") {
			return media.MediaAsset{}, fmt.Errorf("Audio Studio is not installed or its capabilities are unavailable; install Audio Studio or switch the speech default route to a cloud provider")
		}
		// audio.synthesize：未指定角色（默认音）不传 characterId；角色 ID 直接透传。
		input := map[string]any{"text": job.Prompt}
		if voiceID != "" && voiceID != "__cosyvoice_default__" {
			input["characterId"] = voiceID
		}
		raw, err := host.InvokeMCP(target, audioStudioAppID, "audio.synthesize", input)
		if err != nil {
			return media.MediaAsset{}, fmt.Errorf("local speech synthesis failed: %w", err)
		}
		jobRef := jsonMap(raw)["synthesis"]
		synthesisID := mapString(jsonMap(jobRef), "id")
		shellJobID := mapString(jsonMap(jsonMap(raw)["job"]), "id")
		if synthesisID == "" {
			return media.MediaAsset{}, fmt.Errorf("local speech synthesis did not return a synthesis id")
		}
		if shellJobID == "" {
			return media.MediaAsset{}, fmt.Errorf("local speech synthesis did not return a job id")
		}
		// 等待 Audio Studio 的 shell job 到终态（合成 + ASR 回读验收由 Audio Studio 保证）。
		if _, err := host.jobs.WaitByID(shellJobID, 5*time.Minute); err != nil {
			return media.MediaAsset{}, fmt.Errorf("local speech job failed: %w", err)
		}
		shell, err := host.jobs.FindByID(shellJobID)
		if err != nil || shell.Status != ShellJobCompleted {
			status := "unknown"
			if err == nil {
				status = string(shell.Status)
			}
			return media.MediaAsset{}, fmt.Errorf("local speech job did not complete (status=%s)", status)
		}
		// 平台授权落库：走通用能力桥（同一签名授权注入 input._authorization），
		// 与字幕生成共用一段 InvokeMCP→观察→save 的表达；用户选本地 TTS 为默认即视为允许保存。
		invoked, err := host.capabilityInvoke(Target{ProjectID: job.ProjectID}, audioStudioAppID, "audio.save", map[string]any{"id": synthesisID, "kind": "synthesis"}, "default-voice-route", DefaultLocale)
		if err != nil || !boolMap(invoked, "ok") {
			message := "local speech save failed"
			if invoked != nil {
				message = fmt.Sprintf("%s: %v", message, jsonMap(invoked)["error"])
			}
			return media.MediaAsset{}, fmt.Errorf("%s: %w", message, err)
		}
		rawResult := jsonMap(invoked)["result"]
		assetID := mapString(jsonMap(rawResult), "assetId")
		if assetID == "" {
			return media.MediaAsset{}, fmt.Errorf("local speech save did not return an asset id")
		}
		asset, err := platformMedia.GetAsset(assetID)
		if err != nil {
			return media.MediaAsset{}, fmt.Errorf("local speech asset unavailable: %w", err)
		}
		if job.ProjectID != "" {
			// 归口项目：让该项目的 recut.assets.list(projectId) 能看到这份配音。
			_ = platformMedia.Attach(assetID, job.ProjectID)
		}
		return asset, nil
	})
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

// appExposesOperation 判断 App 是否在 manifest 声明了某 operation 且含指定 surface。
func appExposesOperation(app App, name, surface string) bool {
	for _, op := range app.Manifest.Operations {
		if op.Name != name {
			continue
		}
		for _, s := range op.Surfaces {
			if s == surface {
				return true
			}
		}
	}
	return false
}
