/*
 * [INPUT]: 依赖 DesignSystemManager 的内嵌目录、临时 data/home/config 目录
 * [OUTPUT]: 验证设计系统 Skill 的启动同步、Agent 软链接与 list/get 目录读取
 * [POS]: service 全局设计系统 Skill 的回归测试；不读取真实用户目录或启动真实 daemon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testDesignSystemManager(t *testing.T) *DesignSystemManager {
	t.Helper()
	root := t.TempDir()
	manager := NewDesignSystemManager(filepath.Join(root, "data"))
	manager.homeDir = func() (string, error) { return filepath.Join(root, "home"), nil }
	manager.config = func() (string, error) { return filepath.Join(root, "config"), nil }
	return manager
}

func TestDesignSystemSkillSyncsEmbeddedTree(t *testing.T) {
	manager := testDesignSystemManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"SKILL.md", "README.md", "design-systems/minimal/DESIGN.md", "design-systems/minimal/tokens.css"} {
		path := filepath.Join(manager.sourceDir(), required)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("synced skill is missing %s: %v", required, err)
		}
	}
}

func TestDesignSystemListAndGet(t *testing.T) {
	manager := testDesignSystemManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	systems, err := manager.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(systems) < 2 {
		t.Fatalf("expected several design systems, got %d", len(systems))
	}
	found := false
	for _, s := range systems {
		if s.ID == "neobrutalism" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("design system list did not include neobrutalism")
	}
	got, err := manager.Read("neobrutalism")
	if err != nil {
		t.Fatal(err)
	}
	if design, ok := got["design"].(string); !ok || !strings.Contains(design, "Neobrutalism") {
		t.Fatalf("unexpected DESIGN.md content: %#v", got["design"])
	}
	if tokens, ok := got["tokens"].(string); !ok || !strings.Contains(tokens, "--bg") {
		t.Fatalf("unexpected tokens.css content: %#v", got["tokens"])
	}
}

func TestDesignSystemGetRejectsUnknown(t *testing.T) {
	manager := testDesignSystemManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Read("no-such-system"); err == nil {
		t.Fatal("Read accepted an unknown design system")
	}
}
