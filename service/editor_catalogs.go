/*
 * [INPUT]: 依赖标准库 encoding/json 与内嵌的效果/音频目录 JSON。
 * [OUTPUT]: library.browse 的随包回退目录（CDN 不可达时使用）。
 * [POS]: service 的 editor 内置数据；内置剪辑器不再携带 App 包，目录数据随二进制分发。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	_ "embed"
	"encoding/json"
)

//go:embed editor_catalogs/effects.json
var editorEffectsCatalogJSON []byte

//go:embed editor_catalogs/audio.json
var editorAudioCatalogJSON []byte

// editorShippedCatalog 解析随包目录；解析失败返回 nil，由调用方回退到内置最小集。
func editorShippedCatalog(raw []byte) map[string]any {
	var doc map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &doc) != nil {
		return nil
	}
	return doc
}
