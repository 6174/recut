/*
 * [INPUT]: 依赖 catalog（provider/model/能力查询）、凭据与 ListVoices、路由表与本地 provider 识别
 * [OUTPUT]: 对外提供 CapabilityVoiceGroups：按 capability 聚合所有可用声音分组（本地 provider + 每个云端凭据），含默认路由标记、provider 可选语音模型与逐组错误
 * [POS]: media 的能力级声音聚合查询；只读无副作用，供平台 HTTP 与 MCP 工具共用；云端 voices 实时逐凭据拉取，单组失败不影响其他组
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"sort"
	"strings"
)

// CapabilityVoiceGroup 是一个可服务某能力的声音来源分组：本地 provider 一组（无凭据），
// 云端每个凭据一组。voices 拉取失败时组仍返回并携带 error，由调用方决定降级展示。
type CapabilityVoiceGroup struct {
	Provider       string            `json:"provider"`
	Protocol       string            `json:"protocol"`
	CredentialID   string            `json:"credentialId,omitempty"`
	CredentialName string            `json:"credentialName,omitempty"`
	IsDefaultRoute bool              `json:"isDefaultRoute"`
	Models         []MediaModel      `json:"models"`
	Voices         []MediaVoice      `json:"voices"`
	Error          string            `json:"error,omitempty"`
	VoiceSources   map[string]string `json:"voiceSources,omitempty"`
}

// CapabilityVoiceGroups 返回某能力下所有可用声音分组。capability 必须已知；
// 目前只有 speech.generate 有动态 voices 语义，其他能力返回空分组列表。
func (m *MediaService) CapabilityVoiceGroups(capability MediaCapability) ([]CapabilityVoiceGroup, error) {
	if !knownCapability(capability) {
		return nil, errUnknownCapability(capability)
	}
	if capability != SpeechGenerate {
		return []CapabilityVoiceGroup{}, nil
	}
	routes, err := m.ListRoutes()
	if err != nil {
		return nil, err
	}
	defaultCredential := ""
	defaultProvider := ""
	for _, route := range routes {
		if route.Capability == capability && route.Enabled && route.ID == string(capability)+".default" {
			defaultCredential = route.CredentialID
			if model, ok := modelByID(route.ModelID); ok {
				defaultProvider = model.Provider
			}
		}
	}
	groups := []CapabilityVoiceGroup{}
	seenProvider := map[string]bool{}
	// 本地 provider（protocol=local）无需凭据，作为独立分组；voices 由 App 自身面板提供，
	// 这里只声明分组与模型，让调用方把本地角色/预设并入。
	for _, provider := range m.Providers() {
		models := speechModelsFor(provider, capability)
		if len(models) == 0 {
			continue
		}
		seenProvider[provider.ID] = true
		if provider.Protocol == "local" {
			groups = append(groups, CapabilityVoiceGroup{
				Provider: provider.ID, Protocol: provider.Protocol, IsDefaultRoute: defaultProvider == provider.ID,
				Models: models, Voices: []MediaVoice{}, VoiceSources: map[string]string{},
			})
		}
	}
	credentials, err := m.ListCredentials()
	if err != nil {
		return nil, err
	}
	for _, credential := range credentials {
		provider, ok := providerByID(credential.Provider)
		if !ok {
			continue
		}
		models := speechModelsFor(provider, capability)
		if len(models) == 0 {
			continue
		}
		voices, voiceErr := m.ListVoices(credential.ID)
		group := CapabilityVoiceGroup{
			Provider: credential.Provider, Protocol: provider.Protocol,
			CredentialID: credential.ID, CredentialName: credential.Name,
			Models: models, VoiceSources: map[string]string{},
		}
		if defaultCredential == credential.ID {
			group.IsDefaultRoute = true
		}
		if voiceErr != nil {
			group.Error = voiceErr.Error()
			group.Voices = []MediaVoice{}
		} else {
			group.Voices = voices
		}
		groups = append(groups, group)
	}
	// 未配置任何凭据但目录里存在云端语音 provider 时，补占位分组（voices 空、带提示错误），
	// 供 UI 展示「未设置 → 去配置」引导。
	for _, provider := range m.Providers() {
		if seenProvider[provider.ID] || provider.Protocol == "local" {
			continue
		}
		models := speechModelsFor(provider, capability)
		if len(models) == 0 {
			continue
		}
		groups = append(groups, CapabilityVoiceGroup{
			Provider: provider.ID, Protocol: provider.Protocol,
			Models: models, Voices: []MediaVoice{}, VoiceSources: map[string]string{},
			Error: "credential not configured",
		})
	}
	sort.SliceStable(groups, func(i, j int) bool { return groups[i].Provider < groups[j].Provider })
	return groups, nil
}

func speechModelsFor(provider MediaProvider, capability MediaCapability) []MediaModel {
	models := []MediaModel{}
	for _, model := range provider.Models {
		if model.Capability != capability || !model.Available {
			continue
		}
		// 目录把部分 ASR / STT / 音乐 / 通用音频理解模型也标为 speech.generate；
		// 声音选择只保留真正的 TTS（含 voice 枚举或 tts/speech 命名）。
		if capability == SpeechGenerate && !isVoiceTTSModel(provider, model) {
			continue
		}
		models = append(models, model)
	}
	return models
}

// isVoiceTTSModel 在 isTextToSpeechModel 的黑名单之上补一个正向判定：
// 带 per-model voices 清单、或 ID/名称含 tts/speech、或 provider 有动态 voices
// API（minimax/elevenlabs，模型名不含关键词）的才是声音合成模型
// （排除 Seed Audio 这类通用音频理解模型）。
func isVoiceTTSModel(provider MediaProvider, model MediaModel) bool {
	if !isTextToSpeechModel(model) {
		return false
	}
	if len(model.Voices) > 0 {
		return true
	}
	if provider.Protocol == "minimax" || provider.Protocol == "elevenlabs" {
		return true
	}
	haystack := strings.ToLower(model.ID + " " + model.Name + " " + model.APIModelID)
	return strings.Contains(haystack, "tts") || strings.Contains(haystack, "speech")
}

// isTextToSpeechModel 用 ID/名称启发式排除非 TTS 的 speech.generate 条目
// （Seed ASR、xAI STT、Suno/MiniMax 音乐、歌词生成等）。
func isTextToSpeechModel(model MediaModel) bool {
	haystack := strings.ToLower(model.ID + " " + model.Name + " " + model.APIModelID)
	for _, token := range []string{"asr", "stt", "transcri", "music", "lyric", "chirp", "suno"} {
		if strings.Contains(haystack, token) {
			return false
		}
	}
	return true
}

func errUnknownCapability(capability MediaCapability) error {
	return &unknownCapabilityError{capability: string(capability)}
}

type unknownCapabilityError struct{ capability string }

func (e *unknownCapabilityError) Error() string { return "unknown media capability " + e.capability }
