/*
 * [INPUT]: 依赖本目录 Catalog 的已校验 App 格式和标准库文件系统能力
 * [OUTPUT]: 对外提供 Store、Project、CreateInput 及本地项目持久化操作
 * [POS]: service 的唯一项目写入边界，保障平台核心和 App 私有状态分层
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const formatVersion = 1

type Project struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	AppID         string    `json:"appId"`
	AppVersion    string    `json:"appVersion"`
	FormatVersion int       `json:"formatVersion"`
	CreatedAt     time.Time `json:"createdAt"`
}

type CreateInput struct {
	Name  string `json:"name"`
	AppID string `json:"appId"`
}

type Store struct {
	root    string
	catalog *Catalog
}

func NewStore(root string, apps *Catalog) *Store {
	return &Store{root: root, catalog: apps}
}

func (s *Store) Ensure() error {
	return os.MkdirAll(s.projectsDir(), 0o755)
}

func (s *Store) Create(input CreateInput) (Project, error) {
	if strings.TrimSpace(input.Name) == "" {
		return Project{}, fmt.Errorf("project name is required")
	}
	app, ok := s.catalog.Get(input.AppID)
	if !ok {
		return Project{}, fmt.Errorf("unknown app %q", input.AppID)
	}
	id, err := newID()
	if err != nil {
		return Project{}, err
	}
	project := Project{ID: id, Name: input.Name, AppID: app.Manifest.ID, AppVersion: app.Manifest.Version, FormatVersion: formatVersion, CreatedAt: time.Now().UTC()}
	temporary, err := os.MkdirTemp(s.projectsDir(), ".new-")
	if err != nil {
		return Project{}, err
	}
	defer os.RemoveAll(temporary)
	if err := s.initialize(temporary, project, app); err != nil {
		return Project{}, err
	}
	if err := os.Rename(temporary, s.projectDir(id)); err != nil {
		return Project{}, err
	}
	return project, nil
}

func (s *Store) List() ([]Project, error) {
	entries, err := os.ReadDir(s.projectsDir())
	if err != nil {
		return nil, err
	}
	projects := make([]Project, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		project, err := s.Get(entry.Name())
		if err == nil {
			projects = append(projects, project)
		}
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].CreatedAt.After(projects[j].CreatedAt) })
	return projects, nil
}

func (s *Store) Get(id string) (Project, error) {
	project := Project{}
	err := readProjectJSON(filepath.Join(s.projectDir(id), "recut.json"), &project)
	return project, err
}

func (s *Store) ReadAppSourceState(projectID, path string) (any, error) {
	project, err := s.Get(projectID)
	if err != nil {
		return nil, err
	}
	app, ok := s.catalog.Get(project.AppID)
	if !ok {
		return nil, fmt.Errorf("project app is unavailable")
	}
	for _, file := range app.Layout.Files {
		if file.Kind == "source" && file.Path == path {
			var value any
			err := readProjectJSON(filepath.Join(s.projectDir(projectID), "apps", project.AppID, path), &value)
			return value, err
		}
	}
	return nil, fmt.Errorf("state path is not a declared source state")
}

func (s *Store) initialize(root string, project Project, app App) error {
	paths := []string{"core", "assets", "sessions", "state", "snapshots", "logs", filepath.Join("apps", app.Manifest.ID, "data"), filepath.Join("apps", app.Manifest.ID, "derived")}
	for _, path := range paths {
		if err := os.MkdirAll(filepath.Join(root, path), 0o755); err != nil {
			return err
		}
	}
	if err := writeProjectJSON(filepath.Join(root, "recut.json"), project); err != nil {
		return err
	}
	for _, file := range []string{"assets.json", "exports.json"} {
		if err := writeProjectJSON(filepath.Join(root, "core", file), []any{}); err != nil {
			return err
		}
	}
	if err := os.WriteFile(filepath.Join(root, "state", "events.jsonl"), nil, 0o644); err != nil {
		return err
	}
	appState := map[string]any{"appId": app.Manifest.ID, "layoutVersion": app.Layout.Version}
	if err := writeProjectJSON(filepath.Join(root, "apps", app.Manifest.ID, "app.json"), appState); err != nil {
		return err
	}
	for _, file := range app.Layout.Files {
		path := filepath.Join(root, "apps", app.Manifest.ID, file.Path)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if file.Kind == "source" {
			if err := writeProjectJSON(path, map[string]any{}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) projectsDir() string         { return filepath.Join(s.root, "projects") }
func (s *Store) projectDir(id string) string { return filepath.Join(s.projectsDir(), id) }
func (s *Store) terminalSessionsDir(id string) string {
	return filepath.Join(s.projectDir(id), "sessions", "terminals")
}
func (s *Store) workspaceTerminalSessionsDir() string {
	return filepath.Join(s.root, "sessions", "terminals")
}

func newID() (string, error) {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func writeProjectJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

func readProjectJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}
