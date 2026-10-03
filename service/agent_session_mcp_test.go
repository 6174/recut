/*
 * [INPUT]: 依赖 handleMCP / platformMCPToolDefinitions 与 AgentManager 的会话账本（agent_sessions/agent_turns/agent_events）
 * [OUTPUT]: 锁定 recut.agent-session.list / detail 的分页、时间窗、事件游标与截断契约（历史无限增长时不崩溃）
 * [POS]: service 的历史会话 MCP 只读表面回归；不触达 HTTP 编辑器路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func seedPastAgentSession(t *testing.T, store *Store, id, title string, updated time.Time) {
	t.Helper()
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, runtime, native_session_id, title, status, created_at, updated_at) values (?, ?, ?, '', ?, 'completed', ?, ?)", id, localProfileID, "codex", title, iso(updated), iso(updated)); err != nil {
		t.Fatal(err)
	}
}

func TestAgentSessionListToolPaginatesAndFilters(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, NewAgentBridge(store), nil)
	bridge := NewAgentBridge(store)
	bridge.SetAgentManager(manager)

	base := time.Now().UTC()
	seedPastAgentSession(t, store, "s-old", "旧对话", base.Add(-48*time.Hour))
	seedPastAgentSession(t, store, "s-mid", "关于素材库", base.Add(-2*time.Hour))
	seedPastAgentSession(t, store, "s-new", "最新对话", base)

	// Default page: newest first, no filter.
	result, err := handleMCP(bridge, NewAppHost(store.catalog, store), NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.agent-session.list","arguments":{"limit":1}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	text := result.(map[string]any)["content"].([]map[string]string)[0]["text"]
	var page AgentSessionListResult
	if err := json.Unmarshal([]byte(text), &page); err != nil {
		t.Fatalf("list payload not JSON: %v\n%s", err, text)
	}
	if page.Total != 3 || page.Limit != 1 || !page.HasMore || len(page.Sessions) != 1 || page.Sessions[0].ID != "s-new" {
		t.Fatalf("first page = %#v", page)
	}

	// Offset pages forward without repeating.
	result, err = handleMCP(bridge, NewAppHost(store.catalog, store), NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.agent-session.list","arguments":{"limit":1,"offset":1}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	text = result.(map[string]any)["content"].([]map[string]string)[0]["text"]
	if err := json.Unmarshal([]byte(text), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Sessions) != 1 || page.Sessions[0].ID != "s-mid" {
		t.Fatalf("second page = %#v", page)
	}

	// Time window narrows to the last day.
	result, err = handleMCP(bridge, NewAppHost(store.catalog, store), NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.agent-session.list","arguments":{"since":"` + base.Add(-24*time.Hour).Format(time.RFC3339) + `"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	text = result.(map[string]any)["content"].([]map[string]string)[0]["text"]
	if err := json.Unmarshal([]byte(text), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 {
		t.Fatalf("time-windowed total = %d, want 2", page.Total)
	}

	// Title query matches the substring.
	result, err = handleMCP(bridge, NewAppHost(store.catalog, store), NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.agent-session.list","arguments":{"query":"素材"}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	text = result.(map[string]any)["content"].([]map[string]string)[0]["text"]
	if err := json.Unmarshal([]byte(text), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Sessions[0].ID != "s-mid" {
		t.Fatalf("query page = %#v", page)
	}

	// Malformed timestamps are a caller error, never a crash.
	if _, err := handleMCP(bridge, NewAppHost(store.catalog, store), NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.agent-session.list","arguments":{"since":"not-a-time"}}`),
	}); err == nil {
		t.Fatal("list accepted a malformed since timestamp")
	}
}

func TestAgentSessionDetailToolBoundsTurnsAndEvents(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	manager := NewAgentManager(store, NewAgentBridge(store), nil)
	bridge := NewAgentBridge(store)
	bridge.SetAgentManager(manager)
	host := NewAppHost(store.catalog, store)
	media := NewMediaService(store)

	session, err := manager.Create("codex", "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	longContent := strings.Repeat("长", defaultAgentSessionTurnChars+500)
	for index := 0; index < 3; index++ {
		content := "短回合"
		if index == 2 {
			content = longContent
		}
		if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at) values (?, ?, 'user', ?, 'completed', ?)", []any{"turn-" + string(rune('a'+index)), session.ID, content, iso(now.Add(time.Duration(index) * time.Second))}...); err != nil {
			t.Fatal(err)
		}
	}
	for index := 0; index < 500; index++ {
		if _, err := db.Exec("insert into agent_events (session_id, turn_id, type, payload_json, created_at) values (?, '', 'test', ?, ?)", session.ID, `{"index":`+string(rune('0'))+`}`, iso(now.Add(time.Duration(index)*time.Millisecond))); err != nil {
			t.Fatal(err)
		}
	}

	call := func(arguments string) AgentSessionDetailResult {
		t.Helper()
		result, err := handleMCP(bridge, host, media, AgentSession{ID: "s1"}, mcpRequest{
			Method: "tools/call",
			Params: json.RawMessage(`{"name":"recut.agent-session.detail","arguments":` + arguments + `}`),
		})
		if err != nil {
			t.Fatal(err)
		}
		text := result.(map[string]any)["content"].([]map[string]string)[0]["text"]
		var detail AgentSessionDetailResult
		if err := json.Unmarshal([]byte(text), &detail); err != nil {
			t.Fatalf("detail payload not JSON: %v\n%.200s", err, text)
		}
		return detail
	}

	// Default window: all 3 turns, but only the default event slice; truncation
	// flags and totals tell the Agent there is more.
	detail := call(`{"sessionId":"` + session.ID + `"}`)
	if detail.TotalTurns != 3 || detail.TotalEvents != 500 {
		t.Fatalf("totals = turns %d events %d", detail.TotalTurns, detail.TotalEvents)
	}
	if len(detail.Events) != defaultAgentSessionEventLimit || !detail.EventsTruncated {
		t.Fatalf("event window = %d events, truncated=%v", len(detail.Events), detail.EventsTruncated)
	}
	if detail.LastEventID == 0 {
		t.Fatal("lastEventId missing for event paging")
	}
	// The verbose turn is truncated to the rune cap plus marker.
	lastTurn := detail.Turns[len(detail.Turns)-1]
	if len([]rune(lastTurn.Content)) > defaultAgentSessionTurnChars+len("…[truncated]") {
		t.Fatalf("turn content not capped: %d runes", len([]rune(lastTurn.Content)))
	}

	// maxEvents/maxTurns cap each side independently.
	detail = call(`{"sessionId":"` + session.ID + `","maxTurns":1,"maxEvents":10}`)
	if len(detail.Turns) != 1 || detail.Turns[0].ID != "turn-c" || !detail.TurnsTruncated {
		t.Fatalf("maxTurns window = %#v (truncated=%v)", detail.Turns, detail.TurnsTruncated)
	}
	if len(detail.Events) != 10 || !detail.EventsTruncated {
		t.Fatalf("maxEvents window = %d events", len(detail.Events))
	}

	// afterEventId cursors events forward without overlap.
	firstCursor := call(`{"sessionId":"` + session.ID + `","maxEvents":5}`).LastEventID
	next := call(`{"sessionId":"` + session.ID + `","maxEvents":5,"afterEventId":` + itoa(firstCursor) + `}`)
	if len(next.Events) == 0 || next.Events[0].ID <= firstCursor {
		t.Fatalf("afterEventId cursor did not advance: first=%d next=%#v", firstCursor, next.Events)
	}

	// A capped page plus its cursor lets an Agent read all events eventually.
	if next.LastEventID <= firstCursor {
		t.Fatalf("lastEventId did not advance: %d -> %d", firstCursor, next.LastEventID)
	}

	// Missing sessionId is a clear error, not a panic.
	if _, err := handleMCP(bridge, host, media, AgentSession{ID: "s1"}, mcpRequest{
		Method: "tools/call",
		Params: json.RawMessage(`{"name":"recut.agent-session.detail","arguments":{"maxEvents":1}}`),
	}); err == nil {
		t.Fatal("detail accepted a missing sessionId")
	}
}

func itoa(value int64) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func TestAgentSessionToolsAreExposed(t *testing.T) {
	definitions := map[string]map[string]any{}
	for _, tool := range platformMCPToolDefinitions(DefaultLocale) {
		definitions[tool["name"].(string)] = tool
	}
	for _, name := range []string{"recut.agent-session.list", "recut.agent-session.detail"} {
		tool, exists := definitions[name]
		if !exists {
			t.Fatalf("platform tool %q is not exposed", name)
		}
		schema, _ := tool["inputSchema"].(map[string]any)
		properties, _ := schema["properties"].(map[string]any)
		if name == "recut.agent-session.list" {
			for _, key := range []string{"scope", "projectId", "query", "since", "until", "limit", "offset"} {
				if _, ok := properties[key]; !ok {
					t.Fatalf("%s missing range param %q", name, key)
				}
			}
		}
		if name == "recut.agent-session.detail" {
			for _, key := range []string{"sessionId", "afterEventId", "maxEvents", "maxTurns", "maxTurnChars"} {
				if _, ok := properties[key]; !ok {
					t.Fatalf("%s missing range param %q", name, key)
				}
			}
		}
	}
}
