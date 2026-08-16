/*
 * [INPUT]: 依赖标准库 HTTP 请求与 workspace.sqlite 的 workspace_preferences 键值表
 * [OUTPUT]: 对外提供 Locale 枚举、Accept-Language 探测与持久化语言偏好的读取
 * [POS]: service 的语言解析与持久化边界；HTTP 请求以 Accept-Language 为语言真相，
 * MCP/Agent guide 无请求头可用时回退到用户持久化的语言偏好
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http"
	"strings"
)

// Locale is the single language enumeration shared across Recut. The service
// keeps zh as its fallback default so existing Chinese copy and tests stay
// stable; callers that follow the RFC's URL-driven / preference-driven truth
// explicitly pass the resolved Locale.
type Locale string

const (
	LocaleZh            Locale = "zh"
	LocaleEn            Locale = "en"
	DefaultLocale       Locale = LocaleZh
	localePreferenceKey        = "locale"
)

// DetectLocale resolves the caller's language from Accept-Language: the first
// language tag starting with "zh" selects Chinese, everything else selects
// English, and an absent header falls back to the service default (zh).
func DetectLocale(r *http.Request) Locale {
	if r == nil {
		return DefaultLocale
	}
	return LocaleFromString(r.Header.Get("Accept-Language"))
}

// LocaleFromString maps a raw language string to a Locale: any "zh"-prefixed
// value becomes zh, everything else becomes en, and an absent or unparseable
// tag falls back to the service default.
func LocaleFromString(value string) Locale {
	tag := firstLanguageTag(value)
	if tag == "" {
		return DefaultLocale
	}
	if strings.HasPrefix(tag, "zh") {
		return LocaleZh
	}
	return LocaleEn
}

// firstLanguageTag parses the first language tag out of an Accept-Language
// header: it drops q-value weights and region/script suffixes (zh-CN -> zh).
func firstLanguageTag(header string) string {
	for _, part := range strings.Split(header, ",") {
		segment := strings.TrimSpace(part)
		if segment == "" {
			continue
		}
		tag := strings.TrimSpace(strings.SplitN(segment, ";", 2)[0])
		tag = strings.ToLower(tag)
		if base := strings.SplitN(tag, "-", 2)[0]; base != "" {
			return base
		}
	}
	return ""
}

// StoredLocale reads the persisted user language preference. It returns the
// service default when no preference has been saved.
func (s *Store) StoredLocale() (Locale, error) {
	if s == nil {
		return DefaultLocale, nil
	}
	return s.LocalePreference()
}
