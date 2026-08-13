/*
 * [INPUT]: 依赖编译内嵌的 Recut Skill 正文（OutputFormat: url 第三方变体）、data-dir 与当前用户的 Agent 配置目录
 * [OUTPUT]: 对外提供 Recut Skill 的启动同步、跨 Agent 安全软链接、状态查询，以及任意全局/App Skill 的通用链接能力与 HTTP 请求模型；SKILL.md 是独立文本（OutputFormat: url 第三方约定），与 core-agents.md.tmpl（OutputFormat: xml 内建约定）不是同一来源，靠测试不变量保持平台规则一致
 * [POS]: service 的平台 Skill 分发边界；唯一正文写入 `~/.recut/skills/recut`，外部 Agent 只能链接它而不持有副本
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const recutSkillID = "recut"

// platformSkillAppID is the virtual owner of platform-level skills (recut,
// recut-design-system) in the settings catalog, mirroring the appId declared in
// their SKILL.md frontmatter.
const platformSkillAppID = "recut.platform"

//go:embed skills/recut/SKILL.md
var recutSkillBody []byte

type RecutSkillTarget struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Path   string `json:"path"`
	Status string `json:"status"`
	MCP    string `json:"mcp"`
}

type RecutSkillStatus struct {
	ID      string             `json:"id"`
	Version string             `json:"version"`
	Source  string             `json:"source"`
	Targets []RecutSkillTarget `json:"targets"`
}

type recutSkillLinksRequest struct {
	Targets []string `json:"targets"`
}

// RecutSkillManager keeps one daemon-owned source directory. The source is
// atomically replaced at every process start, so a verified service update can
// never leave Agent-specific copies of an older skill behind.
type RecutSkillManager struct {
	dataDir  string
	homeDir  func() (string, error)
	config   func() (string, error)
	execPath func() (string, error)
}

func NewRecutSkillManager(dataDir string) *RecutSkillManager {
	return &RecutSkillManager{dataDir: dataDir, homeDir: os.UserHomeDir, config: os.UserConfigDir, execPath: os.Executable}
}

func (m *RecutSkillManager) sourceDir() string {
	return filepath.Join(m.dataDir, "skills", recutSkillID)
}
func (m *RecutSkillManager) sourcePath() string { return filepath.Join(m.sourceDir(), "SKILL.md") }

func (m *RecutSkillManager) Ensure() error {
	directory := m.sourceDir()
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create Recut Skill directory: %w", err)
	}
	return writeRecutSkillFile(m.sourcePath(), recutSkillBody)
}

// EnableDefaultTargets installs the platform Skill at every supported global
// Agent location during daemon startup. A user-owned conflicting target is
// reported but never blocks the remaining targets or the service itself.
func (m *RecutSkillManager) EnableDefaultTargets() error {
	targets, err := m.targets()
	if err != nil {
		return err
	}
	failures := []error{}
	for _, target := range targets {
		status := recutSkillLinkStatus(target.Path, m.sourceDir())
		if status != "available" && status != "broken" && status != "linked" {
			failures = append(failures, fmt.Errorf("%s: target already contains another skill", target.Name))
			continue
		}
		if err := linkSkillPath(target.Path, m.sourceDir()); err != nil {
			failures = append(failures, fmt.Errorf("link %s: %w", target.Name, err))
			continue
		}
		if err := m.configureMCP(target.ID); err != nil {
			failures = append(failures, fmt.Errorf("configure %s MCP: %w", target.Name, err))
		}
	}
	return errors.Join(failures...)
}

func writeRecutSkillFile(path string, body []byte) error {
	if existing, err := os.ReadFile(path); err == nil && string(existing) == string(body) {
		return nil
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read existing Recut Skill: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".recut-skill-")
	if err != nil {
		return fmt.Errorf("stage Recut Skill: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o644); err != nil {
		temporary.Close()
		return fmt.Errorf("set Recut Skill permissions: %w", err)
	}
	if _, err := temporary.Write(body); err != nil {
		temporary.Close()
		return fmt.Errorf("write Recut Skill: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Recut Skill: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("activate Recut Skill: %w", err)
	}
	return nil
}

func (m *RecutSkillManager) targets() ([]RecutSkillTarget, error) {
	return m.skillTargets(recutSkillID)
}

// skillTargets returns the Agent link targets shared by every skill: the
// target directory name is the skill ID, so global and App skills can be
// linked without hardcoding a single skill.
func (m *RecutSkillManager) skillTargets(skillID string) ([]RecutSkillTarget, error) {
	home, err := m.homeDir()
	if err != nil {
		return nil, fmt.Errorf("locate user home directory: %w", err)
	}
	return []RecutSkillTarget{
		{ID: "agents", Name: "通用 Agent", Path: filepath.Join(home, ".agents", "skills", skillID)},
		{ID: "claude", Name: "Claude Code", Path: filepath.Join(home, ".claude", "skills", skillID)},
		{ID: "codex", Name: "Codex", Path: filepath.Join(home, ".codex", "skills", skillID)},
		{ID: "opencode", Name: "OpenCode", Path: filepath.Join(m.openCodeConfigDir(home), "opencode", "skills", skillID)},
	}, nil
}

// OpenCode follows the XDG directory convention even on macOS. Go's
// os.UserConfigDir resolves to Library/Application Support there, which the
// OpenCode CLI does not inspect.
func (m *RecutSkillManager) openCodeConfigDir(home string) string {
	if configured := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); configured != "" {
		return configured
	}
	return filepath.Join(home, ".config")
}

// skillStatus reports each Agent target's link status against an arbitrary
// skill source directory. Only the platform Recut Skill configures MCP; App
// skills are linked as files and keep MCP "not-applicable".
func (m *RecutSkillManager) skillStatus(sourceDir, skillID string) ([]RecutSkillTarget, error) {
	targets, err := m.skillTargets(skillID)
	if err != nil {
		return nil, err
	}
	for index := range targets {
		targets[index].Status = recutSkillLinkStatus(targets[index].Path, sourceDir)
		if skillID == recutSkillID {
			targets[index].MCP = m.mcpStatus(targets[index].ID)
		} else {
			targets[index].MCP = recutMCPNotApplicable
		}
	}
	return targets, nil
}

func (m *RecutSkillManager) Status() (RecutSkillStatus, error) {
	targets, err := m.skillStatus(m.sourceDir(), recutSkillID)
	if err != nil {
		return RecutSkillStatus{}, err
	}
	return RecutSkillStatus{ID: recutSkillID, Version: ServiceVersion(), Source: m.sourceDir(), Targets: targets}, nil
}

func recutSkillLinkStatus(path, source string) string {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return "available"
	}
	if err != nil {
		return "unavailable"
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return "conflict"
	}
	linked, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "broken"
	}
	if sameFile(linked, source) {
		return "linked"
	}
	return "conflict"
}

func sameFile(left, right string) bool {
	leftInfo, leftErr := os.Stat(left)
	rightInfo, rightErr := os.Stat(right)
	return leftErr == nil && rightErr == nil && os.SameFile(leftInfo, rightInfo)
}

func (m *RecutSkillManager) Link(targetIDs []string) (RecutSkillStatus, error) {
	if err := m.Ensure(); err != nil {
		return RecutSkillStatus{}, err
	}
	targets, err := m.skillTargets(recutSkillID)
	if err != nil {
		return RecutSkillStatus{}, err
	}
	if err := linkSkillTargets(targets, m.sourceDir(), recutSkillID, targetIDs, m.configureMCP); err != nil {
		return RecutSkillStatus{}, err
	}
	return m.Status()
}

// LinkSkill links an arbitrary skill (global or App-owned) into the requested
// Agent directories, mirroring the platform Recut Skill flow without touching
// MCP configuration: App skills are discovered through the Recut MCP already.
func (m *RecutSkillManager) LinkSkill(sourceDir, skillID string, targetIDs []string) ([]RecutSkillTarget, error) {
	targets, err := m.skillTargets(skillID)
	if err != nil {
		return nil, err
	}
	if err := linkSkillTargets(targets, sourceDir, skillID, targetIDs, nil); err != nil {
		return nil, err
	}
	return m.skillStatus(sourceDir, skillID)
}

// linkSkillTargets validates and creates the requested Agent links for a skill
// located at sourceDir. configureMCP is only invoked for the platform Recut
// Skill; nil keeps App skills file-only.
func linkSkillTargets(targets []RecutSkillTarget, sourceDir, skillID string, targetIDs []string, configureMCP func(string) error) error {
	requested := map[string]bool{}
	for _, id := range targetIDs {
		requested[id] = true
	}
	if len(requested) == 0 {
		for _, target := range targets {
			requested[target.ID] = true
		}
	}
	known := map[string]bool{}
	for _, target := range targets {
		known[target.ID] = true
	}
	for id := range requested {
		if !known[id] {
			return fmt.Errorf("unknown skill %q target %q", skillID, id)
		}
	}
	for _, target := range targets {
		if !requested[target.ID] {
			continue
		}
		status := recutSkillLinkStatus(target.Path, sourceDir)
		if status != "available" && status != "broken" && status != "linked" {
			return fmt.Errorf("link %s: target already contains another skill; Recut will not overwrite it", target.Name)
		}
	}
	for _, target := range targets {
		if requested[target.ID] && configureMCP != nil {
			if err := configureMCP(target.ID); err != nil {
				return fmt.Errorf("configure %s MCP: %w", target.Name, err)
			}
		}
	}
	for _, target := range targets {
		if !requested[target.ID] {
			continue
		}
		if err := linkSkillPath(target.Path, sourceDir); err != nil {
			return fmt.Errorf("link %s: %w", target.Name, err)
		}
	}
	return nil
}

func linkSkillPath(target, source string) error {
	switch recutSkillLinkStatus(target, source) {
	case "linked":
		return nil
	case "available", "broken":
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("create Agent Skill directory: %w", err)
		}
		if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove broken skill link: %w", err)
		}
		if err := os.Symlink(source, target); err != nil {
			return fmt.Errorf("create skill link: %w", err)
		}
		return nil
	default:
		return errors.New("target already contains another skill; Recut will not overwrite it")
	}
}
