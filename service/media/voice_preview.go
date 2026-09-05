/*
 * [INPUT]: 依赖凭据查询、ListVoices（provider 原生 preview URL）与 Generate 幂等任务
 * [OUTPUT]: 对外提供 VoicePreview：云端 voice 的试听解析——provider 直接给 preview URL 时原样返回；否则用一句固定短文走幂等语音生成（idempotency key 绑定 credential+voice+model），返回可轮询的媒体任务
 * [POS]: media 的通用 voice 试听边界；本地 TTS（local-audio）不在此处理，由 Audio Studio 自己的参考音试听链路负责
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import "errors"

const voicePreviewPrompt = "你好，这是我的声音，很高兴为你朗读这段试听文字。"

// VoicePreview 解析一个云端凭据 voice 的试听。返回：
//   - previewURL 非空：provider 原生试听地址，直接播放，job 为零值；
//   - 否则返回幂等提交的语音生成 job（assetId 已就位），调用方按媒体任务轮询，
//     完成后用 /v1/media/assets/{id}/content 播放；重复调用复用同一任务与素材。
func (m *MediaService) VoicePreview(credentialID, voiceID string) (previewURL string, job MediaJob, err error) {
	if credentialID == "" || credentialID == "local-audio" || voiceID == "" {
		return "", MediaJob{}, errors.New("voice preview needs a cloud credentialId and voiceId")
	}
	credential, err := m.credential(credentialID)
	if err != nil {
		return "", MediaJob{}, errors.New("speech credential is unavailable")
	}
	voices, err := m.ListVoices(credentialID)
	if err != nil {
		return "", MediaJob{}, err
	}
	known := false
	for _, voice := range voices {
		if voice.ID == voiceID {
			if voice.PreviewURL != "" {
				return voice.PreviewURL, MediaJob{}, nil
			}
			known = true
			break
		}
	}
	if !known {
		return "", MediaJob{}, errors.New("voice is not available for this credential")
	}
	model, err := m.speechModelForProvider(credential.Provider)
	if err != nil {
		return "", MediaJob{}, err
	}
	job, err = m.Generate(GenerateMediaInput{
		Capability: SpeechGenerate, ModelID: model.ID, CredentialID: credentialID,
		Prompt:         voicePreviewPrompt,
		Output:         map[string]any{"voiceId": voiceID},
		IdempotencyKey: "voice-preview:" + credentialID + ":" + voiceID + ":" + model.ID,
	})
	return "", job, err
}

// speechModelForProvider 选择 provider 的语音模型：默认路由模型优先（同 provider 时），
// 否则取目录中第一个可用语音模型。
func (m *MediaService) speechModelForProvider(providerID string) (MediaModel, error) {
	if route, _, err := m.resolveRoute(GenerateMediaInput{Capability: SpeechGenerate}); err == nil {
		if model, ok := modelByID(route.ModelID); ok && model.Provider == providerID {
			return model, nil
		}
	}
	provider, ok := providerByID(providerID)
	if !ok {
		return MediaModel{}, errors.New("unknown media provider " + providerID)
	}
	for _, model := range provider.Models {
		if model.Capability == SpeechGenerate && model.Available && isVoiceTTSModel(provider, model) {
			return model, nil
		}
	}
	return MediaModel{}, errors.New("provider " + providerID + " has no available speech model")
}
