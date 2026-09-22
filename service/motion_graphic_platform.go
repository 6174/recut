/*
 * [INPUT]: 依赖 motion_graphic 域操作、平台的受限子 Agent 运行器与 mcp.go 的工具分发/目标解析。
 * [OUTPUT]: recut.motion-graphic.* 平台工具面：工具定义、MCP 分发、受限作者子 Agent job 与 commit 提交闸；以及只读的 `GET /v1/motion-graphics/{versionId}` 解析端点（供聊天实时渲染组件预览）。
 * [POS]: motion graphic 的平台宿主边界（App 无关）；领域逻辑全在 motion_graphic 包，存储适配在 motion_graphic_bridge.go。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"recut-service/motion_graphic"
)

// motionGraphicJobAppID 是 job 账本上的归属标记（审计展示用，非真实 App）。
const motionGraphicJobAppID = "recut.platform"

// motionGraphicExposedOps 是 AI 可见的平台工具（commit 由受管作者会话单独授权）。
var motionGraphicExposedOps = []string{"create", "revise", "update", "source", "list", "archive", "verify"}

// motionGraphicToolName 返回一个 MG 平台工具的全名。
func motionGraphicToolName(op string) string { return motion_graphic.MotionGraphicToolPrefix + op }

// getMotionGraphicResolve 是只读的浏览器端点：Agent 工具卡片用它取回组件精确版本的
// bundle/surface/inputs，以便在聊天里实时渲染组件预览；只读，不产生任何写入。
func (s *Server) getMotionGraphicResolve(w http.ResponseWriter, r *http.Request) {
	versionID := strings.TrimSpace(r.PathValue("versionId"))
	if versionID == "" {
		writeError(w, http.StatusBadRequest, errors.New("versionId is required"))
		return
	}
	if s.host == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("motion graphic host is unavailable"))
		return
	}
	result, err := s.host.motionGraphicExec(Target{}, motion_graphic.OpResolve, map[string]any{"versionId": versionID}, DefaultLocale)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// motionGraphicMCPToolDefinitions 返回全局的 recut.motion-graphic.* 工具定义。
func motionGraphicMCPToolDefinitions(locale Locale) []map[string]any {
	schemas := map[string]map[string]any{
		"create": {
			"type":     "object",
			"required": []string{"items"},
			"properties": map[string]any{
				"items": map[string]any{"type": "array", "minItems": 1, "items": map[string]any{
					"type":     "object",
					"required": []string{"brief"},
					"properties": map[string]any{
						"nameHint": map[string]string{"type": "string", "description": "建议的组件名。"},
						"brief":    map[string]string{"type": "string", "description": "组件的视觉、数据输入和动效要求。"},
						"mode":     map[string]any{"type": "string", "enum": []string{"fullscreen", "local"}, "description": "fullscreen：铺满整张画布；local：画布局部装饰件（缺省）。"},
						"role":     map[string]string{"type": "string", "description": "可选；用于选 skeleton。"},
						"template": map[string]string{"type": "string", "description": "可选；显式指定 skeleton。"},
					},
				}},
				"references": map[string]any{"type": "object", "description": "可选的参考组件/素材。", "properties": map[string]any{
					"componentIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}},
					"assetIds":     map[string]any{"type": "array", "items": map[string]string{"type": "string"}},
				}},
				"design": map[string]any{"type": "object", "description": "可选的画布/语言上下文。", "properties": map[string]any{
					"canvas": map[string]any{"type": "object", "properties": map[string]any{"width": map[string]string{"type": "number"}, "height": map[string]string{"type": "number"}}},
					"locale": map[string]string{"type": "string"},
				}},
			},
		},
		"revise": {
			"type":     "object",
			"required": []string{"componentId", "instruction"},
			"properties": map[string]any{
				"componentId": map[string]string{"type": "string", "description": "要修复的组件素材 ID。"},
				"instruction": map[string]string{"type": "string", "description": "具体视觉调整、Bug 现象和验收条件。"},
			},
		},
		"update": {
			"type":     "object",
			"required": []string{"componentId", "source"},
			"properties": map[string]any{
				"componentId": map[string]string{"type": "string", "description": "要更新的组件素材 ID。"},
				"source":      map[string]string{"type": "string", "description": "单文件 TS/TSX 源码；唯一允许的外部 import 是 @recut/runtime。"},
			},
		},
		"source": {
			"type":     "object",
			"required": []string{"componentId"},
			"properties": map[string]any{
				"componentId": map[string]string{"type": "string"},
				"versionId":   map[string]string{"type": "string", "description": "可选；缺省取最新版本。"},
			},
		},
		"list":    map[string]any{"type": "object", "properties": map[string]any{}},
		"archive": map[string]any{"type": "object", "required": []string{"componentId"}, "properties": map[string]any{"componentId": map[string]string{"type": "string"}}},
		"verify": {
			"type":     "object",
			"required": []string{"versionId"},
			"properties": map[string]any{
				"versionId": map[string]string{"type": "string"},
				"report":    map[string]any{"type": "object", "description": "harness 验证报告 {ok, checks, frames, cover?, error?}。"},
			},
		},
	}
	tools := make([]map[string]any, 0, len(motionGraphicExposedOps))
	for _, op := range motionGraphicExposedOps {
		name := motionGraphicToolName(op)
		description := mcpDescription(locale, name)
		if description == "" || description == name {
			description = "Motion graphic: " + op
		}
		tools = append(tools, platformTool(name, description, schemas[op]))
	}
	return tools
}

// motionGraphicMCPTool 分发一个 recut.motion-graphic.* 平台工具。
func motionGraphicMCPTool(bridge *AgentBridge, host *AppHost, session AgentSession, name string, arguments map[string]any, locale Locale) (any, error) {
	if host == nil {
		return nil, errors.New("motion graphic host is unavailable")
	}
	op := strings.TrimPrefix(name, motion_graphic.MotionGraphicToolPrefix)
	if op == "commit" {
		return motionGraphicCommitTool(bridge, host, session, arguments, locale)
	}
	target, args := motionGraphicTarget(arguments)
	// projectId 是可选的「顺带登记」提示：确认它指向真实项目，避免把成品登记到一个不存在
	// 的项目引用里（MG 本体是全局素材，校验失败即拒绝，不静默降级）。
	if target.IsProject() {
		if _, err := host.store.Get(target.ProjectID); err != nil {
			return nil, fmt.Errorf("invalid target project %q: %w", target.ProjectID, err)
		}
	}
	fullOp := "motion-graphic." + op
	switch op {
	case "create", "revise":
		input := args
		invoke := func(input map[string]any) (any, error) {
			return host.motionGraphicExec(target, fullOp, input, locale)
		}
		view, err := startSubAgentJob(bridge, host, session, target, motionGraphicJobAppID, fullOp, input, invoke)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(view)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": view}, nil
	}
	result, err := host.motionGraphicExec(target, fullOp, args, locale)
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

// motionGraphicTarget 解析平台 MG 工具目标：__recut.target.projectId 只作为可选的
// 「顺带把成品登记到该项目」提示。MG 素材是全局的，没有项目目标时也照常创作全局素材。
func motionGraphicTarget(arguments map[string]any) (Target, map[string]any) {
	args := map[string]any{}
	for key, value := range arguments {
		if key != "__recut" {
			args[key] = value
		}
	}
	if projectID := requestedProjectID(arguments); projectID != "" {
		return Target{ProjectID: projectID}, args
	}
	return Target{}, args
}

// motionGraphicCommitTool 是受管作者子 Agent 唯一的提交闸：作者身份由受限工具面
// （AllowedTools，只含 commit）判定，平台不接受任何通用会话的提交。目标只带可选的
// projectId，用于把成品顺带登记到该项目；MG 本体是全局素材，不依赖 AppID。
func motionGraphicCommitTool(bridge *AgentBridge, host *AppHost, session AgentSession, arguments map[string]any, locale Locale) (any, error) {
	if len(session.AllowedTools) == 0 {
		return nil, errors.New("recut.motion-graphic.commit requires a focused Component Author session")
	}
	target := Target{ProjectID: session.ProjectID}
	commitArguments := map[string]any{}
	for key, value := range arguments {
		if key != "__recut" {
			commitArguments[key] = value
		}
	}
	// 聚焦上下文由平台会话声明，平台只透传：componentId/baseVersionId/mode 等由 define 消费。
	if session.Focused != nil {
		for key, value := range session.Focused {
			if text, isString := value.(string); isString && text != "" {
				commitArguments[key] = text
			}
		}
	}
	result, err := host.motionGraphicExec(target, motion_graphic.OpDefine, commitArguments, locale)
	if err != nil {
		return nil, err
	}
	committed, _ := result.(map[string]any)
	if committed == nil || committed["status"] != "draft" {
		data, _ := json.Marshal(result)
		return nil, errors.New("motion-graphic.commit build did not produce a draft component: " + string(data))
	}
	bridge.RecordAgentToolCall(session.ID, motion_graphic.CommitTool, committed)
	if job, ok := bridge.agentJobByChild(session.ID); ok {
		bridge.recordAgentJobCall(job.ID, agentToolCall{Name: motion_graphic.CommitTool, Result: committed})
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}
