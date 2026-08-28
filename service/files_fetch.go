/*
 * [INPUT]: 依赖 MediaService 的统一远程缓存 RemoteFileCache 与 MCP arguments 约定
 * [OUTPUT]: 对外提供 recut.files.fetch 的执行体：绝对 http(s) URL → 本地缓存文件
 * 路径（内容寻址、≤100MB、拒绝内网/回环地址；重复访问零网络）
 * [POS]: service 的 MCP 文件边界；与 import_url 的区别是本工具不产生素材库 Asset，
 * 只把远程资源映射为可被本地路径工具消费的临时文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"strings"

	"recut-service/media"
)

// fetchRemoteFileTool resolves one absolute http(s) URL through the unified
// remote cache and returns the stable local path.
func fetchRemoteFileTool(cache *media.RemoteFileCache, arguments map[string]any) (map[string]any, error) {
	rawURL := strings.TrimSpace(stringValue(arguments["url"]))
	result, err := cache.LocalPathFor(rawURL)
	if err != nil {
		return nil, err
	}
	return map[string]any{"path": result.Path, "contentType": result.ContentType, "size": result.Size, "contentHash": result.ContentHash, "cached": result.Cached, "url": rawURL}, nil
}
