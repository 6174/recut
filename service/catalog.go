/*
 * [INPUT]: 依赖标准库 JSON 与文件系统能力
 * [OUTPUT]: 对外提供 manifest 驱动且按本地目录变化刷新的 Catalog、含作者/描述/onboarding 的 App 身份、缓存化 Git 远端检查状态、隐藏平台 scope 描述符与统一 operation 公开契约
 * [POS]: service 的扩展注册表；只理解 App 与平台 scope 身份、入口、权限和扩展点，不理解业务数据布局；本地 link 或 manifest 修改会原子更新注册表
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const mediaSystemProjectID = "media-library"
const mediaSystemAppID = "recut.media-library"

func isSystemAppID(id string) bool { return id == mediaSystemAppID }

type AppKind string

const (
	ProjectApp    AppKind = "project"
	StandaloneApp AppKind = "standalone"
)

type Manifest struct {
	ManifestVersion int               `json:"manifestVersion"`
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Author          string            `json:"author"`
	Description     string            `json:"description"`
	Repository      string            `json:"repository,omitempty"`
	Version         string            `json:"version"`
	Kind            AppKind           `json:"type"`
	Background      string            `json:"background"`
	UI              UIEntrypoints     `json:"ui"`
	Permissions     []string          `json:"permissions"`
	Runtime         AppRuntime        `json:"runtime,omitempty"`
	Operations      []Operation       `json:"operations"`
	Onboarding      []OnboardingGuide `json:"onboarding"`
}

type AppRuntime struct {
	Python *PythonRuntime `json:"python,omitempty"`
}

type PythonRuntime struct {
	Venv         string `json:"venv"`
	Version      string `json:"version,omitempty"`
	Requirements string `json:"requirements,omitempty"`
	Bootstrap    string `json:"bootstrap,omitempty"`
}

type UIEntrypoints struct {
	ProjectView    string `json:"projectView"`
	StandaloneView string `json:"standaloneView"`
}

type Operation struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Surfaces    []string       `json:"surfaces"`
	InputSchema map[string]any `json:"inputSchema"`
}

type App struct {
	Manifest Manifest `json:"manifest"`
	Root     string   `json:"-"`
}

type Catalog struct {
	mu                  sync.RWMutex
	installationCheckMu sync.Mutex
	lastRemoteCheck     time.Time
	remoteCheckErrors   map[string]string
	remoteCheckRunning  bool
	remoteChecker       func(string) error
	apps                map[string]App
	dir                 string
	directoryVersion    string
}

func LoadCatalog(dir string) (*Catalog, error) {
	absolute, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("resolve apps directory: %w", err)
	}
	catalog := &Catalog{dir: absolute, remoteChecker: refreshGitRemote}
	if err := catalog.Reload(); err != nil {
		return nil, err
	}
	return catalog, nil
}

func (c *Catalog) Reload() error {
	apps, directoryVersion, err := loadCatalogSnapshot(c.dir)
	if err != nil {
		return err
	}
	c.installationCheckMu.Lock()
	defer c.installationCheckMu.Unlock()
	c.mu.Lock()
	c.apps = apps
	c.directoryVersion = directoryVersion
	c.lastRemoteCheck = time.Time{}
	c.remoteCheckErrors = nil
	c.mu.Unlock()
	return nil
}

// ReloadIfChanged keeps the Catalog aligned with local App links without
// invalidating cached Git remote status on ordinary page refreshes.
func (c *Catalog) ReloadIfChanged() error {
	directoryVersion, err := catalogDirectoryVersion(c.dir)
	if err != nil {
		return err
	}
	c.mu.RLock()
	unchanged := c.directoryVersion == directoryVersion
	c.mu.RUnlock()
	if unchanged {
		return nil
	}

	c.installationCheckMu.Lock()
	defer c.installationCheckMu.Unlock()
	directoryVersion, err = catalogDirectoryVersion(c.dir)
	if err != nil {
		return err
	}
	c.mu.RLock()
	unchanged = c.directoryVersion == directoryVersion
	c.mu.RUnlock()
	if unchanged {
		return nil
	}
	apps, directoryVersion, err := loadCatalogSnapshot(c.dir)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.apps = apps
	c.directoryVersion = directoryVersion
	c.mu.Unlock()
	return nil
}

func loadCatalogSnapshot(dir string) (map[string]App, string, error) {
	apps, err := loadCatalogApps(dir)
	if err != nil {
		return nil, "", err
	}
	directoryVersion, err := catalogDirectoryVersion(dir)
	if err != nil {
		return nil, "", err
	}
	return apps, directoryVersion, nil
}

func catalogDirectoryVersion(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", fmt.Errorf("read apps directory: %w", err)
	}
	parts := make([]string, 0, len(entries)*2)
	for _, entry := range entries {
		root := filepath.Join(dir, entry.Name())
		linkInfo, err := os.Lstat(root)
		if err != nil {
			return "", fmt.Errorf("inspect App package %q: %w", entry.Name(), err)
		}
		parts = append(parts, catalogFileVersion(entry.Name(), linkInfo))
		info, err := os.Stat(root)
		if err != nil {
			if entry.Name() == mediaSystemProjectID && errors.Is(err, os.ErrNotExist) {
				continue
			}
			return "", fmt.Errorf("inspect App package %q: %w", entry.Name(), err)
		}
		if !info.IsDir() {
			continue
		}
		manifest, err := os.Stat(filepath.Join(root, "manifest.json"))
		if err != nil {
			return "", fmt.Errorf("inspect App manifest %q: %w", entry.Name(), err)
		}
		parts = append(parts, catalogFileVersion(entry.Name()+"/manifest.json", manifest))
	}
	return strings.Join(parts, "\x00"), nil
}

func catalogFileVersion(path string, info os.FileInfo) string {
	return path + ":" + strconv.FormatUint(uint64(info.Mode()), 10) + ":" + strconv.FormatInt(info.Size(), 10) + ":" + strconv.FormatInt(info.ModTime().UnixNano(), 10)
}

func loadCatalogApps(dir string) (map[string]App, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read apps directory: %w", err)
	}
	apps := map[string]App{}
	for _, entry := range entries {
		root := filepath.Join(dir, entry.Name())
		info, err := os.Stat(root)
		if err != nil {
			// 0.1.0 将素材库作为 App 链接安装。新版素材库改为
			// 平台原生 React 页面后，保留该失效链接不应阻止 daemon 启动。
			if entry.Name() == mediaSystemProjectID && errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, fmt.Errorf("inspect App package %q: %w", entry.Name(), err)
		}
		if !info.IsDir() {
			continue
		}
		app, err := loadApp(root)
		if err != nil {
			return nil, err
		}
		if _, exists := apps[app.Manifest.ID]; exists {
			return nil, fmt.Errorf("duplicate app id %q", app.Manifest.ID)
		}
		apps[app.Manifest.ID] = app
	}
	return apps, nil
}

func (c *Catalog) Directory() string { return c.dir }
func (c *Catalog) Get(id string) (App, bool) {
	if app, ok := systemAppDescriptor(id); ok {
		return app, true
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	app, ok := c.apps[id]
	return app, ok
}
func (c *Catalog) List() ([]App, error) {
	if err := c.ReloadIfChanged(); err != nil {
		return nil, err
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	apps := make([]App, 0, len(c.apps))
	for _, app := range c.apps {
		if app.Manifest.ID == mediaSystemAppID {
			continue
		}
		apps = append(apps, app)
	}
	sort.Slice(apps, func(i, j int) bool { return apps[i].Manifest.ID < apps[j].Manifest.ID })
	return apps, nil
}

func mediaSystemAppDescriptor() App {
	return App{Manifest: Manifest{
		ManifestVersion: 1,
		ID:              mediaSystemAppID,
		Name:            "素材库",
		Author:          "Recut",
		Description:     "管理跨项目图片、视频和音频素材的内置系统能力。",
		Version:         "1.0.0",
		Kind:            ProjectApp,
		Onboarding: []OnboardingGuide{
			{ID: "organize-assets", Title: "整理已有素材", Description: "上传或引用素材后，让 AI 帮你盘点并建议下一步。", Prompt: "我想整理这次创作会用到的素材。请先问我需要上传或引用哪些图片、视频和音频，再按用途帮我列出下一步。"},
			{ID: "plan-video", Title: "从一个想法开始", Description: "把主题、目标受众和交付形式变成可执行的创作计划。", Prompt: "我想做一支视频，但目前只有一个初步想法。请先问我主题、受众和交付目标，然后把制作过程拆成清晰的下一步。"},
		},
	}}
}

func systemAppDescriptor(id string) (App, bool) {
	switch id {
	case mediaSystemAppID:
		return mediaSystemAppDescriptor(), true
	default:
		return App{}, false
	}
}

func loadApp(root string) (App, error) {
	manifest := Manifest{}
	if err := readCatalogJSON(filepath.Join(root, "manifest.json"), &manifest); err != nil {
		return App{}, err
	}
	if err := validateManifest(manifest); err != nil {
		return App{}, fmt.Errorf("invalid app %q: %w", manifest.ID, err)
	}
	return App{Manifest: manifest, Root: root}, nil
}

func readCatalogJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}

func validateManifest(manifest Manifest) error {
	if manifest.ManifestVersion != 1 || manifest.ID == "" || manifest.Name == "" || manifest.Author == "" || manifest.Description == "" || manifest.Version == "" {
		return errors.New("manifestVersion, id, name, author, description, and version are required")
	}
	if manifest.Kind != ProjectApp && manifest.Kind != StandaloneApp {
		return fmt.Errorf("invalid app type %q", manifest.Kind)
	}
	if !validPackagePath(manifest.Background) {
		return errors.New("background must be a package-relative path")
	}
	if manifest.Kind == ProjectApp && !validPackagePath(manifest.UI.ProjectView) {
		return errors.New("project App requires ui.projectView")
	}
	if manifest.Kind == StandaloneApp && !validPackagePath(manifest.UI.StandaloneView) {
		return errors.New("standalone App requires ui.standaloneView")
	}
	if runtime := manifest.Runtime.Python; runtime != nil {
		if !hasManifestPermission(manifest, "python") || !hasManifestPermission(manifest, "shell") {
			return errors.New("python runtime requires python and shell permissions")
		}
		if strings.TrimSpace(runtime.Venv) == "" || !validRuntimeName(runtime.Venv) {
			return errors.New("python runtime venv must be a simple logical name")
		}
		if runtime.Requirements != "" && !validPackagePath(runtime.Requirements) {
			return errors.New("python runtime requirements must be a package-relative path")
		}
		if runtime.Bootstrap != "" && !validPackagePath(runtime.Bootstrap) {
			return errors.New("python runtime bootstrap must be a package-relative path")
		}
	}
	if err := validateOnboarding(manifest.Onboarding); err != nil {
		return fmt.Errorf("invalid onboarding: %w", err)
	}
	names := map[string]bool{}
	for _, operation := range manifest.Operations {
		if operation.Name == "" || operation.Description == "" || names[operation.Name] || len(operation.Surfaces) == 0 {
			return fmt.Errorf("invalid operation %q", operation.Name)
		}
		names[operation.Name] = true
		surfaces := map[string]bool{}
		for _, surface := range operation.Surfaces {
			if (surface != "api" && surface != "mcp") || surfaces[surface] {
				return fmt.Errorf("invalid operation surface %q", surface)
			}
			surfaces[surface] = true
		}
	}
	return nil
}

func hasManifestPermission(manifest Manifest, permission string) bool {
	for _, candidate := range manifest.Permissions {
		if candidate == permission {
			return true
		}
	}
	return false
}

func validRuntimeName(name string) bool {
	for _, value := range name {
		if (value >= 'a' && value <= 'z') || (value >= '0' && value <= '9') || value == '-' || value == '_' {
			continue
		}
		return false
	}
	return true
}

func validPackagePath(path string) bool {
	clean := filepath.Clean(path)
	return path != "" && !filepath.IsAbs(path) && clean != "." && !strings.HasPrefix(clean, "..")
}

// Skill is one discoverable capability document shipped by an App. Its Body is
// the SKILL.md content; sub-documents under the skill directory are read on
// demand through the platform skills MCP tools.
type Skill struct {
	ID          string   `json:"id"`
	AppID       string   `json:"appId"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	References  []string `json:"references,omitempty"`
	Resources   []string `json:"resources,omitempty"`
	Body        string   `json:"-"`
	Root        string   `json:"-"`
}

// Skills scans the standard skill tree (skills/<id>/SKILL.md) of an App package.
// Apps without a skills directory fall back to a single skill derived from the
// root AGENTS.md. The skills directory always wins; the two are never both
// authoritative.
func (app App) Skills() ([]Skill, error) {
	skillsRoot := filepath.Join(app.Root, "skills")
	entries, err := os.ReadDir(skillsRoot)
	if err == nil {
		skills := []Skill{}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			skill, ok, parseErr := loadSkill(app, entry.Name(), filepath.Join(skillsRoot, entry.Name(), "SKILL.md"))
			if parseErr != nil {
				return nil, parseErr
			}
			if ok {
				skills = append(skills, skill)
			}
		}
		sort.Slice(skills, func(i, j int) bool { return skills[i].ID < skills[j].ID })
		return skills, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if skill, ok, err := loadSkill(app, fallbackSkillID(app.Manifest.ID), filepath.Join(app.Root, "AGENTS.md")); err != nil {
		return nil, err
	} else if ok {
		return []Skill{skill}, nil
	}
	return []Skill{}, nil
}

func loadSkill(app App, id, path string) (Skill, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Skill{}, false, nil
	}
	if err != nil {
		return Skill{}, false, err
	}
	body := string(data)
	frontmatter, description, references, resources := parseSkillFrontmatter(body)
	name := frontmatter
	if name == "" {
		name = id
	}
	if description == "" {
		description = app.Manifest.Description
	}
	return Skill{ID: id, AppID: app.Manifest.ID, Name: name, Description: description, References: references, Resources: resources, Body: body, Root: filepath.Dir(path)}, true, nil
}

func fallbackSkillID(appID string) string {
	for _, separator := range []string{".", "-"} {
		if _, after, found := strings.Cut(appID, separator); found && after != "" {
			return after
		}
	}
	return appID
}

func parseSkillFrontmatter(body string) (name, description string, references, resources []string) {
	body = strings.TrimPrefix(body, "\ufeff")
	if !strings.HasPrefix(body, "---") {
		return "", "", nil, nil
	}
	rest := strings.TrimPrefix(body, "---")
	rest = strings.TrimLeft(rest, "\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", "", nil, nil
	}
	block := strings.TrimSpace(rest[:end])
	for _, line := range strings.Split(block, "\n") {
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		switch key {
		case "name":
			name = value
		case "description":
			description = value
		case "references", "resources":
			for _, item := range strings.Split(value, ",") {
				if trimmed := strings.TrimSpace(item); trimmed != "" {
					if key == "references" {
						references = append(references, trimmed)
					} else {
						resources = append(resources, trimmed)
					}
				}
			}
		}
	}
	return name, description, references, resources
}
