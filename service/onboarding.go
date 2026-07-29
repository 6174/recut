/*
 * [INPUT]: 依赖 Catalog 的 App manifest、Store 的用户级 workspace SQLite
 * [OUTPUT]: 对外提供 App、全局与平台兜底三层 Agent 对话引导及其持久化配置
 * [POS]: service 的新对话引导真相源；只返回显式 prompt，绝不从标题或说明猜测用户意图
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const globalOnboardingPreference = "agent-onboarding"

type OnboardingGuide struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
}

var platformOnboarding = []OnboardingGuide{
	{ID: "platform-start", Title: "告诉我你的目标", Description: "从想做什么开始，我会把下一步拆清楚。", Prompt: "我想开始一个新项目，但还不确定第一步。请先问我最关键的几个问题，再给出清晰、可执行的下一步。"},
	{ID: "platform-plan", Title: "一起规划", Description: "把一个模糊想法变成有顺序的行动。", Prompt: "请帮我把这个想法拆成最小可执行步骤。先确认目标、素材和交付物，再一次只引导我完成下一步。"},
}

func validateOnboarding(items []OnboardingGuide) error {
	if len(items) > 12 {
		return errors.New("at most 12 onboarding guides are allowed")
	}
	ids := map[string]bool{}
	for _, item := range items {
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Prompt) == "" {
			return errors.New("every onboarding guide requires id, title, and prompt")
		}
		if ids[item.ID] {
			return fmt.Errorf("duplicate onboarding id %q", item.ID)
		}
		ids[item.ID] = true
	}
	return nil
}

func (s *Store) GlobalOnboarding() ([]OnboardingGuide, error) {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	var raw string
	err = db.QueryRow("select value_json from workspace_preferences where key = ?", globalOnboardingPreference).Scan(&raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return []OnboardingGuide{}, nil
		}
		return nil, err
	}
	items := []OnboardingGuide{}
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, fmt.Errorf("read global onboarding: %w", err)
	}
	return items, nil
}

func (s *Store) SaveGlobalOnboarding(items []OnboardingGuide) error {
	if err := validateOnboarding(items); err != nil {
		return err
	}
	raw, err := json.Marshal(items)
	if err != nil {
		return err
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec("insert into workspace_preferences (key, value_json, updated_at) values (?, ?, ?) on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at", globalOnboardingPreference, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Store) Onboarding(projectID string) ([]OnboardingGuide, error) {
	project, err := s.Get(projectID)
	if err != nil {
		return nil, err
	}
	app, ok := s.catalog.Get(project.AppID)
	if !ok {
		return nil, fmt.Errorf("app %q is unavailable", project.AppID)
	}
	global, err := s.GlobalOnboarding()
	if err != nil {
		return nil, err
	}
	items := append(append([]OnboardingGuide{}, app.Manifest.Onboarding...), global...)
	if len(items) == 0 {
		return append([]OnboardingGuide{}, platformOnboarding...), nil
	}
	return items, nil
}
