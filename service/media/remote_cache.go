/*
 * [INPUT]: 依赖标准库 HTTP/JSON、net 解析与 <dataRoot>/files/cdn 目录
 * [OUTPUT]: 对外提供统一的远程资源文件缓存 RemoteFileCache：绝对 http(s) URL → 内容寻址本地文件
 * （<dataRoot>/files/cdn/<hash[:2]>/<hash><ext> + index.json），自动映射、重复访问零网络、
 * 跨场景复用（World url 证据、生成参考、字体/素材下载等云端资源）；含 SSRF 防护与体积上限
 * [POS]: media 包的远程资源边界；素材库（media_assets）是用户的显式事实源，本缓存只是按需的
 * 本地映射层，绝不产生 Asset 行；导入素材库走 ImportMediaReader（import_url）显式动作
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// remoteCacheMaxBytes is the per-object download budget for the generic remote
// cache. It is wider than import_url's 25MB because cloud resources beyond
// media (fonts, documents) are cached here too; media generation references
// keep their own per-model limits.
const remoteCacheMaxBytes = 100 * 1024 * 1024

// RemoteFileCache maps absolute http(s) URLs to stable local files under
// <dir>/<hash[:2]>/<hash><ext>. The index (index.json) remembers URL → hash so
// repeated access is a pure filesystem hit. Objects are immutable and
// content-addressed; two URLs with identical bytes share one file.
type RemoteFileCache struct {
	dir        string
	mu         sync.Mutex
	index      map[string]remoteCacheEntry
	httpClient *http.Client
	resolver   *net.Resolver
}

type remoteCacheEntry struct {
	Hash        string `json:"hash"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
	FetchedAt   string `json:"fetchedAt"`
}

// RemoteFileResult describes one resolved remote file.
type RemoteFileResult struct {
	Path        string `json:"path"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	ContentHash string `json:"contentHash"`
	Cached      bool   `json:"cached"`
}

func NewRemoteFileCache(dir string) *RemoteFileCache {
	return &RemoteFileCache{
		dir:        dir,
		index:      map[string]remoteCacheEntry{},
		httpClient: &http.Client{Timeout: 120 * time.Second, CheckRedirect: remoteCacheCheckRedirect},
		resolver:   net.DefaultResolver,
	}
}

func (c *RemoteFileCache) indexPath() string { return filepath.Join(c.dir, "index.json") }

// LoadIndex restores persisted URL → hash mappings (startup).
func (c *RemoteFileCache) LoadIndex() {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := os.ReadFile(c.indexPath())
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &c.index)
}

func (c *RemoteFileCache) persistIndex() error {
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(c.index)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(c.dir, ".index-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		os.Remove(temporaryPath)
		return err
	}
	if err := temporary.Close(); err != nil {
		os.Remove(temporaryPath)
		return err
	}
	return os.Rename(temporaryPath, c.indexPath())
}

// ValidateRemoteFetchURL enforces the shared remote-fetch boundary used by the
// cache, import_url and generation URL references: absolute http(s) only, and
// the host must resolve to a public address (loopback, private, link-local,
// unique-local and unspecified ranges are refused — SSRF/metadata guard).
func ValidateRemoteFetchURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, fmt.Errorf("invalid url %q", rawURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("url must be absolute http(s), got %q", rawURL)
	}
	if parsed.Hostname() == "" {
		return nil, fmt.Errorf("url %q has no host", rawURL)
	}
	if ip := net.ParseIP(parsed.Hostname()); ip != nil {
		if err := assertPublicIP(ip); err != nil {
			return nil, err
		}
		return parsed, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, parsed.Hostname())
	if err != nil {
		return nil, fmt.Errorf("resolve %q: %w", parsed.Hostname(), err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("resolve %q: no addresses", parsed.Hostname())
	}
	for _, ipAddr := range ips {
		if err := assertPublicIP(ipAddr.IP); err != nil {
			return nil, err
		}
	}
	return parsed, nil
}

func assertPublicIP(ip net.IP) error {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsPrivate() || ip.IsUnspecified() {
		return fmt.Errorf("refusing to fetch %s: private or reserved address", ip)
	}
	return nil
}

// RemoteFetchHTTPClient returns an http.Client with the shared SSRF boundary:
// every redirect hop is re-validated against ValidateRemoteFetchURL so a
// public URL cannot redirect into the local network. All outbound remote
// fetches outside the media package (import_url, generation references)
// should use this client instead of a bare http.Client.
func RemoteFetchHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, CheckRedirect: remoteCacheCheckRedirect}
}

// remoteCacheCheckRedirect re-validates every hop so a public URL cannot
// redirect into the local network.
func remoteCacheCheckRedirect(request *http.Request, via []*http.Request) error {
	if len(via) >= 8 {
		return errors.New("too many redirects")
	}
	if _, err := ValidateRemoteFetchURL(request.URL.String()); err != nil {
		return fmt.Errorf("redirect blocked: %w", err)
	}
	return nil
}

// HeadInfo returns lightweight metadata (content type + size) for a remote
// URL without downloading the body. ok=false means the probe failed or the
// server gave no size; callers should treat that as "unknown", not "invalid".
func (c *RemoteFileCache) HeadInfo(rawURL string) (contentType string, size int64, ok bool, err error) {
	if _, err := ValidateRemoteFetchURL(rawURL); err != nil {
		return "", 0, false, err
	}
	request, err := http.NewRequest(http.MethodHead, rawURL, nil)
	if err != nil {
		return "", 0, false, err
	}
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: remoteCacheCheckRedirect}
	response, err := client.Do(request)
	if err != nil {
		return "", 0, false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", 0, false, fmt.Errorf("HEAD %s returned HTTP %d", rawURL, response.StatusCode)
	}
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	size = response.ContentLength
	return contentType, size, size > 0, nil
}

// LocalPathFor resolves a remote URL to a local file, downloading on first
// use and reusing the content-addressed object afterwards. It never fails the
// process on a dead URL: errors are returned for the caller to surface.
func (c *RemoteFileCache) LocalPathFor(rawURL string) (RemoteFileResult, error) {
	key := strings.TrimSpace(rawURL)
	if _, err := ValidateRemoteFetchURL(key); err != nil {
		return RemoteFileResult{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	if entry, exists := c.index[key]; exists {
		path := filepath.Join(c.dir, entry.Hash[:2], entry.Hash+cacheExtension(entry.ContentType, key))
		if info, statErr := os.Stat(path); statErr == nil && info.Size() == entry.Size {
			return RemoteFileResult{Path: path, ContentType: entry.ContentType, Size: entry.Size, ContentHash: "sha256:" + entry.Hash, Cached: true}, nil
		}
		// File vanished (user cleaned the cache): fall through to refetch.
		delete(c.index, key)
	}
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return RemoteFileResult{}, err
	}
	temporary, err := os.CreateTemp(c.dir, ".fetch-*")
	if err != nil {
		return RemoteFileResult{}, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	response, err := c.httpClient.Get(key)
	if err != nil {
		return RemoteFileResult{}, fmt.Errorf("fetch %s: %w", key, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return RemoteFileResult{}, fmt.Errorf("fetch %s: HTTP %d", key, response.StatusCode)
	}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(temporary, hash), io.LimitReader(response.Body, remoteCacheMaxBytes+1))
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return RemoteFileResult{}, fmt.Errorf("fetch %s: %w", key, err)
	}
	if size > remoteCacheMaxBytes {
		return RemoteFileResult{}, fmt.Errorf("%s exceeds the %d byte remote cache limit", key, remoteCacheMaxBytes)
	}
	if size == 0 {
		return RemoteFileResult{}, fmt.Errorf("%s returned an empty body", key)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = ""
	}
	sum := hex.EncodeToString(hash.Sum(nil))
	extension := cacheExtension(contentType, key)
	objectDir := filepath.Join(c.dir, sum[:2])
	objectPath := filepath.Join(objectDir, sum+extension)
	if _, err := os.Stat(objectPath); err != nil {
		// New object: move the temp file into the content-addressed store.
		if err := os.MkdirAll(objectDir, 0o700); err != nil {
			return RemoteFileResult{}, err
		}
		if err := os.Rename(temporaryPath, objectPath); err != nil {
			return RemoteFileResult{}, err
		}
	}
	c.index[key] = remoteCacheEntry{Hash: sum, Size: size, ContentType: contentType, FetchedAt: time.Now().UTC().Format(time.RFC3339)}
	if err := c.persistIndex(); err != nil {
		return RemoteFileResult{}, err
	}
	return RemoteFileResult{Path: objectPath, ContentType: contentType, Size: size, ContentHash: "sha256:" + sum, Cached: false}, nil
}

// cacheExtension picks a stable file extension: contentType first, then a
// safe URL-path extension, then none.
func cacheExtension(contentType, rawURL string) string {
	byMime := map[string]string{
		"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
		"image/avif": ".avif", "image/bmp": ".bmp", "image/svg+xml": ".svg",
		"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
		"audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/ogg": ".ogg",
		"audio/mp4": ".m4a", "audio/aac": ".aac", "audio/flac": ".flac", "audio/opus": ".opus",
		"application/json": ".json", "text/plain": ".txt", "text/markdown": ".md",
		"text/css": ".css", "text/html": ".html",
		"font/woff2": ".woff2", "font/woff": ".woff", "font/ttf": ".ttf", "font/otf": ".otf",
	}
	if ext, ok := byMime[contentType]; ok {
		return ext
	}
	if parsed, err := url.Parse(rawURL); err == nil {
		if ext := strings.ToLower(filepath.Ext(parsed.Path)); ext != "" && len(ext) <= 9 {
			letter := strings.TrimPrefix(ext, ".")
			if mime.TypeByExtension(ext) != "" || letter == "png" || letter == "jpg" || letter == "webp" || letter == "mp4" || letter == "mp3" || letter == "wav" || letter == "json" || letter == "md" || letter == "txt" {
				return ext
			}
		}
	}
	return ""
}
