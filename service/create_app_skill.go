/*
 * [INPUT]: 依赖编译内嵌的 recut-create-app skill 目录、data-dir 与 Agent 配置目录
 * [OUTPUT]: 对外提供全局「创建 App」Skill 的启动同步（~/.recut/skills/recut-create-app）
 *           与跨 Agent 安全软链接（agents/claude/codex/opencode），供任何 App 创作会话复用
 * [POS]: service 的全局 App 创作参考分发层；recut-create-app 是业务无关的平台骨架与通讯契约
 *        参考（manifest + background + iframe + Op 总线/异步 Handle/RPC），不做业务领域适配
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

const createAppSkillID = "recut-create-app"

//go:embed all:skills/recut-create-app
var createAppSkillFS embed.FS

// CreateAppSkillManager keeps the daemon-owned global App-authoring skill.
// It mirrors DesignSystemManager's sync/link flow for a whole directory.
type CreateAppSkillManager struct {
	dataDir  string
	homeDir  func() (string, error)
	config   func() (string, error)
	execPath func() (string, error)
}

func NewCreateAppSkillManager(dataDir string) *CreateAppSkillManager {
	return &CreateAppSkillManager{dataDir: dataDir, homeDir: os.UserHomeDir, config: os.UserConfigDir, execPath: os.Executable}
}

func (m *CreateAppSkillManager) sourceDir() string {
	return filepath.Join(m.dataDir, "skills", createAppSkillID)
}

// Ensure syncs the embedded skill tree to ~/.recut/skills/recut-create-app atomically.
func (m *CreateAppSkillManager) Ensure() error {
	directory := m.sourceDir()
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create create-app skill directory: %w", err)
	}
	return syncCreateAppDir("skills/recut-create-app", directory)
}

func syncCreateAppDir(src, dst string) error {
	entries, err := fs.ReadDir(createAppSkillFS, src)
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
			if err := syncCreateAppDir(childSrc, childDst); err != nil {
				return err
			}
			continue
		}
		body, readErr := fs.ReadFile(createAppSkillFS, childSrc)
		if readErr != nil {
			return fmt.Errorf("read embedded %s: %w", childSrc, readErr)
		}
		if writeErr := writeRecutSkillFile(childDst, body); writeErr != nil {
			return writeErr
		}
	}
	return nil
}

func (m *CreateAppSkillManager) targetPath(targetID string) (string, error) {
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
		return filepath.Join(home, ".agents", "skills", createAppSkillID), nil
	case "claude":
		return filepath.Join(home, ".claude", "skills", createAppSkillID), nil
	case "codex":
		return filepath.Join(home, ".codex", "skills", createAppSkillID), nil
	case "opencode":
		return filepath.Join(configDir, "opencode", "skills", createAppSkillID), nil
	default:
		return "", fmt.Errorf("unknown Agent target %q", targetID)
	}
}

// EnableDefaultTargets links the global create-app skill into every supported Agent.
func (m *CreateAppSkillManager) EnableDefaultTargets() error {
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

func (m *CreateAppSkillManager) linkTarget(target string) error {
	switch recutSkillLinkStatus(target, m.sourceDir()) {
	case "linked":
		return nil
	case "available", "broken":
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("create Agent Skill directory: %w", err)
		}
		if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove broken create-app skill link: %w", err)
		}
		if err := os.Symlink(m.sourceDir(), target); err != nil {
			return fmt.Errorf("create create-app skill link: %w", err)
		}
		return nil
	default:
		return errors.New("target already contains another skill; Recut will not overwrite it")
	}
}
