/*
 * [INPUT]: 依赖 Store 的本地工作区 SQLite、持久化 CLI 定位缓存、MediaService 的项目媒体资产、AgentBridge 的 MCP 授权，以及 Codex/OpenCode CLI
 * [OUTPUT]: 对外提供 AgentManager、持久化 Turn、CLI 生命周期、调试事件，以及 Work Surface（经 Store 校验的目标策略）与完整 Work Focus 的提示词物化
 * [POS]: service 的结构化 Agent 协议层；每个 Turn 固定自己的真实工作目标，Focus 不能脱离或改写该目标
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
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const localProfileID = "local"

// cliStreamScanLimit caps one scanned line of a CLI stdout/stderr JSONL stream.
// CLI events embed whole tool outputs (a single tool.completed event can carry
// tens of KB or more), which far exceeds bufio.Scanner's 64KB default; hitting
// that cap aborts the whole turn with "bufio.Scanner: token too long", so keep
// the cap generous. Oversized tool output must be truncated at the tool layer
// (see truncateMCPToolResult), never by crashing the transport.
const cliStreamScanLimit = 16 << 20

// cliScanError turns the raw bufio "token too long" failure into a message that
// names the actual cause instead of leaking a scanner internals string.
func cliScanError(err error) error {
	if errors.Is(err, bufio.ErrTooLong) {
		return fmt.Errorf("CLI 输出出现超过单行上限（%d 字节）的行，已终止本次回合；请检查是否把超长工具输出内联进了事件流", cliStreamScanLimit)
	}
	return err
}

const defaultOpencodeModel = "opencode-go/deepseek-v4-flash"

type OpencodeModel struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
}

type ChatSession struct {
	ID              string    `json:"id"`
	ProfileID       string    `json:"profileId"`
	Runtime         string    `json:"runtime"`
	NativeSessionID string    `json:"nativeSessionId,omitempty"`
	NativeWorkspace string    `json:"nativeWorkspace,omitempty"`
	CodexModel      string    `json:"codexModel,omitempty"`
	ReasoningEffort string    `json:"reasoningEffort,omitempty"`
	OpencodeModel   string    `json:"opencodeModel,omitempty"`
	Title           string    `json:"title"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// ChatSession is unbound: it never carries a Project or App binding. The model
// discovers Project and App context exclusively through MCP tools.

type ChatTurn struct {
	ID          string           `json:"id"`
	SessionID   string           `json:"sessionId"`
	TaskID      string           `json:"taskId,omitempty"`
	Role        string           `json:"role"`
	Content     string           `json:"content"`
	Status      string           `json:"status"`
	CreatedAt   time.Time        `json:"createdAt"`
	CompletedAt *time.Time       `json:"completedAt,omitempty"`
	Attachments []ChatAttachment `json:"attachments"`
	Contexts    []ChatContext    `json:"contexts"`
}

type ChatAttachment struct {
	AssetID  string `json:"assetId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Origin   string `json:"origin"`
}

// ChatContext is one typed piece of context mounted onto a user turn, e.g. a
// media Asset (type "media") or the page the user was editing when sending
// (type "page"). Source records who mounted it: "user" for explicit picks,
// "page" for the automatically attached current page, or "app" when an App
// reported it. The payload is a per-type JSON object resolved by a registered
// contextMaterializer when the turn runs.
type ChatContext struct {
	Type    string         `json:"type"`
	Source  string         `json:"source"`
	Payload map[string]any `json:"payload"`
}

// TurnContext is the wire form of a context item accepted when starting a turn.
type TurnContext struct {
	Type    string          `json:"type"`
	Source  string          `json:"source"`
	Payload json.RawMessage `json:"payload"`
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
	// bridgeSessions 记录当前 turn 的 chatSessionID -> bridgeSessionID 映射。
	// 主 Agent 的 MCP 工具调用以 bridge session 身份鉴权（subagent 工具调用注册在 bridge ID 下），
	// 而事件流（handleCodexEvent 等）用 chat session ID；subagentId 注入据此映射消费。
	bridgeSessions map[string]string
	modelsMu       sync.Mutex
	modelsCache    []OpencodeModel
	modelsCachedAt time.Time
}

const opencodeModelsCacheTTL = 60 * time.Second

const opencodeSilenceTimeout = 6 * time.Minute

var errOpencodeResponseTimeout = errors.New("OpenCode 连续无响应超时")

// OpenCode 静默看门狗只取消连续没有 CLI 活动的进程；复杂 Agent Loop
// 只要持续产生进展即可运行任意时长。
type opencodeSilenceWatchdog struct {
	activity chan struct{}
	stopped  chan struct{}
	cancel   context.CancelFunc
	timedOut bool
	mu       sync.Mutex
	once     sync.Once
}

func newOpencodeSilenceWatchdog(parent context.Context, timeout time.Duration) (context.Context, *opencodeSilenceWatchdog) {
	ctx, cancel := context.WithCancel(parent)
	watchdog := &opencodeSilenceWatchdog{activity: make(chan struct{}, 1), stopped: make(chan struct{}), cancel: cancel}
	go watchdog.run(timeout)
	return ctx, watchdog
}

func (w *opencodeSilenceWatchdog) run(timeout time.Duration) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-w.stopped:
			return
		case <-w.activity:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(timeout)
		case <-timer.C:
			w.mu.Lock()
			w.timedOut = true
			w.mu.Unlock()
			w.cancel()
			return
		}
	}
}

func (w *opencodeSilenceWatchdog) Touch() {
	select {
	case w.activity <- struct{}{}:
	default:
	}
}

func (w *opencodeSilenceWatchdog) TimedOut() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.timedOut
}

func (w *opencodeSilenceWatchdog) Stop() {
	w.once.Do(func() {
		close(w.stopped)
		w.cancel()
	})
}

func NewAgentManager(store *Store, bridge *AgentBridge, media *MediaService) *AgentManager {
	commands := store.agentCommands
	return &AgentManager{store: store, bridge: bridge, media: media, commands: commands, opencodeModels: func(ctx context.Context) ([]OpencodeModel, error) { return listOpencodeModels(ctx, commands) }, running: map[string]context.CancelFunc{}, cliStreams: map[string]*agentCLIStream{}, bridgeSessions: map[string]string{}}
}

// recordBridgeSession 记录当前 turn 的 chatSessionID -> bridgeSessionID 映射（见 bridgeSessions 注释）。
func (m *AgentManager) recordBridgeSession(chatID, bridgeID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bridgeSessions[chatID] = bridgeID
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

	type interruptedTurn struct{ id, sessionID, taskID string }
	var turns []interruptedTurn
	rows, err := tx.Query("select id, session_id, coalesce(task_id, '') from agent_turns where role = ? and status = ?", "user", "running")
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var turn interruptedTurn
		if err := rows.Scan(&turn.id, &turn.sessionID, &turn.taskID); err != nil {
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
		if _, err := tx.Exec("update agent_sessions set status = ?, native_session_id = case when runtime = ? then '' else native_session_id end, native_workspace = case when runtime = ? then '' else native_workspace end, updated_at = ? where id = ?", "idle", "opencode", "opencode", now, sessionID); err != nil {
			return 0, err
		}
		if _, err := tx.Exec("insert into agent_events (session_id, turn_id, type, payload_json, created_at) values (?, ?, ?, ?, ?)", sessionID, "", "session.updated", `{"label":"服务重启后已恢复为空闲"}`, now); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	for _, turn := range turns {
		if turn.taskID != "" {
			_ = m.store.CompleteTask(turn.taskID)
		}
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

func (m *AgentManager) Create(runtime, codexModel, reasoningEffort, opencodeModel string) (ChatSession, error) {
	if runtime != "codex" && runtime != "claude" && runtime != "opencode" {
		return ChatSession{}, fmt.Errorf("runtime %q is not available yet", runtime)
	}
	var err error
	if runtime == "codex" {
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
	session := ChatSession{ID: id, ProfileID: localProfileID, Runtime: runtime, CodexModel: codexModel, ReasoningEffort: reasoningEffort, OpencodeModel: opencodeModel, Title: "新对话", Status: "idle", CreatedAt: now, UpdatedAt: now}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSession{}, err
	}
	_, err = db.Exec("insert into agent_sessions (id, profile_id, runtime, native_session_id, native_workspace, codex_model, reasoning_effort, opencode_model, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", session.ID, session.ProfileID, session.Runtime, session.NativeSessionID, session.NativeWorkspace, session.CodexModel, session.ReasoningEffort, session.OpencodeModel, session.Title, session.Status, iso(now), iso(now))
	if err != nil {
		return session, err
	}
	log.Printf("INFO agent session created session_id=%s runtime=%s", session.ID, session.Runtime)
	return session, nil
}

// CreateChildSession 持久化一个受限子 Agent 会话行（agent_sessions），与通用会话同构，仅额外记录
// parent_session_id / job_id / allowed_tools 供审计链与受限工具面恢复。执行是一次性的，记录是持久的。
func (m *AgentManager) CreateChildSession(parentID, jobID, runtime, codexModel, reasoningEffort, opencodeModel, title string, allowedTools []string) (ChatSession, error) {
	id, err := newID()
	if err != nil {
		return ChatSession{}, err
	}
	allowed, _ := json.Marshal(allowedTools)
	now := time.Now().UTC()
	session := ChatSession{ID: id, ProfileID: localProfileID, Runtime: runtime, CodexModel: codexModel, ReasoningEffort: reasoningEffort, OpencodeModel: opencodeModel, Title: title, Status: "running", CreatedAt: now, UpdatedAt: now}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSession{}, err
	}
	_, err = db.Exec("insert into agent_sessions (id, profile_id, runtime, native_session_id, native_workspace, codex_model, reasoning_effort, opencode_model, title, status, parent_session_id, job_id, allowed_tools, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		session.ID, session.ProfileID, session.Runtime, "", "", session.CodexModel, session.ReasoningEffort, session.OpencodeModel, session.Title, session.Status, parentID, jobID, string(allowed), iso(now), iso(now))
	if err != nil {
		return ChatSession{}, err
	}
	log.Printf("INFO subagent session created session_id=%s parent_session_id=%s job_id=%s runtime=%s", session.ID, parentID, jobID, session.Runtime)
	return session, nil
}

// UpdateChildSessionStatus 把子会话状态随 job 终态同步（completed/failed/cancelled）。
func (m *AgentManager) UpdateChildSessionStatus(sessionID, status string) {
	m.updateSession(sessionID, "status = ?", status)
}

// emitSubagentJobEvent 把一条 subagent job 生命周期事件写入 agent_events 账本（type=subagent.job），
// 供审计与 subagent channel 的断线回放。
func (m *AgentManager) emitSubagentJobEvent(sessionID, event string, view map[string]any) {
	m.emit(sessionID, "", "subagent.job", map[string]any{"event": event, "job": view})
}

// SessionByJob 按 job_id 查找子会话（daemon 重启后 job 内存态丢失，审计视图据此从账本重建）。
func (m *AgentManager) SessionByJob(jobID string) (ChatSession, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatSession{}, err
	}
	row := db.QueryRow("select id, profile_id, runtime, native_session_id, coalesce(native_workspace, ''), coalesce(codex_model, ''), coalesce(reasoning_effort, ''), coalesce(opencode_model, ''), title, status, created_at, updated_at from agent_sessions where job_id = ? and profile_id = ? limit 1", jobID, localProfileID)
	return scanChatSession(row)
}

func (m *AgentManager) List(projectID, scope string) ([]ChatSession, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	query, args := "select id, profile_id, runtime, native_session_id, coalesce(native_workspace, ''), coalesce(codex_model, ''), coalesce(reasoning_effort, ''), coalesce(opencode_model, ''), title, status, created_at, updated_at from agent_sessions where profile_id = ? and parent_session_id is null", []any{localProfileID}
	switch {
	case projectID != "":
		query += " and project_id = ?"
		args = append(args, projectID)
	case scope == "media":
		query += " and app_view = 'media'"
	case strings.HasPrefix(scope, "app:"):
		query += " and app_view = 'standalone' and app_id = ?"
		args = append(args, strings.TrimPrefix(scope, "app:"))
	case scope == "general":
		query += " and (project_id is null or project_id = '') and coalesce(app_view, '') = ''"
	}
	// SQLite 对相同时间戳的行不保证顺序；rowid 是此表稳定的创建序号。
	query += " order by updated_at desc, agent_sessions.rowid desc"
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
		result = append(result, session)
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
	m.enrichTurnContexts(turns)
	events, err := listChatEvents(db, id, 0)
	if err != nil {
		return ChatSessionDetail{}, err
	}
	var last int64
	if len(events) > 0 {
		last = events[len(events)-1].ID
	}
	return ChatSessionDetail{ChatSession: session, Turns: turns, Events: events, LastEventID: last}, nil
}

func (m *AgentManager) subagentToolFields(sessionID string) map[string]any {
	if m.bridge == nil {
		return nil
	}
	// 主 Agent 事件流用 chatSessionID，而 subagent 工具调用注册在 bridge session ID 下
	// （MCP 以 bridge session 鉴权）；先查 chat ID，再经映射查当前 turn 的 bridge ID。
	ids := []string{sessionID}
	m.mu.Lock()
	if bridgeID := m.bridgeSessions[sessionID]; bridgeID != "" {
		ids = append(ids, bridgeID)
	}
	m.mu.Unlock()
	for _, id := range ids {
		info, ok := m.bridge.consumeSubagentToolCall(id)
		if !ok {
			continue
		}
		return map[string]any{
			"subagentId":        info.SubagentID,
			"subagentAppId":     info.AppID,
			"subagentOperation": info.Operation,
		}
	}
	return nil
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

func (m *AgentManager) StartTurn(sessionID, text string, assetIDs []string, inputContexts []TurnContext) (ChatTurn, error) {
	text = strings.TrimSpace(text)
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return ChatTurn{}, err
	}
	session, err := getChatSession(db, sessionID)
	if err != nil {
		return ChatTurn{}, err
	}
	// 上一个 turn 若因异常没消费 subagent 工具调用注册，清理残留，避免串到下一条 tool.completed。
	if m.bridge != nil {
		m.bridge.clearSubagentToolCall(sessionID)
		m.mu.Lock()
		bridgeID := m.bridgeSessions[sessionID]
		m.mu.Unlock()
		if bridgeID != "" {
			m.bridge.clearSubagentToolCall(bridgeID)
		}
	}
	contexts := make([]ChatContext, 0, len(assetIDs)+len(inputContexts))
	for _, id := range assetIDs {
		contexts = append(contexts, ChatContext{Type: "media", Source: "user", Payload: map[string]any{"assetId": id}})
	}
	for _, input := range inputContexts {
		contexts = append(contexts, ChatContext{Type: strings.TrimSpace(input.Type), Source: defaultContextSource(input.Source), Payload: rawPayloadMap(input.Payload)})
	}
	attachments, err := m.turnAttachments(contexts)
	if err != nil {
		return ChatTurn{}, err
	}
	if text == "" && len(attachments) == 0 && len(contexts) == 0 {
		return ChatTurn{}, errors.New("message, image or context is required")
	}
	if _, err := m.contextMaterials(contexts); err != nil {
		return ChatTurn{}, err
	}
	task, err := m.store.ActiveTask(sessionID)
	if err != nil {
		return ChatTurn{}, err
	}
	taskID := ""
	if task == nil {
		created, createErr := m.store.CreateTask(sessionID)
		if createErr != nil {
			return ChatTurn{}, createErr
		}
		taskID = created.ID
	} else {
		taskID = task.ID
	}
	turnID, err := newID()
	if err != nil {
		return ChatTurn{}, err
	}
	now := time.Now().UTC()
	turn := ChatTurn{ID: turnID, SessionID: sessionID, Role: "user", Content: text, Status: "queued", CreatedAt: now, Attachments: attachments, Contexts: contexts}
	tx, err := db.Begin()
	if err == nil {
		defer tx.Rollback()
		_, err = tx.Exec("insert into agent_turns (id, session_id, role, content, status, task_id, created_at) values (?, ?, ?, ?, ?, ?, ?)", turn.ID, turn.SessionID, turn.Role, turn.Content, turn.Status, taskID, iso(now))
	}
	if err == nil {
		for index, context := range contexts {
			payload, _ := json.Marshal(context.Payload)
			if _, err = tx.Exec("insert into agent_turn_contexts (turn_id, seq, type, source, payload_json) values (?, ?, ?, ?, ?)", turn.ID, index, context.Type, context.Source, string(payload)); err != nil {
				break
			}
		}
	}
	if err == nil {
		title := session.Title
		if title == "新对话" {
			title = shortTitle(text)
			if title == "" {
				title = turnTitleFallback(attachments, contexts)
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
	log.Printf("INFO agent turn queued session_id=%s turn_id=%s task_id=%s contexts=%d", sessionID, turn.ID, taskID, len(contexts))
	m.startRunner(sessionID)
	return turn, nil
}

// defaultContextSource normalizes the optional source field. Host is reserved
// for platform-issued work surfaces; anything else falls back to a user pick.
func defaultContextSource(source string) string {
	switch source {
	case "page", "app", "host":
		return source
	default:
		return "user"
	}
}

// rawPayloadMap decodes a context payload into a map; an absent or invalid
// payload becomes an empty object so the row still round-trips.
func rawPayloadMap(raw json.RawMessage) map[string]any {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	return payload
}

// turnTitleFallback keeps empty-text context-only turns from collapsing into
// the media-specific default.
func turnTitleFallback(attachments []ChatAttachment, contexts []ChatContext) string {
	hasMedia := len(attachments) > 0
	hasOther := false
	for _, context := range contexts {
		if context.Type == "media" {
			hasMedia = true
		} else {
			hasOther = true
		}
	}
	switch {
	case hasOther:
		return "上下文对话"
	case hasMedia:
		return "图片对话"
	default:
		return "新对话"
	}
}

// turnAttachments resolves media contexts into their enriched display shape
// and rejects unavailable assets, matching the legacy assetIds contract.
func (m *AgentManager) turnAttachments(contexts []ChatContext) ([]ChatAttachment, error) {
	attachments := make([]ChatAttachment, 0, len(contexts))
	seen := map[string]bool{}
	for _, context := range contexts {
		if context.Type != "media" {
			continue
		}
		id, _ := context.Payload["assetId"].(string)
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		asset, err := m.media.GetAsset(id)
		if err != nil {
			return nil, errors.New("media attachment is unavailable")
		}
		attachments = append(attachments, ChatAttachment{AssetID: asset.ID, Name: asset.Name, Kind: asset.Kind, MimeType: asset.MimeType, Origin: asset.Origin})
	}
	return attachments, nil
}

func (m *AgentManager) Stop(sessionID string) error {
	m.mu.Lock()
	cancel, exists := m.running[sessionID]
	m.mu.Unlock()
	if !exists {
		return errors.New("this session is not running")
	}
	turns, err := m.cancelSessionTurns(sessionID)
	if err != nil {
		return err
	}
	m.emit(sessionID, "", "turn.stopping", map[string]any{"label": "正在停止"})
	for _, turn := range turns {
		if turn.TaskID != "" {
			_ = m.store.CompleteTask(turn.TaskID)
		}
		m.emit(sessionID, turn.ID, "turn.cancelled", map[string]any{"label": "已停止"})
	}
	log.Printf("INFO agent turns stop requested session_id=%s cancelled_turns=%d", sessionID, len(turns))
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
	return session, nil
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
	return session, nil
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
					_ = m.store.CompleteTask(turn.TaskID)
					m.emit(sessionID, turn.ID, "turn.cancelled", map[string]any{"label": "已停止"})
				}
				m.finishAndRestart(sessionID)
				m.emit(sessionID, "", "session.updated", map[string]any{"label": "会话状态已更新"})
				log.Printf("WARN agent turn cancelled session_id=%s turn_id=%s", sessionID, turn.ID)
				return
			}
			if errors.Is(err, errOpencodeResponseTimeout) {
				m.clearNativeSession(session)
			}
			m.completeTurn(turn.ID, "failed")
			_ = m.store.CompleteTask(turn.TaskID)
			m.emit(sessionID, turn.ID, "turn.failed", map[string]any{"message": err.Error()})
			log.Printf("ERROR agent turn failed session_id=%s turn_id=%s runtime=%s", sessionID, turn.ID, session.Runtime)
			continue
		}
		m.completeTurn(turn.ID, "completed")
		_ = m.store.CompleteTask(turn.TaskID)
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
	row := db.QueryRow("select id, session_id, coalesce(task_id, ''), role, content, status, created_at, completed_at from agent_turns where session_id = ? and role = ? and status = ? order by created_at, id limit 1", sessionID, "user", "queued")
	turn, err := scanChatTurn(row)
	if err != nil {
		return ChatSession{}, ChatTurn{}, false
	}
	// The runner needs the turn's typed contexts: scanChatTurn only reads the
	// agent_turns row, so hydrate them before handing the turn to the CLI.
	// Without this the prompt would silently drop every attached asset and
	// page context.
	contexts, err := listChatContexts(db, turn.ID)
	if err != nil {
		return ChatSession{}, ChatTurn{}, false
	}
	turn.Contexts = contexts
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

type cancelledAgentTurn struct {
	ID     string
	TaskID string
}

// cancelSessionTurns makes Stop a terminal operation for the current batch.
// A later user message creates a new batch and, for OpenCode, a fresh native session.
func (m *AgentManager) cancelSessionTurns(sessionID string) ([]cancelledAgentTurn, error) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.Query("select id, coalesce(task_id, '') from agent_turns where session_id = ? and role = ? and status in (?, ?) order by created_at, id", sessionID, "user", "running", "queued")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	turns := []cancelledAgentTurn{}
	for rows.Next() {
		turn := cancelledAgentTurn{}
		if err := rows.Scan(&turn.ID, &turn.TaskID); err != nil {
			return nil, err
		}
		turns = append(turns, turn)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	now := iso(time.Now().UTC())
	if _, err := tx.Exec("update agent_turns set status = ?, completed_at = ? where session_id = ? and role = ? and status in (?, ?)", "cancelled", now, sessionID, "user", "running", "queued"); err != nil {
		return nil, err
	}
	if _, err := tx.Exec("update agent_sessions set status = ?, native_session_id = case when runtime = ? then '' else native_session_id end, native_workspace = case when runtime = ? then '' else native_workspace end, updated_at = ? where id = ?", "idle", "opencode", "opencode", now, sessionID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return turns, nil
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
	bridgeSession, token, err := m.bridge.CreateSession(SessionContext{TaskID: userTurn.TaskID, Runtime: "codex", Model: model, ReasoningEffort: effort})
	if err != nil {
		return err
	}
	m.recordBridgeSession(session.ID, bridgeSession.ID)
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	// Codex threads are global, but the CLI still runs from the workspace where
	// the native session was created so AGENTS.md, the MCP config and the
	// session's working directory stay stable across turns. The workspace must
	// also pass Codex's repo/trust check, which a bare Recut session directory
	// does not, so --skip-git-repo-check keeps the headless run from aborting.
	// danger-full-access mirrors OpenCode's phase-1 `--auto` + allow-all
	// external-directory policy: the headless Agent must read and write App
	// packages, models and media under ~/.recut, which the default read-only
	// and workspace-write sandboxes both block.
	workspace, err := m.codexWorkspace(session, bridgeSession, token, executable)
	if err != nil {
		return err
	}
	defer func() { m.persistNativeWorkspace(session.ID, workspace) }()
	args := codexRunArgs(session.NativeSessionID, model, effort)
	materials, err := m.contextMaterials(userTurn.Contexts)
	if err != nil {
		return err
	}
	for _, material := range materials {
		args = append(args, material.Args...)
	}
	args = append(args, "--json", "--", userTurn.runtimePrompt()+contextPrompt(materials))
	// Codex can report a retryable transport problem as a top-level `error`
	// event, then emit a completed error item once recovery has been exhausted.
	// Its process may otherwise remain alive after that terminal item, so give
	// this invocation its own cancellation boundary and close it explicitly.
	runtimeCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd, stdout, stderr, err := m.startCLI(runtimeCtx, "codex", args, workspace, nil)
	if err != nil {
		return err
	}
	m.beginCLIStream(session.ID)
	defer m.finishCLIStream(session.ID)
	var stderrText strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			m.captureCLIOutput(session.ID, "stderr", scanner.Text())
			if stderrText.Len() < 4096 {
				stderrText.WriteString(scanner.Text() + "\n")
			}
		}
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), cliStreamScanLimit)
	var terminalErr error
	for scanner.Scan() {
		m.captureCLIOutput(session.ID, "stdout", scanner.Text())
		var raw map[string]any
		if json.Unmarshal(scanner.Bytes(), &raw) != nil {
			continue
		}
		if eventErr := m.handleCodexEvent(session.ID, userTurn.ID, raw); eventErr != nil && terminalErr == nil {
			terminalErr = eventErr
			cancel()
		}
	}
	if err := scanner.Err(); err != nil {
		return cliScanError(err)
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return errors.New("已停止")
		}
		if terminalErr != nil {
			return terminalErr
		}
		if message := strings.TrimSpace(stderrText.String()); message != "" {
			return errors.New(message)
		}
		return err
	}
	return terminalErr
}

// Claude Code exposes a documented stream-json contract. Its session id is
// immutable once created, exactly like Codex's thread id, so the generic
// ChatSession may safely persist it as native_session_id.
func (m *AgentManager) runClaude(ctx context.Context, session ChatSession, userTurn ChatTurn) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	bridgeSession, token, err := m.bridge.CreateSession(SessionContext{TaskID: userTurn.TaskID})
	if err != nil {
		return err
	}
	m.recordBridgeSession(session.ID, bridgeSession.ID)
	// Claude stores each session under the project directory it was created in,
	// so resuming from a different cwd fails; the workspace is pinned on the
	// first turn and reused for every later turn of the same native session.
	workspace, err := m.claudeWorkspace(session, bridgeSession, executable)
	if err != nil {
		return err
	}
	defer func() { m.persistNativeWorkspace(session.ID, workspace) }()
	materials, err := m.contextMaterials(userTurn.Contexts)
	if err != nil {
		return err
	}
	prompt := userTurn.runtimePrompt() + contextPrompt(materials)
	args := []string{"-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--mcp-config", filepath.Join(workspace, "claude-mcp.json")}
	if session.NativeSessionID != "" {
		args = append(args, "--resume", session.NativeSessionID)
	}
	cmd, stdout, stderr, err := m.startCLI(ctx, "claude", args, workspace, []string{"RECUT_AGENT_SESSION=" + bridgeSession.ID, "RECUT_AGENT_TOKEN=" + token})
	if err != nil {
		return err
	}
	m.beginCLIStream(session.ID)
	defer m.finishCLIStream(session.ID)
	var stderrText strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			m.captureCLIOutput(session.ID, "stderr", scanner.Text())
			if stderrText.Len() < 4096 {
				stderrText.WriteString(scanner.Text() + "\n")
			}
		}
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), cliStreamScanLimit)
	for scanner.Scan() {
		m.captureCLIOutput(session.ID, "stdout", scanner.Text())
		var raw map[string]any
		if json.Unmarshal(scanner.Bytes(), &raw) == nil {
			m.handleClaudeEvent(session.ID, userTurn.ID, raw)
		}
	}
	if err := scanner.Err(); err != nil {
		return cliScanError(err)
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
	bridgeSession, token, err := m.bridge.CreateSession(SessionContext{
		TaskID:  userTurn.TaskID,
		Runtime: "opencode",
		Model:   model,
	})
	if err != nil {
		return err
	}
	m.recordBridgeSession(session.ID, bridgeSession.ID)
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	// An OpenCode native session must always be resumed from the workspace it
	// was created in; passing a different --dir makes `opencode run --session`
	// emit no events and hang after the loop. First turns persist that workspace
	// so every later turn of the same native session reuses it.
	workspace, err := m.opencodeWorkspace(session, bridgeSession, token, executable)
	if err != nil {
		return err
	}
	// A first turn created this workspace (or reused a stored one); once the run
	// finishes and the native session id is known, pin the workspace so future
	// turns resume from the exact same directory.
	defer func() { m.persistNativeWorkspace(session.ID, workspace) }()
	materials, err := m.contextMaterials(userTurn.Contexts)
	if err != nil {
		return err
	}
	prompt := userTurn.runtimePrompt() + contextPrompt(materials)
	args := opencodeRunArgs(prompt, workspace, model, session.NativeSessionID, session.Title)
	runContext, watchdog := newOpencodeSilenceWatchdog(ctx, opencodeSilenceTimeout)
	defer watchdog.Stop()
	cmd, stdout, stderr, err := m.startCLI(runContext, "opencode", args, workspace, []string{"RECUT_AGENT_SESSION=" + bridgeSession.ID, "RECUT_AGENT_TOKEN=" + token})
	if err != nil {
		return err
	}
	m.beginCLIStream(session.ID)
	defer m.finishCLIStream(session.ID)
	var stderrText strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			watchdog.Touch()
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
	scanner.Buffer(make([]byte, 64*1024), cliStreamScanLimit)
	for scanner.Scan() {
		line := scanner.Text()
		watchdog.Touch()
		m.captureCLIOutput(session.ID, "stdout", line)
		var raw map[string]any
		if json.Unmarshal([]byte(line), &raw) == nil {
			m.handleOpencodeEvent(session.ID, userTurn.ID, raw)
		}
	}
	if err := scanner.Err(); err != nil {
		return cliScanError(err)
	}
	if err := cmd.Wait(); err != nil {
		if watchdog.TimedOut() {
			return fmt.Errorf("%w（连续 %s 未收到 CLI 输出）", errOpencodeResponseTimeout, opencodeSilenceTimeout)
		}
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

// opencodeWorkspace reuses the persisted native workspace for resumed OpenCode
// sessions and materializes a fresh bridge workspace on the first turn. Running
// `opencode run --session` from a different directory than the native session's
// original workspace emits no events and hangs, so the workspace must be stable
// across turns of the same native session.
func (m *AgentManager) opencodeWorkspace(session ChatSession, bridgeSession AgentSession, token, executable string) (string, error) {
	if session.NativeWorkspace != "" {
		return m.bridge.WriteOpencodeWorkspaceTo(session.NativeWorkspace, bridgeSession, token, executable)
	}
	return m.bridge.WriteOpencodeWorkspace(bridgeSession, token, executable)
}

// codexWorkspace reuses the persisted native workspace for resumed Codex
// sessions and materializes a fresh bridge workspace on the first turn, keeping
// the CLI cwd and Codex's working directory stable across turns of the same
// native thread.
func (m *AgentManager) codexWorkspace(session ChatSession, bridgeSession AgentSession, token, executable string) (string, error) {
	if session.NativeWorkspace != "" {
		return m.bridge.MaterializeCodexWorkspaceTo(session.NativeWorkspace, bridgeSession, token, executable)
	}
	return m.bridge.MaterializeCodexWorkspace(bridgeSession, token, executable)
}

// claudeWorkspace reuses the persisted native workspace for resumed Claude
// sessions. Claude stores each session under the project directory it was
// created in, so --resume from a different cwd errors; the original workspace
// must be reused for every later turn.
func (m *AgentManager) claudeWorkspace(session ChatSession, bridgeSession AgentSession, executable string) (string, error) {
	if session.NativeWorkspace != "" {
		if _, err := m.bridge.WriteClaudeProfileTo(session.NativeWorkspace, bridgeSession, executable); err != nil {
			return "", err
		}
		return session.NativeWorkspace, nil
	}
	if _, err := m.bridge.WriteClaudeProfile(bridgeSession, executable); err != nil {
		return "", err
	}
	return m.bridge.WorkspaceDir(bridgeSession), nil
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

// codexRunArgs builds a headless Codex invocation. Flags must precede the
// `resume` subcommand: `codex exec resume <id> --flag` stalls on the second
// turn. --skip-git-repo-check keeps Recut's non-git session workspace from
// aborting, and danger-full-access mirrors OpenCode's phase-1 allow-all policy
// so the unattended Agent can write App packages and models outside the cwd.
func codexRunArgs(nativeSessionID, model, effort string) []string {
	args := []string{"exec", "--skip-git-repo-check", "-s", "danger-full-access", "--model", model, "--config", fmt.Sprintf("model_reasoning_effort=%q", effort)}
	if nativeSessionID != "" {
		return append(args, "resume", nativeSessionID)
	}
	return args
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

func attachmentLine(attachment attachmentContext) string {
	return fmt.Sprintf("- assetId=%s；name=%s；kind=%s；origin=%s；path=%s", attachment.AssetID, attachment.Name, attachment.Kind, attachment.Origin, attachment.Path)
}

func attachmentPrompt(attachments []attachmentContext) string {
	if len(attachments) == 0 {
		return ""
	}
	lines := make([]string, 0, len(attachments)+1)
	lines = append(lines, "\n\n本条消息附带的素材已导入全局素材库。后续媒体工具必须引用 assetId；path 仅供本次 Agent 读取：")
	for _, attachment := range attachments {
		lines = append(lines, attachmentLine(attachment))
	}
	return strings.Join(lines, "\n")
}

// contextMaterial is one context type's resolved contribution to a turn. Kind
// distinguishes media (which additionally contributes codex --image args) from
// plain text contexts like the current page.
type contextMaterial struct {
	Label string   // 展示名，用于日志与调试
	Kind  string   // "media" 或其它类型标识
	Text  string   // 拼入用户消息的 prompt 行
	Args  []string // 运行时参数，如 codex --image <path>
}

// contextMaterializers is the extensible context type registry. A new context
// type (e.g. a project element reference) only needs a map entry plus its
// payload contract; the prompt/CLI pipeline is shared.
var contextMaterializers = map[string]func(m *AgentManager, payload json.RawMessage) (contextMaterial, error){
	"media":           materializeMediaContext,
	"page":            materializePageContext,
	"work_surface":    materializeWorkSurfaceContext,
	"work_focus":      materializeWorkFocusContext,
	"creation_world":  materializeCreationWorldContext,
	"creation_entity": materializeCreationEntityContext,
}

// workSurfaceContextPayload is the host-owned target binding for one turn.
// Unlike legacy page context, title and URL are display data only: the target
// ID is resolved again against Store before it reaches the native Agent.
type workSurfaceContextPayload struct {
	Version int    `json:"version"`
	Surface string `json:"surface"`
	Title   string `json:"title"`
	Path    string `json:"path,omitempty"`
	Target  struct {
		Kind       string `json:"kind"`
		ProjectID  string `json:"projectId,omitempty"`
		AppID      string `json:"appId,omitempty"`
		ScopeID    string `json:"scopeId,omitempty"`
		WorldID    string `json:"worldId,omitempty"`
		RevisionID string `json:"revisionId,omitempty"`
	} `json:"target,omitempty"`
	Policy struct {
		DefaultIntent string            `json:"defaultIntent"`
		RequiredSkill *workSurfaceSkill `json:"requiredSkill,omitempty"`
	} `json:"policy"`
}

type workSurfaceSkill struct {
	AppID   string `json:"appId"`
	SkillID string `json:"skillId"`
}

func materializeWorkSurfaceContext(m *AgentManager, payload json.RawMessage) (contextMaterial, error) {
	var surface workSurfaceContextPayload
	if err := json.Unmarshal(payload, &surface); err != nil {
		return contextMaterial{}, err
	}
	if surface.Version != 1 || strings.TrimSpace(surface.Surface) == "" || strings.TrimSpace(surface.Title) == "" {
		return contextMaterial{}, errors.New("work surface requires version, surface and title")
	}
	defaultIntent := surface.Policy.DefaultIntent
	requiredSkill := surface.Policy.RequiredSkill
	lines := []string{"<recut-work-surface version=\"1\">", "Current work surface: " + surface.Surface, "Title: " + surface.Title}
	if surface.Path != "" {
		lines = append(lines, "Route: "+surface.Path)
	}
	switch surface.Target.Kind {
	case "project":
		if surface.Target.ProjectID == "" {
			return contextMaterial{}, errors.New("project work surface requires projectId")
		}
		project, err := m.store.Get(surface.Target.ProjectID)
		if err != nil {
			return contextMaterial{}, errors.New("work surface project is unavailable")
		}
		if surface.Target.AppID != "" && surface.Target.AppID != project.AppID {
			return contextMaterial{}, errors.New("work surface project app does not match")
		}
		lines = append(lines, "Target: projectId="+project.ID+"; appId="+project.AppID)
		if m.store.catalog != nil {
			if app, ok := m.store.catalog.Get(project.AppID); ok && app.Manifest.AgentSurface != nil {
				policy := app.Manifest.AgentSurface
				defaultIntent = policy.DefaultIntent
				if policy.RequiredSkill != "" {
					requiredSkill = &workSurfaceSkill{AppID: project.AppID, SkillID: policy.RequiredSkill}
				}
				if policy.Domain == "timeline-editor" {
					lines = append(lines, "Interpret HTML, React, R3F, shader, component, and animation as timeline visual-component work. Interpret 'bottom' as the video canvas lower safe area.")
				}
			}
		}
	case "world":
		if surface.Target.WorldID == "" {
			return contextMaterial{}, errors.New("world work surface requires worldId")
		}
		world, err := NewWorldStore(m.store, m.media).GetWorld(surface.Target.WorldID)
		if err != nil {
			return contextMaterial{}, errors.New("work surface world is unavailable")
		}
		lines = append(lines, "Target: worldId="+world.ID+"; revisionId="+world.CurrentRevisionID)
	case "app_scope":
		if surface.Target.AppID == "" || surface.Target.ScopeID == "" {
			return contextMaterial{}, errors.New("app scope work surface requires appId and scopeId")
		}
		lines = append(lines, "Target: appId="+surface.Target.AppID+"; scopeId="+surface.Target.ScopeID)
	case "media_library", "app", "":
		// These surfaces are intentionally not writable targets. Their host-owned
		// policy is still useful to the Agent, but they do not grant a project.
	default:
		return contextMaterial{}, errors.New("unsupported work surface target")
	}
	if defaultIntent != "" {
		lines = append(lines, "Default intent: "+defaultIntent+".")
	}
	if skill := requiredSkill; skill != nil && skill.AppID != "" && skill.SkillID != "" {
		lines = append(lines, "Relevant App skill: appId="+skill.AppID+"; skillId="+skill.SkillID+".")
	}
	lines = append(lines, "</recut-work-surface>")
	return contextMaterial{Label: surface.Title, Kind: "work_surface", Text: strings.Join(lines, "\n")}, nil
}

// materializeWorkFocusContext deliberately preserves the complete structured
// selection snapshot. The host has already bound it to a work surface; this
// materializer only checks its envelope and makes it a separate controlled
// prompt section instead of flattening it into a lossy title string.
func materializeWorkFocusContext(_ *AgentManager, payload json.RawMessage) (contextMaterial, error) {
	var focus struct {
		Version   int    `json:"version"`
		View      string `json:"view,omitempty"`
		Selection any    `json:"selection,omitempty"`
		Cursor    any    `json:"cursor,omitempty"`
		State     any    `json:"state,omitempty"`
		Summary   string `json:"summary,omitempty"`
	}
	if err := json.Unmarshal(payload, &focus); err != nil {
		return contextMaterial{}, err
	}
	if focus.Version != 1 || (focus.Selection == nil && focus.State == nil && focus.View == "" && focus.Summary == "") {
		return contextMaterial{}, errors.New("work focus requires version and state")
	}
	pretty, err := json.MarshalIndent(focus, "", "  ")
	if err != nil {
		return contextMaterial{}, err
	}
	return contextMaterial{Label: focus.Summary, Kind: "work_focus", Text: "<recut-work-focus>\n" + string(pretty) + "\n</recut-work-focus>"}, nil
}

func (m *AgentManager) contextMaterials(contexts []ChatContext) ([]contextMaterial, error) {
	if len(contexts) == 0 {
		return nil, nil
	}
	hasSurface := false
	for _, context := range contexts {
		if context.Type == "work_surface" {
			hasSurface = true
		}
	}
	for _, context := range contexts {
		if context.Type == "work_focus" && !hasSurface {
			return nil, errors.New("work focus requires a work surface")
		}
	}
	materials := make([]contextMaterial, 0, len(contexts))
	for _, context := range contexts {
		materialize, ok := contextMaterializers[context.Type]
		if !ok {
			return nil, fmt.Errorf("unsupported context type %q", context.Type)
		}
		payload, _ := json.Marshal(context.Payload)
		material, err := materialize(m, payload)
		if err != nil {
			return nil, err
		}
		materials = append(materials, material)
	}
	return materials, nil
}

// materializeMediaContext keeps the legacy assetIds contract: the media binary
// stays in the library, the turn only carries the verified asset identity, and
// the local path is exposed to this Agent run alone.
func materializeMediaContext(m *AgentManager, payload json.RawMessage) (contextMaterial, error) {
	var input struct {
		AssetID string `json:"assetId"`
	}
	if err := json.Unmarshal(payload, &input); err != nil || input.AssetID == "" {
		return contextMaterial{}, errors.New("media context requires assetId")
	}
	asset, err := m.media.GetAsset(input.AssetID)
	if err != nil {
		return contextMaterial{}, errors.New("media attachment is unavailable")
	}
	path, _ := asset.Metadata["path"].(string)
	if path == "" {
		return contextMaterial{}, errors.New("media attachment has no local path")
	}
	context := attachmentContext{AssetID: asset.ID, Name: asset.Name, Kind: asset.Kind, Origin: asset.Origin, Path: path}
	material := contextMaterial{Label: asset.Name, Kind: "media", Text: attachmentLine(context)}
	if asset.Kind == "image" {
		material.Args = []string{"--image", path}
	}
	return material, nil
}

// pageContextPayload is the structured description of the page the user was on
// when sending. App UIs may fill selection and content for the currently edited
// element; native pages at minimum report a title and path.
type pageContextPayload struct {
	Title     string `json:"title"`
	Path      string `json:"path,omitempty"`
	URL       string `json:"url,omitempty"`
	Selection string `json:"selection,omitempty"`
	Content   string `json:"content,omitempty"`
}

func materializePageContext(_ *AgentManager, payload json.RawMessage) (contextMaterial, error) {
	var page pageContextPayload
	if err := json.Unmarshal(payload, &page); err != nil {
		return contextMaterial{}, err
	}
	if strings.TrimSpace(page.Title) == "" {
		return contextMaterial{}, errors.New("page context requires title")
	}
	parts := []string{"标题=" + page.Title}
	if page.Path != "" {
		parts = append(parts, "路径="+page.Path)
	}
	if page.URL != "" {
		parts = append(parts, "URL="+page.URL)
	}
	if page.Selection != "" {
		parts = append(parts, "选中内容="+page.Selection)
	}
	if page.Content != "" {
		parts = append(parts, "页面内容="+page.Content)
	}
	return contextMaterial{Label: page.Title, Kind: "page", Text: "[当前页面] " + strings.Join(parts, "；")}, nil
}

// materializeCreationWorldContext validates a creation_world attachment and
// renders a prompt line that tells the Agent to read live content via the
// global recut.worlds.brief single-call entry. The turn only persists
// structured IDs, never a Canon copy.
func materializeCreationWorldContext(m *AgentManager, payload json.RawMessage) (contextMaterial, error) {
	var input struct {
		WorldID    string `json:"worldId"`
		RevisionID string `json:"revisionId"`
	}
	if err := json.Unmarshal(payload, &input); err != nil || input.WorldID == "" {
		return contextMaterial{}, errors.New("creation_world context requires worldId")
	}
	worlds := NewWorldStore(m.store, m.media)
	world, err := worlds.GetWorld(input.WorldID)
	if err != nil {
		return contextMaterial{}, errors.New("creation world attachment is unavailable")
	}
	revision := input.RevisionID
	if revision == "" {
		revision = world.CurrentRevisionID
	}
	origin := originOrDefault(world.Origin)
	return contextMaterial{
		Label: world.Name,
		Kind:  "creation_world",
		Text:  fmt.Sprintf("[Creation World] worldId=%s name=%s origin=%s revisionId=%s —— 调用 recut.worlds.brief({ worldId: %q }) 一次获取身份、世界技能（world.md）、事实、规则与证据。非 local 世界只读：用户要求修改时提议 recut.worlds.fork。世界技能是该世界的生产工作流：按其执行（先策略后生成、逐张生成、按质检口径复核后再交付）。",
			world.ID, world.Name, origin, revision, world.ID),
	}, nil
}

// materializeCreationEntityContext validates a creation_entity attachment
// against its World and tells the Agent to read the live Entity content.
func materializeCreationEntityContext(m *AgentManager, payload json.RawMessage) (contextMaterial, error) {
	var input struct {
		WorldID    string `json:"worldId"`
		EntityID   string `json:"entityId"`
		RevisionID string `json:"revisionId"`
	}
	if err := json.Unmarshal(payload, &input); err != nil || input.WorldID == "" || input.EntityID == "" {
		return contextMaterial{}, errors.New("creation_entity context requires worldId and entityId")
	}
	worlds := NewWorldStore(m.store, m.media)
	entity, err := worlds.GetEntity(input.WorldID, input.EntityID)
	if err != nil {
		return contextMaterial{}, errors.New("creation entity attachment is unavailable")
	}
	return contextMaterial{
		Label: entity.Title,
		Kind:  "creation_entity",
		Text:  "[Creation Entity] worldId=" + input.WorldID + " entityId=" + entity.ID + " kind=" + string(entity.Kind) + " title=" + entity.Title + " —— 调用 recut.worlds.entities.get({ worldId: \"" + input.WorldID + "\", entityId: \"" + entity.ID + "\" }) 读取完整内容；关联的世界用 recut.worlds.resolve 解析。不要凭聊天记忆假定设定当前状态。",
	}, nil
}

// contextPrompt groups materialized contexts into one prompt appendix. The
// media section keeps the shared library instruction so path stays single-use,
// and other context types follow their own section.
func contextPrompt(materials []contextMaterial) string {
	if len(materials) == 0 {
		return ""
	}
	var media []contextMaterial
	var other []contextMaterial
	for _, material := range materials {
		if material.Kind == "media" {
			media = append(media, material)
		} else {
			other = append(other, material)
		}
	}
	lines := make([]string, 0, len(materials)+2)
	if len(media) > 0 {
		lines = append(lines, "\n\n本条消息附带的素材已导入全局素材库。后续媒体工具必须引用 assetId；path 仅供本次 Agent 读取：")
		for _, material := range media {
			lines = append(lines, material.Text)
		}
	}
	if len(other) > 0 {
		lines = append(lines, "\n\n本条消息附带的其他上下文：")
		for _, material := range other {
			lines = append(lines, material.Text)
		}
	}
	return strings.Join(lines, "\n")
}

func (t ChatTurn) runtimePrompt() string {
	if t.Content != "" {
		return t.Content
	}
	return "请结合本条消息附带的上下文进行分析。"
}

func (m *AgentManager) handleCodexEvent(sessionID, turnID string, raw map[string]any) error {
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
			m.emit(sessionID, turnID, "tool.started", m.codexToolPayload(item, itemType, "input"))
		}
	case "item.completed", "item.failed":
		if itemType == "error" {
			message := codexErrorMessage(item)
			m.emit(sessionID, turnID, "status", map[string]any{"phase": "error", "label": message})
			return errors.New(message)
		}
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
			payload := m.codexToolPayload(item, itemType, phase)
			if fields := m.subagentToolFields(sessionID); len(fields) > 0 {
				for key, value := range fields {
					payload[key] = value
				}
			}
			m.emit(sessionID, turnID, eventType, payload)
		}
	case "error":
		// A top-level error is often only Codex's reconnect progress. Keep the
		// turn alive and make the actual message visible; item.error above is
		// the terminal signal that transitions the turn into a failed state.
		m.emit(sessionID, turnID, "status", map[string]any{"phase": "retrying", "label": "正在重连：" + codexErrorMessage(raw)})
	}
	return nil
}

func codexErrorMessage(value map[string]any) string {
	for _, key := range []string{"message", "error"} {
		text, ok := value[key].(string)
		if ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return "Codex 连接失败，未返回错误详情"
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
				name = canonicalMCPToolName(name)
				id, _ := content["id"].(string)
				if id == "" {
					id = fmt.Sprintf("tool-%d", index)
				}
				m.emit(sessionID, turnID, "tool.completed", map[string]any{"toolCallId": id, "tool": name, "toolName": name, "label": m.toolLabel("mcp_tool_call", name, nil)})
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
		toolName = canonicalMCPToolName(toolName)
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
			"label":      m.toolLabel("mcp_tool_call", toolName, nil),
		}
		if detail := opencodeToolDetail(state, "input"); detail != "" {
			payload["input"] = detail
		}
		if detail := opencodeToolDetail(state, phase); detail != "" {
			payload[phase] = detail
		}
		if fields := m.subagentToolFields(sessionID); len(fields) > 0 {
			for key, value := range fields {
				payload[key] = value
			}
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
	name = canonicalMCPToolName(name)
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

func (m *AgentManager) codexToolPayload(item map[string]any, kind, phase string) map[string]any {
	payload := codexToolPayload(item, kind, phase)
	name, _ := payload["toolName"].(string)
	payload["label"] = m.toolLabel(kind, name, item)
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

var mcpToolLabels = map[string]string{
		"recut.context":                             "读取 Recut 上下文",
		"recut.apps.list":                           "读取已安装应用",
		"recut.apps.store":                          "浏览应用商店",
		"recut.apps.install":                        "安装应用",
		"recut.apps.update":                         "更新应用",
		"recut.skills.list":                         "读取技能目录",
		"recut.skills.read":                         "读取技能说明",
		"recut.skills.reference":                    "读取技能参考资料",
		"recut.project.create":                      "创建项目",
		"recut.project.list":                        "读取项目列表",
		"recut.project.get":                         "读取项目",
		"recut.project_context":                     "读取 Recut 项目上下文",
		"recut.job.status":                          "查询任务状态",
		"recut.job.wait":                            "等待任务完成",
		"recut.job.logs":                            "读取任务日志",
		"recut.job.cancel":                          "取消任务",
		"recut.image.generate":                      "提交图片生成任务",
		"recut.video.generate":                      "提交视频生成任务",
		"recut.speech.generate":                     "提交语音生成任务",
		"recut.media.list_voices":                   "读取可用音色",
		"recut.media.get_job":                       "查询媒体生成进度",
		"recut.media.wait_for_job":                  "等待媒体生成结果",
		"recut.media.list_assets":                   "读取素材库",
		"recut.media.import_image":                  "归档 Codex 原生图片",
		"recut.media.create_reference":              "登记参考资料",
		"recut.media.attach":                        "将素材关联到项目",
		"recut.worlds.list":                         "读取世界列表",
		"recut.worlds.get":                          "读取世界",
		"recut.worlds.entities.list":                "读取世界实体",
		"recut.worlds.entities.get":                 "读取世界实体详情",
		"recut.worlds.evidence.list":                "读取世界资料",
		"recut.worlds.resolve":                      "解析世界上下文",
		"recut.worlds.create":                       "创建世界",
		"recut.worlds.update":                       "更新世界",
		"recut.worlds.entities.upsert":              "保存世界实体",
		"recut.worlds.references.attach":            "关联世界参考素材",
		"recut.worlds.evidence.attach":              "收录世界资料",
		"recut.worlds.evidence.update":              "更新世界资料",
		"recut.worlds.evidence.archive":             "归档世界资料",
		"recut.worlds.bind_project":                 "关联世界到项目",
		"recut_recut_editor_project_create":         "创建剪辑项目",
		"recut_recut_editor_workflow_context":       "读取剪辑工作流",
		"recut_recut_editor_timeline_assets":        "登记时间线素材",
		"recut_recut_editor_project_get":            "读取剪辑项目",
		"recut_recut_editor_project_updateSettings": "更新剪辑设置",
		"recut_recut_editor_project_lock":           "锁定剪辑项目",
		"recut_recut_editor_project_unlock":         "解锁剪辑项目",
		"recut_recut_editor_timeline_read":          "读取时间线",
		"recut_recut_editor_element_get":            "读取时间线元素",
		"recut_recut_editor_timeline_validate":      "校验时间线",
		"recut_recut_editor_timeline_command":       "编辑时间线",
	}

func toolLabel(kind, name string, item map[string]any) string {
	if kind != "mcp_tool_call" || name == "" {
		return map[string]string{"command_execution": "运行命令", "file_change": "修改文件", "web_search": "搜索网络"}[kind] + toolLabelSuffix(name)
	}
	if label, ok := mcpToolLabels[name]; ok {
		return label
	}
	for toolName, label := range mcpToolLabels {
		if name == codexMCPToolAlias(toolName) {
			return label
		}
	}
	return name
}

func (m *AgentManager) toolLabel(kind, name string, item map[string]any) string {
	label := toolLabel(kind, name, item)
	if kind != "mcp_tool_call" || label != name || m.bridge == nil {
		return label
	}
	apps, err := m.bridge.store.catalog.List()
	if err != nil {
		return label
	}
	for _, app := range apps {
		for _, operation := range app.Manifest.Operations {
			fullName := app.Manifest.ID + "." + operation.Name
			if name != fullName && name != codexMCPToolAlias(fullName) {
				continue
			}
			return conciseToolLabel(operation.Description)
		}
	}
	return label
}

func codexMCPToolAlias(name string) string {
	var value strings.Builder
	value.WriteString("recut_")
	for _, char := range name {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' {
			value.WriteRune(char)
			continue
		}
		value.WriteByte('_')
	}
	return value.String()
}

// canonicalMCPToolName 把 codex MCP 工具别名（如 recut_recut_media_list_assets）
// 还原为规范英文工具名（如 recut.media.list_assets）；非别名或未知名字原样返回。
func canonicalMCPToolName(name string) string {
	if name == "" || strings.ContainsAny(name, " .") {
		return name
	}
	for canonical := range mcpToolLabels {
		if codexMCPToolAlias(canonical) == name {
			return canonical
		}
	}
	return name
}

func conciseToolLabel(description string) string {
	label := strings.TrimSpace(description)
	for _, separator := range []string{"：", "。", "（"} {
		if index := strings.Index(label, separator); index > 0 {
			label = label[:index]
		}
	}
	return strings.TrimSpace(label)
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

// persistNativeWorkspace records the workspace where a first run created its
// native session, so every later turn of the same session runs from the exact
// same directory. Only stored when the native session was already discovered,
// so a failed boot never pins a broken workspace.
func (m *AgentManager) persistNativeWorkspace(sessionID, workspace string) {
	if workspace == "" {
		return
	}
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	_, _ = db.Exec("update agent_sessions set native_workspace = ? where id = ? and native_session_id != '' and coalesce(native_workspace, '') = ''", workspace, sessionID)
}

func (m *AgentManager) clearNativeSession(session ChatSession) {
	m.clearNativeSessionWorkspace(session.ID)
}

// clearNativeSessionWorkspace drops the native session pointer and its pinned
// workspace together, so the next turn starts a fresh native session in a fresh
// workspace instead of resuming a poisoned one.
func (m *AgentManager) clearNativeSessionWorkspace(id string) {
	db, err := m.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	_, _ = db.Exec("update agent_sessions set native_session_id = '', native_workspace = '', updated_at = ? where id = ?", iso(time.Now().UTC()), id)
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
	row := db.QueryRow("select id, profile_id, runtime, native_session_id, coalesce(native_workspace, ''), coalesce(codex_model, ''), coalesce(reasoning_effort, ''), coalesce(opencode_model, ''), title, status, created_at, updated_at from agent_sessions where id = ? and profile_id = ?", id, localProfileID)
	return scanChatSession(row)
}

type scanner interface{ Scan(...any) error }

func scanChatSession(row scanner) (ChatSession, error) {
	var session ChatSession
	var created, updated string
	err := row.Scan(&session.ID, &session.ProfileID, &session.Runtime, &session.NativeSessionID, &session.NativeWorkspace, &session.CodexModel, &session.ReasoningEffort, &session.OpencodeModel, &session.Title, &session.Status, &created, &updated)
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
	rows, err := db.Query("select id, session_id, coalesce(task_id, ''), role, content, status, created_at, completed_at from agent_turns where session_id = ? order by created_at, id", sessionID)
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
		contexts, err := listChatContexts(db, result[index].ID)
		if err != nil {
			return nil, err
		}
		if len(contexts) > 0 {
			result[index].Contexts = contexts
		}
	}
	return result, nil
}

func listChatContexts(db *sql.DB, turnID string) ([]ChatContext, error) {
	rows, err := db.Query(`select type, source, payload_json from agent_turn_contexts where turn_id = ? order by seq`, turnID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	contexts := []ChatContext{}
	for rows.Next() {
		var context ChatContext
		var payload string
		if err := rows.Scan(&context.Type, &context.Source, &payload); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(payload), &context.Payload); err != nil {
			continue
		}
		contexts = append(contexts, context)
	}
	return contexts, rows.Err()
}

// enrichTurnContexts fills display metadata for media context payloads and
// keeps the legacy attachments field populated for turns that only store
// contexts, so history rendering never depends on which table wrote a turn.
func (m *AgentManager) enrichTurnContexts(turns []ChatTurn) {
	for index := range turns {
		turn := &turns[index]
		for contextIndex := range turn.Contexts {
			context := &turn.Contexts[contextIndex]
			if context.Type != "media" {
				continue
			}
			assetID, _ := context.Payload["assetId"].(string)
			if assetID == "" || m.media == nil {
				continue
			}
			asset, err := m.media.GetAsset(assetID)
			if err != nil {
				continue
			}
			context.Payload["assetId"] = asset.ID
			context.Payload["name"] = asset.Name
			context.Payload["kind"] = asset.Kind
			context.Payload["mimeType"] = asset.MimeType
			context.Payload["origin"] = asset.Origin
			if path, _ := asset.Metadata["path"].(string); path != "" {
				context.Payload["path"] = path
			}
		}
		if len(turn.Attachments) > 0 {
			continue
		}
		for _, context := range turn.Contexts {
			if context.Type != "media" {
				continue
			}
			assetID, _ := context.Payload["assetId"].(string)
			if assetID == "" {
				continue
			}
			name, _ := context.Payload["name"].(string)
			kind, _ := context.Payload["kind"].(string)
			mimeType, _ := context.Payload["mimeType"].(string)
			origin, _ := context.Payload["origin"].(string)
			turn.Attachments = append(turn.Attachments, ChatAttachment{AssetID: assetID, Name: name, Kind: kind, MimeType: mimeType, Origin: origin})
		}
	}
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
	if err := row.Scan(&turn.ID, &turn.SessionID, &turn.TaskID, &turn.Role, &turn.Content, &turn.Status, &created, &completed); err != nil {
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
