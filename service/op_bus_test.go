package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestOpBusDeferredLifecycle 覆盖平台通讯契约的 deferred Handle 全链路（preview.frame 首个消费者）：
// presence 门 → callUI 建 Handle + app.rpc.request 事件 → UI 回包 rpc.reply → completeOp 收尾 →
// 统一 recut.job.* 观察返回 {imageUrl}；以及跨项目归属校验。
func TestOpBusDeferredLifecycle(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	target := Target{ProjectID: project.ID, AppID: "recut.editor"}
	otherProject, err := store.Create(CreateInput{Name: "Other", AppID: "recut.editor"})
	if err != nil {
		t.Fatal(err)
	}

	// 1. 无 presence → preview.frame 返回业务错误 editor-not-open（MCP 错误信封，非传输错误）。
	_, err = host.InvokeMCP(target, "recut.editor", "preview.frame", map[string]any{"timeSec": 1.5})
	var bizErr *mcpError
	if !errors.As(err, &bizErr) || bizErr.Code != "editor-not-open" {
		t.Fatalf("preview.frame without presence = %v, want editor-not-open", err)
	}

	// 2. iframe 心跳 → presence 新鲜。
	heartbeat := invokeAPI(t, host, project, "frame.heartbeat", map[string]any{})
	if !boolOf(heartbeat["ok"]) {
		t.Fatalf("frame.heartbeat = %#v", heartbeat)
	}

	// 3. preview.frame → 返回统一 Handle（jobId），并广播 app.rpc.request 事件。
	out := invoke(t, host, project, "preview.frame", map[string]any{"timeSec": 1.5})
	jobID := stringOf(out["jobId"])
	if jobID == "" || stringOf(out["mode"]) != "ui" {
		t.Fatalf("preview.frame = %#v", out)
	}
	events := projectEvents(store, project.ID)
	var rpcEvent map[string]any
	for _, e := range events {
		if e["type"] == "app.rpc.request" && e["id"] == jobID {
			rpcEvent = e
			break
		}
	}
	if rpcEvent == nil {
		t.Fatalf("no app.rpc.request event for %s (events=%d)", jobID, len(events))
	}
	payload := rpcEvent["payload"].(map[string]any)
	if numOf(payload["timeSec"]) != 1.5 {
		t.Fatalf("app.rpc.request payload = %#v", payload)
	}

	// 4. UI 回包：rpc.reply → completeOp（frame.finalize）收尾 → async_ops completed。
	pngB64 := base64.StdEncoding.EncodeToString([]byte("fake-png-bytes"))
	reply := invokeAPI(t, host, project, "rpc.reply", map[string]any{
		"id": jobID,
		"result": map[string]any{
			"fileBase64": pngB64,
			"width":      float64(1920),
			"height":     float64(1080),
			"version":    float64(3),
		},
	})
	if stringOf(reply["status"]) != "completed" {
		t.Fatalf("rpc.reply = %#v", reply)
	}

	// 5. 统一观察：recut.job.status（unifiedJobStatus 路径，含 deferred 分支）。
	view, err := unifiedJobStatus(host.jobs, host.async, nil, jobID)
	if err != nil {
		t.Fatalf("unifiedJobStatus: %v", err)
	}
	vm := view.(map[string]any)
	if vm["kind"] != "deferred" || vm["status"] != "completed" {
		t.Fatalf("job view = %#v", vm)
	}
	result := vm["result"].(map[string]any)
	imageURL := stringOf(result["imageUrl"])
	if !strings.Contains(imageURL, "/v1/projects/"+project.ID+"/apps/recut.editor/files/frames/"+jobID+".png") {
		t.Fatalf("imageUrl = %q", imageURL)
	}

	// 6. completeOp 确实写了 PNG 文件到项目文件根。
	filesRoot, err := store.ProjectFilesRoot(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	framePath := filepath.Join(filesRoot, "frames", jobID+".png")
	if _, err := os.Stat(framePath); err != nil {
		t.Fatalf("frame file missing: %v", err)
	}

	// 7. 跨项目伪造回包被拒。
	otherTarget := Target{ProjectID: otherProject.ID, AppID: "recut.editor"}
	_, err = host.InvokeAPI(otherTarget, "recut.editor", "rpc.reply", map[string]any{"id": jobID, "result": map[string]any{"fileBase64": pngB64}})
	if err == nil || !strings.Contains(err.Error(), "does not belong") {
		t.Fatalf("cross-project rpc.reply = %v, want rejection", err)
	}

	// 8. 二次回包幂等：不覆盖已完成结果。
	again := invokeAPI(t, host, project, "rpc.reply", map[string]any{"id": jobID, "result": map[string]any{"fileBase64": pngB64}})
	if stringOf(again["status"]) != "completed" || boolOf(again["resolved"]) {
		t.Fatalf("duplicate rpc.reply = %#v", again)
	}

	// 9. 取消未终态 Handle。
	open := invoke(t, host, project, "preview.frame", map[string]any{"timeSec": 2.0})
	openID := stringOf(open["jobId"])
	cancelled, err := unifiedJobStatus(host.jobs, host.async, nil, openID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.(map[string]any)["status"] != "pending" {
		t.Fatalf("fresh handle = %#v", cancelled)
	}
	if _, err := host.async.Cancel(openID); err != nil {
		t.Fatal(err)
	}
	afterCancel, _ := unifiedJobStatus(host.jobs, host.async, nil, openID)
	if afterCancel.(map[string]any)["status"] != "cancelled" {
		t.Fatalf("after cancel = %#v", afterCancel)
	}
}

// TestOpBusTimeout 覆盖 deferred Handle 的超时收敛（惰性 + 显式 sweep）。
func TestOpBusTimeout(t *testing.T) {
	_, _, host, project := setupEditorTestApp(t)
	_ = invokeAPI(t, host, project, "frame.heartbeat", map[string]any{})
	out := invoke(t, host, project, "preview.frame", map[string]any{"timeSec": 0.5})
	jobID := stringOf(out["jobId"])
	if jobID == "" {
		t.Fatalf("preview.frame = %#v", out)
	}
	// 把 timeout_at 拨回过去，模拟超时。
	if err := host.async.withDB(func(db *sql.DB) error {
		_, err := db.Exec("update async_ops set timeout_at = ? where id = ?",
			time.Now().UTC().Add(-time.Second).Format(time.RFC3339Nano), jobID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	view, err := unifiedJobStatus(host.jobs, host.async, nil, jobID)
	if err != nil {
		t.Fatalf("unifiedJobStatus: %v", err)
	}
	if view.(map[string]any)["status"] != "timed_out" {
		t.Fatalf("timeout view = %#v", view)
	}
}

// TestOpBusWait 覆盖 unifiedJobWait 的 deferred 分支：等待中完成 → 返回 completed 结果。
func TestOpBusWait(t *testing.T) {
	_, _, host, project := setupEditorTestApp(t)
	_ = invokeAPI(t, host, project, "frame.heartbeat", map[string]any{})
	out := invoke(t, host, project, "preview.frame", map[string]any{"timeSec": 1.0})
	jobID := stringOf(out["jobId"])
	if jobID == "" {
		t.Fatalf("preview.frame = %#v", out)
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		pngB64 := base64.StdEncoding.EncodeToString([]byte("wait-png"))
		target := Target{ProjectID: project.ID, AppID: "recut.editor"}
		_, _ = host.InvokeAPI(target, "recut.editor", "rpc.reply", map[string]any{
			"id": jobID, "result": map[string]any{"fileBase64": pngB64, "width": float64(1280), "height": float64(720)},
		})
	}()
	view, err := unifiedJobWait(host.jobs, host.async, nil, jobID, 5*time.Second)
	if err != nil {
		t.Fatalf("unifiedJobWait: %v", err)
	}
	vm := view.(map[string]any)
	if vm["status"] != "completed" {
		t.Fatalf("wait view = %#v", vm)
	}
	if stringOf(vm["result"].(map[string]any)["imageUrl"]) == "" {
		t.Fatalf("wait result missing imageUrl: %#v", vm["result"])
	}
}

// TestOpBusRawJSONChecks 验证 async_ops 生命周期事件进入项目账本（Handle 可观察）。
func TestOpBusRawJSONChecks(t *testing.T) {
	_, store, host, project := setupEditorTestApp(t)
	_ = invokeAPI(t, host, project, "frame.heartbeat", map[string]any{})
	out := invoke(t, host, project, "preview.frame", map[string]any{"timeSec": 1.0})
	jobID := stringOf(out["jobId"])
	events := projectEvents(store, project.ID)
	types := map[string]bool{}
	for _, e := range events {
		if id, _ := e["id"].(string); id == jobID {
			types[stringOf(e["type"])] = true
		}
	}
	if !types["async.op.created"] || !types["app.rpc.request"] {
		raw, _ := json.MarshalIndent(events, "", "  ")
		t.Fatalf("expected created+rpc.request lifecycle events, got %s", string(raw))
	}
}