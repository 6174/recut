package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCommandcodeRuntimeCreatesSession(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, nil, nil)
	manager.commandcodeModels = func(context.Context) ([]CommandcodeModel, error) {
		return []CommandcodeModel{{ID: defaultCommandcodeModel, Provider: "deepseek"}, {ID: "deepseek/deepseek-v4-pro", Provider: "deepseek"}}, nil
	}
	session, err := manager.Create(commandcodeRuntime, "", "", "", "")
	if err != nil {
		t.Fatalf("create commandcode session: %v", err)
	}
	if session.Runtime != commandcodeRuntime || session.CommandcodeModel != defaultCommandcodeModel {
		t.Fatalf("session = %#v", session)
	}
	// Codex/OpenCode configuration is scoped to its own runtime and must be
	// rejected for a Command Code session.
	if _, err := manager.Create(commandcodeRuntime, "gpt-5.6-terra", "", "", ""); err == nil {
		t.Fatal("Codex configuration was accepted for a Command Code session")
	}
}

func TestCommandcodeModelConfiguration(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, nil, nil)
	manager.commandcodeModels = func(context.Context) ([]CommandcodeModel, error) {
		return []CommandcodeModel{{ID: defaultCommandcodeModel}, {ID: "deepseek/deepseek-v4-pro"}}, nil
	}
	session, err := manager.Create(commandcodeRuntime, "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := manager.UpdateCommandcodeConfiguration(session.ID, "deepseek/deepseek-v4-pro")
	if err != nil {
		t.Fatalf("update model: %v", err)
	}
	if updated.CommandcodeModel != "deepseek/deepseek-v4-pro" {
		t.Fatalf("updated model = %q", updated.CommandcodeModel)
	}
	if _, err := manager.UpdateCommandcodeConfiguration(session.ID, "nope/unknown"); err == nil {
		t.Fatal("unknown model was accepted")
	}
	// A model configured for another runtime must be rejected.
	if _, err := manager.Create("codex", "", "", "", "deepseek/deepseek-v4-pro"); err == nil {
		t.Fatal("Command Code configuration was accepted for a Codex session")
	}
}

func TestCommandcodeResumeMissingDetection(t *testing.T) {
	if !isCommandcodeResumeMissing(errors.New(`No session "6f38b1fb-114e-475b-8436-9d333abd6f7c" found to resume.`)) {
		t.Fatal("resume-missing error was not detected")
	}
	if isCommandcodeResumeMissing(errors.New("已停止")) {
		t.Fatal("unrelated error was treated as resume-missing")
	}
	if isCommandcodeResumeMissing(nil) {
		t.Fatal("nil error was treated as resume-missing")
	}
}

func TestCommandcodeHistoryPromptReplaysPriorTurns(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, nil, nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	writeTurn := func(id, role, content, status string) {
		if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at, completed_at) values (?, ?, ?, ?, ?, ?, ?)", id, "cc-hist", role, content, status, now, now); err != nil {
			t.Fatal(err)
		}
	}
	writeTurn("t1", "user", "把画布换成新的角色卡", "cancelled")
	writeTurn("t2", "assistant", "我先看看当前上下文", "completed")
	writeTurn("t3", "user", "继续", "queued")
	history := manager.commandcodeHistoryPrompt("cc-hist", "t3")
	if !strings.Contains(history, "把画布换成新的角色卡") || !strings.Contains(history, "我先看看当前上下文") {
		t.Fatalf("history omitted prior turns: %q", history)
	}
	if strings.Contains(history, "继续") {
		t.Fatalf("history included the current turn: %q", history)
	}
	if empty := manager.commandcodeHistoryPrompt("cc-none", ""); empty != "" {
		t.Fatalf("history for a fresh session = %q", empty)
	}
}

func TestParseCommandcodeModels(t *testing.T) {
	models := parseCommandcodeModels("Available models  ·  3 models\n\nOpen Source\n\ndeepseek/deepseek-v4-flash  fast hybrid-attention reasoning (default)\nzai-org/glm-5  multi-mode thinking\nnot-a-model\n")
	if len(models) != 2 || models[0].ID != "deepseek/deepseek-v4-flash" || models[0].Provider != "deepseek" || models[1].Provider != "zai-org" {
		t.Fatalf("parsed models = %#v", models)
	}
}

func TestCommandcodeEventMapping(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, nil, nil)
	manager.commandcodeModels = func(context.Context) ([]CommandcodeModel, error) {
		return []CommandcodeModel{{ID: defaultCommandcodeModel}}, nil
	}
	session, err := manager.Create(commandcodeRuntime, "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	var text strings.Builder
	for _, frame := range []map[string]any{
		{"type": "event", "event": map[string]any{"type": "run_start", "sessionId": "cc-native-1"}},
		{"type": "event", "event": map[string]any{"type": "turn_start", "turnNumber": 1}},
		{"type": "event", "event": map[string]any{"type": "text_delta", "delta": "he"}},
		{"type": "event", "event": map[string]any{"type": "text_delta", "delta": "llo"}},
		{"type": "event", "event": map[string]any{"type": "tool_queued", "toolCallId": "c1", "toolName": "read_file", "input": map[string]any{"file_path": "/x"}}},
		{"type": "event", "event": map[string]any{"type": "tool_completed", "toolCallId": "c1", "toolName": "read_file", "result": []any{map[string]any{"type": "text", "text": "body"}}}},
		{"type": "event", "event": map[string]any{"type": "turn_end", "turnNumber": 1, "hadToolCalls": true}},
	} {
		manager.handleCommandcodeEvent(session.ID, "turn-1", frame, &text)
	}
	// A residual buffer must also flush on run_end (a run with no turn_end).
	manager.handleCommandcodeEvent(session.ID, "turn-1", map[string]any{"type": "event", "event": map[string]any{"type": "text_delta", "delta": "tail"}}, &text)
	manager.handleCommandcodeEvent(session.ID, "turn-1", map[string]any{"type": "event", "event": map[string]any{"type": "run_end", "result": map[string]any{"finalText": "tail"}}}, &text)

	events, err := manager.Events(session.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, len(events))
	byType := map[string]map[string]any{}
	for _, event := range events {
		got = append(got, event.Type)
		if payload, ok := event.Payload.(map[string]any); ok {
			byType[event.Type] = payload
		}
	}
	want := []string{"session.updated", "status", "tool.started", "tool.completed", "assistant.completed", "assistant.completed"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("event types = %v, want %v", got, want)
	}
	if byType["tool.completed"]["output"] != "body" {
		t.Fatalf("tool.completed output = %#v", byType["tool.completed"])
	}
	if !strings.Contains(byType["tool.started"]["input"].(string), "/x") {
		t.Fatalf("tool.started input = %#v", byType["tool.started"])
	}
	if byType["assistant.completed"]["text"] != "tail" {
		t.Fatalf("final assistant text = %#v", byType["assistant.completed"])
	}

	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	stored, err := getChatSession(db, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.NativeSessionID != "cc-native-1" {
		t.Fatalf("native session = %q", stored.NativeSessionID)
	}
}

func TestCommandcodeWorkspaceWritesProjectScopeMCP(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session := AgentSession{ID: "cc-session", Runtime: commandcodeRuntime}
	dir, err := bridge.WriteCommandcodeWorkspace(session, "secret-token", "/usr/local/bin/recut-service")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "AGENTS.md")); err != nil {
		t.Fatalf("AGENTS.md missing: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dir, ".mcp.json"))
	if err != nil {
		t.Fatalf(".mcp.json missing: %v", err)
	}
	config := map[string]any{}
	if err := json.Unmarshal(body, &config); err != nil {
		t.Fatal(err)
	}
	recut := config["mcpServers"].(map[string]any)["recut"].(map[string]any)
	if recut["command"] != "/usr/local/bin/recut-service" {
		t.Fatalf("command = %#v", recut["command"])
	}
	env := recut["env"].(map[string]any)
	if env["RECUT_AGENT_SESSION"] != "cc-session" || env["RECUT_AGENT_TOKEN"] != "secret-token" {
		t.Fatalf("env = %#v", env)
	}
}

func TestCommandcodeGlobalMCPConfigRegistersHTTPServer(t *testing.T) {
	manager := testRecutSkillManager(t)
	path, _, err := manager.mcpConfig("commandcode")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(path, filepath.Join(".commandcode", "mcp.json")) {
		t.Fatalf("commandcode mcp config path = %q", path)
	}
	if _, err := manager.Link([]string{"commandcode"}); err != nil {
		t.Fatal(err)
	}
	config, err := readRecutJSONConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	recut := config["mcpServers"].(map[string]any)[recutSkillID].(map[string]any)
	if recut["type"] != "http" || recut["url"] != globalMCPEndpoint {
		t.Fatalf("commandcode global MCP = %#v", recut)
	}
}
