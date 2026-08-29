/*
 * [INPUT]: 依赖 Store 的工作区身份、全局 Agent guide 模板与标准库文件系统能力
 * [OUTPUT]: 对外提供 AgentBridge、会话独立工作区、CLI MCP 配置、鉴权与同模型 Component Author 的配置继承
 * [POS]: service 的 native Agent 会话边界；会话不绑定项目，CLI 从中立会话工作区运行
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"text/template"
	"time"
)

//go:embed prompts/core-agents.md.tmpl
var coreAgentsTemplate string

//go:embed prompts/bridge-instructions.md
var bridgeInstructions string

type AgentSession struct {
	ID              string    `json:"id"`
	TaskID          string    `json:"taskId,omitempty"`
	Runtime         string    `json:"-"`
	Model           string    `json:"-"`
	ReasoningEffort string    `json:"-"`
	AllowedTools    []string  `json:"allowedTools,omitempty"`
	ProjectID       string    `json:"projectId,omitempty"`
	AppID           string    `json:"appId,omitempty"`
	// Focused 是 App 声明的聚焦上下文（不透明 map），平台只透传，App 的受限工具消费它。
	Focused    map[string]any `json:"-"`
	TokenHash  string         `json:"tokenHash"`
	CreatedAt  time.Time      `json:"createdAt"`
}

// SessionContext carries the Task identity for one CLI execution. A session
// never binds to a Project or App: the model discovers both exclusively through
// MCP context tools and passes explicit targets.
type SessionContext struct {
	TaskID          string
	Runtime         string
	Model           string
	ReasoningEffort string
	AllowedTools    []string
	Target          Target
	Focused         map[string]any
}

type AgentBridge struct {
	mu             sync.Mutex
	store          *Store
	sessions       map[string]AgentSession
	agentToolCalls map[string][]agentToolCall
	agentJobs      map[string]*AgentJob
	mcpTarget      string
	mcpExecutable  string
	// agents 是 AgentManager 的后向引用（创建后经 SetAgentManager 注入）：用于子 Agent 会话持久化、
	// 事件落账本与子会话状态同步。测试场景可为 nil（退化为无记录运行）。
	agents *AgentManager
	// subagentToolCalls 关联"父会话正在执行的 subagent 工具调用"：job 创建时注册，tool.completed
	// 事件消费后注入 subagentId 判别字段。
	subagentToolCalls map[string]subagentInfo
	// subagentMu / subagentStreams 是 subagent job 生命周期事件的实时流 hub（ws subagent channel）。
	subagentMu      sync.Mutex
	subagentStreams map[string]*subagentStream
}

// subagentInfo 是一次 subagent 工具调用在父会话事件流上的关联信息。
type subagentInfo struct {
	SubagentID string
	AppID      string
	Operation  string
}

// subagentEvent 是 subagent 流上的一条事件帧（job 生命周期）。
type subagentEvent struct {
	Event string         `json:"event"`
	Job   map[string]any `json:"job,omitempty"`
}

type subagentStream struct {
	history        []subagentEvent
	subscribers    map[uint64]chan subagentEvent
	nextSubscriber uint64
}

const opencodeMCPTimeoutMilliseconds = 5 * 60 * 1000

// defaultMCPTarget 是常驻 daemon 的 loopback origin，唯一拥有 MCP Host 与所有
// 长驻任务状态的进程。三种 runtime 的 MCP 配置一律用 `--mcp` 无状态转发器接入
// 该端点，而不是启动 per-session 的 --mcp-stdio 全量子进程，从而保证会话结束后
// job/media 状态仍归 daemon 单一实例管理。
const defaultMCPTarget = "http://127.0.0.1:17373"

type bridgeRecord struct {
	Session AgentSession `json:"session"`
}

func NewAgentBridge(store *Store) *AgentBridge {
	return &AgentBridge{store: store, sessions: map[string]AgentSession{}, agentToolCalls: map[string][]agentToolCall{}, agentJobs: map[string]*AgentJob{}, subagentToolCalls: map[string]subagentInfo{}, subagentStreams: map[string]*subagentStream{}, mcpTarget: defaultMCPTarget}
}

// SetAgentManager 注入 AgentManager 后向引用（组合根创建顺序：bridge 先于 agents）。
func (b *AgentBridge) SetAgentManager(agents *AgentManager) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.agents = agents
}

// SetMCPForwarder is a test seam for isolated daemon instances. Production
// keeps the default loopback endpoint and its own executable.
func (b *AgentBridge) SetMCPForwarder(target, executable string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if target != "" {
		b.mcpTarget = target
	}
	b.mcpExecutable = executable
}

func (b *AgentBridge) mcpForwarder(executable string) (string, string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.mcpTarget == "" {
		b.mcpTarget = defaultMCPTarget
	}
	if b.mcpExecutable != "" {
		executable = b.mcpExecutable
	}
	return b.mcpTarget, executable
}

func (b *AgentBridge) CreateSession(ctx SessionContext) (AgentSession, string, error) {
	id, err := newID()
	if err != nil {
		return AgentSession{}, "", err
	}
	token, err := newID()
	if err != nil {
		return AgentSession{}, "", err
	}
	session := AgentSession{ID: id, TaskID: ctx.TaskID, Runtime: ctx.Runtime, Model: ctx.Model, ReasoningEffort: ctx.ReasoningEffort, AllowedTools: append([]string(nil), ctx.AllowedTools...), ProjectID: ctx.Target.ProjectID, AppID: ctx.Target.AppID, Focused: cloneJSONMap(ctx.Focused), TokenHash: hashToken(token), CreatedAt: time.Now().UTC()}
	workspace := b.store.SessionWorkspaceDir(session.ID)
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		return AgentSession{}, "", err
	}
	if err := writeProjectJSON(filepath.Join(b.store.SessionWorkspaceDir(session.ID), "..", "bridge-session.json"), bridgeRecord{Session: session}); err != nil {
		return AgentSession{}, "", err
	}
	b.mu.Lock()
	b.sessions[session.ID] = session
	b.mu.Unlock()
	return session, token, nil
}

func (s AgentSession) AllowsTool(name string) bool {
	if len(s.AllowedTools) == 0 {
		return true
	}
	for _, allowed := range s.AllowedTools {
		if name == allowed {
			return true
		}
	}
	return false
}

// SessionTarget 返回聚焦会话绑定的项目目标（App 声明）；无则 ok=false。
func (s AgentSession) SessionTarget() (Target, bool) {
	if s.ProjectID == "" || s.AppID == "" {
		return Target{}, false
	}
	return Target{ProjectID: s.ProjectID, AppID: s.AppID}, true
}

// agentToolCall 是受限子 Agent 的一次工具调用的结构化结果（按工具名收集，通用）。
type agentToolCall struct {
	Name   string         `json:"name"`
	Result map[string]any `json:"result"`
}

// RecordAgentToolCall 记录受限子 Agent 会话中某次受限工具调用的结构化结果。
func (b *AgentBridge) RecordAgentToolCall(sessionID, name string, result map[string]any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.agentToolCalls[sessionID] = append(b.agentToolCalls[sessionID], agentToolCall{Name: name, Result: result})
}

// AgentToolCalls 取走受限子 Agent 会话的全部工具调用结果（读取即清空）。
func (b *AgentBridge) AgentToolCalls(sessionID string) ([]agentToolCall, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	calls, ok := b.agentToolCalls[sessionID]
	delete(b.agentToolCalls, sessionID)
	return calls, ok
}

// registerSubagentToolCall 记录父会话当前正在执行的 subagent 工具调用，供 tool.completed 事件注入
// subagentId 判别字段。父会话的一次 subagent 工具调用在运行期间只有它自己在执行，因此"注册 → 下一条
// tool.completed 消费"是 1:1 的；异常残留由下一 turn 开始时清理。
func (b *AgentBridge) registerSubagentToolCall(sessionID, subagentID, appID, operation string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subagentToolCalls[sessionID] = subagentInfo{SubagentID: subagentID, AppID: appID, Operation: operation}
}

func (b *AgentBridge) consumeSubagentToolCall(sessionID string) (subagentInfo, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	info, ok := b.subagentToolCalls[sessionID]
	delete(b.subagentToolCalls, sessionID)
	return info, ok
}

func (b *AgentBridge) clearSubagentToolCall(sessionID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.subagentToolCalls, sessionID)
}

// --- subagent 实时流 hub（ws subagent channel） ---

const subagentHistoryLimit = 200

func (b *AgentBridge) beginSubagentStream(jobID string) {
	b.subagentMu.Lock()
	defer b.subagentMu.Unlock()
	if b.subagentStreams[jobID] == nil {
		b.subagentStreams[jobID] = &subagentStream{subscribers: map[uint64]chan subagentEvent{}}
	}
}

// appendSubagentEvent 把一条 job 生命周期事件写入流历史并扇出给所有订阅者（非阻塞）。
func (b *AgentBridge) appendSubagentEvent(jobID string, frame subagentEvent) {
	b.subagentMu.Lock()
	stream := b.subagentStreams[jobID]
	if stream != nil {
		stream.history = append(stream.history, frame)
		if len(stream.history) > subagentHistoryLimit {
			stream.history = append([]subagentEvent(nil), stream.history[len(stream.history)-subagentHistoryLimit:]...)
		}
		for _, subscriber := range stream.subscribers {
			select {
			case subscriber <- frame:
			default:
			}
		}
	}
	b.subagentMu.Unlock()
}

func (b *AgentBridge) finishSubagentStream(jobID string) {
	b.subagentMu.Lock()
	delete(b.subagentStreams, jobID)
	b.subagentMu.Unlock()
}

// SubscribeSubagentStream 订阅一个 subagent job 的生命周期流：先回放历史，再实时推送。
// job 不存在返回 (nil, nil, noop)。
func (b *AgentBridge) SubscribeSubagentStream(jobID string) ([]subagentEvent, <-chan subagentEvent, func()) {
	b.subagentMu.Lock()
	stream := b.subagentStreams[jobID]
	if stream == nil {
		b.subagentMu.Unlock()
		return nil, nil, func() {}
	}
	history := append([]subagentEvent(nil), stream.history...)
	stream.nextSubscriber++
	subscriberID := stream.nextSubscriber
	output := make(chan subagentEvent, subagentHistoryLimit)
	stream.subscribers[subscriberID] = output
	b.subagentMu.Unlock()
	return history, output, func() {
		b.subagentMu.Lock()
		if current := b.subagentStreams[jobID]; current == stream {
			delete(current.subscribers, subscriberID)
		}
		b.subagentMu.Unlock()
	}
}

// emitSubagentEvent 处理一条 subagent job 生命周期事件：持久化为审计账本（agent_events 的
// subagent.job 类型，归属子会话；子会话未创建前归属父会话）+ 实时扇出到 subagent 流。
func (b *AgentBridge) emitSubagentEvent(jobID, event string, view map[string]any) {
	if b.agents != nil {
		sessionID, _ := view["childSessionId"].(string)
		if sessionID == "" {
			sessionID, _ = view["parentSessionId"].(string)
		}
		if sessionID != "" {
			b.agents.emitSubagentJobEvent(sessionID, event, view)
		}
	}
	b.appendSubagentEvent(jobID, subagentEvent{Event: event, Job: view})
}

func (b *AgentBridge) WorkspaceDir(session AgentSession) string {
	return b.store.SessionWorkspaceDir(session.ID)
}

// MaterializeCodexWorkspace writes the global guide and the Codex MCP config
// into the session workspace. The workspace is the CLI cwd, so guide and config
// never touch a user project and concurrent sessions cannot overwrite each other.
func (b *AgentBridge) MaterializeCodexWorkspace(session AgentSession, token, executable string) (string, error) {
	return b.materializeCodexWorkspace(b.WorkspaceDir(session), session, token, executable)
}

// MaterializeCodexWorkspaceTo writes the Codex workspace into an explicit
// directory. Codex resumes threads globally, but the CLI must still run from a
// Recut-managed workspace so AGENTS.md and the MCP config stay available and
// the directory passes Codex's repo/trust checks; Recut persists the original
// workspace and reuses it for every later turn of the same native session.
func (b *AgentBridge) MaterializeCodexWorkspaceTo(dir string, session AgentSession, token, executable string) (string, error) {
	return b.materializeCodexWorkspace(dir, session, token, executable)
}

// ComponentAuthorMCPOverrides puts the focused server on the Codex command
// line, which has precedence over user and Desktop configuration. The normal
// Recut server is explicitly disabled so a child cannot inherit the parent
// Agent's broad tool surface.
func (b *AgentBridge) ComponentAuthorMCPOverrides(session AgentSession, token, executable string) []string {
	target, executable := b.mcpForwarder(executable)
	return []string{
		"--config", "mcp_servers.recut.enabled=false",
		"--config", fmt.Sprintf("mcp_servers.component_author.command=%q", executable),
		"--config", fmt.Sprintf("mcp_servers.component_author.args=[%q, %q, %q]", "--mcp", "--mcp-target", target),
		"--config", fmt.Sprintf("mcp_servers.component_author.env={RECUT_AGENT_SESSION=%q, RECUT_AGENT_TOKEN=%q}", session.ID, token),
	}
}

func (b *AgentBridge) materializeCodexWorkspace(dir string, session AgentSession, token, executable string) (string, error) {
	if err := os.MkdirAll(filepath.Join(dir, ".codex"), 0o700); err != nil {
		return "", err
	}
	agents, err := b.renderSessionGuide()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, "AGENTS.md"), agents, 0o600); err != nil {
		return "", err
	}
	config := fmt.Sprintf(`[mcp_servers.recut]
command = %q
args = ["--mcp", "--mcp-target", %q]
env = { RECUT_AGENT_SESSION = %q, RECUT_AGENT_TOKEN = %q }
`, executable, defaultMCPTarget, session.ID, token)
	if err := os.WriteFile(filepath.Join(dir, ".codex", "config.toml"), []byte(config), 0o600); err != nil {
		return "", err
	}
	return dir, nil
}

// WriteOpencodeWorkspace writes the global guide and the OpenCode MCP config
// into the session workspace.
func (b *AgentBridge) WriteOpencodeWorkspace(session AgentSession, token, executable string) (string, error) {
	return b.writeOpencodeWorkspace(b.WorkspaceDir(session), session, token, executable)
}

// WriteOpencodeWorkspaceTo writes the global guide and the OpenCode MCP config
// into an explicit directory. Resuming an OpenCode native session must run in
// the exact workspace where that session was created; a different --dir makes
// `opencode run --session` emit no events and hang, so Recut persists the
// original workspace and reuses it for every later turn of the same session.
func (b *AgentBridge) WriteOpencodeWorkspaceTo(dir string, session AgentSession, token, executable string) (string, error) {
	return b.writeOpencodeWorkspace(dir, session, token, executable)
}

func (b *AgentBridge) writeOpencodeWorkspace(dir string, session AgentSession, token, executable string) (string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	agents, err := b.renderSessionGuide()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, "AGENTS.md"), agents, 0o600); err != nil {
		return "", err
	}
	config := map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"mcp": map[string]any{
			"recut": map[string]any{
				"type":    "local",
				"command": []string{executable, "--mcp", "--mcp-target", defaultMCPTarget},
				"environment": map[string]any{
					"RECUT_AGENT_SESSION": session.ID,
					"RECUT_AGENT_TOKEN":   token,
				},
				"enabled": true,
				"timeout": opencodeMCPTimeoutMilliseconds,
			},
		},
		// Phase 1: allow all external-directory reads so the headless CLI never
		// blocks on an unanswerable permission prompt. A deny-first allowlist
		// scoped to Recut's data root plus user-facing confirmation for anything
		// outside it is a later phase, so the agent can currently diagnose and
		// fix local setup issues in full.
		"permission": map[string]any{
			"external_directory": "allow",
		},
		"experimental": map[string]any{"mcp_timeout": opencodeMCPTimeoutMilliseconds},
	}
	if err := writeProjectJSON(filepath.Join(dir, "opencode.json"), config); err != nil {
		return "", err
	}
	return dir, nil
}

// WriteClaudeProfile materializes the Claude Code MCP adapter in the session
// workspace. The token is intentionally absent: the CLI process passes it to
// its MCP child through env.
func (b *AgentBridge) WriteClaudeProfile(session AgentSession, executable string) (string, error) {
	return b.writeClaudeProfile(b.WorkspaceDir(session), session, executable)
}

// WriteClaudeProfileTo writes the Claude Code profile into an explicit
// directory. Claude stores each session under the project directory it was
// created in, so `--resume` from a different cwd fails; Recut persists the
// original workspace and reuses it for every later turn of the same session.
func (b *AgentBridge) WriteClaudeProfileTo(dir string, session AgentSession, executable string) (string, error) {
	return b.writeClaudeProfile(dir, session, executable)
}

func (b *AgentBridge) writeClaudeProfile(dir string, session AgentSession, executable string) (string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	agents, err := b.renderSessionGuide()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, "AGENTS.md"), agents, 0o600); err != nil {
		return "", err
	}
	profile := map[string]any{"mcpServers": map[string]any{"recut": map[string]any{
		"command": executable,
		"args":    []string{"--mcp", "--mcp-target", defaultMCPTarget},
	}}}
	path := filepath.Join(dir, "claude-mcp.json")
	if err := writeProjectJSON(path, profile); err != nil {
		return "", err
	}
	return path, nil
}

// agentGuideData carries the render mode and the user language for the core
// Agent guide template. The internal bridge always renders OutputFormat=xml:
// the Recut chat UI parses the controlled tags into media previews and
// clickable cards. The third-party Recut Skill (service/skills/recut/SKILL.md)
// is a separate text document in the OutputFormat=url convention and must emit
// plain recut.video deep links instead of XML tags; the two are kept consistent
// by test invariants, not by a shared render source.
type agentGuideData struct {
	OutputFormat string // "xml" | "url"
	Locale       string // "" | "zh" | "en"; empty renders the default language
}

// renderSessionGuide renders the platform-only Agent guide. Domain workflow
// lives in App skills, loaded on demand through recut.skills.read; no App guide
// is injected into the session. The guide language follows the persisted user
// preference because an Agent session has no Accept-Language header (D12).
func (b *AgentBridge) renderSessionGuide() ([]byte, error) {
	locale := DefaultLocale
	if b != nil && b.store != nil {
		locale, _ = b.store.StoredLocale()
	}
	return renderAgentGuide(agentGuideData{OutputFormat: "xml", Locale: string(locale)})
}

// renderAgentGuide renders the core Agent guide template with an explicit
// output format.
func renderAgentGuide(data agentGuideData) ([]byte, error) {
	guideTemplate, err := template.New("core-agents.md.tmpl").Parse(coreAgentsTemplate)
	if err != nil {
		return nil, fmt.Errorf("parse core Agent prompt: %w", err)
	}
	var rendered bytes.Buffer
	if err := guideTemplate.Execute(&rendered, data); err != nil {
		return nil, fmt.Errorf("render core Agent prompt: %w", err)
	}
	return rendered.Bytes(), nil
}

func (b *AgentBridge) Authenticate(sessionID, token string) (AgentSession, error) {
	b.mu.Lock()
	session, ok := b.sessions[sessionID]
	b.mu.Unlock()
	if !ok {
		var record bridgeRecord
		if err := readProjectJSON(filepath.Join(b.store.SessionWorkspaceDir(sessionID), "..", "bridge-session.json"), &record); err != nil {
			return AgentSession{}, errors.New("unknown agent session")
		}
		session = record.Session
	}
	if token == "" || session.TokenHash != hashToken(token) {
		return AgentSession{}, errors.New("invalid agent session token")
	}
	return session, nil
}

func hashToken(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
