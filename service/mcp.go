/*
 * [INPUT]: 依赖 AgentBridge 会话鉴权、AppHost JavaScript runtime 与标准输入输出 JSON-RPC 流
 * [OUTPUT]: 对外提供带默认媒体与音色契约的项目上下文，并将 manifest.mcp.tools 映射为受控 MCP 工具
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
		tools := make([]map[string]any, 0, len(app.Manifest.Operations)+8)
		tools = append(tools, map[string]any{
			"name":        "recut.project_context",
			"description": "读取当前 Recut 项目的身份、版本、App、可用 Artifact 与 Agent 约束。任何项目任务开始时先调用此工具。",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		})
		tools = append(tools, mediaMCPToolDefinitions()...)
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
		if isMediaMCPTool(input.Name) {
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
	case "recut.image.generate":
		result, err = media.GenerateSync(mediaGenerationInput(input, session, ImageGenerate))
	case "recut.video.generate_async":
		result, err = media.Generate(mediaGenerationInput(input, session, VideoGenerate))
	case "recut.speech.generate_async":
		result, err = media.Generate(mediaGenerationInput(input, session, SpeechGenerate))
	case "recut.media.list_voices":
		credentialID, _ := input["credentialId"].(string)
		result, err = media.ListVoices(credentialID)
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

func mediaMCPToolDefinitions() []map[string]any {
	return []map[string]any{
		{"name": "recut.media.configuration", "description": "读取最新媒体配置；通常无需调用，因为 recut.project_context 已携带默认 route、模型契约和可选参数。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "recut.image.generate", "description": "同步生成短时、阶段关键的图片。成功返回 assetIds；Provider 失败或超时直接返回错误。", "inputSchema": mediaGenerationSchema("生成提示词。", true, false, false)},
		{"name": "recut.video.generate_async", "description": "提交长时间运行的视频生成。Atlas 接受任务后立即返回 jobId 与处于 running 状态的稳定 assetIds；可立刻用 assetId 建立项目引用，后续同一 Asset 原位更新。具体模型支持的参考类型以 recut.project_context.media 为准。", "inputSchema": mediaGenerationSchema("生成提示词。", true, true, true)},
		{"name": "recut.speech.generate_async", "description": "提交长时间运行的语音生成。先用 recut.media.list_voices 查询当前凭据可用的 voiceId；立即返回 jobId。", "inputSchema": speechGenerationSchema()},
		{"name": "recut.media.list_voices", "description": "读取一个 MiniMax 或 ElevenLabs 凭据当前可用的音色，返回可直接传给 recut.speech.generate_async 的 voiceId。", "inputSchema": map[string]any{"type": "object", "required": []string{"credentialId"}, "properties": map[string]any{"credentialId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.get_job", "description": "读取媒体生成任务状态；异步视频提交成功时已返回稳定 assetIds，此工具只读取其后续 running/completed/failed 状态。", "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.list_assets", "description": "检索当前项目或工作区的可复用媒体素材。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"workspace": map[string]string{"type": "boolean"}}}},
		{"name": "recut.media.attach", "description": "把现有媒体 assetId 引用到当前项目。", "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{"assetId": map[string]string{"type": "string"}}}},
	}
}

func isMediaMCPTool(name string) bool {
	for _, tool := range mediaMCPToolDefinitions() {
		if tool["name"] == name {
			return true
		}
	}
	return false
}

func mediaGenerationSchema(textDescription string, imageReferences, videoReferences, audioReferences bool) map[string]any {
	properties := map[string]any{
		"text":           map[string]any{"type": "string", "description": textDescription},
		"route":          map[string]any{"type": "string", "description": "可选的同类媒体 route；未提供时使用项目默认 route。"},
		"output":         map[string]any{"type": "object", "description": "当前模型契约允许的可选输出参数。"},
		"idempotencyKey": map[string]any{"type": "string"},
	}
	if imageReferences {
		properties["imageAssetIds"] = map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "作为图片参考的全局 assetId。"}
	}
	if videoReferences {
		properties["videoAssetIds"] = map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "作为视频参考的全局 assetId。"}
	}
	if audioReferences {
		properties["audioAssetIds"] = map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "作为音频参考的全局 assetId。"}
	}
	return map[string]any{"type": "object", "required": []string{"text"}, "properties": properties}
}

func speechGenerationSchema() map[string]any {
	schema := mediaGenerationSchema("需要朗读的旁白文本。", false, false, false)
	schema["required"] = []string{"text", "voiceId"}
	properties := schema["properties"].(map[string]any)
	properties["voiceId"] = map[string]any{"type": "string", "description": "由 recut.media.list_voices 返回的当前 Provider 音色 ID。"}
	return schema
}

func mediaGenerationInput(input map[string]any, session AgentSession, capability MediaCapability) GenerateMediaInput {
	prompt, _ := input["text"].(string)
	route, _ := input["route"].(string)
	key, _ := input["idempotencyKey"].(string)
	output, _ := input["output"].(map[string]any)
	if output == nil {
		output = map[string]any{}
	} else {
		copied := map[string]any{}
		for key, value := range output {
			copied[key] = value
		}
		output = copied
	}
	if voiceID, _ := input["voiceId"].(string); voiceID != "" {
		output["voiceId"] = voiceID
	}
	return GenerateMediaInput{Capability: capability, Prompt: prompt, Route: route, ReferenceIDs: mediaReferenceIDs(input), Output: output, ProjectID: session.ProjectID, IdempotencyKey: key}
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
	ids := append([]string{}, stringsFromAny(input["imageAssetIds"])...)
	ids = append(ids, stringsFromAny(input["videoAssetIds"])...)
	return append(ids, stringsFromAny(input["audioAssetIds"])...)
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
