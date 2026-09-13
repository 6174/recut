/*
 * [INPUT]: 依赖 WorldStore 的 materialize/archive 原语、WorldCatalogSyncer（本地覆盖目录 + httptest 远端）、
 * 只读门禁、fork、brief 与 import_url
 * [OUTPUT]: 验证 RFC 2026-08-28 PGC Platform Worlds 的核心链路：manifest 校验与幂等物化、hash 不符拒物化、
 * published 条目自动同步跳过、delisted 归档与恢复、非 local 世界只读（WORLD_READ_ONLY 携带 fork 指引）、
 * fork 副本完整可编辑、brief 的 skill/body 内联与 revision 固定、import_url 的 SSRF 防护
 * [POS]: service 的平台 World 内容层测试；全部使用内存/临时 SQLite 与 httptest，不触达真实 CDN
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testManifest(id string, skill string) map[string]any {
	return map[string]any{
		"manifestVersion": 1,
		"world": map[string]any{
			"id":          id,
			"name":        "Test Platform World",
			"type":        "character_ip",
			"description": "desc",
			"skillMd":     skill,
			"identity":    map[string]any{"tone": "calm"},
		},
		"entities": []any{
			map[string]any{"id": "hero", "kind": "character", "title": "Hero", "summary": "s", "content": map[string]any{"appearance": "black", "body": "full body doc"}},
			map[string]any{"id": "rule-16-9", "kind": "rule", "title": "16:9", "content": map[string]any{"type": "always", "text": "16:9 only"}},
		},
		"evidence": []any{
			map[string]any{"entityId": "hero", "url": "https://cdn.example.test/worlds/" + id + "/examples/01.png", "modality": "image", "purpose": "appearance", "status": "supporting", "collection": "风格示例", "label": "one"},
		},
		"provenance": map[string]any{"author": "recut", "license": "MIT", "repository": "https://github.com/recut/test"},
	}
}

func marshalManifest(t *testing.T, manifest map[string]any) []byte {
	t.Helper()
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func materializeTest(t *testing.T, worlds *WorldStore, id string, manifest map[string]any) (string, bool) {
	t.Helper()
	data := marshalManifest(t, manifest)
	sum := sha256.Sum256(data)
	revisionID, changed, err := worlds.MaterializeWorld(id, WorldPlatform, "recut", "0.1.0", hex.EncodeToString(sum[:]), 1, data)
	if err != nil {
		t.Fatalf("materialize: %v", err)
	}
	return revisionID, changed
}

func strPtr(value string) *string { return &value }

func TestMaterializeIsIdempotentAndVersioned(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	const id = "pgc.test"
	first, changed := materializeTest(t, worlds, id, testManifest(id, "## workflow"))
	if !changed || first == "" {
		t.Fatalf("first materialize changed=%v revision=%q", changed, first)
	}
	// 同 manifest 再次同步：零写入、零新 revision（no-op 返回空 revision）。
	second, changed := materializeTest(t, worlds, id, testManifest(id, "## workflow"))
	if changed || second != "" {
		t.Fatalf("repeat materialize changed=%v revision=%q want no-op", changed, second)
	}
	// 内容变化：恰好一个新 revision。
	third, changed := materializeTest(t, worlds, id, testManifest(id, "## workflow v2"))
	if !changed || third == first {
		t.Fatalf("updated materialize changed=%v revision=%q want new", changed, third)
	}
	detail, err := worlds.GetWorld(id)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Origin != WorldPlatform || detail.SkillMd != "## workflow v2" {
		t.Fatalf("origin=%q skillMd=%q", detail.Origin, detail.SkillMd)
	}
}

func TestMaterializeRefusesHashMismatchAndInvalidManifests(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	data := marshalManifest(t, testManifest("pgc.bad", ""))
	if _, _, err := worlds.MaterializeWorld("pgc.bad", WorldPlatform, "recut", "0.1.0", strings.Repeat("0", 64), 1, data); err == nil {
		t.Fatal("hash mismatch must be refused")
	}
	// 非 pgc. 前缀 ID 拒绝。
	if _, _, err := worlds.MaterializeWorld("local-thing", WorldPlatform, "recut", "0.1.0", strings.Repeat("0", 64), 1, data); err == nil {
		t.Fatal("non-pgc id must be refused")
	}
	// skillMd 预算超限拒绝。
	big := marshalManifest(t, testManifest("pgc.big", strings.Repeat("x", skillMdMaxBytes+1)))
	sum := sha256.Sum256(big)
	if _, _, err := worlds.MaterializeWorld("pgc.big", WorldPlatform, "recut", "0.1.0", hex.EncodeToString(sum[:]), 1, big); err == nil {
		t.Fatal("oversized skillMd must be refused")
	}
	// 重复 (entity,url,role) 证据三元组拒绝。
	dup := testManifest("pgc.dup", "")
	dup["evidence"] = []any{
		map[string]any{"entityId": "hero", "url": "https://cdn.example.test/a.png", "modality": "image", "purpose": "appearance", "status": "supporting"},
		map[string]any{"entityId": "hero", "url": "https://cdn.example.test/a.png", "modality": "image", "purpose": "appearance", "status": "supporting", "label": "two"},
	}
	dupData := marshalManifest(t, dup)
	dupSum := sha256.Sum256(dupData)
	if _, _, err := worlds.MaterializeWorld("pgc.dup", WorldPlatform, "recut", "0.1.0", hex.EncodeToString(dupSum[:]), 1, dupData); err == nil {
		t.Fatal("duplicate evidence triple must be refused")
	}
	// local 世界不可被 catalog 覆盖。
	local, _, _ := newTestWorldStore(t)
	created, err := local.CreateWorld(CreateWorldInput{Name: "Mine", Type: WorldCharacterIP})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := local.MaterializeWorld(created.ID, WorldPlatform, "recut", "0.1.0", strings.Repeat("0", 64), 1, data); err == nil {
		t.Fatal("catalog must never overwrite a local world")
	}
}

func TestNonLocalWorldIsReadOnlyWithForkHint(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	const id = "pgc.readonly"
	materializeTest(t, worlds, id, testManifest(id, "skill"))
	assetID := newTestAsset(t, media, "sample")

	assertReadOnly := func(err error, what string) {
		t.Helper()
		var worldErr *WorldsError
		if !errors.As(err, &worldErr) || worldErr.Code != WorldsErrReadOnly {
			t.Fatalf("%s: expected WORLD_READ_ONLY, got %v", what, err)
		}
		if worldErr.Details["forkOperation"] != "recut.worlds.fork" {
			t.Fatalf("%s: fork hint missing: %#v", what, worldErr.Details)
		}
	}
	_, err := worlds.UpdateWorld(UpdateWorldInput{WorldID: id, Name: strPtr("renamed")})
	assertReadOnly(err, "update world")
	_, err = worlds.UpsertEntity(UpsertEntityInput{WorldID: id, TypeID: "character", Name: "New"})
	assertReadOnly(err, "upsert entity")
	// Evidence writes are frozen (统一实体模型): the frozen error wins over
	// the read-only gate, so the attach surfaces the migration hint instead.
	_, err = worlds.AttachReference(AttachReferenceInput{WorldID: id, AssetID: assetID, Role: "evidence:visual_style"})
	var frozen *WorldsError
	if !errors.As(err, &frozen) || frozen.Code != WorldsErrContextInvalid {
		t.Fatalf("frozen evidence write: expected WORLD_CONTEXT_INVALID, got %v", err)
	}
	_ = assetID
	_, err = worlds.UpdateWorld(UpdateWorldInput{WorldID: id, SkillMd: strPtr("edited")})
	assertReadOnly(err, "skill md")
	// 只读不限制读取与解析。
	if _, err := worlds.GetWorld(id); err != nil {
		t.Fatalf("get world: %v", err)
	}
	if _, err := worlds.Brief(BriefInput{WorldID: id}); err != nil {
		t.Fatalf("brief: %v", err)
	}
}

func TestForkCopiesAndDetachesFromUpstream(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	const id = "pgc.forksrc"
	materializeTest(t, worlds, id, testManifest(id, "## fork skill"))
	forked, err := worlds.ForkWorld(ForkWorldInput{WorldID: id})
	if err != nil {
		t.Fatal(err)
	}
	if forked.Origin != WorldLocal {
		t.Fatalf("fork origin = %q", forked.Origin)
	}
	if forked.OriginMeta == nil || forked.OriginMeta.ForkedFrom == nil || forked.OriginMeta.ForkedFrom.WorldID != id {
		t.Fatalf("forkedFrom missing: %#v", forked.OriginMeta)
	}
	if forked.SkillMd != "## fork skill" {
		t.Fatalf("skillMd not copied: %q", forked.SkillMd)
	}
	entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: forked.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 2 {
		t.Fatalf("entities = %d", len(entities))
	}
	// Fork 副本可编辑（含世界技能）。
	if _, err := worlds.UpdateWorld(UpdateWorldInput{WorldID: forked.ID, SkillMd: strPtr("edited")}); err != nil {
		t.Fatalf("fork edit: %v", err)
	}
	// 上游更新不传播到 fork。
	materializeTest(t, worlds, id, testManifest(id, "upstream v2"))
	after, err := worlds.GetWorld(forked.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.SkillMd != "edited" {
		t.Fatalf("upstream leaked into fork: %q", after.SkillMd)
	}
}

func TestBriefInlinesSkillBodyAndPinsRevision(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	const id = "pgc.brief"
	rev1, _ := materializeTest(t, worlds, id, testManifest(id, "## brief skill"))
	brief, err := worlds.Brief(BriefInput{WorldID: id})
	if err != nil {
		t.Fatal(err)
	}
	if brief.Skill != "## brief skill" {
		t.Fatalf("skill not inlined: %q", brief.Skill)
	}
	if len(brief.Facts.Characters) != 1 {
		t.Fatalf("characters = %d", len(brief.Facts.Characters))
	}
	if brief.Facts.Characters[0]["detail"] != "full body doc" {
		t.Fatalf("detail not inlined: %#v", brief.Facts.Characters[0])
	}
	if len(brief.Constraints.Always) != 1 || brief.Constraints.Always[0] != "16:9 only" {
		t.Fatalf("constraints = %#v", brief.Constraints)
	}
	if len(brief.Evidence) != 1 || brief.Evidence[0].Source != EvidenceSourceURL || brief.Evidence[0].URL == "" {
		t.Fatalf("evidence = %#v", brief.Evidence)
	}
	// 后续更新不改旧 revision 的 brief。
	materializeTest(t, worlds, id, testManifest(id, "## brief skill v2"))
	oldBrief, err := worlds.Brief(BriefInput{WorldID: id, RevisionID: rev1})
	if err != nil {
		t.Fatal(err)
	}
	if oldBrief.Skill != "## brief skill" {
		t.Fatalf("old revision brief drifted: %q", oldBrief.Skill)
	}
	newBrief, err := worlds.Brief(BriefInput{WorldID: id})
	if err != nil {
		t.Fatal(err)
	}
	if newBrief.Skill != "## brief skill v2" {
		t.Fatalf("new brief = %q", newBrief.Skill)
	}
}

func catalogEntry(id, kind, version, sha string, status string, base string) map[string]any {
	return map[string]any{"id": id, "kind": kind, "publisher": "recut", "version": version, "manifestUrl": base + "/" + id + "/world.json", "sha256": sha, "status": status, "order": 1}
}

func TestMaterializeNamespacesEntityIDsAcrossWorlds(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	// 两个平台世界使用相同的通用实体/关系 ID：全局主键下必须互不碰撞。
	manifest := testManifest("pgc.one", "")
	manifest["relations"] = []any{
		map[string]any{"id": "rel-main", "type": "uses", "from": "hero", "to": "rule-16-9"},
	}
	materializeTest(t, worlds, "pgc.one", manifest)
	other := testManifest("pgc.two", "")
	other["relations"] = []any{
		map[string]any{"id": "rel-main", "type": "uses", "from": "hero", "to": "rule-16-9"},
	}
	materializeTest(t, worlds, "pgc.two", other)
	for _, id := range []string{"pgc.one", "pgc.two"} {
		entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: id})
		if err != nil {
			t.Fatal(err)
		}
		if len(entities) != 2 {
			t.Fatalf("%s entities = %d, want 2", id, len(entities))
		}
		brief, err := worlds.Brief(BriefInput{WorldID: id})
		if err != nil {
			t.Fatalf("%s brief: %v", id, err)
		}
		if len(brief.Facts.Characters) != 1 || brief.Facts.Characters[0]["detail"] != "full body doc" {
			t.Fatalf("%s character facts drifted: %#v", id, brief.Facts.Characters)
		}
	}
	// 同一世界内容更新（全量替换含归档行）依然幂等推进。
	updated := testManifest("pgc.one", "v2")
	materializeTest(t, worlds, "pgc.one", updated)
}

func TestCatalogSyncerMaterializesSkipsPublishedAndArchivesDelisted(t *testing.T) {
	worlds, store, _ := newTestWorldStore(t)
	active := marshalManifest(t, testManifest("pgc.sync", "synced"))
	sum := sha256.Sum256(active)
	published := marshalManifest(t, testManifest("pub.skip", "published"))
	pubSum := sha256.Sum256(published)
	catalog := map[string]any{
		"catalogVersion": 1,
		"worlds":         []any{},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/catalog.json":
			_ = json.NewEncoder(w).Encode(catalog)
		case "/pgc.sync/world.json":
			_, _ = w.Write(active)
		case "/pub.skip/world.json":
			_, _ = w.Write(published)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	catalog["worlds"] = []any{
		catalogEntry("pgc.sync", WorldPlatform, "0.1.0", hex.EncodeToString(sum[:]), "active", server.URL),
		catalogEntry("pub.skip", WorldPublished, "1.0.0", hex.EncodeToString(pubSum[:]), "active", server.URL),
	}
	t.Setenv("RECUT_WORLD_CATALOG_URL", server.URL+"/catalog.json")
	syncer := NewWorldCatalogSyncer(store.root, worlds)

	syncer.Sync()
	if _, err := worlds.GetWorld("pgc.sync"); err != nil {
		t.Fatalf("platform world not materialized: %v", err)
	}
	if _, err := worlds.GetWorld("pub.skip"); err == nil {
		t.Fatal("published entry must be skipped by auto sync")
	}

	// 下架：目录 delisted → 本地归档（列表不再出现）。
	catalog["worlds"] = []any{catalogEntry("pgc.sync", WorldPlatform, "0.1.0", hex.EncodeToString(sum[:]), "delisted", server.URL)}
	syncer.Sync()
	if listContains(worlds, t, "pgc.sync") {
		t.Fatal("delisted world must not appear in list")
	}

	// 恢复 active → 去归档，重新出现在列表。
	catalog["worlds"] = []any{catalogEntry("pgc.sync", WorldPlatform, "0.2.0", hex.EncodeToString(sum[:]), "active", server.URL)}
	syncer.Sync()
	if !listContains(worlds, t, "pgc.sync") {
		t.Fatal("reactivated world must appear in list again")
	}

	// 篡改（目录 hash 与实际字节不符）→ 拒物化，本地内容不变。
	catalog["worlds"] = []any{catalogEntry("pgc.sync", WorldPlatform, "0.3.0", strings.Repeat("a", 64), "active", server.URL)}
	syncer.Sync()
	tampered, err := worlds.GetWorld("pgc.sync")
	if err != nil {
		t.Fatal(err)
	}
	if tampered.SkillMd != "synced" {
		t.Fatalf("tampered manifest changed local content: %q", tampered.SkillMd)
	}
}

func listContains(worlds *WorldStore, t *testing.T, id string) bool {
	t.Helper()
	items, _, err := worlds.ListWorlds(ListWorldsInput{})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func TestImportMediaURLRejectsPrivateAndNonMedia(t *testing.T) {
	_, _, media := newTestWorldStore(t)
	private := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("png"))
	}))
	defer private.Close()
	// httptest 监听 127.0.0.1（回环）：SSRF 防护必须拒绝。
	if _, err := importMediaURL(media, map[string]any{"url": private.URL + "/x.png"}); err == nil {
		t.Fatal("loopback URL must be refused")
	}
	if _, err := importMediaURL(media, map[string]any{"url": "http://169.254.169.254/latest/meta-data"}); err == nil {
		t.Fatal("link-local metadata address must be refused")
	}
	if _, err := importMediaURL(media, map[string]any{"url": "not a url"}); err == nil {
		t.Fatal("invalid URL must be refused")
	}
	if _, err := importMediaURL(media, map[string]any{"url": "http://user:pass@internal/x.png"}); err == nil {
		t.Fatal("unresolvable/internal host must be refused")
	}
}

// testManifestV2 builds a unified-content manifest (RFC world-content-format-v2):
// entity types + entities with media attrs + relations + a canvas document.
func testManifestV2(id string) map[string]any {
	return map[string]any{
		"manifestVersion": 2,
		"world": map[string]any{
			"id": id, "name": "V2 World", "type": "character_ip",
			"description": "desc", "skillMd": "## v2 skill", "identity": map[string]any{"tone": "calm"},
		},
		"entityTypes": []any{
			map[string]any{
				"id": "mecha", "scope": "custom", "name": "机甲", "baseKind": "object",
				"fields": []any{map[string]any{"key": "energy", "label": "能源", "type": "text"}},
			},
		},
		"entities": []any{
			map[string]any{
				"id": "hero", "typeId": "character", "name": "Hero", "intro": "intro", "detail": "full body",
				"attrs": []any{
					map[string]any{"key": "appearance", "label": "外貌与标志", "type": "textarea", "value": "black"},
					map[string]any{"key": "background", "label": "背景", "type": "media", "value": map[string]any{"url": "https://cdn.example.test/a.png", "kind": "image"}},
				},
			},
			map[string]any{
				"id": "mech", "typeId": "mecha", "name": "Mech",
				"attrs": []any{map[string]any{"key": "energy", "label": "能源", "type": "text", "value": "nuclear"}},
			},
		},
		"relations": []any{
			map[string]any{"id": "r1", "type": "appears_in", "from": "hero", "to": "mech"},
		},
		"canvases": []any{
			map[string]any{
				"contextId": "",
				"elements": []any{
					map[string]any{"id": "shape:hero", "kind": "entity", "refKind": "entity", "refId": "hero", "name": "Hero", "props": map[string]any{"collapsed": false}, "geometry": map[string]any{"x": 10, "y": 20, "width": 100, "height": 100}, "style": map[string]any{}, "layer": "0"},
					map[string]any{"id": "shape:note-1", "kind": "note", "props": map[string]any{"text": "hi"}, "geometry": map[string]any{"x": 200, "y": 20}},
					map[string]any{"id": "shape:arrow-1", "kind": "arrow", "props": map[string]any{"fromElementId": "shape:hero", "toElementId": "shape:note-1"}},
				},
			},
		},
		"provenance": map[string]any{"author": "recut", "license": "MIT", "repository": "https://github.com/recut/test"},
	}
}

func TestMaterializeV2UnifiedEntitiesAndCanvas(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	const id = "pgc.v2x"
	rev, changed := materializeTest(t, worlds, id, testManifestV2(id))
	if !changed || rev == "" {
		t.Fatalf("v2 materialize changed=%v rev=%q", changed, rev)
	}
	// Unified entities land with namespaced ids.
	entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: id})
	if err != nil {
		t.Fatal(err)
	}
	if len(entities) != 2 {
		t.Fatalf("entities = %d, want 2", len(entities))
	}
	hero, err := worlds.GetEntity(id, id+":hero")
	if err != nil {
		t.Fatal(err)
	}
	if hero.TypeID != "character" || hero.Name != "Hero" || hero.Detail != "full body" {
		t.Fatalf("hero projection drifted: %#v", hero)
	}
	var mediaURL string
	for _, attr := range hero.Attrs {
		if attr.Key == "background" {
			if value, ok := attr.Value.(map[string]any); ok {
				mediaURL, _ = value["url"].(string)
			}
		}
	}
	if mediaURL != "https://cdn.example.test/a.png" {
		t.Fatalf("media attr url not preserved: %q (attrs=%#v)", mediaURL, hero.Attrs)
	}
	// Custom type directory row lands.
	types, err := worlds.ListEntityTypes(id)
	if err != nil {
		t.Fatal(err)
	}
	foundMecha := false
	for _, entityType := range types {
		if entityType.ID == "mecha" && entityType.Scope == "custom" {
			foundMecha = true
		}
	}
	if !foundMecha {
		t.Fatalf("custom type mecha missing: %#v", types)
	}
	// Canvas document materialized with namespaced entity ref.
	doc, err := worlds.GetCanvasDocument(id, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Elements) != 3 {
		t.Fatalf("canvas elements = %d, want 3", len(doc.Elements))
	}
	for _, element := range doc.Elements {
		if element.ID == "shape:hero" && element.RefID != id+":hero" {
			t.Fatalf("canvas entity ref not namespaced: %q", element.RefID)
		}
	}
	// Idempotent: same manifest → no writes.
	if _, changed := materializeTest(t, worlds, id, testManifestV2(id)); changed {
		t.Fatal("repeat v2 materialize must be a no-op")
	}
	// Only-layout change produces a new revision but keeps the canvas fresh.
	updated := testManifestV2(id)
	updated["canvases"].([]any)[0].(map[string]any)["elements"].([]any)[0].(map[string]any)["geometry"] = map[string]any{"x": 999, "y": 20, "width": 100, "height": 100}
	if _, changed := materializeTest(t, worlds, id, updated); !changed {
		t.Fatal("canvas change must still re-materialize (new revision)")
	}
	doc, err = worlds.GetCanvasDocument(id, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, element := range doc.Elements {
		if element.ID == "shape:hero" && numberValue(element.Geometry["x"]) != 999 {
			t.Fatalf("canvas layout did not persist: %#v", element.Geometry)
		}
	}
}

func numberValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		return 0
	}
}

// TestEmbeddedSeedManifestsMaterialize guards the shipped seed content: every
// embedded platform manifest must pass the v2 validator and materialize into a
// clean store. It catches source-format drift between the publish script and the
// materializer at test time instead of at first daemon start.
func TestEmbeddedSeedManifestsMaterialize(t *testing.T) {
	entries, err := fs.ReadDir(embeddedWorldCatalogFS, "worldcatalog")
	if err != nil {
		t.Fatalf("read embedded worldcatalog: %v", err)
	}
	found := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		versions, err := fs.ReadDir(embeddedWorldCatalogFS, "worldcatalog/"+entry.Name())
		if err != nil {
			t.Fatalf("read seed world %s: %v", entry.Name(), err)
		}
		for _, version := range versions {
			if !version.IsDir() {
				continue
			}
			rel := "worldcatalog/" + entry.Name() + "/" + version.Name() + "/world.json"
			data, err := fs.ReadFile(embeddedWorldCatalogFS, rel)
			if err != nil {
				continue
			}
			worlds, _, _ := newTestWorldStore(t)
			sum := sha256.Sum256(data)
			if _, _, err := worlds.MaterializeWorld(entry.Name(), WorldPlatform, "recut", version.Name(), hex.EncodeToString(sum[:]), 1, data); err != nil {
				t.Fatalf("embedded manifest %s is invalid: %v", rel, err)
			}
			found++
		}
	}
	if found == 0 {
		t.Fatal("no embedded world manifests found")
	}
}
