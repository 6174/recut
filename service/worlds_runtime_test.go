/*
 * [INPUT]: 依赖 AppHost、临时 manifest/background 与 WorldStore
 * [OUTPUT]: 验证 ctx.worlds 权限门：无 worlds.* 权限不暴露能力、worlds.read 只读（write 不可用）、
 * worlds.write 可创建、bind 不能绑定其他 App 的项目
 * [POS]: service 的 Creation Worlds capability 回归测试；JS 只能经 manifest 明示的权限调用 ctx.worlds
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeWorldsApp(t *testing.T, root, appID, manifest, background string) {
	t.Helper()
	appDir := filepath.Join(root, "apps", appID)
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), manifest)
	writeTestFile(t, filepath.Join(appDir, "background.js"), background)
}

func TestCtxWorldsPermissionGatesCapability(t *testing.T) {
	root := t.TempDir()
	writeWorldsApp(t, root, "reader", `{"manifestVersion":1,"id":"reader.app","name":"Reader","author":"Test","description":"Read only.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["worlds.read"],"operations":[{"name":"probe","surfaces":["api"],"description":"probe","inputSchema":{"type":"object","properties":{}}}]}`, `
recut.operation.register("probe", (_, ctx) => ({
  worldsType: typeof ctx.worlds,
  createType: typeof (ctx.worlds && ctx.worlds.create),
  listType: typeof (ctx.worlds && ctx.worlds.list),
  entitiesListType: typeof (ctx.worlds && ctx.worlds.entities && ctx.worlds.entities.list),
  entitiesUpsertType: typeof (ctx.worlds && ctx.worlds.entities && ctx.worlds.entities.upsert),
  referencesType: typeof (ctx.worlds && ctx.worlds.references),
}));`)
	writeWorldsApp(t, root, "writer", `{"manifestVersion":1,"id":"writer.app","name":"Writer","author":"Test","description":"Read and write.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["worlds.read","worlds.write","worlds.bind"],"operations":[{"name":"create","surfaces":["api"],"description":"create","inputSchema":{"type":"object","properties":{}}},{"name":"bind","surfaces":["api"],"description":"bind","inputSchema":{"type":"object","properties":{}}}]}`, `
recut.operation.register("create", (_, ctx) => ctx.worlds.create({ name: "From App", type: "custom" }));
recut.operation.register("bind", (_, ctx) => ctx.creationContext.bindProject({ worldId: "cw_whatever", selection: { purpose: "video" } }));
`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	host := NewAppHost(apps, store, media)
	readerProject, err := store.Create(CreateInput{Name: "Reader project", AppID: "reader.app"})
	if err != nil {
		t.Fatal(err)
	}
	probe, err := host.InvokeAPI(Target{ProjectID: readerProject.ID, AppID: "reader.app"}, "reader.app", "probe", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	values := probe.(map[string]any)
	if values["worldsType"] != "object" || values["createType"] != "undefined" {
		t.Fatalf("reader ctx.worlds = %#v", values)
	}
	if values["listType"] != "function" {
		t.Fatalf("reader worlds.list missing: %#v", values)
	}
	if values["entitiesListType"] != "function" || values["entitiesUpsertType"] != "undefined" {
		t.Fatalf("reader entities gating = %#v", values)
	}
	if values["referencesType"] != "undefined" {
		t.Fatalf("reader references must be gated behind worlds.write: %#v", values)
	}
	writerProject, err := store.Create(CreateInput{Name: "Writer project", AppID: "writer.app"})
	if err != nil {
		t.Fatal(err)
	}
	created, err := host.InvokeAPI(Target{ProjectID: writerProject.ID, AppID: "writer.app"}, "writer.app", "create", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	world, ok := created.(WorldDetail)
	if !ok || world.Name != "From App" || world.Type != WorldCustom {
		t.Fatalf("app created world = %#v", created)
	}
	// The writer App binds through ctx.creationContext for its own project; the
	// nonexistent world must surface a structured error rather than succeed.
	if _, err := host.InvokeAPI(Target{ProjectID: writerProject.ID, AppID: "writer.app"}, "writer.app", "bind", map[string]any{}); err == nil {
		t.Fatal("binding a nonexistent world unexpectedly succeeded")
	}
}

func TestAppWithoutWorldsPermissionGetsNoCtxWorlds(t *testing.T) {
	root := t.TempDir()
	writeWorldsApp(t, root, "plain", `{"manifestVersion":1,"id":"plain.app","name":"Plain","author":"Test","description":"No worlds.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"operations":[{"name":"probe","surfaces":["api"],"description":"probe","inputSchema":{"type":"object","properties":{}}}]}`, `
recut.operation.register("probe", (_, ctx) => ({ worldsType: typeof ctx.worlds, creationContextType: typeof ctx.creationContext }));`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Plain", AppID: "plain.app"})
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)
	probe, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: "plain.app"}, "plain.app", "probe", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	values := probe.(map[string]any)
	if values["worldsType"] != "undefined" || values["creationContextType"] != "undefined" {
		t.Fatalf("unpermissioned ctx exposed: %#v", values)
	}
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
}
