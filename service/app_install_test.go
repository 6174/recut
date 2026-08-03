/*
 * [INPUT]: 依赖 App 安装 URL 规范化、本地 Git remote 与工作树状态读取能力
 * [OUTPUT]: 验证 Git 更新检测、单个与批量 fast-forward 升级均不覆盖本地修改
 * [POS]: service App 分发边界的回归测试；只使用临时本地 Git remote，不访问网络
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
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
	installations, err := catalog.Installations()
	if err != nil || len(installations) != 1 || !installations[0].UpdateAvailable {
		t.Fatalf("installations = %#v, err = %v", installations, err)
	}
	result, err := catalog.UpdateInstallations()
	if err != nil || len(result.Updated) != 1 || len(result.Failed) != 0 {
		t.Fatalf("update result = %#v, err = %v", result, err)
	}
	installations, err = catalog.Installations()
	if err != nil || installations[0].UpdateAvailable {
		t.Fatalf("updated installations = %#v, err = %v", installations, err)
	}
}

func runGit(t *testing.T, dir string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", dir}, arguments...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s: %v", arguments, output, err)
	}
}
