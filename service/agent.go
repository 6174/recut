/*
 * [INPUT]: 依赖 Store 的本地工作区 SQLite、AgentBridge 的 MCP 授权与 Codex JSONL CLI
 * [OUTPUT]: 对外提供 AgentManager、持久化一对一会话、Turn、规范化事件与 Codex adapter
 * [POS]: service 的结构化 Agent 协议层；TerminalManager 保持独立，作为兼容和诊断通道
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const localProfileID = "local"

type ChatSession struct {
	ID              string    `json:"id"`
	ProfileID       string    `json:"profileId"`
	ProjectID       string    `json:"projectId,omitempty"`
	ProjectName     string    `json:"projectName,omitempty"`
	AppID           string    `json:"appId,omitempty"`
	Runtime         string    `json:"runtime"`
	NativeSessionID string    `json:"nativeSessionId,omitempty"`
	Title           string    `json:"title"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type ChatTurn struct {
	ID          string     `json:"id"`
	SessionID   string     `json:"sessionId"`
	Role        string     `json:"role"`
	Content     string     `json:"content"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

type ChatEvent struct {
	ID        int64     `json:"id"`
	SessionID string    `json:"sessionId"`
	TurnID    string    `json:"turnId,omitempty"`
	Type      string    `json:"type"`
	Payload   any       `json:"payload"`
	CreatedAt time.Time `json:"createdAt"`
}

type ChatSessionDetail struct {
	ChatSession
	Turns       []ChatTurn  `json:"turns"`
	Events      []ChatEvent `json:"events"`
	LastEventID int64       `json:"lastEventId"`
}

type AgentManager struct {
	store   *Store
	bridge  *AgentBridge
	mu      sync.Mutex
	running map[string]context.CancelFunc
}

func NewAgentManager(store *Store, bridge *AgentBridge) *AgentManager {
	return &AgentManager{store: store, bridge: bridge, running: map[string]context.CancelFunc{}}
}

func (m *AgentManager) Create(projectID, runtime string) (ChatSession, error) {
	project, err := m.store.Get(projectID)
	if err != nil {
		return ChatSession{}, errors.New("project not found")
	}
	if runtime != "codex" && runtime != "claude" {
		return ChatSession{}, fmt.Errorf("runtime %q is not available yet", runtime)
	}
	id, err := newID()
	if err != nil {
		return ChatSession{}, err
	}
	now := time.Now().UTC()
	session := ChatSession{ID: id, ProfileID: localProfileID, ProjectID: projectID, ProjectName: project.Name, AppID: project.AppID, Runtime: runtime, Title: "新对话", Status: "idle", CreatedAt: now, UpdatedAt: now}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSession{}, err
	}
	defer db.Close()
	_, err = db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", session.ID, session.ProfileID, session.ProjectID, session.Runtime, session.NativeSessionID, session.Title, session.Status, iso(now), iso(now))
	return session, err
}

func (m *AgentManager) List(projectID string) ([]ChatSession, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	query, args := "select id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at from agent_sessions where profile_id = ?", []any{localProfileID}
	if projectID != "" {
		query += " and project_id = ?"
		args = append(args, projectID)
	}
	query += " order by updated_at desc"
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ChatSession{}
	for rows.Next() {
		session, err := scanChatSession(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, m.hydrateSession(session))
	}
	return result, rows.Err()
}

func (m *AgentManager) Detail(id string) (ChatSessionDetail, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSessionDetail{}, err
	}
	defer db.Close()
	session, err := getChatSession(db, id)
	if err != nil {
		return ChatSessionDetail{}, err
	}
	turns, err := listChatTurns(db, id)
	if err != nil {
		return ChatSessionDetail{}, err
	}
	events, err := listChatEvents(db, id, 0)
	if err != nil {
		return ChatSessionDetail{}, err
	}
	var last int64
	if len(events) > 0 {
		last = events[len(events)-1].ID
	}
	return ChatSessionDetail{ChatSession: m.hydrateSession(session), Turns: turns, Events: events, LastEventID: last}, nil
}

// A session stores project_id as its durable relationship. Project name and
// App id are hydrated at the API boundary so the UI can show its actual scope
// without duplicating mutable project metadata in the conversation database.
func (m *AgentManager) hydrateSession(session ChatSession) ChatSession {
	project, err := m.store.Get(session.ProjectID)
	if err != nil {
		return session
	}
	session.ProjectName, session.AppID = project.Name, project.AppID
	return session
}

func (m *AgentManager) Events(id string, after int64) ([]ChatEvent, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if _, err := getChatSession(db, id); err != nil {
		return nil, err
	}
	return listChatEvents(db, id, after)
}

func (m *AgentManager) StartTurn(sessionID, text string) (ChatTurn, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return ChatTurn{}, errors.New("message is required")
	}
	m.mu.Lock()
	if _, exists := m.running[sessionID]; exists {
		m.mu.Unlock()
		return ChatTurn{}, errors.New("this session is already running")
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.running[sessionID] = cancel
	m.mu.Unlock()

	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		m.finish(sessionID)
		return ChatTurn{}, err
	}
	session, err := getChatSession(db, sessionID)
	if err != nil {
		_ = db.Close()
		m.finish(sessionID)
		return ChatTurn{}, err
	}
	turnID, err := newID()
	if err != nil {
		_ = db.Close()
		m.finish(sessionID)
		return ChatTurn{}, err
	}
	now := time.Now().UTC()
	turn := ChatTurn{ID: turnID, SessionID: sessionID, Role: "user", Content: text, Status: "completed", CreatedAt: now, CompletedAt: &now}
	_, err = db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at, completed_at) values (?, ?, ?, ?, ?, ?, ?)", turn.ID, turn.SessionID, turn.Role, turn.Content, turn.Status, iso(now), iso(now))
	if err == nil {
		title := session.Title
		if title == "新对话" {
			title = shortTitle(text)
		}
		_, err = db.Exec("update agent_sessions set title = ?, status = ?, updated_at = ? where id = ?", title, "running", iso(now), sessionID)
		session.Title, session.Status = title, "running"
	}
	_ = db.Close()
	if err != nil {
		m.finish(sessionID)
		return ChatTurn{}, err
	}
	m.emit(sessionID, turnID, "turn.started", map[string]any{"label": "正在思考"})
	go m.run(ctx, session, turn)
	return turn, nil
}

func (m *AgentManager) Stop(sessionID string) error {
	m.mu.Lock()
	cancel, exists := m.running[sessionID]
	m.mu.Unlock()
	if !exists {
		return errors.New("this session is not running")
	}
	cancel()
	return nil
}

func (m *AgentManager) run(ctx context.Context, session ChatSession, userTurn ChatTurn) {
	defer m.finish(session.ID)
	if err := m.runRuntime(ctx, session, userTurn); err != nil {
		m.emit(session.ID, userTurn.ID, "turn.failed", map[string]any{"message": err.Error()})
		m.setSessionStatus(session.ID, "idle")
		return
	}
	m.emit(session.ID, userTurn.ID, "turn.completed", map[string]any{})
	m.setSessionStatus(session.ID, "idle")
}

func (m *AgentManager) runRuntime(ctx context.Context, session ChatSession, userTurn ChatTurn) error {
	switch session.Runtime {
	case "codex":
		return m.runCodex(ctx, session, userTurn)
	case "claude":
		return m.runClaude(ctx, session, userTurn)
	default:
		return fmt.Errorf("runtime %q is not installed", session.Runtime)
	}
}

func (m *AgentManager) runCodex(ctx context.Context, session ChatSession, userTurn ChatTurn) error {
	command, err := exec.LookPath("codex")
	if err != nil {
		return errors.New("Codex CLI is not installed")
	}
	bridgeSession, token, err := m.bridge.CreateSession(session.ProjectID)
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	executable, err = m.bridge.MaterializeCodexProject(bridgeSession, token, executable)
	if err != nil {
		return err
	}
	projectRoot := m.store.projectDir(session.ProjectID)
	args := []string{"exec"}
	if session.NativeSessionID != "" {
		args = append(args, "resume", session.NativeSessionID)
	}
	args = append(args, withoutCodexCD(codexProjectArgs(projectRoot, executable, m.store.root, m.store.catalog.Directory(), bridgeSession, token))...)
	args = append(args, "--json", "--", userTurn.Content)
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = projectRoot
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	var stderrText strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 1024), 64*1024)
		for scanner.Scan() {
			if stderrText.Len() < 4096 {
				stderrText.WriteString(scanner.Text() + "\n")
			}
		}
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var raw map[string]any
		if json.Unmarshal(scanner.Bytes(), &raw) != nil {
			continue
		}
		m.handleCodexEvent(session.ID, userTurn.ID, raw)
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return errors.New("已停止")
		}
		if message := strings.TrimSpace(stderrText.String()); message != "" {
			return errors.New(message)
		}
		return err
	}
	return nil
}

// Claude Code exposes a documented stream-json contract. Its session id is
// immutable once created, exactly like Codex's thread id, so the generic
// ChatSession may safely persist it as native_session_id.
func (m *AgentManager) runClaude(ctx context.Context, session ChatSession, userTurn ChatTurn) error {
	command, err := exec.LookPath("claude")
	if err != nil {
		return errors.New("Claude Code CLI is not installed")
	}
	bridgeSession, token, err := m.bridge.CreateSession(session.ProjectID)
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	profile, err := m.bridge.WriteClientProfile(bridgeSession, executable)
	if err != nil {
		return err
	}
	args := []string{"-p", userTurn.Content, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--mcp-config", profile}
	if session.NativeSessionID != "" {
		args = append(args, "--resume", session.NativeSessionID)
	}
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = m.store.projectDir(session.ProjectID)
	cmd.Env = append(os.Environ(), "RECUT_AGENT_SESSION="+bridgeSession.ID, "RECUT_AGENT_TOKEN="+token)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	var stderrText strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			if stderrText.Len() < 4096 {
				stderrText.WriteString(scanner.Text() + "\n")
			}
		}
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var raw map[string]any
		if json.Unmarshal(scanner.Bytes(), &raw) == nil {
			m.handleClaudeEvent(session.ID, userTurn.ID, raw)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return errors.New("已停止")
		}
		if message := strings.TrimSpace(stderrText.String()); message != "" {
			return errors.New(message)
		}
		return err
	}
	return nil
}

func (m *AgentManager) handleCodexEvent(sessionID, turnID string, raw map[string]any) {
	typeName, _ := raw["type"].(string)
	item, _ := raw["item"].(map[string]any)
	itemType, _ := item["type"].(string)
	switch typeName {
	case "thread.started":
		if nativeID, ok := raw["thread_id"].(string); ok {
			m.setNativeSession(sessionID, nativeID)
		}
		m.emit(sessionID, turnID, "session.updated", map[string]any{"label": "已连接 Agent"})
	case "turn.started":
		m.emit(sessionID, turnID, "status", map[string]any{"phase": "thinking", "label": "正在分析"})
	case "item.started":
		if isCodexTool(itemType) {
			m.emit(sessionID, turnID, "tool.started", codexToolPayload(item, itemType))
		}
	case "item.completed":
		if itemType == "agent_message" {
			text, _ := item["text"].(string)
			if strings.TrimSpace(text) != "" {
				m.addAssistantTurn(sessionID, text)
				m.emit(sessionID, turnID, "assistant.completed", map[string]any{"text": text})
			}
		} else if isCodexTool(itemType) {
			m.emit(sessionID, turnID, "tool.completed", codexToolPayload(item, itemType))
		}
	case "error":
		m.emit(sessionID, turnID, "status", map[string]any{"phase": "error", "label": "Agent 返回错误"})
	}
}

func (m *AgentManager) handleClaudeEvent(sessionID, turnID string, raw map[string]any) {
	typeName, _ := raw["type"].(string)
	if typeName == "system" {
		if sessionIDValue, ok := raw["session_id"].(string); ok {
			m.setNativeSession(sessionID, sessionIDValue)
		}
		m.emit(sessionID, turnID, "status", map[string]any{"phase": "thinking", "label": "正在分析"})
		return
	}
	if typeName == "assistant" {
		message, _ := raw["message"].(map[string]any)
		contents, _ := message["content"].([]any)
		for index, rawContent := range contents {
			content, _ := rawContent.(map[string]any)
			kind, _ := content["type"].(string)
			if kind == "text" {
				if value, ok := content["text"].(string); ok && strings.TrimSpace(value) != "" {
					m.addAssistantTurn(sessionID, value)
					m.emit(sessionID, turnID, "assistant.completed", map[string]any{"text": value})
				}
			}
			if kind == "tool_use" {
				name, _ := content["name"].(string)
				id, _ := content["id"].(string)
				if id == "" {
					id = fmt.Sprintf("tool-%d", index)
				}
				m.emit(sessionID, turnID, "tool.completed", map[string]any{"toolCallId": id, "tool": name, "label": name})
			}
		}
	}
}

func isCodexTool(kind string) bool {
	return kind == "command_execution" || kind == "file_change" || kind == "mcp_tool_call" || kind == "web_search"
}

func codexToolPayload(item map[string]any, kind string) map[string]any {
	label := map[string]string{"command_execution": "运行命令", "file_change": "修改文件", "mcp_tool_call": "调用 Recut 工具", "web_search": "搜索网络"}[kind]
	id, _ := item["id"].(string)
	if id == "" {
		id = kind
	}
	return map[string]any{"toolCallId": id, "tool": kind, "label": label}
}

func (m *AgentManager) addAssistantTurn(sessionID, text string) {
	id, err := newID()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	defer db.Close()
	_, _ = db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at, completed_at) values (?, ?, ?, ?, ?, ?, ?)", id, sessionID, "assistant", text, "completed", iso(now), iso(now))
}

func (m *AgentManager) emit(sessionID, turnID, eventType string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	now := time.Now().UTC()
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	defer db.Close()
	_, _ = db.Exec("insert into agent_events (session_id, turn_id, type, payload_json, created_at) values (?, ?, ?, ?, ?)", sessionID, turnID, eventType, string(data), iso(now))
}

func (m *AgentManager) setNativeSession(id, native string) {
	m.updateSession(id, "native_session_id = ?", native)
}
func (m *AgentManager) setSessionStatus(id, status string) { m.updateSession(id, "status = ?", status) }
func (m *AgentManager) updateSession(id, clause, value string) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	defer db.Close()
	_, _ = db.Exec("update agent_sessions set "+clause+", updated_at = ? where id = ?", value, iso(time.Now().UTC()), id)
}
func (m *AgentManager) finish(id string) { m.mu.Lock(); delete(m.running, id); m.mu.Unlock() }

func getChatSession(db *sql.DB, id string) (ChatSession, error) {
	row := db.QueryRow("select id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at from agent_sessions where id = ? and profile_id = ?", id, localProfileID)
	return scanChatSession(row)
}

type scanner interface{ Scan(...any) error }

func scanChatSession(row scanner) (ChatSession, error) {
	var session ChatSession
	var created, updated string
	err := row.Scan(&session.ID, &session.ProfileID, &session.ProjectID, &session.Runtime, &session.NativeSessionID, &session.Title, &session.Status, &created, &updated)
	if err != nil {
		return ChatSession{}, err
	}
	var parseErr error
	session.CreatedAt, parseErr = time.Parse(time.RFC3339Nano, created)
	if parseErr != nil {
		return ChatSession{}, parseErr
	}
	session.UpdatedAt, parseErr = time.Parse(time.RFC3339Nano, updated)
	return session, parseErr
}
func listChatTurns(db *sql.DB, sessionID string) ([]ChatTurn, error) {
	rows, err := db.Query("select id, session_id, role, content, status, created_at, completed_at from agent_turns where session_id = ? order by created_at, id", sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ChatTurn{}
	for rows.Next() {
		var turn ChatTurn
		var created string
		var completed sql.NullString
		if err := rows.Scan(&turn.ID, &turn.SessionID, &turn.Role, &turn.Content, &turn.Status, &created, &completed); err != nil {
			return nil, err
		}
		turn.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		if completed.Valid {
			at, e := time.Parse(time.RFC3339Nano, completed.String)
			if e != nil {
				return nil, e
			}
			turn.CompletedAt = &at
		}
		result = append(result, turn)
	}
	return result, rows.Err()
}
func listChatEvents(db *sql.DB, sessionID string, after int64) ([]ChatEvent, error) {
	rows, err := db.Query("select id, session_id, turn_id, type, payload_json, created_at from agent_events where session_id = ? and id > ? order by id", sessionID, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ChatEvent{}
	for rows.Next() {
		var event ChatEvent
		var payload, created string
		var turn sql.NullString
		if err := rows.Scan(&event.ID, &event.SessionID, &turn, &event.Type, &payload, &created); err != nil {
			return nil, err
		}
		if turn.Valid {
			event.TurnID = turn.String
		}
		event.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
		if err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(payload), &event.Payload)
		result = append(result, event)
	}
	return result, rows.Err()
}
func iso(value time.Time) string { return value.UTC().Format(time.RFC3339Nano) }
func shortTitle(text string) string {
	runes := []rune(strings.Join(strings.Fields(text), " "))
	if len(runes) > 28 {
		return string(runes[:28]) + "…"
	}
	return string(runes)
}

// `codex exec resume` deliberately accepts fewer flags than fresh `exec`.
// The child process already runs in projectRoot, so -C is redundant and must
// disappear for both paths to keep the resume contract uniform.
func withoutCodexCD(args []string) []string {
	result := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		if args[index] == "-C" || args[index] == "--cd" {
			index++
			continue
		}
		result = append(result, args[index])
	}
	return result
}
