/*
 * [INPUT]: 依赖编译内嵌的 App 发布归档、Catalog 的运行时 apps 目录与标准 tar/gzip 文件能力
 * [OUTPUT]: 对外提供内置 App 清单及启动时原子同步；当前将 Remotion Studio、剪辑器与声音工坊安装到 apps 目录
 * [POS]: service 的首启体验边界；内置 App 与 Git App 使用同一个 Catalog，开发期本地软链接优先
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

//go:embed builtin_apps/remotion-studio.tar.gz
var embeddedRemotionStudio []byte

//go:embed builtin_apps/editor.tar.gz
var embeddedEditor []byte

//go:embed builtin_apps/audio-studio.tar.gz
var embeddedAudioStudio []byte

type BuiltinApp struct {
	Package string
	AppID   string
	Archive []byte
}

// builtinAppList is the explicit set of packages that ship with every Recut
// binary. Adding an App here makes first launch useful without turning the
// Catalog into a second implementation of App discovery.
var builtinAppList = []BuiltinApp{
	{Package: "remotion-studio", AppID: "recut.remotion-studio", Archive: embeddedRemotionStudio},
	{Package: "editor", AppID: "recut.editor", Archive: embeddedEditor},
	{Package: "audio-studio", AppID: "recut.audio-studio", Archive: embeddedAudioStudio},
}

type BuiltinAppManager struct {
	appsDir string
	apps    []BuiltinApp
}

func NewBuiltinAppManager(appsDir string) *BuiltinAppManager {
	return &BuiltinAppManager{appsDir: appsDir, apps: builtinAppList}
}

// Ensure refreshes daemon-owned App packages before Catalog reads them. A
// source-tree symlink is an explicit development override and is never
// replaced; all ordinary package directories are atomically replaced.
func (m *BuiltinAppManager) Ensure() error {
	if err := os.MkdirAll(m.appsDir, 0o755); err != nil {
		return fmt.Errorf("create built-in apps directory: %w", err)
	}
	for _, app := range m.apps {
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
