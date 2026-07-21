/*
 * [INPUT]: 依赖标准库的 JSON 和文件系统能力
 * [OUTPUT]: 对外提供 Catalog、App、ProjectLayout 及 App 包加载与校验
 * [POS]: service 的 App 格式边界，被项目服务和 HTTP API 共同消费
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

type Manifest struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Version       string `json:"version"`
	ProjectLayout string `json:"projectLayout"`
}

type LayoutFile struct {
	Path   string `json:"path"`
	Schema string `json:"schema,omitempty"`
	Kind   string `json:"kind"`
}

type ProjectLayout struct {
	Version int          `json:"version"`
	Files   []LayoutFile `json:"files"`
}

type App struct {
	Manifest Manifest      `json:"manifest"`
	Layout   ProjectLayout `json:"layout"`
}

type Catalog struct {
	apps map[string]App
}

func LoadCatalog(dir string) (*Catalog, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read apps directory: %w", err)
	}
	catalog := &Catalog{apps: make(map[string]App)}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		app, err := loadApp(filepath.Join(dir, entry.Name()))
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

func (c *Catalog) Get(id string) (App, bool) {
	app, ok := c.apps[id]
	return app, ok
}

func (c *Catalog) List() []App {
	apps := make([]App, 0, len(c.apps))
	for _, app := range c.apps {
		apps = append(apps, app)
	}
	sort.Slice(apps, func(i, j int) bool { return apps[i].Manifest.ID < apps[j].Manifest.ID })
	return apps
}

func loadApp(dir string) (App, error) {
	manifest := Manifest{}
	if err := readCatalogJSON(filepath.Join(dir, "manifest.json"), &manifest); err != nil {
		return App{}, err
	}
	if manifest.ProjectLayout == "" {
		manifest.ProjectLayout = "project-layout.json"
	}
	layout := ProjectLayout{}
	if err := readCatalogJSON(filepath.Join(dir, manifest.ProjectLayout), &layout); err != nil {
		return App{}, err
	}
	if err := validate(manifest, layout); err != nil {
		return App{}, fmt.Errorf("invalid app %q: %w", manifest.ID, err)
	}
	return App{Manifest: manifest, Layout: layout}, nil
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

func validate(manifest Manifest, layout ProjectLayout) error {
	if manifest.ID == "" || manifest.Name == "" || manifest.Version == "" {
		return errors.New("manifest id, name and version are required")
	}
	if layout.Version < 1 {
		return errors.New("layout version must be positive")
	}
	for _, file := range layout.Files {
		if !validRelativePath(file.Path) || (file.Kind != "source" && file.Kind != "derived") {
			return fmt.Errorf("invalid layout file %q", file.Path)
		}
		if file.Kind == "source" && file.Schema == "" {
			return fmt.Errorf("source file %q requires a schema", file.Path)
		}
	}
	return nil
}

func validRelativePath(path string) bool {
	clean := filepath.Clean(path)
	return path != "" && !filepath.IsAbs(path) && clean != "." && !strings.HasPrefix(clean, "..")
}
