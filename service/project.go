/*
 * [INPUT]: 依赖 Catalog 的 App 身份、SQLite 驱动与标准库文件系统能力
 * [OUTPUT]: 对外提供 Store、Project、Artifact 和 App 隔离数据库/文件 capability
 * [POS]: service 的平台存储边界；App 仅通过 capability 获得自己的数据库和文件根
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const formatVersion = 2

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

type Artifact struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	ProjectID   string    `json:"projectId"`
	ProducerApp string    `json:"producerApp"`
	ContentHash string    `json:"contentHash"`
	CreatedAt   time.Time `json:"createdAt"`
	Value       any       `json:"value"`
}

type Store struct {
	root    string
	catalog *Catalog
}

func NewStore(root string, apps *Catalog) *Store { return &Store{root: root, catalog: apps} }
func (s *Store) Ensure() error                   { return os.MkdirAll(s.projectsDir(), 0o755) }

func (s *Store) Create(input CreateInput) (Project, error) {
	if strings.TrimSpace(input.Name) == "" {
		return Project{}, fmt.Errorf("project name is required")
	}
	app, ok := s.catalog.Get(input.AppID)
	if !ok {
		return Project{}, fmt.Errorf("unknown app %q", input.AppID)
	}
	if app.Manifest.Kind != ProjectApp {
		return Project{}, fmt.Errorf("app %q is standalone and cannot create a project", input.AppID)
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
	if err := s.initialize(temporary, project); err != nil {
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
	projects := []Project{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if project, err := s.Get(entry.Name()); err == nil {
			projects = append(projects, project)
		}
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].CreatedAt.After(projects[j].CreatedAt) })
	return projects, nil
}

func (s *Store) Get(id string) (Project, error) {
	project := Project{}
	return project, readProjectJSON(filepath.Join(s.projectDir(id), "recut.json"), &project)
}

func (s *Store) AppDatabase(projectID, appID string) (*sql.DB, error) {
	if err := s.checkAppScope(projectID, appID); err != nil {
		return nil, err
	}
	path := s.appDatabasePath(projectID, appID)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	return db, db.Ping()
}

func (s *Store) ProjectDatabase(projectID string) (*sql.DB, error) {
	if _, err := s.Get(projectID); err != nil {
		return nil, err
	}
	path := filepath.Join(s.projectDir(projectID), "project.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`create table if not exists artifacts (id text primary key, type text not null, producer_app text not null, content_hash text not null, created_at text not null, value_json text not null); create table if not exists events (id integer primary key autoincrement, payload_json text not null, created_at text not null)`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func (s *Store) AppFilesRoot(projectID, appID string) (string, error) {
	if err := s.checkAppScope(projectID, appID); err != nil {
		return "", err
	}
	root := filepath.Join(s.projectDir(projectID), "apps", appID, "files")
	return root, os.MkdirAll(root, 0o755)
}

func (s *Store) PublishArtifact(projectID, appID, artifactType string, value any) (Artifact, error) {
	if err := s.checkAppScope(projectID, appID); err != nil {
		return Artifact{}, err
	}
	if strings.TrimSpace(artifactType) == "" {
		return Artifact{}, fmt.Errorf("artifact type is required")
	}
	content, err := json.Marshal(value)
	if err != nil {
		return Artifact{}, err
	}
	id, err := newID()
	if err != nil {
		return Artifact{}, err
	}
	hash := sha256.Sum256(content)
	artifact := Artifact{ID: id, Type: artifactType, ProjectID: projectID, ProducerApp: appID, ContentHash: hex.EncodeToString(hash[:]), CreatedAt: time.Now().UTC(), Value: value}
	db, err := s.ProjectDatabase(projectID)
	if err != nil {
		return Artifact{}, err
	}
	defer db.Close()
	valueJSON, err := json.Marshal(value)
	if err != nil {
		return Artifact{}, err
	}
	if _, err := db.Exec("insert into artifacts (id, type, producer_app, content_hash, created_at, value_json) values (?, ?, ?, ?, ?, ?)", artifact.ID, artifact.Type, artifact.ProducerApp, artifact.ContentHash, artifact.CreatedAt.Format(time.RFC3339Nano), string(valueJSON)); err != nil {
		return Artifact{}, err
	}
	return artifact, nil
}

func (s *Store) ListArtifacts(projectID string) ([]Artifact, error) {
	if _, err := s.Get(projectID); err != nil {
		return nil, err
	}
	db, err := s.ProjectDatabase(projectID)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query("select id, type, producer_app, content_hash, created_at, value_json from artifacts order by created_at desc")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	artifacts := []Artifact{}
	for rows.Next() {
		artifact := Artifact{ProjectID: projectID}
		var createdAt, valueJSON string
		if err := rows.Scan(&artifact.ID, &artifact.Type, &artifact.ProducerApp, &artifact.ContentHash, &createdAt, &valueJSON); err != nil {
			return nil, err
		}
		if artifact.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(valueJSON), &artifact.Value); err != nil {
			return nil, err
		}
		artifacts = append(artifacts, artifact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return artifacts, nil
}

func (s *Store) AppendEvent(projectID string, event any) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	db, err := s.ProjectDatabase(projectID)
	if err != nil {
		return
	}
	defer db.Close()
	_, _ = db.Exec("insert into events (payload_json, created_at) values (?, ?)", string(data), time.Now().UTC().Format(time.RFC3339Nano))
}

func (s *Store) checkAppScope(projectID, appID string) error {
	project, err := s.Get(projectID)
	if err != nil {
		return err
	}
	if project.AppID != appID {
		return fmt.Errorf("app %q is not attached to project", appID)
	}
	app, ok := s.catalog.Get(appID)
	if !ok || app.Manifest.Kind != ProjectApp {
		return fmt.Errorf("project app is unavailable")
	}
	return nil
}

func (s *Store) initialize(root string, project Project) error {
	for _, path := range []string{"files", "sessions", "snapshots", "logs", filepath.Join("apps", project.AppID)} {
		if err := os.MkdirAll(filepath.Join(root, path), 0o755); err != nil {
			return err
		}
	}
	if err := writeProjectJSON(filepath.Join(root, "recut.json"), project); err != nil {
		return err
	}
	return nil
}

func (s *Store) projectsDir() string         { return filepath.Join(s.root, "projects") }
func (s *Store) projectDir(id string) string { return filepath.Join(s.projectsDir(), id) }
func (s *Store) appDatabasePath(projectID, appID string) string {
	return filepath.Join(s.projectDir(projectID), "apps", appID, "storage.sqlite")
}
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
