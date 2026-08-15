/*
 * [INPUT]: 依赖 App Catalog、MCP Host、Store 与设备 token
 * [OUTPUT]: 锁定 skill 树发现、__recut target envelope 的目标解析、跨 owner 拒绝与设备 token 生命周期
 * [POS]: service 的会话解耦回归测试；验证任意会话可调用任意 App、target 解析与外部封装基础
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSkillDiscoveryFromStandardTreeAndAgentsFallback(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(filepath.Join(appDir, "skills", "vox-broll", "references"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	writeTestFile(t, filepath.Join(appDir, "skills", "vox-broll", "SKILL.md"), "---\nname: vox-broll\ndescription: Vox 风格解说片。\nreferences: [references/prompt-library.md]\n---\n# Vox 工作流\n关键画面：五段提示词结构")
	writeTestFile(t, filepath.Join(appDir, "skills", "vox-broll", "references", "prompt-library.md"), "提示词库正文")
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	app, ok := apps.Get("example.app")
	if !ok {
		t.Fatal("example.app missing")
	}
	skills, err := app.Skills()
	if err != nil || len(skills) != 1 {
		t.Fatalf("skills = %#v, err = %v", skills, err)
	}
	skill := skills[0]
	if skill.ID != "vox-broll" || !strings.Contains(skill.Body, "关键画面") || len(skill.References) != 1 {
		t.Fatalf("skill = %#v", skill)
	}

	fallbackDir := filepath.Join(root, "apps", "fallback")
	if err := os.MkdirAll(fallbackDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(fallbackDir, "manifest.json"), `{"manifestVersion":1,"id":"fallback.app","name":"Fallback","author":"Test","description":"Fallback App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	writeTestFile(t, filepath.Join(fallbackDir, "AGENTS.md"), "# 回退领域指南")
	apps, err = LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	fallback, ok := apps.Get("fallback.app")
	if !ok {
		t.Fatal("fallback.app missing")
	}
	fallbackSkills, err := fallback.Skills()
	if err != nil || len(fallbackSkills) != 1 || !strings.Contains(fallbackSkills[0].Body, "回退") {
		t.Fatalf("fallback skills = %#v, err = %v", fallbackSkills, err)
	}
}

func TestMCPSkillToolsReadReference(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(filepath.Join(appDir, "skills", "vox-broll", "references"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	writeTestFile(t, filepath.Join(appDir, "skills", "vox-broll", "SKILL.md"), "---\nname: vox-broll\ndescription: Vox 风格解说片。\nreferences: [notes.md, timeline-workflow.md]\n---\n# 正文")
	writeTestFile(t, filepath.Join(appDir, "skills", "vox-broll", "notes.md"), "补充材料")
	writeTestFile(t, filepath.Join(appDir, "skills", "vox-broll", "references", "timeline-workflow.md"), "时间线工作流")
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	host := NewAppHost(apps, store, NewMediaService(store))
	session := AgentSession{ID: "test"}

	call := func(name string, args string) (any, error) {
		return handleMCP(bridge, host, nil, session, mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"` + name + `","arguments":` + args + `}`)})
	}
	result, err := call("recut.skills.read", `{"appId":"example.app","skillId":"vox-broll"}`)
	if err != nil {
		t.Fatal(err)
	}
	read := result.(map[string]any)["structuredContent"].(map[string]any)
	if !strings.Contains(read["body"].(string), "# 正文") {
		t.Fatalf("skill body = %#v", read)
	}
	result, err = call("recut.skills.reference", `{"appId":"example.app","skillId":"vox-broll","path":"notes.md"}`)
	if err != nil {
		t.Fatal(err)
	}
	ref := result.(map[string]any)["structuredContent"].(map[string]any)
	if !strings.Contains(ref["content"].(string), "补充材料") {
		t.Fatalf("reference = %#v", ref)
	}
	result, err = call("recut.skills.reference", `{"appId":"example.app","skillId":"vox-broll","path":"timeline-workflow.md"}`)
	if err != nil {
		t.Fatal(err)
	}
	bare := result.(map[string]any)["structuredContent"].(map[string]any)
	if bare["path"] != "references/timeline-workflow.md" || bare["content"] != "时间线工作流" {
		t.Fatalf("bare reference = %#v", bare)
	}
	if _, err := call("recut.skills.reference", `{"appId":"example.app","skillId":"vox-broll","path":"../manifest.json"}`); err == nil {
		t.Fatal("skill reference escaped the skill directory")
	}
}

func TestMCPAppOperationTargetEnvelope(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite"],"operations":[{"name":"where","description":"Report target.","surfaces":["api","mcp"],"inputSchema":{"type":"object","properties":{"note":{"type":"string"}}}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("where", function(input, ctx) { ctx.sqlite.execute("create table if not exists seen (note text)"); ctx.sqlite.execute("insert into seen values (?)", [input.note || "none"]); return { project: ctx.project ? ctx.project.id : null, appState: !!ctx.appState }; });`)
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
	host := NewAppHost(apps, store, NewMediaService(store))

	// No target + no session default -> appstate.
	result, err := handleMCP(bridge, host, nil, AgentSession{ID: "s1"}, mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"example.app.where","arguments":{"note":"a"}}`)})
	if err != nil {
		t.Fatal(err)
	}
	if value := result.(map[string]any)["structuredContent"].(map[string]any)["project"]; value != nil {
		t.Fatalf("no-target call resolved to a project: %#v", value)
	}
	// Explicit __recut.target -> project target.
	result, err = handleMCP(bridge, host, nil, AgentSession{ID: "s1"}, mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"example.app.where","arguments":{"note":"b","__recut":{"target":{"projectId":"` + project.ID + `"}}}}`)})
	if err != nil {
		t.Fatal(err)
	}
	if value := result.(map[string]any)["structuredContent"].(map[string]any)["project"]; value != project.ID {
		t.Fatalf("explicit target did not resolve: %#v", value)
	}
	// Cross-owner target rejected: another app cannot target this project.
	otherDir := filepath.Join(root, "apps", "other")
	if err := os.MkdirAll(otherDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(otherDir, "manifest.json"), `{"manifestVersion":1,"id":"other.app","name":"Other","author":"Test","description":"Other App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"operations":[{"name":"peek","description":"Peek.","surfaces":["mcp"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(otherDir, "background.js"), `recut.operation.register("peek", function(input, ctx) { return { ok: true }; });`)
	apps, err = LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	bridge = NewAgentBridge(store)
	host = NewAppHost(apps, store, NewMediaService(store))
	if _, err := handleMCP(bridge, host, nil, AgentSession{ID: "s1"}, mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"other.app.peek","arguments":{"__recut":{"target":{"projectId":"` + project.ID + `"}}}}`)}); err == nil {
		t.Fatal("cross-owner project target was accepted")
	}
}

func TestVoxProjectIsolationAcrossSharedAppSqlite(t *testing.T) {
	apps, err := LoadCatalog(filepath.Join("..", "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(t.TempDir(), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store, NewMediaService(store))
	first, err := store.Create(CreateInput{Name: "A", AppID: "recut.vox-broll"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Create(CreateInput{Name: "B", AppID: "recut.vox-broll"})
	if err != nil {
		t.Fatal(err)
	}
	for _, project := range []Project{first, second} {
		target := Target{ProjectID: project.ID, AppID: "recut.vox-broll"}
		if _, err := host.InvokeMCP(target, "recut.vox-broll", "brief.create", map[string]any{"topic": "属于 " + project.Name}); err != nil {
			t.Fatalf("brief.create %s: %v", project.Name, err)
		}
	}
	// Each project sees only its own brief even though all rows live in the
	// same appstate/<recut.vox-broll>/storage.sqlite.
	for _, project := range []Project{first, second} {
		target := Target{ProjectID: project.ID, AppID: "recut.vox-broll"}
		result, err := host.InvokeMCP(target, "recut.vox-broll", "workflow.context", map[string]any{})
		if err != nil {
			t.Fatalf("workflow.context %s: %v", project.Name, err)
		}
		context := result.(map[string]any)
		brief := context["inputs"].(map[string]any)["brief"].(map[string]any)
		if topic := brief["content"].(map[string]any)["topic"]; topic != "属于 "+project.Name {
			t.Fatalf("project %s saw topic %q, want %q", project.Name, topic, "属于 "+project.Name)
		}
		if resources := context["resources"].(map[string]any)["brief"].([]any); len(resources) != 1 {
			t.Fatalf("project %s saw %d brief resources, want 1", project.Name, len(resources))
		}
	}
}

func TestMCPAppManagementTools(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	bridge := NewAgentBridge(store)
	host := NewAppHost(apps, store, NewMediaService(store))
	session := AgentSession{ID: "test"}

	tools := mcpToolList(bridge, NewMediaService(store))["tools"].([]map[string]any)
	names := map[string]bool{}
	for _, tool := range tools {
		names[tool["name"].(string)] = true
	}
	for _, name := range []string{"recut.apps.list", "recut.apps.store", "recut.apps.install", "recut.apps.update"} {
		if !names[name] {
			t.Fatalf("missing app management tool %q", name)
		}
	}

	call := func(name string, args string) (any, error) {
		return handleMCP(bridge, host, nil, session, mcpRequest{Method: "tools/call", Params: json.RawMessage(`{"name":"` + name + `","arguments":` + args + `}`)})
	}
	// The store lists installable Apps with their repository and installed status.
	storeResult, err := call("recut.apps.store", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	storeItems := storeResult.(map[string]any)["structuredContent"].(map[string]any)["items"].([]map[string]any)
	storeAppIDs := map[string]bool{}
	for _, entry := range storeItems {
		storeAppIDs[entry["appId"].(string)] = true
	}
	for _, appID := range []string{"recut.vox-broll", "recut.remotion-studio", "recut.cover-studio", "recut.depth-anything", "recut.audio-studio"} {
		if !storeAppIDs[appID] {
			t.Fatalf("app store omits %q: %#v", appID, storeItems)
		}
	}
	if len(storeAppIDs) != 5 {
		t.Fatalf("app store has %d entries, want 5: %#v", len(storeAppIDs), storeItems)
	}
	for _, entry := range storeItems {
		for _, field := range []string{"appId", "name", "repository", "installed"} {
			if _, ok := entry[field]; !ok {
				t.Fatalf("store entry lacks %q: %#v", field, entry)
			}
		}
	}
	// List merges installation status into each App entry.
	result, err := call("recut.apps.list", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	items := result.(map[string]any)["structuredContent"].(map[string]any)["items"].([]map[string]any)
	found := false
	for _, entry := range items {
		if entry["appId"] == "example.app" {
			found = true
			if _, ok := entry["updateAvailable"]; !ok {
				t.Fatalf("apps.list lacks installation metadata: %#v", entry)
			}
			if _, ok := entry["manageable"]; !ok {
				t.Fatalf("apps.list lacks manageable field: %#v", entry)
			}
		}
	}
	if !found {
		t.Fatal("apps.list did not include example.app")
	}
	// Install requires a repository and rejects non-GitHub URLs (no network).
	if _, err := call("recut.apps.install", `{}`); err == nil {
		t.Fatal("apps.install accepted an empty repository")
	}
	if _, err := call("recut.apps.install", `{"repository":"not-a-github-url"}`); err == nil {
		t.Fatal("apps.install accepted a non-GitHub repository")
	}
	// Update rejects unknown packages.
	if _, err := call("recut.apps.update", `{"package":"unknown-package"}`); err == nil {
		t.Fatal("apps.update accepted an unknown package")
	}
}

func TestDeviceTokenLifecycle(t *testing.T) {
	store := NewStore(t.TempDir(), nil)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	token, secret, err := store.CreateDeviceToken([]string{"media.read", "appstate"}, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	authenticated, err := store.AuthenticateDeviceToken(secret)
	if err != nil || authenticated.ID != token.ID {
		t.Fatalf("authenticate = %#v, err = %v", authenticated, err)
	}
	if _, err := store.AuthenticateDeviceToken("wrong"); err == nil {
		t.Fatal("invalid token authenticated")
	}
	if err := store.RevokeDeviceToken(token.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AuthenticateDeviceToken(secret); err == nil {
		t.Fatal("revoked token authenticated")
	}
	expired, expiredSecret, err := store.CreateDeviceToken(nil, -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	_ = expired
	if _, err := store.AuthenticateDeviceToken(expiredSecret); err == nil {
		t.Fatal("expired token authenticated")
	}
}
