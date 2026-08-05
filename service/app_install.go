/*
 * [INPUT]: 依赖 Catalog 的已校验 App 包、Git CLI 与标准库路径/进程能力
 * [OUTPUT]: 对外提供 GitHub App 安装、link/manifest 变化感知的本地目录读取、后台缓存化远端更新检测、单个与批量 fast-forward 升级能力
 * [POS]: service 的 App 分发边界；只接受标准 manifest 包，不让 HTTP 层拼接 Git 命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type AppInstallation struct {
	Package         string   `json:"package"`
	Manifest        Manifest `json:"manifest"`
	Repository      string   `json:"repository,omitempty"`
	Revision        string   `json:"revision,omitempty"`
	Branch          string   `json:"branch,omitempty"`
	Dirty           bool     `json:"dirty"`
	UpdateAvailable bool     `json:"updateAvailable"`
	Manageable      bool     `json:"manageable"`
	Status          string   `json:"status,omitempty"`
}

type AppUpdateFailure struct {
	Package string `json:"package"`
	Error   string `json:"error"`
}

type AppUpdateResult struct {
	Updated []AppInstallation  `json:"updated"`
	Failed  []AppUpdateFailure `json:"failed"`
}

const remoteCheckInterval = time.Minute

func (c *Catalog) Installations() ([]AppInstallation, error) {
	if err := c.ReloadIfChanged(); err != nil {
		return nil, err
	}
	apps, remoteErrors, refresh := c.installationSnapshot()
	if refresh {
		go c.refreshRemoteStatuses()
	}
	result := make([]AppInstallation, 0, len(apps))
	for _, app := range apps {
		if isSystemAppID(app.Manifest.ID) {
			continue
		}
		installation := inspectAppInstallation(app)
		installation.Status = remoteStatus(installation.Status, remoteErrors[app.Root])
		result = append(result, installation)
	}
	sortInstallations(result)
	return result, nil
}

func (c *Catalog) installationSnapshot() ([]App, map[string]string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	apps := catalogApps(c.apps)
	errors := maps.Clone(c.remoteCheckErrors)
	refresh := !c.remoteCheckRunning && time.Since(c.lastRemoteCheck) >= remoteCheckInterval
	if refresh {
		c.remoteCheckRunning = true
	}
	return apps, errors, refresh
}

func (c *Catalog) refreshRemoteStatuses() {
	// The single-flight remoteCheckRunning flag (set under c.mu in
	// installationSnapshot) already prevents concurrent refreshes, so the
	// network fetch loop below must not hold installationCheckMu. A slow or
	// offline `git fetch` would otherwise block every install/update request
	// for its entire duration. Git operations on the same checkout are safe to
	// overlap; only the state swap is serialized.
	errors := map[string]string{}
	for _, app := range c.snapshotApps() {
		if err := c.remoteChecker(app.Root); err != nil {
			errors[app.Root] = err.Error()
		}
	}
	c.mu.Lock()
	c.remoteCheckErrors = errors
	c.lastRemoteCheck = time.Now()
	c.remoteCheckRunning = false
	c.mu.Unlock()
}

func (c *Catalog) snapshotApps() []App {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return catalogApps(c.apps)
}

func catalogApps(source map[string]App) []App {
	apps := make([]App, 0, len(source))
	for _, app := range source {
		apps = append(apps, app)
	}
	return apps
}

func remoteStatus(local, remote string) string {
	if remote != "" {
		return remote
	}
	return local
}

func (c *Catalog) InstallGitHub(rawRepository string) (AppInstallation, error) {
	repository, packageName, err := normalizeGitHubRepository(rawRepository)
	if err != nil {
		return AppInstallation{}, err
	}
	c.installationCheckMu.Lock()
	defer c.installationCheckMu.Unlock()
	destination := filepath.Join(c.dir, packageName)
	if _, err := os.Lstat(destination); err == nil {
		return AppInstallation{}, fmt.Errorf("App package %q is already installed", packageName)
	} else if !errors.Is(err, os.ErrNotExist) {
		return AppInstallation{}, fmt.Errorf("inspect App package destination: %w", err)
	}
	temporary, err := os.MkdirTemp(c.dir, ".install-")
	if err != nil {
		return AppInstallation{}, fmt.Errorf("prepare App installation: %w", err)
	}
	defer os.RemoveAll(temporary)
	if output, err := gitCommand(temporary, "clone", "--depth=1", repository, "."); err != nil {
		return AppInstallation{}, fmt.Errorf("clone GitHub App: %s", gitError(output, err))
	}
	app, err := loadApp(temporary)
	if err != nil {
		return AppInstallation{}, fmt.Errorf("GitHub repository is not a standard Recut App: %w", err)
	}
	if _, exists := c.Get(app.Manifest.ID); exists {
		return AppInstallation{}, fmt.Errorf("App id %q is already installed", app.Manifest.ID)
	}
	if err := os.Rename(temporary, destination); err != nil {
		return AppInstallation{}, fmt.Errorf("activate App installation: %w", err)
	}
	apps, err := loadCatalogApps(c.dir)
	if err != nil {
		_ = os.RemoveAll(destination)
		return AppInstallation{}, err
	}
	c.replaceApps(apps)
	installed, ok := apps[app.Manifest.ID]
	if !ok {
		return AppInstallation{}, errors.New("installed App disappeared from catalog")
	}
	return inspectAppInstallation(installed), nil
}

func (c *Catalog) UpdateInstallation(packageName string) (AppInstallation, error) {
	if !validPackageName(packageName) {
		return AppInstallation{}, errors.New("invalid App package name")
	}
	c.installationCheckMu.Lock()
	defer c.installationCheckMu.Unlock()
	updated, err := c.updateInstallation(packageName)
	if err == nil {
		c.invalidateRemoteStatus()
	}
	return updated, err
}

func (c *Catalog) UpdateInstallations() (AppUpdateResult, error) {
	c.installationCheckMu.Lock()
	defer c.installationCheckMu.Unlock()

	result := AppUpdateResult{Updated: []AppInstallation{}, Failed: []AppUpdateFailure{}}
	for _, app := range c.snapshotApps() {
		status, err := gitStatus(app.Root)
		if err != nil || status.Dirty || !status.UpdateAvailable {
			continue
		}
		updated, err := c.updateInstallation(filepath.Base(app.Root))
		if err != nil {
			result.Failed = append(result.Failed, AppUpdateFailure{Package: filepath.Base(app.Root), Error: err.Error()})
			continue
		}
		result.Updated = append(result.Updated, updated)
	}
	c.invalidateRemoteStatus()
	return result, nil
}

func (c *Catalog) updateInstallation(packageName string) (AppInstallation, error) {
	root := filepath.Join(c.dir, packageName)
	if _, err := os.Stat(root); err != nil {
		return AppInstallation{}, errors.New("App package not found")
	}
	status, err := gitStatus(root)
	if err != nil {
		return AppInstallation{}, errors.New("App is not a Git checkout and cannot be updated")
	}
	if status.Dirty {
		return AppInstallation{}, errors.New("App has local Git changes; preserve or commit them before upgrading")
	}
	if output, err := gitCommand(root, "pull", "--ff-only"); err != nil {
		return AppInstallation{}, fmt.Errorf("upgrade App: %s", gitError(output, err))
	}
	apps, err := loadCatalogApps(c.dir)
	if err != nil {
		return AppInstallation{}, err
	}
	c.replaceApps(apps)
	for _, app := range apps {
		if filepath.Clean(app.Root) == filepath.Clean(root) {
			return inspectAppInstallation(app), nil
		}
	}
	return AppInstallation{}, errors.New("updated App is no longer a valid Recut App")
}

func (c *Catalog) replaceApps(apps map[string]App) {
	c.mu.Lock()
	c.apps = apps
	c.lastRemoteCheck = time.Time{}
	c.remoteCheckErrors = nil
	c.mu.Unlock()
}

func (c *Catalog) invalidateRemoteStatus() {
	c.mu.Lock()
	c.lastRemoteCheck = time.Time{}
	c.remoteCheckErrors = nil
	c.mu.Unlock()
}

type gitCheckoutStatus struct {
	Branch          string
	Revision        string
	Repository      string
	Dirty           bool
	UpdateAvailable bool
}

func inspectAppInstallation(app App) AppInstallation {
	installation := AppInstallation{Package: filepath.Base(app.Root), Manifest: app.Manifest}
	status, err := gitStatus(app.Root)
	if err != nil {
		installation.Status = "本地开发包或非 Git 包"
		return installation
	}
	installation.Manageable = true
	installation.Repository = status.Repository
	installation.Revision = status.Revision
	installation.Branch = status.Branch
	installation.Dirty = status.Dirty
	installation.UpdateAvailable = status.UpdateAvailable
	return installation
}

func gitStatus(root string) (gitCheckoutStatus, error) {
	status := gitCheckoutStatus{}
	if output, err := gitCommand(root, "rev-parse", "--is-inside-work-tree"); err != nil || strings.TrimSpace(output) != "true" {
		return status, errors.New("not a Git checkout")
	}
	branch, err := gitCommand(root, "status", "--porcelain=v1", "--branch")
	if err != nil {
		return status, err
	}
	lines := strings.Split(strings.TrimSpace(branch), "\n")
	if len(lines) > 0 {
		header := strings.TrimPrefix(lines[0], "## ")
		status.UpdateAvailable = strings.Contains(header, "behind ")
		status.Branch = strings.Fields(strings.Split(header, "...")[0])[0]
		status.Dirty = len(lines) > 1
	}
	status.Revision, _ = gitCommand(root, "rev-parse", "--short=12", "HEAD")
	status.Revision = strings.TrimSpace(status.Revision)
	status.Repository, _ = gitCommand(root, "config", "--get", "remote.origin.url")
	status.Repository = strings.TrimSpace(status.Repository)
	return status, nil
}

func refreshGitRemote(root string) error {
	if repository, err := gitCommand(root, "config", "--get", "remote.origin.url"); err != nil || strings.TrimSpace(repository) == "" {
		return nil
	}
	if output, err := gitCommand(root, "fetch", "--quiet", "origin"); err != nil {
		return fmt.Errorf("无法检查远端更新: %s", gitError(output, err))
	}
	return nil
}

func normalizeGitHubRepository(raw string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Host, "github.com") {
		return "", "", errors.New("only an HTTPS github.com repository URL is accepted")
	}
	parts := strings.Split(strings.Trim(strings.TrimSuffix(parsed.Path, ".git"), "/"), "/")
	if len(parts) != 2 || !validPackageName(parts[0]) || !validPackageName(parts[1]) {
		return "", "", errors.New("GitHub repository URL must be https://github.com/<owner>/<repository>")
	}
	return "https://github.com/" + parts[0] + "/" + parts[1] + ".git", parts[0] + "--" + parts[1], nil
}

func validPackageName(value string) bool {
	return value != "" && !strings.ContainsAny(value, "/\\") && value != "." && value != ".."
}

func gitCommand(dir string, arguments ...string) (string, error) {
	context, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(context, "git", append([]string{"-C", dir}, arguments...)...)
	output, err := command.CombinedOutput()
	return string(output), err
}

func gitError(output string, err error) string {
	if trimmed := strings.TrimSpace(output); trimmed != "" {
		return trimmed
	}
	return err.Error()
}

func sortInstallations(installations []AppInstallation) {
	for index := 1; index < len(installations); index++ {
		for cursor := index; cursor > 0 && installations[cursor].Manifest.Name < installations[cursor-1].Manifest.Name; cursor-- {
			installations[cursor], installations[cursor-1] = installations[cursor-1], installations[cursor]
		}
	}
}
