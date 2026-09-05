/*
 * [INPUT]: 依赖标准库 HTTP/JSON、种子目录（catalog_seed.go）、<dataRoot> 文件根与 CDN
 *          providers/ 前缀（cdn/scripts/fetch-models.mjs 产出的 index.json + <id>.catalog.json）
 * [OUTPUT]: Provider 模型目录的 CDN-first 加载器：本地缓存立即生效 + 后台 CDN 刷新（sha256 完整性
 *          锚点 + schema 校验）+ 种子最终回退；原子快照替换，任何失败绝不回退到更旧的目录
 * [POS]: rfc/2026-09-03-provider-model-catalog-cdn.md §4；codex 与 local-audio 不参与 CDN 目录，
 *        始终走代码/种子；新增模型零代码发布、6h 内自动生效（重启即时生效）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// defaultProviderCatalogBaseURL is the platform CDN location of the provider
// model catalogs (same bucket and upload chain as fonts/effects/worlds).
const defaultProviderCatalogBaseURL = "https://cdn.recut.video/providers"

const (
	providerCatalogRefreshInterval = 6 * time.Hour
	providerCatalogFetchTimeout    = 10 * time.Second
	providerCatalogMaxBytes        = 8 << 20 // per catalog file
)

// providerCatalogExcluded lists providers that never participate in the CDN
// catalog: codex is a native no-credential capability, local-audio is the
// machine-local TTS bridge. Both always come from code/seed.
var providerCatalogExcluded = map[string]bool{"codex": true, "local-audio": true}

// providerCatalogIndex mirrors cdn/providers/index.json (the integrity anchor).
type providerCatalogIndex struct {
	Schema    string `json:"schema"`
	UpdatedAt string `json:"updatedAt"`
	Providers []struct {
		ID         string `json:"id"`
		Protocol   string `json:"protocol"`
		CatalogURL string `json:"catalogUrl"`
		SHA256     string `json:"sha256"`
		Revision   int    `json:"revision"`
		ModelCount int    `json:"modelCount"`
	} `json:"providers"`
}

// providerCatalogFile mirrors one cdn/providers/<id>.catalog.json.
type providerCatalogFile struct {
	Schema   string `json:"schema"`
	Provider struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		Protocol       string `json:"protocol"`
		DefaultAPIBase string `json:"defaultApiBase"`
	} `json:"provider"`
	Revision   int                        `json:"revision"`
	UpdatedAt  string                     `json:"updatedAt"`
	Models     []MediaModel               `json:"models"`
	Extensions map[string]json.RawMessage `json:"extensions"`
}

// providerCatalogLoader owns the CDN-first load chain. It is single-flight:
// the background ticker and manual refreshes never run concurrently.
type providerCatalogLoader struct {
	baseURL  string
	cacheDir string
	client   *http.Client
	mu       sync.Mutex
	running  bool
}

func newProviderCatalogLoader(baseURL, cacheDir string) *providerCatalogLoader {
	if baseURL == "" {
		baseURL = defaultProviderCatalogBaseURL
	}
	return &providerCatalogLoader{
		baseURL:  baseURL,
		cacheDir: cacheDir,
		client:   &http.Client{Timeout: providerCatalogFetchTimeout},
	}
}

// StartProviderCatalogLoader installs the CDN-first catalog loader: the local
// cache (last successful CDN result) loads synchronously so a restart serves
// the full catalog immediately, then a background goroutine fetches the CDN
// once right away and refreshes at the fixed interval. Network work never
// blocks daemon startup; failures keep the current catalog (seed or cache).
// Only the daemon startup path calls this — tests and short-lived MCP
// processes stay on the compiled-in seed with zero network and zero disk I/O.
func (m *MediaService) StartProviderCatalogLoader() {
	if m.store == nil {
		return
	}
	loader := newProviderCatalogLoader(os.Getenv("RECut_PROVIDER_CATALOG_BASE_URL"), filepath.Join(m.store.MediaRoot(), "cache", "providers"))
	loader.loadCache()
	go func() {
		loader.refresh()
		ticker := time.NewTicker(providerCatalogRefreshInterval)
		defer ticker.Stop()
		for range ticker.C {
			loader.refresh()
		}
	}()
}

// refresh runs one CDN load cycle: success swaps the snapshot and rewrites the
// cache; any failure keeps the current catalog and only logs — a broken CDN
// never degrades the running service to an older or seed-only catalog.
func (l *providerCatalogLoader) refresh() {
	l.mu.Lock()
	if l.running {
		l.mu.Unlock()
		return
	}
	l.running = true
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		l.running = false
		l.mu.Unlock()
	}()
	providers, ok := l.loadRemote()
	if !ok {
		return
	}
	swapCatalog(mergeCatalogProviders(seedProviders, providers))
	if err := l.writeCache(providers); err != nil {
		log.Printf("WARN media provider catalog cache write failed: %v", err)
	}
	log.Printf("INFO media provider catalog refreshed from CDN providers=%d", len(providers))
}

// loadRemote fetches the CDN index, then every provider catalog it lists,
// verifying sha256 and schema per file. One bad provider only drops that
// provider; a failed index drops the whole cycle (return false, keep the
// current catalog — refresh logs the reason and leaves the snapshot alone).
func (l *providerCatalogLoader) loadRemote() ([]MediaProvider, bool) {
	indexData, err := l.fetch(l.baseURL + "/index.json")
	if err != nil {
		log.Printf("WARN media provider catalog index unavailable: %v", err)
		return nil, false
	}
	var index providerCatalogIndex
	if err := json.Unmarshal(indexData, &index); err != nil {
		log.Printf("WARN media provider catalog index malformed: %v", err)
		return nil, false
	}
	if index.Schema != "recut.provider-catalog@1" {
		log.Printf("WARN media provider catalog index schema %q unsupported", index.Schema)
		return nil, false
	}
	providers := []MediaProvider{}
	for _, entry := range index.Providers {
		if providerCatalogExcluded[entry.ID] {
			continue
		}
		data, err := l.fetch(catalogURLFor(l.baseURL, entry.CatalogURL, entry.ID))
		if err != nil {
			log.Printf("WARN media provider catalog %s unavailable: %v", entry.ID, err)
			continue
		}
		if entry.SHA256 != "" && !matchesSHA256(data, entry.SHA256) {
			log.Printf("WARN media provider catalog %s sha256 mismatch, skipped", entry.ID)
			continue
		}
		provider, err := parseProviderCatalog(data)
		if err != nil {
			log.Printf("WARN media provider catalog %s rejected: %v", entry.ID, err)
			continue
		}
		providers = append(providers, provider)
	}
	return providers, len(providers) > 0
}

// catalogURLFor prefers the index-declared catalog URL and falls back to the
// canonical <base>/<id>.catalog.json location.
func catalogURLFor(baseURL, catalogURL, id string) string {
	if catalogURL != "" {
		return catalogURL
	}
	return fmt.Sprintf("%s/%s.catalog.json", baseURL, id)
}

// loadCache restores the last successful CDN snapshot from the local cache so
// restarts serve the full catalog without waiting for the network round-trip.
func (l *providerCatalogLoader) loadCache() {
	entries, err := os.ReadDir(l.cacheDir)
	if err != nil {
		return
	}
	providers := []MediaProvider{}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".catalog.json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(l.cacheDir, name))
		if err != nil {
			continue
		}
		provider, err := parseProviderCatalog(data)
		if err != nil {
			log.Printf("WARN media provider catalog cache %s rejected: %v", name, err)
			continue
		}
		providers = append(providers, provider)
	}
	if len(providers) == 0 {
		return
	}
	swapCatalog(mergeCatalogProviders(seedProviders, providers))
	log.Printf("INFO media provider catalog loaded from cache providers=%d", len(providers))
}

// writeCache atomically persists one provider catalog file per provider plus
// the index copy. Cache failures are non-fatal (next cycle rewrites them).
func (l *providerCatalogLoader) writeCache(providers []MediaProvider) error {
	if err := os.MkdirAll(l.cacheDir, 0o755); err != nil {
		return err
	}
	for _, provider := range providers {
		file := providerCatalogFile{
			Schema: "recut.provider-catalog@1",
			Provider: struct {
				ID             string `json:"id"`
				Name           string `json:"name"`
				Protocol       string `json:"protocol"`
				DefaultAPIBase string `json:"defaultApiBase"`
			}{provider.ID, provider.Name, provider.Protocol, provider.DefaultAPIBase},
			Revision:   provider.Revision,
			UpdatedAt:  provider.UpdatedAt,
			Models:     provider.Models,
			Extensions: provider.Extensions,
		}
		data, err := json.MarshalIndent(file, "", "  ")
		if err != nil {
			return err
		}
		path := filepath.Join(l.cacheDir, provider.ID+".catalog.json")
		if err := writeAtomic(path, data); err != nil {
			return err
		}
	}
	return nil
}

// loadFrom materializes providers through the supplied catalog-file reader
// (CDN URLs or cache paths). Reader errors drop that provider; malformed or
// invalid catalog content drops it too — validation never widens the catalog.
// (Retained for cache-path reuse; the remote path inlines its index walk.)

func (l *providerCatalogLoader) fetch(url string) ([]byte, error) {
	response, err := l.client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d for %s", response.StatusCode, url)
	}
	return io.ReadAll(io.LimitReader(response.Body, providerCatalogMaxBytes))
}

// parseProviderCatalog validates one catalog file into a MediaProvider. Model
// IDs must carry the provider prefix, capabilities must be known, statuses
// must be in the lifecycle set, and every reference budget predicate must
// parse — bad data fails here, never at generation time.
func parseProviderCatalog(data []byte) (MediaProvider, error) {
	var file providerCatalogFile
	if err := json.Unmarshal(data, &file); err != nil {
		return MediaProvider{}, err
	}
	if file.Schema != "recut.provider-catalog@1" {
		return MediaProvider{}, fmt.Errorf("schema %q unsupported", file.Schema)
	}
	if file.Provider.ID == "" || file.Provider.Protocol == "" {
		return MediaProvider{}, fmt.Errorf("missing provider.id/provider.protocol")
	}
	validStatus := map[string]bool{"": true, "stable": true, "new": true, "deprecated": true, "retired": true}
	for i := range file.Models {
		model := &file.Models[i]
		if len(model.ID) <= len(file.Provider.ID)+1 || model.ID[:len(file.Provider.ID)+1] != file.Provider.ID+"/" {
			return MediaProvider{}, fmt.Errorf("model %q does not carry the %q provider prefix", model.ID, file.Provider.ID)
		}
		if !knownCapability(model.Capability) {
			return MediaProvider{}, fmt.Errorf("model %q has unknown capability %q", model.ID, model.Capability)
		}
		if !validStatus[model.Status] {
			return MediaProvider{}, fmt.Errorf("model %q has unknown status %q", model.ID, model.Status)
		}
		if model.Available == false && model.Status == "" {
			model.Status = "stable"
		}
		for _, budget := range model.ReferenceBudgets {
			for _, requirement := range budget.Requirements {
				if _, err := evalReferenceRequirement(requirement, 0, 0, 0); err != nil {
					return MediaProvider{}, fmt.Errorf("model %q budget: %w", model.ID, err)
				}
			}
		}
	}
	return MediaProvider{
		ID:             file.Provider.ID,
		Name:           file.Provider.Name,
		Protocol:       file.Provider.Protocol,
		DefaultAPIBase: file.Provider.DefaultAPIBase,
		Models:         file.Models,
		Revision:       file.Revision,
		UpdatedAt:      file.UpdatedAt,
		Source:         "cdn",
		Extensions:     file.Extensions,
	}, nil
}

// mergeCatalogProviders overlays CDN providers onto the seed by provider ID:
// a CDN catalog wholly replaces that provider's model list; seed entries only
// backfill providers the CDN does not carry. codex/local-audio never come from
// the CDN and stay whatever code/seed provides.
func mergeCatalogProviders(seed []MediaProvider, cdn []MediaProvider) []MediaProvider {
	byID := make(map[string]MediaProvider, len(cdn))
	for _, provider := range cdn {
		byID[provider.ID] = provider
	}
	merged := make([]MediaProvider, 0, len(seed)+len(cdn))
	for _, provider := range seed {
		if overlay, ok := byID[provider.ID]; ok {
			// CDN 目录整体替换 provider，但种子里的静态 voices 数据若 CDN 尚未携带
			// 则用种子回填，避免新字段依赖一次 CDN 发布才生效：
			//   1) provider 级 extensions.voices（legacy 静态清单）；
			//   2) per-model Voices（音色随模型走，如 Atlas 各 TTS 模型 schema 枚举）。
			if _, hasVoices := overlay.Extensions["voices"]; !hasVoices {
				if seedVoices, hasSeed := provider.Extensions["voices"]; hasSeed {
					if overlay.Extensions == nil {
						overlay.Extensions = map[string]json.RawMessage{}
					}
					overlay.Extensions["voices"] = seedVoices
				}
			}
			seedModelsByID := make(map[string]MediaModel, len(provider.Models))
			for _, model := range provider.Models {
				seedModelsByID[model.ID] = model
			}
			for i := range overlay.Models {
				if len(overlay.Models[i].Voices) > 0 {
					continue
				}
				if voices := seedModelVoicesFor(overlay.Models[i].ID); len(voices) > 0 {
					overlay.Models[i].Voices = voices
					continue
				}
				if seedModel, ok := seedModelsByID[overlay.Models[i].ID]; ok {
					overlay.Models[i].Voices = seedModel.Voices
				}
			}
			merged = append(merged, overlay)
			delete(byID, provider.ID)
			continue
		}
		merged = append(merged, provider)
	}
	for _, provider := range byID {
		merged = append(merged, provider)
	}
	return merged
}

func matchesSHA256(data []byte, want string) bool {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]) == want
}

// writeAtomic replaces path in one step (temp file + rename) so readers never
// observe a half-written cache file.
func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
