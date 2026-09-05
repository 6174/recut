/*
 * [INPUT]: 被测 catalog_loader.go / catalog.go / catalog_seed.go 与 fixture JSON 字符串
 * [OUTPUT]: 验证目录加载链的纯函数面：catalog 解析校验（schema/前缀/capability/状态/预算谓词）、
 *          CDN 覆盖种子的按 provider 合并、缓存写入与回读
 * [POS]: rfc/2026-09-03-provider-model-catalog-cdn.md §9 目录加载单测；网络路径不在此覆盖
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const loaderFixtureCatalog = `{
  "schema": "recut.provider-catalog@1",
  "provider": {"id": "minimax", "name": "MiniMax", "protocol": "minimax", "defaultApiBase": "https://api.minimaxi.com"},
  "revision": 14,
  "updatedAt": "2026-09-04T08:00:00Z",
  "models": [
    {"id": "minimax/speech-2.8-hd", "apiModelId": "speech-2.8-hd", "name": "MiniMax Speech 2.8 HD", "capability": "speech.generate", "inputModes": ["text"], "outputModes": ["voice", "speed"], "meta": {"pricing": "≈ $100 / 百万字符（HD）"}},
    {"id": "minimax/seedance-2.0", "apiModelId": "seedance-2.0", "name": "Seedance 2.0", "capability": "video.generate", "inputModes": ["text", "image"], "outputModes": ["durationSeconds"], "referenceBudgets": [{"requirements": ["images+videos>=1"], "maxImages": 9, "maxVideos": 3, "maxAudios": 3}]}
  ],
  "extensions": {"voices": [{"id": "male-qn-qingse", "name": "青涩青年音色", "category": "system"}]}
}`

func TestParseProviderCatalogAcceptsValidFixture(t *testing.T) {
	provider, err := parseProviderCatalog([]byte(loaderFixtureCatalog))
	if err != nil {
		t.Fatalf("parseProviderCatalog: %v", err)
	}
	if provider.ID != "minimax" || provider.Protocol != "minimax" || provider.Source != "cdn" || provider.Revision != 14 {
		t.Fatalf("provider head = %+v", provider)
	}
	if len(provider.Models) != 2 {
		t.Fatalf("models = %d", len(provider.Models))
	}
	if len(provider.Models[1].ReferenceBudgets) != 1 || provider.Models[1].ReferenceBudgets[0].MaxImages != 9 {
		t.Fatalf("reference budgets not parsed: %+v", provider.Models[1].ReferenceBudgets)
	}
	if len(provider.Extensions) != 1 {
		t.Fatalf("extensions not carried: %+v", provider.Extensions)
	}
}

func TestParseProviderCatalogRejectsBadData(t *testing.T) {
	cases := map[string]string{
		"wrong schema":     strings.Replace(loaderFixtureCatalog, "recut.provider-catalog@1", "recut.provider-catalog@2", 1),
		"bad prefix":       strings.Replace(loaderFixtureCatalog, `"id": "minimax/speech-2.8-hd"`, `"id": "other/speech-2.8-hd"`, 1),
		"bad capability":   strings.Replace(loaderFixtureCatalog, `"capability": "speech.generate"`, `"capability": "music.generate"`, 1),
		"bad status":       strings.Replace(loaderFixtureCatalog, `"inputModes": ["text"], "outputModes"`, `"status": "zombie", "inputModes": ["text"], "outputModes"`, 1),
		"bad requirement":  strings.Replace(loaderFixtureCatalog, `"requirements": ["images+videos>=1"]`, `"requirements": ["images+cats>=1"]`, 1),
		"missing provider": `{"schema": "recut.provider-catalog@1", "models": []}`,
	}
	for name, fixture := range cases {
		if _, err := parseProviderCatalog([]byte(fixture)); err == nil {
			t.Fatalf("%s: expected rejection", name)
		}
	}
}

func TestMergeCatalogProvidersOverlaysByProviderID(t *testing.T) {
	cdnProvider, err := parseProviderCatalog([]byte(loaderFixtureCatalog))
	if err != nil {
		t.Fatal(err)
	}
	merged := mergeCatalogProviders(seedProviders, []MediaProvider{cdnProvider})
	byID := map[string]MediaProvider{}
	for _, provider := range merged {
		byID[provider.ID] = provider
	}
	// CDN 有 minimax → 整体取代种子条目并标注 cdn 来源。
	if got := byID["minimax"]; got.Source != "cdn" || len(got.Models) != 2 {
		t.Fatalf("minimax overlay = source %s models %d", got.Source, len(got.Models))
	}
	// CDN 缺失的 provider（atlas-cloud / local-audio 等）保留种子兜底。
	if got := byID["atlas-cloud"]; got.Source == "cdn" || len(got.Models) == 0 {
		t.Fatalf("atlas-cloud seed fallback broken: source %s models %d", got.Source, len(got.Models))
	}
	if got := byID["local-audio"]; got.ID != "local-audio" {
		t.Fatal("local-audio must survive the merge")
	}
}

func TestProviderCatalogCacheRoundTrip(t *testing.T) {
	dir := t.TempDir()
	loader := newProviderCatalogLoader("", dir)
	provider, err := parseProviderCatalog([]byte(loaderFixtureCatalog))
	if err != nil {
		t.Fatal(err)
	}
	if err := loader.writeCache([]MediaProvider{provider}); err != nil {
		t.Fatalf("writeCache: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "minimax.catalog.json")); err != nil {
		t.Fatalf("cache file missing: %v", err)
	}
	loader2 := newProviderCatalogLoader("", dir)
	loader2.loadCache()
	// loadCache 只有在解析出 provider 时才会替换目录；种子 minimax（1 个模型）被缓存（2 个模型）覆盖。
	if got, _ := modelByID("minimax/speech-2.8-hd"); got.Name != "MiniMax Speech 2.8 HD" {
		t.Fatalf("cached catalog not loaded: %+v", got)
	}
	if _, ok := modelByID("minimax/seedance-2.0"); !ok {
		t.Fatal("cached second model missing")
	}
	// 恢复种子目录，避免污染其他测试的进程级快照。
	swapCatalog(seedProviders)
}
