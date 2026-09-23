/*
 * [INPUT]: 依赖 catalogIndex 快照机制（catalog.go）与 App 贡献的本地 provider（contributes.media）
 * [OUTPUT]: 把已安装 App 声明的本地 media provider 合并进全局模型目录，并在 CDN 刷新时保留
 * [POS]: media 目录的「App 贡献」面；与种子/CDN 并列，由 daemon 在 AppHost 就绪后注册
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

// appMediaProviders holds local providers contributed by installed Apps
// (manifest contributes.media). They never come from the CDN and must survive
// catalog refreshes, so every catalog build re-appends them.
var appMediaProviders []MediaProvider

// RegisterAppProviders replaces the App-contributed provider set and rebuilds
// the catalog snapshot so contributed models resolve immediately. Called once
// per daemon start (Apps are static for the process lifetime); re-registration
// also drops providers from Apps that are no longer present.
func RegisterAppProviders(providers []MediaProvider) {
	next := make(map[string]bool, len(providers))
	for _, provider := range providers {
		next[provider.ID] = true
	}
	base := currentCatalog().providers
	kept := make([]MediaProvider, 0, len(base)+len(providers))
	for _, provider := range base {
		if appProviderID(provider.ID) || next[provider.ID] {
			// Drop any previously contributed provider; it is re-appended below.
			continue
		}
		kept = append(kept, provider)
	}
	appMediaProviders = append([]MediaProvider(nil), providers...)
	swapCatalog(append(kept, appMediaProviders...))
}

// withAppProviders re-appends the current App-contributed providers to a freshly
// built catalog (seed + CDN), so a CDN refresh never drops local providers.
func withAppProviders(base []MediaProvider) []MediaProvider {
	if len(appMediaProviders) == 0 {
		return base
	}
	kept := make([]MediaProvider, 0, len(base)+len(appMediaProviders))
	for _, provider := range base {
		if appProviderID(provider.ID) {
			continue
		}
		kept = append(kept, provider)
	}
	return append(kept, appMediaProviders...)
}

func appProviderID(id string) bool {
	for _, provider := range appMediaProviders {
		if provider.ID == id {
			return true
		}
	}
	return false
}
