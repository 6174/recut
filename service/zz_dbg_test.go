package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestDbgDetailRaw(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil { t.Fatal(err) }
	manager := NewAgentManager(store, NewAgentBridge(store), nil)
	bridge := NewAgentBridge(store)
	bridge.SetAgentManager(manager)
	session, err := manager.Create("codex", "", "", "", "")
	if err != nil { t.Fatal(err) }
	db, _ := store.WorkspaceDatabase()
	now := time.Now().UTC()
	if _, err := db.Exec("insert into agent_turns (id, session_id, role, content, status, created_at) values (?, ?, 'user', ?, 'completed', ?)", "ta", session.ID, "hi", iso(now)); err != nil { t.Fatal(err) }
	var n int
	db.QueryRow("select count(*) from agent_turns where session_id = ?", session.ID).Scan(&n)
	t.Logf("pre turns=%d sid=%q", n, session.ID)
	res, err := handleMCP(bridge, NewAppHost(store.catalog, store), NewMediaService(store), AgentSession{ID: "s1"}, mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"recut.agent-session.detail","arguments":{"sessionId":"` + session.ID + `"}}`)})
	if err != nil { t.Fatal(err) }
	t.Logf("raw=%s", res.(map[string]any)["content"].([]map[string]string)[0]["text"])
}
