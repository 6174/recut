/*
 * [INPUT]: 依赖 WorldStore 的 export/import bundle 原语与既有 CreateWorld/UpsertEntity/relations/canvas API
 * [OUTPUT]: 验证 World 内容交换链路：export→import round-trip 保留 identity/skill/entities(attrs)/relations/canvas，
 *           素材按内容哈希去重复用同一 asset，导入世界为 origin=local 且画布 refId 命名空间化
 * [POS]: service 的 World bundle 交换测试（RFC world-content-format-v2 P3）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
)

// wrapZip re-packs a bundle under a top-level folder and adds macOS junk,
// mimicking `zip -r slug.zip slug/` on a Mac.
func wrapZip(t *testing.T, data []byte, folder string) []byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	buffer := &bytes.Buffer{}
	writer := zip.NewWriter(buffer)
	write := func(name string, content []byte) {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range reader.File {
		handle, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(handle)
		handle.Close()
		if err != nil {
			t.Fatal(err)
		}
		write(folder+"/"+file.Name, content)
	}
	write("__MACOSX/._"+folder, []byte("junk"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestWorldBundleImportSourceLayout(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	files := map[string]string{
		"world.json":         `{"sourceVersion":2,"world":{"id":"pgc.test","name":"Source Layout","type":"character_ip","description":"d","identity":{"tone":"calm"}},"entityTypes":[],"relations":[],"provenance":{"author":"a","license":"MIT","repository":"https://example.test"}}`,
		"world.md":           "## skill body",
		"entities/hero.json": `{"id":"hero","typeId":"character","name":"Hero","intro":"i","detail":{"$file":"../references/hero.md"},"attrs":[{"key":"background","label":"背景","type":"media","value":{"asset":"cover","kind":"image","name":"封面"}}]}`,
		"references/hero.md": "the full long body",
		"assets/cover.json":  `{"id":"cover","name":"封面","kind":"image","file":"../examples/cover.png"}`,
		"examples/cover.png": "\x89PNG\r\n\x1a\nfake-bytes",
	}
	imported, err := worlds.ImportWorldBundle(zipFromMap(t, files), "", "test")
	if err != nil {
		t.Fatalf("import source layout: %v", err)
	}
	if imported.SkillMd != "## skill body" {
		t.Fatalf("skill = %q", imported.SkillMd)
	}
	entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: imported.ID})
	if err != nil || len(entities) != 1 {
		t.Fatalf("entities = %#v err=%v", entities, err)
	}
	hero, err := worlds.GetEntity(imported.ID, entities[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if hero.Detail != "the full long body" {
		t.Fatalf("detail $file not resolved: %q", hero.Detail)
	}
	var assetID string
	for _, attr := range hero.Attrs {
		if attr.Key == "background" {
			if value, ok := attr.Value.(map[string]any); ok {
				assetID, _ = value["assetId"].(string)
			}
		}
	}
	if assetID == "" {
		t.Fatalf("media attr not mapped to an asset: %#v", hero.Attrs)
	}
	if _, err := media.GetAsset(assetID); err != nil {
		t.Fatalf("imported asset missing: %v", err)
	}
}

func zipFromMap(t *testing.T, files map[string]string) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	writer := zip.NewWriter(buffer)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestWorldBundleImportAcceptsWrappedZip(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	created, err := worlds.CreateWorld(CreateWorldInput{Name: "Wrapped", Type: WorldCustom})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: created.ID, TypeID: "character", Name: "Hero"}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	data, _, err := worlds.ExportWorldBundle(created.ID)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	// Flat zip imports fine; wrapped zip (top-level folder) must too.
	for _, wrapped := range [][]byte{data, wrapZip(t, data, "wrapped")} {
		imported, err := worlds.ImportWorldBundle(wrapped, "Wrapped Import", "test")
		if err != nil {
			t.Fatalf("import wrapped: %v", err)
		}
		entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: imported.ID})
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if len(entities) != 1 || entities[0].Name != "Hero" {
			t.Fatalf("imported entities = %#v", entities)
		}
	}
}

// TestWorldBundleExportSkipsUnmaterializedAsset guards the regression where a
// world referencing a not-yet-generated proposal (no local bytes) failed the
// whole export. Media attrs and canvas elements accept proposed/queued assets
// by design, so export must degrade gracefully: the non-portable assetId is
// dropped and the bundle still round-trips.
func TestWorldBundleExportSkipsUnmaterializedAsset(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	credential, err := media.SaveCredential(MediaCredential{Provider: "skymind-token", Name: "Skymind", APIBase: "http://127.0.0.1:1"}, "skymind-key")
	if err != nil {
		t.Fatal(err)
	}
	proposal, err := media.Propose(ProposeInput{Capability: VideoGenerate, ModelID: testVideoModelID, CredentialID: credential.ID, Prompt: "做梦坐飞机"})
	if err != nil {
		t.Fatal(err)
	}
	if proposal.Status != AssetStatusProposed {
		t.Fatalf("proposal status = %q", proposal.Status)
	}

	created, err := worlds.CreateWorld(CreateWorldInput{Name: "Proposal World", Type: WorldCustom})
	if err != nil {
		t.Fatalf("create world: %v", err)
	}
	if _, err := worlds.SaveCanvasDocument(created.ID, "", []WorldCanvasElement{
		{ID: "shape:media-1", Kind: "media", Props: map[string]any{"assetId": proposal.ID, "modality": "video", "assetStatus": "generating"}},
	}, 0); err != nil {
		t.Fatalf("save canvas: %v", err)
	}
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: created.ID, TypeID: "character", Name: "Hero",
		Attrs: []EntityAttr{{Key: "clip", Label: "片段", Type: "media", Value: map[string]any{"assetId": proposal.ID, "kind": "video"}}},
	}); err != nil {
		t.Fatalf("upsert entity with proposal media attr: %v", err)
	}

	data, name, err := worlds.ExportWorldBundle(created.ID)
	if err != nil {
		t.Fatalf("export with unmaterialized asset = %v", err)
	}
	if len(data) == 0 || name == "" {
		t.Fatalf("empty export name=%q bytes=%d", name, len(data))
	}

	imported, err := worlds.ImportWorldBundle(data, "Imported", "test")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	doc, err := worlds.GetCanvasDocument(imported.ID, "")
	if err != nil {
		t.Fatalf("get canvas: %v", err)
	}
	for _, element := range doc.Elements {
		if _, ok := element.Props["assetId"]; ok {
			t.Fatalf("skipped asset left a dangling assetId: %#v", element.Props)
		}
	}
	entities, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: imported.ID})
	if err != nil || len(entities) != 1 {
		t.Fatalf("entities = %#v err=%v", entities, err)
	}
	hero, err := worlds.GetEntity(imported.ID, entities[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, attr := range hero.Attrs {
		if attr.Key != "clip" {
			continue
		}
		if value, ok := attr.Value.(map[string]any); ok {
			if _, dangling := value["assetId"]; dangling {
				t.Fatalf("skipped attr left a dangling assetId: %#v", value)
			}
		}
	}
}

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
	if _, err := worlds.CreateRelation(CreateRelationInput{WorldID: created.ID, FromEntityID: hero.ID, ToEntityID: rule.ID, FromRole: "references"}); err != nil {
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
	if len(relations) != 1 || relations[0].FromRole != "references" {
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
