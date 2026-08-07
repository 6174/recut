/*
 * [INPUT]: 依赖 RecutSkillManager 的安装路径、Codex TOML 与 Claude Code/OpenCode JSON 全局配置格式
 * [OUTPUT]: 对外提供各 Agent 的 Recut MCP 注册、非破坏性配置检测与原子 JSON 配置写入
 * [POS]: service 的 Skill-to-MCP 连接层；Skill 被发现后即可拥有 Recut 工具，不依赖用户手动复制 MCP 命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	recutMCPConfigured    = "configured"
	recutMCPNotConfigured = "not-configured"
	recutMCPNotApplicable = "not-applicable"
	recutMCPUnavailable   = "unavailable"
)

func (m *RecutSkillManager) mcpCommand() string {
	name := "recut-service"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if executable, err := m.execPath(); err == nil && filepath.Base(executable) == name {
		return executable
	}
	return filepath.Join(m.dataDir, "bin", name)
}

func (m *RecutSkillManager) mcpStatus(targetID string) string {
	path, format, err := m.mcpConfig(targetID)
	if err != nil {
		return recutMCPNotApplicable
	}
	if format == "toml" {
		body, readErr := os.ReadFile(path)
		if errors.Is(readErr, os.ErrNotExist) {
			return recutMCPNotConfigured
		}
		if readErr != nil {
			return recutMCPUnavailable
		}
		if strings.Contains(string(body), "[mcp_servers.recut]") {
			return recutMCPConfigured
		}
		return recutMCPNotConfigured
	}
	config, readErr := readRecutJSONConfig(path)
	if errors.Is(readErr, os.ErrNotExist) {
		return recutMCPNotConfigured
	}
	if readErr != nil {
		return recutMCPUnavailable
	}
	key := "mcpServers"
	if targetID == "opencode" {
		key = "mcp"
	}
	servers, ok := config[key].(map[string]any)
	if !ok {
		return recutMCPNotConfigured
	}
	if _, ok := servers[recutSkillID]; ok {
		return recutMCPConfigured
	}
	return recutMCPNotConfigured
}

func (m *RecutSkillManager) configureMCP(targetID string) error {
	path, format, err := m.mcpConfig(targetID)
	if err != nil {
		return nil
	}
	if format == "toml" {
		return m.configureCodexMCP(path)
	}
	return m.configureJSONMCP(targetID, path)
}

func (m *RecutSkillManager) mcpConfig(targetID string) (path, format string, err error) {
	home, homeErr := m.homeDir()
	if homeErr != nil {
		return "", "", homeErr
	}
	configDir, configErr := m.config()
	if configErr != nil || strings.TrimSpace(configDir) == "" {
		configDir = filepath.Join(home, ".config")
	}
	switch targetID {
	case "codex":
		return filepath.Join(home, ".codex", "config.toml"), "toml", nil
	case "claude":
		return filepath.Join(home, ".claude.json"), "json", nil
	case "opencode":
		return filepath.Join(configDir, "opencode", "opencode.json"), "json", nil
	default:
		return "", "", errors.New("Agent does not expose a supported global MCP configuration")
	}
}

func (m *RecutSkillManager) configureCodexMCP(path string) error {
	body, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		body = nil
	} else if err != nil {
		return fmt.Errorf("read Codex configuration: %w", err)
	}
	text := string(body)
	if strings.Contains(text, "[mcp_servers.recut]") {
		return nil
	}
	if strings.Contains(text, "mcp_servers =") {
		return errors.New("Codex uses an inline mcp_servers configuration; add Recut MCP manually to avoid overwriting it")
	}
	block := fmt.Sprintf("\n# Recut-managed MCP: keep this block so the Recut Skill can use local tools.\n[mcp_servers.recut]\ncommand = %q\nargs = [\"--mcp\", \"--mcp-target\", %q]\n", m.mcpCommand(), defaultMCPTarget)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create Codex configuration directory: %w", err)
	}
	return writeRecutConfigFile(path, []byte(strings.TrimRight(text, "\n")+block))
}

func (m *RecutSkillManager) configureJSONMCP(targetID, path string) error {
	config, err := readRecutJSONConfig(path)
	if errors.Is(err, os.ErrNotExist) {
		config = map[string]any{}
	} else if err != nil {
		return fmt.Errorf("read %s configuration: %w", targetID, err)
	}
	key := "mcpServers"
	server := map[string]any{"command": m.mcpCommand(), "args": []string{"--mcp", "--mcp-target", defaultMCPTarget}}
	if targetID == "opencode" {
		key = "mcp"
		server = map[string]any{"type": "local", "command": []string{m.mcpCommand(), "--mcp", "--mcp-target", defaultMCPTarget}, "enabled": true, "timeout": opencodeMCPTimeoutMilliseconds}
	}
	servers, exists := config[key]
	if !exists {
		servers = map[string]any{}
		config[key] = servers
	}
	values, ok := servers.(map[string]any)
	if !ok {
		return fmt.Errorf("%s configuration has a non-object %s field", targetID, key)
	}
	if _, exists := values[recutSkillID]; exists {
		return nil
	}
	values[recutSkillID] = server
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create %s configuration directory: %w", targetID, err)
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s configuration: %w", targetID, err)
	}
	return writeRecutConfigFile(path, append(data, '\n'))
}

func readRecutJSONConfig(path string) (map[string]any, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	config := map[string]any{}
	if err := json.Unmarshal(body, &config); err != nil {
		return nil, err
	}
	return config, nil
}

func writeRecutConfigFile(path string, body []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".recut-mcp-")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(body); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}
