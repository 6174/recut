/*
 * [INPUT]: 依赖 Store 的工作区身份、全局 Agent guide 模板与标准库文件系统能力
 * [OUTPUT]: 对外提供 AgentBridge、AgentSession、按会话独立的工作区物化（全局 guide + 三 CLI 的 MCP 配置）与鉴权
 * [POS]: service 的 Agent 会话边界；会话不绑定项目，bridge session 携带冻结的默认 Doc 与 Task ID，CLI 从会话工作区运行
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
	ProjectID string    `json:"projectId,omitempty"`
	AppID     string    `json:"appId,omitempty"`
	TaskID    string    `json:"taskId,omitempty"`
	TokenHash string    `json:"tokenHash"`
	CreatedAt time.Time `json:"createdAt"`
}

// SessionContext carries the frozen default Doc (optional) and Task identity for
// one CLI execution. A session never binds to a Project; the default Doc only
// influences target resolution for calls that do not pass an explicit target.
type SessionContext struct {
	ProjectID string
	AppID     string
	TaskID    string
}

type AgentBridge struct {
	mu       sync.Mutex
	store    *Store
	sessions map[string]AgentSession
}

const opencodeMCPTimeoutMilliseconds = 5 * 60 * 1000

type bridgeRecord struct {
	Session AgentSession `json:"session"`
}

func NewAgentBridge(store *Store) *AgentBridge {
	return &AgentBridge{store: store, sessions: map[string]AgentSession{}}
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
	session := AgentSession{ID: id, ProjectID: ctx.ProjectID, AppID: ctx.AppID, TaskID: ctx.TaskID, TokenHash: hashToken(token), CreatedAt: time.Now().UTC()}
	workspace := b.store.SessionWorkspaceDir(session.ID)
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		return AgentSession{}, "", err
	}
	// For a Project-target session the workspace exposes the Project directory
	// through a controlled `project` symlink, so the CLI can write native Codex
	// images into `project/files/...` and import them back as Project Assets.
	if session.ProjectID != "" {
		if _, err := b.store.Get(session.ProjectID); err == nil {
			if target, targetErr := filepath.EvalSymlinks(b.store.projectDir(session.ProjectID)); targetErr == nil {
				link := filepath.Join(workspace, "project")
				_ = os.Remove(link)
				if linkErr := os.Symlink(target, link); linkErr != nil {
					return AgentSession{}, "", linkErr
				}
			}
		}
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

func (b *AgentBridge) appsDir() string {
	if b.store.catalog != nil {
		return b.store.catalog.Directory()
	}
	return filepath.Join(b.store.root, "apps")
}

// MaterializeCodexWorkspace writes the global guide and the Codex MCP config
// into the session workspace. The workspace is the CLI cwd, so guide and config
// never touch a user project and concurrent sessions cannot overwrite each other.
func (b *AgentBridge) MaterializeCodexWorkspace(session AgentSession, token, executable string) (string, error) {
	root := b.WorkspaceDir(session)
	if err := os.MkdirAll(filepath.Join(root, ".codex"), 0o700); err != nil {
		return "", err
	}
	agents, err := b.renderSessionGuide()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), agents, 0o600); err != nil {
		return "", err
	}
	config := fmt.Sprintf(`[mcp_servers.recut]
command = %q
args = ["--mcp-stdio", "--data-dir", %q, "--apps-dir", %q]
env = { RECUT_AGENT_SESSION = %q, RECUT_AGENT_TOKEN = %q }
`, executable, b.store.root, b.appsDir(), session.ID, token)
	if err := os.WriteFile(filepath.Join(root, ".codex", "config.toml"), []byte(config), 0o600); err != nil {
		return "", err
	}
	return root, nil
}

// WriteOpencodeWorkspace writes the global guide and the OpenCode MCP config
// into the session workspace.
func (b *AgentBridge) WriteOpencodeWorkspace(session AgentSession, token, executable string) (string, error) {
	root := b.WorkspaceDir(session)
	agents, err := b.renderSessionGuide()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), agents, 0o600); err != nil {
		return "", err
	}
	config := map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"mcp": map[string]any{
			"recut": map[string]any{
				"type":    "local",
				"command": []string{executable, "--mcp-stdio", "--data-dir", b.store.root, "--apps-dir", b.appsDir()},
				"environment": map[string]any{
					"RECUT_AGENT_SESSION": session.ID,
					"RECUT_AGENT_TOKEN":   token,
				},
				"enabled": true,
				"timeout": opencodeMCPTimeoutMilliseconds,
			},
		},
		"experimental": map[string]any{"mcp_timeout": opencodeMCPTimeoutMilliseconds},
	}
	if err := writeProjectJSON(filepath.Join(root, "opencode.json"), config); err != nil {
		return "", err
	}
	return root, nil
}

// WriteClaudeProfile materializes the Claude Code MCP adapter in the session
// workspace. The token is intentionally absent: the CLI process passes it to
// its MCP child through env.
func (b *AgentBridge) WriteClaudeProfile(session AgentSession, executable string) (string, error) {
	root := b.WorkspaceDir(session)
	agents, err := b.renderSessionGuide()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), agents, 0o600); err != nil {
		return "", err
	}
	profile := map[string]any{"mcpServers": map[string]any{"recut": map[string]any{
		"command": executable,
		"args":    []string{"--mcp-stdio", "--data-dir", b.store.root, "--apps-dir", b.appsDir()},
	}}}
	path := filepath.Join(root, "claude-mcp.json")
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
