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
}
