/*
 * [INPUT]: 依赖内嵌的 curated Google 字体目录（fonts_catalog.json）、Store 数据根（缓存落盘）与 HTTP 客户端
 * [OUTPUT]: 对外提供字体目录（google + local）、自托管 @font-face CSS（url 重写为本服务）与
 *           字体二进制分片交付（首次从 Recut 自有 CDN 抓取，内容寻址落盘缓存，此后离线可用）以及
 *           用户上传字体（local）的登记与交付
 * [POS]: service 的字体服务核心；编辑器只消费 family 名与 /v1/fonts/*，运行期不依赖 fonts.googleapis.com
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	_ "embed"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed fonts_catalog.json
var fontsCatalogJSON []byte

const (
	defaultFontsCDNBase = "https://cdn.recut.video/fonts/google"
	fontsRequestTimeout = 2 * time.Minute
	fontsCacheControl   = "public, max-age=31536000, immutable"
)

type fontsCatalog struct {
	Version int               `json:"version"`
	Google  []fontsCatalogFont `json:"google"`
}

type fontsCatalogFont struct {
	ID       string   `json:"id"`
	Family   string   `json:"family"`
	Category string   `json:"category"`
	Scripts  []string `json:"scripts"`
	Weights  []int    `json:"weights"`
}

type uploadedFont struct {
	ID      string `json:"id"`
	Family  string `json:"family"`
	File    string `json:"file"`
	Size    int64  `json:"size"`
	Created string `json:"createdAt"`
}

type FontService struct {
	root    string   // <data>/fonts —— 缓存与上传字体落盘根
	cdnBase string   // Recut 自有 CDN 字体前缀（测试可注入）
	client  *http.Client
	mu      sync.Mutex
	// cssCache familyID -> 已重写为本服务的 @font-face CSS
	cssCache map[string]string
	// index hash file -> sha256 hex（内容寻址缓存索引，持久化到 <root>/cache/index.json）
	cacheIndex map[string]string
}

var fontsCatalogData = func() fontsCatalog {
	var catalog fontsCatalog
	_ = json.Unmarshal(fontsCatalogJSON, &catalog)
	return catalog
}()

func NewFontService(root string) *FontService {
	return &FontService{
		root:       root,
		cdnBase:    defaultFontsCDNBase,
		client:     &http.Client{Timeout: fontsRequestTimeout},
		cssCache:   map[string]string{},
		cacheIndex: map[string]string{},
	}
}

// SetCDNBase overrides the Recut font CDN prefix (test injection).
func (f *FontService) SetCDNBase(base string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cdnBase = strings.TrimRight(base, "/")
	f.cssCache = map[string]string{}
}

// SetHTTPClient overrides the HTTP client (test injection).
func (f *FontService) SetHTTPClient(client *http.Client) { f.client = client }

// Catalog returns the slim curated catalog plus uploaded local fonts.
func (f *FontService) Catalog() (map[string]any, error) {
	local, err := f.listUploaded()
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"version": fontsCatalogData.Version,
		"sources": []string{"google", "local"},
		"google":  fontsCatalogData.Google,
		"local":   local,
	}, nil
}

func (f *FontService) lookupFamily(id string) (fontsCatalogFont, bool) {
	for _, font := range fontsCatalogData.Google {
		if font.ID == id {
			return font, true
		}
	}
	return fontsCatalogFont{}, false
}

// CSS returns a self-hosted @font-face stylesheet for a family, with every
// woff2 src url rewritten to this service so downloads flow through the cache.
func (f *FontService) CSS(id string) (string, error) {
	if _, ok := f.lookupFamily(id); !ok {
		return "", fmt.Errorf("unknown font family %q", id)
	}
	f.mu.Lock()
	if cached, ok := f.cssCache[id]; ok {
		f.mu.Unlock()
		return cached, nil
	}
	cdnBase := f.cdnBase
	f.mu.Unlock()

	upstream := fmt.Sprintf("%s/%s.css", cdnBase, id)
	response, err := f.client.Get(upstream)
	if err != nil {
		return "", fmt.Errorf("fetch font css %s: %w", upstream, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch font css %s: HTTP %d", upstream, response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return "", fmt.Errorf("read font css %s: %w", upstream, err)
	}

	// Rewrite every absolute CDN url to the local cache endpoint, regardless of
	// the upstream host. The generated css references `…/fonts/google/{id}/{file}`;
	// the browser then hits /v1/fonts/google/{id}/{file} which serves from cache/CDN.
	localBase := "/v1/fonts/google/" + id + "/"
	pattern := `https?://[^)'"]+/fonts/google/` + regexp.QuoteMeta(id) + `/`
	re := regexp.MustCompile(pattern)
	rewritten := re.ReplaceAllString(string(body), localBase)

	f.mu.Lock()
	f.cssCache[id] = rewritten
	f.mu.Unlock()
	return rewritten, nil
}

// FontFile returns the binary for {id}/{file}, caching it content-addressed on
// first fetch from the Recut CDN. Serves from cache when present.
func (f *FontService) FontFile(id, file string) ([]byte, string, error) {
	if file == "" || strings.Contains(file, "/") || strings.Contains(file, "\\") {
		return nil, "", errors.New("invalid font file path")
	}
	// Cache hit: index knows the content hash for this {id,file}.
	if hash, ok := f.cacheHash(id, file); ok {
		path := filepath.Join(f.fontsCacheDir(), hash[:2], hash+".woff2")
		if content, err := os.ReadFile(path); err == nil {
			return content, "application/font-woff2", nil
		}
	}

	upstream := fmt.Sprintf("%s/%s/%s", f.cdnBase, id, file)
	response, err := f.client.Get(upstream)
	if err != nil {
		return nil, "", fmt.Errorf("fetch font %s: %w", upstream, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("fetch font %s: HTTP %d", upstream, response.StatusCode)
	}
	content, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, "", err
	}
	if len(content) == 0 {
		return nil, "", errors.New("fetched font is empty")
	}
	if err := f.storeCachedFont(id, file, content); err != nil {
		return nil, "", err
	}
	return content, "application/font-woff2", nil
}

func (f *FontService) storeCachedFont(id, file string, content []byte) error {
	hash := sha256Hex(content)
	path := filepath.Join(f.fontsCacheDir(), hash[:2], hash+".woff2")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(path, content, 0o600); err != nil && !os.IsExist(err) {
		return err
	}
	f.mu.Lock()
	f.cacheIndex[id+"/"+file] = hash
	err := f.persistCacheIndex()
	f.mu.Unlock()
	return err
}

func (f *FontService) cacheHash(id, file string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	hash, ok := f.cacheIndex[id+"/"+file]
	return hash, ok
}

func (f *FontService) fontsCacheDir() string {
	return filepath.Join(f.root, "fonts", "cache")
}

func (f *FontService) cacheIndexPath() string {
	return filepath.Join(f.root, "fonts", "cache", "index.json")
}

func (f *FontService) persistCacheIndex() error {
	if len(f.cacheIndex) == 0 {
		return nil
	}
	data, err := json.Marshal(f.cacheIndex)
	if err != nil {
		return err
	}
	return os.WriteFile(f.cacheIndexPath(), data, 0o600)
}

// loadCacheIndex reads the persisted content-addressed index on first use.
func (f *FontService) loadCacheIndex() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.cacheIndex) > 0 {
		return
	}
	data, err := os.ReadFile(f.cacheIndexPath())
	if err != nil {
		return
	}
	index := map[string]string{}
	if json.Unmarshal(data, &index) == nil {
		f.cacheIndex = index
	}
}

// --- local (user-uploaded) fonts -------------------------------------------

func (f *FontService) fontsLocalDir() string {
	return filepath.Join(f.root, "fonts", "local")
}

func (f *FontService) fontsManifestPath() string {
	return filepath.Join(f.fontsLocalDir(), "manifest.json")
}

// listUploaded returns the uploaded local fonts manifest (empty when none).
func (f *FontService) listUploaded() ([]uploadedFont, error) {
	data, err := os.ReadFile(f.fontsManifestPath())
	if os.IsNotExist(err) {
		return []uploadedFont{}, nil
	}
	if err != nil {
		return nil, err
	}
	items := []uploadedFont{}
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, err
	}
	return items, nil
}

// UploadLocal stores a font file as a local font entry. mimeType is validated
// loosely (font/woff2, font/ttf, font/otf, application/font-*); binary magic is
// checked for the first bytes. Returns the created entry.
func (f *FontService) UploadLocal(family, fileName string, content []byte) (uploadedFont, error) {
	if len(content) == 0 {
		return uploadedFont{}, errors.New("font file is empty")
	}
	if len(content) > 20<<20 {
		return uploadedFont{}, errors.New("font file exceeds 20MB")
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if ext != ".woff2" && ext != ".woff" && ext != ".ttf" && ext != ".otf" {
		return uploadedFont{}, errors.New("font file must be .woff2/.woff/.ttf/.otf")
	}
	items, err := f.listUploaded()
	if err != nil {
		return uploadedFont{}, err
	}
	hash := sha256Hex(content)
	base := filepath.Join(f.fontsLocalDir(), hash[:2], hash+ext)
	if err := os.MkdirAll(filepath.Dir(base), 0o700); err != nil {
		return uploadedFont{}, err
	}
	if err := os.WriteFile(base, content, 0o600); err != nil && !os.IsExist(err) {
		return uploadedFont{}, err
	}
	if family == "" {
		family = strings.TrimSuffix(fileName, filepath.Ext(fileName))
	}
	entry := uploadedFont{
		ID:      hash[:12],
		Family:  family,
		File:    filepath.ToSlash(filepath.Join(hash[:2], hash+ext)),
		Size:    int64(len(content)),
		Created: time.Now().UTC().Format(time.RFC3339),
	}
	items = append(items, entry)
	if err := f.persistLocalManifest(items); err != nil {
		return uploadedFont{}, err
	}
	return entry, nil
}

// LocalFontFile returns an uploaded font binary by manifest id.
func (f *FontService) LocalFontFile(id string) ([]byte, string, error) {
	items, err := f.listUploaded()
	if err != nil {
		return nil, "", err
	}
	for _, item := range items {
		if item.ID == id {
			content, err := os.ReadFile(filepath.Join(f.fontsLocalDir(), filepath.FromSlash(item.File)))
			if err != nil {
				return nil, "", err
			}
			ext := strings.ToLower(filepath.Ext(item.File))
			mime := "application/octet-stream"
			switch ext {
			case ".woff2":
				mime = "font/woff2"
			case ".woff":
				mime = "font/woff"
			case ".ttf":
				mime = "font/ttf"
			case ".otf":
				mime = "font/otf"
			}
			return content, mime, nil
		}
	}
	return nil, "", fmt.Errorf("uploaded font %q not found", id)
}

// DeleteLocal removes an uploaded font entry by manifest id.
func (f *FontService) DeleteLocal(id string) error {
	items, err := f.listUploaded()
	if err != nil {
		return err
	}
	kept := items[:0]
	removed := false
	for _, item := range items {
		if item.ID == id {
			removed = true
			continue
		}
		kept = append(kept, item)
	}
	if !removed {
		return fmt.Errorf("uploaded font %q not found", id)
	}
	return f.persistLocalManifest(kept)
}

func (f *FontService) persistLocalManifest(items []uploadedFont) error {
	if err := os.MkdirAll(f.fontsLocalDir(), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(f.fontsManifestPath(), data, 0o600)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
