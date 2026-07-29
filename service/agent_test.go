/*
 * [INPUT]: 依赖 Agent 附件上下文格式化函数
 * [OUTPUT]: 验证 Agent 附件身份、工具输入/输出/错误与成本字段分离、停止时即时持久化 Turn 与会话终态，以及服务重启后的中断状态收敛
 * [POS]: service 的 Agent 协议回归测试；防止附件退化为裸路径或取消永久悬挂
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"strings"
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

func TestStopPersistsCancelledTurnBeforeRuntimeExits(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-1", localProfileID, "", "codex", "", "Test", "running", now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at) values (?, ?, ?, ?, ?, ?)", "turn-1", "session-1", "user", "stop me", "running", now); err != nil {
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
	if detail.Status != "idle" || len(detail.Turns) != 1 || detail.Turns[0].Status != "cancelled" || detail.Turns[0].CompletedAt == nil {
		t.Fatalf("stop did not persist a terminal state: %#v", detail)
	}
	var cancelled int
	for _, event := range detail.Events {
		if event.Type == "turn.cancelled" {
			cancelled++
		}
	}
	if cancelled != 1 {
		t.Fatalf("cancelled events = %d, want 1", cancelled)
	}
}

func TestRecoverInterruptedTurnsClearsStaleRunningState(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-restart", localProfileID, "", "codex", "", "Restart", "running", now, now); err != nil {
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
	if detail.Status != "idle" || detail.Turns[0].Status != "cancelled" || detail.Turns[0].CompletedAt == nil {
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

func TestCodexProjectArgsPreserveUserSkillConfiguration(t *testing.T) {
	args := codexProjectArgs("/project", "/bin/recut", "/data", "/apps", AgentSession{ID: "session"}, "token")
	for index := 0; index+1 < len(args); index++ {
		if args[index] == "--config" && strings.HasPrefix(args[index+1], "skills.config=") {
			t.Fatalf("Codex project arguments must not override user skills: %s", args[index+1])
		}
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
