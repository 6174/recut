/*
 * [INPUT]: 依赖 WorldStore/ListEntityTypes 与测试助手 newTestWorldStore/newTestAsset
 * [OUTPUT]: 覆盖作品→视频脚本的生产结构声明（childTypes）与对象值属性同步的回归测试
 * [POS]: service 的实体类型/属性同步测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "testing"

// 作品→视频脚本的生产结构由类型目录声明（advisory）：work.childTypes=[script]；
// 脚本是叶子，一次视频生成的单位是画布上的视频节点（媒体元素），不是实体类型。
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

	byID := read()
	if got := byID[EntityTypeWork].ChildTypes; len(got) != 1 || got[0] != "script" {
		t.Fatalf("work.childTypes = %#v, want [script]", got)
	}
	if len(byID[EntityTypeScript].ChildTypes) != 0 {
		t.Fatalf("script.childTypes = %#v, want none (leaf)", byID[EntityTypeScript].ChildTypes)
	}
	if len(byID[EntityTypeCharacter].ChildTypes) != 0 {
		t.Fatalf("character.childTypes = %#v, want none", byID[EntityTypeCharacter].ChildTypes)
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
	entity, err := worlds.UpsertEntity(UpsertEntityInput{WorldID: world.ID, TypeID: EntityTypeLocation, Name: "景"})
	if err != nil {
		t.Fatal(err)
	}
	props := map[string]any{"field": "a_kf", "value": map[string]any{"assetId": assetID, "kind": "image"}}
	if err := worlds.syncAttrElementValue(world.ID, entity.ID, props); err != nil {
		t.Fatalf("first sync = %v", err)
	}
	// 第二次：值相同 → 深度比较命中，跳过且不 panic。
	if err := worlds.syncAttrElementValue(world.ID, entity.ID, props); err != nil {
		t.Fatalf("second sync (idempotent) = %v", err)
	}
	got, err := worlds.GetEntity(world.ID, entity.ID)
	if err != nil {
		t.Fatal(err)
	}
	value, _ := attrValueMap(got.Attrs)["a_kf"].(map[string]any)
	if value["assetId"] != assetID {
		t.Fatalf("a_kf asset = %v, want %q", value["assetId"], assetID)
	}
}
