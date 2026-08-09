/*
 * [INPUT]: 依赖 AgentBridge 会话鉴权、AppHost 双 target 运行时、Catalog 的 App 与 skill 树、MediaService 与 JSON-RPC 请求/响应模型
 * [OUTPUT]: 对外提供项目/App-state 双 target 解析、上下文 context（不携带项目默认值）、__recut target envelope、跨 App 的 operation 路由、平台工具（context/skills/apps/project/media）、结构化内容与按全局/App 分组的工具清单（GET /v1/mcp/tools）
 * [POS]: service 的 MCP Host；唯一监听者是常驻 Daemon 的 /v1/mcp（HTTP），所有 stdio 客户端（会话内 opencode/codex/claude 或外部 Agent）经无状态 --mcp 转发器接入，不启动 per-session 子进程；App 不自行启动 MCP server，所有调用经平台权限、目标解析与会话边界；平台工具无条件可见
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func handleMCP(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, request mcpRequest) (any, error) {
	switch request.Method {
	case "initialize":
		return map[string]any{"protocolVersion": "2025-03-26", "serverInfo": map[string]string{"name": "recut-mcp-host", "version": "0.3.0"}, "capabilities": map[string]any{"tools": map[string]any{}}}, nil
	case "tools/list":
		return mcpToolList(bridge, media), nil
	case "tools/call":
		input := struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}{}
		if err := json.Unmarshal(request.Params, &input); err != nil {
			return nil, err
		}
		return mcpToolCall(bridge, host, media, session, input.Name, input.Arguments)
	default:
		return nil, fmt.Errorf("unsupported MCP method %q", request.Method)
	}
}

func mcpToolList(bridge *AgentBridge, media *MediaService) map[string]any {
	tools := platformMCPToolDefinitions()
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return map[string]any{"tools": tools}
	}
	for _, app := range apps {
		tools = append(tools, appMCPToolDefinitions(app)...)
	}
	return map[string]any{"tools": tools}
}

// platformMCPToolDefinitions returns the global, App-agnostic MCP tools the
// platform always exposes: session context, apps/skills/project management,
// design system and media generation. They are unconditional and form the
// "全局" group in GET /v1/mcp/tools.
func platformMCPToolDefinitions() []map[string]any {
	tools := make([]map[string]any, 0)
	tools = append(tools,
		platformTool("recut.context", "读取当前 Recut 会话上下文：已安装 App（含绝对路径 root）、skill 目录、媒体配置与 .recut 文件系统路径（paths）。会话不绑定任何项目；需要项目信息时用 recut.project.list / recut.project.get 或 recut.project_context。任何任务开始时先调用此工具。", map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.list", "列出已安装 App（含 kind、skill 目录、Git 仓库、可更新状态与安装状态）。", map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.store", "列出 App Store 中可安装的 Recut App（appId、name、kind、GitHub repository、是否已安装）。需要安装时用 recut.apps.install 传入其 repository。", map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.install", "从一个 Git 仓库安装标准 Recut App（克隆、校验 manifest 后激活）。仅当用户明确要求安装该仓库时调用。", map[string]any{"type": "object", "required": []string{"repository"}, "properties": map[string]any{"repository": map[string]string{"type": "string", "description": "GitHub 仓库 URL（git@… 或 https://…）。"}}}),
		platformTool("recut.apps.update", "更新一个已安装 App（传 package）或全部已安装 App。仅当用户明确要求更新时调用。", map[string]any{"type": "object", "properties": map[string]any{"package": map[string]string{"type": "string", "description": "可选：要更新的 App 包名（如 recut-vox-broll）；缺省更新全部。"}}}),
		platformTool("recut.skills.list", "列出所有已安装 App 的 skill 目录（id、appId、name、description）。", map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.skills.read", "读取一个 App skill 的完整正文；该正文对对应 App 的工具契约与决策门有权威性。", map[string]any{"type": "object", "required": []string{"appId", "skillId"}, "properties": map[string]any{"appId": map[string]string{"type": "string"}, "skillId": map[string]string{"type": "string"}}}),
		platformTool("recut.skills.reference", "读取一个 skill 声明的引用/资源子文档。路径必须是该 skill 目录内前置声明的相对路径。", map[string]any{"type": "object", "required": []string{"appId", "skillId", "path"}, "properties": map[string]any{"appId": map[string]string{"type": "string"}, "skillId": map[string]string{"type": "string"}, "path": map[string]string{"type": "string"}}}),
		platformTool("recut.design_system.list", "列出 Recut 全局设计系统的全部可用风格（id / name / category / origin / description）。设计系统是业务无关的抽象视觉风格定义，直接复用 Open Design。", map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.design_system.get", "读取一套全局设计系统的完整视觉契约（DESIGN.md + tokens.css + 可用的 USAGE.md / manifest）。用返回的语义值实施风格，不手写无关十六进制。", map[string]any{"type": "object", "required": []string{"styleId"}, "properties": map[string]any{"styleId": map[string]string{"type": "string", "description": "设计系统 id，如 neobrutalism / glassmorphism / clean-editorial。"}}}),
		projectMCPToolDefinition(),
		platformTool("recut.project.list", "列出全部用户项目（Doc metadata：id、name、owner App、版本）。", map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.project.get", "读取一个项目的 Doc metadata。", map[string]any{"type": "object", "required": []string{"projectId"}, "properties": map[string]any{"projectId": map[string]string{"type": "string"}}}),
		platformTool("recut.project_context", "读取一个项目的深层上下文：owner App 的 workflow.context、已产出 Artifact、appState 与项目绝对路径（paths.projectFilesRoot）。", map[string]any{"type": "object", "required": []string{"projectId"}, "properties": map[string]any{"projectId": map[string]string{"type": "string", "description": "要读取上下文的 Project Doc ID。"}}}),
	)
	tools = append(tools, mediaMCPToolDefinitions()...)
	return tools
}

// appMCPToolDefinitions returns the MCP tools an App exposes through its
// declared operations: one tool per operation whose surfaces include "mcp".
func appMCPToolDefinitions(app App) []map[string]any {
	tools := make([]map[string]any, 0)
	for _, operation := range app.Manifest.Operations {
		if !declaresOperation(app.Manifest, operation.Name, "mcp") {
			continue
		}
		tools = append(tools, map[string]any{"name": app.Manifest.ID + "." + operation.Name, "description": operation.Description, "inputSchema": wrappedOperationSchema(operation)})
	}
	return tools
}

// mcpToolGroups splits the full MCP tool set into the platform's global tools
// and per-App groups, for the settings panel to render Recut-provided MCP
// services grouped by owning App. Apps without any MCP operation are omitted.
func mcpToolGroups(bridge *AgentBridge) map[string]any {
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return map[string]any{"global": platformMCPToolDefinitions(), "apps": []map[string]any{}}
	}
	appGroups := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		tools := appMCPToolDefinitions(app)
		if len(tools) == 0 {
			continue
		}
		appGroups = append(appGroups, map[string]any{
			"appId":       app.Manifest.ID,
			"name":        app.Manifest.Name,
			"kind":        string(app.Manifest.Kind),
			"description": app.Manifest.Description,
			"tools":       tools,
		})
	}
	return map[string]any{"global": platformMCPToolDefinitions(), "apps": appGroups}
}

func platformTool(name, description string, schema map[string]any) map[string]any {
	return map[string]any{"name": name, "description": description, "inputSchema": schema}
}

// wrappedOperationSchema copies the App schema and adds the __recut target
// envelope without mutating the App-owned contract. additionalProperties is
// relaxed at the host boundary so an App schema with additionalProperties: false
// still accepts a legal target.
func wrappedOperationSchema(operation Operation) map[string]any {
	schema := cloneJSONMap(operation.InputSchema)
	properties := map[string]any{}
	if existing, ok := schema["properties"].(map[string]any); ok {
		for key, value := range existing {
			properties[key] = value
		}
	}
	properties["__recut"] = map[string]any{
		"type": "object",
		"properties": map[string]any{
			"target": map[string]any{
				"type":     "object",
				"required": []string{"projectId"},
				"properties": map[string]any{
					"projectId": map[string]string{"type": "string", "description": "要操作的 Project Doc ID。仅接受 owner App 的项目；缺省则落到该 App 的全局状态。"},
				},
			},
		},
	}
	schema["properties"] = properties
	schema["additionalProperties"] = true
	return schema
}

func cloneJSONMap(value map[string]any) map[string]any {
	cloned := map[string]any{}
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}

func mcpToolCall(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, name string, arguments map[string]any) (any, error) {
	switch name {
	case "recut.context":
		return recutContextTool(bridge, media, session)
	case "recut.project_context":
		return projectContextTool(bridge, host, media, session, arguments)
	case "recut.project.create":
		return projectMCPTool(bridge.store, arguments)
	case "recut.project.list":
		projects, err := bridge.store.List()
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(projects)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(projects)}, nil
	case "recut.project.get":
		projectID, _ := arguments["projectId"].(string)
		project, err := bridge.store.Get(projectID)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(project)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(project)}, nil
	case "recut.apps.list":
		return appsListTool(bridge)
	case "recut.apps.store":
		return appStoreTool(bridge)
	case "recut.apps.install":
		return appsInstallTool(bridge, arguments)
	case "recut.apps.update":
		return appsUpdateTool(bridge, arguments)
	case "recut.skills.list":
		return skillsListTool(bridge)
	case "recut.skills.read":
		return skillReadTool(bridge, arguments)
	case "recut.skills.reference":
		return skillReferenceTool(bridge, arguments)
	case "recut.design_system.list":
		if bridge.designSystems == nil {
			return nil, errors.New("design-system skill is unavailable")
		}
		return designSystemListTool(bridge.designSystems)
	case "recut.design_system.get":
		if bridge.designSystems == nil {
			return nil, errors.New("design-system skill is unavailable")
		}
		return designSystemGetTool(bridge.designSystems, arguments)
	}
	if isMediaMCPTool(name) {
		return mediaMCPTool(bridge.store, media, session, name, arguments)
	}
	prefix, appID, ok := splitAppTool(name)
	if !ok {
		return nil, fmt.Errorf("tool %q is not a platform or App tool", name)
	}
	app, ok := bridge.store.catalog.Get(appID)
	if !ok {
		return nil, fmt.Errorf("app %q is unavailable", appID)
	}
	operationName := name[len(prefix):]
	if !declaresOperation(app.Manifest, operationName, "mcp") {
		return nil, fmt.Errorf("App %q does not expose MCP operation %q", appID, operationName)
	}
	target, args, err := resolveAppTarget(bridge, app, arguments)
	if err != nil {
		return nil, err
	}
	result, err := host.InvokeMCP(target, appID, operationName, args)
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func splitAppTool(name string) (prefix, appID string, ok bool) {
	parts := strings.Split(name, ".")
	if len(parts) < 3 {
		return "", "", false
	}
	appID = strings.Join(parts[:2], ".")
	return appID + ".", appID, true
}

// resolveAppTarget applies the target resolution rules: explicit __recut.target
// > App global state. The __recut field is stripped and never reaches
// background.js. Sessions never carry a default Project; the model must pass an
// explicit target to operate on a Project.
func resolveAppTarget(bridge *AgentBridge, app App, arguments map[string]any) (Target, map[string]any, error) {
	args := map[string]any{}
	for key, value := range arguments {
		if key != "__recut" {
			args[key] = value
		}
	}
	projectID := explicitProjectID(arguments)
	if projectID != "" {
		if err := bridge.store.projectOwnedBy(projectID, app.Manifest.ID); err != nil {
			return Target{}, nil, fmt.Errorf("invalid target %q: %w", projectID, err)
		}
		return Target{ProjectID: projectID, AppID: app.Manifest.ID}, args, nil
	}
	return Target{AppID: app.Manifest.ID}, args, nil
}

func explicitProjectID(arguments map[string]any) string {
	recut, ok := arguments["__recut"].(map[string]any)
	if !ok {
		return ""
	}
	target, ok := recut["target"].(map[string]any)
	if !ok {
		return ""
	}
	projectID, _ := target["projectId"].(string)
	return strings.TrimSpace(projectID)
}

// requestedProjectID resolves a Project target for platform tools (media,
// import_image) that have no App owner: __recut target > explicit argument.
func requestedProjectID(arguments map[string]any) string {
	if projectID := explicitProjectID(arguments); projectID != "" {
		return projectID
	}
	if projectID, _ := arguments["projectId"].(string); strings.TrimSpace(projectID) != "" {
		return strings.TrimSpace(projectID)
	}
	return ""
}

func recutContextTool(bridge *AgentBridge, media *MediaService, session AgentSession) (any, error) {
	apps, _ := bridge.store.catalog.List()
	appSummaries := make([]map[string]any, 0, len(apps))
	skillSummary := make([]map[string]any, 0)
	for _, app := range apps {
		skills, err := app.Skills()
		if err != nil {
			continue
		}
		summary := map[string]any{"appId": app.Manifest.ID, "name": app.Manifest.Name, "kind": string(app.Manifest.Kind), "description": app.Manifest.Description, "root": app.Root}
		skillsMeta := make([]map[string]any, 0, len(skills))
		for _, skill := range skills {
			skillsMeta = append(skillsMeta, map[string]any{"id": skill.ID, "name": skill.Name, "description": skill.Description})
			skillSummary = append(skillSummary, map[string]any{"id": skill.ID, "appId": app.Manifest.ID, "name": skill.Name, "description": skill.Description})
		}
		summary["skills"] = skillsMeta
		appSummaries = append(appSummaries, summary)
	}
	var mediaConfiguration any
	if media != nil {
		if configured, err := media.ConfiguredModels(); err == nil {
			mediaConfiguration = configured
		}
	}
	result := map[string]any{
		"session":      map[string]any{"id": session.ID, "taskId": session.TaskID},
		"apps":         appSummaries,
		"skills":       skillSummary,
		"media":        map[string]any{"defaultRoutes": mediaConfiguration},
		"paths": map[string]any{
			"dataRoot":         bridge.store.root,
			"appsDir":          filepath.Join(bridge.store.root, "apps"),
			"projectsDir":      filepath.Join(bridge.store.root, "projects"),
			"sessionWorkspace": bridge.store.SessionWorkspaceDir(session.ID),
			"mediaDir":         filepath.Join(bridge.store.root, "media"),
			"modelsDir":        filepath.Join(bridge.store.root, "models"),
			"designSystemsDir": filepath.Join(bridge.store.root, "skills", designSystemSkillID),
		},
		"instructions": bridgeInstructions,
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func appsListTool(bridge *AgentBridge) (any, error) {
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return nil, err
	}
	installations, _ := bridge.store.catalog.Installations()
	installByID := map[string]AppInstallation{}
	for _, installation := range installations {
		installByID[installation.Manifest.ID] = installation
	}
	result := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		skills, _ := app.Skills()
		skillsMeta := make([]map[string]any, 0, len(skills))
		for _, skill := range skills {
			skillsMeta = append(skillsMeta, map[string]any{"id": skill.ID, "name": skill.Name, "description": skill.Description})
		}
		entry := map[string]any{"appId": app.Manifest.ID, "name": app.Manifest.Name, "kind": string(app.Manifest.Kind), "description": app.Manifest.Description, "skills": skillsMeta}
		if installation, ok := installByID[app.Manifest.ID]; ok {
			entry["package"] = installation.Package
			entry["repository"] = installation.Repository
			entry["revision"] = installation.Revision
			entry["dirty"] = installation.Dirty
			entry["updateAvailable"] = installation.UpdateAvailable
			entry["manageable"] = installation.Manageable
			entry["status"] = installation.Status
		}
		result = append(result, entry)
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func appStoreTool(bridge *AgentBridge) (any, error) {
	store, err := bridge.store.AppStore()
	if err != nil {
		return nil, err
	}
	installed := map[string]bool{}
	for _, app := range bridge.store.catalog.snapshotApps() {
		installed[app.Manifest.ID] = true
	}
	result := make([]map[string]any, 0, len(store))
	for _, app := range store {
		result = append(result, map[string]any{
			"appId": app.AppID, "name": app.Name, "description": app.Description,
			"kind": app.Kind, "repository": app.Repository, "installed": installed[app.AppID],
		})
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func appsInstallTool(bridge *AgentBridge, arguments map[string]any) (any, error) {
	repository, _ := arguments["repository"].(string)
	if strings.TrimSpace(repository) == "" {
		return nil, errors.New("repository is required")
	}
	installed, err := bridge.store.catalog.InstallGitHub(strings.TrimSpace(repository))
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(installed)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(installed)}, nil
}

func appsUpdateTool(bridge *AgentBridge, arguments map[string]any) (any, error) {
	packageName, _ := arguments["package"].(string)
	if strings.TrimSpace(packageName) != "" {
		updated, err := bridge.store.catalog.UpdateInstallation(strings.TrimSpace(packageName))
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(updated)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(updated)}, nil
	}
	result, err := bridge.store.catalog.UpdateInstallations()
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func skillsListTool(bridge *AgentBridge) (any, error) {
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return nil, err
	}
	result := []map[string]any{}
	for _, app := range apps {
		skills, err := app.Skills()
		if err != nil {
			continue
		}
		for _, skill := range skills {
			result = append(result, map[string]any{"id": skill.ID, "appId": app.Manifest.ID, "name": skill.Name, "description": skill.Description})
		}
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

func skillReadTool(bridge *AgentBridge, arguments map[string]any) (any, error) {
	appID, _ := arguments["appId"].(string)
	skillID, _ := arguments["skillId"].(string)
	app, ok := bridge.store.catalog.Get(appID)
	if !ok {
		return nil, fmt.Errorf("app %q is unavailable", appID)
	}
	skills, err := app.Skills()
	if err != nil {
		return nil, err
	}
	for _, skill := range skills {
		if skill.ID == skillID {
			data, _ := json.Marshal(map[string]any{"id": skill.ID, "appId": skill.AppID, "name": skill.Name, "description": skill.Description, "body": skill.Body, "references": skill.References, "resources": skill.Resources})
			return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(map[string]any{"id": skill.ID, "appId": skill.AppID, "name": skill.Name, "description": skill.Description, "body": skill.Body, "references": skill.References, "resources": skill.Resources})}, nil
		}
	}
	return nil, fmt.Errorf("skill %q is not provided by app %q", skillID, appID)
}

func skillReferenceTool(bridge *AgentBridge, arguments map[string]any) (any, error) {
	appID, _ := arguments["appId"].(string)
	skillID, _ := arguments["skillId"].(string)
	path, _ := arguments["path"].(string)
	app, ok := bridge.store.catalog.Get(appID)
	if !ok {
		return nil, fmt.Errorf("app %q is unavailable", appID)
	}
	skills, err := app.Skills()
	if err != nil {
		return nil, err
	}
	for _, skill := range skills {
		if skill.ID != skillID {
			continue
		}
		root, err := filepath.EvalSymlinks(skill.Root)
		if err != nil {
			return nil, fmt.Errorf("resolve skill root: %w", err)
		}
		resolved, err := filepath.EvalSymlinks(filepath.Join(root, filepath.Clean(path)))
		if err != nil {
			return nil, fmt.Errorf("resolve skill reference: %w", err)
		}
		relative, err := filepath.Rel(root, resolved)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("skill reference escapes the skill directory")
		}
		info, err := os.Stat(resolved)
		if err != nil || info.IsDir() {
			return nil, fmt.Errorf("skill reference is unavailable")
		}
		content, err := os.ReadFile(resolved)
		if err != nil {
			return nil, err
		}
		result := map[string]any{"appId": appID, "skillId": skillID, "path": filepath.ToSlash(relative), "content": string(content)}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
	}
	return nil, fmt.Errorf("skill %q is not provided by app %q", skillID, appID)
}

func projectMCPToolDefinition() map[string]any {
	return map[string]any{
		"name":        "recut.project.create",
		"description": "创建一个真实的 Recut Project Doc。仅当用户明确要求新建项目时调用；成功返回的 projectId 会出现在项目桌面。它不会创建 Brief、Artifact 或工作流资源。",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"name", "appId"},
			"properties": map[string]any{
				"name":  map[string]string{"type": "string", "description": "新项目的显示名称。"},
				"appId": map[string]string{"type": "string", "description": "承载该项目的 owner App ID。"},
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
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(project)}, nil
}

func mediaMCPTool(store *Store, media *MediaService, session AgentSession, name string, input map[string]any) (any, error) {
	var result any
	var err error
	switch name {
	case "recut.image.generate":
		result, err = media.GenerateSync(mediaGenerationInput(input, ImageGenerate))
	case "recut.video.generate_async":
		result, err = media.Generate(mediaGenerationInput(input, VideoGenerate))
	case "recut.speech.generate_async":
		result, err = media.Generate(mediaGenerationInput(input, SpeechGenerate))
	case "recut.media.list_voices":
		credentialID, _ := input["credentialId"].(string)
		result, err = media.ListVoices(credentialID)
	case "recut.media.get_job":
		id, _ := input["jobId"].(string)
		result, err = media.GetJob(id)
	case "recut.media.wait_for_job":
		id, _ := input["jobId"].(string)
		result, err = media.WaitForTerminalJob(id, mediaWaitTimeout(input))
	case "recut.media.list_assets":
		workspace, _ := input["workspace"].(bool)
		projectID := requestedProjectID(input)
		if workspace {
			projectID = ""
		}
		result, err = media.ListAssets(projectID)
	case "recut.media.import_image":
		result, err = importNativeImage(store, media, session, input)
	case "recut.media.attach":
		id, _ := input["assetId"].(string)
		err = media.Attach(id, requestedProjectID(input))
		result = map[string]any{"assetId": id, "projectId": requestedProjectID(input), "attached": err == nil}
	default:
		return nil, fmt.Errorf("unknown media tool %q", name)
	}
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

// OpenCode 将 MCP structuredContent 校验为 record。文本负载保留原始结果，
// 仅把列表装入稳定的对象信封。
func structuredMCPContent(result any) any {
	value := reflect.ValueOf(result)
	if value.IsValid() && (value.Kind() == reflect.Array || value.Kind() == reflect.Slice) {
		return map[string]any{"items": result}
	}
	return result
}

func mediaMCPToolDefinitions() []map[string]any {
	return []map[string]any{
		{"name": "recut.image.generate", "description": "同步生成短时、阶段关键的图片。成功返回 assetIds；Provider 失败或超时直接返回错误。", "inputSchema": mediaGenerationSchema("生成提示词。", true, false, false)},
		{"name": "recut.video.generate_async", "description": "提交长时间运行的视频生成。立即返回处于 queued 状态的稳定 jobId 与 assetIds；常驻 Daemon 接受 Atlas 任务后将同一 Asset 原位转为 running，再回收为 completed 或 failed。可立刻用 assetId 建立项目引用。", "inputSchema": mediaGenerationSchema("生成提示词。", true, true, true)},
		{"name": "recut.speech.generate_async", "description": "提交长时间运行的语音生成。先用 recut.media.list_voices 查询当前凭据可用的 voiceId；立即返回 jobId 与处于 queued 状态的稳定 assetIds。", "inputSchema": speechGenerationSchema()},
		{"name": "recut.media.list_voices", "description": "读取一个 MiniMax 或 ElevenLabs 凭据当前可用的音色。", "inputSchema": map[string]any{"type": "object", "required": []string{"credentialId"}, "properties": map[string]any{"credentialId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.get_job", "description": "读取媒体生成任务状态。", "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.wait_for_job", "description": "等待本地 Daemon 已提交的媒体任务达到 completed 或 failed。", "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}, "timeoutSeconds": map[string]any{"type": "number", "minimum": 1, "maximum": 300, "description": "最长等待秒数，默认且最大为 300。"}}}},
		{"name": "recut.media.list_assets", "description": "检索工作区或指定项目的可复用媒体素材。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"projectId": map[string]string{"type": "string", "description": "可选的 Project target；缺省返回 workspace 级素材。"}, "workspace": map[string]string{"type": "boolean"}}}},
		{"name": "recut.media.import_image", "description": "将 Codex 原生生成后已写入会话工作区的图片归档为 Media Asset。只接受相对路径；服务端验证路径、符号链接、文件类型与大小，并返回真实 assetId。", "inputSchema": map[string]any{"type": "object", "required": []string{"path"}, "properties": map[string]any{"path": map[string]string{"type": "string", "description": "会话工作区内的相对图片路径。"}, "name": map[string]string{"type": "string", "description": "可选的素材显示名称。"}, "projectId": map[string]string{"type": "string", "description": "可选的 Project target；缺省落到 workspace 级素材。"}}}},
		{"name": "recut.media.attach", "description": "把现有媒体 assetId 引用到目标项目。", "inputSchema": map[string]any{"type": "object", "required": []string{"assetId", "projectId"}, "properties": map[string]any{"assetId": map[string]string{"type": "string"}, "projectId": map[string]string{"type": "string"}}}},
	}
}

func mediaWaitTimeout(input map[string]any) time.Duration {
	seconds, _ := input["timeoutSeconds"].(float64)
	maximum := (5 * time.Minute).Seconds()
	if seconds <= 0 || seconds > maximum {
		seconds = maximum
	}
	return time.Duration(seconds * float64(time.Second))
}

func importNativeImage(store *Store, media *MediaService, session AgentSession, input map[string]any) (MediaAsset, error) {
	relativePath, _ := input["path"].(string)
	name, _ := input["name"].(string)
	if strings.TrimSpace(relativePath) == "" || filepath.IsAbs(relativePath) {
		return MediaAsset{}, fmt.Errorf("path must be a non-empty relative path")
	}
	// The import base is always the session workspace. Native images are
	// written into the workspace root; a resolved file must stay inside the
	// workspace or an explicitly targeted Project root.
	base, err := filepath.EvalSymlinks(store.SessionWorkspaceDir(session.ID))
	if err != nil {
		return MediaAsset{}, err
	}
	path, err := filepath.EvalSymlinks(filepath.Join(base, filepath.Clean(relativePath)))
	if err != nil {
		return MediaAsset{}, fmt.Errorf("resolve image path: %w", err)
	}
	allowedRoots := []string{base}
	projectID := requestedProjectID(input)
	if projectID != "" {
		if projectRoot, rootErr := filepath.EvalSymlinks(store.projectDir(projectID)); rootErr == nil {
			allowedRoots = append(allowedRoots, projectRoot)
		}
	}
	if !withinAllowedRoots(allowedRoots, path) {
		return MediaAsset{}, fmt.Errorf("path must remain inside the session workspace or the target Project")
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
	return media.ImportNativeImage(projectID, name, mimeType, content)
}

func withinAllowedRoots(roots []string, path string) bool {
	for _, root := range roots {
		relative, err := filepath.Rel(root, path)
		if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative) {
			return true
		}
	}
	return false
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

func mediaGenerationInput(input map[string]any, capability MediaCapability) GenerateMediaInput {
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
	return GenerateMediaInput{Capability: capability, Prompt: prompt, Route: route, ReferenceIDs: mediaReferenceIDs(input), Output: output, ProjectID: requestedProjectID(input), IdempotencyKey: key}
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

func projectContextTool(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, arguments map[string]any) (any, error) {
	projectID, _ := arguments["projectId"].(string)
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, fmt.Errorf("projectId is required")
	}
	result := map[string]any{
		"session":      map[string]any{"id": session.ID, "taskId": session.TaskID},
		"instructions": bridgeInstructions,
		"apps":         []map[string]any{},
		"skills":       []map[string]any{},
	}
	project, err := bridge.store.Get(projectID)
	if err != nil {
		return nil, fmt.Errorf("project %q is unavailable", projectID)
	}
	workflow, workflowErr := host.InvokeMCP(Target{ProjectID: project.ID, AppID: project.AppID}, project.AppID, "workflow.context", map[string]any{})
	if workflowErr == nil {
		result["workflow"] = workflow
	}
	artifacts, _ := bridge.store.ListArtifacts(projectID)
	result["project"] = project
	result["artifacts"] = artifacts
	result["appState"] = map[string]any{"appId": project.AppID}
	if filesRoot, err := bridge.store.ProjectFilesRoot(projectID); err == nil {
		result["paths"] = map[string]any{"projectDir": bridge.store.projectDir(projectID), "projectFilesRoot": filesRoot}
	}
	if media != nil {
		if configured, err := media.ConfiguredModels(); err == nil {
			result["media"] = map[string]any{"defaultRoutes": configured}
		}
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}
