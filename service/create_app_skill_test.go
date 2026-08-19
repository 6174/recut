/*
 * [INPUT]: 依赖 CreateAppSkillManager 的内嵌目录与临时 data/home/config 目录
 * [OUTPUT]: 验证 recut-create-app Skill 的启动同步与 Agent 软链接
 * [POS]: service 全局「创建 App」Skill 的回归测试；不读取真实用户目录或启动真实 daemon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testCreateAppManager(t *testing.T) *CreateAppSkillManager {
	t.Helper()
	root := t.TempDir()
	manager := NewCreateAppSkillManager(filepath.Join(root, "data"))
	manager.homeDir = func() (string, error) { return filepath.Join(root, "home"), nil }
	manager.config = func() (string, error) { return filepath.Join(root, "config"), nil }
	return manager
}

func TestCreateAppSkillSyncsEmbeddedTree(t *testing.T) {
	manager := testCreateAppManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"SKILL.md", "README.md"} {
		path := filepath.Join(manager.sourceDir(), required)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("synced skill is missing %s: %v", required, err)
		}
	}
}

func TestCreateAppSkillLinksAllAgents(t *testing.T) {
	manager := testCreateAppManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	if err := manager.EnableDefaultTargets(); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"agents", "claude", "codex", "opencode"} {
		path, err := manager.targetPath(target)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatalf("link %s missing: %v", target, err)
		}
		if info.Mode()&os.ModeSymlink == 0 {
			t.Fatalf("%s is not a symlink", path)
		}
		// 链接指向唯一 source 目录，而非副本。
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			t.Fatal(err)
		}
		sourceResolved, err := filepath.EvalSymlinks(manager.sourceDir())
		if err != nil {
			t.Fatal(err)
		}
		if resolved != sourceResolved {
			t.Fatalf("%s resolves to %s, want %s", path, resolved, sourceResolved)
		}
	}
}

func TestCreateAppSkillContentMentionsContract(t *testing.T) {
	manager := testCreateAppManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(manager.sourceDir(), "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, want := range []string{"manifest.json", "recut.operation.register", "ctx.project.callUI", "rpc.reply", "recut.job.wait"} {
		if !strings.Contains(text, want) {
			t.Fatalf("SKILL.md missing key content %q", want)
		}
	}
}
