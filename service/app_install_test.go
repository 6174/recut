/*
 * [INPUT]: 依赖 App 安装 URL 规范化与 Git 工作树状态读取能力
 * [OUTPUT]: 验证只接受确定的 GitHub 地址，并且本地修改会阻止安全升级
 * [POS]: service App 分发边界的回归测试；不访问网络、不执行真实 clone
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

func TestBuiltInAppSkipsGitManagement(t *testing.T) {
	root := t.TempDir()
	if output, err := exec.Command("git", "-C", root, "init").CombinedOutput(); err != nil {
		t.Fatalf("initialize Git checkout: %s: %v", output, err)
	}
	app := App{Manifest: Manifest{ID: mediaSystemAppID, Name: "素材库", Version: "1.0.0"}, Root: root}
	installation := inspectAppInstallation(app)
	if !installation.BuiltIn || installation.Manageable || installation.Dirty || installation.Repository != "" || installation.Status != "系统自带 App" {
		t.Fatalf("installation = %#v", installation)
	}
	catalog := &Catalog{apps: map[string]App{app.Manifest.ID: app}, dir: filepath.Dir(root)}
	if _, err := catalog.UpdateInstallation(filepath.Base(root)); err == nil || err.Error() != "system App is built into Recut and cannot be upgraded through Git" {
		t.Fatalf("update built-in App error = %v", err)
	}
}
