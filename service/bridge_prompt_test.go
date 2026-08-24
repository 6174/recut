/*
 * [INPUT]: 依赖 App Catalog、Store、嵌入式核心 Agent 模板与 App skill 树
 * [OUTPUT]: 验证会话 guide 是平台规则（不含任何 App 全文）、App 技能经 skill 树按需提供，guide 以 OutputFormat=xml 渲染受控 XML 引用（绝不输出第三方 recut.video 深链），以及 OpenCode 会话工作区 MCP 5 分钟超时配置
 * [POS]: service 的 Agent 指令与 MCP 配置回归测试；锁定跨 App 的媒体执行边界与内建/第三方输出格式分叉
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
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
	// renderSessionGuide follows the persisted user language; this invariant
	// test locks the English contract, so pin the en preference explicitly.
	if err := store.SaveLocalePreference(LocaleEn); err != nil {
		t.Fatal(err)
	}
	guide, err := NewAgentBridge(store).renderSessionGuide()
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"recut.context",
		"recut.skills.read",
		"15 minutes",
		"not a turn-by-turn ritual",
		"never call it as a routine preflight",
		"recut.video.generate",
		"recut.media.get_job",
		"recut.media.wait_for_job",
		"recut.context.media.readiness",
		"recut.worlds.list",
		"__recut.target.projectId",
		"appstate",
		"OutputFormat: xml",
		`<project projectid="PROJECT_ID"/>`,
		`<app appid="APP_ID"/>`,
	} {
		if !bytes.Contains(guide, []byte(required)) {
			t.Fatalf("rendered session guide is missing %q", required)
		}
	}
	if bytes.Contains(guide, []byte("recut.video/media?asset=")) {
		t.Fatal("internal session guide must not emit third-party recut.video URLs")
	}
	if bytes.Contains(guide, []byte("Vox 提示词与导演语言")) {
		t.Fatal("session guide must not embed any App's domain workflow")
	}
	vox, ok := apps.Get("recut.ai-short-film")
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
	appGuide, err := os.ReadFile(filepath.Join(vox.Root, "skills", "ai-short-film", "SKILL.md"))
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
	if bytes.Contains(workflow, []byte("recut.media.generate")) || !bytes.Contains(workflow, []byte("平台媒体生成")) {
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
	command, ok := recut["command"].([]any)
	if !ok || !reflect.DeepEqual(command, []any{"/tmp/recut-service", "--mcp", "--mcp-target", defaultMCPTarget}) {
		t.Fatalf("recut MCP command = %#v", recut["command"])
	}
	env := recut["environment"].(map[string]any)
	if env["RECUT_AGENT_SESSION"] != session.ID || env["RECUT_AGENT_TOKEN"] != token {
		t.Fatalf("recut MCP environment = %#v", env)
	}
}

func TestBridgeMCPConfigsForwardToDaemon(t *testing.T) {
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
	executable := "/tmp/recut-service"

	codexWorkspace, err := bridge.MaterializeCodexWorkspace(session, token, executable)
	if err != nil {
		t.Fatal(err)
	}
	codexConfig, err := os.ReadFile(filepath.Join(codexWorkspace, ".codex", "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"--mcp"`, `"--mcp-target"`, defaultMCPTarget, `RECUT_AGENT_SESSION = "` + session.ID + `"`, `RECUT_AGENT_TOKEN = "` + token + `"`} {
		if !bytes.Contains(codexConfig, []byte(want)) {
			t.Fatalf("codex MCP config is missing %q:\n%s", want, codexConfig)
		}
	}

	claudeProfile, err := bridge.WriteClaudeProfile(session, executable)
	if err != nil {
		t.Fatal(err)
	}
	claudeRaw, err := os.ReadFile(claudeProfile)
	if err != nil {
		t.Fatal(err)
	}
	claude := map[string]any{}
	if err := json.Unmarshal(claudeRaw, &claude); err != nil {
		t.Fatal(err)
	}
	recutServer := claude["mcpServers"].(map[string]any)["recut"].(map[string]any)
	args, ok := recutServer["args"].([]any)
	if !ok || !reflect.DeepEqual(args, []any{"--mcp", "--mcp-target", defaultMCPTarget}) {
		t.Fatalf("claude recut MCP args = %#v", recutServer["args"])
	}

	for _, file := range []string{filepath.Join(codexWorkspace, ".codex", "config.toml"), claudeProfile} {
		content, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(content, []byte("--mcp-stdio")) {
			t.Fatalf("%s must not spawn a per-session --mcp-stdio subprocess:\n%s", file, content)
		}
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

func TestAgentGuideDefaultAndEnRenderEnglish(t *testing.T) {
	// The default render (empty Locale) and the explicit en branch must keep the
	// English invariants the session guide contract asserts.
	for _, locale := range []string{"", "en"} {
		guide, err := renderAgentGuide(agentGuideData{OutputFormat: "xml", Locale: locale})
		if err != nil {
			t.Fatal(err)
		}
		for _, required := range []string{
			"recut.context",
			"15 minutes",
			"not a turn-by-turn ritual",
			"never call it as a routine preflight",
			"recut.video.generate",
			"recut.media.get_job",
			"recut.media.wait_for_job",
			"recut.context.media.readiness",
			"recut.worlds.list",
			"__recut.target.projectId",
			"appstate",
			"OutputFormat: xml",
			`<project projectid="PROJECT_ID"/>`,
			`<app appid="APP_ID"/>`,
		} {
			if !bytes.Contains(guide, []byte(required)) {
				t.Fatalf("guide locale=%q is missing %q", locale, required)
			}
		}
		if bytes.Contains(guide, []byte("上下文刷新协议")) {
			t.Fatalf("guide locale=%q must not render the zh branch", locale)
		}
	}
}

func TestAgentGuideZhRendersChineseBranch(t *testing.T) {
	guide, err := renderAgentGuide(agentGuideData{OutputFormat: "xml", Locale: "zh"})
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"上下文刷新协议",
		"媒体回复协议",
		"__recut.target.projectId",
		"appstate",
		"recut.video.generate",
		"recut.media.wait_for_job",
		"OutputFormat: xml",
		`<project projectid="PROJECT_ID"/>`,
		`<app appid="APP_ID"/>`,
	} {
		if !bytes.Contains(guide, []byte(required)) {
			t.Fatalf("zh guide is missing %q", required)
		}
	}
	if bytes.Contains(guide, []byte("Context freshness protocol")) {
		t.Fatal("zh guide must not render the en branch")
	}
}

func TestRenderSessionGuideFollowsStoredLocale(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveLocalePreference(LocaleEn); err != nil {
		t.Fatal(err)
	}
	guide, err := NewAgentBridge(store).renderSessionGuide()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(guide, []byte("Context freshness protocol")) {
		t.Fatal("session guide did not follow the stored en preference")
	}
	if bytes.Contains(guide, []byte("上下文刷新协议")) {
		t.Fatal("session guide rendered zh despite the stored en preference")
	}
}
