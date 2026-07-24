/*
 * [INPUT]: 依赖 Store 的项目身份与标准库文件系统能力
 * [OUTPUT]: 对外提供 AgentBridge、AgentSession 与本地 Agent CLI 会话凭据
 * [POS]: service 的 Agent 会话边界；App 业务能力由 MCP Host 转发给 background.js
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const bridgeInstructions = `You are connected to Recut through the MCP Host.

- First call recut.project_context, then tools/list. Do not infer project state from the filesystem.
- Use only recut.project_context and tools declared by the current App manifest.
- App tools execute through the App background runtime; do not read or mutate project files directly.
- Report returned Artifact IDs when a tool creates reusable output.`

type AgentSession struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"projectId"`
	TokenHash string    `json:"tokenHash"`
	CreatedAt time.Time `json:"createdAt"`
}

type AgentBridge struct {
	mu       sync.Mutex
	store    *Store
	sessions map[string]AgentSession
}

type bridgeRecord struct {
	Session AgentSession `json:"session"`
}

type ContextSnapshot struct {
	ResourceRef           string         `json:"resourceRef"`
	Revision              string         `json:"revision"`
	Project               Project        `json:"project"`
	AppState              map[string]any `json:"appState"`
	AvailableSourceStates []string       `json:"availableSourceStates"`
	Instructions          string         `json:"instructions"`
}

type CommandProposal struct {
	ID               string    `json:"id"`
	ProjectID        string    `json:"projectId"`
	Name             string    `json:"name"`
	Path             string    `json:"path"`
	Value            any       `json:"value"`
	ExpectedRevision string    `json:"expectedRevision"`
	CreatedAt        time.Time `json:"createdAt"`
}

type CommandTransaction struct {
	ID         string          `json:"id"`
	ProjectID  string          `json:"projectId"`
	ProposalID string          `json:"proposalId"`
	Path       string          `json:"path"`
	Previous   json.RawMessage `json:"previous"`
	CreatedAt  time.Time       `json:"createdAt"`
}

type WorkflowProposal struct {
	Proposal  CommandProposal `json:"proposal"`
	SessionID string          `json:"sessionId"`
}

func NewAgentBridge(store *Store) *AgentBridge {
	return &AgentBridge{store: store, sessions: map[string]AgentSession{}}
}

func (b *AgentBridge) CreateSession(projectID string) (AgentSession, string, error) {
	if _, err := b.store.Get(projectID); err != nil {
		return AgentSession{}, "", errors.New("project not found")
	}
	id, err := newID()
	if err != nil {
		return AgentSession{}, "", err
	}
	token, err := newID()
	if err != nil {
		return AgentSession{}, "", err
	}
	session := AgentSession{ID: id, ProjectID: projectID, TokenHash: hashToken(token), CreatedAt: time.Now().UTC()}
	if err := os.MkdirAll(b.sessionDir(session.ID), 0o700); err != nil {
		return AgentSession{}, "", err
	}
	if err := writeProjectJSON(filepath.Join(b.sessionDir(session.ID), "bridge-session.json"), bridgeRecord{Session: session}); err != nil {
		return AgentSession{}, "", err
	}
	b.mu.Lock()
	b.sessions[session.ID] = session
	b.mu.Unlock()
	return session, token, nil
}

// WriteClientProfile materializes the client-specific MCP adapter for one short-lived session.
// The token is intentionally absent: the CLI process passes it to its MCP child through env.
func (b *AgentBridge) WriteClientProfile(session AgentSession, executable string) (string, error) {
	profile := map[string]any{"mcpServers": map[string]any{"recut": map[string]any{
		"command": executable,
		"args":    []string{"--mcp-stdio", "--data-dir", b.store.root, "--apps-dir", b.store.catalog.Directory()},
	}}}
	path := filepath.Join(b.sessionDir(session.ID), "claude-mcp.json")
	if err := writeProjectJSON(path, profile); err != nil {
		return "", err
	}
	return path, nil
}

func (b *AgentBridge) MaterializeCodexProject(session AgentSession, token, executable string) (string, error) {
	stable, err := b.stableMCPExecutable(executable)
	if err != nil {
		return "", err
	}
	executable = stable
	root := b.store.projectDir(session.ProjectID)
	if err := os.MkdirAll(filepath.Join(root, ".codex"), 0o700); err != nil {
		return "", err
	}
	project, err := b.store.Get(session.ProjectID)
	if err != nil {
		return "", err
	}
	app, ok := b.store.catalog.Get(project.AppID)
	if !ok {
		return "", errors.New("project App is unavailable")
	}
	appGuide, err := os.ReadFile(filepath.Join(app.Root, "AGENTS.md"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	agents := `# Recut Project Agent Guide

You are working inside a Recut project through its MCP Host.

## Required turn protocol

1. Call recut.project_context before reasoning about project state.
2. Call tools/list before selecting an App tool. Before generating media, call recut.media.configuration and use only its configured model contract.
3. Use only Recut MCP tools for project data; do not inspect or edit project files directly.
4. State what you learned from the tool result. Report Artifact IDs after creation.

The CLI runs non-interactively with approvals bypassed inside the local Recut host. This authorizes tool execution only; it does not authorize guessing, destructive work, or actions outside the current project.
`
	if len(appGuide) > 0 {
		agents += "\n## Current App Guide\n\nThe following guide is supplied by the installed App package and is authoritative for its workflow, reference usage, decision gates, and tool contracts.\n\n" + string(appGuide)
	}
	config := fmt.Sprintf(`[mcp_servers.recut]
command = %q
args = ["--mcp-stdio", "--data-dir", %q, "--apps-dir", %q]
env = { RECUT_AGENT_SESSION = %q, RECUT_AGENT_TOKEN = %q }
`, executable, b.store.root, b.store.catalog.Directory(), session.ID, token)
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte(agents), 0o600); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(root, ".codex", "config.toml"), []byte(config), 0o600); err != nil {
		return "", err
	}
	return executable, nil
}

func (b *AgentBridge) stableMCPExecutable(source string) (string, error) {
	data, err := os.ReadFile(source)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(b.store.root, "bin")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	target := filepath.Join(dir, "recut-mcp")
	if err := os.WriteFile(target, data, 0o700); err != nil {
		return "", err
	}
	return target, nil
}

func (b *AgentBridge) Authenticate(sessionID, token string) (AgentSession, error) {
	b.mu.Lock()
	session, ok := b.sessions[sessionID]
	b.mu.Unlock()
	if !ok {
		var record bridgeRecord
		if err := readProjectJSON(filepath.Join(b.sessionDir(sessionID), "bridge-session.json"), &record); err != nil {
			return AgentSession{}, errors.New("unknown agent session")
		}
		session = record.Session
	}
	if token == "" || session.TokenHash != hashToken(token) {
		return AgentSession{}, errors.New("invalid agent session token")
	}
	return session, nil
}

func (b *AgentBridge) Context(session AgentSession) (ContextSnapshot, error) {
	project, err := b.store.Get(session.ProjectID)
	if err != nil {
		return ContextSnapshot{}, err
	}
	return ContextSnapshot{
		ResourceRef:           "app://projects/" + project.ID,
		Revision:              b.revision(project.ID),
		Project:               project,
		AppState:              map[string]any{"appId": project.AppID},
		AvailableSourceStates: nil,
		Instructions:          bridgeInstructions,
	}, nil
}

func (b *AgentBridge) ReadSourceState(session AgentSession, path string) (map[string]any, error) {
	return nil, errors.New("source-state access was replaced by App capabilities")
}

func (b *AgentBridge) Propose(session AgentSession, name, path, expectedRevision string, value any) (CommandProposal, error) {
	if name != "replace_source_state" {
		return CommandProposal{}, fmt.Errorf("unsupported command %q", name)
	}
	if expectedRevision != b.revision(session.ProjectID) {
		return CommandProposal{}, errors.New("state revision conflict")
	}
	if !b.isDeclaredSource(session.ProjectID, path) {
		return CommandProposal{}, errors.New("command path is not a declared source state")
	}
	id, err := newID()
	if err != nil {
		return CommandProposal{}, err
	}
	proposal := CommandProposal{ID: id, ProjectID: session.ProjectID, Name: name, Path: path, Value: value, ExpectedRevision: expectedRevision, CreatedAt: time.Now().UTC()}
	if err := writeProjectJSON(filepath.Join(b.sessionDir(session.ID), "proposals", id+".json"), proposal); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return CommandProposal{}, err
		}
		if err := os.MkdirAll(filepath.Join(b.sessionDir(session.ID), "proposals"), 0o700); err != nil {
			return CommandProposal{}, err
		}
		if err := writeProjectJSON(filepath.Join(b.sessionDir(session.ID), "proposals", id+".json"), proposal); err != nil {
			return CommandProposal{}, err
		}
	}
	b.appendEvent(session.ProjectID, map[string]any{"type": "agent.command.proposed", "proposalId": proposal.ID, "sessionId": session.ID, "path": proposal.Path, "value": proposal.Value, "at": proposal.CreatedAt})
	return proposal, nil
}

func (b *AgentBridge) Commit(session AgentSession, proposalID, expectedRevision string) (map[string]any, error) {
	return nil, errors.New("generic source-state commits were replaced by App capabilities")
}

func (b *AgentBridge) ApproveProposal(sessionID, proposalID string) (map[string]any, error) {
	var record bridgeRecord
	if err := readProjectJSON(filepath.Join(b.sessionDir(sessionID), "bridge-session.json"), &record); err != nil {
		return nil, errors.New("agent session not found")
	}
	proposal := CommandProposal{}
	if err := readProjectJSON(filepath.Join(b.sessionDir(sessionID), "proposals", proposalID+".json"), &proposal); err != nil {
		return nil, errors.New("proposal not found")
	}
	result, err := b.Commit(record.Session, proposalID, proposal.ExpectedRevision)
	if err == nil {
		_ = os.Remove(filepath.Join(b.sessionDir(sessionID), "proposals", proposalID+".json"))
	}
	return result, err
}

func (b *AgentBridge) LatestProposal(projectID, path string) (*WorkflowProposal, error) {
	entries, err := os.ReadDir(filepath.Join(b.store.root, "sessions", "agent-bridge"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var latest *WorkflowProposal
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		proposals, err := os.ReadDir(filepath.Join(b.sessionDir(entry.Name()), "proposals"))
		if err != nil {
			continue
		}
		for _, file := range proposals {
			proposal := CommandProposal{}
			if readProjectJSON(filepath.Join(b.sessionDir(entry.Name()), "proposals", file.Name()), &proposal) != nil || proposal.ProjectID != projectID || proposal.Path != path {
				continue
			}
			candidate := &WorkflowProposal{Proposal: proposal, SessionID: entry.Name()}
			if latest == nil || candidate.Proposal.CreatedAt.After(latest.Proposal.CreatedAt) {
				latest = candidate
			}
		}
	}
	return latest, nil
}

func (b *AgentBridge) Undo(session AgentSession, transactionID, expectedRevision string) (map[string]any, error) {
	if expectedRevision != b.revision(session.ProjectID) {
		return nil, errors.New("state revision conflict")
	}
	transaction := CommandTransaction{}
	if err := readProjectJSON(filepath.Join(b.sessionDir(session.ID), "transactions", transactionID+".json"), &transaction); err != nil {
		return nil, errors.New("transaction not found")
	}
	if transaction.ProjectID != session.ProjectID || !b.isDeclaredSource(session.ProjectID, transaction.Path) {
		return nil, errors.New("transaction is outside this agent session")
	}
	project, err := b.store.Get(session.ProjectID)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(b.store.projectDir(project.ID), "apps", project.AppID, transaction.Path), append(transaction.Previous, '\n'), 0o644); err != nil {
		return nil, err
	}
	b.appendEvent(project.ID, map[string]any{"type": "agent.command.undone", "transactionId": transaction.ID, "at": time.Now().UTC()})
	return map[string]any{"transactionId": transaction.ID, "revision": b.revision(project.ID), "undone": true}, nil
}

func (b *AgentBridge) sessionDir(id string) string {
	return filepath.Join(b.store.root, "sessions", "agent-bridge", id)
}

func (b *AgentBridge) revision(projectID string) string {
	file, err := os.Open(filepath.Join(b.store.projectDir(projectID), "state", "events.jsonl"))
	if err != nil {
		return "0"
	}
	defer file.Close()
	hash := sha256.New()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		event := map[string]any{}
		if json.Unmarshal(scanner.Bytes(), &event) == nil && (event["type"] == "agent.command.committed" || event["type"] == "agent.command.undone") {
			_, _ = hash.Write(scanner.Bytes())
		}
	}
	return fmt.Sprintf("%x", hash.Sum(nil))[:16]
}

func (b *AgentBridge) isDeclaredSource(projectID, path string) bool {
	return false
}

func (b *AgentBridge) appendEvent(projectID string, event any) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	file, err := os.OpenFile(filepath.Join(b.store.projectDir(projectID), "state", "events.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err == nil {
		_, _ = file.Write(append(data, '\n'))
		_ = file.Close()
	}
}

func hashToken(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
