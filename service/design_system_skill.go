/*
 * [INPUT]: 依赖编译内嵌的 recut-design-system skill 目录、data-dir 与 Agent 配置目录
 * [OUTPUT]: 对外提供全局设计系统 Skill 的启动同步（~/.recut/skills/recut-design-system）、
 *           跨 Agent 安全软链接，以及 MCP 工具 recut.design_system.list / recut.design_system.get
 * [POS]: service 的全局设计系统分发层；design-system 是业务无关的抽象视觉风格参考，
 *        直接复用 Open Design（nexu-io/open-design）的包格式与内容，不做视频适配
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const designSystemSkillID = "recut-design-system"

//go:embed all:skills/recut-design-system
var designSystemSkillFS embed.FS

type DesignSystemSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Origin      string `json:"origin"`
	Description string `json:"description"`
}

// DesignSystemManager keeps the daemon-owned global design-system skill.
// It mirrors RecutSkillManager's sync/link flow but for a whole directory.
type DesignSystemManager struct {
	dataDir  string
	homeDir  func() (string, error)
	config   func() (string, error)
	execPath func() (string, error)
}

func NewDesignSystemManager(dataDir string) *DesignSystemManager {
	return &DesignSystemManager{dataDir: dataDir, homeDir: os.UserHomeDir, config: os.UserConfigDir, execPath: os.Executable}
}

func (m *DesignSystemManager) sourceDir() string {
	return filepath.Join(m.dataDir, "skills", designSystemSkillID)
}

// Ensure syncs the embedded skill tree to ~/.recut/skills/recut-design-system atomically.
func (m *DesignSystemManager) Ensure() error {
	directory := m.sourceDir()
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create design-system skill directory: %w", err)
	}
	entries, err := fs.ReadDir(designSystemSkillFS, "skills/recut-design-system")
	if err != nil {
		return fmt.Errorf("read embedded design-system skill: %w", err)
	}
	for _, entry := range entries {
		src := "skills/recut-design-system/" + entry.Name()
		dst := filepath.Join(directory, entry.Name())
		if entry.IsDir() {
			if err := syncDesignSystemDir(src, dst); err != nil {
				return err
			}
			continue
		}
		body, readErr := fs.ReadFile(designSystemSkillFS, src)
		if readErr != nil {
			return fmt.Errorf("read embedded %s: %w", src, readErr)
		}
		if writeErr := writeRecutSkillFile(dst, body); writeErr != nil {
			return writeErr
		}
	}
	return nil
}

func syncDesignSystemDir(src, dst string) error {
	entries, err := fs.ReadDir(designSystemSkillFS, src)
	if err != nil {
		return fmt.Errorf("read embedded %s: %w", src, err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dst, err)
	}
	for _, entry := range entries {
		childSrc := src + "/" + entry.Name()
		childDst := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := syncDesignSystemDir(childSrc, childDst); err != nil {
				return err
			}
			continue
		}
		body, readErr := fs.ReadFile(designSystemSkillFS, childSrc)
		if readErr != nil {
			return fmt.Errorf("read embedded %s: %w", childSrc, readErr)
		}
		if writeErr := writeRecutSkillFile(childDst, body); writeErr != nil {
			return writeErr
		}
	}
	return nil
}

func (m *DesignSystemManager) targetPath(targetID string) (string, error) {
	home, err := m.homeDir()
	if err != nil {
		return "", fmt.Errorf("locate user home directory: %w", err)
	}
	configDir, configErr := m.config()
	if configErr != nil || strings.TrimSpace(configDir) == "" {
		configDir = filepath.Join(home, ".config")
	}
	switch targetID {
	case "agents":
		return filepath.Join(home, ".agents", "skills", designSystemSkillID), nil
	case "claude":
		return filepath.Join(home, ".claude", "skills", designSystemSkillID), nil
	case "codex":
		return filepath.Join(home, ".codex", "skills", designSystemSkillID), nil
	case "opencode":
		return filepath.Join(configDir, "opencode", "skills", designSystemSkillID), nil
	default:
		return "", fmt.Errorf("unknown Agent target %q", targetID)
	}
}

// EnableDefaultTargets links the global design-system skill into every supported Agent.
func (m *DesignSystemManager) EnableDefaultTargets() error {
	targets := []string{"agents", "claude", "codex", "opencode"}
	failures := []error{}
	for _, target := range targets {
		path, err := m.targetPath(target)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		if err := m.linkTarget(path); err != nil {
			failures = append(failures, fmt.Errorf("link %s: %w", target, err))
		}
	}
	return errors.Join(failures...)
}

func (m *DesignSystemManager) linkTarget(target string) error {
	switch recutSkillLinkStatus(target, m.sourceDir()) {
	case "linked":
		return nil
	case "available", "broken":
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("create Agent Skill directory: %w", err)
		}
		if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove broken design-system skill link: %w", err)
		}
		if err := os.Symlink(m.sourceDir(), target); err != nil {
			return fmt.Errorf("create design-system skill link: %w", err)
		}
		return nil
	default:
		return errors.New("target already contains another skill; Recut will not overwrite it")
	}
}

// List returns every design system found under the synced skill directory.
func (m *DesignSystemManager) List() ([]DesignSystemSummary, error) {
	root := filepath.Join(m.sourceDir(), "design-systems")
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("list design systems: %w", err)
	}
	result := make([]DesignSystemSummary, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		summary := DesignSystemSummary{ID: entry.Name(), Name: entry.Name(), Origin: "open-design"}
		// 包已裁剪为最小契约集：元数据从 DESIGN.md 的 H1 标题推导（无 manifest）。
		if body, readErr := os.ReadFile(filepath.Join(root, entry.Name(), "DESIGN.md")); readErr == nil {
			text := string(body)
			for _, line := range strings.Split(text, "\n") {
				if strings.HasPrefix(line, "# ") {
					summary.Name = strings.TrimSpace(strings.TrimPrefix(line, "# "))
					break
				}
			}
		}
		result = append(result, summary)
	}
	return result, nil
}

// Read returns the DESIGN.md + tokens.css + tailwind-v4.css for one design system.
func (m *DesignSystemManager) Read(styleID string) (map[string]any, error) {
	if strings.TrimSpace(styleID) == "" {
		return nil, errors.New("styleId is required")
	}
	root := filepath.Join(m.sourceDir(), "design-systems")
	dir := filepath.Join(root, filepath.Base(styleID))
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("design system %q is unavailable", styleID)
	}
	result := map[string]any{"id": styleID}
	for name, key := range map[string]string{
		"DESIGN.md":     "design",
		"tokens.css":    "tokens",
		"tailwind-v4.css": "tailwind",
	} {
		if body, readErr := os.ReadFile(filepath.Join(dir, name)); readErr == nil {
			result[key] = string(body)
		}
	}
	return result, nil
}

func designSystemListTool(manager *DesignSystemManager) (any, error) {
	systems, err := manager.List()
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(systems)
	return map[string]any{
		"content":          []map[string]string{{"type": "text", "text": string(data)}},
		"structuredContent": structuredMCPContent(map[string]any{"designSystems": systems}),
	}, nil
}

func designSystemGetTool(manager *DesignSystemManager, arguments map[string]any) (any, error) {
	styleID, _ := arguments["styleId"].(string)
	system, err := manager.Read(styleID)
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(system)
	return map[string]any{
		"content":          []map[string]string{{"type": "text", "text": string(data)}},
		"structuredContent": structuredMCPContent(system),
	}, nil
}
