/*
 * [INPUT]: 依赖标准库 JSON 与文件系统能力
 * [OUTPUT]: 对外提供 manifest 驱动的 Catalog、App 与 MCP/API 公开契约
 * [POS]: service 的扩展注册表；只理解 App 身份、入口、权限和扩展点，不理解业务数据布局
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
)

type AppKind string

const (
	ProjectApp    AppKind = "project"
	StandaloneApp AppKind = "standalone"
)

type Manifest struct {
	ManifestVersion int           `json:"manifestVersion"`
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Version         string        `json:"version"`
	Kind            AppKind       `json:"type"`
	Background      string        `json:"background"`
	UI              UIEntrypoints `json:"ui"`
	Permissions     []string      `json:"permissions"`
	APIs            []Capability  `json:"apis"`
	MCP             MCPManifest   `json:"mcp"`
}

type UIEntrypoints struct {
	ProjectView    string `json:"projectView"`
	StandaloneView string `json:"standaloneView"`
}

type Capability struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Kind        string         `json:"kind"`
	InputSchema map[string]any `json:"inputSchema"`
}

type MCPManifest struct {
	Tools []MCPTool `json:"tools"`
}

type MCPTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type App struct {
	Manifest Manifest `json:"manifest"`
	Root     string   `json:"-"`
}

type Catalog struct {
	apps map[string]App
	dir  string
}

func LoadCatalog(dir string) (*Catalog, error) {
	absolute, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("resolve apps directory: %w", err)
	}
	entries, err := os.ReadDir(absolute)
	if err != nil {
		return nil, fmt.Errorf("read apps directory: %w", err)
	}
	catalog := &Catalog{apps: map[string]App{}, dir: absolute}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		app, err := loadApp(filepath.Join(absolute, entry.Name()))
		if err != nil {
			return nil, err
		}
		if _, exists := catalog.apps[app.Manifest.ID]; exists {
			return nil, fmt.Errorf("duplicate app id %q", app.Manifest.ID)
		}
		catalog.apps[app.Manifest.ID] = app
	}
	return catalog, nil
}

func (c *Catalog) Directory() string         { return c.dir }
func (c *Catalog) Get(id string) (App, bool) { app, ok := c.apps[id]; return app, ok }
func (c *Catalog) List() []App {
	apps := make([]App, 0, len(c.apps))
	for _, app := range c.apps {
		apps = append(apps, app)
	}
	sort.Slice(apps, func(i, j int) bool { return apps[i].Manifest.ID < apps[j].Manifest.ID })
	return apps
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
	if manifest.ManifestVersion != 1 || manifest.ID == "" || manifest.Name == "" || manifest.Version == "" {
		return errors.New("manifestVersion, id, name, and version are required")
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
	names := map[string]bool{}
	for _, capability := range manifest.APIs {
		if capability.Name == "" || (capability.Kind != "query" && capability.Kind != "command" && capability.Kind != "job") || names[capability.Name] {
			return fmt.Errorf("invalid API %q", capability.Name)
		}
		names[capability.Name] = true
	}
	for _, tool := range manifest.MCP.Tools {
		if tool.Name == "" || names["mcp:"+tool.Name] {
			return fmt.Errorf("invalid MCP tool %q", tool.Name)
		}
		names["mcp:"+tool.Name] = true
	}
	return nil
}

func validPackagePath(path string) bool {
	clean := filepath.Clean(path)
	return path != "" && !filepath.IsAbs(path) && clean != "." && !strings.HasPrefix(clean, "..")
}
