/*
 * [INPUT]: 依赖 TerminalManager 的通用 PTY 生命周期、终端工作目录边界与临时文件系统
 * [OUTPUT]: 验证终端 transcript 与最新消息摘要在管理器重建后仍可恢复，并锁定项目相对工作目录不越界
 * [POS]: service 的终端会话持久化回归测试，保护浏览器重连与 Daemon 重启语义
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

func TestTerminalTranscriptSurvivesManagerRestart(t *testing.T) {
	root := t.TempDir()
	store := &Store{root: root}
	projectRoot := store.projectDir("project-1")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writeProjectJSON(filepath.Join(projectRoot, "recut.json"), Project{ID: "project-1"}); err != nil {
		t.Fatal(err)
	}
	manager := &TerminalManager{terminals: map[string]*terminal{}}
	session, err := manager.Start(TerminalStart{
		ProjectID:  "project-1",
		Command:    "sh",
		Args:       []string{"-c", "printf terminal-history"},
		CWD:        projectRoot,
		SessionDir: store.TerminalSessionsDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		data, _ := os.ReadFile(filepath.Join(store.TerminalSessionsDir(), session.ID, "transcript.log"))
		if strings.Contains(string(data), "terminal-history") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	restored, err := NewTerminalManager(store)
	if err != nil {
		t.Fatal(err)
	}
	history, _, unsubscribe, err := restored.Subscribe(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	unsubscribe()
	if !strings.Contains(history, "terminal-history") {
		t.Fatalf("history = %q", history)
	}
	var restoredSession *TerminalSession
	for _, candidate := range restored.List() {
		if candidate.ID == session.ID {
			restoredSession = &candidate
			break
		}
	}
	if restoredSession == nil {
		t.Fatal("restored session not found")
	}
	if restoredSession.LastMessage != "terminal-history" {
		t.Fatalf("last message = %q", restoredSession.LastMessage)
	}
}

func TestTerminalWorkingDirectoryStaysWithinProjectFiles(t *testing.T) {
	filesRoot := t.TempDir()
	workspace := filepath.Join(filesRoot, "workspace")
	if err := os.Mkdir(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	expected, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := terminalWorkingDirectory(filesRoot, "workspace")
	if err != nil || resolved != expected {
		t.Fatalf("workspace cwd = %q, %v", resolved, err)
	}
	for _, invalid := range []string{"..", "../outside", "/tmp"} {
		if _, err := terminalWorkingDirectory(filesRoot, invalid); err == nil {
			t.Fatalf("cwd %q escaped project files", invalid)
		}
	}
}
