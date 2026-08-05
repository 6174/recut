/*
 * [INPUT]: 依赖临时 App/Project scope、ShellJobManager 与项目事件持久化
 * [OUTPUT]: 锁定 shell job 的 stdout/stderr 日志、完成事件与服务重启中断收敛
 * [POS]: service 的本地任务系统回归测试；不依赖 Python、网络或模型下载
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestShellJobPersistsLogsAndCompletion(t *testing.T) {
	store, project := testShellJobScope(t)
	jobs := NewShellJobManager(store)
	job, err := jobs.Execute(ShellJobStart{ProjectID: project.ID, AppID: project.AppID, Command: "sh", Args: []string{"-c", "printf out; printf err >&2"}, Dir: t.TempDir(), TimeoutSeconds: 5})
	if err != nil || job.Status != ShellJobCompleted {
		t.Fatalf("job = %#v, err = %v", job, err)
	}
	output := jobs.Output(project.ID, job.ID)
	if !strings.Contains(output, "out") || !strings.Contains(output, "err") {
		t.Fatalf("output = %q", output)
	}
	logs, err := jobs.Logs(project.ID, job.ID)
	if err != nil || len(logs) != 2 || logs[0].Sequence >= logs[1].Sequence {
		t.Fatalf("logs = %#v, err = %v", logs, err)
	}
	events, err := store.ListProjectEvents(project.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	completed := 0
	for _, event := range events {
		if strings.Contains(event.Payload, "shell.job.completed") {
			completed++
		}
	}
	if completed != 1 {
		t.Fatalf("completion events = %d, events = %#v", completed, events)
	}
}

func TestShellJobRecoveryMarksActiveJobInterrupted(t *testing.T) {
	store, project := testShellJobScope(t)
	jobs := NewShellJobManager(store)
	job := ShellJob{ID: "interrupted", ProjectID: project.ID, AppID: project.AppID, Status: ShellJobRunning, Command: "sh"}
	if err := jobs.persist(job); err != nil {
		t.Fatal(err)
	}
	restarted := NewShellJobManager(store)
	if count, err := restarted.RecoverInterrupted(); err != nil || count != 1 {
		t.Fatalf("recovered = %d, err = %v", count, err)
	}
	recovered, err := restarted.Status(project.ID, project.AppID, job.ID)
	if err != nil || recovered.Status != ShellJobInterrupted {
		t.Fatalf("job = %#v, err = %v", recovered, err)
	}
}

func TestShellJobCancellationPersistsTerminalState(t *testing.T) {
	store, project := testShellJobScope(t)
	jobs := NewShellJobManager(store)
	job, err := jobs.Start(ShellJobStart{ProjectID: project.ID, AppID: project.AppID, Command: "sh", Args: []string{"-c", "sleep 5"}, Dir: t.TempDir(), TimeoutSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	if err := jobs.Cancel(project.ID, project.AppID, job.ID); err != nil {
		t.Fatal(err)
	}
	completed, err := jobs.Wait(project.ID, project.AppID, job.ID)
	if err != nil || completed.Status != ShellJobCancelled {
		t.Fatalf("job = %#v, err = %v", completed, err)
	}
}

func testShellJobScope(t *testing.T) (*Store, Project) {
	t.Helper()
	root := t.TempDir()
	appRoot := filepath.Join(root, "apps", "example")
	if err := os.MkdirAll(appRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appRoot, "manifest.json"), `{"manifestVersion":1,"id":"example.shell","name":"Shell","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	apps, err := LoadCatalog(filepath.Join(root, "apps"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(root, "data"), apps)
	if err := store.Ensure(); err != nil {
		t.Fatal(err)
	}
	project, err := store.Create(CreateInput{Name: "Shell", AppID: "example.shell"})
	if err != nil {
		t.Fatal(err)
	}
	return store, project
}
