/*
 * [INPUT]: 依赖 App 安装 URL 规范化、本地 Git remote 与工作树状态读取能力
 * [OUTPUT]: 验证 Git 更新检测、单个与批量 fast-forward 升级均不覆盖本地修改
 * [POS]: service App 分发边界的回归测试；只使用临时本地 Git remote，不访问网络
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestNormalizeGitHubRepository(t *testing.T) {
	repository, packageName, err := normalizeGitHubRepository("https://github.com/recut-video/example-app")
	if err != nil || repository != "https://github.com/recut-video/example-app.git" || packageName != "recut-video--example-app" {
		t.Fatalf("normalized repository = %q, package = %q, error = %v", repository, packageName, err)
	}
	if _, _, err := normalizeGitHubRepository("git@github.com:recut-video/example-app.git"); err == nil {
		t.Fatal("SSH repository URL was accepted")
	}
	if _, _, err := normalizeGitHubRepository("https://example.com/recut-video/example-app"); err == nil {
		t.Fatal("non-GitHub repository URL was accepted")
	}
}

func TestGitStatusDetectsDirtyCheckout(t *testing.T) {
	root := t.TempDir()
	for _, arguments := range [][]string{{"init"}, {"config", "user.email", "test@example.com"}, {"config", "user.name", "Test"}, {"remote", "add", "origin", "https://github.com/recut-video/example-app.git"}} {
		command := exec.Command("git", append([]string{"-C", root}, arguments...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s: %v", arguments, output, err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "manifest.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	status, err := gitStatus(root)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Dirty || status.Repository != "https://github.com/recut-video/example-app.git" {
		t.Fatalf("status = %#v", status)
	}
}

func TestInstallationsExcludeNativeMediaScope(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	appDir := filepath.Join(appsDir, "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := catalog.Get(mediaSystemAppID); !ok {
		t.Fatal("native media scope is unavailable to the platform")
	}
	installations, err := catalog.Installations()
	if err != nil || len(installations) != 1 || installations[0].Manifest.ID != "example.app" {
		t.Fatalf("app installations = %#v, err = %v", installations, err)
	}
}

func TestInstallationsDetectAndUpdateRemoteGitChanges(t *testing.T) {
	root := t.TempDir()
	remote := filepath.Join(root, "remote.git")
	appsDir := filepath.Join(root, "apps")
	appDir := filepath.Join(appsDir, "example")
	runGit(t, root, "init", "--bare", remote)
	runGit(t, root, "clone", remote, appDir)
	runGit(t, appDir, "config", "user.email", "test@example.com")
	runGit(t, appDir, "config", "user.name", "Test")
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	runGit(t, appDir, "add", "manifest.json")
	runGit(t, appDir, "commit", "-m", "initial")
	runGit(t, appDir, "push", "-u", "origin", "HEAD")

	publisher := filepath.Join(root, "publisher")
	runGit(t, root, "clone", remote, publisher)
	runGit(t, publisher, "config", "user.email", "test@example.com")
	runGit(t, publisher, "config", "user.name", "Test")
	writeTestFile(t, filepath.Join(publisher, "CHANGELOG.md"), "remote update\n")
	runGit(t, publisher, "add", "CHANGELOG.md")
	runGit(t, publisher, "commit", "-m", "remote update")
	runGit(t, publisher, "push")

	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	waitForInstallation(t, catalog, func(installation AppInstallation) bool { return installation.UpdateAvailable })
	result, err := catalog.UpdateInstallations()
	if err != nil || len(result.Updated) != 1 || len(result.Failed) != 0 {
		t.Fatalf("update result = %#v, err = %v", result, err)
	}
	waitForInstallation(t, catalog, func(installation AppInstallation) bool { return !installation.UpdateAvailable })
}

func TestInstallationsReturnCachedStateDuringRemoteCheck(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	appDir := filepath.Join(appsDir, "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})
	catalog.remoteChecker = func(string) error {
		close(started)
		<-release
		close(finished)
		return errors.New("remote unavailable")
	}
	defer func() { close(release); <-finished }()

	if _, err := catalog.Installations(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("remote check did not start")
	}
	listed := make(chan struct{})
	go func() { _, _ = catalog.List(); close(listed) }()
	select {
	case <-listed:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("catalog list waited for the remote check")
	}
}

func TestAppInstallationEventsNotifyAfterRemoteCheck(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	appDir := filepath.Join(appsDir, "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	release := make(chan struct{})
	catalog.remoteChecker = func(string) error {
		close(started)
		<-release
		return nil
	}
	handler := NewServer(catalog, nil, nil, nil, nil, nil, nil).routes()
	stream, stop := startMediaSSE(t, handler, httptest.NewRequest(http.MethodGet, "/v1/apps/events", nil))
	defer stop()
	initial := readMediaSSE(t, stream)
	if initial.Event != "app.installations.updated" || string(initial.Data) != "{}" {
		t.Fatalf("initial installation SSE event = %#v", initial)
	}
	if _, err := catalog.Installations(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("remote check did not start")
	}
	close(release)
	update := readMediaSSE(t, stream)
	if update.Event != "app.installations.updated" || string(update.Data) != "{}" {
		t.Fatalf("installation SSE update = %#v", update)
	}
}

func TestLocalCatalogRefreshPreservesRemoteCheckCache(t *testing.T) {
	root := t.TempDir()
	appsDir := filepath.Join(root, "apps")
	appDir := filepath.Join(appsDir, "example")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(appDir, "manifest.json"), `{"manifestVersion":1,"id":"example.app","name":"Example","author":"Test","description":"Test App.","version":"1.0.0","type":"project","background":"background.js","ui":{"projectView":"ui/index.html"}}`)
	catalog, err := LoadCatalog(appsDir)
	if err != nil {
		t.Fatal(err)
	}
	catalog.mu.Lock()
	catalog.lastRemoteCheck = time.Now()
	catalog.remoteCheckErrors = map[string]string{appDir: "remote unavailable"}
	catalog.mu.Unlock()

	linkedRoot := filepath.Join(root, "source", "linked")
	if err := os.MkdirAll(linkedRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(linkedRoot, "manifest.json"), `{"manifestVersion":1,"id":"linked.app","name":"Linked","author":"Test","description":"Linked App.","version":"1.0.0","type":"standalone","background":"background.js","ui":{"standaloneView":"ui/index.html"}}`)
	if err := os.Symlink(linkedRoot, filepath.Join(appsDir, "linked")); err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.Installations(); err != nil {
		t.Fatal(err)
	}
	catalog.mu.RLock()
	defer catalog.mu.RUnlock()
	if catalog.lastRemoteCheck.IsZero() || catalog.remoteCheckErrors[appDir] != "remote unavailable" {
		t.Fatalf("local refresh discarded remote cache: checked=%v errors=%#v", catalog.lastRemoteCheck, catalog.remoteCheckErrors)
	}
}

func waitForInstallation(t *testing.T, catalog *Catalog, match func(AppInstallation) bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		installations, err := catalog.Installations()
		if err == nil && len(installations) == 1 && match(installations[0]) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("installation state did not refresh")
}

func runGit(t *testing.T, dir string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", dir}, arguments...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s: %v", arguments, output, err)
	}
}
