/*
 * [INPUT]: 无。
 * [OUTPUT]: motion_graphic 包内通用的 any → string/number/slice/map 归一化助手。
 * [POS]: 包的内部工具；不导出领域语义。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import "strings"

func str(v any) string {
	s, _ := v.(string)
	return s
}

func fallback(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func number(v any) float64 {
	switch typed := v.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case interface{ Float64() (float64, error) }:
		f, _ := typed.Float64()
		return f
	}
	return 0
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}

func boolInput(v any) bool {
	b, _ := v.(bool)
	return b
}
