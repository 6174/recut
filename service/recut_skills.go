/*
 * [INPUT]: 依赖编译内嵌的整个 skills/ 目录（每个子目录含 SKILL.md 即为一个平台 Recut Skill）、data-dir 与 Agent 配置目录
 * [OUTPUT]: 对外提供 Recut Skill 的自动发现（SkillIDs/Skills 元数据解析）、启动原子同步（~/.recut/skills/<id>）、
 *           跨 Agent 安全软链接（agents/claude/codex/opencode）、MCP 注册（SKILL.md frontmatter 声明 `mcp:` 的 Skill）
 *           与按 Skill 的状态查询/手动链接；新平台 Skill 只需放入 service/skills/<id>/SKILL.md 即生效
 * [POS]: service 的平台 Skill 分发统一层（recut_skills）；同步、软链接与 MCP 注册共用同一份来源目录与
 *        不覆盖保护，frontmatter 是「哪个 Skill 拥有 MCP」的唯一声明处
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed all:skills
var recutSkillsFS embed.FS

//go:embed skills/recut/SKILL.md
var recutSkillBody []byte

//go:embed skills/recut/references/world-onboarding.md
var recutSkillWorldOnboarding []byte

// platformSkillAppID is the virtual owner of platform-level skills in the
// settings catalog, mirroring the appId declared in their SKILL.md frontmatter.
const platformSkillAppID = "recut.platform"

// recutSkillID is the primary platform skill that carries the Recut MCP
// onboarding body and the platform workflow entry point.
const recutSkillID = "recut"

// designSystemSkillID is the platform skill carrying the global design-system
// packages; it has no dedicated domain code — Agents read its files through
// the generic recut.skills.read / recut.skills.reference tools.
const designSystemSkillID = "recut-design-system"

// RecutSkillTarget is one Agent link target of a skill.
type RecutSkillTarget struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Path   string `json:"path"`
	Status string `json:"status"`
	MCP    string `json:"mcp"`
}

// RecutSkillStatus is one skill's full install status.
type RecutSkillStatus struct {
	ID      string             `json:"id"`
	Version string             `json:"version"`
	Source  string             `json:"source"`
	Targets []RecutSkillTarget `json:"targets"`
}

type recutSkillLinksRequest struct {
	Targets []string `json:"targets"`
}

// recutSkillsRoot is the embedded tree root; every immediate subdirectory that
// contains a SKILL.md is one platform Recut Skill.
const recutSkillsRoot = "skills"

// RecutSkillInfo is one auto-discovered platform skill's display metadata,
// parsed from the skill's SKILL.md frontmatter.
type RecutSkillInfo struct {
	ID          string
	Name        string
	Description string
	MCP         bool
}

// RecutSkillsManager owns the embedded platform skill tree. It syncs every
// discovered skill into <data-dir>/skills/<id>, links them into every
// supported Agent directory and registers MCP for the skills whose SKILL.md
// frontmatter declares it, so adding a skill to service/skills requires no Go
// code changes.
type RecutSkillsManager struct {
	dataDir  string
	homeDir  func() (string, error)
	execPath func() (string, error)
}

func NewRecutSkillsManager(dataDir string) *RecutSkillsManager {
	return &RecutSkillsManager{dataDir: dataDir, homeDir: os.UserHomeDir, execPath: os.Executable}
}

// SkillIDs returns every embedded skill directory containing a SKILL.md,
// sorted by fs.ReadDir order (lexical).
func (m *RecutSkillsManager) SkillIDs() ([]string, error) {
	entries, err := fs.ReadDir(recutSkillsFS, recutSkillsRoot)
	if err != nil {
		return nil, fmt.Errorf("read embedded skills tree: %w", err)
	}
	ids := []string{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if _, statErr := fs.Stat(recutSkillsFS, recutSkillsRoot+"/"+entry.Name()+"/SKILL.md"); statErr != nil {
			continue
		}
		ids = append(ids, entry.Name())
	}
	return ids, nil
}

// Skills returns display metadata for every discovered skill, parsed from each
// SKILL.md frontmatter (name/description fields plus the mcp flag).
func (m *RecutSkillsManager) Skills() ([]RecutSkillInfo, error) {
	ids, err := m.SkillIDs()
	if err != nil {
		return nil, err
	}
	skills := make([]RecutSkillInfo, 0, len(ids))
	for _, id := range ids {
		skill := RecutSkillInfo{ID: id, Name: id}
		if body, readErr := fs.ReadFile(recutSkillsFS, recutSkillsRoot+"/"+id+"/SKILL.md"); readErr == nil {
			name, description, _, _ := parseSkillFrontmatter(string(body))
			if name != "" {
				skill.Name = name
			}
			skill.Description = description
			skill.MCP = strings.TrimSpace(skillFrontmatterValue(string(body), "mcp")) != ""
		}
		skills = append(skills, skill)
	}
	return skills, nil
}

// skillFrontmatterValue returns the raw value of one frontmatter key, or an
// empty string when the key is absent.
func skillFrontmatterValue(body, key string) string {
	lines := strings.Split(strings.TrimPrefix(body, "\ufeff"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return ""
	}
	for _, line := range lines[1:] {
		trimmed := strings.TrimSpace(line)
		if trimmed == "---" {
			break
		}
		if value, ok := strings.CutPrefix(trimmed, key+":"); ok {
			return strings.TrimSpace(strings.Trim(value, `"'`))
		}
	}
	return ""
}

// SourceDir returns the daemon-owned synced directory for one skill.
func (m *RecutSkillsManager) SourceDir(skillID string) string {
	return filepath.Join(m.dataDir, "skills", filepath.Base(skillID))
}

func (m *RecutSkillsManager) sourceDir() string { return m.SourceDir(recutSkillID) }
func (m *RecutSkillsManager) sourcePath() string {
	return filepath.Join(m.sourceDir(), "SKILL.md")
}

// Ensure syncs every embedded skill tree into <data-dir>/skills/<id> and
// removes synced directories whose skill no longer exists in the embedded
// tree, so renames and removals converge on every daemon start.
func (m *RecutSkillsManager) Ensure() error {
	ids, err := m.SkillIDs()
	if err != nil {
		return err
	}
	known := map[string]bool{}
	for _, id := range ids {
		known[id] = true
		if err := m.syncSkill(id); err != nil {
			return err
		}
	}
	entries, err := os.ReadDir(filepath.Join(m.dataDir, "skills"))
	if err != nil {
		return fmt.Errorf("read synced skills tree: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() || known[entry.Name()] {
			continue
		}
		if err := os.RemoveAll(filepath.Join(m.dataDir, "skills", entry.Name())); err != nil {
			return fmt.Errorf("remove stale skill %s: %w", entry.Name(), err)
		}
	}
	return nil
}

func (m *RecutSkillsManager) syncSkill(skillID string) error {
	destination := m.SourceDir(skillID)
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return fmt.Errorf("create %s skill directory: %w", skillID, err)
	}
	return syncEmbeddedDir(recutSkillsFS, recutSkillsRoot+"/"+skillID, destination)
}

// syncEmbeddedDir recursively mirrors one embedded directory to disk, using
// writeRecutSkillFile's content-addressed atomic writes so unchanged files are
// never rewritten.
func syncEmbeddedDir(source fs.FS, src, dst string) error {
	entries, err := fs.ReadDir(source, src)
	if err != nil {
		return fmt.Errorf("read embedded %s: %w", src, err)
	}
	for _, entry := range entries {
		childSrc := src + "/" + entry.Name()
		childDst := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(childDst, 0o755); err != nil {
				return fmt.Errorf("create %s: %w", childDst, err)
			}
			if err := syncEmbeddedDir(source, childSrc, childDst); err != nil {
				return err
			}
			continue
		}
		body, readErr := fs.ReadFile(source, childSrc)
		if readErr != nil {
			return fmt.Errorf("read embedded %s: %w", childSrc, readErr)
		}
		if writeErr := writeRecutSkillFile(childDst, body); writeErr != nil {
			return writeErr
		}
	}
	return nil
}

// EnableDefaultTargets links every platform skill into every supported Agent
// directory during daemon startup, registering MCP for the skills whose
// SKILL.md frontmatter declares it. A user-owned conflicting target is
// reported but never blocks the remaining targets or the service itself.
func (m *RecutSkillsManager) EnableDefaultTargets() error {
	ids, err := m.SkillIDs()
	if err != nil {
		return err
	}
	failures := []error{}
	for _, id := range ids {
		targets, err := m.skillTargets(id)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		mcp := m.mcpEnabled(id)
		for _, target := range targets {
			status := recutSkillLinkStatus(target.Path, m.SourceDir(id))
			if status != "available" && status != "broken" && status != "linked" {
				failures = append(failures, fmt.Errorf("%s: target already contains another skill", target.Name))
				continue
			}
			if err := linkSkillPath(target.Path, m.SourceDir(id)); err != nil {
				failures = append(failures, fmt.Errorf("%s: link %s: %w", id, target.Name, err))
				continue
			}
			if mcp {
				if err := m.configureMCP(id, target.ID); err != nil {
					failures = append(failures, fmt.Errorf("%s: configure %s MCP: %w", id, target.Name, err))
				}
			}
		}
	}
	return errors.Join(failures...)
}

func (m *RecutSkillsManager) targets() ([]RecutSkillTarget, error) {
	return m.skillTargets(recutSkillID)
}

func (m *RecutSkillsManager) skillTargets(skillID string) ([]RecutSkillTarget, error) {
	return agentSkillTargets(m.homeDir, skillID)
}

// mcpEnabled reports whether a skill's SKILL.md frontmatter declares MCP
// registration; the frontmatter is the single source of truth.
func (m *RecutSkillsManager) mcpEnabled(skillID string) bool {
	body, err := fs.ReadFile(recutSkillsFS, recutSkillsRoot+"/"+skillID+"/SKILL.md")
	if err != nil {
		return false
	}
	return strings.TrimSpace(skillFrontmatterValue(string(body), "mcp")) != ""
}

// skillStatus reports each Agent target's link status for one skill. Only
// MCP-enabled skills carry an MCP registration status; every other skill is
// linked as files and keeps MCP "not-applicable".
func (m *RecutSkillsManager) skillStatus(sourceDir, skillID string) ([]RecutSkillTarget, error) {
	targets, err := m.skillTargets(skillID)
	if err != nil {
		return nil, err
	}
	for index := range targets {
		targets[index].Status = recutSkillLinkStatus(targets[index].Path, sourceDir)
		if m.mcpEnabled(skillID) {
			targets[index].MCP = m.mcpStatus(skillID, targets[index].ID)
		} else {
			targets[index].MCP = recutMCPNotApplicable
		}
	}
	return targets, nil
}

// SkillStatus returns the full status of one platform skill.
func (m *RecutSkillsManager) SkillStatus(skillID string) (RecutSkillStatus, error) {
	targets, err := m.skillStatus(m.SourceDir(skillID), skillID)
	if err != nil {
		return RecutSkillStatus{}, err
	}
	return RecutSkillStatus{ID: skillID, Version: ServiceVersion(), Source: m.SourceDir(skillID), Targets: targets}, nil
}

// Status returns the platform Recut Skill status.
func (m *RecutSkillsManager) Status() (RecutSkillStatus, error) {
	return m.SkillStatus(recutSkillID)
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

// Link explicitly enables the platform Recut Skill for the requested Agent
// targets, including its MCP registration.
func (m *RecutSkillsManager) Link(targetIDs []string) (RecutSkillStatus, error) {
	if err := m.Ensure(); err != nil {
		return RecutSkillStatus{}, err
	}
	targets, err := m.targets()
	if err != nil {
		return RecutSkillStatus{}, err
	}
	if err := linkSkillTargets(targets, m.sourceDir(), recutSkillID, targetIDs, m.configureMCPFor(recutSkillID)); err != nil {
		return RecutSkillStatus{}, err
	}
	return m.Status()
}

// LinkSkill links an arbitrary skill (platform or App-owned) into the
// requested Agent directories. MCP registration is never touched: MCP-enabled
// platform skills are registered once at daemon startup, and App skills are
// discovered through the Recut MCP already.
func (m *RecutSkillsManager) LinkSkill(sourceDir, skillID string, targetIDs []string) ([]RecutSkillTarget, error) {
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
// located at sourceDir. configureMCP is only invoked for MCP-enabled skills;
// nil keeps App skills file-only.
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
		if err := createSkillLink(source, target); err != nil {
			return fmt.Errorf("create skill link: %w", err)
		}
		return nil
	default:
		return errors.New("target already contains another skill; Recut will not overwrite it")
	}
}

// agentSkillTargets returns the Agent link targets shared by every skill: the
// target directory name is the skill ID.
// OpenCode follows the XDG directory convention even on macOS, where Go's
// os.UserConfigDir resolves to Library/Application Support, which the OpenCode
// CLI does not inspect.
func agentSkillTargets(homeDir func() (string, error), skillID string) ([]RecutSkillTarget, error) {
	home, err := homeDir()
	if err != nil {
		return nil, fmt.Errorf("locate user home directory: %w", err)
	}
	config := openCodeConfigDir(home)
	return []RecutSkillTarget{
		{ID: "agents", Name: "通用 Agent", Path: filepath.Join(home, ".agents", "skills", skillID)},
		{ID: "claude", Name: "Claude Code", Path: filepath.Join(home, ".claude", "skills", skillID)},
		{ID: "codex", Name: "Codex", Path: filepath.Join(home, ".codex", "skills", skillID)},
		{ID: "opencode", Name: "OpenCode", Path: filepath.Join(config, "opencode", "skills", skillID)},
	}, nil
}

// openCodeConfigDir resolves the OpenCode base config directory.
func openCodeConfigDir(home string) string {
	if configured := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); configured != "" {
		return configured
	}
	return filepath.Join(home, ".config")
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
