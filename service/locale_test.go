/*
 * [INPUT]: 依赖 locale.go 的语言解析、preferences.go 的持久化偏好与 Server HTTP 路由
 * [OUTPUT]: 验证 Accept-Language 探测、LocaleFromString、/v1/preferences 的 GET/PUT 往返，
 * 以及 ctx.locale 从 InvokeAPI/InvokeMCP 的 locale 参数注入 background.js
 * [POS]: service 的 i18n 语言层回归测试（D7/D9/D10）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDetectLocaleParsesAcceptLanguage(t *testing.T) {
	for header, want := range map[string]Locale{
		"zh-CN,zh;q=0.9":       LocaleZh,
		"zh;q=0.9,en;q=0.8":    LocaleZh,
		"en-US,en;q=0.8":       LocaleEn,
		"en;q=0.8,zh-CN;q=0.7": LocaleEn,
		"fr-FR,fr;q=0.9":       LocaleEn,
		"":                     DefaultLocale,
	} {
		request := httptest.NewRequest(http.MethodGet, "/v1/apps", nil)
		request.Header.Set("Accept-Language", header)
		if got := DetectLocale(request); got != want {
			t.Fatalf("DetectLocale(%q) = %q, want %q", header, got, want)
		}
	}
	if DetectLocale(nil) != DefaultLocale {
		t.Fatalf("DetectLocale(nil) = %q, want %q", DetectLocale(nil), DefaultLocale)
	}
}

func TestLocaleFromStringMapsLanguageTags(t *testing.T) {
	for value, want := range map[string]Locale{
		"zh": LocaleZh, "zh-CN": LocaleZh, "ZH": LocaleZh, "zh-Hans": LocaleZh,
		"en": LocaleEn, "en-US": LocaleEn, "fr": LocaleEn, "": DefaultLocale,
	} {
		if got := LocaleFromString(value); got != want {
			t.Fatalf("LocaleFromString(%q) = %q, want %q", value, got, want)
		}
	}
}

func TestPreferencesHTTPRoundTrip(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(nil, store, nil, nil, nil, nil, nil).routes()

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /v1/preferences = %d: %s", recorder.Code, recorder.Body.String())
	}
	var initial map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &initial); err != nil {
		t.Fatal(err)
	}
	if initial["locale"] != string(DefaultLocale) {
		t.Fatalf("initial locale = %q, want %q", initial["locale"], DefaultLocale)
	}

	recorder = httptest.NewRecorder()
	put := httptest.NewRequest(http.MethodPut, "/v1/preferences", strings.NewReader(`{"locale":"en"}`))
	put.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recorder, put)
	if recorder.Code != http.StatusOK {
		t.Fatalf("PUT /v1/preferences = %d: %s", recorder.Code, recorder.Body.String())
	}
	var saved map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved["locale"] != "en" {
		t.Fatalf("saved locale = %q, want en", saved["locale"])
	}

	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/preferences", nil))
	var reread map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &reread); err != nil {
		t.Fatal(err)
	}
	if reread["locale"] != "en" {
		t.Fatalf("round-tripped locale = %q, want en", reread["locale"])
	}

	recorder = httptest.NewRecorder()
	bad := httptest.NewRequest(http.MethodPut, "/v1/preferences", strings.NewReader(`{"locale":"fr"}`))
	bad.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recorder, bad)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("PUT /v1/preferences invalid locale = %d, want 400", recorder.Code)
	}
}

func TestStoredLocalePreferencePersistence(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	if locale, err := store.StoredLocale(); err != nil || locale != DefaultLocale {
		t.Fatalf("default stored locale = %q, %v", locale, err)
	}
	if err := store.SaveLocalePreference(LocaleEn); err != nil {
		t.Fatal(err)
	}
	if locale, err := store.StoredLocale(); err != nil || locale != LocaleEn {
		t.Fatalf("stored locale = %q, %v; want en", locale, err)
	}
}

func TestInvokeAPILocaleInjectsCtxLocale(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite"],"operations":[{"name":"locale","description":"Report locale.","surfaces":["api","mcp"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("locale", function(input, ctx) { return { locale: ctx.locale }; });`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	target := Target{ProjectID: project.ID, AppID: "example.app"}

	en, err := host.InvokeAPILocale(target, "example.app", "locale", map[string]any{}, LocaleEn)
	if err != nil {
		t.Fatal(err)
	}
	if en.(map[string]any)["locale"] != "en" {
		t.Fatalf("InvokeAPILocale(en) locale = %#v", en)
	}
	zh, err := host.InvokeAPILocale(target, "example.app", "locale", map[string]any{}, LocaleZh)
	if err != nil {
		t.Fatal(err)
	}
	if zh.(map[string]any)["locale"] != "zh" {
		t.Fatalf("InvokeAPILocale(zh) locale = %#v", zh)
	}
	fallback, err := host.InvokeMCP(target, "example.app", "locale", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if fallback.(map[string]any)["locale"] != string(DefaultLocale) {
		t.Fatalf("InvokeMCP fallback locale = %#v", fallback)
	}
}

func TestManifestLocalizedForOverridesPerLocale(t *testing.T) {
	manifest := Manifest{
		Name:        "AI 短片",
		Description: "中文描述。",
		Onboarding:  []OnboardingGuide{{ID: "zh", Title: "中文", Prompt: "中文提示"}},
		Localized: map[string]ManifestLocalized{
			string(LocaleEn): {Name: "AI Short Films", Description: "English description.", Onboarding: []OnboardingGuide{{ID: "en", Title: "English", Prompt: "English prompt"}}},
		},
	}
	en := manifest.LocalizedFor(LocaleEn)
	if en.Name != "AI Short Films" || en.Description != "English description." || en.Onboarding[0].ID != "en" {
		t.Fatalf("en manifest = %#v", en)
	}
	zh := manifest.LocalizedFor(LocaleZh)
	if zh.Name != "AI 短片" || zh.Description != "中文描述。" || zh.Onboarding[0].ID != "zh" {
		t.Fatalf("zh manifest = %#v", zh)
	}
	noLocalized := Manifest{Name: "Plain", Description: "Plain."}
	if plain := noLocalized.LocalizedFor(LocaleEn); plain.Name != "Plain" || plain.Description != "Plain." {
		t.Fatalf("plain manifest = %#v", plain)
	}
}

func TestListAppsLocalizesManifestByAcceptLanguage(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"AI 短片","author":"Test","description":"中文描述。","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"localized":{"en":{"name":"AI Short Films","description":"English description."}}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(apps, store, nil, nil, nil, nil, nil).routes()

	zhRequest := httptest.NewRequest(http.MethodGet, "/v1/apps", nil)
	zhRequest.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	zhRecorder := httptest.NewRecorder()
	handler.ServeHTTP(zhRecorder, zhRequest)
	if zhRecorder.Code != http.StatusOK {
		t.Fatalf("GET /v1/apps (zh) = %d", zhRecorder.Code)
	}
	var zhApps []struct {
		Manifest struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(zhRecorder.Body.Bytes(), &zhApps); err != nil {
		t.Fatal(err)
	}
	if len(zhApps) != 1 || zhApps[0].Manifest.Name != "AI 短片" || zhApps[0].Manifest.Description != "中文描述。" {
		t.Fatalf("zh apps = %#v", zhApps)
	}

	enRequest := httptest.NewRequest(http.MethodGet, "/v1/apps", nil)
	enRequest.Header.Set("Accept-Language", "en-US,en;q=0.8")
	enRecorder := httptest.NewRecorder()
	handler.ServeHTTP(enRecorder, enRequest)
	var enApps []struct {
		Manifest struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(enRecorder.Body.Bytes(), &enApps); err != nil {
		t.Fatal(err)
	}
	if len(enApps) != 1 || enApps[0].Manifest.Name != "AI Short Films" || enApps[0].Manifest.Description != "English description." {
		t.Fatalf("en apps = %#v", enApps)
	}
}

func TestListInstalledLocalizesManifestByAcceptLanguage(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"AI 短片","author":"Test","description":"中文描述。","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"localized":{"en":{"name":"AI Short Films","description":"English description."}}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(apps, store, nil, nil, nil, nil, nil).routes()

	zhRequest := httptest.NewRequest(http.MethodGet, "/v1/apps/installed", nil)
	zhRequest.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	zhRecorder := httptest.NewRecorder()
	handler.ServeHTTP(zhRecorder, zhRequest)
	if zhRecorder.Code != http.StatusOK {
		t.Fatalf("GET /v1/apps/installed (zh) = %d", zhRecorder.Code)
	}
	var zhInstalled []struct {
		Manifest struct {
			Name string `json:"name"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(zhRecorder.Body.Bytes(), &zhInstalled); err != nil {
		t.Fatal(err)
	}
	if len(zhInstalled) != 1 || zhInstalled[0].Manifest.Name != "AI 短片" {
		t.Fatalf("zh installed = %#v", zhInstalled)
	}

	enRequest := httptest.NewRequest(http.MethodGet, "/v1/apps/installed", nil)
	enRequest.Header.Set("Accept-Language", "en-US,en;q=0.8")
	enRecorder := httptest.NewRecorder()
	handler.ServeHTTP(enRecorder, enRequest)
	var enInstalled []struct {
		Manifest struct {
			Name string `json:"name"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(enRecorder.Body.Bytes(), &enInstalled); err != nil {
		t.Fatal(err)
	}
	if len(enInstalled) != 1 || enInstalled[0].Manifest.Name != "AI Short Films" {
		t.Fatalf("en installed = %#v", enInstalled)
	}
}

func TestMCPDescriptionsLocalizeToolLevelCopy(t *testing.T) {
	for _, tool := range platformMCPToolDefinitions(LocaleEn) {
		if tool["name"] == "recut.context" {
			description := tool["description"].(string)
			if !strings.Contains(description, "Read the current Recut session context") {
				t.Fatalf("en recut.context description = %q", description)
			}
		}
		if tool["name"] == "recut.apps.list" {
			description := tool["description"].(string)
			if !strings.Contains(description, "List installed Apps") {
				t.Fatalf("en recut.apps.list description = %q", description)
			}
		}
	}
	for _, tool := range mediaMCPToolDefinitions(LocaleEn) {
		if tool["name"] == "recut.media.create_reference" {
			if !strings.Contains(tool["description"].(string), "Register a public link") {
				t.Fatalf("en recut.media.create_reference description = %q", tool["description"])
			}
		}
	}
	// The zh default keeps the original Chinese copy.
	for _, tool := range platformMCPToolDefinitions(DefaultLocale) {
		if tool["name"] == "recut.context" {
			if !strings.Contains(tool["description"].(string), "读取当前 Recut 会话上下文") {
				t.Fatalf("zh recut.context description = %q", tool["description"])
			}
		}
	}
}
