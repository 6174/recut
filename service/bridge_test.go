/*
 * [INPUT]: 依赖 AgentBridge、Store、Catalog 和临时项目目录
 * [OUTPUT]: 验证通用状态读取、版本化提案与提交事务
 * [POS]: service 的 Agent Bridge 回归测试，保护应用状态不被终端直接绕过
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAgentBridgeCommitsOnlyCurrentDeclaredState(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(filepath.Join(appsDir, "schemas"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appsDir, "manifest.json"), `{"id":"example.app","name":"Example","version":"1.0.0"}`)
	writeTestFile(t, filepath.Join(appsDir, "project-layout.json"), `{"version":1,"files":[{"path":"data/model.json","schema":"schemas/model.json","kind":"source"}]}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Test", AppID: "example.app"})
	if err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session, token, err := bridge.CreateSession(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	authenticated, err := bridge.Authenticate(session.ID, token)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewAgentBridge(store).Authenticate(session.ID, token); err != nil {
		t.Fatalf("persisted session is not usable by MCP subprocess: %v", err)
	}
	context, err := bridge.Context(authenticated)
	if err != nil {
		t.Fatal(err)
	}
	initial, err := bridge.ReadSourceState(authenticated, "data/model.json")
	if err != nil || initial["revision"] != context.Revision {
		t.Fatalf("initial source state = %#v, error = %v", initial, err)
	}
	proposal, err := bridge.Propose(authenticated, "replace_source_state", "data/model.json", context.Revision, map[string]any{"title": "ready"})
	if err != nil {
		t.Fatal(err)
	}
	committed, err := bridge.Commit(authenticated, proposal.ID, context.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if committed["revision"] == context.Revision {
		t.Fatal("revision did not advance")
	}
	afterCommit := committed["revision"].(string)
	if _, err := bridge.Undo(authenticated, committed["transactionId"].(string), afterCommit); err != nil {
		t.Fatal(err)
	}
	state := map[string]any{}
	if err := readProjectJSON(filepath.Join(store.projectDir(project.ID), "apps", project.AppID, "data", "model.json"), &state); err != nil {
		t.Fatal(err)
	}
	if len(state) != 0 {
		data, _ := json.Marshal(state)
		t.Fatalf("undo state = %s", data)
	}
	if _, err := bridge.Propose(authenticated, "replace_source_state", "data/other.json", committed["revision"].(string), map[string]any{}); err == nil {
		t.Fatal("undeclared state path was accepted")
	}
}
