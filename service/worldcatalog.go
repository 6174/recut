/*
 * [INPUT]: 依赖 WorldStore 的 materialize/archive 原语、标准库 HTTP/JSON 与内嵌世界种子（service/worldcatalog/）
 * [OUTPUT]: 对外提供单一 World Catalog 的解析（本地覆盖 > 远端 CDN > 嵌入种子）与 daemon 自动同步：
 * 仅处理 kind=platform 条目（启动后台 pass + 每 24h + UI 触发的节流 Touch，幂等单飞），delisted 自动归档，
 * published 条目一律跳过（P4 手动策略）；网络请求不持状态锁，同步绝不阻塞 daemon 启动与 /v1/worlds/catalog
 * [POS]: service 的平台 World 内容同步边界；"自动同步"与未来"安装/更新"是同一组物化原语的两种策略，
 * 本地 store 永远是运行时唯一事实源，同步失败静默降级到种子/上次同步内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed worldcatalog
var embeddedWorldCatalogFS embed.FS

// defaultWorldCatalogURL is the platform CDN catalog location (same bucket and
// upload chain as fonts/effects/releases).
const defaultWorldCatalogURL = "https://cdn.recut.video/worlds/catalog.json"

const worldCatalogSyncInterval = 24 * time.Hour
const worldCatalogTouchMinInterval = 5 * time.Minute
const worldCatalogLocalOverrideName = "world-catalog.json"

// WorldCatalogEntry is one catalog row. kind=platform entries auto-sync with
// pgc.* IDs; kind=published entries (pub.* IDs) are frozen for P4 manual
// install/update/uninstall and are always skipped by the auto sync.
type WorldCatalogEntry struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Publisher   string `json:"publisher"`
	Version     string `json:"version"`
	ManifestURL string `json:"manifestUrl"`
	SHA256      string `json:"sha256"`
	Bytes       int64  `json:"bytes"`
	Status      string `json:"status"`
	Order       int    `json:"order"`
}

// WorldCatalog is the single management surface for every platform-distributed
// World (Catalog v1).
type WorldCatalog struct {
	CatalogVersion int                 `json:"catalogVersion"`
	Updated        string              `json:"updated"`
	Worlds         []WorldCatalogEntry `json:"worlds"`
}

type catalogSource int

const (
	catalogSourceLocal catalogSource = iota
	catalogSourceRemote
	catalogSourceEmbedded
)

// WorldCatalogSyncer owns catalog resolution and the platform auto-sync
// strategy. It is idempotent and single-flight: repeated passes against the
// same catalog produce zero revisions. Network work (catalog + manifest
// fetches) happens outside the lock — the mutex only guards the cached
// catalog snapshot, so slow CDNs never block the /v1/worlds/catalog
// passthrough or daemon startup.
type WorldCatalogSyncer struct {
	root     string
	worlds   *WorldStore
	http     *http.Client
	mu       sync.Mutex
	inflight int32
	cached   *WorldCatalog
	source   catalogSource
	lastErr  string
	started   bool
	lastTouch time.Time
}

func NewWorldCatalogSyncer(root string, worlds *WorldStore) *WorldCatalogSyncer {
	return &WorldCatalogSyncer{
		root:   root,
		worlds: worlds,
		http:   &http.Client{Timeout: 60 * time.Second},
		source: catalogSourceEmbedded,
	}
}

// catalogURL resolves the remote catalog location. The env override exists so
// development and E2E can point the daemon at a local catalog without touching
// the user's data directory.
func (s *WorldCatalogSyncer) catalogURL() string {
	if override := strings.TrimSpace(os.Getenv("RECUT_WORLD_CATALOG_URL")); override != "" {
		return override
	}
	return defaultWorldCatalogURL
}

// loadCatalog resolves the catalog: a local <dataRoot>/world-catalog.json
// override wins wholesale (same convention as appstore.json), then the remote
// CDN, then the embedded seed.
func (s *WorldCatalogSyncer) loadCatalog() (*WorldCatalog, catalogSource, error) {
	if data, err := os.ReadFile(filepath.Join(s.root, worldCatalogLocalOverrideName)); err == nil {
		catalog := WorldCatalog{}
		if err := json.Unmarshal(data, &catalog); err != nil {
			return nil, catalogSourceLocal, fmt.Errorf("parse local world catalog override: %w", err)
		}
		return &catalog, catalogSourceLocal, nil
	} else if !os.IsNotExist(err) {
		return nil, catalogSourceLocal, fmt.Errorf("read local world catalog override: %w", err)
	}
	requestURL := s.catalogURL()
	response, err := s.http.Get(requestURL)
	if err == nil {
		defer response.Body.Close()
		if response.StatusCode == http.StatusOK {
			data, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<20))
			if readErr != nil {
				return nil, catalogSourceRemote, fmt.Errorf("read remote world catalog: %w", readErr)
			}
			catalog := WorldCatalog{}
			if err := json.Unmarshal(data, &catalog); err != nil {
				return nil, catalogSourceRemote, fmt.Errorf("parse remote world catalog: %w", err)
			}
			return &catalog, catalogSourceRemote, nil
		}
		// Non-200 (catalog not published yet) falls through to the embedded seed.
	}
	data, err := embeddedWorldCatalogFS.ReadFile("worldcatalog/catalog.json")
	if err != nil {
		return nil, catalogSourceEmbedded, fmt.Errorf("read embedded world catalog: %w", err)
	}
	catalog := WorldCatalog{}
	if err := json.Unmarshal(data, &catalog); err != nil {
		return nil, catalogSourceEmbedded, fmt.Errorf("parse embedded world catalog: %w", err)
	}
	return &catalog, catalogSourceEmbedded, nil
}

// embeddedManifest returns the seed bytes for one entry when the catalog came
// from the embedded layer (offline first launch).
func (s *WorldCatalogSyncer) embeddedManifest(entry WorldCatalogEntry) ([]byte, bool) {
	if entry.ID == "" || entry.Version == "" {
		return nil, false
	}
	data, err := embeddedWorldCatalogFS.ReadFile(filepath.Join("worldcatalog", entry.ID, entry.Version, "world.json"))
	if err != nil {
		return nil, false
	}
	return data, true
}

// fetchManifest downloads one published manifest (≤2MB, 60s budget).
func (s *WorldCatalogSyncer) fetchManifest(entry WorldCatalogEntry) ([]byte, error) {
	if entry.ManifestURL == "" {
		return nil, fmt.Errorf("catalog entry %q has no manifestUrl", entry.ID)
	}
	response, err := s.http.Get(entry.ManifestURL)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("manifest fetch returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, manifestMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > manifestMaxBytes {
		return nil, fmt.Errorf("manifest exceeds %d bytes", manifestMaxBytes)
	}
	return data, nil
}

// manifestMatches verifies the served bytes against the catalog-pinned SHA-256.
func manifestMatches(entry WorldCatalogEntry, data []byte) bool {
	sum := sha256.Sum256(data)
	return strings.EqualFold(hex.EncodeToString(sum[:]), entry.SHA256)
}

// WorldExistsForKind reports whether a world row for the ID already exists with
// the expected origin (platform/published), so the syncer can distinguish
// "added" from "updated" in the synced event.
func (w *WorldStore) WorldExistsForKind(worldID, kind string) (bool, error) {
	db, err := w.database()
	if err != nil {
		return false, err
	}
	var origin string
	err = db.QueryRow("select origin from worlds where id = ?", worldID).Scan(&origin)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return originOrDefault(origin) == kind, nil
}

// Sync runs one full platform pass. It is single-flight (a concurrent call
// while a pass is running returns immediately) and safe to call from the
// startup path and the 24h ticker alike. Network fetches happen outside the
// state lock.
func (s *WorldCatalogSyncer) Sync() {
	if !atomic.CompareAndSwapInt32(&s.inflight, 0, 1) {
		return
	}
	defer atomic.StoreInt32(&s.inflight, 0)
	catalog, source, err := s.loadCatalog()
	if err != nil {
		s.mu.Lock()
		s.lastErr = err.Error()
		s.mu.Unlock()
		logWorldEvent("world.catalog.sync_failed", map[string]string{"reason": "network", "error": err.Error()})
		return
	}
	added, updated, delisted, skipped := 0, 0, 0, 0
	for _, entry := range catalog.Worlds {
		if entry.Kind != WorldPlatform {
			// Strategy B (published) is user-triggered (P4): the auto sync
			// never materializes or archives published worlds.
			skipped++
			continue
		}
		if entry.Status == "delisted" {
			if changed, err := s.worlds.ArchiveWorld(entry.ID, "delisted", "platform"); err != nil {
				logWorldEvent("world.catalog.sync_failed", map[string]string{"reason": "archive", "worldId": entry.ID, "error": err.Error()})
			} else if changed {
				delisted++
			}
			continue
		}
		if entry.Status != "active" {
			skipped++
			continue
		}
		var data []byte
		if source == catalogSourceEmbedded {
			bytes, ok := s.embeddedManifest(entry)
			if !ok {
				logWorldEvent("world.catalog.sync_failed", map[string]string{"reason": "invalid_manifest", "worldId": entry.ID, "error": "embedded seed manifest missing"})
				continue
			}
			data = bytes
		} else {
			bytes, fetchErr := s.fetchManifest(entry)
			if fetchErr != nil {
				logWorldEvent("world.catalog.sync_failed", map[string]string{"reason": "network", "worldId": entry.ID, "error": fetchErr.Error()})
				continue
			}
			data = bytes
		}
		if !manifestMatches(entry, data) {
			sum := sha256.Sum256(data)
			logWorldEvent("world.catalog.manifest_mismatch", map[string]string{
				"worldId":      entry.ID,
				"expectedHash": entry.SHA256,
				"actualHash":   hex.EncodeToString(sum[:]),
			})
			logWorldEvent("world.catalog.sync_failed", map[string]string{"reason": "hash_mismatch", "worldId": entry.ID})
			continue
		}
		existed, err := s.worlds.WorldExistsForKind(entry.ID, WorldPlatform)
		if err != nil {
			logWorldEvent("world.catalog.sync_failed", map[string]string{"reason": "invalid_manifest", "worldId": entry.ID, "error": err.Error()})
			continue
		}
		if _, changed, err := s.worlds.MaterializeWorld(entry.ID, entry.Kind, entry.Publisher, entry.Version, entry.SHA256, entry.Order, data); err != nil {
			logWorldEvent("world.catalog.sync_failed", map[string]string{"reason": "invalid_manifest", "worldId": entry.ID, "error": err.Error()})
			continue
		} else if changed {
			if existed {
				updated++
			} else {
				added++
			}
		}
	}
	s.mu.Lock()
	s.cached = catalog
	s.source = source
	s.lastErr = ""
	s.mu.Unlock()
	logWorldEvent("world.catalog.synced", map[string]string{
		"kind": WorldPlatform, "added": fmt.Sprintf("%d", added), "updated": fmt.Sprintf("%d", updated),
		"delisted": fmt.Sprintf("%d", delisted), "skipped": fmt.Sprintf("%d", skipped),
	})
}

// Touch requests one background sync pass on behalf of a UI surface (worlds
// list, catalog passthrough). It is throttled to one trigger per
// worldCatalogTouchMinInterval and single-flight via Sync itself, so UI
// polling can never hammer the CDN; the pass runs in the background and the
// caller's response is served from current local state.
func (s *WorldCatalogSyncer) Touch() {
	s.mu.Lock()
	elapsed := time.Since(s.lastTouch)
	s.lastTouch = time.Now()
	s.mu.Unlock()
	if elapsed < worldCatalogTouchMinInterval {
		return
	}
	go s.Sync()
}

// StartSync schedules the 24h refresh for the daemon's lifetime and fires the
// startup pass in the background: the sync is non-fatal (offline degrades to
// seed/last-synced content) and must never block daemon startup on a slow or
// unreachable CDN.
func (s *WorldCatalogSyncer) StartSync(ctx context.Context) {
	s.mu.Lock()
	alreadyStarted := s.started
	s.started = true
	s.mu.Unlock()
	if alreadyStarted {
		return
	}
	go s.Sync()
	go func() {
		ticker := time.NewTicker(worldCatalogSyncInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.Sync()
			}
		}
	}()
}

// CachedCatalog returns the most recently resolved catalog (all entries,
// including published) for the GET /v1/worlds/catalog passthrough. It never
// holds the syncer's lock across network access.
func (s *WorldCatalogSyncer) CachedCatalog() *WorldCatalog {
	s.mu.Lock()
	cached := s.cached
	s.mu.Unlock()
	if cached != nil {
		return cached
	}
	catalog, _, _ := s.loadCatalog()
	return catalog
}
