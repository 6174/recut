/*
 * [INPUT]: 依赖 ContributedMediaProvider 的 executor.resultIdPath 契约与 providerResultID/stringByPath；
 *          依赖临时 App（manifest.json + background.js）经 LoadCatalog/NewStore/NewAppHost 装配的真实调用链，
 *          验证 operations.task 声明的 provider 由平台轮询 App 任务态
 * [OUTPUT]: 锁定本地 provider 生成结果记录 id 的提取（默认 generation.id、executor 声明的 synthesis.id 等点
 *          路径、路径缺失返回空），以及「App 排队中（job=null + taskId）不是错误」的等待契约
 * [POS]: service 的「App 贡献本地 media provider」桥回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProviderResultIDResolvesDotPath(t *testing.T) {
	cases := []struct {
		name         string
		contribution ContributedMediaProvider
		raw          any
		want         string
	}{
		{
			name:         "default generation.id",
			contribution: ContributedMediaProvider{},
			raw:          map[string]any{"generation": map[string]any{"id": "gen-1"}},
			want:         "gen-1",
		},
		{
			name:         "executor synthesis.id",
			contribution: ContributedMediaProvider{Executor: &ContributedMediaExecutor{ResultIDPath: "synthesis.id"}},
			raw:          map[string]any{"synthesis": map[string]any{"id": "syn-1"}},
			want:         "syn-1",
		},
		{
			name:         "missing path",
			contribution: ContributedMediaProvider{},
			raw:          map[string]any{"generation": map[string]any{}},
			want:         "",
		},
		{
			name:         "non-string id",
			contribution: ContributedMediaProvider{},
			raw:          map[string]any{"generation": map[string]any{"id": 7}},
			want:         "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := providerResultID(tc.contribution, tc.raw); got != tc.want {
				t.Fatalf("providerResultID() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestProviderTaskIDAndState(t *testing.T) {
	if got := providerTaskID(map[string]any{"job": nil, "taskId": "t-1"}); got != "t-1" {
		t.Fatalf("providerTaskID() = %q, want t-1", got)
	}
	if got := providerTaskID(map[string]any{"job": nil}); got != "" {
		t.Fatalf("providerTaskID() = %q, want empty", got)
	}
	if got := providerTaskState(map[string]any{"state": "queued"}); got != "queued" {
		t.Fatalf("providerTaskState(state) = %q, want queued", got)
	}
	if got := providerTaskState(map[string]any{"status": "completed"}); got != "completed" {
		t.Fatalf("providerTaskState(status) = %q, want completed", got)
	}
	if got := providerTaskState(map[string]any{}); got != "" {
		t.Fatalf("providerTaskState(empty) = %q, want empty", got)
	}
}

// TestWaitForAppGenerationAcceptsQueuedTask locks the reported regression: an App
// that owns a queue returns { job: null, taskId } while its slot is taken. The
// bridge must observe the declared task operation instead of failing the job for
// "missing a job id", and the App's own queue latency must not read as an
// execution timeout.
func TestWaitForAppGenerationAcceptsQueuedTask(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "localgen")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.localgen","name":"Local Gen","author":"Test","description":"Test App.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"},"permissions":["sqlite"],"operations":[{"name":"example.task.get","description":"Task state.","surfaces":["api","mcp"],"inputSchema":{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}}]}`)
	// 前两次读取报 queued（模拟占槽排队），之后 completed。
	writeTestFile(t, filepath.Join(appDir, "background.js"), `recut.operation.register("example.task.get", function(input, ctx) {
  ctx.sqlite.execute("create table if not exists polls (n integer not null default 1)");
  var seen = ctx.sqlite.query("select n from polls");
  ctx.sqlite.execute("insert into polls (n) values (1)");
  return { id: input.id, state: seen.length >= 2 ? "completed" : "queued" };
});`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	host := NewAppHost(apps, store)

	contribution := ContributedMediaProvider{
		ID:         "local-gen",
		Operations: ContributedMediaProviderOperations{Generate: "example.generate", Save: "example.save", Task: "example.task.get"},
	}
	raw := map[string]any{"job": nil, "taskId": "t-1", "generation": map[string]any{"id": "g-1"}}
	if err := waitForAppGeneration(host, "example.localgen", contribution, raw); err != nil {
		t.Fatalf("waitForAppGeneration() = %v, want nil while the App queues the task", err)
	}

	// 未声明 task op 的 provider 仍要求同步返回 job id（旧契约不变）。
	legacy := ContributedMediaProvider{ID: "local-gen", Operations: ContributedMediaProviderOperations{Generate: "example.generate", Save: "example.save"}}
	if err := waitForAppGeneration(host, "example.localgen", legacy, raw); err == nil {
		t.Fatal("waitForAppGeneration() accepted a provider with neither a job id nor a declared task op")
	}
}
