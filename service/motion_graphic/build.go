/*
 * [INPUT]: 依赖 App 自带 component-build.js（esbuild + shape + 确定性扫描）与 node。
 * [OUTPUT]: Build 结果：成功返回 bundle/bundleHash；失败返回结构化 error map（不覆盖 last-good）。
 * [POS]: motion_graphic 包的构建执行层；平台拥有构建契约，编辑侧不再私有组件构建。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Result 是一次组件构建的结果。
type Result struct {
	OK         bool
	Bundle     string
	BundleHash string
	Error      map[string]any
}

func safeSegment(value string) string {
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.', r == '@':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "component"
	}
	return b.String()
}

// Build writes the source, runs the build script with --loose, and reads the bundle.
func Build(appRoot, filesRoot, versionID, source string) Result {
	segment := safeSegment(versionID)
	componentsDir := filepath.Join(filesRoot, "components")
	if err := os.MkdirAll(componentsDir, 0o755); err != nil {
		return Result{Error: map[string]any{"ok": false, "type": "write", "error": err.Error()}}
	}
	srcPath := filepath.Join(componentsDir, segment+".tsx")
	outPath := filepath.Join(componentsDir, segment+".js")
	if err := os.WriteFile(srcPath, []byte(source), 0o644); err != nil {
		return Result{Error: map[string]any{"ok": false, "type": "write", "error": err.Error()}}
	}
	script := filepath.Join(appRoot, "scripts", "component-build.js")
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", script, srcPath, outPath, "--loose")
	cmd.Dir = filesRoot
	raw, _ := cmd.Output()
	parsed := map[string]any{}
	if json.Unmarshal(raw, &parsed) != nil {
		return Result{Error: map[string]any{"ok": false, "error": "component-build produced no parseable output"}}
	}
	if parsed["ok"] != true {
		return Result{Error: parsed}
	}
	bundleBytes, err := os.ReadFile(outPath)
	if err != nil {
		return Result{Error: map[string]any{"ok": false, "type": "read", "error": err.Error()}}
	}
	return Result{OK: true, Bundle: string(bundleBytes), BundleHash: str(parsed["bundleHash"])}
}
