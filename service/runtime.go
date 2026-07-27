/*
 * [INPUT]: 依赖 Catalog 的 manifest、Store 的隔离存储与 goja JavaScript 运行时
 * [OUTPUT]: 对外提供 AppHost，按 surface 执行 App background.js 的统一 operation handler
 * [POS]: service 的 capability runtime；JS 没有宿主权限，只能调用注入的 recut API
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dop251/goja"
)

type AppHost struct {
	catalog *Catalog
	store   *Store
}

func NewAppHost(catalog *Catalog, store *Store) *AppHost {
	return &AppHost{catalog: catalog, store: store}
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
		_ = ctx.Set("files", files)
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
	return ctx, nil
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
	clean := filepath.Clean(path)
	if path == "" || filepath.IsAbs(path) || clean == "." || strings.HasPrefix(clean, "..") {
		panic(errors.New("file path escapes App sandbox"))
	}
	return filepath.Join(root, clean)
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
