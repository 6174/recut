/*
 * [INPUT]: 依赖 Catalog 的 App 身份、SQLite 驱动与标准库文件系统能力
 * [OUTPUT]: 对外提供 Store、可重命名/删除且含可选媒体封面的 Project、Artifact、App 全局状态与项目 Doc 的隔离能力、
 * 平台唯一 workspace SQLite、无迁移的布局版本门禁与项目/Agent/媒体三类 durable 事件表的进程内唤醒广播
 * [POS]: service 的平台存储边界；平台表全部位于 workspace.sqlite，project.sqlite 只含 owner App 业务表，
 * appstate/<appId> 是 App 的全局状态；App 仅通过 capability 获得自己的数据库和文件根
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const formatVersion = 3
const layoutVersionKey = "layout_version"
const currentLayoutVersion = "3"
const workspaceBusyTimeoutMilliseconds = 15000
const sqlitePoolMaxOpenConnections = 8
const databaseHealthCheckTimeout = 100 * time.Millisecond

type Project struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	AppID         string        `json:"appId"`
	AppVersion    string        `json:"appVersion"`
	FormatVersion int           `json:"formatVersion"`
	Cover         *ProjectCover `json:"cover,omitempty"`
	CreatedAt     time.Time     `json:"createdAt"`
}

// ProjectCover is platform metadata. Apps select the media Asset; the
// workspace owns its display, storage, and fallback behavior.
type ProjectCover struct {
	AssetID string `json:"assetId"`
	Kind    string `json:"kind"`
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
	root           string
	catalog        *Catalog
	agentCommands  *AgentCommandResolver
	workspaceMu    sync.RWMutex
	workspaceReady bool
	databasesMu    sync.RWMutex
	databases      map[string]*sql.DB
	projectEvents  *changeHub
	agentEvents    *changeHub
	mediaEvents    *changeHub
}

func NewStore(root string, apps *Catalog) *Store {
	return &Store{
		root:          root,
		catalog:       apps,
		agentCommands: newAgentCommandResolver(root),
		databases:     map[string]*sql.DB{},
		projectEvents: newChangeHub(),
		agentEvents:   newChangeHub(),
		mediaEvents:   newChangeHub(),
	}
}

// Ensure applies the layout version gate and materializes the platform directory
// skeleton. There is no historical data migration: an incompatible prior layout
// is renamed aside and a fresh data directory is initialized.
func (s *Store) Ensure() error {
	if err := os.MkdirAll(s.root, 0o700); err != nil {
		return err
	}
	legacy, err := s.detectLegacyLayout()
	if err != nil {
		return err
	}
	if legacy {
		backup := s.root + ".legacy-" + time.Now().UTC().Format("20060102-150405")
		if err := os.Rename(s.root, backup); err != nil {
			return fmt.Errorf("move legacy data directory: %w", err)
		}
		if err := os.MkdirAll(s.root, 0o700); err != nil {
			return err
		}
		log.Printf("WARN legacy Recut data moved to %s; starting a fresh data directory", backup)
	}
	for _, dir := range []string{"projects", "appstate", "sessions"} {
		if err := os.MkdirAll(filepath.Join(s.root, dir), 0o755); err != nil {
			return err
		}
	}
	if _, err := s.WorkspaceDatabase(); err != nil {
		return err
	}
	return nil
}

func (s *Store) detectLegacyLayout() (bool, error) {
	entries, err := os.ReadDir(s.projectsDir())
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			if _, err := os.Stat(filepath.Join(s.projectDir(entry.Name()), "recut.json")); err == nil {
				return true, nil
			}
		}
	}
	return false, nil
}

func (s *Store) Create(input CreateInput) (Project, error) {
	if strings.TrimSpace(input.Name) == "" {
		return Project{}, fmt.Errorf("project name is required")
	}
	app, ok := s.catalog.Get(input.AppID)
	if !ok {
		return Project{}, fmt.Errorf("unknown app %q", input.AppID)
	}
	if isSystemAppID(input.AppID) {
		return Project{}, errors.New("system apps cannot create user projects")
	}
	if app.Manifest.Kind != ProjectApp {
		return Project{}, fmt.Errorf("app %q is standalone and cannot create a project", input.AppID)
	}
	id, err := newID()
	if err != nil {
		return Project{}, err
	}
	now := time.Now().UTC()
	project := Project{ID: id, Name: input.Name, AppID: app.Manifest.ID, AppVersion: app.Manifest.Version, FormatVersion: formatVersion, CreatedAt: now}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return Project{}, err
	}
	if _, err := db.Exec("insert into projects (id, name, app_id, app_version, format_version, created_at) values (?, ?, ?, ?, ?, ?)", project.ID, project.Name, project.AppID, project.AppVersion, project.FormatVersion, iso(now)); err != nil {
		return Project{}, err
	}
	if err := os.MkdirAll(s.projectDir(id), 0o755); err != nil {
		return Project{}, err
	}
	if _, err := s.ProjectFilesRoot(id); err != nil {
		return Project{}, err
	}
	return project, nil
}

func (s *Store) List() ([]Project, error) {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`select p.id, p.name, p.app_id, p.app_version, p.format_version, p.created_at, c.asset_id, c.kind
from projects p left join project_covers c on c.project_id = p.id order by p.created_at desc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		project, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (s *Store) Get(id string) (Project, error) {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return Project{}, err
	}
	row := db.QueryRow(`select p.id, p.name, p.app_id, p.app_version, p.format_version, p.created_at, c.asset_id, c.kind
from projects p left join project_covers c on c.project_id = p.id where p.id = ?`, id)
	project, err := scanProject(row)
	if err != nil {
		return Project{}, fmt.Errorf("project %q: %w", id, err)
	}
	return project, nil
}

// Rename changes only the user-facing project title; its ID and owning App
// remain stable so existing URLs, files and App-owned records continue to work.
func (s *Store) Rename(id, name string) (Project, error) {
	id, name = strings.TrimSpace(id), strings.TrimSpace(name)
	if id == "" || name == "" {
		return Project{}, errors.New("project name is required")
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return Project{}, err
	}
	result, err := db.Exec("update projects set name = ? where id = ?", name, id)
	if err != nil {
		return Project{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Project{}, err
	}
	if changed == 0 {
		return Project{}, errors.New("project not found")
	}
	return s.Get(id)
}

// Delete removes the platform project and its owned filesystem scope. Media
// Assets stay in the workspace library; only their association with this
// project is removed, so shared media never loses content unexpectedly.
func (s *Store) Delete(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("project not found")
	}
	if _, err := s.Get(id); err != nil {
		return errors.New("project not found")
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	for _, query := range []string{
		"delete from project_covers where project_id = ?",
		"delete from artifacts where project_id = ?",
		"delete from events where project_id = ?",
		"delete from media_asset_projects where project_id = ?",
		"delete from creation_context_bindings where target_type = 'project' and target_id = ?",
		"delete from shell_jobs where project_id = ?",
		"delete from projects where id = ?",
	} {
		if _, err := tx.Exec(query, id); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return os.RemoveAll(s.projectDir(id))
}

func (s *Store) SetProjectCover(projectID string, cover ProjectCover) (Project, error) {
	if strings.TrimSpace(cover.AssetID) == "" {
		return Project{}, errors.New("cover asset id is required")
	}
	if cover.Kind != "image" && cover.Kind != "video" {
		return Project{}, fmt.Errorf("cover kind %q is not supported", cover.Kind)
	}
	if _, err := s.Get(projectID); err != nil {
		return Project{}, err
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return Project{}, err
	}
	if _, err := db.Exec(`insert into project_covers (project_id, asset_id, kind, updated_at) values (?, ?, ?, ?)
on conflict(project_id) do update set asset_id = excluded.asset_id, kind = excluded.kind, updated_at = excluded.updated_at`, projectID, cover.AssetID, cover.Kind, iso(time.Now().UTC())); err != nil {
		return Project{}, err
	}
	s.AppendEvent(projectID, map[string]any{"type": "project.cover.updated", "assetId": cover.AssetID, "kind": cover.Kind, "at": time.Now().UTC()})
	return s.Get(projectID)
}

// AppStateDatabase returns an App's single sqlite interface. It holds both the
// App's global state and every Project it owns: the App scopes its own rows by
// ctx.project.id. This keeps the App's sqlite contract to exactly one handle.
func (s *Store) AppStateDatabase(appID string) (*sql.DB, error) {
	if err := validateAppID(appID); err != nil {
		return nil, err
	}
	path := s.appStateDatabasePath(appID)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	return s.database(path, nil)
}

func (s *Store) ProjectFilesRoot(projectID string) (string, error) {
	if _, err := s.Get(projectID); err != nil {
		return "", err
	}
	root := filepath.Join(s.projectDir(projectID), "files")
	return root, os.MkdirAll(root, 0o755)
}

func (s *Store) AppStateFilesRoot(appID string) (string, error) {
	if err := validateAppID(appID); err != nil {
		return "", err
	}
	root := s.appStateFilesRoot(appID)
	return root, os.MkdirAll(root, 0o755)
}

// TargetFilesRoot resolves the primary files root for a runtime Target.
func (s *Store) TargetFilesRoot(target Target) (string, error) {
	if target.IsProject() {
		return s.ProjectFilesRoot(target.ProjectID)
	}
	return s.AppStateFilesRoot(target.AppID)
}

// WorkspaceDatabase owns platform-only data that must survive independently of a
// project: agent conversations, project metadata, artifacts, events, media and
// credentials. App-owned workflow tables never live here.
func (s *Store) WorkspaceDatabase() (*sql.DB, error) {
	if err := os.MkdirAll(s.root, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(s.root, "workspace.sqlite")
	s.workspaceMu.RLock()
	ready := s.workspaceReady
	s.workspaceMu.RUnlock()
	if ready {
		return s.database(path, nil)
	}
	s.workspaceMu.Lock()
	defer s.workspaceMu.Unlock()
	if s.workspaceReady {
		return s.database(path, nil)
	}
	db, err := s.database(path, func(db *sql.DB) error {
		if err := os.Chmod(path, 0o600); err != nil && !os.IsNotExist(err) {
			return err
		}
		_, err := db.Exec(`
create table if not exists agent_sessions (
  id text primary key, profile_id text not null, project_id text, runtime text not null,
  native_session_id text, native_workspace text not null default '', codex_model text, reasoning_effort text, opencode_model text,
  title text not null, status text not null,
  created_at text not null, updated_at text not null
);
create table if not exists agent_turns (
  id text primary key, session_id text not null, role text not null, content text not null,
  status text not null, created_at text not null, completed_at text
);
create table if not exists agent_turn_attachments (
  turn_id text not null, asset_id text not null,
  primary key (turn_id, asset_id)
);
create table if not exists agent_turn_contexts (
  turn_id text not null, seq integer not null,
  type text not null, source text not null, payload_json text not null,
  primary key (turn_id, seq)
);
create table if not exists agent_events (
  id integer primary key autoincrement, session_id text not null, turn_id text,
  type text not null, payload_json text not null, created_at text not null
);
create index if not exists agent_sessions_updated on agent_sessions(profile_id, updated_at desc);
create index if not exists agent_turns_session on agent_turns(session_id, created_at);
create index if not exists agent_turn_attachments_turn on agent_turn_attachments(turn_id);
create index if not exists agent_turn_contexts_turn on agent_turn_contexts(turn_id);
create index if not exists agent_events_session on agent_events(session_id, id);
create table if not exists projects (
  id text primary key, name text not null, app_id text not null,
  app_version text not null, format_version integer not null, created_at text not null
);
create table if not exists project_covers (
  project_id text primary key, asset_id text not null, kind text not null, updated_at text not null
);
create table if not exists artifacts (
  id text primary key, project_id text not null, type text not null,
  producer_app text not null, content_hash text not null, created_at text not null,
  value_json text not null
);
create index if not exists artifacts_project on artifacts(project_id, created_at desc);
create table if not exists events (
  id integer primary key autoincrement, project_id text not null,
  payload_json text not null, created_at text not null
);
create index if not exists events_project on events(project_id, id);
create table if not exists media_credentials (
  id text primary key, provider text not null, name text not null, api_base text not null,
  secret_ciphertext text not null, created_at text not null, updated_at text not null
);
create table if not exists media_routes (
  id text primary key, capability text not null unique, model_id text not null,
  credential_id text not null, enabled integer not null, updated_at text not null
);
create table if not exists media_assets (
  id text primary key, kind text not null, name text not null, mime_type text not null,
  size_bytes integer not null, content_hash text not null, origin text not null,
  parent_id text not null, status text not null default 'completed', job_id text not null default '',
  remote_id text not null default '', remote_poll_url text not null default '', error text not null default '',
  metadata_json text not null, created_at text not null, updated_at text not null
);
create table if not exists media_asset_projects (
  asset_id text not null, project_id text not null, created_at text not null,
  primary key (asset_id, project_id)
);
create table if not exists media_asset_events (
  id integer primary key autoincrement, asset_id text not null, created_at text not null
);
create table if not exists media_task_leases (
  job_id text primary key, owner_id text not null, expires_at_ms integer not null, updated_at text not null
);
create table if not exists workspace_preferences (
  key text primary key, value_json text not null, updated_at text not null
);
create table if not exists media_jobs (
  id text primary key, idempotency_key text not null unique, capability text not null,
  status text not null, prompt text not null, model_id text not null, credential_id text not null,
  project_id text not null, reference_ids_json text not null, output_json text not null,
  asset_ids_json text not null, remote_id text not null default '', remote_poll_url text not null default '',
  submission_started_at text not null default '',
  error text not null, created_at text not null, updated_at text not null
);
create index if not exists media_assets_created on media_assets(created_at desc);
create index if not exists media_asset_projects_project on media_asset_projects(project_id, created_at desc);
create index if not exists media_asset_events_asset on media_asset_events(asset_id, id);
create index if not exists media_jobs_updated on media_jobs(updated_at desc);
create index if not exists media_task_leases_expiry on media_task_leases(expires_at_ms);
create table if not exists shell_jobs (
  id text primary key, project_id text not null default '', app_id text not null,
  status text not null, command text not null default '', args_json text not null default '[]',
  exit_code integer not null default 0, error text not null default '',
  started_at text not null default '', ended_at text not null default '',
  created_at text not null, updated_at text not null
);
create index if not exists shell_jobs_scope on shell_jobs(project_id, created_at desc);
create index if not exists shell_jobs_status on shell_jobs(status);
create table if not exists agent_tasks (
  id text primary key, session_id text not null, status text not null,
  input_doc_ids_json text not null, output_doc_ids_json text not null,
  accessed_doc_ids_json text not null, created_at text not null, completed_at text
);
create index if not exists agent_tasks_session on agent_tasks(session_id, created_at);
create table if not exists device_tokens (
  id text primary key, token_hash text not null unique, scope_json text not null,
  created_at text not null, expires_at text, revoked integer not null default 0
);
create table if not exists worlds (
  id text primary key,
  name text not null,
  type text not null,
  description text not null default '',
  identity_json text not null default '{}',
  cover_asset_id text,
  current_revision_id text,
  created_at text not null,
  updated_at text not null,
  archived_at text
);
create index if not exists worlds_updated on worlds(updated_at desc);
create index if not exists worlds_type on worlds(type, updated_at desc);

create table if not exists world_entities (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  kind text not null,
  title text not null,
  summary text not null default '',
  content_json text not null,
  created_at text not null,
  updated_at text not null,
  archived_at text
);
create index if not exists world_entities_world_kind on world_entities(world_id, kind, updated_at desc);
create index if not exists world_entities_world_title on world_entities(world_id, title collate nocase);

create table if not exists world_relations (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  from_entity_id text not null references world_entities(id) on delete cascade,
  to_entity_id text not null references world_entities(id) on delete cascade,
  relation_type text not null,
  metadata_json text not null default '{}',
  created_at text not null,
  unique(world_id, from_entity_id, to_entity_id, relation_type)
);
create index if not exists world_relations_world_from on world_relations(world_id, from_entity_id);
create index if not exists world_relations_world_to on world_relations(world_id, to_entity_id);

create table if not exists world_asset_refs (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  entity_id text references world_entities(id) on delete cascade,
  asset_id text not null,
  role text not null,
  label text not null default '',
  sort_order integer not null default 0,
  created_at text not null,
  unique(world_id, entity_id, asset_id, role)
);
create index if not exists world_asset_refs_world on world_asset_refs(world_id, entity_id, sort_order);
create index if not exists world_asset_refs_asset on world_asset_refs(asset_id);

create table if not exists world_revisions (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  canonical_json text not null,
  canonical_hash text not null,
  reason text not null,
  created_by text not null,
  created_at text not null,
  unique(world_id, canonical_hash)
);
create index if not exists world_revisions_world on world_revisions(world_id, created_at desc);

create table if not exists creation_context_bindings (
  id text primary key,
  target_type text not null,
  target_id text not null,
  world_id text not null references worlds(id),
  revision_id text not null references world_revisions(id),
  selection_json text not null,
  role text not null,
  created_at text not null,
  unique(target_type, target_id, role)
);
create index if not exists creation_context_bindings_target on creation_context_bindings(target_type, target_id);
create index if not exists creation_context_bindings_world on creation_context_bindings(world_id, revision_id);
`)
		if err != nil {
			return err
		}
		for _, statement := range []string{
			"alter table agent_sessions add column codex_model text",
			"alter table agent_sessions add column reasoning_effort text",
			"alter table agent_sessions add column opencode_model text",
			"alter table agent_sessions add column native_workspace text not null default ''",
			"alter table agent_sessions add column workspace_context_json text not null default ''",
			"alter table agent_sessions add column app_id text not null default ''",
			"alter table agent_sessions add column app_view text not null default ''",
			"alter table agent_turns add column task_id text not null default ''",
			"alter table agent_turns add column default_doc_json text not null default ''",
			"alter table media_assets add column status text not null default 'completed'",
			"alter table media_assets add column job_id text not null default ''",
			"alter table media_assets add column remote_id text not null default ''",
			"alter table media_assets add column remote_poll_url text not null default ''",
			"alter table media_assets add column error text not null default ''",
			"alter table media_assets add column updated_at text not null default ''",
			"alter table media_jobs add column remote_id text not null default ''",
			"alter table media_jobs add column remote_poll_url text not null default ''",
			"alter table media_jobs add column submission_started_at text not null default ''",
			"alter table artifacts add column creation_context_binding_id text",
			"alter table media_jobs add column creation_context_binding_id text",
		} {
			if _, err := db.Exec(statement); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
				return err
			}
		}
		if _, err := db.Exec("update media_assets set updated_at = created_at where updated_at = ''"); err != nil {
			return err
		}
		if _, err := db.Exec("update media_assets set status = 'completed' where coalesce(trim(status), '') = '' or (status in ('queued', 'running') and job_id = '')"); err != nil {
			return err
		}
		if _, err := db.Exec("insert into workspace_preferences (key, value_json, updated_at) values (?, ?, ?) on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at", layoutVersionKey, currentLayoutVersion, iso(time.Now().UTC())); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.workspaceReady = true
	return db, nil
}

func (s *Store) database(path string, initialize func(*sql.DB) error) (*sql.DB, error) {
	s.databasesMu.RLock()
	db := s.databases[path]
	s.databasesMu.RUnlock()
	if db != nil {
		checkContext, cancel := context.WithTimeout(context.Background(), databaseHealthCheckTimeout)
		err := db.PingContext(checkContext)
		cancel()
		if err == nil || errors.Is(err, context.DeadlineExceeded) {
			return db, nil
		}
		s.databasesMu.Lock()
		if s.databases[path] == db {
			delete(s.databases, path)
		}
		s.databasesMu.Unlock()
		_ = db.Close()
	}
	s.databasesMu.Lock()
	defer s.databasesMu.Unlock()
	if db := s.databases[path]; db != nil {
		return db, nil
	}
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(sqlitePoolMaxOpenConnections)
	db.SetMaxIdleConns(sqlitePoolMaxOpenConnections)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if initialize != nil {
		if err := initialize(db); err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	s.databases[path] = db
	return db, nil
}

func sqliteDSN(path string) string {
	query := url.Values{}
	query.Add("_pragma", fmt.Sprintf("busy_timeout(%d)", workspaceBusyTimeoutMilliseconds))
	query.Add("_pragma", "journal_mode(WAL)")
	query.Add("_pragma", "synchronous(NORMAL)")
	query.Add("_txlock", "immediate")
	return (&url.URL{Scheme: "file", Path: path, RawQuery: query.Encode()}).String()
}

func (s *Store) PublishArtifact(projectID, appID, artifactType string, value any) (Artifact, error) {
	if err := s.projectOwnedBy(projectID, appID); err != nil {
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
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return Artifact{}, err
	}
	valueJSON, err := json.Marshal(value)
	if err != nil {
		return Artifact{}, err
	}
	if _, err := db.Exec("insert into artifacts (id, project_id, type, producer_app, content_hash, created_at, value_json) values (?, ?, ?, ?, ?, ?, ?)", artifact.ID, artifact.ProjectID, artifact.Type, artifact.ProducerApp, artifact.ContentHash, iso(artifact.CreatedAt), string(valueJSON)); err != nil {
		return Artifact{}, err
	}
	return artifact, nil
}

func (s *Store) ListArtifacts(projectID string) ([]Artifact, error) {
	if _, err := s.Get(projectID); err != nil {
		return nil, err
	}
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, project_id, type, producer_app, content_hash, created_at, value_json from artifacts where project_id = ? order by created_at desc", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	artifacts := []Artifact{}
	for rows.Next() {
		artifact := Artifact{ProjectID: projectID}
		var createdAt, valueJSON string
		if err := rows.Scan(&artifact.ID, &artifact.ProjectID, &artifact.Type, &artifact.ProducerApp, &artifact.ContentHash, &createdAt, &valueJSON); err != nil {
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
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return
	}
	if _, err := db.Exec("insert into events (project_id, payload_json, created_at) values (?, ?, ?)", projectID, string(data), iso(time.Now().UTC())); err != nil {
		return
	}
	s.projectEvents.notify()
}

// ListProjectEvents returns events for a project after lastID. It is used by the
// WebSocket adapter and reads the platform events table.
func (s *Store) ListProjectEvents(projectID string, after int64) ([]projectEvent, error) {
	db, err := s.WorkspaceDatabase()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query("select id, payload_json from events where project_id = ? and id > ? order by id", projectID, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []projectEvent{}
	for rows.Next() {
		var event projectEvent
		if err := rows.Scan(&event.ID, &event.Payload); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

type projectEvent struct {
	ID      int64
	Payload string
}

func (s *Store) projectOwnedBy(projectID, appID string) error {
	project, err := s.Get(projectID)
	if err != nil {
		return err
	}
	if project.AppID != appID {
		return fmt.Errorf("app %q is not the owner of project", appID)
	}
	return nil
}

func validateAppID(appID string) error {
	if appID == "" || appID == "." || appID == ".." || strings.ContainsAny(appID, "/\\") {
		return fmt.Errorf("invalid app id %q", appID)
	}
	return nil
}

func scanProject(row scanner) (Project, error) {
	var project Project
	var createdAt string
	var coverAssetID, coverKind sql.NullString
	err := row.Scan(&project.ID, &project.Name, &project.AppID, &project.AppVersion, &project.FormatVersion, &createdAt, &coverAssetID, &coverKind)
	if err != nil {
		return Project{}, err
	}
	parsed, parseErr := time.Parse(time.RFC3339Nano, createdAt)
	if parseErr != nil {
		return Project{}, parseErr
	}
	project.CreatedAt = parsed
	if coverAssetID.Valid && coverKind.Valid {
		project.Cover = &ProjectCover{AssetID: coverAssetID.String, Kind: coverKind.String}
	}
	return project, nil
}

func (s *Store) projectsDir() string         { return filepath.Join(s.root, "projects") }
func (s *Store) projectDir(id string) string { return filepath.Join(s.projectsDir(), id) }
func (s *Store) appStateDir(appID string) string {
	return filepath.Join(s.root, "appstate", appID)
}
func (s *Store) appStateDatabasePath(appID string) string {
	return filepath.Join(s.appStateDir(appID), "storage.sqlite")
}
func (s *Store) appStateFilesRoot(appID string) string {
	return filepath.Join(s.appStateDir(appID), "files")
}

// SessionWorkspaceDir is the per-bridge-session CLI workspace. It is global and
// independent of any project, which is what decouples sessions from projects.
func (s *Store) SessionWorkspaceDir(bridgeSessionID string) string {
	return filepath.Join(s.root, "sessions", "agent-bridge", bridgeSessionID, "workspace")
}

func (s *Store) TerminalSessionsDir() string {
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
