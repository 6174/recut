/*
 * [INPUT]: 依赖 catalog（provider/model/能力查询）、路由表与本地 provider 识别；本地模型面由注入的
 *          localModelProvider 提供（ComfyUI Studio 的 comfy.catalog）
 * [OUTPUT]: 对外提供 CapabilityModelGroups：按 capability 聚合本地 provider 的生成模型分组（含默认路由
 *          标记、平台模型清单、本地 App 模型就绪度与逐组错误）
 * [POS]: media 的能力级模型聚合查询；只读无副作用，供平台 HTTP 与 MCP 工具共用；镜像 CapabilityVoiceGroups
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import "sort"

// LocalModelInfo 是本地生成 App（ComfyUI Studio）注册表里的一个模型就绪投影，
// 由 daemon 注入的 localModelProvider 提供，用于把本地模型并入平台能力模型聚合。
type LocalModelInfo struct {
	Model      string  `json:"model"`
	Capability string  `json:"capability"`
	Runtime    string  `json:"runtime"`
	Label      string  `json:"label,omitempty"`
	Ready      bool    `json:"ready"`
	Installed  bool    `json:"installed"`
	SizeGB     float64 `json:"sizeGb,omitempty"`
}

// CapabilityModelGroup 是一个可服务某能力的本地模型来源分组。目前只有 Protocol=="local"
// 的生成 provider 进入该聚合（云端模型走 provider 目录，无需动态聚合）。
type CapabilityModelGroup struct {
	Provider       string           `json:"provider"`
	Protocol       string           `json:"protocol"`
	IsDefaultRoute bool             `json:"isDefaultRoute"`
	Models         []MediaModel     `json:"models"`
	LocalModels    []LocalModelInfo `json:"localModels,omitempty"`
	Error          string           `json:"error,omitempty"`
}

// CapabilityModelGroups 返回某能力下所有本地生成 provider 的模型分组。
// 仅 image.generate / video.generate 有本地模型聚合语义；其他能力返回空分组列表。
func (m *MediaService) CapabilityModelGroups(capability MediaCapability) ([]CapabilityModelGroup, error) {
	if !knownCapability(capability) {
		return nil, errUnknownCapability(capability)
	}
	if capability != ImageGenerate && capability != VideoGenerate {
		return []CapabilityModelGroup{}, nil
	}
	routes, err := m.ListRoutes()
	if err != nil {
		return nil, err
	}
	defaultProvider := ""
	for _, route := range routes {
		if route.Capability == capability && route.Enabled && route.ID == string(capability)+".default" {
			if model, ok := modelByID(route.ModelID); ok {
				defaultProvider = model.Provider
			}
		}
	}
	localModels := []LocalModelInfo{}
	if m.localModelProvider != nil {
		localModels = m.localModelProvider()
	}
	groups := []CapabilityModelGroup{}
	for _, provider := range m.Providers() {
		if provider.Protocol != "local" {
			continue
		}
		models := generationModelsFor(provider, capability)
		if len(models) == 0 {
			continue
		}
		group := CapabilityModelGroup{
			Provider:       provider.ID,
			Protocol:       provider.Protocol,
			IsDefaultRoute: defaultProvider == provider.ID,
			Models:         models,
		}
		modelSet := make(map[string]bool, len(models))
		for _, model := range models {
			modelSet[model.ID] = true
		}
		for _, info := range localModels {
			if info.Capability != string(capability) {
				continue
			}
			if modelSet[provider.ID+"/"+info.Model] {
				group.LocalModels = append(group.LocalModels, info)
			}
		}
		if len(group.LocalModels) == 0 {
			group.Error = "local generation engine is not installed or unavailable"
		}
		groups = append(groups, group)
	}
	sort.SliceStable(groups, func(i, j int) bool { return groups[i].Provider < groups[j].Provider })
	return groups, nil
}

// generationModelsFor 返回某 provider 下某能力且可用的模型（本地 provider 无 voices 语义）。
func generationModelsFor(provider MediaProvider, capability MediaCapability) []MediaModel {
	models := []MediaModel{}
	for _, model := range provider.Models {
		if model.Capability != capability || !model.Available {
			continue
		}
		models = append(models, model)
	}
	return models
}
