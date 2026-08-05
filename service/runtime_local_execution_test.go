/*
 * [INPUT]: 依赖临时 App manifest、MediaService、AppHost 与 HTTP 路由
 * [OUTPUT]: 锁定 App 私有素材 materialize、受限 Python 执行、显式素材导入和私有预览文件交付
 * [POS]: runtime 的本地执行能力回归测试；不下载模型或调用真实 Depth Anything
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppLocalExecutionUsesPrivateFilesUntilExplicitMediaImport(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "depth")
	if err := os.MkdirAll(filepath.Join(appDir, "ui"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.depth","name":"Depth","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"},"permissions":["files","media.read","media.write","shell"],"operations":[{"name":"depth.run","description":"Run local depth test.","surfaces":["api"],"inputSchema":{"type":"object"}}]}`)
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("depth.run", function(input, ctx) { const source = ctx.media.materialize(input.assetId); ctx.files.writeText("outputs/depth.png", "depth preview"); const saved = ctx.media.importFile({path:"outputs/depth.png",name:"depth.png",mimeType:"image/png"}); const process = ctx.shell.run({command:"python3",args:["-c","print('ready')"],timeoutSeconds:5}); return {sourcePath:source.path,sourceURL:ctx.files.url(source.path),savedAssetId:saved.id,stdout:process.stdout.trim()}; });`)
	writeTestFile(t, filepath.Join(appDir, "ui", "index.html"), "ok")
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Depth", AppID: "example.depth"})
	if err != nil {
		t.Fatal(err)
	}
	media := NewMediaService(store)
	source, err := media.ImportMedia("source.png", "image/png", []byte("source image"))
	if err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store, media)
	result, err := host.InvokeAPI(Target{ProjectID: project.ID, AppID: "example.depth"}, "example.depth", "depth.run", map[string]any{"assetId": source.ID})
	if err != nil {
		t.Fatal(err)
	}
	output := result.(map[string]any)
	if output["sourcePath"] == "" || output["savedAssetId"] == source.ID || output["stdout"] != "ready" {
		t.Fatalf("unexpected local execution result: %#v", output)
	}
	preview := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, output["sourceURL"].(string), nil)
	NewServer(apps, store, nil, nil, nil, host, media).routes().ServeHTTP(preview, request)
	if preview.Code != http.StatusOK || !strings.Contains(preview.Body.String(), "source image") {
		t.Fatalf("private preview = %d %q", preview.Code, preview.Body.String())
	}
}
