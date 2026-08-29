/*
 * [INPUT]: 依赖 RecutSkillManager 的安装路径、daemon-owned Device Token 与各 Agent 的全局配置格式
 * [OUTPUT]: 对外提供各 Agent 的 Recut MCP 注册、非破坏性配置检测与原子配置写入
 * [POS]: service 的 Skill-to-MCP 连接层；Codex 使用兼容旧桌面端的 stdio 适配器，Claude Code/OpenCode 直接共享常驻 daemon 的 Streamable HTTP
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

const globalMCPEndpoint = defaultMCPTarget + "/v1/mcp"

func (m *RecutSkillsManager) mcpCommand() string {
	name := "recut-service"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if executable, err := m.execPath(); err == nil && filepath.Base(executable) == name {
		return executable
	}
	return filepath.Join(m.dataDir, "bin", name)
}

func (m *RecutSkillsManager) mcpStatus(skillID, targetID string) string {
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
		if strings.Contains(string(body), "[mcp_servers.recut]") && strings.Contains(string(body), "command = \"") {
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
	if server, ok := servers[skillID].(map[string]any); ok && server["url"] == globalMCPEndpoint {
		return recutMCPConfigured
	}
	return recutMCPNotConfigured
}

func (m *RecutSkillsManager) configureMCP(skillID, targetID string) error {
	if !m.mcpEnabled(skillID) {
		return nil
	}
	path, format, err := m.mcpConfig(targetID)
	if err != nil {
		return nil
	}
	secret, err := m.globalMCPToken()
	if err != nil {
		return err
	}
	if format == "toml" {
		return m.configureCodexMCP(path, secret)
	}
	return m.configureJSONMCP(skillID, targetID, path, secret)
}

// configureMCPFor returns the per-target MCP registration callback for one
// skill, suitable for linkSkillTargets.
func (m *RecutSkillsManager) configureMCPFor(skillID string) func(string) error {
	return func(targetID string) error { return m.configureMCP(skillID, targetID) }
}

func (m *RecutSkillsManager) globalMCPToken() (string, error) {
	apps, err := LoadCatalog(filepath.Join(m.dataDir, "apps"))
	if err != nil {
		return "", err
	}
	store := NewStore(m.dataDir, apps)
	if err := store.Ensure(); err != nil {
		return "", err
	}
	return store.EnsureGlobalMCPToken()
}

func (m *RecutSkillsManager) mcpConfig(targetID string) (path, format string, err error) {
	home, homeErr := m.homeDir()
	if homeErr != nil {
		return "", "", homeErr
	}
	switch targetID {
	case "codex":
		return filepath.Join(home, ".codex", "config.toml"), "toml", nil
	case "claude":
		return filepath.Join(home, ".claude.json"), "json", nil
	case "opencode":
		return filepath.Join(openCodeConfigDir(home), "opencode", "opencode.jsonc"), "json", nil
	default:
		return "", "", errors.New("Agent does not expose a supported global MCP configuration")
	}
}

func (m *RecutSkillsManager) configureCodexMCP(path, secret string) error {
	body, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		body = nil
	} else if err != nil {
		return fmt.Errorf("read Codex configuration: %w", err)
	}
	text := string(body)
	if strings.Contains(text, "mcp_servers =") {
		return errors.New("Codex uses an inline mcp_servers configuration; add Recut MCP manually to avoid overwriting it")
	}
	text = removeManagedCodexMCP(text)
	block := fmt.Sprintf("\n# Recut-managed MCP: stdio adapter for Codex Desktop compatibility.\n[mcp_servers.recut]\ncommand = %q\nargs = [\"--mcp\", \"--mcp-target\", %q]\nenv = { RECUT_MCP_TOKEN = %q }\n", m.mcpCommand(), defaultMCPTarget, secret)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create Codex configuration directory: %w", err)
	}
	return writeRecutConfigFile(path, []byte(strings.TrimRight(text, "\n")+block))
}

func removeManagedCodexMCP(text string) string {
	table := strings.Index(text, "[mcp_servers.recut]")
	if table < 0 {
		return text
	}
	start := table
	if marker := strings.LastIndex(text[:table], "# Recut-managed MCP:"); marker >= 0 && strings.TrimSpace(text[marker:table]) != "" {
		start = marker
	}
	end := len(text)
	if next := strings.Index(text[table+len("[mcp_servers.recut]"):], "\n["); next >= 0 {
		end = table + len("[mcp_servers.recut]") + next
	}
	return strings.TrimRight(text[:start]+text[end:], "\n")
}

func (m *RecutSkillsManager) configureJSONMCP(skillID, targetID, path, secret string) error {
	config, err := readRecutJSONConfig(path)
	if errors.Is(err, os.ErrNotExist) {
		config = map[string]any{}
	} else if err != nil {
		return fmt.Errorf("read %s configuration: %w", targetID, err)
	}
	key := "mcpServers"
	server := map[string]any{"type": "http", "url": globalMCPEndpoint, "headers": map[string]string{"Authorization": "Bearer " + secret}}
	if targetID == "opencode" {
		key = "mcp"
		server = map[string]any{"type": "remote", "url": globalMCPEndpoint, "headers": map[string]string{"Authorization": "Bearer " + secret}}
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
	if existing, exists := values[skillID].(map[string]any); exists && !isRecutManagedMCP(targetID, existing) {
		return fmt.Errorf("%s already has a user-managed Recut MCP; Recut will not overwrite it", targetID)
	}
	values[skillID] = server
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create %s configuration directory: %w", targetID, err)
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s configuration: %w", targetID, err)
	}
	return writeRecutConfigFile(path, append(data, '\n'))
}

func isRecutManagedMCP(targetID string, server map[string]any) bool {
	if server["url"] == globalMCPEndpoint {
		return true
	}
	if targetID == "opencode" {
		return server["type"] == "local"
	}
	_, hasCommand := server["command"]
	return hasCommand
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
