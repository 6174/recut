/*
 * [INPUT]: 依赖 GlobalSkillManager 的内嵌 skills/ 目录与临时 data/home 目录
 * [OUTPUT]: 验证全局 Skill 的自动发现、启动同步、陈旧目录清理与 Agent 软链接
 * [POS]: service 全局 Skill 统一分发层的回归测试；不读取真实用户目录或启动真实 daemon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testGlobalSkillManager(t *testing.T) *RecutSkillsManager {
	t.Helper()
	root := t.TempDir()
	manager := NewRecutSkillsManager(filepath.Join(root, "data"))
	manager.homeDir = func() (string, error) { return filepath.Join(root, "home"), nil }
	t.Setenv("XDG_CONFIG_HOME", "")
	return manager
}

func TestGlobalSkillDiscoversEveryEmbeddedSkill(t *testing.T) {
	manager := testGlobalSkillManager(t)
	ids, err := manager.SkillIDs()
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{recutSkillID, designSystemSkillID, "recut-create-app", "recut-directing-shot"} {
		found := false
		for _, id := range ids {
			if id == required {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("discovered skills %v missing %q", ids, required)
		}
	}
	skills, err := manager.Skills()
	if err != nil {
		t.Fatal(err)
	}
	if len(skills) != len(ids) {
		t.Fatalf("Skills returned %d entries for %d ids", len(skills), len(ids))
	}
	for _, skill := range skills {
		if skill.Name == "" {
			t.Fatalf("skill %s has empty name", skill.ID)
		}
	}
}

func TestGlobalSkillSyncsEmbeddedTree(t *testing.T) {
	manager := testGlobalSkillManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"recut/SKILL.md",
		"recut/references/world-onboarding.md",
		"recut-create-app/SKILL.md",
		"recut-design-system/design-systems/minimal/DESIGN.md",
		"recut-directing-shot/SKILL.md",
	} {
		path := filepath.Join(manager.dataDir, "skills", required)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("synced skill tree is missing %s: %v", required, err)
		}
	}
}

func TestGlobalSkillEnsureRemovesStaleSkill(t *testing.T) {
	manager := testGlobalSkillManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(manager.dataDir, "skills", "recut-gone-skill")
	if err := os.MkdirAll(stale, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale skill directory survived Ensure: %v", err)
	}
}

func TestGlobalSkillLinksAllAgents(t *testing.T) {
	manager := testGlobalSkillManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	if err := manager.EnableDefaultTargets(); err != nil {
		t.Fatal(err)
	}
	home, err := manager.homeDir()
	if err != nil {
		t.Fatal(err)
	}
	for _, skillID := range []string{designSystemSkillID, "recut-create-app"} {
		for _, agent := range []string{"agents", "claude", "codex", "opencode"} {
			agentBase := filepath.Join(home, "."+agent)
			if agent == "opencode" {
				agentBase = filepath.Join(home, ".config", agent)
			}
			path := filepath.Join(agentBase, "skills", skillID)
			info, err := os.Lstat(path)
			if err != nil {
				t.Fatalf("link %s/%s missing: %v", skillID, agent, err)
			}
			if info.Mode()&os.ModeSymlink == 0 {
				t.Fatalf("%s is not a symlink", path)
			}
			// 链接指向唯一 source 目录，而非副本。
			resolved, err := filepath.EvalSymlinks(path)
			if err != nil {
				t.Fatal(err)
			}
			sourceResolved, err := filepath.EvalSymlinks(manager.SourceDir(skillID))
			if err != nil {
				t.Fatal(err)
			}
			if resolved != sourceResolved {
				t.Fatalf("%s resolves to %s, want %s", path, resolved, sourceResolved)
			}
		}
	}
}

func TestGlobalSkillFrontmatterParsing(t *testing.T) {
	name, description, _, _ := parseSkillFrontmatter("---\nname: \"demo\"\ndescription: does things\n---\n# body")
	if name != "demo" || description != "does things" {
		t.Fatalf("unexpected frontmatter parse: %q / %q", name, description)
	}
	name, description, _, _ = parseSkillFrontmatter("# no frontmatter")
	if name != "" || description != "" {
		t.Fatalf("expected empty parse result, got %q / %q", name, description)
	}
}

func TestGlobalSkillCreateAppContentMentionsContract(t *testing.T) {
	manager := testGlobalSkillManager(t)
	if err := manager.Ensure(); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(manager.SourceDir("recut-create-app"), "SKILL.md"))
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
