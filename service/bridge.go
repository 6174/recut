/*
 * [INPUT]: 依赖 Store 的工作区身份、全局 Agent guide 模板与标准库文件系统能力
 * [OUTPUT]: 对外提供 AgentBridge、AgentSession、按会话独立的工作区物化（全局 guide + 三 CLI 的 MCP 配置）、OpenCode 外部目录权限与鉴权
 * [POS]: service 的 Agent 会话边界；会话不绑定项目，bridge session 仅携带 Task ID，CLI 从中立会话工作区运行
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
	ID        string    `json:"id"`
	TaskID    string    `json:"taskId,omitempty"`
	TokenHash string    `json:"tokenHash"`
	CreatedAt time.Time `json:"createdAt"`
}

// SessionContext carries the Task identity for one CLI execution. A session
// never binds to a Project or App: the model discovers both exclusively through
// MCP context tools and passes explicit targets.
type SessionContext struct {
	TaskID string
}

type AgentBridge struct {
	mu            sync.Mutex
	store         *Store
	sessions      map[string]AgentSession
	designSystems *DesignSystemManager
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
	return &AgentBridge{store: store, sessions: map[string]AgentSession{}}
}

func (b *AgentBridge) SetDesignSystemManager(manager *DesignSystemManager) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.designSystems = manager
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
	session := AgentSession{ID: id, TaskID: ctx.TaskID, TokenHash: hashToken(token), CreatedAt: time.Now().UTC()}
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

// renderSessionGuide renders the platform-only Agent guide. Domain workflow
// lives in App skills, loaded on demand through recut.skills.read; no App guide
// is injected into the session.
func (b *AgentBridge) renderSessionGuide() ([]byte, error) {
	guideTemplate, err := template.New("core-agents.md.tmpl").Parse(coreAgentsTemplate)
	if err != nil {
		return nil, fmt.Errorf("parse core Agent prompt: %w", err)
	}
	var rendered bytes.Buffer
	if err := guideTemplate.Execute(&rendered, map[string]any{}); err != nil {
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
