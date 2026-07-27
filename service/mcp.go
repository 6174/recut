/*
 * [INPUT]: 依赖 AgentBridge 会话鉴权、AppHost JavaScript runtime 与标准输入输出 JSON-RPC 流
 * [OUTPUT]: 对外提供带默认媒体契约的项目上下文，并将 manifest.mcp.tools 映射为受控 MCP 工具
 * [POS]: service 的 MCP Host；App 不自行启动 MCP server，所有调用经平台权限与会话边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func RunMCPStdio(bridge *AgentBridge, host *AppHost, media *MediaService, input io.Reader, output io.Writer) error {
	session, err := bridge.Authenticate(os.Getenv("RECUT_AGENT_SESSION"), os.Getenv("RECUT_AGENT_TOKEN"))
	if err != nil {
		return err
	}
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	for scanner.Scan() {
		request := mcpRequest{}
		if json.Unmarshal(scanner.Bytes(), &request) != nil || len(request.ID) == 0 {
			continue
		}
		result, callErr := handleMCP(bridge, host, media, session, request)
		response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(request.ID)}
		if callErr != nil {
			response["error"] = map[string]any{"code": -32000, "message": callErr.Error()}
		} else {
			response["result"] = result
		}
		data, _ := json.Marshal(response)
		if _, err := fmt.Fprintln(output, string(data)); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func handleMCP(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, request mcpRequest) (any, error) {
	project, err := bridge.store.Get(session.ProjectID)
	if err != nil {
		return nil, err
	}
	app, ok := bridge.store.catalog.Get(project.AppID)
	if !ok {
		return nil, fmt.Errorf("project App is unavailable")
	}
	switch request.Method {
	case "initialize":
		return map[string]any{"protocolVersion": "2025-03-26", "serverInfo": map[string]string{"name": "recut-mcp-host", "version": "0.2.0"}, "capabilities": map[string]any{"tools": map[string]any{}}}, nil
	case "tools/list":
		tools := make([]map[string]any, 0, len(app.Manifest.Operations)+7)
		tools = append(tools, map[string]any{
			"name":        "recut.project_context",
			"description": "读取当前 Recut 项目的身份、版本、App、可用 Artifact 与 Agent 约束。任何项目任务开始时先调用此工具。",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		})
		tools = append(tools,
			map[string]any{"name": "recut.media.configuration", "description": "读取最新媒体配置；通常无需调用，因为 recut.project_context 已携带默认 route、模型契约和可选参数。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
			map[string]any{"name": "recut.media.generate", "description": "同步生成短时、阶段关键的图片。输入是 text 和可选 imageAssetIds；所有 id 都是全局素材库 assetId。成功返回 assetIds；Provider 失败或超时直接返回错误。", "inputSchema": map[string]any{"type": "object", "required": []string{"capability", "text"}, "properties": map[string]any{"capability": map[string]any{"type": "string", "enum": []string{"image.generate"}}, "text": map[string]any{"type": "string", "description": "生成提示词。"}, "imageAssetIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "作为图片参考的全局 assetId。"}, "output": map[string]any{"type": "object"}, "idempotencyKey": map[string]any{"type": "string"}}}},
			map[string]any{"name": "recut.media.generate_async", "description": "提交长时间运行的图片、音频或视频生成。图片依赖 text + imageAssetIds；音频依赖 text；视频依赖 text + imageAssetIds + audioAssetIds。所有 id 都是全局素材库 assetId。立即返回 jobId。", "inputSchema": map[string]any{"type": "object", "required": []string{"capability", "text"}, "properties": map[string]any{"capability": map[string]any{"type": "string", "enum": []string{"image.generate", "video.generate", "speech.generate"}}, "text": map[string]any{"type": "string", "description": "生成提示词或旁白文本。"}, "imageAssetIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "输入图片的全局 assetId。"}, "audioAssetIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "输入音频的全局 assetId，仅视频生成使用。"}, "output": map[string]any{"type": "object"}, "idempotencyKey": map[string]any{"type": "string"}}}},
			map[string]any{"name": "recut.media.get_job", "description": "读取媒体生成任务状态；完成后返回 assetIds。", "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}},
			map[string]any{"name": "recut.media.list_assets", "description": "检索当前项目或工作区的可复用媒体素材。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"workspace": map[string]string{"type": "boolean"}}}},
			map[string]any{"name": "recut.media.attach", "description": "把现有媒体 assetId 引用到当前项目。", "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{"assetId": map[string]string{"type": "string"}}}},
		)
		for _, operation := range app.Manifest.Operations {
			if declaresOperation(app.Manifest, operation.Name, "mcp") {
				tools = append(tools, map[string]any{"name": app.Manifest.ID + "." + operation.Name, "description": operation.Description, "inputSchema": operation.InputSchema})
			}
		}
		return map[string]any{"tools": tools}, nil
	case "tools/call":
		input := struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}{}
		if err := json.Unmarshal(request.Params, &input); err != nil {
			return nil, err
		}
		if input.Name == "recut.project_context" {
			return projectContextTool(bridge, host, media, session)
		}
		if strings.HasPrefix(input.Name, "recut.media.") {
			return mediaMCPTool(media, session, input.Name, input.Arguments)
		}
		prefix := app.Manifest.ID + "."
		if len(input.Name) <= len(prefix) || input.Name[:len(prefix)] != prefix {
			return nil, fmt.Errorf("tool %q is outside the current App", input.Name)
		}
		result, err := host.InvokeMCP(project.ID, app.Manifest.ID, input.Name[len(prefix):], input.Arguments)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": result}, nil
	default:
		return nil, fmt.Errorf("unsupported MCP method %q", request.Method)
	}
}

func mediaMCPTool(media *MediaService, session AgentSession, name string, input map[string]any) (any, error) {
	var result any
	var err error
	switch name {
	case "recut.media.configuration":
		result, err = media.ConfiguredModels()
	case "recut.media.generate":
		capability, _ := input["capability"].(string)
		prompt, _ := input["text"].(string)
		route, _ := input["route"].(string)
		key, _ := input["idempotencyKey"].(string)
		references := mediaReferenceIDs(input)
		output, _ := input["output"].(map[string]any)
		result, err = media.GenerateSync(GenerateMediaInput{Capability: MediaCapability(capability), Prompt: prompt, Route: route, ReferenceIDs: references, Output: output, ProjectID: session.ProjectID, IdempotencyKey: key})
	case "recut.media.generate_async":
		capability, _ := input["capability"].(string)
		prompt, _ := input["text"].(string)
		route, _ := input["route"].(string)
		key, _ := input["idempotencyKey"].(string)
		references := mediaReferenceIDs(input)
		output, _ := input["output"].(map[string]any)
		result, err = media.Generate(GenerateMediaInput{Capability: MediaCapability(capability), Prompt: prompt, Route: route, ReferenceIDs: references, Output: output, ProjectID: session.ProjectID, IdempotencyKey: key})
	case "recut.media.get_job":
		id, _ := input["jobId"].(string)
		result, err = media.GetJob(id)
	case "recut.media.list_assets":
		workspace, _ := input["workspace"].(bool)
		projectID := session.ProjectID
		if workspace {
			projectID = ""
		}
		result, err = media.ListAssets(projectID)
	case "recut.media.attach":
		id, _ := input["assetId"].(string)
		err = media.Attach(id, session.ProjectID)
		result = map[string]any{"assetId": id, "projectId": session.ProjectID, "attached": err == nil}
	default:
		return nil, fmt.Errorf("unknown media tool %q", name)
	}
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": result}, nil
}

func stringsFromAny(value any) []string {
	values, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if item, ok := value.(string); ok {
			result = append(result, item)
		}
	}
	return result
}

func mediaReferenceIDs(input map[string]any) []string {
	return append(stringsFromAny(input["imageAssetIds"]), stringsFromAny(input["audioAssetIds"])...)
}

func projectContextTool(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession) (any, error) {
	context, err := bridge.Context(session)
	if err != nil {
		return nil, err
	}
	artifacts, err := bridge.store.ListArtifacts(session.ProjectID)
	if err != nil {
		return nil, err
	}
	workflow, workflowErr := host.InvokeMCP(session.ProjectID, context.Project.AppID, "workflow.context", map[string]any{})
	mediaConfiguration, mediaErr := media.ConfiguredModels()
	result := map[string]any{
		"project":      context.Project,
		"resourceRef":  context.ResourceRef,
		"revision":     context.Revision,
		"appState":     context.AppState,
		"instructions": context.Instructions,
		"artifacts":    artifacts,
	}
	if workflowErr == nil {
		result["workflow"] = workflow
	}
	if mediaErr == nil {
		result["media"] = map[string]any{"defaultRoutes": mediaConfiguration}
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": result}, nil
}
