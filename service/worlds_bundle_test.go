/*
 * [INPUT]: 依赖 WorldStore 的 export/import bundle 原语与既有 CreateWorld/UpsertEntity/relations/canvas API
 * [OUTPUT]: 验证 World 内容交换链路：export→import round-trip 保留 identity/skill/entities(attrs)/relations/canvas，
 *           素材按内容哈希去重复用同一 asset，导入世界为 origin=local 且画布 refId 命名空间化
 * [POS]: service 的 World bundle 交换测试（RFC world-content-format-v2 P3）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"strings"
	"testing"
)

func TestWorldBundleExportImportRoundTrip(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	created, err := worlds.CreateWorld(CreateWorldInput{
		Name: "Bundle World", Type: WorldCharacterIP, Description: "desc",
		Identity: map[string]any{"tone": "calm"},
	})
	if err != nil {
		t.Fatalf("create world: %v", err)
	}
	assetID := newTestAsset(t, media, "cover.png")

	hero, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: created.ID, TypeID: "character", Name: "Hero", Intro: "intro", Detail: "body",
		Attrs: []EntityAttr{
			{Key: "appearance", Label: "外貌", Type: "textarea", Value: "black"},
			{Key: "background", Label: "背景", Type: "media", Value: map[string]any{"assetId": assetID, "kind": "image", "name": "cover"}},
		},
	})
	if err != nil {
		t.Fatalf("upsert hero: %v", err)
	}
	rule, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: created.ID, TypeID: "rule", Name: "Rule",
		Attrs: []EntityAttr{{Key: "text", Label: "规则文本", Type: "textarea", Value: "always"}},
	})
	if err != nil {
		t.Fatalf("upsert rule: %v", err)
	}
	if _, err := worlds.CreateRelation(CreateRelationInput{WorldID: created.ID, FromEntityID: hero.ID, ToEntityID: rule.ID, RelationType: "references"}); err != nil {
		t.Fatalf("create relation: %v", err)
	}
	if _, err := worlds.SaveCanvasDocument(created.ID, "", []WorldCanvasElement{
		{ID: "shape:" + hero.ID, Kind: "entity", RefKind: "entity", RefID: hero.ID, Name: "Hero", Props: map[string]any{}, Geometry: map[string]any{"x": 10, "y": 20, "width": 100, "height": 100}},
		{ID: "shape:note-1", Kind: "note", Props: map[string]any{"text": "hi"}, Geometry: map[string]any{"x": 200, "y": 20}},
	}, 0); err != nil {
		t.Fatalf("save canvas: %v", err)
	}
	skill := "## skill body"
	if _, err := worlds.UpdateWorld(UpdateWorldInput{WorldID: created.ID, SkillMd: &skill}); err != nil {
		t.Fatalf("update skill: %v", err)
	}

	data, name, err := worlds.ExportWorldBundle(created.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if len(data) == 0 || name == "" {
		t.Fatalf("empty export name=%q bytes=%d", name, len(data))
	}

	imported, err := worlds.ImportWorldBundle(data, "Imported World", "test")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if imported.Origin != WorldLocal {
		t.Fatalf("imported origin = %q, want local", imported.Origin)
	}
	if imported.Name != "Imported World" || imported.SkillMd != skill {
		t.Fatalf("imported name=%q skill=%q", imported.Name, imported.SkillMd)
	}
	entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: imported.ID})
	if err != nil {
		t.Fatalf("list entities: %v", err)
	}
	if len(entities) != 2 {
		t.Fatalf("imported entities = %d, want 2", len(entities))
	}
	var importedHeroID string
	for _, entity := range entities {
		if entity.Name == "Hero" {
			importedHeroID = entity.ID
		}
	}
	if importedHeroID == "" {
		t.Fatal("imported hero not found")
	}
	importedHero, err := worlds.GetEntity(imported.ID, importedHeroID)
	if err != nil {
		t.Fatalf("get imported hero: %v", err)
	}
	if importedHero.Name != "Hero" || importedHero.Detail != "body" {
		t.Fatalf("hero projection drifted: %#v", importedHero)
	}
	var mediaAssetID string
	for _, attr := range importedHero.Attrs {
		if attr.Key == "background" {
			if value, ok := attr.Value.(map[string]any); ok {
				mediaAssetID, _ = value["assetId"].(string)
			}
		}
	}
	// Content-hash dedup: the imported media reuses the original asset row.
	if mediaAssetID != assetID {
		t.Fatalf("media asset = %q, want dedup to %q", mediaAssetID, assetID)
	}
	relations, err := worlds.ListRelations(imported.ID, importedHero.ID)
	if err != nil {
		t.Fatalf("list relations: %v", err)
	}
	if len(relations) != 1 || relations[0].Type != "references" {
		t.Fatalf("imported relations = %#v", relations)
	}
	doc, err := worlds.GetCanvasDocument(imported.ID, "")
	if err != nil {
		t.Fatalf("get canvas: %v", err)
	}
	if len(doc.Elements) != 2 {
		t.Fatalf("imported canvas elements = %d, want 2", len(doc.Elements))
	}
	sourceHeroID := strings.TrimPrefix(importedHero.ID, imported.ID+":")
	found := false
	for _, element := range doc.Elements {
		if element.ID != "shape:"+sourceHeroID {
			continue
		}
		found = true
		if element.RefID != importedHero.ID {
			t.Fatalf("canvas ref not namespaced: %q want %q", element.RefID, importedHero.ID)
		}
	}
	if !found {
		t.Fatalf("entity element %q missing from imported canvas", "shape:"+sourceHeroID)
	}
	// The import is independent: the source world never sees the imported entity id.
	if _, err := worlds.GetEntity(created.ID, importedHero.ID); err == nil {
		t.Fatal("imported entity leaked into the source world")
	}
}
