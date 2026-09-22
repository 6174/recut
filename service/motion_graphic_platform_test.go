/*
 * [INPUT]: 依赖 platformMCPToolDefinitions、mcpToolCall 与 editor 测试宿主（setupEditorTestApp）。
 * [OUTPUT]: 锁定 motion graphic 的全局工具面与平台分发：recut.motion-graphic.* 无条件暴露，
 *           平台 op 与编辑器 UI 桥的裸 op 走同一条 App 无关的 Go 路径。
 * [POS]: Motion Graphic 平台化（App 无关）的服务层回归。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"

	"recut-service/media"
	"recut-service/motion_graphic"
)

func TestMotionGraphicPlatformTools(t *testing.T) {
	names := map[string]bool{}
	for _, tool := range platformMCPToolDefinitions(DefaultLocale) {
		name, _ := tool["name"].(string)
		names[name] = true
	}
	for _, required := range []string{
		"recut.motion-graphic.create", "recut.motion-graphic.revise", "recut.motion-graphic.update",
		"recut.motion-graphic.source", "recut.motion-graphic.list", "recut.motion-graphic.archive",
		"recut.motion-graphic.verify",
	} {
		if !names[required] {
			t.Fatalf("platform MCP tools missing %q", required)
		}
	}
	for name := range names {
		if name == "recut.editor.motion-graphic.create" || name == "recut.editor.motion-graphic.list" {
			t.Fatalf("motion graphic must not be exposed under recut.editor: %q", name)
		}
	}
}

const platformComponentSource = `import { anim } from "@recut/runtime";

export default {
  surface: "react",
  getBaseSize: () => ({ width: 320, height: 180 }),
  render: (ctx: any) => {
    return <div style={{ opacity: anim.lerp(0, 1, ctx.progress) }}>Platform MG</div>;
  },
};
`

func TestMotionGraphicPlatformDispatchIsAppAgnostic(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	target := Target{ProjectID: project.ID}

	defined, err := host.motionGraphicExec(target, motion_graphic.OpDefine, map[string]any{
		"name": "Platform MG", "surface": "react", "source": platformComponentSource,
	}, DefaultLocale)
	if err != nil {
		t.Fatalf("platform define failed: %v", err)
	}
	definedMap, _ := defined.(map[string]any)
	if definedMap["status"] != "draft" || definedMap["componentId"] == nil {
		t.Fatalf("platform define result = %#v", defined)
	}

	// 编辑器 UI 桥的裸 op（api surface）与平台工具走同一条 Go 路径。
	listed, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: editorSystemAppID}, editorSystemAppID, "motion-graphic.list", map[string]any{})
	if err != nil {
		t.Fatalf("editor api motion-graphic.list failed: %v", err)
	}
	listedMap, _ := listed.(map[string]any)
	if components, _ := listedMap["components"].([]any); len(components) == 0 {
		t.Fatalf("motion-graphic.list returned no components: %#v", listed)
	}

	// 平台 MCP 工具面分发（recut.motion-graphic.list）。
	bridge := NewAgentBridge(store)
	arguments := map[string]any{"__recut": map[string]any{"target": map[string]any{"projectId": project.ID}}}
	if _, err := mcpToolCall(bridge, host, NewMediaService(store), AgentSession{ID: "s-mg"}, "recut.motion-graphic.list", arguments, DefaultLocale); err != nil {
		t.Fatalf("platform recut.motion-graphic.list failed: %v", err)
	}
}

// TestMotionGraphicPlatformCreateFinalize 覆盖受限作者子 Agent 的 finalize 半程：
// create 收到 subAgentTools（commit 结果）后应产出 verified 组件与 assetId，且不落时间线。
func TestMotionGraphicPlatformCreateFinalize(t *testing.T) {
	_, _, host, project := setupEditorTestApp(t)
	target := Target{ProjectID: project.ID}

	defined, err := host.motionGraphicExec(target, motion_graphic.OpDefine, map[string]any{
		"name": "Finalized MG", "surface": "react", "source": platformComponentSource,
	}, DefaultLocale)
	if err != nil {
		t.Fatalf("define failed: %v", err)
	}
	definedMap, _ := defined.(map[string]any)
	versionID, _ := definedMap["versionId"].(string)
	if versionID == "" {
		t.Fatalf("define returned no versionId: %#v", defined)
	}

	finalized, err := host.motionGraphicExec(target, motion_graphic.OpCreate, map[string]any{
		"items": []any{map[string]any{"brief": "a platform motion graphic"}},
		"subAgentTools": []any{map[string]any{
			"name":   motion_graphic.CommitTool,
			"result": map[string]any{"versionId": versionID},
		}},
	}, DefaultLocale)
	if err != nil {
		t.Fatalf("create finalize failed: %v", err)
	}
	finalizedMap, _ := finalized.(map[string]any)
	components, _ := finalizedMap["components"].([]any)
	if len(components) != 1 {
		t.Fatalf("create finalize components = %#v", finalized)
	}
	component, _ := components[0].(map[string]any)
	if component["status"] != "verified" || component["assetId"] == nil {
		t.Fatalf("create finalize component = %#v", component)
	}

	// 不落时间线：项目文档没有新增 element。
	if listed, err := host.motionGraphicExec(target, motion_graphic.OpList, map[string]any{}, DefaultLocale); err != nil {
		t.Fatalf("list failed: %v", err)
	} else if _, ok := listed.(map[string]any)["components"].([]any); !ok {
		t.Fatalf("list result = %#v", listed)
	}
}

// TestMotionGraphicCommitGateRecognizesAuthorSession 锁定提交闸：作者身份由受限工具面
// （AllowedTools，只含 commit）判定，与是否绑定 AppID 无关。回归 2026-09-22：作者子会话
// 是 app-less 的（MotioGraphic 是全局素材），旧闸用 SessionTarget()（要求 AppID）会误拒。
func TestMotionGraphicCommitGateRecognizesAuthorSession(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	bridge := NewAgentBridge(store)

	author := AgentSession{
		ID:           "author",
		ProjectID:    project.ID,
		AllowedTools: []string{motion_graphic.CommitTool},
		Focused:      map[string]any{"mode": "local"},
	}
	committed, err := motionGraphicCommitTool(bridge, host, author, map[string]any{
		"name": "Gate MG", "surface": "react", "source": platformComponentSource,
	}, DefaultLocale)
	if err != nil {
		t.Fatalf("app-less author session must pass the commit gate: %v", err)
	}
	if structured, _ := committed.(map[string]any)["structuredContent"].(map[string]any); structured["status"] != "draft" {
		t.Fatalf("commit structuredContent = %#v", committed)
	}

	general := AgentSession{ID: "general", ProjectID: project.ID}
	if _, err := motionGraphicCommitTool(bridge, host, general, map[string]any{
		"name": "Nope", "surface": "react", "source": platformComponentSource,
	}, DefaultLocale); err == nil {
		t.Fatal("a general (unfocused) session must not commit")
	}
}

// TestMotionGraphicTargetRejectsUnknownProject 锁定：projectId 只是可选的顺带登记提示，
// 但若指向不存在的项目必须显式拒绝，而不是把成品登记进一个悬空的项目引用。
func TestMotionGraphicTargetRejectsUnknownProject(t *testing.T) {
	_, _, host, _ := setupEditorTestApp(t)
	bridge := NewAgentBridge(host.store)
	arguments := map[string]any{
		"name": "Ghost MG", "surface": "react", "source": platformComponentSource,
		"__recut": map[string]any{"target": map[string]any{"projectId": "no-such-project"}},
	}
	_, err := mcpToolCall(bridge, host, NewMediaService(host.store), AgentSession{ID: "s-ghost"}, "recut.motion-graphic.define", arguments, DefaultLocale)
	if err == nil {
		t.Fatal("define with an unknown projectId must be rejected")
	}
}

// TestMigrateLegacyMotionGraphicFiles 锁定：早期落在 appstate/recut.editor/files 下的 MG
// cover_ref 会被复制到平台全局文件根，使新的 platformFileURL 能解析旧封面。
func TestMigrateLegacyMotionGraphicFiles(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)

	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	const componentID = "ai-legacy-cover"
	rel := "motion-graphics/covers/legacy.png"

	// 造一条带旧 cover_ref 的全局素材（直接用存储层，避免先触发 MG op 让迁移 pref 置位）。
	if err := motion_graphic.InsertDraft(db, motion_graphic.Material{
		ID: componentID, Name: "Legacy Cover MG", Surface: "react",
		KeywordsJSON: "[]", InputsJSON: "[]", Status: "verified", CodeVersion: 1,
		Source: platformComponentSource, CreatedAt: nowIso(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := motion_graphic.SetVerified(db, componentID, `{"ok":true}`, rel); err != nil {
		t.Fatal(err)
	}

	// 把封面字节只写在旧 appstate 根。
	legacyRoot, err := store.AppStateFilesRoot(motionGraphicLegacyAppID)
	if err != nil {
		t.Fatal(err)
	}
	legacyPath := filepath.Join(legacyRoot, rel)
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyPath, []byte("legacy-cover-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 任一次 MG op 触发迁移（motionGraphicExec → migrateLegacyMotionGraphicFiles）。
	if _, err := host.motionGraphicExec(Target{ProjectID: project.ID}, motion_graphic.OpList, map[string]any{}, DefaultLocale); err != nil {
		t.Fatalf("list failed: %v", err)
	}

	platformRoot, err := store.PlatformFilesRoot()
	if err != nil {
		t.Fatal(err)
	}
	migrated, err := os.ReadFile(filepath.Join(platformRoot, rel))
	if err != nil {
		t.Fatalf("legacy cover was not migrated to the platform root: %v", err)
	}
	if string(migrated) != "legacy-cover-bytes" {
		t.Fatalf("migrated cover bytes = %q", string(migrated))
	}
	if _, err := os.Stat(legacyPath); err != nil {
		t.Fatalf("legacy file must be preserved: %v", err)
	}
}

// TestMotionGraphicResolveViewCarriesBundleForChatPreview 锁定聊天预览端点依赖的契约：
// resolve 返回组件精确版本的 bundle/surface，使浏览器可在聊天内实时渲染组件预览。
func TestMotionGraphicResolveViewCarriesBundleForChatPreview(t *testing.T) {
	_, _, host, _ := setupEditorTestApp(t)
	defined, err := host.motionGraphicExec(Target{}, motion_graphic.OpDefine, map[string]any{
		"name": "Preview MG", "surface": "react", "source": platformComponentSource,
	}, DefaultLocale)
	if err != nil {
		t.Fatalf("define failed: %v", err)
	}
	definedMap, _ := defined.(map[string]any)
	versionID, _ := definedMap["versionId"].(string)
	if versionID == "" {
		t.Fatalf("define returned no versionId: %#v", defined)
	}
	resolved, err := host.motionGraphicExec(Target{}, motion_graphic.OpResolve, map[string]any{"versionId": versionID}, DefaultLocale)
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	resolvedMap, _ := resolved.(map[string]any)
	components, _ := resolvedMap["components"].([]any)
	if len(components) != 1 {
		t.Fatalf("resolve components = %#v", resolved)
	}
	component, _ := components[0].(map[string]any)
	if component["surface"] != "react" || component["bundle"] == "" || component["componentId"] == nil {
		t.Fatalf("resolve view missing bundle/surface: %#v", component)
	}
}

// TestEditorPlaceComponentsAutoRegistersGlobalComponent 覆盖「用到时自动登记」：一个只存在于全局
// mg_materials（verified、未登记任何项目）的组件，在 timeline.placeComponents 被使用时自动写一条
// 项目侧引用（editor_assets），使放置成功、进入项目素材库，且 validate 无 component-def。
func TestEditorPlaceComponentsAutoRegistersGlobalComponent(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{})

	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	const componentID = "ai-autoreg"
	if err := motion_graphic.InsertDraft(db, motion_graphic.Material{
		ID: componentID, Name: "Auto Register MG", Surface: "react",
		KeywordsJSON: "[]", InputsJSON: "[]", Status: "verified", CodeVersion: 1,
		Source: platformComponentSource, Bundle: "export default {}", BundleHash: "h1", CreatedAt: nowIso(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := motion_graphic.SetVerified(db, componentID, `{"ok":true}`, ""); err != nil {
		t.Fatal(err)
	}

	// 使用前：项目侧没有任何该组件的引用。
	if assetListHasComponent(invokeAPI(t, host, project, "asset.list", map[string]any{}), componentID) {
		t.Fatalf("project must not have a prefilled ref for %s", componentID)
	}

	// 用到时（放置）自动登记项目引用。
	placed := invoke(t, host, project, "timeline.placeComponents", map[string]any{
		"items": []any{map[string]any{
			"assetId":     "component:" + componentID,
			"startSec":    float64(0),
			"durationSec": float64(3),
		}},
	})
	if placed["ok"] != true {
		t.Fatalf("placeComponents = %#v", placed)
	}
	if !assetListHasComponent(invokeAPI(t, host, project, "asset.list", map[string]any{}), componentID) {
		t.Fatalf("component %s was not auto-registered into the project on use", componentID)
	}

	// 引用已登记 → validate 不应报 component-def（可解析）。
	val := invoke(t, host, project, "timeline.validate", map[string]any{})
	for _, v := range val["violations"].([]any) {
		if edStr(edMap(v)["code"]) == "component-def" {
			t.Fatalf("unexpected component-def violation after auto-register: %#v", val)
		}
	}
}

// TestEditorAssetAddRegistersComponent 覆盖 asset.add 的组件分支：`component:<id>` 指向全局
// verified 组件时登记项目引用，而不是走媒体 attach；未验证/不存在时给出明确业务错误。
func TestEditorAssetAddRegistersComponent(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	invoke(t, host, project, "project.create", map[string]any{})

	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	const componentID = "ai-assetadd"
	if err := motion_graphic.InsertDraft(db, motion_graphic.Material{
		ID: componentID, Name: "Asset Add MG", Surface: "react",
		KeywordsJSON: "[]", InputsJSON: "[]", Status: "verified", CodeVersion: 1,
		Source: platformComponentSource, Bundle: "export default {}", BundleHash: "h1", CreatedAt: nowIso(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := motion_graphic.SetVerified(db, componentID, `{"ok":true}`, ""); err != nil {
		t.Fatal(err)
	}

	added := invoke(t, host, project, "asset.add", map[string]any{"assetId": "component:" + componentID})
	if added["ok"] != true {
		t.Fatalf("asset.add component = %#v", added)
	}
	if !assetListHasComponent(invokeAPI(t, host, project, "asset.list", map[string]any{}), componentID) {
		t.Fatalf("asset.add did not register component %s into the project", componentID)
	}
}

// TestMotionGraphicVerifyProjectsUnifiedComponentAsset 锁定「组件首先是统一素材」：
// verified 时把组件投影成 kind=component 的全局 Asset，可在素材库中按 kind 列出并预览。
func TestMotionGraphicVerifyProjectsUnifiedComponentAsset(t *testing.T) {
	apps, store, _, project := setupEditorTestApp(t)
	host := NewAppHost(apps, store, NewMediaService(store))
	_ = project
	defined, err := host.motionGraphicExec(Target{}, motion_graphic.OpDefine, map[string]any{
		"name": "Library MG", "surface": "react", "source": platformComponentSource,
	}, DefaultLocale)
	if err != nil {
		t.Fatalf("define failed: %v", err)
	}
	definedMap, _ := defined.(map[string]any)
	versionID, _ := definedMap["versionId"].(string)
	componentID, _ := definedMap["componentId"].(string)
	assetID, _ := definedMap["assetId"].(string)
	if versionID == "" || componentID == "" || assetID == "" {
		t.Fatalf("define result missing ids: %#v", defined)
	}
	if _, err := host.motionGraphicExec(Target{}, motion_graphic.OpVerify, map[string]any{
		"versionId": versionID,
		"report":    map[string]any{"ok": true, "checks": []any{map[string]any{"name": "build", "pass": true}}},
	}, DefaultLocale); err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	page, err := NewMediaService(store).ListAssetsFiltered("", media.MediaAssetFilter{Kind: "component", Query: "Library MG"})
	if err != nil {
		t.Fatalf("list component assets failed: %v", err)
	}
	if page.Total == 0 {
		t.Fatal("component asset was not projected into the unified library")
	}
	for _, asset := range page.Items {
		if asset.ID != assetID {
			continue
		}
		component, _ := asset.Metadata["component"].(map[string]any)
		if component == nil || component["componentId"] != componentID || component["versionId"] != versionID {
			t.Fatalf("component asset metadata = %#v", asset.Metadata)
		}
		return
	}
	t.Fatalf("component asset %q not found in %#v", assetID, page.Items)
}

// TestMotionGraphicAssetBackfillProjectsExistingComponents 锁定历史组件回填：
// 已有 mg_materials 在首次 MG op 时被一次性投影成统一组件素材（幂等）。
func TestMotionGraphicAssetBackfillProjectsExistingComponents(t *testing.T) {
	apps, store, _, _ := setupEditorTestApp(t)
	host := NewAppHost(apps, store, NewMediaService(store))
	// 先造一个历史组件（direct define，模拟迁移前已存在的 mg_materials）。
	if _, err := host.motionGraphicExec(Target{}, motion_graphic.OpDefine, map[string]any{
		"name": "Legacy MG", "surface": "react", "source": platformComponentSource,
	}, DefaultLocale); err != nil {
		t.Fatalf("define failed: %v", err)
	}
	mediaSvc := NewMediaService(store)
	// 触发任意 MG op：迁移应把历史组件回填成组件素材。
	if _, err := host.motionGraphicExec(Target{}, motion_graphic.OpList, map[string]any{}, DefaultLocale); err != nil {
		t.Fatalf("list failed: %v", err)
	}
	page, err := mediaSvc.ListAssetsFiltered("", media.MediaAssetFilter{Kind: "component", Query: "Legacy MG"})
	if err != nil {
		t.Fatalf("list component assets failed: %v", err)
	}
	if page.Total == 0 {
		t.Fatal("legacy motion graphic was not backfilled into the unified library")
	}
}
