/*
 * [INPUT]: 依赖 AgentBridge 会话鉴权、AppHost JavaScript runtime 与标准输入输出 JSON-RPC 流
 * [OUTPUT]: 对外提供项目创建、带默认媒体与音色契约的项目上下文，并将 manifest.mcp.tools 映射为受控 MCP 工具
 * [POS]: service 的 MCP Host；App 不自行启动 MCP server，所有调用经平台权限与会话边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	var calls sync.WaitGroup
	var outputMu sync.Mutex
	var outputErr error
	for scanner.Scan() {
		request := mcpRequest{}
		if json.Unmarshal(scanner.Bytes(), &request) != nil || len(request.ID) == 0 {
			continue
		}
		calls.Add(1)
		go func(request mcpRequest) {
			defer calls.Done()
			result, callErr := handleMCP(bridge, host, media, session, request)
			response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(request.ID)}
			if callErr != nil {
				response["error"] = map[string]any{"code": -32000, "message": callErr.Error()}
			} else {
				response["result"] = result
			}
			data, _ := json.Marshal(response)
			outputMu.Lock()
			defer outputMu.Unlock()
			if outputErr == nil {
				_, outputErr = fmt.Fprintln(output, string(data))
			}
		}(request)
	}
	calls.Wait()
	if err := scanner.Err(); err != nil {
		return err
	}
	return outputErr
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
		tools := make([]map[string]any, 0, len(app.Manifest.Operations)+9)
		tools = append(tools, projectMCPToolDefinition())
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
		if input.Name == "recut.project.create" {
			return projectMCPTool(bridge.store, input.Arguments)
		}
		if isMediaMCPTool(input.Name) {
			return mediaMCPTool(bridge.store, media, session, input.Name, input.Arguments)
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

func projectMCPToolDefinition() map[string]any {
	return map[string]any{
		"name":        "recut.project.create",
		"description": "创建一个真实的 Recut 项目。仅当用户明确要求新建项目时调用；成功返回的 projectId 会出现在项目桌面。它不会创建 Brief、Artifact 或工作流资源。",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"name", "appId"},
			"properties": map[string]any{
				"name":  map[string]string{"type": "string", "description": "新项目的显示名称。"},
				"appId": map[string]string{"type": "string", "description": "承载该项目的已安装项目型 App ID。"},
			},
		},
	}
}

func projectMCPTool(store *Store, input map[string]any) (any, error) {
	name, _ := input["name"].(string)
	appID, _ := input["appId"].(string)
	project, err := store.Create(CreateInput{Name: name, AppID: appID})
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(project)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": project}, nil
}

func mediaMCPTool(store *Store, media *MediaService, session AgentSession, name string, input map[string]any) (any, error) {
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
	case "recut.media.import_image":
		result, err = importNativeImage(store, media, session, input)
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
		{"name": "recut.video.generate_async", "description": "提交长时间运行的视频生成。立即返回处于 queued 状态的稳定 jobId 与 assetIds；常驻 Daemon 接受 Atlas 任务后将同一 Asset 原位转为 running，再回收为 completed 或 failed。可立刻用 assetId 建立项目引用。具体模型支持的参考类型和输出参数以 recut.project_context.media 为准；Seedance 的 output.generateAudio 默认 true，Gemini 不支持该参数。", "inputSchema": mediaGenerationSchema("生成提示词。", true, true, true)},
		{"name": "recut.speech.generate_async", "description": "提交长时间运行的语音生成。先用 recut.media.list_voices 查询当前凭据可用的 voiceId；立即返回 jobId 与处于 queued 状态的稳定 assetIds，可先建立引用，Daemon 会在同一 Asset 上原位更新。", "inputSchema": speechGenerationSchema()},
		{"name": "recut.media.list_voices", "description": "读取一个 MiniMax 或 ElevenLabs 凭据当前可用的音色，返回可直接传给 recut.speech.generate_async 的 voiceId。", "inputSchema": map[string]any{"type": "object", "required": []string{"credentialId"}, "properties": map[string]any{"credentialId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.get_job", "description": "读取媒体生成任务状态；所有异步提交成功时已返回稳定 assetIds，此工具只读取其后续 queued/running/completed/failed 状态。", "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.list_assets", "description": "检索当前项目或工作区的可复用媒体素材。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"workspace": map[string]string{"type": "boolean"}}}},
		{"name": "recut.media.import_image", "description": "将 Codex 原生生成后已写入当前 Recut 项目目录的图片归档为当前项目的 Media Asset。只接受相对路径；服务端验证路径、符号链接、文件类型与大小，并返回真实 assetId。", "inputSchema": map[string]any{"type": "object", "required": []string{"path"}, "properties": map[string]any{"path": map[string]string{"type": "string", "description": "当前 Recut 项目目录内的相对图片路径。Codex 原生生成的结果必须先复制到此处。"}, "name": map[string]string{"type": "string", "description": "可选的素材显示名称。"}}}},
		{"name": "recut.media.attach", "description": "把现有媒体 assetId 引用到当前项目。", "inputSchema": map[string]any{"type": "object", "required": []string{"assetId"}, "properties": map[string]any{"assetId": map[string]string{"type": "string"}}}},
	}
}

func importNativeImage(store *Store, media *MediaService, session AgentSession, input map[string]any) (MediaAsset, error) {
	relativePath, _ := input["path"].(string)
	name, _ := input["name"].(string)
	if strings.TrimSpace(relativePath) == "" || filepath.IsAbs(relativePath) {
		return MediaAsset{}, fmt.Errorf("path must be a non-empty relative path inside the current Recut project")
	}
	root, err := filepath.EvalSymlinks(store.projectDir(session.ProjectID))
	if err != nil {
		return MediaAsset{}, fmt.Errorf("resolve current Recut project: %w", err)
	}
	path, err := filepath.EvalSymlinks(filepath.Join(root, filepath.Clean(relativePath)))
	if err != nil {
		return MediaAsset{}, fmt.Errorf("resolve image path: %w", err)
	}
	relativeToRoot, err := filepath.Rel(root, path)
	if err != nil || relativeToRoot == ".." || strings.HasPrefix(relativeToRoot, ".."+string(filepath.Separator)) {
		return MediaAsset{}, fmt.Errorf("path must remain inside the current Recut project")
	}
	info, err := os.Stat(path)
	if err != nil {
		return MediaAsset{}, err
	}
	if !info.Mode().IsRegular() {
		return MediaAsset{}, fmt.Errorf("path must point to a regular image file")
	}
	if info.Size() > 20<<20 {
		return MediaAsset{}, fmt.Errorf("image exceeds the 20 MB import limit")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return MediaAsset{}, err
	}
	mimeType := http.DetectContentType(content)
	if !strings.HasPrefix(mimeType, "image/") {
		return MediaAsset{}, fmt.Errorf("path must contain a supported image file")
	}
	if strings.TrimSpace(name) == "" {
		name = filepath.Base(path)
	}
	return media.ImportNativeImage(session.ProjectID, name, mimeType, content)
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
