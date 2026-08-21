/*
 * [INPUT]: 依赖 AgentBridge 会话鉴权、AppHost 双 target 运行时、Catalog 的 App 与 skill 树、MediaService 与 JSON-RPC 请求/响应模型
 * [OUTPUT]: 对外提供项目/App-state target 解析、Skill 读取、跨 App operation 路由、受限 Component Author 调度及平台工具清单
 * [POS]: service 的 MCP Host；不把页面上下文变成全局 capability 或 operation 权限限制
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
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

// mcpToolDescriptions holds the tool-level MCP descriptions in zh (the service
// default) and en. Schema-internal per-property descriptions are not localized
// yet; see D12.
var mcpToolDescriptions = map[string]map[Locale]string{
	"recut.context": {
		LocaleZh: "读取当前 Recut 会话上下文：已安装 App（含绝对路径 root）、Skill 元数据、媒体配置、可选集成能力状态与 .recut 文件系统路径（paths）。新 native session 或能力状态可能变化时调用；同一会话 15 分钟内复用已确认快照。会话不绑定任何项目；需要项目信息时用 recut.project.list / recut.project.get 或 recut.project_context。",
		LocaleEn: "Read the current Recut session context: installed Apps (including absolute root paths), Skill metadata, media configuration, optional integration readiness, and .recut filesystem paths (paths). Call it for a new native session or when capability state may have changed; reuse a confirmed snapshot for 15 minutes within the same session. The session is not bound to a Project; use recut.project.list / recut.project.get or recut.project_context when you need project information.",
	},
	"recut.apps.list": {
		LocaleZh: "列出已安装 App（含 kind、skill 目录、Git 仓库、可更新状态与安装状态）。",
		LocaleEn: "List installed Apps (kind, skill directory, Git repository, update availability, and installation status).",
	},
	"recut.apps.store": {
		LocaleZh: "列出 App Store 中可安装的 Recut App（appId、name、kind、GitHub repository、是否已安装）。需要安装时用 recut.apps.install 传入其 repository。",
		LocaleEn: "List installable Recut Apps in the App Store (appId, name, kind, GitHub repository, and whether already installed). Use recut.apps.install with its repository to install one.",
	},
	"recut.apps.install": {
		LocaleZh: "从一个 Git 仓库安装标准 Recut App（克隆、校验 manifest 后激活）。仅当用户明确要求安装该仓库时调用。",
		LocaleEn: "Install a standard Recut App from a Git repository (clone, validate the manifest, then activate). Call it only when the user explicitly asks to install that repository.",
	},
	"recut.apps.update": {
		LocaleZh: "更新一个已安装 App（传 package）或全部已安装 App。仅当用户明确要求更新时调用。",
		LocaleEn: "Update one installed App (pass its package) or all installed Apps. Call it only when the user explicitly asks to update.",
	},
	"recut.skills.list": {
		LocaleZh: "列出所有已安装 App 的 skill 目录（id、appId、name、description）。",
		LocaleEn: "List the skill directories of all installed Apps (id, appId, name, description).",
	},
	"recut.skills.read": {
		LocaleZh: "读取一个 App skill 的完整正文；该正文对对应 App 的工具契约与决策门有权威性。",
		LocaleEn: "Read the full body of an App skill; it is authoritative for that App's tool contracts and decision gates.",
	},
	"recut.skills.reference": {
		LocaleZh: "读取一个 skill 声明的引用/资源子文档。路径必须是该 skill 目录内前置声明的相对路径。",
		LocaleEn: "Read a reference/resource sub-document declared by a skill. The path must be a relative path declared inside that skill's directory.",
	},
	"recut.design_system.list": {
		LocaleZh: "列出 Recut 全局设计系统的全部可用风格（id / name / category / origin / description）。设计系统是业务无关的抽象视觉风格定义，直接复用 Open Design。",
		LocaleEn: "List all available styles in the Recut global design system (id / name / category / origin / description). The design system defines business-agnostic abstract visual styles, reused from Open Design.",
	},
	"recut.design_system.get": {
		LocaleZh: "读取一套全局设计系统的完整视觉契约（DESIGN.md + tokens.css + 可用的 USAGE.md / manifest）。用返回的语义值实施风格，不手写无关十六进制。",
		LocaleEn: "Read the complete visual contract of a global design system (DESIGN.md + tokens.css + available USAGE.md / manifest). Implement the style with the returned semantic values; do not hand-write unrelated hex codes.",
	},
	"recut.project.create": {
		LocaleZh: "创建一个真实的 Recut Project Doc。仅当用户明确要求新建项目时调用；成功返回的 projectId 会出现在项目桌面。它不会创建 Brief、Artifact 或工作流资源。",
		LocaleEn: "Create a real Recut Project Doc. Call it only when the user explicitly asks to create a project; the returned projectId appears on the project desktop. It does not create Brief, Artifact, or workflow resources.",
	},
	"recut.project.list": {
		LocaleZh: "列出全部用户项目（Doc metadata：id、name、owner App、版本）。",
		LocaleEn: "List all user projects (Doc metadata: id, name, owner App, version).",
	},
	"recut.project.get": {
		LocaleZh: "读取一个项目的 Doc metadata。",
		LocaleEn: "Read a project's Doc metadata.",
	},
	"recut.project_context": {
		LocaleZh: "读取一个项目的深层上下文：owner App 的 workflow.context、已产出 Artifact、appState 与项目绝对路径（paths.projectFilesRoot）。",
		LocaleEn: "Read a project's deep context: the owner App's workflow.context, produced Artifacts, appState, and the project's absolute paths (paths.projectFilesRoot).",
	},
	"recut.job.status": {
		LocaleZh: "读取一个任务（job）的当前状态：queued / running / completed / failed / cancelled / interrupted。统一观察层同时覆盖本地 App shell job（如 audio.install/transcribe、depth.generate、render.export）与平台媒体生成 job（recut.image/video/speech.generate 返回的 jobId）；返回视图带 kind 区分 shell / media。",
		LocaleEn: "Read the current status of a job: queued / running / completed / failed / cancelled / interrupted. The unified observation layer covers both local App shell jobs (e.g. audio.install/transcribe, depth.generate, render.export) and platform media generation jobs (jobIds returned by recut.image/video/speech.generate); the returned view carries a kind of shell or media.",
	},
	"recut.job.wait": {
		LocaleZh: "等待一个任务（job）达到终态（completed / interrupted / failed / cancelled），sub-agent / shell / media job 通用。等待是短窗口轮询（单次最多 15s），超时返回当前状态而不报错，可继续用 recut.job.status 继续轮询。",
		LocaleEn: "Wait for a job to reach a terminal state (completed / interrupted / failed / cancelled), working for sub-agent, shell, and media jobs. Waiting is a short-window poll (at most 15s per call); on timeout it returns the current state without error, keep polling with recut.job.status.",
	},
	"recut.job.logs": {
		LocaleZh: "读取本地 App shell job 的 stdout/stderr 日志，或子 Agent job 的当前视图（含 toolCalls 提交账本），供失败诊断；媒体生成 job 无进程日志。",
		LocaleEn: "Read the stdout/stderr logs of a local App shell job, or a sub-agent job's current view (including the toolCalls commit ledger) for failure diagnosis; media generation jobs have no process logs.",
	},
	"recut.job.cancel": {
		LocaleZh: "取消一个 queued / running 的本地 App shell job 或子 Agent job（sub-agent job 取消会传播到子 CLI 进程；已提交的部分结果仍会被 finalize 并以 interrupted 终态呈现）。",
		LocaleEn: "Cancel a queued or running local App shell job or a sub-agent job (cancellation propagates to the child CLI process; already committed partial results are still finalized and surfaced as an interrupted terminal state).",
	},
	"recut.image.generate": {
		LocaleZh: "提交图片生成任务。立即返回处于 queued 状态的稳定 jobId 与 assetIds；常驻 Daemon 完成后将同一 Asset 原位转为 completed 或 failed。可立刻用 assetId 建立项目引用，再用 recut.media.wait_for_job 等待终态。",
		LocaleEn: "Submit an image generation job. It immediately returns a stable queued jobId and assetIds; the persistent Daemon moves the same Asset to completed or failed in place. You may create project references with the assetId right away, then use recut.media.wait_for_job to await the terminal state.",
	},
	"recut.video.generate": {
		LocaleZh: "提交长时间运行的视频生成。立即返回处于 queued 状态的稳定 jobId 与 assetIds；常驻 Daemon 接受 Atlas 任务后将同一 Asset 原位转为 running，再回收为 completed 或 failed。可立刻用 assetId 建立项目引用。",
		LocaleEn: "Submit a long-running video generation. It immediately returns a stable queued jobId and assetIds; after the persistent Daemon accepts the Atlas task, the same Asset moves to running in place and is later reclaimed as completed or failed. Create project references with the assetId right away.",
	},
	"recut.speech.generate": {
		LocaleZh: "提交长时间运行的语音生成。云端路由先用 recut.media.list_voices 查询凭据可用的 voiceId；本机 TTS 路由可省略 voiceId（用 Audio Studio 默认音，或经其 audio.synthesize/audio.save）。立即返回 jobId 与处于 queued 状态的稳定 assetIds。",
		LocaleEn: "Submit a long-running speech generation. For cloud routes first query the credential's available voiceId with recut.media.list_voices; the local TTS route may omit voiceId (Audio Studio default voice, or use audio.synthesize/audio.save). It immediately returns a jobId and stable queued assetIds.",
	},
	"recut.media.list_voices": {
		LocaleZh: "读取当前可用音色：云端凭据（MiniMax/ElevenLabs）的音色，或本机 TTS 的 Audio Studio 默认音（credentialId 传 local-audio 或留空）。",
		LocaleEn: "Read currently available voices: those of a cloud credential (MiniMax/ElevenLabs), or the Audio Studio default voice for local TTS (pass credentialId local-audio or leave it empty).",
	},
	"recut.media.get_job": {
		LocaleZh: "读取媒体生成任务状态。",
		LocaleEn: "Read a media generation job's status.",
	},
	"recut.media.wait_for_job": {
		LocaleZh: "等待本地 Daemon 已提交的媒体任务达到 completed 或 failed。",
		LocaleEn: "Wait for a media job submitted to the local Daemon to reach completed or failed.",
	},
	"recut.media.list_assets": {
		LocaleZh: "检索工作区或指定项目的可复用媒体素材。",
		LocaleEn: "Search reusable media assets in the workspace or a specific project.",
	},
	"recut.media.import_image": {
		LocaleZh: "将 Codex 原生生成后已写入会话工作区的图片归档为 Media Asset。只接受相对路径；服务端验证路径、符号链接、文件类型与大小，并返回真实 assetId。",
		LocaleEn: "Archive an image written to the session workspace by Codex-native generation as a Media Asset. Only relative paths are accepted; the service validates the path, symlinks, file type, and size, and returns the real assetId.",
	},
	"recut.media.create_reference": {
		LocaleZh: "把文章、网页、YouTube、小红书、抖音等公开链接登记为可跨项目复用的全局 reference Asset。URL 是唯一身份并按规范 URL 去重；可同时提交正文全文（article/web 的真实文章数据）、base64 图片（真实图片数据）与尽量完整的平台元数据。正文与图片作为不可变 parts 随素材保存，可经素材 parts 接口审阅；服务本身不抓取或下载外部内容。",
		LocaleEn: "Register a public link (article, web, YouTube, Xiaohongshu, Douyin, etc.) as a reusable global reference Asset across projects. The URL is the unique identity and is deduplicated by canonical URL; you may submit the full body text (real article data for article/web), a base64 image (real image data), and as complete platform metadata as possible. The body and image are saved as immutable parts with the asset and can be reviewed through the asset parts API; the service itself never fetches or downloads external content.",
	},
	"recut.media.attach": {
		LocaleZh: "把现有媒体 assetId 引用到目标项目。",
		LocaleEn: "Attach an existing media assetId to a target project.",
	},
}

// mcpDescription resolves a tool-level MCP description for the requested
// locale, falling back to the zh default.
func mcpDescription(locale Locale, key string) string {
	if localized, ok := mcpToolDescriptions[key]; ok {
		if text, ok := localized[locale]; ok && text != "" {
			return text
		}
		if text, ok := localized[LocaleZh]; ok {
			return text
		}
	}
	return key
}

func handleMCP(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, request mcpRequest) (any, error) {
	locale := DefaultLocale
	if bridge != nil && bridge.store != nil {
		locale, _ = bridge.store.StoredLocale()
	}
	switch request.Method {
	case "initialize":
		return map[string]any{"protocolVersion": "2025-03-26", "serverInfo": map[string]string{"name": "recut-mcp-host", "version": "0.3.0"}, "capabilities": map[string]any{"tools": map[string]any{}}}, nil
	case "tools/list":
		return mcpToolListForSession(bridge, media, session, locale), nil
	case "tools/call":
		input := struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}{}
		if err := json.Unmarshal(request.Params, &input); err != nil {
			return nil, err
		}
		return mcpToolCall(bridge, host, media, session, input.Name, input.Arguments, locale)
	default:
		return nil, fmt.Errorf("unsupported MCP method %q", request.Method)
	}
}

func mcpToolList(bridge *AgentBridge, media *MediaService, locale Locale) map[string]any {
	return mcpToolListForSession(bridge, media, AgentSession{}, locale)
}

func mcpToolListForSession(bridge *AgentBridge, media *MediaService, session AgentSession, locale Locale) map[string]any {
	tools := platformMCPToolDefinitions(locale)
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return map[string]any{"tools": filterSessionTools(tools, session)}
	}
	for _, app := range apps {
		tools = append(tools, appMCPToolDefinitions(app)...)
	}
	if session.AllowsTool("recut.editor.component.commit") && len(session.AllowedTools) > 0 {
		tools = append(tools, componentCommitToolDefinition(locale))
	}
	return map[string]any{"tools": filterSessionTools(tools, session)}
}

func filterSessionTools(tools []map[string]any, session AgentSession) []map[string]any {
	if len(session.AllowedTools) == 0 {
		return tools
	}
	filtered := make([]map[string]any, 0, len(session.AllowedTools))
	for _, tool := range tools {
		name, _ := tool["name"].(string)
		if session.AllowsTool(name) {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

func componentCommitToolDefinition(locale Locale) map[string]any {
	return platformTool("recut.editor.component.commit", map[Locale]string{
		LocaleZh: "提交一个已完成的项目私有组件素材。只在 Component Author 完成创作后调用一次；平台构建、入库并安排验证，绝不插入时间线。",
		LocaleEn: "Commit one finished private component asset. Call exactly once when Component Author finishes; the platform builds, stores, and schedules verification, never a timeline placement.",
	}[locale], map[string]any{
		"type":     "object",
		"required": []string{"name", "surface", "source"},
		"properties": map[string]any{
			"name":     map[string]string{"type": "string"},
			"surface":  map[string]any{"type": "string", "enum": []string{"html", "react", "r3f"}},
			"keywords": map[string]any{"type": "array", "items": map[string]string{"type": "string"}},
			"inputs":   map[string]any{"type": "array", "description": "ParamDefinition[]"},
			"source":   map[string]string{"type": "string"},
		},
	})
}

// platformMCPToolDefinitions returns the global, App-agnostic MCP tools the
// platform always exposes: session context, apps/skills/project management,
// design system and media generation. They are unconditional and form the
// "全局" group in GET /v1/mcp/tools. Tool-level descriptions follow the
// requested locale; schema-internal property descriptions stay Chinese for now.
func platformMCPToolDefinitions(locale Locale) []map[string]any {
	tools := make([]map[string]any, 0)
	tools = append(tools,
		platformTool("recut.context", mcpDescription(locale, "recut.context"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.list", mcpDescription(locale, "recut.apps.list"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.store", mcpDescription(locale, "recut.apps.store"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.apps.install", mcpDescription(locale, "recut.apps.install"), map[string]any{"type": "object", "required": []string{"repository"}, "properties": map[string]any{"repository": map[string]string{"type": "string", "description": "GitHub 仓库 URL（git@… 或 https://…）。"}}}),
		platformTool("recut.apps.update", mcpDescription(locale, "recut.apps.update"), map[string]any{"type": "object", "properties": map[string]any{"package": map[string]string{"type": "string", "description": "可选：要更新的 App 包名（如 recut-vox-broll）；缺省更新全部。"}}}),
		platformTool("recut.skills.list", mcpDescription(locale, "recut.skills.list"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.skills.read", mcpDescription(locale, "recut.skills.read"), map[string]any{"type": "object", "required": []string{"appId", "skillId"}, "properties": map[string]any{"appId": map[string]string{"type": "string"}, "skillId": map[string]string{"type": "string"}}}),
		platformTool("recut.skills.reference", mcpDescription(locale, "recut.skills.reference"), map[string]any{"type": "object", "required": []string{"appId", "skillId", "path"}, "properties": map[string]any{"appId": map[string]string{"type": "string"}, "skillId": map[string]string{"type": "string"}, "path": map[string]string{"type": "string"}}}),
		platformTool("recut.design_system.list", mcpDescription(locale, "recut.design_system.list"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.design_system.get", mcpDescription(locale, "recut.design_system.get"), map[string]any{"type": "object", "required": []string{"styleId"}, "properties": map[string]any{"styleId": map[string]string{"type": "string", "description": "设计系统 id，如 neobrutalism / glassmorphism / clean-editorial。"}}}),
		projectMCPToolDefinition(locale),
		platformTool("recut.project.list", mcpDescription(locale, "recut.project.list"), map[string]any{"type": "object", "properties": map[string]any{}}),
		platformTool("recut.project.get", mcpDescription(locale, "recut.project.get"), map[string]any{"type": "object", "required": []string{"projectId"}, "properties": map[string]any{"projectId": map[string]string{"type": "string"}}}),
		platformTool("recut.project_context", mcpDescription(locale, "recut.project_context"), map[string]any{"type": "object", "required": []string{"projectId"}, "properties": map[string]any{"projectId": map[string]string{"type": "string", "description": "要读取上下文的 Project Doc ID。"}}}),
		platformTool("recut.agent.run", mcpDescription(locale, "recut.agent.run"), map[string]any{"type": "object", "required": []string{"app", "operation", "payload"}, "properties": map[string]any{
			"app":       map[string]string{"type": "string", "description": "承载该子 Agent 运行的 App ID。"},
			"operation": map[string]string{"type": "string", "description": "App 用于声明 SubAgentRequest 的 background operation（返回 {subAgent:{allowedTools,prompt,...}}）。"},
			"payload":   map[string]any{"type": "object", "description": "传给该 operation 的参数。"},
			"target":    map[string]any{"type": "object", "description": "可选的 {projectId} 目标；缺省用 App 默认 scope。"},
		}}),
		platformTool("recut.job.status", mcpDescription(locale, "recut.job.status"), map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}),
		platformTool("recut.job.wait", mcpDescription(locale, "recut.job.wait"), map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}, "timeoutSeconds": map[string]any{"type": "number", "minimum": 1, "maximum": 15, "description": "单次最多阻塞 15 秒（Streamable HTTP 兼容，避免长阻塞连接被断开）；超时返回当前状态，需用 recut.job.status 继续轮询。长任务请用短轮询，不要设接近 300 秒。"}}}),
		platformTool("recut.job.logs", mcpDescription(locale, "recut.job.logs"), map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}, "limit": map[string]any{"type": "number", "minimum": 1, "maximum": 2000, "description": "只返回最近 N 行，默认 300。"}}}),
		platformTool("recut.job.cancel", mcpDescription(locale, "recut.job.cancel"), map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}),
	)
	tools = append(tools, mediaMCPToolDefinitions(locale)...)
	tools = append(tools, worldsMCPToolDefinitions(locale)...)
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
// Tool descriptions and App metadata follow the persisted language preference
// because the settings panel has no Accept-Language header of its own.
func mcpToolGroups(bridge *AgentBridge) map[string]any {
	locale := DefaultLocale
	if bridge != nil && bridge.store != nil {
		locale, _ = bridge.store.StoredLocale()
	}
	apps, err := bridge.store.catalog.List()
	if err != nil {
		return map[string]any{"global": platformMCPToolDefinitions(locale), "apps": []map[string]any{}}
	}
	appGroups := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		tools := appMCPToolDefinitions(app)
		if len(tools) == 0 {
			continue
		}
		manifest := app.Manifest.LocalizedFor(locale)
		appGroups = append(appGroups, map[string]any{
			"appId":       manifest.ID,
			"name":        manifest.Name,
			"kind":        string(manifest.Kind),
			"description": manifest.Description,
			"tools":       tools,
		})
	}
	return map[string]any{"global": platformMCPToolDefinitions(locale), "apps": appGroups}
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

func mcpToolCall(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, name string, arguments map[string]any, locale Locale) (any, error) {
	if !session.AllowsTool(name) {
		return nil, fmt.Errorf("tool %q is unavailable in this focused Agent session", name)
	}
	if name == "recut.editor.component.commit" {
		target, ok := session.SessionTarget()
		if !ok {
			return nil, errors.New("component.commit requires a focused Component Author session")
		}
		commitArguments := cloneJSONMap(arguments)
		// 聚焦上下文由 App（editor background）声明，平台只透传：componentId/baseVersionId/mode 等
		// 由 editor 的 component.commit 消费，平台不理解其语义。
		if session.Focused != nil {
			for k, v := range session.Focused {
				if s, isStr := v.(string); isStr && s != "" {
					commitArguments[k] = s
				}
			}
		}
		result, err := host.InvokeAPILocale(target, "recut.editor", "component.define", commitArguments, locale)
		if err != nil {
			return nil, err
		}
		committed, _ := result.(map[string]any)
		if committed == nil || committed["status"] != "draft" {
			data, _ := json.Marshal(result)
			return nil, fmt.Errorf("component.commit build did not produce a draft component: %s", data)
		}
		bridge.RecordAgentToolCall(session.ID, "recut.editor.component.commit", committed)
		// 架构 P1：commit 结果发生时即追加到 job 账本（子 Agent 被杀也保留，finalize 从 job 投影）。
		if job, ok := bridge.agentJobByChild(session.ID); ok {
			bridge.recordAgentJobCall(job.ID, agentToolCall{Name: "recut.editor.component.commit", Result: committed})
		}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
	}
	switch name {
	case "recut.context":
		return recutContextTool(bridge, media, session, locale)
	case "recut.project_context":
		return projectContextTool(bridge, host, media, session, arguments, locale)
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
		return appsListTool(bridge, locale)
	case "recut.apps.store":
		return appStoreTool(bridge, locale)
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
	case "recut.agent.run":
		return agentRunMCPTool(bridge, host, session, arguments, locale)
	}
	if isMediaMCPTool(name) {
		return mediaMCPTool(bridge.store, media, session, name, arguments)
	}
	if strings.HasPrefix(name, "recut.worlds.") {
		return worldsMCPTool(NewWorldStore(bridge.store, media), name, arguments)
	}
	if strings.HasPrefix(name, "recut.job.") {
		return jobMCPTool(bridge, host.jobs, host.async, media, name, arguments)
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
	// manifest 标记 subAgent 的 op：平台通用受限子 Agent 运行（authorize → run → finalize），
	// 上下文与工具范围由 background 动态声明，无任何 App 专属 Go 代码。
	if operationIsSubAgent(app.Manifest, operationName) {
		view, err := startAppSubAgentJob(bridge, host, session, target, appID, operationName, args, locale)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(view)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": view}, nil
	}
	result, err := host.InvokeMCPLocale(target, appID, operationName, args, locale)
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

func recutContextTool(bridge *AgentBridge, media *MediaService, session AgentSession, locale Locale) (any, error) {
	apps, _ := bridge.store.catalog.List()
	appSummaries := make([]map[string]any, 0, len(apps))
	skillSummary := make([]map[string]any, 0)
	for _, app := range apps {
		skills, err := app.Skills()
		if err != nil {
			continue
		}
		manifest := app.Manifest.LocalizedFor(locale)
		summary := map[string]any{"appId": manifest.ID, "name": manifest.Name, "kind": string(manifest.Kind), "description": manifest.Description, "root": app.Root}
		skillsMeta := make([]map[string]any, 0, len(skills))
		for _, skill := range skills {
			skillsMeta = append(skillsMeta, map[string]any{"id": skill.ID, "name": skill.Name, "description": skill.Description})
			skillSummary = append(skillSummary, map[string]any{"id": skill.ID, "appId": app.Manifest.ID, "name": skill.Name, "description": skill.Description})
		}
		summary["skills"] = skillsMeta
		appSummaries = append(appSummaries, summary)
	}
	mediaConfiguration, mediaReadiness := mediaContext(media)
	result := map[string]any{
		"session": map[string]any{"id": session.ID, "taskId": session.TaskID},
		"apps":    appSummaries,
		"skills":  skillSummary,
		"media":   map[string]any{"defaultRoutes": mediaConfiguration, "readiness": mediaReadiness},
		"integrations": recutIntegrationContext(apps, func() []StoreApp {
			storeApps, _ := bridge.store.AppStoreFor(locale)
			return storeApps
		}()),
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

// recutIntegrationContext exposes platform-level optional App capabilities.
// Domain Apps consume this read-only snapshot instead of guessing whether a
// companion MCP surface is installed. Installation remains user-authorized.
func recutIntegrationContext(apps []App, storeApps []StoreApp) map[string]any {
	result := map[string]any{}
	audio := map[string]any{
		"appId": "recut.audio-studio",
		"capability": "transcription",
		"installed": false,
		"mcpReady": false,
		"status": "not-installed",
		"action": "Use recut.apps.install with the Audio Studio repository, then start a new Agent session.",
	}
	for _, app := range apps {
		if app.Manifest.ID != "recut.audio-studio" {
			continue
		}
		audio["installed"] = true
		for _, operation := range app.Manifest.Operations {
			for _, surface := range operation.Surfaces {
				if surface == "mcp" {
					audio["mcpReady"] = true
					break
				}
			}
		}
		if audio["mcpReady"] == true {
			audio["status"] = "ready"
			audio["action"] = "Use the installed Audio Studio MCP transcription operations."
		} else {
			audio["status"] = "installed-no-mcp"
			audio["action"] = "Update or reinstall Audio Studio so its MCP operations are available, then start a new Agent session."
		}
	}
	if !audio["installed"].(bool) {
		for _, app := range storeApps {
			if app.AppID == "recut.audio-studio" {
				audio["repository"] = app.Repository
				break
			}
		}
	}
	result["audioStudio"] = audio
	return result
}

// mediaContext turns persisted routes into a decision-ready view for Agents.
// Tool discovery is static, but a provider-backed generation call is only
// possible after the user has configured its capability's default route.
func mediaContext(media *MediaService) (any, map[string]map[string]string) {
	readiness := map[string]map[string]string{}
	for _, capability := range []MediaCapability{ImageGenerate, VideoGenerate, SpeechGenerate} {
		readiness[string(capability)] = map[string]string{
			"status":  "not-configured",
			"routeId": string(capability) + ".default",
			"action":  "Open Recut settings, connect a Provider, then choose a model for this capability.",
		}
	}
	if media == nil {
		return []MediaConfiguration{}, readiness
	}
	configured, err := media.ConfiguredModels()
	if err != nil {
		for _, value := range readiness {
			value["status"] = "unavailable"
			value["action"] = "Reconnect to the local Recut service, then inspect its media settings."
		}
		return []MediaConfiguration{}, readiness
	}
	for _, configuration := range configured {
		value := readiness[string(configuration.Route.Capability)]
		if configuration.Model.ID == CodexImageModelID {
			value["status"] = "codex-native"
			value["action"] = "Use Codex native image generation; do not call recut.image.generate."
			continue
		}
		if configuration.Provider.ID == "local-audio" {
			// 本机 TTS 路由就绪：Agent 应优先使用 Audio Studio 的 MCP
			// （audio.synthesize + audio.save）完成配音，recut.speech.generate 仍可用但
			// 依赖 daemon 注入的本地执行桥。
			value["status"] = "ready"
			value["routeId"] = configuration.Route.ID
			value["modelId"] = configuration.Model.ID
			value["provider"] = "local-audio"
			value["credentialName"] = configuration.CredentialName
			value["local"] = "true"
			value["action"] = "Local Audio Studio TTS is configured; use audio.synthesize + audio.save (or recut.speech.generate when the daemon bridge is wired)."
			continue
		}
		value["status"] = "ready"
		value["routeId"] = configuration.Route.ID
		value["modelId"] = configuration.Model.ID
		value["credentialName"] = configuration.CredentialName
		value["action"] = ""
	}
	return configured, readiness
}

func appsListTool(bridge *AgentBridge, locale Locale) (any, error) {
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
		manifest := app.Manifest.LocalizedFor(locale)
		entry := map[string]any{"appId": manifest.ID, "name": manifest.Name, "kind": string(manifest.Kind), "description": manifest.Description, "skills": skillsMeta}
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

func appStoreTool(bridge *AgentBridge, locale Locale) (any, error) {
	store, err := bridge.store.AppStoreFor(locale)
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
		root := filepath.Clean(skill.Root)
		resolvedRoot, err := filepath.EvalSymlinks(root)
		if err != nil {
			return nil, fmt.Errorf("resolve skill root: %w", err)
		}
		for _, candidate := range skillReferenceCandidates(path) {
			resolved, resolveErr := filepath.EvalSymlinks(filepath.Join(root, candidate))
			if errors.Is(resolveErr, os.ErrNotExist) {
				continue
			}
			if resolveErr != nil {
				return nil, fmt.Errorf("resolve skill reference: %w", resolveErr)
			}
			relative, relativeErr := filepath.Rel(resolvedRoot, resolved)
			if relativeErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				return nil, fmt.Errorf("skill reference escapes the skill directory")
			}
			info, statErr := os.Stat(resolved)
			if statErr != nil || info.IsDir() {
				continue
			}
			content, readErr := os.ReadFile(resolved)
			if readErr != nil {
				return nil, readErr
			}
			result := map[string]any{"appId": appID, "skillId": skillID, "path": filepath.ToSlash(relative), "content": string(content)}
			data, _ := json.Marshal(result)
			return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
		}
		return nil, fmt.Errorf("skill reference is unavailable")
	}
	return nil, fmt.Errorf("skill %q is not provided by app %q", skillID, appID)
}

func skillReferenceCandidates(path string) []string {
	clean := filepath.Clean(path)
	if path == "" || filepath.IsAbs(path) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return nil
	}
	if clean == "references" || strings.HasPrefix(clean, "references"+string(filepath.Separator)) {
		return []string{clean}
	}
	return []string{clean, filepath.Join("references", clean)}
}

func projectMCPToolDefinition(locale Locale) map[string]any {
	return map[string]any{
		"name":        "recut.project.create",
		"description": mcpDescription(locale, "recut.project.create"),
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
	case "recut.image.generate", "recut.video.generate", "recut.speech.generate":
		capability := map[string]MediaCapability{"recut.image.generate": ImageGenerate, "recut.video.generate": VideoGenerate, "recut.speech.generate": SpeechGenerate}[name]
		job, generateErr := media.Generate(mediaGenerationInput(input, capability))
		err = generateErr
		if err == nil {
			result = mediaJobView(job)
		}
	case "recut.media.list_voices":
		credentialID, _ := input["credentialId"].(string)
		result, err = media.ListVoices(credentialID)
	case "recut.media.get_job":
		id, _ := input["jobId"].(string)
		job, getErr := media.GetJob(id)
		err = getErr
		if err == nil {
			result = mediaJobView(job)
		}
	case "recut.media.wait_for_job":
		id, _ := input["jobId"].(string)
		job, waitErr := media.WaitForTerminalJob(id, mediaWaitTimeout(input))
		err = waitErr
		if err == nil {
			result = mediaJobView(job)
		}
	case "recut.media.list_assets":
		workspace, _ := input["workspace"].(bool)
		projectID := requestedProjectID(input)
		if workspace {
			projectID = ""
		}
		result, err = media.ListAssets(projectID)
	case "recut.media.import_image":
		result, err = importNativeImage(store, media, session, input)
	case "recut.media.create_reference":
		result, err = media.CreateReferenceAsset(ReferenceAssetInput{
			Name: stringValue(input["name"]), URL: stringValue(input["url"]), SourceKind: stringValue(input["sourceKind"]),
			Summary: stringValue(input["summary"]), Description: stringValue(input["description"]), Excerpt: stringValue(input["excerpt"]),
			Author: stringValue(input["author"]), PublishedAt: stringValue(input["publishedAt"]), SiteName: stringValue(input["siteName"]),
			Language: stringValue(input["language"]), ThumbnailURL: stringValue(input["thumbnailUrl"]),
			Content: stringValue(input["content"]), ContentMimeType: stringValue(input["contentMimeType"]),
			ImageData: stringValue(input["imageData"]), ImageMimeType: stringValue(input["imageMimeType"]),
			ChannelName: stringValue(input["channelName"]), ChannelURL: stringValue(input["channelUrl"]),
			DurationSec: numericValue(input["durationSeconds"]), ViewCount: int64(numericValue(input["viewCount"])), LikeCount: int64(numericValue(input["likeCount"])),
		})
	case "recut.media.attach":
		id, _ := input["assetId"].(string)
		err = media.Attach(id, requestedProjectID(input))
		result = map[string]any{"assetId": id, "projectId": requestedProjectID(input), "attached": err == nil}
	default:
		return nil, fmt.Errorf("unknown media tool %q", name)
	}
	if err != nil {
		if strings.Contains(err.Error(), "no route configured for ") {
			return nil, fmt.Errorf("%w; open Recut settings, connect a Provider, then choose the default model for this capability", err)
		}
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

// mediaJobView exposes an async generation job under the explicit `jobId` key
// that wait_for_job / get_job / recut.job.* accept, so an Agent never has to
// guess that the job's `id` field is its jobId. assetIds stay the stable
// project references and kind marks this as a media job in the unified view.
func mediaJobView(job MediaJob) map[string]any {
	return map[string]any{
		"jobId":      job.ID,
		"id":         job.ID,
		"kind":       "media",
		"capability": job.Capability,
		"status":     job.Status,
		"modelId":    job.ModelID,
		"assetIds":   job.AssetIDs,
		"remoteId":   job.RemoteID,
		"error":      job.Error,
	}
}

func mediaMCPToolDefinitions(locale Locale) []map[string]any {
	return []map[string]any{
		{"name": "recut.image.generate", "description": mcpDescription(locale, "recut.image.generate"), "inputSchema": mediaGenerationSchema("生成提示词。", true, false, false)},
		{"name": "recut.video.generate", "description": mcpDescription(locale, "recut.video.generate"), "inputSchema": mediaGenerationSchema("生成提示词。", true, true, true)},
		{"name": "recut.speech.generate", "description": mcpDescription(locale, "recut.speech.generate"), "inputSchema": speechGenerationSchema()},
		{"name": "recut.media.list_voices", "description": mcpDescription(locale, "recut.media.list_voices"), "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"credentialId": map[string]string{"type": "string", "description": "云端语音 provider 的凭据 ID；本机 TTS 可传 local-audio 或留空返回 Audio Studio 默认音。"}}}},
		{"name": "recut.media.get_job", "description": mcpDescription(locale, "recut.media.get_job"), "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}}}},
		{"name": "recut.media.wait_for_job", "description": mcpDescription(locale, "recut.media.wait_for_job"), "inputSchema": map[string]any{"type": "object", "required": []string{"jobId"}, "properties": map[string]any{"jobId": map[string]string{"type": "string"}, "timeoutSeconds": map[string]any{"type": "number", "minimum": 1, "maximum": 15, "description": "单次最多阻塞 15 秒（Streamable HTTP 兼容，避免长阻塞连接被断开）；超时返回当前状态，需继续轮询。长任务请用短轮询，不要设接近 300 秒。"}}}},
		{"name": "recut.media.list_assets", "description": mcpDescription(locale, "recut.media.list_assets"), "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"projectId": map[string]string{"type": "string", "description": "可选的 Project target；缺省返回 workspace 级素材。"}, "workspace": map[string]string{"type": "boolean"}}}},
		{"name": "recut.media.import_image", "description": mcpDescription(locale, "recut.media.import_image"), "inputSchema": map[string]any{"type": "object", "required": []string{"path"}, "properties": map[string]any{"path": map[string]string{"type": "string", "description": "会话工作区内的相对图片路径。"}, "name": map[string]string{"type": "string", "description": "可选的素材显示名称。"}, "projectId": map[string]string{"type": "string", "description": "可选的 Project target；缺省落到 workspace 级素材。"}}}},
		{"name": "recut.media.create_reference", "description": mcpDescription(locale, "recut.media.create_reference"), "inputSchema": map[string]any{"type": "object", "required": []string{"name", "url", "sourceKind"}, "properties": map[string]any{"name": map[string]string{"type": "string", "description": "来源标题。"}, "url": map[string]string{"type": "string", "description": "公开的绝对 http(s) URL；作为全局去重身份。"}, "sourceKind": map[string]string{"type": "string", "description": "如 article、web、youtube、xiaohongshu、douyin、image。"}, "summary": map[string]string{"type": "string", "description": "该来源的简短事实摘要。"}, "description": map[string]string{"type": "string", "description": "来源自身的简介或视频简介。"}, "excerpt": map[string]string{"type": "string", "description": "直接引用的原文片段，便于审阅。"}, "author": map[string]string{"type": "string", "description": "作者或发布者名称。"}, "publishedAt": map[string]string{"type": "string", "description": "发布时间（ISO-8601）。"}, "siteName": map[string]string{"type": "string", "description": "站点名称，如 The New York Times。"}, "language": map[string]string{"type": "string", "description": "内容语言代码，如 zh、en。"}, "thumbnailUrl": map[string]string{"type": "string", "description": "来源封面/缩略图 URL。"}, "content": map[string]string{"type": "string", "description": "文章或网页的完整正文（真实文章数据）；保存为 content part，默认 text/markdown。"}, "contentMimeType": map[string]string{"type": "string", "description": "正文 part 的 MIME 类型，缺省 text/markdown；限 text/*、application/json、application/xml。"}, "imageData": map[string]string{"type": "string", "description": "图片内容（base64 或 data: URL）；保存为不可变的 image part，限 20MB。"}, "imageMimeType": map[string]string{"type": "string", "description": "图片 MIME 类型，如 image/png、image/jpeg。"}, "channelName": map[string]string{"type": "string", "description": "YouTube 等视频平台的频道/账号名。"}, "channelUrl": map[string]string{"type": "string", "description": "频道主页 URL。"}, "durationSeconds": map[string]any{"type": "number", "description": "视频时长（秒）。"}, "viewCount": map[string]any{"type": "integer", "description": "播放量。"}, "likeCount": map[string]any{"type": "integer", "description": "点赞数。"}}}},
		{"name": "recut.media.attach", "description": mcpDescription(locale, "recut.media.attach"), "inputSchema": map[string]any{"type": "object", "required": []string{"assetId", "projectId"}, "properties": map[string]any{"assetId": map[string]string{"type": "string"}, "projectId": map[string]string{"type": "string"}}}},
	}
}

func mediaWaitTimeout(input map[string]any) time.Duration {
	// 与 recut.job.wait 一致：单次等待封顶 15s（Streamable HTTP 兼容），避免长阻塞连接被断开。
	max := agentJobWaitWindow
	seconds, _ := input["timeoutSeconds"].(float64)
	if seconds <= 0 || time.Duration(seconds*float64(time.Second)) > max {
		return max
	}
	return time.Duration(seconds * float64(time.Second))
}

// jobMCPTool implements the unified platform job observation surface
// (recut.job.*). Local App shell jobs, App/UI deferred handles (async_ops) and
// platform media generation jobs all live behind the same jobId namespace:
// status/wait look up focused Component Author jobs, then shell jobs, then
// deferred handles, then media jobs; every view carries a `kind` discriminator.
// Author diagnostics are exposed through logs and cancellation propagates to
// the child Codex process.
func jobMCPTool(bridge *AgentBridge, jobs *ShellJobManager, async *AsyncOpsManager, media *MediaService, name string, input map[string]any) (any, error) {
	jobID, _ := input["jobId"].(string)
	if strings.TrimSpace(jobID) == "" {
		return nil, errors.New("jobId is required")
	}
	var result any
	var err error
	switch name {
	case "recut.job.status":
		if view, ok := bridge.agentJobView(jobID); ok {
			result = view
		} else {
			result, err = unifiedJobStatus(jobs, async, media, jobID)
		}
	case "recut.job.wait":
		if view, ok := bridge.waitAgentJob(jobID, jobWaitTimeout(input)); ok {
			result = view
		} else {
			result, err = unifiedJobWait(jobs, async, media, jobID, jobWaitTimeout(input))
		}
	case "recut.job.logs":
		if view, ok := bridge.agentJobView(jobID); ok {
			result = map[string]any{"jobId": jobID, "kind": "sub-agent", "diagnostics": view}
			break
		}
		var logs []ShellJobLog
		logs, err = jobs.LogsByID(jobID)
		if err == nil {
			result = jobLogViews(logs, input)
		} else if _, asyncErr := async.FindByID(jobID); asyncErr == nil {
			// deferred Handle 无进程日志；生命周期事件在项目账本。
			result = map[string]any{"jobId": jobID, "kind": "deferred", "logs": []any{}}
			err = nil
		}
	case "recut.job.cancel":
		if cancelled, ok := bridge.cancelAgentJob(jobID); ok {
			result = cancelled
			break
		}
		var job ShellJob
		job, err = jobs.FindByID(jobID)
		if err == nil {
			if job.Status != ShellJobQueued && job.Status != ShellJobRunning {
				result = map[string]any{"jobId": jobID, "kind": "shell", "cancelled": false, "status": string(job.Status)}
				break
			}
			err = jobs.CancelByID(jobID)
			result = map[string]any{"jobId": jobID, "kind": "shell", "cancelled": err == nil}
			break
		}
		if op, asyncErr := async.FindByID(jobID); asyncErr == nil {
			if op.Status != AsyncOpPending && op.Status != AsyncOpRunning {
				result = map[string]any{"jobId": jobID, "kind": "deferred", "cancelled": false, "status": string(op.Status)}
				break
			}
			if _, cancelErr := async.Cancel(jobID); cancelErr != nil {
				err = cancelErr
				break
			}
			result = map[string]any{"jobId": jobID, "kind": "deferred", "cancelled": true, "status": "cancelled"}
			err = nil
			break
		}
		err = errors.New("job not found")
	default:
		return nil, fmt.Errorf("unknown job tool %q", name)
	}
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

// unifiedJobStatus reads one job by a shared jobId. Shell jobs and deferred
// handles are checked first (both local), then the media store.
func unifiedJobStatus(jobs *ShellJobManager, async *AsyncOpsManager, media *MediaService, jobID string) (any, error) {
	if shell, err := jobs.FindByID(jobID); err == nil {
		view := jobView(shell)
		view["kind"] = "shell"
		return view, nil
	}
	if op, err := async.FindByID(jobID); err == nil {
		return asyncOpView(op), nil
	}
	if media == nil {
		return nil, errors.New("job not found")
	}
	job, err := media.GetJob(jobID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("job not found")
	}
	if err != nil {
		return nil, err
	}
	view := mediaJobView(job)
	view["kind"] = "media"
	return view, nil
}

// unifiedJobWait waits for any backend to reach a terminal state. Both wait
// contracts return the current (possibly non-terminal) job once the timeout is
// reached, so the Agent can keep polling with status.
func unifiedJobWait(jobs *ShellJobManager, async *AsyncOpsManager, media *MediaService, jobID string, timeout time.Duration) (any, error) {
	if shell, err := jobs.WaitByID(jobID, timeout); err == nil {
		view := jobView(shell)
		view["kind"] = "shell"
		return view, nil
	}
	deadline := time.Now().Add(timeout)
	for {
		op, err := async.FindByID(jobID)
		if err == nil {
			if op.Status != AsyncOpPending && op.Status != AsyncOpRunning {
				return asyncOpView(op), nil
			}
			if time.Now().After(deadline) {
				return asyncOpView(op), nil
			}
			time.Sleep(250 * time.Millisecond)
			continue
		}
		break
	}
	if media == nil {
		return nil, errors.New("job not found")
	}
	job, err := media.WaitForTerminalJob(jobID, timeout)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("job not found")
	}
	if err != nil {
		return nil, err
	}
	view := mediaJobView(job)
	view["kind"] = "media"
	return view, nil
}

func jobView(job ShellJob) map[string]any {
	view := map[string]any{
		"id":        job.ID,
		"projectId": job.ProjectID,
		"appId":     job.AppID,
		"status":    string(job.Status),
		"exitCode":  job.ExitCode,
		"error":     job.Error,
	}
	if job.StartedAt != nil {
		view["startedAt"] = job.StartedAt.UTC().Format(time.RFC3339Nano)
	}
	if job.EndedAt != nil {
		view["endedAt"] = job.EndedAt.UTC().Format(time.RFC3339Nano)
	}
	if job.CreatedAt != nil {
		view["createdAt"] = job.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	return view
}

// jobWaitTimeout 是 recut.job.wait 单次阻塞窗口。阻塞 HTTP 长轮询与 Streamable
// HTTP 传输不兼容（连接会在任务收尾/空闲期被断开，2026-08-21 会话复现 EOF）；因此无论
// 调用方传多少 timeout，单次等待都被封顶到 agentJobWaitWindow，超时返回当前状态由
// 调用方继续轮询，连接永不长期占用。
func jobWaitTimeout(input map[string]any) time.Duration {
	max := agentJobWaitWindow
	seconds, _ := input["timeoutSeconds"].(float64)
	if seconds <= 0 || time.Duration(seconds*float64(time.Second)) > max {
		return max
	}
	return time.Duration(seconds * float64(time.Second))
}

func jobLogViews(logs []ShellJobLog, input map[string]any) []map[string]any {
	limit := int64(300)
	if value, ok := input["limit"].(float64); ok && value > 0 {
		limit = int64(value)
	}
	if limit > 2000 {
		limit = 2000
	}
	views := make([]map[string]any, 0, len(logs))
	for _, entry := range logs {
		views = append(views, shellLogMap(entry))
	}
	if limit < int64(len(views)) {
		views = views[len(views)-int(limit):]
	}
	return views
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
	for _, tool := range mediaMCPToolDefinitions(DefaultLocale) {
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

func projectContextTool(bridge *AgentBridge, host *AppHost, media *MediaService, session AgentSession, arguments map[string]any, locale Locale) (any, error) {
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
	workflow, workflowErr := host.InvokeMCPLocale(Target{ProjectID: project.ID, AppID: project.AppID}, project.AppID, "workflow.context", map[string]any{}, locale)
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
