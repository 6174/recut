/*
 * [INPUT]: 依赖 platformMCPToolDefinitions、mcpToolCall 与 editor 测试宿主（setupEditorTestApp）。
 * [OUTPUT]: 锁定 motion graphic 的全局工具面与平台分发：recut.motion-graphic.* 无条件暴露，
 *           平台 op 与编辑器 UI 桥的裸 op 走同一条 App 无关的 Go 路径。
 * [POS]: Motion Graphic 平台化（App 无关）的服务层回归。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"testing"

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
