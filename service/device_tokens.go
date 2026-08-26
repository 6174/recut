/*
 * [INPUT]: 依赖 Store 的 workspace SQLite 与 token 哈希
 * [OUTPUT]: 对外提供机器级设备 token 的创建、鉴权与吊销；供外部 Agent（Codex/Claude Code/OpenCode）经 POST /v1/mcp 使用 Recut 能力
 * [POS]: service 的外部 Agent 身份边界；token 以哈希持久化、带 scope 与过期/吊销状态，仅用于 loopback MCP HTTP 入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type DeviceToken struct {
	ID        string     `json:"id"`
	Scope     []string   `json:"scope"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	Revoked   bool       `json:"revoked"`
}

type globalMCPTokenFile struct {
	Secret string `json:"secret"`
}

// EnsureGlobalMCPToken returns the daemon-owned credential used by global
// Codex's stdio adapter and Claude Code/OpenCode Streamable HTTP connections. The database
// keeps only the hash; the local config file is 0600 and lets startup recover
// the reusable secret without ever putting it in a command line.
func (s *Store) EnsureGlobalMCPToken() (string, error) {
	path := filepath.Join(s.root, "config", "global-mcp-token.json")
	file := globalMCPTokenFile{}
	if body, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(body, &file); err != nil {
			return "", fmt.Errorf("read global MCP token: %w", err)
		}
		if _, err := s.AuthenticateDeviceToken(file.Secret); err == nil {
			return file.Secret, nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("read global MCP token: %w", err)
	}
	token, secret, err := s.CreateDeviceToken(nil, 0)
	if err != nil {
		return "", err
	}
	_ = token
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", fmt.Errorf("create MCP token directory: %w", err)
	}
	if err := writePrivateJSON(path, globalMCPTokenFile{Secret: secret}); err != nil {
		return "", fmt.Errorf("store global MCP token: %w", err)
	}
	return secret, nil
}

func writePrivateJSON(path string, value any) error {
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".recut-token-")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(body, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

// CreateDeviceToken persists a machine token and returns the one-time bearer
// secret. The secret is never stored; only its hash is.
func (s *Store) CreateDeviceToken(scope []string, ttl time.Duration) (DeviceToken, string, error) {
	id, err := newID()
	if err != nil {
		return DeviceToken{}, "", err
	}
	secret, err := newID()
	if err != nil {
		return DeviceToken{}, "", err
	}
	now := time.Now().UTC()
	var expires *time.Time
	if ttl != 0 {
		value := now.Add(ttl)
		expires = &value
	}
	token := DeviceToken{ID: id, Scope: scope, CreatedAt: now, ExpiresAt: expires}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return DeviceToken{}, "", err
	}
	scopeJSON, _ := json.Marshal(scope)
	expiresRaw := sql.NullString{}
	if expires != nil {
		expiresRaw = sql.NullString{String: iso(*expires), Valid: true}
	}
	if _, err := db.Exec("insert into device_tokens (id, token_hash, scope_json, created_at, expires_at, revoked) values (?, ?, ?, ?, ?, 0)", token.ID, hashToken(secret), string(scopeJSON), iso(now), expiresRaw); err != nil {
		return DeviceToken{}, "", err
	}
	return token, secret, nil
}

// AuthenticateDeviceToken validates a bearer secret against the persisted hash,
// its expiry and revocation state.
func (s *Store) AuthenticateDeviceToken(secret string) (*DeviceToken, error) {
	if secret == "" {
		return nil, errors.New("device token is required")
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	row := db.QueryRow("select id, scope_json, created_at, coalesce(expires_at, ''), revoked from device_tokens where token_hash = ?", hashToken(secret))
	var token DeviceToken
	var scopeJSON, created, expires string
	var revoked int
	if err := row.Scan(&token.ID, &scopeJSON, &created, &expires, &revoked); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("unknown device token")
		}
		return nil, err
	}
	if revoked != 0 {
		return nil, errors.New("device token is revoked")
	}
	if expires != "" {
		parsed, parseErr := time.Parse(time.RFC3339Nano, expires)
		if parseErr != nil {
			return nil, parseErr
		}
		if time.Now().UTC().After(parsed) {
			return nil, errors.New("device token has expired")
		}
		token.ExpiresAt = &parsed
	}
	if err := json.Unmarshal([]byte(scopeJSON), &token.Scope); err != nil {
		return nil, err
	}
	if token.CreatedAt, err = time.Parse(time.RFC3339Nano, created); err != nil {
		return nil, err
	}
	return &token, nil
}

func (s *Store) RevokeDeviceToken(id string) error {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return err
	}
	result, err := db.Exec("update device_tokens set revoked = 1 where id = ?", id)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return errors.New("device token not found")
	}
	return nil
}

func (s *Store) ListDeviceTokens() ([]DeviceToken, error) {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, scope_json, created_at, coalesce(expires_at, ''), revoked from device_tokens order by created_at desc")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []DeviceToken{}
	for rows.Next() {
		var token DeviceToken
		var scopeJSON, created, expires string
		var revoked int
		if err := rows.Scan(&token.ID, &scopeJSON, &created, &expires, &revoked); err != nil {
			return nil, err
		}
		token.Revoked = revoked != 0
		if expires != "" {
			parsed, parseErr := time.Parse(time.RFC3339Nano, expires)
			if parseErr != nil {
				return nil, parseErr
			}
			token.ExpiresAt = &parsed
		}
		_ = json.Unmarshal([]byte(scopeJSON), &token.Scope)
		if token.CreatedAt, err = time.Parse(time.RFC3339Nano, created); err != nil {
			return nil, err
		}
		result = append(result, token)
	}
	return result, rows.Err()
}
