/*
 * [INPUT]: 依赖编译内嵌的 service/builtin_apps 目录（单一清单 apps.json + 各 App 归档）、Catalog 的运行时 apps 目录与标准 tar/gzip 文件能力
 * [OUTPUT]: 对外提供内置 App 清单及启动时原子同步；当前将 Remotion Studio、声音工坊与 ComfyUI 工作台安装到 apps 目录（剪辑器已改为平台原生 App）
 * [POS]: service 的首启体验边界；内置 App 集合与打包规则只维护在 service/builtin_apps/apps.json，本文件只做目录扫描与同步，不硬编码任何 App
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// builtinAppsFS embeds the whole built-in App directory. The set of Apps and
// their packaging rules live in apps.json (the single source of truth); this
// file never hardcodes individual App packages.
//
//go:embed builtin_apps
var builtinAppsFS embed.FS

const builtinAppsManifestPath = "builtin_apps/apps.json"

// builtinAppManifestEntry is one row of apps.json. Only the identity fields are
// needed at runtime; include/exclude/prep drive the packaging script.
type builtinAppManifestEntry struct {
	Package string `json:"package"`
	AppID   string `json:"appId"`
}

type BuiltinApp struct {
	Package string
	AppID   string
	Archive []byte
}

// loadBuiltinAppList reads the embedded apps.json and resolves each entry's
// archive from the embedded directory, so adding an App only requires editing
// apps.json (no Go literals).
func loadBuiltinAppList() ([]BuiltinApp, error) {
	raw, err := builtinAppsFS.ReadFile(builtinAppsManifestPath)
	if err != nil {
		return nil, fmt.Errorf("read embedded %s: %w", builtinAppsManifestPath, err)
	}
	var entries []builtinAppManifestEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("parse embedded %s: %w", builtinAppsManifestPath, err)
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("embedded %s declares no built-in Apps", builtinAppsManifestPath)
	}
	apps := make([]BuiltinApp, 0, len(entries))
	for _, entry := range entries {
		if entry.Package == "" || entry.AppID == "" {
			return nil, fmt.Errorf("embedded %s has an entry without package/appId", builtinAppsManifestPath)
		}
		archive, err := builtinAppsFS.ReadFile("builtin_apps/" + entry.Package + ".tar.gz")
		if err != nil {
			return nil, fmt.Errorf("read embedded archive for built-in App %q: %w", entry.Package, err)
		}
		apps = append(apps, BuiltinApp{Package: entry.Package, AppID: entry.AppID, Archive: archive})
	}
	return apps, nil
}

type BuiltinAppManager struct {
	appsDir string
}

func NewBuiltinAppManager(appsDir string) *BuiltinAppManager {
	return &BuiltinAppManager{appsDir: appsDir}
}

// Ensure refreshes daemon-owned App packages before Catalog reads them. A
// source-tree symlink is an explicit development override and is never
// replaced; all ordinary package directories are atomically replaced.
func (m *BuiltinAppManager) Ensure() error {
	apps, err := loadBuiltinAppList()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(m.appsDir, 0o755); err != nil {
		return fmt.Errorf("create built-in apps directory: %w", err)
	}
	for _, app := range apps {
		if err := m.sync(app); err != nil {
			return err
		}
	}
	return nil
}

func (m *BuiltinAppManager) sync(app BuiltinApp) error {
	if app.Package == "" || app.AppID == "" || len(app.Archive) == 0 {
		return errors.New("invalid built-in App entry")
	}
	destination := filepath.Join(m.appsDir, app.Package)
	if info, err := os.Lstat(destination); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return nil
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect built-in App %q: %w", app.Package, err)
	}

	staged, err := os.MkdirTemp(m.appsDir, ".builtin-"+app.Package+"-")
	if err != nil {
		return fmt.Errorf("stage built-in App %q: %w", app.Package, err)
	}
	defer os.RemoveAll(staged)
	if err := extractBuiltinApp(staged, app.Package, app.Archive); err != nil {
		return fmt.Errorf("extract built-in App %q: %w", app.Package, err)
	}
	loaded, err := loadApp(staged)
	if err != nil {
		return fmt.Errorf("validate built-in App %q: %w", app.Package, err)
	}
	if loaded.Manifest.ID != app.AppID {
		return fmt.Errorf("built-in App package %q declares %q, want %q", app.Package, loaded.Manifest.ID, app.AppID)
	}
	if err := replaceBuiltinApp(staged, destination); err != nil {
		return fmt.Errorf("activate built-in App %q: %w", app.Package, err)
	}
	return nil
}

func extractBuiltinApp(destination, packageName string, archive []byte) error {
	zip, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return fmt.Errorf("open archive: %w", err)
	}
	defer zip.Close()

	prefix := packageName + "/"
	reader := tar.NewReader(zip)
	for {
		header, readErr := reader.Next()
		if errors.Is(readErr, io.EOF) {
			return nil
		}
		if readErr != nil {
			return fmt.Errorf("read archive: %w", readErr)
		}
		if header.Name == packageName+"/" {
			continue
		}
		if !strings.HasPrefix(header.Name, prefix) {
			return fmt.Errorf("archive entry escapes package root: %q", header.Name)
		}
		relative := strings.TrimPrefix(header.Name, prefix)
		if relative == "." || relative == "./" {
			continue
		}
		if !safeBuiltinAppPath(relative) {
			return fmt.Errorf("unsafe archive path %q", header.Name)
		}
		target := filepath.Join(destination, filepath.FromSlash(relative))
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			file, createErr := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
			if createErr != nil {
				return createErr
			}
			_, copyErr := io.Copy(file, reader)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		default:
			return fmt.Errorf("unsupported archive entry %q", header.Name)
		}
	}
}

func safeBuiltinAppPath(value string) bool {
	clean := path.Clean(value)
	return value != "" && !path.IsAbs(value) && clean != "." && !strings.HasPrefix(clean, "../") && clean != ".."
}

func replaceBuiltinApp(staged, destination string) error {
	if _, err := os.Lstat(destination); errors.Is(err, os.ErrNotExist) {
		return os.Rename(staged, destination)
	} else if err != nil {
		return err
	}

	backup, err := os.MkdirTemp(filepath.Dir(destination), ".builtin-backup-")
	if err != nil {
		return err
	}
	if err := os.Remove(backup); err != nil {
		return err
	}
	if err := os.Rename(destination, backup); err != nil {
		return err
	}
	if err := os.Rename(staged, destination); err != nil {
		if restoreErr := os.Rename(backup, destination); restoreErr != nil {
			return fmt.Errorf("install replacement: %v; restore previous App: %w", err, restoreErr)
		}
		return err
	}
	return os.RemoveAll(backup)
}
