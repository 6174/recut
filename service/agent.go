/*
 * [INPUT]: 依赖 Store 的本地工作区 SQLite、持久化 CLI 定位缓存、MediaService 的项目媒体资产、AgentBridge 的 MCP 授权，以及 Codex/OpenCode CLI
 * [OUTPUT]: 对外提供 AgentManager、OpenCode 的实时 TUI 模型目录与连接重试状态、仅内存保留的 CLI stdout/stderr 调试流、缓存定位且失败刷新一次的 CLI 启动、以 --auto 无人值守运行的持久化 Turn、按序待发送队列、服务重启后的中断 Turn 收敛、单连接池也可完成的会话详情读取、不含用户内容的生命周期审计、保留 OpenCode state.error 的工具输入/输出/失败态及时间戳的规范化事件
 * [POS]: service 的结构化 Agent 协议层；媒体二进制始终留在素材库，Turn 只持久化受验证的资产身份
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
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const localProfileID = "local"
const defaultOpencodeModel = "opencode-go/deepseek-v4-flash"

type OpencodeModel struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
}

type ChatSession struct {
	ID              string    `json:"id"`
	ProfileID       string    `json:"profileId"`
	ProjectID       string    `json:"projectId,omitempty"`
	ProjectName     string    `json:"projectName,omitempty"`
	AppID           string    `json:"appId,omitempty"`
	Runtime         string    `json:"runtime"`
	NativeSessionID string    `json:"nativeSessionId,omitempty"`
	CodexModel      string    `json:"codexModel,omitempty"`
	ReasoningEffort string    `json:"reasoningEffort,omitempty"`
	OpencodeModel   string    `json:"opencodeModel,omitempty"`
	Title           string    `json:"title"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type ChatTurn struct {
	ID          string           `json:"id"`
	SessionID   string           `json:"sessionId"`
	Role        string           `json:"role"`
	Content     string           `json:"content"`
	Status      string           `json:"status"`
	CreatedAt   time.Time        `json:"createdAt"`
	CompletedAt *time.Time       `json:"completedAt,omitempty"`
	Attachments []ChatAttachment `json:"attachments"`
}

type ChatAttachment struct {
	AssetID  string `json:"assetId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Origin   string `json:"origin"`
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

const (
	agentCLILineLimit    = 400
	agentCLILineMaxBytes = 16 << 10
)

// AgentCLIOutput is a volatile mirror of one CLI output line. It is never
// persisted: raw CLI output can contain user prompts, local paths, or tool data.
type AgentCLIOutput struct {
	Sequence  uint64    `json:"sequence"`
	Stream    string    `json:"stream"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

type agentCLIStream struct {
	running        bool
	entries        []AgentCLIOutput
	subscribers    map[uint64]chan AgentCLIOutput
	nextSequence   uint64
	nextSubscriber uint64
}

type AgentManager struct {
	store          *Store
	bridge         *AgentBridge
	media          *MediaService
	commands       *AgentCommandResolver
	opencodeModels func(context.Context) ([]OpencodeModel, error)
	mu             sync.Mutex
	running        map[string]context.CancelFunc
	cliStreams     map[string]*agentCLIStream
	modelsMu       sync.Mutex
	modelsCache    []OpencodeModel
	modelsCachedAt time.Time
}

const opencodeModelsCacheTTL = 60 * time.Second

func NewAgentManager(store *Store, bridge *AgentBridge, media *MediaService) *AgentManager {
	commands := store.agentCommands
	return &AgentManager{store: store, bridge: bridge, media: media, commands: commands, opencodeModels: func(ctx context.Context) ([]OpencodeModel, error) { return listOpencodeModels(ctx, commands) }, running: map[string]context.CancelFunc{}, cliStreams: map[string]*agentCLIStream{}}
}

// cachedOpencodeModels bounds the cost of `opencode models`, which spawns the
// CLI and can take seconds. The TTL keeps repeated session creation and
// configuration updates from hanging on a fresh CLI spawn every time.
func (m *AgentManager) cachedOpencodeModels(ctx context.Context) ([]OpencodeModel, error) {
	m.modelsMu.Lock()
	if len(m.modelsCache) > 0 && time.Since(m.modelsCachedAt) < opencodeModelsCacheTTL {
		cached := append([]OpencodeModel(nil), m.modelsCache...)
		m.modelsMu.Unlock()
		return cached, nil
	}
	m.modelsMu.Unlock()
	models, err := m.opencodeModels(ctx)
	if err != nil {
		return nil, err
	}
	m.modelsMu.Lock()
	m.modelsCache = append([]OpencodeModel(nil), models...)
	m.modelsCachedAt = time.Now().UTC()
	m.modelsMu.Unlock()
	return models, nil
}

func (m *AgentManager) beginCLIStream(sessionID string) {
	m.mu.Lock()
	m.cliStreams[sessionID] = &agentCLIStream{running: true, subscribers: map[uint64]chan AgentCLIOutput{}}
	m.mu.Unlock()
}

func (m *AgentManager) finishCLIStream(sessionID string) {
	m.mu.Lock()
	if stream := m.cliStreams[sessionID]; stream != nil {
		stream.running = false
	}
	m.mu.Unlock()
}

func (m *AgentManager) captureCLIOutput(sessionID, streamName, text string) {
	if text == "" {
		return
	}
	if len(text) > agentCLILineMaxBytes {
		text = text[:agentCLILineMaxBytes] + " …[truncated]"
	}
	m.mu.Lock()
	stream := m.cliStreams[sessionID]
	if stream == nil {
		m.mu.Unlock()
		return
	}
	stream.nextSequence++
	entry := AgentCLIOutput{Sequence: stream.nextSequence, Stream: streamName, Text: text, CreatedAt: time.Now().UTC()}
	stream.entries = append(stream.entries, entry)
	if len(stream.entries) > agentCLILineLimit {
		stream.entries = append([]AgentCLIOutput(nil), stream.entries[len(stream.entries)-agentCLILineLimit:]...)
	}
	for _, subscriber := range stream.subscribers {
		select {
		case subscriber <- entry:
		default:
		}
	}
	m.mu.Unlock()
}

func (m *AgentManager) SubscribeCLIStream(sessionID string) ([]AgentCLIOutput, <-chan AgentCLIOutput, func()) {
	m.mu.Lock()
	stream := m.cliStreams[sessionID]
	if stream == nil {
		m.mu.Unlock()
		return nil, nil, func() {}
	}
	history := append([]AgentCLIOutput(nil), stream.entries...)
	stream.nextSubscriber++
	subscriberID := stream.nextSubscriber
	output := make(chan AgentCLIOutput, agentCLILineLimit)
	stream.subscribers[subscriberID] = output
	m.mu.Unlock()
	return history, output, func() {
		m.mu.Lock()
		if current := m.cliStreams[sessionID]; current == stream {
			delete(current.subscribers, subscriberID)
		}
		m.mu.Unlock()
	}
}

// RecoverInterruptedTurns reconciles durable state with the process boundary.
// A CLI child cannot survive this daemon, so a persisted running turn after a
// restart is cancelled rather than being presented as a stoppable live task.
// Queued turns are durable and safe to resume in their original FIFO order.
func (m *AgentManager) RecoverInterruptedTurns() (int, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return 0, err
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	type interruptedTurn struct{ id, sessionID string }
	var turns []interruptedTurn
	rows, err := tx.Query("select id, session_id from agent_turns where role = ? and status = ?", "user", "running")
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var turn interruptedTurn
		if err := rows.Scan(&turn.id, &turn.sessionID); err != nil {
			_ = rows.Close()
			return 0, err
		}
		turns = append(turns, turn)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	sessions := map[string]bool{}
	for _, turn := range turns {
		sessions[turn.sessionID] = true
	}
	rows, err = tx.Query("select id from agent_sessions where status = ?", "running")
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var sessionID string
		if err := rows.Scan(&sessionID); err != nil {
			_ = rows.Close()
			return 0, err
		}
		sessions[sessionID] = true
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	now := iso(time.Now().UTC())
	for _, turn := range turns {
		if _, err := tx.Exec("update agent_turns set status = ?, completed_at = ? where id = ? and status = ?", "cancelled", now, turn.id, "running"); err != nil {
			return 0, err
		}
		if _, err := tx.Exec("insert into agent_events (session_id, turn_id, type, payload_json, created_at) values (?, ?, ?, ?, ?)", turn.sessionID, turn.id, "turn.cancelled", `{"label":"服务重启，当前回复已停止"}`, now); err != nil {
			return 0, err
		}
	}
	for sessionID := range sessions {
		if _, err := tx.Exec("update agent_sessions set status = ?, updated_at = ? where id = ?", "idle", now, sessionID); err != nil {
			return 0, err
		}
		if _, err := tx.Exec("insert into agent_events (session_id, turn_id, type, payload_json, created_at) values (?, ?, ?, ?, ?)", sessionID, "", "session.updated", `{"label":"服务重启后已恢复为空闲"}`, now); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}

	for _, sessionID := range m.queuedSessionIDs() {
		m.startRunner(sessionID)
	}
	return len(turns), nil
}

func (m *AgentManager) queuedSessionIDs() []string {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return nil
	}
	rows, err := db.Query("select distinct session_id from agent_turns where role = ? and status = ?", "user", "queued")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var sessionIDs []string
	for rows.Next() {
		var sessionID string
		if rows.Scan(&sessionID) == nil {
			sessionIDs = append(sessionIDs, sessionID)
		}
	}
	return sessionIDs
}

func (m *AgentManager) Create(projectID, runtime, codexModel, reasoningEffort, opencodeModel string) (ChatSession, error) {
	project, err := m.store.Get(projectID)
	if err != nil {
		return ChatSession{}, errors.New("project not found")
	}
	if runtime != "codex" && runtime != "claude" && runtime != "opencode" {
		return ChatSession{}, fmt.Errorf("runtime %q is not available yet", runtime)
	}
	if runtime == "codex" {
		var err error
		codexModel, reasoningEffort, err = normalizeCodexConfiguration(codexModel, reasoningEffort)
		if err != nil {
			return ChatSession{}, err
		}
	} else if codexModel != "" || reasoningEffort != "" {
		return ChatSession{}, errors.New("Codex configuration is only available for Codex conversations")
	}
	if runtime == "opencode" {
		opencodeModel, err = m.normalizeOpencodeConfiguration(context.Background(), opencodeModel)
		if err != nil {
			return ChatSession{}, err
		}
	} else if opencodeModel != "" {
		return ChatSession{}, errors.New("OpenCode configuration is only available for OpenCode conversations")
	}
	id, err := newID()
	if err != nil {
		return ChatSession{}, err
	}
	now := time.Now().UTC()
	session := ChatSession{ID: id, ProfileID: localProfileID, ProjectID: projectID, ProjectName: project.Name, AppID: project.AppID, Runtime: runtime, CodexModel: codexModel, ReasoningEffort: reasoningEffort, OpencodeModel: opencodeModel, Title: "新对话", Status: "idle", CreatedAt: now, UpdatedAt: now}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSession{}, err
	}
	_, err = db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, codex_model, reasoning_effort, opencode_model, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", session.ID, session.ProfileID, session.ProjectID, session.Runtime, session.NativeSessionID, session.CodexModel, session.ReasoningEffort, session.OpencodeModel, session.Title, session.Status, iso(now), iso(now))
	if err != nil {
		return session, err
	}
	log.Printf("INFO agent session created session_id=%s project_id=%s runtime=%s", session.ID, session.ProjectID, session.Runtime)
	return session, nil
}

func (m *AgentManager) List(projectID string) ([]ChatSession, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	query, args := "select id, profile_id, project_id, runtime, native_session_id, coalesce(codex_model, ''), coalesce(reasoning_effort, ''), coalesce(opencode_model, ''), title, status, created_at, updated_at from agent_sessions where profile_id = ?", []any{localProfileID}
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
	if _, err := getChatSession(db, id); err != nil {
		return nil, err
	}
	return listChatEvents(db, id, after)
}

func (m *AgentManager) StartTurn(sessionID, text string, assetIDs []string) (ChatTurn, error) {
	text = strings.TrimSpace(text)
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatTurn{}, err
	}
	session, err := getChatSession(db, sessionID)
	if err != nil {
		return ChatTurn{}, err
	}
	attachments, err := m.turnAttachments(session.ProjectID, assetIDs)
	if err != nil {
		return ChatTurn{}, err
	}
	if text == "" && len(attachments) == 0 {
		return ChatTurn{}, errors.New("message or image is required")
	}
	turnID, err := newID()
	if err != nil {
		return ChatTurn{}, err
	}
	now := time.Now().UTC()
	turn := ChatTurn{ID: turnID, SessionID: sessionID, Role: "user", Content: text, Status: "queued", CreatedAt: now, Attachments: attachments}
	tx, err := db.Begin()
	if err == nil {
		defer tx.Rollback()
		_, err = tx.Exec("insert into agent_turns (id, session_id, role, content, status, created_at) values (?, ?, ?, ?, ?, ?)", turn.ID, turn.SessionID, turn.Role, turn.Content, turn.Status, iso(now))
	}
	if err == nil {
		for _, attachment := range attachments {
			if _, err = tx.Exec("insert into agent_turn_attachments (turn_id, asset_id) values (?, ?)", turn.ID, attachment.AssetID); err != nil {
				break
			}
		}
	}
	if err == nil {
		title := session.Title
		if title == "新对话" {
			title = shortTitle(text)
			if title == "" {
				title = "图片对话"
			}
		}
		_, err = tx.Exec("update agent_sessions set title = ?, status = ?, updated_at = ? where id = ?", title, "running", iso(now), sessionID)
		if err == nil {
			err = tx.Commit()
		}
		if err == nil {
			session.Title, session.Status = title, "running"
		}
	}
	if err != nil {
		return ChatTurn{}, err
	}
	m.emit(sessionID, turnID, "turn.queued", map[string]any{"label": "已加入待发送消息"})
	log.Printf("INFO agent turn queued session_id=%s turn_id=%s attachments=%d", sessionID, turn.ID, len(attachments))
	m.startRunner(sessionID)
	return turn, nil
}

func (m *AgentManager) turnAttachments(projectID string, assetIDs []string) ([]ChatAttachment, error) {
	attachments := make([]ChatAttachment, 0, len(assetIDs))
	seen := map[string]bool{}
	for _, id := range assetIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		asset, err := m.media.GetAsset(id)
		if err != nil || !containsString(asset.ProjectIDs, projectID) {
			return nil, errors.New("media attachment is unavailable in this project")
		}
		attachments = append(attachments, ChatAttachment{AssetID: asset.ID, Name: asset.Name, Kind: asset.Kind, MimeType: asset.MimeType, Origin: asset.Origin})
	}
	return attachments, nil
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func (m *AgentManager) Stop(sessionID string) error {
	m.mu.Lock()
	cancel, exists := m.running[sessionID]
	m.mu.Unlock()
	if !exists {
		return errors.New("this session is not running")
	}
	turnID, err := m.cancelActiveTurn(sessionID)
	if err != nil {
		return err
	}
	m.emit(sessionID, "", "turn.stopping", map[string]any{"label": "正在停止"})
	m.setSessionStatus(sessionID, "idle")
	if turnID != "" {
		m.emit(sessionID, turnID, "turn.cancelled", map[string]any{"label": "已停止"})
	}
	log.Printf("INFO agent turn stop requested session_id=%s turn_id=%s", sessionID, turnID)
	m.emit(sessionID, "", "session.updated", map[string]any{"label": "会话已停止"})
	cancel()
	return nil
}

// UpdateCodexConfiguration changes the defaults used by the next queued turn.
// A running child process keeps its already-started configuration unchanged.
func (m *AgentManager) UpdateCodexConfiguration(sessionID, model, effort string) (ChatSession, error) {
	model, effort, err := normalizeCodexConfiguration(model, effort)
	if err != nil {
		return ChatSession{}, err
	}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSession{}, err
	}
	session, err := getChatSession(db, sessionID)
	if err != nil {
		return ChatSession{}, err
	}
	if session.Runtime != "codex" {
		return ChatSession{}, errors.New("only Codex conversations have this configuration")
	}
	now := time.Now().UTC()
	if _, err := db.Exec("update agent_sessions set codex_model = ?, reasoning_effort = ?, updated_at = ? where id = ?", model, effort, iso(now), sessionID); err != nil {
		return ChatSession{}, err
	}
	session.CodexModel, session.ReasoningEffort, session.UpdatedAt = model, effort, now
	return m.hydrateSession(session), nil
}

// UpdateOpencodeConfiguration changes the model used by the next queued turn.
// A running OpenCode child process keeps its already-started configuration.
func (m *AgentManager) UpdateOpencodeConfiguration(sessionID, model string) (ChatSession, error) {
	model, err := m.normalizeOpencodeConfiguration(context.Background(), model)
	if err != nil {
		return ChatSession{}, err
	}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSession{}, err
	}
	session, err := getChatSession(db, sessionID)
	if err != nil {
		return ChatSession{}, err
	}
	if session.Runtime != "opencode" {
		return ChatSession{}, errors.New("only OpenCode conversations have this configuration")
	}
	now := time.Now().UTC()
	if _, err := db.Exec("update agent_sessions set opencode_model = ?, updated_at = ? where id = ?", model, iso(now), sessionID); err != nil {
		return ChatSession{}, err
	}
	session.OpencodeModel, session.UpdatedAt = model, now
	return m.hydrateSession(session), nil
}

func (m *AgentManager) startRunner(sessionID string) {
	m.mu.Lock()
	if _, running := m.running[sessionID]; running {
		m.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.running[sessionID] = cancel
	m.mu.Unlock()
	m.setSessionStatus(sessionID, "running")
	go m.run(ctx, sessionID)
}

func (m *AgentManager) run(ctx context.Context, sessionID string) {
	for {
		session, turn, ok := m.nextQueuedTurn(sessionID)
		if !ok {
			m.setSessionStatus(sessionID, "idle")
			m.emit(sessionID, "", "session.updated", map[string]any{"label": "等待下一条消息"})
			m.finishAndRestart(sessionID)
			return
		}
		m.emit(sessionID, turn.ID, "turn.started", map[string]any{"label": "正在思考"})
		log.Printf("INFO agent turn started session_id=%s turn_id=%s runtime=%s", sessionID, turn.ID, session.Runtime)
		if err := m.runRuntime(ctx, session, turn); err != nil {
			if ctx.Err() != nil {
				if m.completeTurnIfRunning(turn.ID, "cancelled") {
					m.emit(sessionID, turn.ID, "turn.cancelled", map[string]any{"label": "已停止"})
				}
				m.finishAndRestart(sessionID)
				m.emit(sessionID, "", "session.updated", map[string]any{"label": "会话状态已更新"})
				log.Printf("WARN agent turn cancelled session_id=%s turn_id=%s", sessionID, turn.ID)
				return
			}
			m.completeTurn(turn.ID, "failed")
			m.emit(sessionID, turn.ID, "turn.failed", map[string]any{"message": err.Error()})
			log.Printf("ERROR agent turn failed session_id=%s turn_id=%s runtime=%s", sessionID, turn.ID, session.Runtime)
			continue
		}
		m.completeTurn(turn.ID, "completed")
		m.emit(sessionID, turn.ID, "turn.completed", map[string]any{})
		log.Printf("INFO agent turn completed session_id=%s turn_id=%s", sessionID, turn.ID)
	}
}

// finishAndRestart closes the race between checking an empty queue and a new
// message being committed. A concurrent sender either observes this runner or
// starts the replacement runner; pending messages therefore never stall.
func (m *AgentManager) finishAndRestart(sessionID string) {
	m.finish(sessionID)
	if m.hasQueuedTurn(sessionID) {
		m.startRunner(sessionID)
	}
}

func (m *AgentManager) hasQueuedTurn(sessionID string) bool {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return false
	}
	var count int
	err = db.QueryRow("select count(*) from agent_turns where session_id = ? and role = ? and status = ?", sessionID, "user", "queued").Scan(&count)
	return err == nil && count > 0
}

func (m *AgentManager) nextQueuedTurn(sessionID string) (ChatSession, ChatTurn, bool) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSession{}, ChatTurn{}, false
	}
	session, err := getChatSession(db, sessionID)
	if err != nil {
		return ChatSession{}, ChatTurn{}, false
	}
	row := db.QueryRow("select id, session_id, role, content, status, created_at, completed_at from agent_turns where session_id = ? and role = ? and status = ? order by created_at, id limit 1", sessionID, "user", "queued")
	turn, err := scanChatTurn(row)
	if err != nil {
		return ChatSession{}, ChatTurn{}, false
	}
	if _, err := db.Exec("update agent_turns set status = ?, completed_at = null where id = ?", "running", turn.ID); err != nil {
		return ChatSession{}, ChatTurn{}, false
	}
	turn.Status, turn.CompletedAt = "running", nil
	return session, turn, true
}

func (m *AgentManager) completeTurn(turnID, status string) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	_, _ = db.Exec("update agent_turns set status = ?, completed_at = ? where id = ?", status, iso(time.Now().UTC()), turnID)
}

func (m *AgentManager) completeTurnIfRunning(turnID, status string) bool {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return false
	}
	result, err := db.Exec("update agent_turns set status = ?, completed_at = ? where id = ? and status = ?", status, iso(time.Now().UTC()), turnID, "running")
	if err != nil {
		return false
	}
	affected, err := result.RowsAffected()
	return err == nil && affected == 1
}

func (m *AgentManager) cancelActiveTurn(sessionID string) (string, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return "", err
	}
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	row := tx.QueryRow("select id from agent_turns where session_id = ? and role = ? and status = ? order by created_at, id limit 1", sessionID, "user", "running")
	var turnID string
	if err := row.Scan(&turnID); errors.Is(err, sql.ErrNoRows) {
		return "", tx.Commit()
	} else if err != nil {
		return "", err
	}
	result, err := tx.Exec("update agent_turns set status = ?, completed_at = ? where id = ? and status = ?", "cancelled", iso(time.Now().UTC()), turnID, "running")
	if err != nil {
		return "", err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return "", nil
	}
	return turnID, tx.Commit()
}

func (m *AgentManager) runRuntime(ctx context.Context, session ChatSession, userTurn ChatTurn) error {
	switch session.Runtime {
	case "codex":
		return m.runCodex(ctx, session, userTurn)
	case "claude":
		return m.runClaude(ctx, session, userTurn)
	case "opencode":
		return m.runOpencode(ctx, session, userTurn)
	default:
		return fmt.Errorf("runtime %q is not installed", session.Runtime)
	}
}

func (m *AgentManager) runCodex(ctx context.Context, session ChatSession, userTurn ChatTurn) error {
	model, effort, err := normalizeCodexConfiguration(session.CodexModel, session.ReasoningEffort)
	if err != nil {
		return err
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
	args = append(args, "--model", model, "--config", fmt.Sprintf("model_reasoning_effort=%q", effort))
	attachments := m.attachmentContexts(userTurn.Attachments)
	for _, attachment := range attachments {
		if attachment.Kind == "image" {
			args = append(args, "--image", attachment.Path)
		}
	}
	args = append(args, "--json", "--", userTurn.runtimePrompt()+attachmentPrompt(attachments))
	cmd, stdout, stderr, err := m.startCLI(ctx, "codex", args, projectRoot, nil)
	if err != nil {
		return err
	}
	m.beginCLIStream(session.ID)
	defer m.finishCLIStream(session.ID)
	var stderrText strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 1024), 64*1024)
		for scanner.Scan() {
			m.captureCLIOutput(session.ID, "stderr", scanner.Text())
			if stderrText.Len() < 4096 {
				stderrText.WriteString(scanner.Text() + "\n")
			}
		}
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		m.captureCLIOutput(session.ID, "stdout", scanner.Text())
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
	prompt := userTurn.runtimePrompt() + attachmentPrompt(m.attachmentContexts(userTurn.Attachments))
	args := []string{"-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--mcp-config", profile}
	if session.NativeSessionID != "" {
		args = append(args, "--resume", session.NativeSessionID)
	}
	cmd, stdout, stderr, err := m.startCLI(ctx, "claude", args, m.store.projectDir(session.ProjectID), []string{"RECUT_AGENT_SESSION=" + bridgeSession.ID, "RECUT_AGENT_TOKEN=" + token})
	if err != nil {
		return err
	}
	m.beginCLIStream(session.ID)
	defer m.finishCLIStream(session.ID)
	var stderrText strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			m.captureCLIOutput(session.ID, "stderr", scanner.Text())
			if stderrText.Len() < 4096 {
				stderrText.WriteString(scanner.Text() + "\n")
			}
		}
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		m.captureCLIOutput(session.ID, "stdout", scanner.Text())
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

// OpenCode also publishes a stream-json contract; it carries a stable
// `sessionID` in the event envelope, so the same ChatSession.native_session_id
// field can resume the conversation via `opencode run --session <id>`.
// MCP wiring is per-project via opencode.json written by the bridge.
func (m *AgentManager) runOpencode(ctx context.Context, session ChatSession, userTurn ChatTurn) error {
	model, err := m.normalizeOpencodeConfiguration(ctx, session.OpencodeModel)
	if err != nil {
		return err
	}
	bridgeSession, token, err := m.bridge.CreateSession(session.ProjectID)
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if _, err := m.bridge.WriteOpencodeProject(bridgeSession, token, executable); err != nil {
		return err
	}
	prompt := userTurn.runtimePrompt() + attachmentPrompt(m.attachmentContexts(userTurn.Attachments))
	projectDir := m.store.projectDir(session.ProjectID)
	args := opencodeRunArgs(prompt, projectDir, model, session.NativeSessionID, session.Title)
	cmd, stdout, stderr, err := m.startCLI(ctx, "opencode", args, projectDir, []string{"RECUT_AGENT_SESSION=" + bridgeSession.ID, "RECUT_AGENT_TOKEN=" + token})
	if err != nil {
		return err
	}
	m.beginCLIStream(session.ID)
	defer m.finishCLIStream(session.ID)
	var stderrText strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			m.captureCLIOutput(session.ID, "stderr", line)
			if strings.Contains(line, `message="stream error"`) {
				m.emit(session.ID, userTurn.ID, "status", map[string]any{"phase": "retrying", "label": "OpenCode 正在重试模型连接"})
			}
			if !strings.HasPrefix(line, "timestamp=") && stderrText.Len() < 4096 {
				stderrText.WriteString(line + "\n")
			}
		}
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		m.captureCLIOutput(session.ID, "stdout", scanner.Text())
		var raw map[string]any
		if json.Unmarshal(scanner.Bytes(), &raw) == nil {
			m.handleOpencodeEvent(session.ID, userTurn.ID, raw)
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

// opencodeRunArgs gives first turns a fixed title and auto-approves tools,
// matching Recut's intentionally unattended Codex execution mode.
func opencodeRunArgs(prompt, projectDir, model, nativeSessionID, title string) []string {
	args := []string{"run", prompt, "--format", "json", "--print-logs", "--auto", "--dir", projectDir, "--model", model}
	if nativeSessionID != "" {
		return append(args, "--session", nativeSessionID)
	}
	return append(args, "--title", title)
}

// agentCLIUnavailableError keeps process-environment failures actionable at
// the durable event boundary, where both the UI and a later session reload
// receive the same explanation.
func agentCLIUnavailableError(name, command string) error {
	return fmt.Errorf("%s CLI is unavailable. Install and sign in to it on the device running Recut service, confirm that the service user can run %q, then restart Recut service", name, command)
}

type attachmentContext struct {
	AssetID string
	Name    string
	Kind    string
	Origin  string
	Path    string
}

func (m *AgentManager) attachmentContexts(attachments []ChatAttachment) []attachmentContext {
	contexts := make([]attachmentContext, 0, len(attachments))
	for _, attachment := range attachments {
		asset, err := m.media.GetAsset(attachment.AssetID)
		if err != nil {
			continue
		}
		if path, _ := asset.Metadata["path"].(string); path != "" {
			contexts = append(contexts, attachmentContext{AssetID: asset.ID, Name: asset.Name, Kind: asset.Kind, Origin: asset.Origin, Path: path})
		}
	}
	return contexts
}

func attachmentPrompt(attachments []attachmentContext) string {
	if len(attachments) == 0 {
		return ""
	}
	lines := make([]string, 0, len(attachments)+1)
	lines = append(lines, "\n\n本条消息附带的素材已导入全局素材库。后续媒体工具必须引用 assetId；path 仅供本次 Agent 读取：")
	for _, attachment := range attachments {
		lines = append(lines, fmt.Sprintf("- assetId=%s；name=%s；kind=%s；origin=%s；path=%s", attachment.AssetID, attachment.Name, attachment.Kind, attachment.Origin, attachment.Path))
	}
	return strings.Join(lines, "\n")
}

func (t ChatTurn) runtimePrompt() string {
	if t.Content != "" {
		return t.Content
	}
	return "请分析随本条消息附上的图片。"
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
			m.emit(sessionID, turnID, "tool.started", codexToolPayload(item, itemType, "input"))
		}
	case "item.completed", "item.failed":
		if itemType == "agent_message" {
			text, _ := item["text"].(string)
			if strings.TrimSpace(text) != "" {
				m.addAssistantTurn(sessionID, text)
				m.emit(sessionID, turnID, "assistant.completed", map[string]any{"text": text})
			}
		} else if isCodexTool(itemType) {
			eventType := "tool.completed"
			if typeName == "item.failed" || codexToolFailed(item) {
				eventType = "tool.failed"
			}
			phase := "output"
			if eventType == "tool.failed" {
				phase = "error"
			}
			m.emit(sessionID, turnID, eventType, codexToolPayload(item, itemType, phase))
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

// handleOpencodeEvent maps OpenCode's `opencode run --format json` envelope
// into the platform's generic event vocabulary. The session id is carried by
// every event under `sessionID`; assistant text arrives in `part.text` and
// tool invocations in `part.state` with `status` and free-form input/output.
func (m *AgentManager) handleOpencodeEvent(sessionID, turnID string, raw map[string]any) {
	if sid, ok := raw["sessionID"].(string); ok && sid != "" {
		m.setNativeSession(sessionID, sid)
	}
	typeName, _ := raw["type"].(string)
	part, _ := raw["part"].(map[string]any)
	switch typeName {
	case "step_start":
		m.emit(sessionID, turnID, "status", map[string]any{"phase": "thinking", "label": "正在分析"})
	case "step_finish":
		// No-op: terminal status is communicated by the surrounding turn lifecycle.
	case "text":
		if value, ok := part["text"].(string); ok && strings.TrimSpace(value) != "" {
			m.addAssistantTurn(sessionID, value)
			m.emit(sessionID, turnID, "assistant.completed", map[string]any{"text": value})
		}
	case "tool_use":
		if part == nil {
			return
		}
		id, _ := part["id"].(string)
		toolName, _ := part["tool"].(string)
		state, _ := part["state"].(map[string]any)
		status, _ := state["status"].(string)
		eventType := "tool.completed"
		phase := "output"
		if status == "error" || status == "failed" {
			eventType = "tool.failed"
			phase = "error"
		}
		payload := map[string]any{
			"toolCallId": id,
			"tool":       toolName,
			"toolName":   toolName,
			"label":      toolLabel("mcp_tool_call", toolName, nil),
		}
		if detail := opencodeToolDetail(state, "input"); detail != "" {
			payload["input"] = detail
		}
		if detail := opencodeToolDetail(state, phase); detail != "" {
			payload[phase] = detail
		}
		m.emit(sessionID, turnID, eventType, payload)
	case "error":
		label := "OpenCode 返回错误"
		if value, ok := raw["error"]; ok {
			if data, err := json.Marshal(value); err == nil {
				label = label + "：" + string(data)
			}
		}
		m.emit(sessionID, turnID, "status", map[string]any{"phase": "error", "label": label})
	}
}

// opencodeToolDetail keeps OpenCode's error field distinct from successful
// output. Failed tool_use events put the diagnostic in state.error, not output.
func opencodeToolDetail(state map[string]any, phase string) string {
	keys := map[string][]string{
		"input":  {"input"},
		"output": {"output", "result"},
		"error":  {"error", "output", "result", "message"},
	}[phase]
	values := map[string]any{}
	for _, key := range keys {
		if value, ok := state[key]; ok {
			values[key] = value
		}
	}
	if len(values) == 0 {
		return ""
	}
	data, err := json.Marshal(values)
	if err != nil {
		return fmt.Sprint(values)
	}
	return string(data)
}

func isCodexTool(kind string) bool {
	return kind == "command_execution" || kind == "file_change" || kind == "mcp_tool_call" || kind == "web_search"
}

func codexToolPayload(item map[string]any, kind, phase string) map[string]any {
	id, _ := item["id"].(string)
	if id == "" {
		id = kind
	}
	name := codexToolName(item, kind)
	label := toolLabel(kind, name, item)
	payload := map[string]any{"toolCallId": id, "tool": kind, "label": label, "toolName": name}
	if detail := codexToolDetail(item, phase); detail != "" {
		payload[phase] = detail
	}
	if cost := codexToolCost(item); cost != "" {
		payload["cost"] = cost
	}
	return payload
}

func codexToolFailed(item map[string]any) bool {
	status := strings.ToLower(fmt.Sprint(item["status"]))
	if status == "failed" || status == "error" {
		return true
	}
	return toolResultFailed(item)
}

func toolResultFailed(value any) bool {
	switch result := value.(type) {
	case nil:
		return false
	case bool:
		return result
	case string:
		text := strings.TrimSpace(result)
		if text == "" {
			return false
		}
		var decoded any
		if json.Unmarshal([]byte(text), &decoded) == nil {
			return toolResultFailed(decoded)
		}
		return strings.HasPrefix(strings.ToLower(text), "error:") || strings.HasPrefix(strings.ToLower(text), "failed:")
	case map[string]any:
		if failed, ok := result["is_error"].(bool); ok && failed {
			return true
		}
		if failed, ok := result["isError"].(bool); ok && failed {
			return true
		}
		status := strings.ToLower(fmt.Sprint(result["status"]))
		if status == "failed" || status == "error" {
			return true
		}
		if errorValue, exists := result["error"]; exists {
			if text, ok := errorValue.(string); ok {
				return strings.TrimSpace(text) != ""
			}
			if errorMap, ok := errorValue.(map[string]any); ok {
				return len(errorMap) > 0
			}
			return toolResultFailed(errorValue)
		}
		return toolResultFailed(result["result"]) || toolResultFailed(result["output"])
	default:
		return false
	}
}

func toolLabel(kind, name string, item map[string]any) string {
	if kind != "mcp_tool_call" || name == "" {
		return map[string]string{"command_execution": "运行命令", "file_change": "修改文件", "mcp_tool_call": "MCP 工具调用", "web_search": "搜索网络"}[kind] + toolLabelSuffix(name)
	}
	labels := map[string]string{
		"recut.project_context":       "读取 Recut 项目上下文",
		"recut.media.configuration":   "读取媒体模型配置",
		"recut.image.generate":        "生成图片",
		"recut.video.generate_async":  "提交视频生成任务",
		"recut.speech.generate_async": "提交语音生成任务",
		"recut.media.list_voices":     "读取可用音色",
		"recut.media.get_job":         "查询媒体生成进度",
		"recut.media.wait_for_job":    "等待媒体生成结果",
		"recut.media.list_assets":     "读取素材库",
		"recut.media.import_image":    "归档 Codex 原生图片",
		"recut.media.attach":          "将素材关联到项目",
	}
	if label, ok := labels[name]; ok {
		return label
	}
	return "调用 " + name
}
func toolLabelSuffix(name string) string {
	if name == "" {
		return ""
	}
	return " · " + name
}

func codexToolName(item map[string]any, kind string) string {
	keys := map[string][]string{
		"mcp_tool_call":     {"tool", "tool_name", "name"},
		"command_execution": {"command", "cmd"},
		"web_search":        {"query", "search_query"},
	}[kind]
	name := ""
	for _, key := range keys {
		if value, ok := item[key]; ok && name == "" {
			name = fmt.Sprint(value)
		}
	}
	return name
}

func codexToolDetail(item map[string]any, phase string) string {
	keys := map[string][]string{
		"input":  {"arguments", "input", "command", "cmd", "path", "query", "search_query"},
		"output": {"result", "output", "aggregated_output", "changes", "summary", "results"},
		"error":  {"error", "result", "output", "aggregated_output"},
	}[phase]
	values := map[string]any{}
	for _, key := range keys {
		if value, ok := item[key]; ok {
			values[key] = value
		}
	}
	if len(values) == 0 {
		return ""
	}
	data, err := json.Marshal(values)
	if err != nil {
		return fmt.Sprint(values)
	}
	return string(data)
}

func codexToolCost(item map[string]any) string {
	values := map[string]any{}
	for _, key := range []string{"cost", "cost_usd", "credits", "billed_credits", "usage", "billing"} {
		if value, ok := item[key]; ok {
			values[key] = value
		}
	}
	if len(values) == 0 {
		return ""
	}
	data, err := json.Marshal(values)
	if err != nil {
		return fmt.Sprint(values)
	}
	return string(data)
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
	if _, err := db.Exec("insert into agent_events (session_id, turn_id, type, payload_json, created_at) values (?, ?, ?, ?, ?)", sessionID, turnID, eventType, string(data), iso(now)); err != nil {
		return
	}
	m.store.agentEvents.notify()
}

// SessionExists is the cheap existence check used by the SSE endpoints. It
// avoids loading the full turn and event history just to validate a session.
func (m *AgentManager) SessionExists(id string) (bool, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return false, err
	}
	var count int
	if err := db.QueryRow("select count(*) from agent_sessions where id = ? and profile_id = ?", id, localProfileID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
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
	_, _ = db.Exec("update agent_sessions set "+clause+", updated_at = ? where id = ?", value, iso(time.Now().UTC()), id)
}
func (m *AgentManager) finish(id string) { m.mu.Lock(); delete(m.running, id); m.mu.Unlock() }

func getChatSession(db *sql.DB, id string) (ChatSession, error) {
	row := db.QueryRow("select id, profile_id, project_id, runtime, native_session_id, coalesce(codex_model, ''), coalesce(reasoning_effort, ''), coalesce(opencode_model, ''), title, status, created_at, updated_at from agent_sessions where id = ? and profile_id = ?", id, localProfileID)
	return scanChatSession(row)
}

type scanner interface{ Scan(...any) error }

func scanChatSession(row scanner) (ChatSession, error) {
	var session ChatSession
	var created, updated string
	err := row.Scan(&session.ID, &session.ProfileID, &session.ProjectID, &session.Runtime, &session.NativeSessionID, &session.CodexModel, &session.ReasoningEffort, &session.OpencodeModel, &session.Title, &session.Status, &created, &updated)
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

func normalizeCodexConfiguration(model, effort string) (string, string, error) {
	if model == "" {
		model = "gpt-5.6-terra"
	}
	if effort == "" {
		effort = "xhigh"
	}
	models := map[string]bool{"gpt-5.6-sol": true, "gpt-5.6-terra": true, "gpt-5.6-luna": true, "gpt-5.5": true, "gpt-5.4": true, "gpt-5.4-mini": true, "gpt-5.2": true}
	efforts := map[string]bool{"low": true, "medium": true, "high": true, "xhigh": true, "max": true}
	if !models[model] {
		return "", "", fmt.Errorf("Codex model %q is unavailable", model)
	}
	if !efforts[effort] {
		return "", "", fmt.Errorf("reasoning effort %q is unavailable", effort)
	}
	return model, effort, nil
}

func (m *AgentManager) normalizeOpencodeConfiguration(ctx context.Context, model string) (string, error) {
	models, err := m.cachedOpencodeModels(ctx)
	if err != nil {
		return "", err
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultOpencodeModel
	}
	for _, available := range models {
		if available.ID == model {
			return model, nil
		}
	}
	return "", fmt.Errorf("OpenCode TUI does not offer model %q", model)
}

func (m *AgentManager) startCLI(ctx context.Context, command string, arguments []string, directory string, overrides []string) (*exec.Cmd, io.ReadCloser, io.ReadCloser, error) {
	cmd, stdout, stderr, err := m.commands.Start(ctx, command, arguments, directory, overrides)
	if err != nil {
		return nil, nil, nil, agentCLIUnavailableError(agentRuntimeName(command), command)
	}
	return cmd, stdout, stderr, nil
}

func agentRuntimeName(command string) string {
	return map[string]string{"codex": "Codex", "claude": "Claude Code", "opencode": "OpenCode"}[command]
}

func listOpencodeModels(ctx context.Context, commands *AgentCommandResolver) ([]OpencodeModel, error) {
	command, err := commands.Find("opencode")
	if err != nil {
		return nil, agentCLIUnavailableError("OpenCode", "opencode")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, command.Path, "models")
	cmd.Env = environmentWithOverrides(os.Environ(), command.Env)
	output, err := cmd.CombinedOutput()
	if err != nil {
		commands.Invalidate("opencode")
		if retry, retryErr := commands.Find("opencode"); retryErr == nil {
			cmd = exec.CommandContext(ctx, retry.Path, "models")
			cmd.Env = environmentWithOverrides(os.Environ(), retry.Env)
			output, err = cmd.CombinedOutput()
		}
	}
	if err != nil {
		return nil, fmt.Errorf("unable to read OpenCode models: %s", strings.TrimSpace(string(output)))
	}
	return parseOpencodeModels(string(output)), nil
}

func parseOpencodeModels(output string) []OpencodeModel {
	models := make([]OpencodeModel, 0)
	for _, line := range strings.Split(output, "\n") {
		id := strings.TrimSpace(line)
		provider, name, found := strings.Cut(id, "/")
		if found && name != "" {
			models = append(models, OpencodeModel{ID: id, Provider: provider})
		}
	}
	return models
}
func listChatTurns(db *sql.DB, sessionID string) ([]ChatTurn, error) {
	rows, err := db.Query("select id, session_id, role, content, status, created_at, completed_at from agent_turns where session_id = ? order by created_at, id", sessionID)
	if err != nil {
		return nil, err
	}
	result := []ChatTurn{}
	for rows.Next() {
		turn, err := scanChatTurn(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		result = append(result, turn)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range result {
		attachments, err := listChatAttachments(db, result[index].ID)
		if err != nil {
			return nil, err
		}
		result[index].Attachments = attachments
	}
	return result, nil
}

func listChatAttachments(db *sql.DB, turnID string) ([]ChatAttachment, error) {
	rows, err := db.Query(`select a.id, a.name, a.kind, a.mime_type, a.origin from agent_turn_attachments t join media_assets a on a.id = t.asset_id where t.turn_id = ? order by a.created_at, a.id`, turnID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attachments := []ChatAttachment{}
	for rows.Next() {
		var attachment ChatAttachment
		if err := rows.Scan(&attachment.AssetID, &attachment.Name, &attachment.Kind, &attachment.MimeType, &attachment.Origin); err != nil {
			return nil, err
		}
		attachments = append(attachments, attachment)
	}
	return attachments, rows.Err()
}

func scanChatTurn(row scanner) (ChatTurn, error) {
	var turn ChatTurn
	var created string
	var completed sql.NullString
	if err := row.Scan(&turn.ID, &turn.SessionID, &turn.Role, &turn.Content, &turn.Status, &created, &completed); err != nil {
		return ChatTurn{}, err
	}
	var err error
	turn.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return ChatTurn{}, err
	}
	if completed.Valid {
		at, err := time.Parse(time.RFC3339Nano, completed.String)
		if err != nil {
			return ChatTurn{}, err
		}
		turn.CompletedAt = &at
	}
	return turn, nil
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
