/*
 * [INPUT]: 依赖 WorldStore/UpsertEntity/ProductionStatus 与测试助手 newTestWorldStore/newTestAsset
 * [OUTPUT]: 覆盖生产层（作品→场次→镜头三层、各层产物、自底向上派生状态）与对象值属性同步的回归测试
 * [POS]: service 的生产层测试（RFC 2026-10-02-world-canvas-production-layer §6）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "testing"

// 生产层对象不进默认预设目录，但用到时按真实 schema 播种。
func TestProductionTypeSchemasSeededOnUse(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)

	// 新世界：默认目录只有精简三件套，不含 scene/shot。
	types, err := worlds.ListEntityTypes(worldID)
	if err != nil {
		t.Fatal(err)
	}
	before := map[string]WorldEntityType{}
	for _, item := range types {
		before[item.ID] = item
	}
	if _, ok := before["scene"]; ok {
		t.Fatal("scene must not be seeded into a fresh world's preset directory")
	}
	if _, ok := before["shot"]; ok {
		t.Fatal("shot must not be seeded into a fresh world's preset directory")
	}

	// 用到即建：建一个镜头后，shot 出现在目录里并带真实 schema。
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, TypeID: "shot", Name: "S01-01"}); err != nil {
		t.Fatal(err)
	}
	types, err = worlds.ListEntityTypes(worldID)
	if err != nil {
		t.Fatal(err)
	}
	var shot WorldEntityType
	found := false
	for _, item := range types {
		if item.ID == "shot" {
			shot, found = item, true
		}
	}
	if !found {
		t.Fatal("shot type must be seeded on first use")
	}
	if shot.Name != "镜头" {
		t.Fatalf("shot display name = %q, want 镜头", shot.Name)
	}
	keys := map[string]string{}
	for _, field := range shot.Fields {
		keys[field.Key] = field.Type
	}
	for _, key := range []string{"no", "shotSize", "durationSec", "camera", "dialogue", "background"} {
		if _, ok := keys[key]; !ok {
			t.Fatalf("shot schema missing field %q: %#v", key, shot.Fields)
		}
	}
	// 产物不设固定槽位：镜头不是首尾帧模式，产物是按需添加的 media 属性。
	for _, key := range []string{"firstFrame", "lastFrame", "clip", "voice"} {
		if _, ok := keys[key]; ok {
			t.Fatalf("shot schema must NOT hard-code product slot %q: %#v", key, shot.Fields)
		}
	}
}

// 派生状态是纯函数：自身产物 + 子级状态，自底向上、单调（failed > generating > ready > planned）。
func TestRollupProductionStatus(t *testing.T) {
	product := func(status string) WorldProductionProduct { return WorldProductionProduct{Field: "p", Status: status} }
	child := func(status string) WorldProductionNode { return WorldProductionNode{ID: "c", Status: status} }
	cases := []struct {
		name     string
		own      []WorldProductionProduct
		children []WorldProductionNode
		want     string
	}{
		{"empty", nil, nil, ProductionPlanned},
		{"own completed", []WorldProductionProduct{product("completed")}, nil, ProductionReady},
		{"own running", []WorldProductionProduct{product("running")}, nil, ProductionGenerating},
		{"own failed", []WorldProductionProduct{product("failed")}, nil, ProductionFailed},
		{"children all ready", nil, []WorldProductionNode{child(ProductionReady), child(ProductionReady)}, ProductionReady},
		{"child planned only", nil, []WorldProductionNode{child(ProductionPlanned)}, ProductionPlanned},
		{"partial progress", nil, []WorldProductionNode{child(ProductionReady), child(ProductionPlanned)}, ProductionGenerating},
		{"child generating", nil, []WorldProductionNode{child(ProductionReady), child(ProductionGenerating)}, ProductionGenerating},
		{"child failed wins", []WorldProductionProduct{product("completed")}, []WorldProductionNode{child(ProductionFailed)}, ProductionFailed},
		{"own done but child planned", []WorldProductionProduct{product("completed")}, []WorldProductionNode{child(ProductionPlanned)}, ProductionGenerating},
	}
	for _, tc := range cases {
		if got := rollupProductionStatus(tc.own, tc.children); got != tc.want {
			t.Errorf("%s: rollupProductionStatus = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// 端到端：作品 → 场次 → 镜头，产物可挂在任一层，状态自底向上 rollup。
func TestProductionStatusTree(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "短片", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	work, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeScript, Name: "《深夜电台》"})
	if err != nil {
		t.Fatal(err)
	}
	scene, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: "scene", Name: "第 1 场", ParentID: work.ID})
	if err != nil {
		t.Fatal(err)
	}
	// 镜头一：有产物且已完成 → ready。
	frame := newTestAsset(t, media, "frame.png")
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, TypeID: "shot", Name: "S01-01", ParentID: scene.ID,
		Attrs: []EntityAttr{{Key: "a_kf1", Label: "关键帧", Type: "media", Value: map[string]any{"assetId": frame, "kind": "image"}}},
	}); err != nil {
		t.Fatal(err)
	}
	// 镜头二：尚无产物 → planned。
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: "shot", Name: "S01-02", ParentID: scene.ID}); err != nil {
		t.Fatal(err)
	}
	// 场成片：产物挂在场次这一层（不新表，就是它的 media 属性）。
	sceneCut := newTestAsset(t, media, "scene.mp4")
	if _, err := worlds.UpsertEntity(UpsertEntityInput{
		WorldID: world.ID, EntityID: scene.ID,
		Attrs: []EntityAttr{{Key: "a_scene1", Label: "场成片", Type: "media", Value: map[string]any{"assetId": sceneCut, "kind": "video"}}},
	}); err != nil {
		t.Fatal(err)
	}

	production, err := worlds.ProductionStatus(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(production.Roots) != 1 {
		t.Fatalf("roots = %d, want 1 (the work)", len(production.Roots))
	}
	workNode := production.Roots[0]
	if workNode.ID != work.ID || workNode.TypeID != EntityTypeScript {
		t.Fatalf("root = %#v, want the script work", workNode)
	}
	if len(workNode.Children) != 1 {
		t.Fatalf("work children = %d, want 1 scene", len(workNode.Children))
	}
	sceneNode := workNode.Children[0]
	if len(sceneNode.Children) != 2 {
		t.Fatalf("scene children = %d, want 2 shots", len(sceneNode.Children))
	}
	byName := map[string]WorldProductionNode{}
	for _, shot := range sceneNode.Children {
		byName[shot.Name] = shot
	}
	if got := byName["S01-01"].Status; got != ProductionReady {
		t.Errorf("S01-01 = %q, want ready", got)
	}
	if got := byName["S01-02"].Status; got != ProductionPlanned {
		t.Errorf("S01-02 = %q, want planned", got)
	}
	// 场次：自身产物完成 + 子级 [ready, planned] → 部分完成 → generating。
	if sceneNode.Status != ProductionGenerating {
		t.Errorf("scene = %q, want generating (%#v)", sceneNode.Status, sceneNode)
	}
	if len(sceneNode.Products) != 1 || sceneNode.Products[0].Label != "场成片" {
		t.Errorf("scene products = %#v, want the 场成片", sceneNode.Products)
	}
	// 作品：无自身产物，子级 [generating] → generating。
	if workNode.Status != ProductionGenerating {
		t.Errorf("work = %q, want generating", workNode.Status)
	}
	if production.Counts[ProductionReady] != 1 || production.Counts[ProductionPlanned] != 1 || production.Counts[ProductionGenerating] != 2 {
		t.Errorf("counts = %#v", production.Counts)
	}
}

// 生产层树形结构由类型目录声明（advisory）：作品→场次→镜头。
func TestEntityTypeChildTypesDeclared(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	worldID := createTestWorld(t, worlds)

	read := func() map[string]WorldEntityType {
		types, err := worlds.ListEntityTypes(worldID)
		if err != nil {
			t.Fatal(err)
		}
		byID := map[string]WorldEntityType{}
		for _, item := range types {
			byID[item.ID] = item
		}
		return byID
	}

	// 预设直接可见：作品容脚本，脚本容场次/镜头（一幕短片可直接挂镜头）。
	byID := read()
	if got := byID[EntityTypeWork].ChildTypes; len(got) != 1 || got[0] != "script" {
		t.Fatalf("work.childTypes = %#v, want [script]", got)
	}
	if got := byID[EntityTypeScript].ChildTypes; len(got) != 2 || got[0] != "scene" || got[1] != "shot" {
		t.Fatalf("script.childTypes = %#v, want [scene shot]", got)
	}
	if len(byID[EntityTypeCharacter].ChildTypes) != 0 {
		t.Fatalf("character.childTypes = %#v, want none", byID[EntityTypeCharacter].ChildTypes)
	}

	// 生产类型用到即建后再读：场次容镜头，镜头是叶子。
	if _, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: worldID, TypeID: "scene", Name: "第 1 场"}); err != nil {
		t.Fatal(err)
	}
	byID = read()
	if got := byID["scene"].ChildTypes; len(got) != 1 || got[0] != "shot" {
		t.Fatalf("scene.childTypes = %#v, want [shot]", got)
	}
	if got := byID["shot"].ChildTypes; len(got) != 0 {
		t.Fatalf("shot.childTypes = %#v, want none (leaf)", got)
	}
}

// M3：plan 派生草稿（零花费、不产 revision）→ apply 一次性转正（1 条 revision）。
func TestPlanThenApply(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "短片", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	work, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeScript, Name: "《深夜电台》"})
	if err != nil {
		t.Fatal(err)
	}
	// 建作品本身会产 1 条 revision；草稿阶段应从这之后开始比较。
	beforePlan, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	revisionBefore := beforePlan.CurrentRevisionID

	plan, err := worlds.PlanProduction(ProductionPlanInput{
		WorldID: world.ID, ParentID: work.ID, PlaceCards: true,
		Scenes: []ProductionPlanScene{
			{Name: "第 1 场", Shots: []ProductionPlanShot{{Name: "S01-01"}, {Name: "S01-02"}}},
			{Name: "第 2 场", Shots: []ProductionPlanShot{{Name: "S02-01"}}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.SceneIDs) != 2 || len(plan.ShotIDs) != 3 {
		t.Fatalf("plan created %d scenes / %d shots, want 2/3", len(plan.SceneIDs), len(plan.ShotIDs))
	}
	if plan.PlacedCards != 5 {
		t.Fatalf("placedCards = %d, want 5", plan.PlacedCards)
	}
	// 草稿阶段：树已可见，但不产 revision。
	if len(plan.Production.Roots) != 1 || len(plan.Production.Roots[0].Children) != 2 {
		t.Fatalf("plan tree = %#v", plan.Production.Roots)
	}
	// 草稿链：plan 同时写了 has_scene(2) + has_shot(3)，且都是 provisional。
	db, err := worlds.database()
	if err != nil {
		t.Fatal(err)
	}
	var draftLinks int
	if err := db.QueryRow("select count(*) from world_relations where world_id = ? and relation_type in ('has_scene','has_shot') and is_provisional = 1", world.ID).Scan(&draftLinks); err != nil {
		t.Fatal(err)
	}
	if draftLinks != 5 {
		t.Fatalf("draft production links = %d, want 5", draftLinks)
	}
	after, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.CurrentRevisionID != revisionBefore {
		t.Fatalf("plan must not produce a revision: %q -> %q", revisionBefore, after.CurrentRevisionID)
	}
	// 默认列表不含草稿。
	summaries, _, err := worlds.ListEntities(ListEntitiesInput{WorldID: world.ID})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range summaries {
		if item.TypeID == ProductionTypeScene || item.TypeID == ProductionTypeShot {
			t.Fatalf("draft %q leaked into the default list", item.TypeID)
		}
	}

	// apply：一次性转正（2 场 + 3 镜 = 5），产 1 条 revision。
	applied, err := worlds.ApplyProduction(ProductionApplyInput{WorldID: world.ID, WorkID: work.ID, ExpectedRevisionID: after.CurrentRevisionID})
	if err != nil {
		t.Fatal(err)
	}
	if applied.Confirmed != 5 {
		t.Fatalf("confirmed = %d, want 5", applied.Confirmed)
	}
	final, err := worlds.GetWorld(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.CurrentRevisionID == after.CurrentRevisionID {
		t.Fatal("apply must produce a revision")
	}
	summaries, _, err = worlds.ListEntities(ListEntitiesInput{WorldID: world.ID, TypeID: ProductionTypeShot})
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 3 {
		t.Fatalf("after apply shots = %d, want 3", len(summaries))
	}
	// apply 一并转正草稿链：不再有 provisional 生产链，5 条转正。
	var stillDraft, canonicalLinks int
	if err := db.QueryRow("select count(*) from world_relations where world_id = ? and is_provisional = 1", world.ID).Scan(&stillDraft); err != nil {
		t.Fatal(err)
	}
	if stillDraft != 0 {
		t.Fatalf("after apply draft links = %d, want 0", stillDraft)
	}
	if err := db.QueryRow("select count(*) from world_relations where world_id = ? and relation_type in ('has_scene','has_shot') and is_provisional = 0", world.ID).Scan(&canonicalLinks); err != nil {
		t.Fatal(err)
	}
	if canonicalLinks != 5 {
		t.Fatalf("after apply canonical production links = %d, want 5", canonicalLinks)
	}
}

// 树由 link（has_script/has_scene/has_shot）单源表达，不靠 parentId；环不致死循环或丢节点。
func TestProductionTreeResolvesFromLinksNotParentId(t *testing.T) {
	worlds, _, _ := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "短片", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	// 全部不设 parentId：整条链完全靠手连 link 表达。
	mustEntity := func(typeID, name string) WorldEntity {
		entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: typeID, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return entity
	}
	work := mustEntity("work", "作品")
	script := mustEntity("script", "脚本")
	scene := mustEntity("scene", "第 1 场")
	shot := mustEntity("shot", "S01-01")
	mustLink := func(from, to, role string) {
		if _, err := worlds.CreateRelation(CreateRelationInput{WorldID: world.ID, FromEntityID: from, ToEntityID: to, FromRole: role}); err != nil {
			t.Fatal(err)
		}
	}
	mustLink(work.ID, script.ID, "has_script")
	mustLink(script.ID, scene.ID, "has_scene")
	mustLink(scene.ID, shot.ID, "has_shot")

	production, err := worlds.ProductionStatus(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(production.Roots) != 1 || production.Roots[0].ID != work.ID {
		t.Fatalf("roots = %#v, want [work]", production.Roots)
	}
	// 深度断言：work → script → scene → shot（parentId 缺失也不影响）。
	root := production.Roots[0]
	if len(root.Children) != 1 || root.Children[0].ID != script.ID {
		t.Fatalf("work children = %#v, want [script]", root.Children)
	}
	mid := root.Children[0].Children
	if len(mid) != 1 || mid[0].ID != scene.ID || len(mid[0].Children) != 1 || mid[0].Children[0].ID != shot.ID {
		t.Fatalf("chain = %#v, want work→script→scene→shot", production.Roots)
	}

	// 环：再补一条 shot → work 的反向链；解析必须终止且四个节点都在、不重复。
	mustLink(shot.ID, work.ID, "has_script")
	production, err = worlds.ProductionStatus(world.ID)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	duplicate := false
	var walk func(WorldProductionNode)
	walk = func(node WorldProductionNode) {
		if seen[node.ID] {
			duplicate = true
		}
		seen[node.ID] = true
		for _, item := range node.Children {
			walk(item)
		}
	}
	for _, root := range production.Roots {
		walk(root)
	}
	if duplicate {
		t.Fatal("cycle produced a duplicate node in the tree")
	}
	for _, id := range []string{work.ID, script.ID, scene.ID, shot.ID} {
		if !seen[id] {
			t.Fatalf("node %q dropped from the tree", id)
		}
	}
}

// 回归：属性值是对象（media）时，同步旧值比较不能 panic。
func TestAttrElementObjectValueSyncIsIdempotent(t *testing.T) {
	worlds, _, media := newTestWorldStore(t)
	world, err := worlds.CreateWorld(CreateWorldInput{Name: "Obj", Type: WorldFiction})
	if err != nil {
		t.Fatal(err)
	}
	assetID := newTestAsset(t, media, "f.png")
	shot, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: "shot", Name: "S"})
	if err != nil {
		t.Fatal(err)
	}
	props := map[string]any{"field": "a_kf", "value": map[string]any{"assetId": assetID, "kind": "image"}}
	if err := worlds.syncAttrElementValue(world.ID, shot.ID, props); err != nil {
		t.Fatalf("first sync = %v", err)
	}
	// 第二次：值相同 → 深度比较命中，跳过且不 panic。
	if err := worlds.syncAttrElementValue(world.ID, shot.ID, props); err != nil {
		t.Fatalf("second sync (idempotent) = %v", err)
	}
	entity, err := worlds.GetEntity(world.ID, shot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := mediaAssetID(attrValueMap(entity.Attrs)["a_kf"]); got != assetID {
		t.Fatalf("a_kf asset = %q, want %q", got, assetID)
	}
}
