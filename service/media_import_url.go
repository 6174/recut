/*
 * [INPUT]: 依赖 MediaService 的内容寻址导入（ImportMediaReader）与标准库 HTTP
 * [OUTPUT]: 对外提供 recut.media.import_url 的执行体：绝对 http(s) URL → 本地 Media Asset
 * 的官方桥梁（mime 白名单 image/video/audio、≤25MB、内容哈希去重、可选挂项目）
 * [POS]: service 的媒体边界；World 的 url 证据保持 URL 真相，本地化是按需动作，
 * 素材库仍是用户事实源
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"recut-service/media"
)

// mediaImportURLMaxBytes is the hard size budget for URL imports.
const mediaImportURLMaxBytes = 25 * 1024 * 1024

// importMediaURL downloads one absolute http(s) media URL into the local
// library. It is the official bridge for turning a World's url evidence (or
// any web resource) into a user-owned Asset: absolute http(s) only, mime
// whitelist image/video/audio, ≤25MB, content-addressed deduplication.
// SSRF boundary: the URL (and every redirect hop) must resolve to a public
// address — the same ValidateRemoteFetchURL guard as the unified remote cache.
func importMediaURL(service *MediaService, input map[string]any) (any, error) {
	rawURL := strings.TrimSpace(stringValue(input["url"]))
	parsed, err := media.ValidateRemoteFetchURL(rawURL)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(stringValue(input["name"]))
	if name == "" {
		base := filepath.Base(parsed.Path)
		if base == "" || base == "." || base == "/" || base == "\\" {
			base = "imported-media"
		}
		name = base
	}
	client := media.RemoteFetchHTTPClient(120 * time.Second)
	response, err := client.Get(rawURL)
	if err != nil {
		return nil, fmt.Errorf("fetch url: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("url fetch returned HTTP %d", response.StatusCode)
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if mimeType == "" || mimeType == "application/octet-stream" {
		if guessed := mime.TypeByExtension(filepath.Ext(name)); guessed != "" {
			mimeType = strings.ToLower(guessed)
		}
	}
	switch {
	case strings.HasPrefix(mimeType, "image/"), strings.HasPrefix(mimeType, "video/"), strings.HasPrefix(mimeType, "audio/"):
	default:
		return nil, fmt.Errorf("unsupported media type %q (only image/video/audio URLs can be imported)", mimeType)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, mediaImportURLMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("fetch url: %w", err)
	}
	if len(data) > mediaImportURLMaxBytes {
		return nil, fmt.Errorf("media exceeds the %d byte import limit", mediaImportURLMaxBytes)
	}
	if len(data) == 0 {
		return nil, errors.New("url returned an empty body")
	}
	asset, err := service.ImportMediaReader(name, mimeType, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	projectID := requestedProjectID(input)
	if projectID != "" {
		if err := service.Attach(asset.ID, projectID); err != nil {
			return nil, err
		}
	}
	return map[string]any{"assetId": asset.ID, "name": asset.Name, "kind": asset.Kind, "contentHash": asset.ContentHash}, nil
}
