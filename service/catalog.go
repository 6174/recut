/*
 * [INPUT]: 依赖标准库 JSON 与文件系统能力
 * [OUTPUT]: 对外提供 manifest 驱动的 Catalog、含作者/描述/onboarding 的 App 身份、隐藏平台 scope 描述符与统一 operation 公开契约
 * [POS]: service 的扩展注册表；只理解 App 与平台 scope 身份、入口、权限和扩展点，不理解业务数据布局
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
	"strings"
	"sync"
)

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
	Operations      []Operation       `json:"operations"`
	Onboarding      []OnboardingGuide `json:"onboarding"`
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
	mu   sync.RWMutex
	apps map[string]App
	dir  string
}

func LoadCatalog(dir string) (*Catalog, error) {
	absolute, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("resolve apps directory: %w", err)
	}
	catalog := &Catalog{dir: absolute}
	if err := catalog.Reload(); err != nil {
		return nil, err
	}
	return catalog, nil
}

func (c *Catalog) Reload() error {
	apps, err := loadCatalogApps(c.dir)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.apps = apps
	c.mu.Unlock()
	return nil
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
func (c *Catalog) List() []App {
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
	return apps
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

func generalChatAppDescriptor() App {
	return App{Manifest: Manifest{
		ManifestVersion: 1,
		ID:              generalChatAppID,
		Name:            "通用对话",
		Author:          "Recut",
		Description:     "不依附项目的通用 Codex 对话系统 scope。",
		Version:         "1.0.0",
		Kind:            ProjectApp,
	}}
}

func systemAppDescriptor(id string) (App, bool) {
	switch id {
	case mediaSystemAppID:
		return mediaSystemAppDescriptor(), true
	case generalChatAppID:
		return generalChatAppDescriptor(), true
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

func validPackagePath(path string) bool {
	clean := filepath.Clean(path)
	return path != "" && !filepath.IsAbs(path) && clean != "." && !strings.HasPrefix(clean, "..")
}
