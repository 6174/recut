/*
 * [INPUT]: 依赖 AppHost、临时 manifest 和 JavaScript background
 * [OUTPUT]: 验证 JS App 只能通过 SQLite/files/artifact capability 完成业务调用
 * [POS]: service 的 capability runtime 回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppHostInvokesManifestDeclaredJavaScriptAPI(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(filepath.Join(appDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["sqlite","files","artifacts.publish"],"operations":[{"name":"note.create","description":"Create a note.","surfaces":["api","mcp"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("note.create", function(input, ctx) { ctx.sqlite.execute("create table if not exists notes (value text)"); ctx.sqlite.execute("insert into notes values (?)", [input.value]); ctx.files.writeText("note.txt", input.value); return ctx.artifacts.publish({type:"example.note@1", value:{value:input.value}}); });`)
	writeTestFile(t, filepath.Join(appDir, "ui", "index.html"), "ok")
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
	result, err := NewAppHost(apps, store).InvokeAPI(project.ID, "example.app", "note.create", map[string]any{"value": "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if result.(Artifact).Type != "example.note@1" {
		t.Fatalf("result = %#v", result)
	}
	mcpResult, err := NewAppHost(apps, store).InvokeMCP(project.ID, "example.app", "note.create", map[string]any{"value": "from agent"})
	if err != nil || mcpResult.(Artifact).Type != "example.note@1" {
		t.Fatalf("mcp result = %#v, err = %v", mcpResult, err)
	}
	artifacts, err := store.ListArtifacts(project.ID)
	if err != nil || len(artifacts) != 2 {
		t.Fatalf("artifacts = %#v, err = %v", artifacts, err)
	}
	if _, err := os.Stat(filepath.Join(store.projectDir(project.ID), "apps", "example.app", "files", "note.txt")); err != nil {
		t.Fatal(err)
	}
}
