/*
 * [INPUT]: 依赖 Catalog 的 manifest、Store 的目标命名空间与 App 全局状态、MediaService 与 goja JavaScript 运行时
 * [OUTPUT]: 对外提供 AppHost，按 Project/App-state 双 target 注入统一 ctx、受控项目封面设置、流式私有媒体导入，以及按 surface 执行 App background.js 的统一 operation handler
 * [POS]: service 的 capability runtime；JS 没有宿主权限，只能调用 manifest 明示的 recut API；平台表一律不进入 ctx.sqlite / ctx.appState
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// Target is the resolved state namespace for one App capability call. A Project
// target binds ctx.sqlite/files to the owner App's project Doc; an empty
// ProjectID binds them to the App's global appstate.
type Target struct {
	ProjectID string
	AppID     string
}

func (t Target) IsProject() bool { return t.ProjectID != "" }

type AppHost struct {
	catalog *Catalog
	store   *Store
	media   *MediaService
	jobs    *ShellJobManager
	python  *PythonRuntimeManager
}

func NewAppHost(catalog *Catalog, store *Store, media ...*MediaService) *AppHost {
	var platformMedia *MediaService
	if len(media) > 0 {
		platformMedia = media[0]
	}
	jobs := NewShellJobManager(store)
	return &AppHost{catalog: catalog, store: store, media: platformMedia, jobs: jobs, python: NewPythonRuntimeManager(store, jobs)}
}

func (h *AppHost) InvokeAPI(target Target, appID, name string, input map[string]any) (any, error) {
	app, err := h.requireApp(target, appID)
	if err != nil {
		return nil, err
	}
	if !declaresOperation(app.Manifest, name, "api") {
		return nil, fmt.Errorf("App %q does not expose API operation %q", appID, name)
	}
	return h.invoke(target, app, "operation", name, input)
}

func (h *AppHost) InvokeMCP(target Target, appID, name string, input map[string]any) (any, error) {
	app, err := h.requireApp(target, appID)
	if err != nil {
		return nil, err
	}
	if !declaresOperation(app.Manifest, name, "mcp") {
		return nil, fmt.Errorf("App %q does not expose MCP operation %q", appID, name)
	}
	return h.invoke(target, app, "operation", name, input)
}

// requireApp resolves the App package and enforces the Project ownership rule:
// a Project target may only be used by its owner App; any App may use its own
// appstate when no Project target is given.
func (h *AppHost) requireApp(target Target, appID string) (App, error) {
	app, ok := h.catalog.Get(appID)
	if !ok {
		return App{}, fmt.Errorf("app %q is unavailable", appID)
	}
	if target.IsProject() {
		if err := h.store.projectOwnedBy(target.ProjectID, appID); err != nil {
			return App{}, err
		}
	}
	return app, nil
}

func (h *AppHost) invoke(target Target, app App, group, name string, input map[string]any) (any, error) {
	runtime := goja.New()
	handlers := map[string]goja.Callable{}
	recut := runtime.NewObject()
	register := func(kind string) func(goja.FunctionCall) goja.Value {
		return func(call goja.FunctionCall) goja.Value {
			registeredName := call.Argument(0).String()
			handler, ok := goja.AssertFunction(call.Argument(1))
			if !ok {
				panic(runtime.NewTypeError("handler must be a function"))
			}
			handlers[kind+":"+registeredName] = handler
			return goja.Undefined()
		}
	}
	operation := runtime.NewObject()
	_ = operation.Set("register", register("operation"))
	_ = recut.Set("operation", operation)
	ctx, err := h.context(runtime, target, app)
	if err != nil {
		return nil, err
	}
	if err := runtime.Set("recut", recut); err != nil {
		return nil, err
	}
	script, err := os.ReadFile(filepath.Join(app.Root, app.Manifest.Background))
	if err != nil {
		return nil, err
	}
	if _, err := runtime.RunScript(app.Manifest.Background, string(script)); err != nil {
		return nil, fmt.Errorf("run App background: %w", err)
	}
	handler, ok := handlers[group+":"+name]
	if !ok {
		return nil, fmt.Errorf("App did not register %s handler %q", group, name)
	}
	result, err := handler(goja.Undefined(), runtime.ToValue(input), ctx)
	if err != nil {
		return nil, fmt.Errorf("run App handler: %w", err)
	}
	exported := result.Export()
	if target.IsProject() {
		h.store.AppendEvent(target.ProjectID, map[string]any{"type": "app.capability.completed", "appId": app.Manifest.ID, "kind": group, "name": name, "at": time.Now().UTC()})
	}
	return exported, nil
}

func (h *AppHost) context(runtime *goja.Runtime, target Target, app App) (*goja.Object, error) {
	ctx := runtime.NewObject()
	primaryFiles, err := h.store.TargetFilesRoot(target)
	if err != nil {
		return nil, err
	}
	if hasPermission(app.Manifest, "sqlite") {
		// A single sqlite interface per App: appstate/<appId>/storage.sqlite
		// holds both the App's global state and every Project it owns. The App
		// partitions its rows by ctx.project.id; ctx.project is null outside a
		// Project target. Platform tables never enter this database.
		db, err := h.store.AppStateDatabase(app.Manifest.ID)
		if err != nil {
			return nil, err
		}
		sqlite := runtime.NewObject()
		_ = sqlite.Set("execute", sqlExecute(runtime, db))
		_ = sqlite.Set("query", sqlQuery(runtime, db))
		_ = ctx.Set("sqlite", sqlite)
	}
	if hasPermission(app.Manifest, "files") {
		files := runtime.NewObject()
		_ = files.Set("readText", fileReadText(runtime, primaryFiles))
		_ = files.Set("writeText", fileWriteText(runtime, primaryFiles))
		_ = files.Set("list", fileList(runtime, primaryFiles))
		_ = files.Set("url", func(call goja.FunctionCall) goja.Value {
			path := safeSandboxFile(primaryFiles, call.Argument(0).String())
			if _, err := os.Stat(path); err != nil {
				panic(runtime.NewGoError(err))
			}
			return runtime.ToValue(target.filesURL(app.Manifest.ID, call.Argument(0).String()))
		})
		_ = ctx.Set("files", files)
		appStateRoot, err := h.store.AppStateFilesRoot(app.Manifest.ID)
		if err != nil {
			return nil, err
		}
		appFiles := runtime.NewObject()
		_ = appFiles.Set("readText", fileReadText(runtime, appStateRoot))
		_ = appFiles.Set("writeText", fileWriteText(runtime, appStateRoot))
		_ = appFiles.Set("list", fileList(runtime, appStateRoot))
		_ = ctx.Set("appFiles", appFiles)
	}
	if target.IsProject() {
		project, err := h.store.Get(target.ProjectID)
		if err != nil {
			return nil, err
		}
		projectContext := runtime.NewObject()
		_ = projectContext.Set("id", project.ID)
		_ = projectContext.Set("name", project.Name)
		_ = projectContext.Set("appId", project.AppID)
		_ = projectContext.Set("cover", project.Cover)
		_ = projectContext.Set("setCover", func(call goja.FunctionCall) goja.Value {
			input := map[string]any{}
			if err := runtime.ExportTo(call.Argument(0), &input); err != nil {
				panic(runtime.NewTypeError(err.Error()))
			}
			cover, err := h.setProjectCover(target, stringValue(input["assetId"]))
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			return runtime.ToValue(cover)
		})
		_ = ctx.Set("project", projectContext)
	} else {
		_ = ctx.Set("project", goja.Null())
	}
	if hasPermission(app.Manifest, "media.read") && h.media != nil {
		media := runtime.NewObject()
		_ = media.Set("materialize", func(call goja.FunctionCall) goja.Value {
			asset, err := h.media.GetAsset(strings.TrimSpace(call.Argument(0).String()))
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			if asset.Status != "completed" {
				panic(runtime.NewGoError(errors.New("source media is not ready")))
			}
			path, err := h.copyAssetToApp(primaryFiles, asset)
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			return runtime.ToValue(map[string]any{"assetId": asset.ID, "kind": asset.Kind, "mimeType": asset.MimeType, "path": path})
		})
		_ = ctx.Set("media", media)
	}
	if hasPermission(app.Manifest, "media.write") && h.media != nil {
		media := ctx.Get("media")
		var mediaObject *goja.Object
		if !goja.IsUndefined(media) {
			mediaObject = media.ToObject(runtime)
		} else {
			mediaObject = runtime.NewObject()
		}
		_ = mediaObject.Set("importFile", func(call goja.FunctionCall) goja.Value {
			input := map[string]any{}
			if err := runtime.ExportTo(call.Argument(0), &input); err != nil {
				panic(runtime.NewTypeError(err.Error()))
			}
			path := safeSandboxFile(primaryFiles, stringValue(input["path"]))
			content, err := os.Open(path)
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			defer content.Close()
			asset, err := h.media.ImportMediaReader(nonEmpty(stringValue(input["name"]), filepath.Base(path)), stringValue(input["mimeType"]), content)
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			if target.IsProject() {
				if err := h.media.Attach(asset.ID, target.ProjectID); err != nil {
					panic(runtime.NewGoError(err))
				}
			}
			return runtime.ToValue(map[string]any{
				"id":        asset.ID,
				"kind":      asset.Kind,
				"name":      asset.Name,
				"mimeType":  asset.MimeType,
				"sizeBytes": asset.SizeBytes,
				"status":    asset.Status,
				"createdAt": asset.CreatedAt.Format(time.RFC3339Nano),
			})
		})
		_ = ctx.Set("media", mediaObject)
	}
	if hasPermission(app.Manifest, "shell") {
		shell := runtime.NewObject()
		modelsRoot := filepath.Join(h.store.root, "models")
		_ = shell.Set("run", shellRun(runtime, h.jobs, h.python, target, app, primaryFiles, modelsRoot))
		_ = shell.Set("exec", shellRun(runtime, h.jobs, h.python, target, app, primaryFiles, modelsRoot))
		_ = shell.Set("start", shellStart(runtime, h.jobs, h.python, target, app, primaryFiles, modelsRoot))
		_ = shell.Set("status", shellStatus(runtime, h.jobs, target.ProjectID, app.Manifest.ID))
		_ = shell.Set("logs", shellLogs(runtime, h.jobs, target.ProjectID, app.Manifest.ID))
		_ = shell.Set("cancel", shellCancel(runtime, h.jobs, target.ProjectID, app.Manifest.ID))
		_ = ctx.Set("shell", shell)
	}
	if hasPermission(app.Manifest, "python") && app.Manifest.Runtime.Python != nil {
		modelsRoot := filepath.Join(h.store.root, "models")
		python := runtime.NewObject()
		_ = python.Set("status", pythonStatus(runtime, h.python, app))
		_ = python.Set("prepare", pythonPrepare(runtime, h.python, target.ProjectID, app, primaryFiles, modelsRoot))
		_ = python.Set("run", pythonRun(runtime, h.jobs, h.python, target.ProjectID, app, primaryFiles, modelsRoot))
		_ = ctx.Set("python", python)
	}
	if hasPermission(app.Manifest, "artifacts.publish") {
		artifacts := runtime.NewObject()
		_ = artifacts.Set("publish", func(call goja.FunctionCall) goja.Value {
			if !target.IsProject() {
				panic(runtime.NewGoError(errors.New("artifacts.publish requires a Project target")))
			}
			input := map[string]any{}
			if err := runtime.ExportTo(call.Argument(0), &input); err != nil {
				panic(runtime.NewTypeError(err.Error()))
			}
			artifactType, _ := input["type"].(string)
			artifact, err := h.store.PublishArtifact(target.ProjectID, app.Manifest.ID, artifactType, input["value"])
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			return runtime.ToValue(artifact)
		})
		_ = ctx.Set("artifacts", artifacts)
	}
	if hasPermission(app.Manifest, "media.compose") && h.media != nil {
		media := runtime.NewObject()
		_ = media.Set("compose", func(call goja.FunctionCall) goja.Value {
			input, err := composeMediaInput(runtime, call.Argument(0))
			if err != nil {
				panic(runtime.NewTypeError(err.Error()))
			}
			input.ProjectID = target.ProjectID
			asset, err := h.media.Compose(input)
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			return runtime.ToValue(map[string]any{
				"id":        asset.ID,
				"name":      asset.Name,
				"kind":      asset.Kind,
				"mimeType":  asset.MimeType,
				"status":    asset.Status,
				"metadata":  asset.Metadata,
				"createdAt": asset.CreatedAt,
			})
		})
		_ = ctx.Set("media", media)
	}
	return ctx, nil
}

func (h *AppHost) setProjectCover(target Target, assetID string) (Project, error) {
	if !target.IsProject() {
		return Project{}, errors.New("project.setCover requires a Project target")
	}
	if h.media == nil {
		return Project{}, errors.New("media service is unavailable")
	}
	asset, err := h.media.GetAsset(strings.TrimSpace(assetID))
	if err != nil {
		return Project{}, err
	}
	if asset.Status != "completed" {
		return Project{}, errors.New("cover media is not ready")
	}
	if asset.Kind != "image" && asset.Kind != "video" {
		return Project{}, errors.New("project cover must be an image or video Asset")
	}
	if err := h.media.Attach(asset.ID, target.ProjectID); err != nil {
		return Project{}, err
	}
	return h.store.SetProjectCover(target.ProjectID, ProjectCover{AssetID: asset.ID, Kind: asset.Kind})
}

func (t Target) filesURL(appID, path string) string {
	if t.IsProject() {
		return fmt.Sprintf("/v1/projects/%s/apps/%s/files/%s", t.ProjectID, appID, filepath.ToSlash(path))
	}
	return fmt.Sprintf("/v1/apps/%s/files/%s", appID, filepath.ToSlash(path))
}

// composeMediaInput crosses the JavaScript boundary through JSON rather than
// Go field names. Goja's direct struct export does not apply json tags, while
// App payloads intentionally use the stable camelCase HTTP/MCP contract.
func composeMediaInput(runtime *goja.Runtime, value goja.Value) (ComposeMediaInput, error) {
	payload := map[string]any{}
	if err := runtime.ExportTo(value, &payload); err != nil {
		return ComposeMediaInput{}, err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ComposeMediaInput{}, err
	}
	input := ComposeMediaInput{}
	if err := json.Unmarshal(encoded, &input); err != nil {
		return ComposeMediaInput{}, err
	}
	return input, nil
}

func sqlExecute(runtime *goja.Runtime, db *sql.DB) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		args, err := valuesArgument(runtime, call.Argument(1))
		if err != nil {
			panic(runtime.NewTypeError(err.Error()))
		}
		result, err := db.Exec(call.Argument(0).String(), args...)
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		affected, _ := result.RowsAffected()
		return runtime.ToValue(map[string]int64{"rowsAffected": affected})
	}
}

func sqlQuery(runtime *goja.Runtime, db *sql.DB) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		args, err := valuesArgument(runtime, call.Argument(1))
		if err != nil {
			panic(runtime.NewTypeError(err.Error()))
		}
		rows, err := db.Query(call.Argument(0).String(), args...)
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		defer rows.Close()
		columns, err := rows.Columns()
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		result := []map[string]any{}
		for rows.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				panic(runtime.NewGoError(err))
			}
			row := map[string]any{}
			for i, value := range values {
				if bytes, ok := value.([]byte); ok {
					row[columns[i]] = string(bytes)
				} else {
					row[columns[i]] = value
				}
			}
			result = append(result, row)
		}
		if err := rows.Err(); err != nil {
			panic(runtime.NewGoError(err))
		}
		return runtime.ToValue(result)
	}
}

func valuesArgument(runtime *goja.Runtime, value goja.Value) ([]any, error) {
	if goja.IsUndefined(value) || goja.IsNull(value) {
		return nil, nil
	}
	values := []any{}
	return values, runtime.ExportTo(value, &values)
}
func fileReadText(runtime *goja.Runtime, root string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		data, err := os.ReadFile(sandboxFile(root, call.Argument(0).String()))
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		return runtime.ToValue(string(data))
	}
}
func fileWriteText(runtime *goja.Runtime, root string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		path := sandboxFile(root, call.Argument(0).String())
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			panic(runtime.NewGoError(err))
		}
		if err := os.WriteFile(path, []byte(call.Argument(1).String()), 0o644); err != nil {
			panic(runtime.NewGoError(err))
		}
		return goja.Undefined()
	}
}
func fileList(runtime *goja.Runtime, root string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		path := sandboxFile(root, call.Argument(0).String())
		entries, err := os.ReadDir(path)
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		names := []string{}
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		return runtime.ToValue(names)
	}
}
func sandboxFile(root, path string) string {
	return safeSandboxFile(root, path)
}
func safeSandboxFile(root, path string) string {
	clean := filepath.Clean(path)
	if path == "" || filepath.IsAbs(path) || clean == "." || strings.HasPrefix(clean, "..") {
		panic(errors.New("file path escapes App sandbox"))
	}
	return filepath.Join(root, clean)
}

func shellRun(runtime *goja.Runtime, jobs *ShellJobManager, python *PythonRuntimeManager, target Target, app App, filesRoot, modelsRoot string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		input := shellInput(runtime, call.Argument(0), python, app, filesRoot, modelsRoot, false)
		job, err := jobs.Execute(input.withScope(target.ProjectID, app.Manifest.ID))
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		return runtime.ToValue(shellResult(job, jobs.Output(target.ProjectID, job.ID)))
	}
}

func shellStart(runtime *goja.Runtime, jobs *ShellJobManager, python *PythonRuntimeManager, target Target, app App, filesRoot, modelsRoot string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		input := shellInput(runtime, call.Argument(0), python, app, filesRoot, modelsRoot, true)
		job, err := jobs.Start(input.withScope(target.ProjectID, app.Manifest.ID))
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		return runtime.ToValue(shellJobMap(job))
	}
}
func shellStatus(runtime *goja.Runtime, jobs *ShellJobManager, projectID, appID string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		job, err := jobs.Status(projectID, appID, call.Argument(0).String())
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		return runtime.ToValue(shellJobMap(job))
	}
}
func shellLogs(runtime *goja.Runtime, jobs *ShellJobManager, projectID, appID string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		if _, err := jobs.Status(projectID, appID, call.Argument(0).String()); err != nil {
			panic(runtime.NewGoError(err))
		}
		logs, err := jobs.Logs(projectID, call.Argument(0).String())
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		mapped := make([]map[string]any, 0, len(logs))
		for _, entry := range logs {
			mapped = append(mapped, shellLogMap(entry))
		}
		return runtime.ToValue(mapped)
	}
}
func shellCancel(runtime *goja.Runtime, jobs *ShellJobManager, projectID, appID string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		if err := jobs.Cancel(projectID, appID, call.Argument(0).String()); err != nil {
			panic(runtime.NewGoError(err))
		}
		return goja.Undefined()
	}
}

type appShellInput struct {
	command        string
	args           []string
	dir            string
	env            []string
	timeoutSeconds int
}

func (input appShellInput) withScope(projectID, appID string) ShellJobStart {
	return ShellJobStart{ProjectID: projectID, AppID: appID, Command: input.command, Args: input.args, Dir: input.dir, Env: input.env, TimeoutSeconds: input.timeoutSeconds}
}
func shellInput(runtime *goja.Runtime, value goja.Value, python *PythonRuntimeManager, app App, filesRoot, modelsRoot string, allowIndefinite bool) appShellInput {
	input := value.ToObject(runtime)
	command := strings.TrimSpace(input.Get("command").String())
	arguments := []string{}
	if err := runtime.ExportTo(input.Get("args"), &arguments); err != nil {
		panic(runtime.NewTypeError("args must be an array of strings"))
	}
	timeout := int(input.Get("timeoutSeconds").ToInteger())
	if timeout == 0 && !allowIndefinite {
		timeout = 300
	}
	if command == "" || filepath.Base(command) != command || timeout < 0 || timeout > 7200 || (timeout == 0 && !allowIndefinite) {
		panic(runtime.NewTypeError("invalid shell command or timeoutSeconds"))
	}
	dir := app.Root
	cwd := optionalString(input.Get("cwd"))
	if cwd == "files" {
		dir = filesRoot
	}
	env := []string{"RECUT_APP_FILES_DIR=" + filesRoot, "RECUT_MODELS_DIR=" + modelsRoot, "RECUT_APP_ID=" + app.Manifest.ID}
	environmentName := optionalString(input.Get("environment"))
	if environmentName != "" {
		environment, err := python.Environment(app)
		if err != nil || environmentName != environment.Name || !environment.Ready {
			panic(runtime.NewTypeError("requested Python environment is unavailable"))
		}
		env = append(env, "RECUT_VENV="+environment.Path, "RECUT_PYTHON="+environment.Python, "PATH="+filepath.Join(environment.Path, "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
	}
	return appShellInput{command: command, args: arguments, dir: dir, env: env, timeoutSeconds: timeout}
}
func optionalString(value goja.Value) string {
	if value == nil || goja.IsUndefined(value) || goja.IsNull(value) {
		return ""
	}
	return value.String()
}
func shellResult(job ShellJob, output string) map[string]any {
	return map[string]any{"jobId": job.ID, "status": string(job.Status), "stdout": output, "exitCode": job.ExitCode, "error": job.Error}
}

// shellJobMap projects a ShellJob to the camelCase contract Apps consume.
// Goja does not apply encoding/json tags to struct projection and renders named
// string types (ShellJobStatus) as String objects, so both struct projection and
// raw Status would break Apps' strict `job.status === "running"` checks.
func shellJobMap(job ShellJob) map[string]any {
	return map[string]any{
		"id":        job.ID,
		"projectId": job.ProjectID,
		"appId":     job.AppID,
		"status":    string(job.Status),
		"command":   job.Command,
		"args":      job.Args,
		"exitCode":  job.ExitCode,
		"error":     job.Error,
	}
}

func shellLogMap(entry ShellJobLog) map[string]any {
	return map[string]any{
		"jobId":     entry.JobID,
		"sequence":  entry.Sequence,
		"stream":    entry.Stream,
		"text":      entry.Text,
		"timestamp": entry.Timestamp.UTC().Format(time.RFC3339Nano),
	}
}
func pythonStatus(runtime *goja.Runtime, manager *PythonRuntimeManager, app App) func(goja.FunctionCall) goja.Value {
	return func(goja.FunctionCall) goja.Value {
		environment, err := manager.Environment(app)
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		// Keep the JavaScript capability contract independent of Go exported-field
		// names. Apps consume camelCase properties, while Goja's struct projection
		// does not apply encoding/json tags to property lookup.
		return runtime.ToValue(map[string]any{
			"name":   environment.Name,
			"path":   environment.Path,
			"python": environment.Python,
			"ready":  environment.Ready,
			"error":  environment.Error,
		})
	}
}
func pythonPrepare(runtime *goja.Runtime, manager *PythonRuntimeManager, projectID string, app App, filesRoot, modelsRoot string) func(goja.FunctionCall) goja.Value {
	return func(goja.FunctionCall) goja.Value {
		job, err := manager.Prepare(projectID, app, filesRoot, modelsRoot)
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		return runtime.ToValue(shellJobMap(job))
	}
}
func pythonRun(runtime *goja.Runtime, jobs *ShellJobManager, manager *PythonRuntimeManager, projectID string, app App, filesRoot, modelsRoot string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		environment, err := manager.Environment(app)
		if err != nil || !environment.Ready {
			panic(runtime.NewTypeError("Python environment is not ready"))
		}
		arguments := []string{}
		if err := runtime.ExportTo(call.Argument(0), &arguments); err != nil {
			panic(runtime.NewTypeError("args must be an array of strings"))
		}
		job, err := jobs.Start(ShellJobStart{ProjectID: projectID, AppID: app.Manifest.ID, Command: environment.Python, Args: arguments, Dir: app.Root, Env: manager.environment(environment, filesRoot, modelsRoot), TimeoutSeconds: 7200})
		if err != nil {
			panic(runtime.NewGoError(err))
		}
		return runtime.ToValue(shellJobMap(job))
	}
}

func (h *AppHost) copyAssetToApp(root string, asset MediaAsset) (string, error) {
	path, _ := asset.Metadata["path"].(string)
	if path == "" {
		return "", errors.New("source media file is unavailable")
	}
	assetsRoot := filepath.Join(h.store.root, "media", "assets")
	relative, err := filepath.Rel(assetsRoot, path)
	if err != nil || relative == "." || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
		return "", errors.New("source media path is outside the managed media store")
	}
	source, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer source.Close()
	extension := filepath.Ext(path)
	if extension == "" || len(extension) > 10 {
		extension = ".bin"
	}
	relativeTarget := filepath.Join("inputs", asset.ID+extension)
	target := safeSandboxFile(root, relativeTarget)
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return "", err
	}
	destination, err := os.Create(target)
	if err != nil {
		return "", err
	}
	_, copyErr := io.Copy(destination, source)
	closeErr := destination.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	return filepath.ToSlash(relativeTarget), nil
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
func nonEmpty(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
func hasPermission(manifest Manifest, permission string) bool {
	for _, candidate := range manifest.Permissions {
		if candidate == permission {
			return true
		}
	}
	return false
}
func declaresOperation(manifest Manifest, name, surface string) bool {
	for _, operation := range manifest.Operations {
		if operation.Name != name {
			continue
		}
		for _, allowed := range operation.Surfaces {
			if allowed == surface {
				return true
			}
		}
	}
	return false
}
