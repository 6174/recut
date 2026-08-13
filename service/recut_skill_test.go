/*
 * [INPUT]: 依赖 RecutSkillManager 的内嵌正文、临时 data/home/config 目录与 Server HTTP 路由
 * [OUTPUT]: 验证启动同步覆盖旧正文、Agent 软链接复用唯一来源且拒绝覆盖已有目录、Skill 以 OutputFormat=url 输出 recut.video 深链且绝不含 Recut chat UI 的受控 XML，以及按全局/App 分组列出并链接任意 Skill 的 HTTP 契约
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

func TestRecutSkillOutputFormatIsURLOnly(t *testing.T) {
	for _, required := range []string{
		"OutputFormat: url",
		"https://recut.video/media?asset=",
		"https://recut.video/projects/",
		"https://recut.video/?app=",
		"recut.worlds.list",
		"recut.apps.install",
	} {
		if !bytes.Contains(recutSkillBody, []byte(required)) {
			t.Fatalf("Recut Skill is missing third-party URL output guidance %q", required)
		}
	}
	for _, forbidden := range []string{`<media type=`, `projectid="`, `app appid="`} {
		if bytes.Contains(recutSkillBody, []byte(forbidden)) {
			t.Fatalf("Recut Skill must not emit Recut chat UI XML references %q", forbidden)
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
	recut := servers[recutSkillID].(map[string]any)
	if recut["type"] != "http" || recut["url"] != globalMCPEndpoint {
		t.Fatalf("Claude MCP must use Streamable HTTP: %#v", recut)
	}
}

func TestRecutSkillMigratesManagedCodexMCPToStreamableHTTP(t *testing.T) {
	manager := testRecutSkillManager(t)
	path, _, err := manager.mcpConfig("codex")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	old := "model = \"test\"\n# Recut-managed MCP: keep this block so the Recut Skill can use local tools.\n[mcp_servers.recut]\ncommand = \"/tmp/go-build/recut-service\"\nargs = [\"--mcp\"]\n"
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Link([]string{"codex"}); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	if !bytes.Contains(body, []byte("url = \""+globalMCPEndpoint+"\"")) || bytes.Contains(body, []byte("go-build")) {
		t.Fatalf("Codex MCP was not migrated: %s", text)
	}
	if !bytes.Contains(body, []byte("model = \"test\"")) {
		t.Fatalf("Codex user configuration was not preserved: %s", text)
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

func TestSkillsHTTPCatalogGroupsGlobalAndApps(t *testing.T) {
	manager := testRecutSkillManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	appsDir := filepath.Join(t.TempDir(), "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	appRoot := filepath.Join(appsDir, "test-app")
	if err := os.MkdirAll(appRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appRoot, "manifest.json"), `{"manifestVersion":1,"id":"test.app","name":"Test App","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	skillRoot := filepath.Join(appRoot, "skills", "studio")
	if err := os.MkdirAll(skillRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(skillRoot, "SKILL.md"), "---\nname: studio\ndescription: Test studio skill.\n---\n# Studio")
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(apps, nil, nil, nil, nil, nil, nil)
	server.skill = manager
	handler := server.routes()

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/skills", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
	}
	catalog := skillCatalogStatus{}
	if err := json.NewDecoder(recorder.Body).Decode(&catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Global) < 1 || catalog.Global[0].ID != recutSkillID {
		t.Fatalf("global skills = %#v", catalog.Global)
	}
	if len(catalog.Apps) != 1 || catalog.Apps[0].AppID != "test.app" {
		t.Fatalf("apps = %#v", catalog.Apps)
	}
	group := catalog.Apps[0]
	if len(group.Skills) != 1 || group.Skills[0].ID != "studio" {
		t.Fatalf("app skills = %#v", group.Skills)
	}
	for _, target := range group.Skills[0].Targets {
		if target.MCP != recutMCPNotApplicable {
			t.Fatalf("App skill MCP = %q want not-applicable", target.MCP)
		}
	}
}

func TestSkillsHTTPLinksAppSkillWithoutMCP(t *testing.T) {
	manager := testRecutSkillManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	appsDir := filepath.Join(t.TempDir(), "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	appRoot := filepath.Join(appsDir, "test-app")
	if err := os.MkdirAll(appRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appRoot, "manifest.json"), `{"manifestVersion":1,"id":"test.app","name":"Test App","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	skillRoot := filepath.Join(appRoot, "skills", "studio")
	if err := os.MkdirAll(skillRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(skillRoot, "SKILL.md"), "---\nname: studio\n---\n# Studio")
	apps, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(apps, nil, nil, nil, nil, nil, nil)
	server.skill = manager
	handler := server.routes()

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/skills/links", bytes.NewBufferString(`{"appId":"test.app","skillId":"studio","targets":["opencode"]}`)))
	if recorder.Code != http.StatusOK {
		t.Fatalf("link = %d: %s", recorder.Code, recorder.Body.String())
	}
	summary := skillLinkSummary{}
	if err := json.NewDecoder(recorder.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.ID != "studio" || summary.Source != skillRoot {
		t.Fatalf("summary = %#v", summary)
	}
	if len(summary.Targets) != 4 {
		t.Fatalf("targets = %#v", summary.Targets)
	}
	for _, target := range summary.Targets {
		want := "available"
		if target.ID == "opencode" {
			want = "linked"
		}
		if target.Status != want {
			t.Fatalf("%s status = %q want %q", target.ID, target.Status, want)
		}
	}
}
