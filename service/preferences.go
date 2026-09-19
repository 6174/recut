/*
 * [INPUT]: 依赖 Store 的 workspace.sqlite workspace_preferences 键值表
 * [OUTPUT]: 对外提供用户语言偏好的持久化读写与 /v1/preferences 的 GET/PUT HTTP 契约
 * [POS]: service 的工作台偏好边界（D7）；偏好以 service 为准，工作台 localStorage 同源兜底，
 * MCP/Agent guide 无请求头时读取这里持久化的语言
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// videoProposalGateKey is the workspace preference key controlling whether video
// generation must land as a user-confirmed asset before it runs.
const videoProposalGateKey = "media-video-proposal-gate"

// LocalePreference reads the persisted language preference, defaulting to zh
// when the user has not chosen one yet.
func (s *Store) LocalePreference() (Locale, error) {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return DefaultLocale, err
	}
	var raw string
	err = db.QueryRow("select value_json from workspace_preferences where key = ?", localePreferenceKey).Scan(&raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DefaultLocale, nil
		}
		return DefaultLocale, err
	}
	value := ""
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return DefaultLocale, fmt.Errorf("read locale preference: %w", err)
	}
	return LocaleFromString(value), nil
}

// SaveLocalePreference persists the user's language choice.
func (s *Store) SaveLocalePreference(locale Locale) error {
	if locale != LocaleZh && locale != LocaleEn {
		return fmt.Errorf("invalid locale %q", locale)
	}
	raw, err := json.Marshal(string(locale))
	if err != nil {
		return err
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return err
	}
	_, err = db.Exec("insert into workspace_preferences (key, value_json, updated_at) values (?, ?, ?) on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at", localePreferenceKey, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

// VideoProposalGate reports whether video generation must first land as a
// user-confirmed asset. Defaults to true (gate on) when unset.
func (s *Store) VideoProposalGate() (bool, error) {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return true, err
	}
	var raw string
	err = db.QueryRow("select value_json from workspace_preferences where key = ?", videoProposalGateKey).Scan(&raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return true, nil
		}
		return true, err
	}
	enabled := true
	if err := json.Unmarshal([]byte(raw), &enabled); err != nil {
		return true, fmt.Errorf("read video proposal gate: %w", err)
	}
	return enabled, nil
}

// SaveVideoProposalGate persists the user's video-generation gate choice.
func (s *Store) SaveVideoProposalGate(enabled bool) error {
	raw, err := json.Marshal(enabled)
	if err != nil {
		return err
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return err
	}
	_, err = db.Exec("insert into workspace_preferences (key, value_json, updated_at) values (?, ?, ?) on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at", videoProposalGateKey, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Server) getPreferences(w http.ResponseWriter, _ *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("workspace storage is unavailable"))
		return
	}
	locale, err := s.store.StoredLocale()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	gate, err := s.store.VideoProposalGate()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"locale": string(locale), "videoProposalGate": gate})
}

func (s *Server) putPreferences(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("workspace storage is unavailable"))
		return
	}
	input := struct {
		Locale            *string `json:"locale"`
		VideoProposalGate *bool   `json:"videoProposalGate"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	if input.Locale == nil && input.VideoProposalGate == nil {
		writeError(w, http.StatusBadRequest, errors.New("at least one preference is required"))
		return
	}
	if input.Locale != nil {
		locale := LocaleFromString(*input.Locale)
		if string(locale) != *input.Locale {
			writeError(w, http.StatusBadRequest, errors.New("locale must be zh or en"))
			return
		}
		if err := s.store.SaveLocalePreference(locale); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	if input.VideoProposalGate != nil {
		if err := s.store.SaveVideoProposalGate(*input.VideoProposalGate); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	locale, err := s.store.StoredLocale()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	gate, err := s.store.VideoProposalGate()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"locale": string(locale), "videoProposalGate": gate})
}
