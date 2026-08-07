/*
 * [INPUT]: 依赖 RecutSkillManager 的内嵌正文、临时 data/home/config 目录与 Server HTTP 路由
 * [OUTPUT]: 验证启动同步覆盖旧正文、Agent 软链接复用唯一来源且拒绝覆盖已有目录
 * [POS]: service Recut Skill 分发的回归测试；不读取真实用户目录或启动真实 daemon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func testRecutSkillManager(t *testing.T) *RecutSkillManager {
	t.Helper()
	root := t.TempDir()
	manager := NewRecutSkillManager(filepath.Join(root, "data"))
	manager.homeDir = func() (string, error) { return filepath.Join(root, "home"), nil }
	manager.config = func() (string, error) { return filepath.Join(root, "config"), nil }
	return manager
}

func TestRecutSkillEnsureReplacesOutdatedBody(t *testing.T) {
	manager := testRecutSkillManager(t)
	if err := os.MkdirAll(manager.sourceDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manager.sourcePath(), []byte("outdated"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(manager.sourcePath())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(body, recutSkillBody) {
		t.Fatal("startup synchronization did not replace the outdated Recut Skill")
	}
}

func TestRecutSkillExplainsServiceRecovery(t *testing.T) {
	for _, required := range []string{"recut.context", "https://recut.video", "install.sh | sh", "install.ps1 | iex", "LOCAL SERVICE CONNECTED", "新开一个 Agent 会话"} {
		if !bytes.Contains(recutSkillBody, []byte(required)) {
			t.Fatalf("Recut Skill is missing offline recovery guidance %q", required)
		}
	}
}

func TestRecutSkillLinksAllAgentsWithoutCopies(t *testing.T) {
	manager := testRecutSkillManager(t)
	status, err := manager.Link(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Targets) != 4 {
		t.Fatalf("targets = %#v", status.Targets)
	}
	for _, target := range status.Targets {
		if target.Status != "linked" {
			t.Fatalf("%s status = %q", target.ID, target.Status)
		}
		info, err := os.Lstat(target.Path)
		if err != nil || info.Mode()&os.ModeSymlink == 0 {
			t.Fatalf("%s is not a symlink: info=%#v err=%v", target.ID, info, err)
		}
		resolved, err := filepath.EvalSymlinks(target.Path)
		if err != nil || !sameFile(resolved, manager.sourceDir()) {
			t.Fatalf("%s resolves to %q, err=%v", target.ID, resolved, err)
		}
		if target.ID == "agents" && target.MCP != recutMCPNotApplicable {
			t.Fatalf("generic Agent MCP status = %q", target.MCP)
		}
		if target.ID != "agents" && target.MCP != recutMCPConfigured {
			t.Fatalf("%s MCP status = %q", target.ID, target.MCP)
		}
	}
}

func TestRecutSkillStartupEnablesSafeTargetsDespiteConflict(t *testing.T) {
	manager := testRecutSkillManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	targets, err := manager.targets()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(targets[0].Path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := manager.EnableDefaultTargets(); err == nil {
		t.Fatal("startup must report a conflicting target")
	}
	status, err := manager.Status()
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range status.Targets[1:] {
		if target.Status != "linked" {
			t.Fatalf("startup did not enable %s: %q", target.ID, target.Status)
		}
	}
}

func TestRecutSkillPreservesExistingClaudeConfiguration(t *testing.T) {
	manager := testRecutSkillManager(t)
	path, _, err := manager.mcpConfig("claude")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"theme":"dark"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	status, err := manager.Link([]string{"claude"})
	if err != nil {
		t.Fatal(err)
	}
	if status.Targets[1].MCP != recutMCPConfigured {
		t.Fatalf("Claude MCP status = %q", status.Targets[1].MCP)
	}
	config, err := readRecutJSONConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if config["theme"] != "dark" {
		t.Fatalf("Claude config was not preserved: %#v", config)
	}
	servers := config["mcpServers"].(map[string]any)
	if _, ok := servers[recutSkillID]; !ok {
		t.Fatalf("Recut MCP was not registered: %#v", config)
	}
}

func TestRecutSkillDoesNotOverwriteExistingAgentSkill(t *testing.T) {
	manager := testRecutSkillManager(t)
	targets, err := manager.targets()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(targets[0].Path, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Link([]string{targets[0].ID}); err == nil {
		t.Fatal("link must refuse to overwrite an existing Agent Skill directory")
	}
	info, err := os.Stat(targets[0].Path)
	if err != nil || !info.IsDir() {
		t.Fatalf("existing target was changed: info=%#v err=%v", info, err)
	}
}

func TestRecutSkillHTTPLinksRequestedTarget(t *testing.T) {
	manager := testRecutSkillManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	server := NewServer(nil, nil, nil, nil, nil, nil, nil)
	server.skill = manager
	handler := server.routes()

	initial := httptest.NewRecorder()
	handler.ServeHTTP(initial, httptest.NewRequest(http.MethodGet, "/v1/skills/recut", nil))
	if initial.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", initial.Code, initial.Body.String())
	}

	linked := httptest.NewRecorder()
	handler.ServeHTTP(linked, httptest.NewRequest(http.MethodPost, "/v1/skills/recut/links", bytes.NewBufferString(`{"targets":["opencode"]}`)))
	if linked.Code != http.StatusOK {
		t.Fatalf("link = %d: %s", linked.Code, linked.Body.String())
	}
	status := RecutSkillStatus{}
	if err := json.NewDecoder(linked.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	for _, target := range status.Targets {
		want := "available"
		if target.ID == "opencode" {
			want = "linked"
		}
		if target.Status != want {
			t.Fatalf("%s status = %q want %q", target.ID, target.Status, want)
		}
	}
}
