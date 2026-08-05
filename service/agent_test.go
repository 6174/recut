/*
 * [INPUT]: 依赖 Agent 附件与泛化上下文格式化函数
 * [OUTPUT]: 验证 Agent 附件身份、页面上下文 materializer、上下文提示词分组、标题兜底、Codex 与 OpenCode 工具输入/输出/错误和成本字段分离、OpenCode 静默 watchdog、仅内存 CLI 调试流的回放与订阅、CLI 定位缓存的持久化/失效刷新/启动重试、共享 SQLite 的 WAL/并发写入策略、单连接池会话详情读取、停止时原子取消 active/queued Turn 并重置 OpenCode 会话，以及服务重启后的中断状态收敛
 * [POS]: service 的 Agent 协议回归测试；防止附件退化为裸路径或取消永久悬挂
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAttachmentPromptPreservesAssetIdentity(t *testing.T) {
	prompt := attachmentPrompt([]attachmentContext{{AssetID: "asset-1", Name: "reference.png", Kind: "image", Origin: "user-upload", Path: "/media/asset-1.png"}})
	for _, expected := range []string{"assetId=asset-1", "kind=image", "origin=user-upload", "path=/media/asset-1.png", "必须引用 assetId"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("attachment prompt missing %q: %s", expected, prompt)
		}
	}
}

func TestMaterializePageContextRendersStructuredPage(t *testing.T) {
	manager := NewAgentManager(NewStore(t.TempDir(), nil), nil, nil)
	payload := json.RawMessage(`{"title":"分镜编辑","path":"/workspace-app/vox-broll","selection":"scene-3 的镜头","content":"镜头 B-roll 素材"}`)
	material, err := materializePageContext(manager, payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"[当前页面]", "标题=分镜编辑", "路径=/workspace-app/vox-broll", "选中内容=scene-3 的镜头", "页面内容=镜头 B-roll 素材"} {
		if !strings.Contains(material.Text, expected) {
			t.Fatalf("page material missing %q: %s", expected, material.Text)
		}
	}
	if material.Label != "分镜编辑" || material.Kind != "page" || len(material.Args) != 0 {
		t.Fatalf("page material = %#v", material)
	}
	if _, err := materializePageContext(manager, json.RawMessage(`{"path":"/media"}`)); err == nil {
		t.Fatal("page context without title was accepted")
	}
	if _, err := materializePageContext(manager, json.RawMessage(`{bad`)); err == nil {
		t.Fatal("malformed page context was accepted")
	}
}

func TestContextPromptGroupsMediaAndPage(t *testing.T) {
	media := contextMaterial{Kind: "media", Label: "shot.png", Text: "- assetId=a1；name=shot.png"}
	page := contextMaterial{Kind: "page", Label: "素材库", Text: "[当前页面] 标题=素材库"}
	prompt := contextPrompt([]contextMaterial{media, page})
	for _, expected := range []string{"本条消息附带的素材已导入全局素材库", "assetId=a1", "本条消息附带的其他上下文", "[当前页面] 标题=素材库"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("context prompt missing %q: %s", expected, prompt)
		}
	}
	if contextPrompt(nil) != "" || contextPrompt([]contextMaterial{}) != "" {
		t.Fatal("empty context prompt must be blank")
	}
}

func TestTurnTitleFallbackDistinguishesMediaFromPageContexts(t *testing.T) {
	if title := turnTitleFallback(nil, []ChatContext{{Type: "media", Payload: map[string]any{"assetId": "a1"}}}); title != "图片对话" {
		t.Fatalf("media-only title = %q, want 图片对话", title)
	}
	if title := turnTitleFallback(nil, []ChatContext{{Type: "page", Payload: map[string]any{"title": "素材库"}}}); title != "上下文对话" {
		t.Fatalf("page title = %q, want 上下文对话", title)
	}
	if title := turnTitleFallback(nil, nil); title != "新对话" {
		t.Fatalf("empty title = %q, want 新对话", title)
	}
}

func TestDefaultContextSourceNormalizesSource(t *testing.T) {
	for source, want := range map[string]string{"": "user", "user": "user", "page": "page", "app": "app", "other": "user"} {
		if got := defaultContextSource(source); got != want {
			t.Fatalf("defaultContextSource(%q) = %q, want %q", source, got, want)
		}
	}
}

// The runner reads the queued turn from the DB and must hydrate typed contexts
// (and legacy attachments) or the CLI prompt would silently drop every attached
// asset and page context. StartTurn would race its own async runner, so this
// test inserts the turn row directly.
func TestNextQueuedTurnHydratesContexts(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, nil, nil)
	session, err := manager.Create("codex", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, task_id, created_at) values (?, ?, 'user', ?, 'queued', '', ?)", "turn-ctx", session.ID, "分析素材库", iso(now)); err != nil {
		t.Fatal(err)
	}
	for index, context := range []struct{ type_, payload string }{
		{"page", `{"title":"素材库","path":"/media"}`},
		{"media", `{"assetId":"asset-1"}`},
	} {
		if _, err := db.Exec("insert into agent_turn_contexts (turn_id, seq, type, source, payload_json) values (?, ?, ?, ?, ?)", "turn-ctx", index, context.type_, "page", context.payload); err != nil {
			t.Fatal(err)
		}
	}

	_, turn, ok := manager.nextQueuedTurn(session.ID)
	if !ok {
		t.Fatal("nextQueuedTurn found no queued turn")
	}
	if len(turn.Contexts) != 2 || turn.Contexts[0].Type != "page" || turn.Contexts[1].Type != "media" {
		t.Fatalf("hydrated contexts = %#v", turn.Contexts)
	}
	if payload := turn.Contexts[1].Payload["assetId"]; payload != "asset-1" {
		t.Fatalf("media context payload = %#v", turn.Contexts[1].Payload)
	}
}

func TestCLIStreamReplaysAndPublishesWithoutPersistingOutput(t *testing.T) {
	manager := NewAgentManager(NewStore(t.TempDir(), nil), nil, nil)
	manager.beginCLIStream("session")
	manager.captureCLIOutput("session", "stdout", `{"type":"step_start"}`)
	history, output, unsubscribe := manager.SubscribeCLIStream("session")
	defer unsubscribe()
	if len(history) != 1 || history[0].Stream != "stdout" || history[0].Text != `{"type":"step_start"}` {
		t.Fatalf("CLI history = %#v", history)
	}
	manager.captureCLIOutput("session", "stderr", "network retry")
	select {
	case entry := <-output:
		if entry.Sequence != 2 || entry.Stream != "stderr" || entry.Text != "network retry" {
			t.Fatalf("CLI live entry = %#v", entry)
		}
	case <-time.After(time.Second):
		t.Fatal("CLI subscriber did not receive output")
	}
	manager.finishCLIStream("session")
	if history, output, unsubscribe := manager.SubscribeCLIStream("missing"); history != nil || output != nil {
		unsubscribe()
		t.Fatalf("missing CLI stream = %#v, %v", history, output)
	}
}

func TestOpencodeSilenceWatchdogAllowsLongRunningActiveTurn(t *testing.T) {
	ctx, watchdog := newOpencodeSilenceWatchdog(context.Background(), 100*time.Millisecond)
	defer watchdog.Stop()
	for range 4 {
		watchdog.Touch()
		time.Sleep(25 * time.Millisecond)
		if ctx.Err() != nil {
			t.Fatal("active OpenCode turn was cancelled by the silence watchdog")
		}
	}
}

func TestOpencodeSilenceWatchdogCancelsSilentTurn(t *testing.T) {
	ctx, watchdog := newOpencodeSilenceWatchdog(context.Background(), 20*time.Millisecond)
	defer watchdog.Stop()
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("silent OpenCode turn was not cancelled")
	}
	if !watchdog.TimedOut() {
		t.Fatal("silent OpenCode turn was cancelled without recording a watchdog timeout")
	}
}

func TestStopCancelsCurrentBatchAndResetsOpenCodeSession(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-1", localProfileID, "", "opencode", "ses_stuck", "Test", "running", now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at) values (?, ?, ?, ?, ?, ?)", "turn-1", "session-1", "user", "stop me", "running", now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at) values (?, ?, ?, ?, ?, ?)", "turn-2", "session-1", "user", "queued after stop", "queued", now); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	manager := NewAgentManager(store, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	manager.running["session-1"] = cancel
	if err := manager.Stop("session-1"); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() == nil {
		t.Fatal("runtime cancellation was not requested")
	}

	detail, err := manager.Detail("session-1")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Status != "idle" || detail.NativeSessionID != "" || len(detail.Turns) != 2 || detail.Turns[0].Status != "cancelled" || detail.Turns[0].CompletedAt == nil || detail.Turns[1].Status != "cancelled" || detail.Turns[1].CompletedAt == nil {
		t.Fatalf("stop did not persist a terminal state: %#v", detail)
	}
	if manager.hasQueuedTurn("session-1") {
		t.Fatal("stop left a queued turn that could restart the cancelled runner")
	}
	var cancelled int
	for _, event := range detail.Events {
		if event.Type == "turn.cancelled" {
			cancelled++
		}
	}
	if cancelled != 2 {
		t.Fatalf("cancelled events = %d, want 2", cancelled)
	}
}

func TestRecoverInterruptedTurnsClearsStaleRunningState(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-restart", localProfileID, "", "opencode", "ses_interrupted", "Restart", "running", now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at) values (?, ?, ?, ?, ?, ?)", "turn-restart", "session-restart", "user", "interrupted", "running", now); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	manager := NewAgentManager(store, nil, nil)
	recovered, err := manager.RecoverInterruptedTurns()
	if err != nil || recovered != 1 {
		t.Fatalf("recovered = %d, %v", recovered, err)
	}
	detail, err := manager.Detail("session-restart")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Status != "idle" || detail.NativeSessionID != "" || detail.Turns[0].Status != "cancelled" || detail.Turns[0].CompletedAt == nil {
		t.Fatalf("restart left stale running state: %#v", detail)
	}
	var cancelled, sessionUpdated int
	for _, event := range detail.Events {
		if event.Type == "turn.cancelled" {
			cancelled++
		}
		if event.Type == "session.updated" {
			sessionUpdated++
		}
	}
	if cancelled != 1 || sessionUpdated != 1 {
		t.Fatalf("restart events = cancelled:%d session.updated:%d", cancelled, sessionUpdated)
	}
}

func TestNormalizeCodexConfiguration(t *testing.T) {
	model, effort, err := normalizeCodexConfiguration("", "")
	if err != nil || model != "gpt-5.6-terra" || effort != "xhigh" {
		t.Fatalf("default configuration = %q/%q, %v", model, effort, err)
	}
	if _, _, err := normalizeCodexConfiguration("unknown", "high"); err == nil {
		t.Fatal("unknown Codex model was accepted")
	}
}

func TestParseOpencodeModelsKeepsEveryTUIProvider(t *testing.T) {
	models := parseOpencodeModels("opencode/deepseek-v4-flash-free\nopencode-go/deepseek-v4-flash\ngithub-copilot/gpt-5.6-sol\ninvalid")
	if len(models) != 3 || models[0].ID != "opencode/deepseek-v4-flash-free" || models[1].ID != defaultOpencodeModel || models[2].Provider != "github-copilot" {
		t.Fatalf("models = %#v", models)
	}
}

func TestOpencodeRunArgsUseUnattendedToolApproval(t *testing.T) {
	first := strings.Join(opencodeRunArgs("hello", "/project", defaultOpencodeModel, "", "New chat"), " ")
	if !strings.Contains(first, "--print-logs") || !strings.Contains(first, "--auto") || !strings.Contains(first, "--title New chat") || strings.Contains(first, "--session") {
		t.Fatalf("first OpenCode args = %q", first)
	}
	resumed := strings.Join(opencodeRunArgs("again", "/project", defaultOpencodeModel, "ses_123", "ignored"), " ")
	if !strings.Contains(resumed, "--auto") || !strings.Contains(resumed, "--session ses_123") || strings.Contains(resumed, "--title") {
		t.Fatalf("resumed OpenCode args = %q", resumed)
	}
}

func TestWorkspaceDatabaseUsesWAL(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var mode string
	if err := db.QueryRow("pragma journal_mode").Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if strings.ToLower(mode) != "wal" {
		t.Fatalf("journal mode = %q, want wal", mode)
	}
}

func TestDetailReadsTurnsWithSingleSQLiteConnection(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-single-connection", localProfileID, "", "codex", "", "Test", "idle", now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at) values (?, ?, ?, ?, ?, ?)", "turn-single-connection", "session-single-connection", "user", "hello", "completed", now); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { _, err := NewAgentManager(store, nil, nil).Detail("session-single-connection"); result <- err }()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("session detail exhausted the SQLite connection pool")
	}
}

func TestWorkspaceDatabaseQueuesConcurrentWrites(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	again, err := store.WorkspaceDatabase()
	if err != nil || again != db {
		t.Fatalf("workspace database cache = %p, %v; want %p, nil", again, err, db)
	}

	const writes = 32
	start := make(chan struct{})
	errors := make(chan error, writes)
	var group sync.WaitGroup
	for index := 0; index < writes; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			<-start
			_, err := db.Exec("insert into agent_events (session_id, turn_id, type, payload_json, created_at) values (?, ?, ?, ?, ?)", "session", "", "test", fmt.Sprintf(`{"index":%d}`, index), iso(time.Now().UTC()))
			errors <- err
		}(index)
	}
	close(start)
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}

	var count int
	if err := db.QueryRow("select count(*) from agent_events").Scan(&count); err != nil || count != writes {
		t.Fatalf("persisted concurrent writes = %d, %v; want %d, nil", count, err, writes)
	}
}

func TestCodexWorkspaceDoesNotOverrideUserSkillConfiguration(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session, token, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := bridge.MaterializeCodexWorkspace(session, token, "/bin/recut")
	if err != nil {
		t.Fatal(err)
	}
	config, err := os.ReadFile(filepath.Join(workspace, ".codex", "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(config)
	if strings.Contains(text, "skills.config") {
		t.Fatalf("session Codex config must not override user skills: %s", text)
	}
	if !strings.Contains(text, "mcp_servers.recut") {
		t.Fatalf("session Codex config must declare the Recut MCP server: %s", text)
	}
}

func TestUpdateCodexConfigurationPersistsNextTurnDefaults(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-config", localProfileID, "", "codex", "", "Test", "idle", now, now); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	manager := NewAgentManager(store, nil, nil)
	session, err := manager.UpdateCodexConfiguration("session-config", "gpt-5.6-sol", "max")
	if err != nil {
		t.Fatal(err)
	}
	if session.CodexModel != "gpt-5.6-sol" || session.ReasoningEffort != "max" {
		t.Fatalf("saved configuration = %q/%q", session.CodexModel, session.ReasoningEffort)
	}
}

func TestUpdateOpencodeConfigurationPersistsModel(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, opencode_model, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-opencode", localProfileID, "", "opencode", "", defaultOpencodeModel, "Test", "idle", now, now); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	manager := NewAgentManager(store, nil, nil)
	manager.opencodeModels = func(context.Context) ([]OpencodeModel, error) {
		return []OpencodeModel{{ID: defaultOpencodeModel}, {ID: "opencode/deepseek-v4-flash-free"}}, nil
	}
	if _, err := manager.UpdateOpencodeConfiguration("session-opencode", "github-copilot/gpt-5.6-sol"); err == nil {
		t.Fatal("model absent from the OpenCode TUI was accepted")
	}
	session, err := manager.UpdateOpencodeConfiguration("session-opencode", "opencode/deepseek-v4-flash-free")
	if err != nil {
		t.Fatal(err)
	}
	if session.OpencodeModel != "opencode/deepseek-v4-flash-free" {
		t.Fatalf("saved opencode model = %q", session.OpencodeModel)
	}
	db, err = store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := db.QueryRow("select opencode_model from agent_sessions where id = ?", "session-opencode").Scan(&stored); err != nil || stored != "opencode/deepseek-v4-flash-free" {
		t.Fatalf("persisted opencode_model = %q, err=%v", stored, err)
	}
}

func TestUpdateOpencodeConfigurationRejectsNonOpencodeSession(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-codex-only", localProfileID, "", "codex", "", "Test", "idle", now, now); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, nil, nil)
	manager.opencodeModels = func(context.Context) ([]OpencodeModel, error) { return []OpencodeModel{{ID: "openai/gpt-5"}}, nil }
	if _, err := manager.UpdateOpencodeConfiguration("session-codex-only", "openai/gpt-5"); err == nil {
		t.Fatal("opencode configuration was accepted for a Codex session")
	}
}

func TestCodexToolFailureDetection(t *testing.T) {
	for _, item := range []map[string]any{
		{"status": "failed"},
		{"status": "error"},
		{"error": "provider unavailable"},
		{"error": map[string]any{"message": "provider unavailable"}},
		{"is_error": true},
		{"result": map[string]any{"is_error": true, "content": "credential missing"}},
		{"output": `{"status":"failed","error":"credential missing"}`},
		{"output": "Error: credential missing"},
	} {
		if !codexToolFailed(item) {
			t.Fatalf("tool failure was not detected: %#v", item)
		}
	}
	if codexToolFailed(map[string]any{"status": "completed", "is_error": false}) {
		t.Fatal("successful tool call was marked failed")
	}
}

func TestCodexToolPayloadSeparatesInputOutputErrorAndCost(t *testing.T) {
	item := map[string]any{
		"id":        "tool-1",
		"tool":      "recut.image.generate",
		"arguments": map[string]any{"text": "make a cover"},
		"result":    map[string]any{"assetIds": []string{"asset-1"}},
		"cost":      map[string]any{"credits": 12},
	}
	input := codexToolPayload(item, "mcp_tool_call", "input")
	output := codexToolPayload(item, "mcp_tool_call", "output")
	if strings.Contains(output["output"].(string), "arguments") || strings.Contains(input["input"].(string), "result") {
		t.Fatalf("tool payload mixed input and output: input=%s output=%s", input["input"], output["output"])
	}
	if _, ok := output["cost"]; !ok {
		t.Fatalf("tool cost missing from payload: %#v", output)
	}

	failed := codexToolPayload(map[string]any{"id": "tool-2", "tool": "recut.image.generate", "arguments": map[string]any{"text": "make a cover"}, "error": "provider timed out"}, "mcp_tool_call", "error")
	if strings.Contains(failed["error"].(string), "arguments") || !strings.Contains(failed["error"].(string), "provider timed out") {
		t.Fatalf("tool payload did not preserve the actual error: %s", failed["error"])
	}
}

func TestOpencodeToolErrorDetailPreservesStateError(t *testing.T) {
	state := map[string]any{
		"input": map[string]any{"filePath": "/outside-project/README.md"},
		"error": map[string]any{"message": "Access denied: path is outside the workspace"},
	}
	input := opencodeToolDetail(state, "input")
	detail := opencodeToolDetail(state, "error")
	if !strings.Contains(input, "filePath") {
		t.Fatalf("OpenCode tool input missing: %s", input)
	}
	if !strings.Contains(detail, "Access denied: path is outside the workspace") {
		t.Fatalf("OpenCode tool failure detail missing: %s", detail)
	}
}

func TestAgentCLIUnavailableErrorIsActionable(t *testing.T) {
	message := agentCLIUnavailableError("Codex", "codex").Error()
	for _, expected := range []string{"Codex CLI is unavailable", "device running Recut service", `"codex"`, "restart Recut service"} {
		if !strings.Contains(message, expected) {
			t.Fatalf("CLI guidance missing %q: %s", expected, message)
		}
	}
}

func TestAgentCLIUnavailableErrorForOpencodeIsActionable(t *testing.T) {
	message := agentCLIUnavailableError("OpenCode", "opencode").Error()
	for _, expected := range []string{"OpenCode CLI is unavailable", "device running Recut service", `"opencode"`, "restart Recut service"} {
		if !strings.Contains(message, expected) {
			t.Fatalf("OpenCode CLI guidance missing %q: %s", expected, message)
		}
	}
}

func TestAgentCommandPathFromOutputUsesVerifiedShellResult(t *testing.T) {
	command := t.TempDir() + "/codex"
	if err := os.WriteFile(command, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if resolved := agentCommandPathFromOutput("codex", "shell init\n"+command+"\n"); resolved != command {
		t.Fatalf("resolved command = %q, want %q", resolved, command)
	}
}

func TestAgentCommandResolverCachesVerifiedLookup(t *testing.T) {
	root := t.TempDir()
	executable := filepath.Join(root, "codex")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	lookups := 0
	resolver := newAgentCommandResolver(root)
	resolver.resolve = func(command string) AgentCommandDiagnostic {
		lookups++
		return AgentCommandDiagnostic{Command: command, ResolvedPath: executable, Resolution: "login shell /bin/zsh", Shells: []AgentShellDiagnostic{{ResolvedPath: executable, Path: "/custom/bin:/usr/bin"}}}
	}
	process, err := resolver.Find("codex")
	if err != nil || process.Path != executable || strings.Join(process.Env, "") != "PATH=/custom/bin:/usr/bin" {
		t.Fatalf("first lookup = %#v, %v", process, err)
	}
	if lookups != 1 {
		t.Fatalf("lookup count = %d, want 1", lookups)
	}
	for _, target := range []struct {
		path string
		mode os.FileMode
	}{{filepath.Join(root, "config"), 0o700}, {filepath.Join(root, "config", "agent-commands.json"), 0o600}} {
		info, err := os.Stat(target.path)
		if err != nil || info.Mode().Perm() != target.mode {
			t.Fatalf("cache permission %q = %v, %v", target.path, info, err)
		}
	}

	loaded := newAgentCommandResolver(root)
	loaded.resolve = func(string) AgentCommandDiagnostic {
		t.Fatal("cached command triggered a new CLI lookup")
		return AgentCommandDiagnostic{}
	}
	process, err = loaded.Find("codex")
	if err != nil || process.Path != executable || strings.Join(process.Env, "") != "PATH=/custom/bin:/usr/bin" {
		t.Fatalf("cached lookup = %#v, %v", process, err)
	}
}

func TestAgentCommandResolverDoesNotBlockCachedLookup(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"codex", "claude"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	resolver := newAgentCommandResolver(root)
	resolver.loaded = true
	resolver.commands["claude"] = agentCommandCacheEntry{Path: filepath.Join(root, "claude")}
	started := make(chan struct{})
	release := make(chan struct{})
	resolver.resolve = func(string) AgentCommandDiagnostic {
		close(started)
		<-release
		return AgentCommandDiagnostic{ResolvedPath: filepath.Join(root, "codex")}
	}
	resolved := make(chan error, 1)
	go func() { _, err := resolver.Find("codex"); resolved <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("CLI lookup did not start")
	}
	sameLookup := make(chan error, 1)
	go func() { _, err := resolver.Find("codex"); sameLookup <- err }()
	select {
	case err := <-sameLookup:
		t.Fatalf("duplicate lookup completed before the shared result: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	cached := make(chan error, 1)
	go func() { _, err := resolver.Find("claude"); cached <- err }()
	select {
	case err := <-cached:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("cached CLI lookup waited for shell resolution")
	}
	close(release)
	if err := <-resolved; err != nil {
		t.Fatal(err)
	}
	if err := <-sameLookup; err != nil {
		t.Fatal(err)
	}
}

func TestAgentCommandResolverRefreshesInvalidCacheAndFailedStart(t *testing.T) {
	root := t.TempDir()
	valid := filepath.Join(root, "codex-valid")
	if err := os.WriteFile(valid, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	resolver := newAgentCommandResolver(root)
	resolver.loaded = true
	resolver.commands["codex"] = agentCommandCacheEntry{Path: filepath.Join(root, "removed-codex")}
	refreshes := 0
	resolver.resolve = func(command string) AgentCommandDiagnostic {
		refreshes++
		return AgentCommandDiagnostic{Command: command, ResolvedPath: valid}
	}
	if process, err := resolver.Find("codex"); err != nil || process.Path != valid || refreshes != 1 {
		t.Fatalf("invalid cache refresh = %#v, %v, count=%d", process, err, refreshes)
	}

	broken := filepath.Join(root, "codex-broken")
	if err := os.WriteFile(broken, []byte("not an executable format\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	resolver.Invalidate("codex")
	refreshes = 0
	resolver.resolve = func(command string) AgentCommandDiagnostic {
		refreshes++
		path := broken
		if refreshes == 2 {
			path = valid
		}
		return AgentCommandDiagnostic{Command: command, ResolvedPath: path}
	}
	cmd, stdout, stderr, err := resolver.Start(context.Background(), "codex", nil, root, nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = stdout.Close()
	_ = stderr.Close()
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if refreshes != 2 {
		t.Fatalf("failed start refresh count = %d, want 2", refreshes)
	}
}

func TestAgentShellPathFromOutputReadsOnlyDiagnosticMarker(t *testing.T) {
	output := "shell startup noise\n__RECUT_PATH__/usr/local/bin:/usr/bin\n/usr/local/bin/codex\n"
	if path := agentShellPathFromOutput(output); path != "/usr/local/bin:/usr/bin" {
		t.Fatalf("shell path = %q", path)
	}
}

func TestEnvironmentWithOverridesReplacesPath(t *testing.T) {
	environment := environmentWithOverrides([]string{"PATH=/usr/bin:/bin", "HOME=/tmp/recut"}, []string{"PATH=/nvm/bin:/usr/bin", "RECUT_AGENT_TOKEN=test"})
	actual := strings.Join(environment, "\n")
	for _, expected := range []string{"HOME=/tmp/recut", "PATH=/nvm/bin:/usr/bin", "RECUT_AGENT_TOKEN=test"} {
		if !strings.Contains(actual, expected) {
			t.Fatalf("environment missing %q: %s", expected, actual)
		}
	}
	if strings.Contains(actual, "PATH=/usr/bin:/bin") {
		t.Fatalf("stale PATH was retained: %s", actual)
	}
}
