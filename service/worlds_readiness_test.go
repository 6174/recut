/*
 * [INPUT]: 依赖 WorldStore、Store、MediaService 与临时工作区
 * [OUTPUT]: 验证 Readiness 就绪度投影：空世界 skeleton、部分补全 draft、蓝图齐备 ready、
 * 空壳实体忽略规则、scenarioId 覆盖与类型默认蓝图、brief.missing 与 readiness 同源、HTTP 端点
 * [POS]: service 的 Onboarding 度量层回归测试；不调用真实模型提供商，全部使用内存/临时 SQLite
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadinessEmptyWorldIsSkeleton(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Empty", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	readiness, err := worlds.Readiness(world.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if readiness.Level != ReadinessSkeleton {
		t.Fatalf("empty world level = %q, want skeleton", readiness.Level)
	}
	if readiness.ScenarioID != ScenarioNovelAdaptation {
		t.Fatalf("fiction default scenario = %q, want novel-adaptation", readiness.ScenarioID)
	}
	if readiness.Score != 0 {
		t.Fatalf("skeleton score = %d, want 0", readiness.Score)
	}
	if len(readiness.Missing) == 0 {
		t.Fatal("skeleton world must report missing items")
	}
	if readiness.Missing[0].Kind != "entity" {
		t.Fatalf("first missing kind = %q, want entity", readiness.Missing[0].Kind)
	}
}

func TestReadinessProgressesToDraftThenReady(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Novel", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	// Character with all blueprint fields → field gaps disappear, level draft.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, Kind: EntityCharacter, Title: "叶文洁",
		Content: map[string]any{"appearance": "银发", "personality": "冷静", "voice": "低缓"},
	}); err != nil {
		t.Fatal(err)
	}
	readiness, err := worlds.Readiness(world.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if readiness.Level != ReadinessDraft {
		t.Fatalf("one full character level = %q, want draft", readiness.Level)
	}
	if readiness.Score <= 0 || readiness.Score >= 100 {
		t.Fatalf("draft score = %d, want in (0,100)", readiness.Score)
	}
	// Story + location complete the entity expectations.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, Kind: EntityStory, Title: "红岸", Content: map[string]any{"premise": "红岸基地的来信"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, Kind: EntityLocation, Title: "雷达峰", Content: map[string]any{"description": "大兴安岭雷达峰"},
	}); err != nil {
		t.Fatal(err)
	}
	readiness, err = worlds.Readiness(world.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if readiness.Level != ReadinessReady {
		t.Fatalf("complete novel blueprint level = %q, missing = %#v", readiness.Level, readiness.Missing)
	}
	for _, item := range readiness.Missing {
		if item.Kind != "identity" {
			t.Fatalf("ready world still reports blocking gap %#v", item)
		}
	}
}

func TestReadinessIgnoresLegacyShellEntities(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Shell", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	// A legacy template shell: title exists, every registered field empty.
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, Kind: EntityCharacter, Title: "主角角色",
		Content: map[string]any{"appearance": "", "personality": "", "voice": ""},
	}); err != nil {
		t.Fatal(err)
	}
	readiness, err := worlds.Readiness(world.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if readiness.Level != ReadinessSkeleton {
		t.Fatalf("shell-only world level = %q, want skeleton (shells are ignored)", readiness.Level)
	}
	// But a shell does not satisfy character expectations either: the entity
	// gap must still be reported.
	found := false
	for _, item := range readiness.Missing {
		if item.ID == "entity.character" {
			found = true
		}
	}
	if !found {
		t.Fatal("shell-only world must still report the character entity gap")
	}
}

func TestReadinessScenarioOverrideAndEvidenceExpectation(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Style", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	readiness, err := worlds.Readiness(world.ID, ScenarioBlank)
	if err != nil {
		t.Fatal(err)
	}
	if readiness.ScenarioID != ScenarioBlank {
		t.Fatalf("override scenario = %q", readiness.ScenarioID)
	}
	// Blank + one substantive entity → ready (blank expects nothing else).
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, Kind: EntityRule, Title: "核心规则", Content: map[string]any{"type": "always", "text": "黑白为主"},
	}); err != nil {
		t.Fatal(err)
	}
	readiness, err = worlds.Readiness(world.ID, ScenarioBlank)
	if err != nil {
		t.Fatal(err)
	}
	if readiness.Level != ReadinessReady {
		t.Fatalf("blank + one rule level = %q, missing = %#v", readiness.Level, readiness.Missing)
	}
	// Unknown scenario IDs fall back to the type default, never poison.
	readiness, err = worlds.Readiness(world.ID, "nonsense")
	if err != nil {
		t.Fatal(err)
	}
	if readiness.ScenarioID != ScenarioStyleSystem {
		t.Fatalf("unknown scenario resolved to %q, want style-system", readiness.ScenarioID)
	}
	// style-system expects evidence: attach images and the gap closes.
	assetID := newTestAsset(t, media, "example.png")
	if _, err := worlds.AttachReference(AttachReferenceInput{
		WorldID: world.ID, AssetID: assetID, Role: "style_reference", Purpose: "visual_style", Status: "supporting",
	}); err != nil {
		t.Fatal(err)
	}
	readiness, err = worlds.Readiness(world.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	evidenceMissing := false
	for _, item := range readiness.Missing {
		if item.Kind == "evidence" {
			evidenceMissing = true
		}
	}
	if !evidenceMissing {
		t.Fatal("style-system with 1/3 images must still report evidence gap")
	}
}

func TestBriefMissingMatchesReadiness(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Sync", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, Kind: EntityCharacter, Title: "Mina",
		Content: map[string]any{"appearance": "短发", "personality": "克制", "voice": "平稳"},
	}); err != nil {
		t.Fatal(err)
	}
	brief, err := worlds.Brief(BriefInput{WorldID: world.ID, Selection: WorldSelection{Purpose: "agent"}})
	if err != nil {
		t.Fatal(err)
	}
	readiness, err := worlds.Readiness(world.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(brief.Missing) != len(readiness.Missing) {
		t.Fatalf("brief missing %d items, readiness missing %d items", len(brief.Missing), len(readiness.Missing))
	}
	for index := range brief.Missing {
		if brief.Missing[index].ID != readiness.Missing[index].ID {
			t.Fatalf("missing[%d] id mismatch: brief=%q readiness=%q", index, brief.Missing[index].ID, readiness.Missing[index].ID)
		}
	}
}

func TestWorldReadinessHTTP(t *testing.T) {
	worlds, store, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "HTTP", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(nil, store, nil, nil, nil, nil, nil)
	recorder := httptest.NewRecorder()
	server.routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/worlds/"+world.ID+"/readiness", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("readiness status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	body := map[string]any{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["level"] != ReadinessSkeleton {
		t.Fatalf("http readiness level = %v", body["level"])
	}
	if body["scenarioId"] != ScenarioNovelAdaptation {
		t.Fatalf("http readiness scenario = %v", body["scenarioId"])
	}
	// Scenario override travels through the query string.
	recorder = httptest.NewRecorder()
	server.routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/worlds/"+world.ID+"/readiness?scenario=blank", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("override status = %d", recorder.Code)
	}
	body = map[string]any{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["scenarioId"] != ScenarioBlank {
		t.Fatalf("override scenario = %v", body["scenarioId"])
	}
	// Unknown world → structured 404.
	recorder = httptest.NewRecorder()
	server.routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/worlds/nope/readiness", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("missing world status = %d", recorder.Code)
	}
}
