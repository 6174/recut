/*
 * [INPUT]: 依赖 Catalog 的 manifest、Store 的隔离存储、MediaService 与 goja JavaScript 运行时
 * [OUTPUT]: 对外提供 AppHost，按 surface 执行 App background.js 的统一 operation handler，并按权限注入受限媒体合成能力
 * [POS]: service 的 capability runtime；JS 没有宿主权限，只能调用 manifest 明示的 recut API
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/dop251/goja"
)

type AppHost struct {
	catalog *Catalog
	store   *Store
	media   *MediaService
}

func NewAppHost(catalog *Catalog, store *Store, media ...*MediaService) *AppHost {
	var platformMedia *MediaService
	if len(media) > 0 {
		platformMedia = media[0]
	}
	return &AppHost{catalog: catalog, store: store, media: platformMedia}
}

func (h *AppHost) InvokeAPI(projectID, appID, name string, input map[string]any) (any, error) {
	app, err := h.projectApp(projectID, appID)
	if err != nil {
		return nil, err
	}
	if !declaresOperation(app.Manifest, name, "api") {
		return nil, fmt.Errorf("App %q does not expose API operation %q", appID, name)
	}
	return h.invoke(projectID, app, "operation", name, input)
}

func (h *AppHost) InvokeMCP(projectID, appID, name string, input map[string]any) (any, error) {
	app, err := h.projectApp(projectID, appID)
	if err != nil {
		return nil, err
	}
	if !declaresOperation(app.Manifest, name, "mcp") {
		return nil, fmt.Errorf("App %q does not expose MCP operation %q", appID, name)
	}
	return h.invoke(projectID, app, "operation", name, input)
}

func (h *AppHost) projectApp(projectID, appID string) (App, error) {
	if err := h.store.checkAppScope(projectID, appID); err != nil {
		return App{}, err
	}
	app, _ := h.catalog.Get(appID)
	return app, nil
}

func (h *AppHost) invoke(projectID string, app App, group, name string, input map[string]any) (any, error) {
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
	ctx, err := h.context(runtime, projectID, app)
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
	h.store.AppendEvent(projectID, map[string]any{"type": "app.capability.completed", "appId": app.Manifest.ID, "kind": group, "name": name, "at": time.Now().UTC()})
	return exported, nil
}

func (h *AppHost) context(runtime *goja.Runtime, projectID string, app App) (*goja.Object, error) {
	ctx := runtime.NewObject()
	if hasPermission(app.Manifest, "sqlite") {
		db, err := h.store.AppDatabase(projectID, app.Manifest.ID)
		if err != nil {
			return nil, err
		}
		sqlite := runtime.NewObject()
		_ = sqlite.Set("execute", sqlExecute(runtime, db))
		_ = sqlite.Set("query", sqlQuery(runtime, db))
		_ = ctx.Set("sqlite", sqlite)
	}
	if hasPermission(app.Manifest, "files") {
		root, err := h.store.AppFilesRoot(projectID, app.Manifest.ID)
		if err != nil {
			return nil, err
		}
		files := runtime.NewObject()
		_ = files.Set("readText", fileReadText(runtime, root))
		_ = files.Set("writeText", fileWriteText(runtime, root))
		_ = files.Set("list", fileList(runtime, root))
		_ = files.Set("url", func(call goja.FunctionCall) goja.Value {
			path := safeSandboxFile(root, call.Argument(0).String())
			if _, err := os.Stat(path); err != nil {
				panic(runtime.NewGoError(err))
			}
			return runtime.ToValue(fmt.Sprintf("/v1/projects/%s/apps/%s/files/%s", projectID, app.Manifest.ID, filepath.ToSlash(call.Argument(0).String())))
		})
		_ = ctx.Set("files", files)
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
			root, err := h.store.AppFilesRoot(projectID, app.Manifest.ID)
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			path, err := h.copyAssetToApp(root, asset)
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
			root, err := h.store.AppFilesRoot(projectID, app.Manifest.ID)
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			path := safeSandboxFile(root, stringValue(input["path"]))
			content, err := os.ReadFile(path)
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			asset, err := h.media.ImportMedia(nonEmpty(stringValue(input["name"]), filepath.Base(path)), stringValue(input["mimeType"]), content)
			if err != nil {
				panic(runtime.NewGoError(err))
			}
			return runtime.ToValue(asset)
		})
		_ = ctx.Set("media", mediaObject)
	}
	if hasPermission(app.Manifest, "shell") {
		root, err := h.store.AppFilesRoot(projectID, app.Manifest.ID)
		if err != nil {
			return nil, err
		}
		shell := runtime.NewObject()
		_ = shell.Set("run", shellRun(runtime, app.Root, root, filepath.Join(h.store.root, "models"), app.Manifest.ID))
		_ = ctx.Set("shell", shell)
	}
	if hasPermission(app.Manifest, "artifacts.publish") {
		artifacts := runtime.NewObject()
		_ = artifacts.Set("publish", func(call goja.FunctionCall) goja.Value {
			input := map[string]any{}
			if err := runtime.ExportTo(call.Argument(0), &input); err != nil {
				panic(runtime.NewTypeError(err.Error()))
			}
			artifactType, _ := input["type"].(string)
			artifact, err := h.store.PublishArtifact(projectID, app.Manifest.ID, artifactType, input["value"])
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
			input.ProjectID = projectID
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

func shellRun(runtime *goja.Runtime, appRoot, filesRoot, modelsRoot, appID string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		input := call.Argument(0).ToObject(runtime)
		commandName := input.Get("command").String()
		arguments := []string{}
		if err := runtime.ExportTo(input.Get("args"), &arguments); err != nil {
			panic(runtime.NewTypeError("args must be an array of strings"))
		}
		timeoutSeconds := int(input.Get("timeoutSeconds").ToInteger())
		if commandName != "python3" && commandName != "python" {
			panic(runtime.NewTypeError("shell only permits python or python3"))
		}
		if timeoutSeconds < 1 || timeoutSeconds > 1800 {
			panic(runtime.NewTypeError("timeoutSeconds must be between 1 and 1800"))
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, commandName, arguments...)
		command.Dir = appRoot
		command.Env = append(os.Environ(), "RECUT_APP_FILES_DIR="+filesRoot, "RECUT_MODELS_DIR="+modelsRoot, "RECUT_APP_ID="+appID)
		output, err := command.CombinedOutput()
		result := map[string]any{"stdout": string(output), "exitCode": 0}
		if err == nil {
			return runtime.ToValue(result)
		}
		result["exitCode"] = 1
		if exit, ok := err.(*exec.ExitError); ok {
			result["exitCode"] = exit.ExitCode()
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			result["error"] = "process timed out"
		} else {
			result["error"] = err.Error()
		}
		return runtime.ToValue(result)
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
