/*
 * [INPUT]: 依赖 catalogIndex 快照机制（catalog.go）与 App 贡献的本地 provider（contributes.media）
 * [OUTPUT]: 把已安装 App 声明的本地 media provider 合并进全局模型目录，并在 CDN 刷新时保留；同时维护一份
 *           「不含 App 贡献」的基准目录（seed+CDN），使注册/注销 App provider 永不丢失同名的种子 provider
 * [POS]: media 目录的「App 贡献」面；与种子/CDN 并列，由 daemon 在 AppHost 就绪后注册
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

// appMediaProviders holds local providers contributed by installed Apps
// (manifest contributes.media). They never come from the CDN and must survive
// catalog refreshes, so every catalog build re-appends them.
var appMediaProviders []MediaProvider

// baseCatalogProviders is the last seed+CDN catalog WITHOUT any App-contributed
// provider. RegisterAppProviders rebuilds from it so that unregistering an App
// provider never drops a same-id seed provider (e.g. local-audio seeded in
// catalog_seed.go and later contributed by Audio Studio).
var baseCatalogProviders []MediaProvider

// RegisterAppProviders replaces the App-contributed provider set and rebuilds
// the catalog snapshot so contributed models resolve immediately. Called once
// per daemon start (Apps are static for the process lifetime); re-registration
// also drops providers from Apps that are no longer present. The seed+CDN base
// is preserved, so a nil re-registration restores the seeded providers.
func RegisterAppProviders(providers []MediaProvider) {
	next := make(map[string]bool, len(providers))
	for _, provider := range providers {
		next[provider.ID] = true
	}
	base := baseCatalogProviders
	if base == nil {
		// No recorded base yet: derive one from the current catalog, stripping
		// any previously appended App providers so the base stays App-free.
		current := currentCatalog().providers
		base = make([]MediaProvider, 0, len(current))
		for _, provider := range current {
			if appProviderID(provider.ID) {
				continue
			}
			base = append(base, provider)
		}
	}
	// base is App-free and stable (seed + CDN); keep it so a later nil
	// registration restores the seeded providers.
	baseCatalogProviders = append([]MediaProvider(nil), base...)
	// Effective catalog: base minus providers overridden by an App contribution,
	// plus the App contributions themselves.
	effective := make([]MediaProvider, 0, len(base)+len(providers))
	for _, provider := range base {
		if next[provider.ID] {
			continue
		}
		effective = append(effective, provider)
	}
	appMediaProviders = append([]MediaProvider(nil), providers...)
	swapCatalog(append(effective, appMediaProviders...))
}

// withAppProviders re-appends the current App-contributed providers to a freshly
// built seed+CDN catalog, so a CDN refresh never drops local providers. It also
// records the App-free base for later RegisterAppProviders rebuilds.
func withAppProviders(base []MediaProvider) []MediaProvider {
	baseCatalogProviders = append([]MediaProvider(nil), base...)
	if len(appMediaProviders) == 0 {
		return base
	}
	overridden := make(map[string]bool, len(appMediaProviders))
	for _, provider := range appMediaProviders {
		overridden[provider.ID] = true
	}
	kept := make([]MediaProvider, 0, len(base)+len(appMediaProviders))
	for _, provider := range base {
		if overridden[provider.ID] || appProviderID(provider.ID) {
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
