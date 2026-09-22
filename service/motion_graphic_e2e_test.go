/*
 * [INPUT]: 真实平台宿主（temp workspace SQLite + 项目文件 + 系统编辑器 App），走公开 recut.editor API / 平台
 *          motion-graphic 操作；无需 Node、无外部模型与网络。
 * [OUTPUT]: 不经 UI 的 Motion Graphic 全链路 E2E（Go 构建工具链）：
 *           define（全局，带/不带项目目标；Go esbuild 构建）→ verify（verified head，全局不自动挂项目）→
 *           asset.add + asset.list（显式登记项目引用）→ timeline.placeComponents（assetId 解析为 componentId）→
 *           timeline.read 落轨 → motion-graphic.resolve 返回同版本 bundle/bundleHash → update 迭代新 head →
 *           坏源码失败时旧 verified head 与引用不变。
 * [POS]: service 的接口层 motion graphic 验证；默认跳过（RECUT_E2E_MOTION_GRAPHIC=1 开启），
 *        替代已删除的 apps/editor/scripts/e2e-component-chain.test.js。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"testing"
)

const e2eMGSourceV1 = `import { anim } from "@recut/runtime";

export default {
  surface: "react",
  getBaseSize: () => ({ width: 480, height: 240 }),
  render: (ctx: any) => (
    <div style={{ opacity: anim.lerp(0, 1, ctx.progress) }}>E2E Motion Graphic v1</div>
  ),
};
`

const e2eMGSourceV2 = `import { anim } from "@recut/runtime";

export default {
  surface: "react",
  getBaseSize: () => ({ width: 480, height: 240 }),
  render: (ctx: any) => (
    <div style={{ opacity: anim.lerp(0, 1, ctx.progress), color: "#ff8800" }}>E2E Motion Graphic v2</div>
  ),
};
`

const e2eMGBadSource = `export default { render: () => Math.random() };`

func TestMotionGraphicE2EComponentChain(t *testing.T) {
	if os.Getenv("RECUT_E2E_MOTION_GRAPHIC") != "1" {
		t.Skip("set RECUT_E2E_MOTION_GRAPHIC=1 to run the motion graphic component chain E2E")
	}
	_, store, host, project := setupEditorTestApp(t)
	// 建立真实剪辑项目文档（时间线放置/读取的前置）。
	invoke(t, host, project, "project.create", map[string]any{})

	// 0. 全局 MCP 工具面：AI 侧入口 recut.motion-graphic.define 经 mcpToolCall 直达平台构建。
	//     MG 是全局素材：不传项目目标也应能创作；带 projectId 只是顺带把成品登记到该项目。
	bridge := NewAgentBridge(store)
	globalDefine, err := mcpToolCall(bridge, host, NewMediaService(store), AgentSession{ID: "s-mg-global"},
		"recut.motion-graphic.define", map[string]any{"name": "Global via MCP", "surface": "react", "source": e2eMGSourceV1}, DefaultLocale)
	if err != nil {
		t.Fatalf("global recut.motion-graphic.define (no project target) failed: %v", err)
	}
	if structured, _ := globalDefine.(map[string]any)["structuredContent"].(map[string]any); structured["status"] != "draft" {
		t.Fatalf("global MCP define structuredContent = %#v", globalDefine)
	}

	mcpArgs := map[string]any{
		"name": "E2E via MCP", "surface": "react", "source": e2eMGSourceV1,
		"__recut": map[string]any{"target": map[string]any{"projectId": project.ID}},
	}
	mcpResult, err := mcpToolCall(bridge, host, NewMediaService(store), AgentSession{ID: "s-mg-e2e"}, "recut.motion-graphic.define", mcpArgs, DefaultLocale)
	if err != nil {
		t.Fatalf("recut.motion-graphic.define via MCP failed: %v", err)
	}
	if structured, _ := mcpResult.(map[string]any)["structuredContent"].(map[string]any); structured["status"] != "draft" {
		t.Fatalf("MCP define structuredContent = %#v", mcpResult)
	}

	// 1. define：真实 Go 构建工具链产出 draft 素材。
	//    带 projectId 只是为后续把成品登记到该项目素材库；MG 本体不依赖它。
	defined := invokeAPI(t, host, project, "motion-graphic.define", map[string]any{
		"name": "E2E Motion Graphic", "surface": "react", "source": e2eMGSourceV1,
	})
	componentID, _ := defined["componentId"].(string)
	versionV1, _ := defined["versionId"].(string)
	if componentID == "" || versionV1 == "" || defined["status"] != "draft" {
		t.Fatalf("define = %#v", defined)
	}
	t.Logf("defined componentId=%s versionId=%s", componentID, versionV1)

	// 2. verify：发布 verified head。先走全局工具路径（无项目目标）——素材仍不挂任何项目；
	//    再走项目路径，verify 顺带把成品登记进该项目素材库（editor_assets）。
	globalVerify := invokeMCP(t, host, "recut.motion-graphic.verify", map[string]any{
		"versionId": versionV1,
		"report":    map[string]any{"ok": true, "checks": []any{map[string]any{"name": "component-build", "pass": true}}},
	})
	if globalVerify["status"] != "verified" {
		t.Fatalf("global verify = %#v", globalVerify)
	}
	if assetListHasComponent(invokeAPI(t, host, project, "asset.list", map[string]any{}), componentID) {
		t.Fatalf("global verify must not auto-attach to a project; got a component ref for %s", componentID)
	}
	verified := invokeAPI(t, host, project, "motion-graphic.verify", map[string]any{
		"versionId": versionV1,
		"report":    map[string]any{"ok": true, "checks": []any{map[string]any{"name": "component-build", "pass": true}}},
	})
	if verified["status"] != "verified" {
		t.Fatalf("verify = %#v", verified)
	}
	assets := invokeAPI(t, host, project, "asset.list", map[string]any{})
	if !assetListHasComponent(assets, componentID) {
		t.Fatalf("asset.list missing component %s after project verify: %#v", componentID, assets)
	}

	// 4. 用 assetId 放置到时间线：必须解析到同一个 componentId。
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

	// 5. timeline.read 落轨：存在绑定该 componentId 的 clip。
	read := invoke(t, host, project, "timeline.read", map[string]any{})
	if !timelineHasComponentClip(read, componentID) {
		t.Fatalf("timeline.read missing component clip %s: %#v", componentID, read["clips"])
	}

	// 6. resolve 返回同版本真实 bundle 与内容寻址 hash。
	resolvedV1 := resolveComponent(t, host, project, versionV1)
	if hashV1, _ := resolvedV1["bundleHash"].(string); hashV1 == "" {
		t.Fatalf("resolve v1 = %#v", resolvedV1)
	}

	// 7. update 迭代：新 head 成为 verified，bundleHash 变化。
	updated := invokeAPI(t, host, project, "motion-graphic.update", map[string]any{
		"componentId": componentID, "source": e2eMGSourceV2,
	})
	if updated["ok"] != true || updated["status"] != "verified" {
		t.Fatalf("update = %#v", updated)
	}
	versionV2, _ := updated["versionId"].(string)
	resolvedV2 := resolveComponent(t, host, project, versionV2)
	if resolvedV2["bundleHash"] == resolvedV1["bundleHash"] {
		t.Fatalf("update did not change bundleHash: %#v", resolvedV2)
	}

	// 8. 失败防护：坏源码失败时旧 verified head / 引用保持不变。
	failed := invokeAPI(t, host, project, "motion-graphic.update", map[string]any{
		"componentId": componentID, "source": e2eMGBadSource,
	})
	if failed["ok"] != false || failed["status"] != "failed" {
		t.Fatalf("bad update = %#v", failed)
	}
	head := invokeAPI(t, host, project, "motion-graphic.source", map[string]any{"componentId": componentID})
	if head["source"] != e2eMGSourceV2 {
		t.Fatalf("verified head was overwritten by a failed build: %#v", head["source"])
	}
	if !assetListHasComponent(invokeAPI(t, host, project, "asset.list", map[string]any{}), componentID) {
		t.Fatal("component asset reference disappeared after a failed build")
	}
}

func assetListHasComponent(assets map[string]any, componentID string) bool {
	list, _ := assets["assets"].([]any)
	for _, raw := range list {
		asset := edMap(raw)
		if edStr(asset["type"]) == "component" && edStr(asset["refId"]) == componentID {
			return true
		}
	}
	return false
}

func timelineHasComponentClip(read map[string]any, componentID string) bool {
	clips, _ := read["clips"].([]any)
	for _, raw := range clips {
		clip := edMap(raw)
		if edStr(clip["componentId"]) == componentID || edStr(clip["assetId"]) == "component:"+componentID {
			return true
		}
	}
	return false
}

func resolveComponent(t *testing.T, host *AppHost, project Project, versionID string) map[string]any {
	t.Helper()
	// MG 是全局素材：resolve 经全局平台工具，不需要项目目标。
	resolved := invokeMCP(t, host, "recut.motion-graphic.resolve", map[string]any{"versionId": versionID})
	components, _ := resolved["components"].([]any)
	if len(components) == 0 {
		t.Fatalf("resolve %s returned no components: %#v", versionID, resolved)
	}
	component := edMap(components[0])
	if edStr(component["bundle"]) == "" {
		t.Fatalf("resolve %s returned empty bundle: %#v", versionID, component)
	}
	return component
}
