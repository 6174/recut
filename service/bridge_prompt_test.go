/*
 * [INPUT]: 依赖 App Catalog、Store、嵌入式核心 Agent 模板与 App skill 树
 * [OUTPUT]: 验证会话 guide 是平台规则（不含任何 App 全文）、App 技能经 skill 树按需提供，以及 OpenCode 会话工作区 MCP 5 分钟超时配置
 * [POS]: service 的 Agent 指令与 MCP 配置回归测试；锁定跨 App 的媒体执行边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSessionGuideIsPlatformOnlyAndVoxSkillIsDiscoverable(t *testing.T) {
	apps, err := LoadCatalog(filepath.Join("..", "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(t.TempDir(), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	guide, err := NewAgentBridge(store).renderSessionGuide()
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"recut.context",
		"recut.skills.list",
		"recut.skills.read",
		"recut.video.generate_async",
		"recut.media.get_job",
		"recut.media.wait_for_job",
		"__recut.target.projectId",
		"appstate",
		`<project projectid="PROJECT_ID"/>`,
		`<app appid="APP_ID"/>`,
	} {
		if !bytes.Contains(guide, []byte(required)) {
			t.Fatalf("rendered session guide is missing %q", required)
		}
	}
	if bytes.Contains(guide, []byte("Vox 提示词与导演语言")) {
		t.Fatal("session guide must not embed any App's domain workflow")
	}
	vox, ok := apps.Get("recut.vox-broll")
	if !ok {
		t.Fatal("Vox B-roll app is unavailable")
	}
	skills, err := vox.Skills()
	if err != nil || len(skills) == 0 {
		t.Fatalf("Vox skills = %#v, err = %v", skills, err)
	}
	if skills[0].Description == "" {
		t.Fatal("Vox skill lacks a discoverable description")
	}
	if !bytes.Contains([]byte(skills[0].Body), []byte("关键画面：五段提示词结构")) {
		t.Fatal("Vox skill body must retain the domain prompt language")
	}
	appGuide, err := os.ReadFile(filepath.Join(vox.Root, "skills", "vox-broll", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(appGuide, []byte("recut.media.generate")) {
		t.Fatal("Vox guide must not reference the retired recut.media.generate tool")
	}
	workflow, err := os.ReadFile(filepath.Join(vox.Root, "background.js"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(workflow, []byte("recut.media.generate")) || !bytes.Contains(workflow, []byte("platform-media-generation")) {
		t.Fatal("Vox workflow must declare platform media generation without the retired media tool")
	}
}

func TestOpencodeWorkspaceAllowsFiveMinuteMCPCalls(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	session, token, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := bridge.WriteOpencodeWorkspace(session, token, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(workspace, "opencode.json"))
	if err != nil {
		t.Fatal(err)
	}
	config := map[string]any{}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if timeout, ok := config["experimental"].(map[string]any)["mcp_timeout"].(float64); !ok || timeout != opencodeMCPTimeoutMilliseconds {
		t.Fatalf("MCP call timeout = %#v", config["experimental"])
	}
	recut := config["mcp"].(map[string]any)["recut"].(map[string]any)
	if timeout, ok := recut["timeout"].(float64); !ok || timeout != opencodeMCPTimeoutMilliseconds {
		t.Fatalf("MCP initialization timeout = %#v", recut["timeout"])
	}
	permission := config["permission"].(map[string]any)
	external, ok := permission["external_directory"].(string)
	if !ok || external != "allow" {
		t.Fatalf("external_directory permission must be allow in phase 1, got %#v", permission["external_directory"])
	}
}

func TestOpencodeWorkspaceReusesNativeWorkspaceOnResume(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	manager := NewAgentManager(store, bridge, nil)

	firstBridge, firstToken, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	firstWorkspace, err := bridge.WriteOpencodeWorkspace(firstBridge, firstToken, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}

	resumeSession := ChatSession{ID: "session-resume", Runtime: "opencode", NativeSessionID: "ses_abc", NativeWorkspace: firstWorkspace}
	resumeBridge, resumeToken, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	reused, err := manager.opencodeWorkspace(resumeSession, resumeBridge, resumeToken, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}
	if reused != firstWorkspace {
		t.Fatalf("resume must reuse the pinned native workspace, got %q want %q", reused, firstWorkspace)
	}
	for _, name := range []string{"AGENTS.md", "opencode.json"} {
		if _, err := os.Stat(filepath.Join(reused, name)); err != nil {
			t.Fatalf("resume workspace is missing %s: %v", name, err)
		}
	}

	freshSession := ChatSession{ID: "session-fresh", Runtime: "opencode"}
	freshBridge, freshToken, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	freshWorkspace, err := manager.opencodeWorkspace(freshSession, freshBridge, freshToken, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}
	if freshWorkspace == firstWorkspace {
		t.Fatalf("first turn must get its own workspace, got %q", freshWorkspace)
	}
}

func TestCodexAndClaudeWorkspacesReuseNativeWorkspaceOnResume(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	manager := NewAgentManager(store, bridge, nil)

	firstBridge, firstToken, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	codexWorkspace, err := bridge.MaterializeCodexWorkspace(firstBridge, firstToken, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}

	resumeSession := ChatSession{ID: "session-codex-resume", Runtime: "codex", NativeSessionID: "thread_abc", NativeWorkspace: codexWorkspace}
	resumeBridge, resumeToken, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	reused, err := manager.codexWorkspace(resumeSession, resumeBridge, resumeToken, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}
	if reused != codexWorkspace {
		t.Fatalf("codex resume must reuse the pinned workspace, got %q want %q", reused, codexWorkspace)
	}
	for _, name := range []string{"AGENTS.md", filepath.Join(".codex", "config.toml")} {
		if _, err := os.Stat(filepath.Join(reused, name)); err != nil {
			t.Fatalf("codex resume workspace is missing %s: %v", name, err)
		}
	}

	claudeBridge, _, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	claudeSession := ChatSession{ID: "session-claude-resume", Runtime: "claude", NativeSessionID: "uuid", NativeWorkspace: codexWorkspace}
	claudeWorkspace, err := manager.claudeWorkspace(claudeSession, claudeBridge, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}
	if claudeWorkspace != codexWorkspace {
		t.Fatalf("claude resume must reuse the pinned workspace, got %q want %q", claudeWorkspace, codexWorkspace)
	}
	for _, name := range []string{"AGENTS.md", "claude-mcp.json"} {
		if _, err := os.Stat(filepath.Join(claudeWorkspace, name)); err != nil {
			t.Fatalf("claude resume workspace is missing %s: %v", name, err)
		}
	}

	freshBridge, freshToken, err := bridge.CreateSession(SessionContext{})
	if err != nil {
		t.Fatal(err)
	}
	freshWorkspace, err := manager.codexWorkspace(ChatSession{ID: "session-codex-fresh", Runtime: "codex"}, freshBridge, freshToken, "/tmp/recut-service")
	if err != nil {
		t.Fatal(err)
	}
	if freshWorkspace == codexWorkspace {
		t.Fatalf("codex first turn must get its own workspace, got %q", freshWorkspace)
	}
}

func TestPersistNativeWorkspacePinsOnlyAfterNativeSession(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	db, err := store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	now := iso(time.Now().UTC())
	if _, err := db.Exec("insert into agent_sessions (id, profile_id, project_id, runtime, native_session_id, native_workspace, title, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "session-ws", localProfileID, "", "opencode", "", "", "Test", "idle", now, now); err != nil {
		t.Fatal(err)
	}

	manager := NewAgentManager(store, nil, nil)
	workspace := "/tmp/pinned-workspace"

	// Without a native session the workspace must not be pinned.
	manager.persistNativeWorkspace("session-ws", workspace)
	db, err = store.WorkspaceDatabase()
	if err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := db.QueryRow("select coalesce(native_workspace, '') from agent_sessions where id = ?", "session-ws").Scan(&stored); err != nil || stored != "" {
		t.Fatalf("workspace pinned before native session existed: %q, err=%v", stored, err)
	}

	// Once the native session id is present, the workspace is pinned.
	manager.setNativeSession("session-ws", "ses_abc")
	manager.persistNativeWorkspace("session-ws", workspace)
	if err := db.QueryRow("select coalesce(native_workspace, '') from agent_sessions where id = ?", "session-ws").Scan(&stored); err != nil || stored != workspace {
		t.Fatalf("workspace not pinned after native session: %q, err=%v", stored, err)
	}

	// Clearing the native session also clears the pinned workspace.
	manager.clearNativeSession(ChatSession{ID: "session-ws", Runtime: "opencode"})
	var native, workspaceStored string
	if err := db.QueryRow("select coalesce(native_session_id, ''), coalesce(native_workspace, '') from agent_sessions where id = ?", "session-ws").Scan(&native, &workspaceStored); err != nil || native != "" || workspaceStored != "" {
		t.Fatalf("clear did not reset native session/workspace: %q/%q, err=%v", native, workspaceStored, err)
	}
}
