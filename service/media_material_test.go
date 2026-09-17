/*
 * [INPUT]: 依赖 MediaService、Store 与临时工作区
 * [OUTPUT]: 验证全局素材属性层：content/contentMeta 往返、attributes 整体替换与 attrPatch 按 key 合并、
 *   locked 结构不可改（值可改）、来源与 provenance 由服务端填充、MCP asset.get/update 工具面存在
 * [POS]: service 的素材属性回归测试；不调用真实模型提供商
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"strings"
	"testing"
)

func newMaterialTestService(t *testing.T) (*MediaService, MediaAsset) {
	t.Helper()
	media := NewMediaService(NewStore(t.TempDir(), nil))
	asset, err := media.ImportImage("anchor.png", "image/png", []byte("material-test-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	return media, asset
}

func materialAttrs(t *testing.T, asset MediaAsset) []MaterialAttr {
	t.Helper()
	attrs, err := MaterialAttrsFromMetadata(asset.Metadata)
	if err != nil {
		t.Fatal(err)
	}
	return attrs
}

func findMaterialAttr(attrs []MaterialAttr, key string) (MaterialAttr, bool) {
	for _, attr := range attrs {
		if attr.Key == key {
			return attr, true
		}
	}
	return MaterialAttr{}, false
}

func TestMaterialUpdateRoundTrip(t *testing.T) {
	media, asset := newMaterialTestService(t)
	updated, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{
		Name:    strPtr("产品主图"),
		Content: strPtr("一支 30s 产品广告的静物主图。"),
		Attributes: &[]MaterialAttr{
			{Key: "shotKind", Label: "镜头", Type: "text", Value: "静物特写"},
			{Key: "role", Label: "角色", Type: "select", Value: "b-roll", Options: []string{"a-roll", "b-roll"}},
		},
	}, MaterialActorAgent, "asset.update")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "产品主图" {
		t.Fatalf("name = %q", updated.Name)
	}
	content, _ := updated.Metadata[MetadataKeyContent].(string)
	if content != "一支 30s 产品广告的静物主图。" {
		t.Fatalf("content = %q", content)
	}
	contentMeta, ok := updated.Metadata[MetadataKeyContentMeta].(map[string]any)
	if !ok || contentMeta["by"] != MaterialActorAgent || contentMeta["at"] == "" {
		t.Fatalf("contentMeta = %#v", updated.Metadata[MetadataKeyContentMeta])
	}
	attrs := materialAttrs(t, updated)
	if len(attrs) != 2 {
		t.Fatalf("attributes = %#v", attrs)
	}
	shot, _ := findMaterialAttr(attrs, "shotKind")
	if shot.Value != "静物特写" || shot.Source != MaterialActorAgent {
		t.Fatalf("shotKind = %#v", shot)
	}
	if shot.Provenance == nil || shot.Provenance.By != MaterialActorAgent || shot.Provenance.Op != "asset.update" {
		t.Fatalf("shotKind provenance = %#v", shot.Provenance)
	}
	role, _ := findMaterialAttr(attrs, "role")
	if role.Locked || role.Source != MaterialActorAgent {
		t.Fatalf("role = %#v", role)
	}

	// Persisted through the asset row, not just the returned value.
	reloaded, err := media.GetAsset(asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(materialAttrs(t, reloaded)) != 2 {
		t.Fatalf("reloaded attributes lost: %#v", reloaded.Metadata)
	}
}

func TestMaterialAttrPatchMergesByKey(t *testing.T) {
	media, asset := newMaterialTestService(t)
	if _, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{Attributes: &[]MaterialAttr{
		{Key: "a", Type: "text", Value: "one"},
		{Key: "b", Type: "number", Value: float64(2)},
	}}, MaterialActorUser, "asset.update"); err != nil {
		t.Fatal(err)
	}
	updated, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{AttrPatch: []MaterialAttr{
		{Key: "a", Value: "changed"},
		{Key: "c", Label: "新字段", Type: "boolean", Value: true},
	}}, MaterialActorAgent, "asset.update")
	if err != nil {
		t.Fatal(err)
	}
	attrs := materialAttrs(t, updated)
	if len(attrs) != 3 || attrs[0].Key != "a" || attrs[1].Key != "b" || attrs[2].Key != "c" {
		t.Fatalf("patch order/append = %#v", attrs)
	}
	if attrs[0].Value != "changed" || attrs[0].Type != "text" {
		t.Fatalf("patched a = %#v", attrs[0])
	}
	if attrs[1].Value != float64(2) {
		t.Fatalf("untouched b = %#v", attrs[1])
	}
	if attrs[2].Source != MaterialActorAgent || attrs[2].Provenance == nil {
		t.Fatalf("new c provenance = %#v", attrs[2])
	}
}

func TestMaterialLockedAttrStructureIsImmutable(t *testing.T) {
	media, asset := newMaterialTestService(t)
	if _, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{Attributes: &[]MaterialAttr{
		{Key: "role", Label: "角色", Type: "select", Value: "b-roll", Options: []string{"a-roll", "b-roll"}, Locked: true, Source: MaterialActorSystem},
		{Key: "note", Type: "text", Value: "临时"},
	}}, MaterialActorSystem, "asset.update"); err != nil {
		t.Fatal(err)
	}
	// Removing a locked attr via full replace is rejected.
	if _, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{Attributes: &[]MaterialAttr{
		{Key: "note", Type: "text", Value: "只剩这个"},
	}}, MaterialActorUser, "asset.update"); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("removing locked attr must fail closed, got %v", err)
	}
	// Changing a locked attr's type or label is rejected.
	if _, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{AttrPatch: []MaterialAttr{{Key: "role", Label: "角色改名"}}}, MaterialActorUser, "asset.update"); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("relabeling locked attr must fail closed, got %v", err)
	}
	if _, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{AttrPatch: []MaterialAttr{{Key: "role", Type: "text"}}}, MaterialActorUser, "asset.update"); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("retyping locked attr must fail closed, got %v", err)
	}
	// Changing only the value is allowed and keeps the locked flag.
	updated, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{AttrPatch: []MaterialAttr{{Key: "role", Value: "a-roll"}}}, MaterialActorUser, "asset.update")
	if err != nil {
		t.Fatal(err)
	}
	role, _ := findMaterialAttr(materialAttrs(t, updated), "role")
	if !role.Locked || role.Value != "a-roll" || role.Label != "角色" {
		t.Fatalf("locked value update = %#v", role)
	}
}

func TestMaterialAttrValidationFailsClosed(t *testing.T) {
	media, asset := newMaterialTestService(t)
	cases := []struct {
		name string
		attr MaterialAttr
		want string
	}{
		{"unknown type", MaterialAttr{Key: "x", Type: "unknown", Value: "v"}, "unknown type"},
		{"select without options", MaterialAttr{Key: "x", Type: "select", Value: "v"}, "options"},
		{"media without assetId", MaterialAttr{Key: "x", Type: "media", Value: map[string]any{"kind": "image"}}, "assetId"},
	}
	for _, testCase := range cases {
		if _, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{Attributes: &[]MaterialAttr{testCase.attr}}, MaterialActorUser, "asset.update"); err == nil || !strings.Contains(err.Error(), testCase.want) {
			t.Fatalf("%s: err = %v, want contains %q", testCase.name, err, testCase.want)
		}
	}
}

func TestUserCannotCreateLockedAttr(t *testing.T) {
	media, asset := newMaterialTestService(t)
	updated, err := media.UpdateMaterial(asset.ID, MaterialUpdateInput{Attributes: &[]MaterialAttr{
		{Key: "x", Type: "text", Value: "v", Locked: true},
	}}, MaterialActorUser, "asset.update")
	if err != nil {
		t.Fatal(err)
	}
	if attrs := materialAttrs(t, updated); len(attrs) != 1 || attrs[0].Locked {
		t.Fatalf("user-created attr must not be locked: %#v", attrs)
	}
}

func TestMaterialMCPToolSurface(t *testing.T) {
	tools := map[string]map[string]any{}
	for _, tool := range mediaMCPToolDefinitions(DefaultLocale) {
		tools[tool["name"].(string)] = tool
	}
	for _, name := range []string{"recut.media.asset.get", "recut.media.asset.update"} {
		tool, ok := tools[name]
		if !ok {
			t.Fatalf("missing material tool %q", name)
		}
		if !isMediaMCPTool(name) {
			t.Fatalf("material tool %q is not recognized as a media tool", name)
		}
		properties, ok := tool["inputSchema"].(map[string]any)["properties"].(map[string]any)
		if !ok || properties["assetId"] == nil {
			t.Fatalf("%s must accept assetId", name)
		}
	}
	updateProps := tools["recut.media.asset.update"]["inputSchema"].(map[string]any)["properties"].(map[string]any)
	for _, key := range []string{"name", "content", "attributes", "attrPatch"} {
		if updateProps[key] == nil {
			t.Fatalf("asset.update is missing %q", key)
		}
	}
}
