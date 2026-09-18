/*
 * [INPUT]: 依赖 esbuild Go API（TSX→ESM transform）与包内静态确定性扫描、形状校验。
 * [OUTPUT]: Build 结果：成功返回 bundle/bundleHash；失败返回结构化 error map（不覆盖 last-good）。
 * [POS]: motion_graphic 包的构建执行层；平台自己拥有构建契约，无 Node、无 App 私有脚本依赖。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
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

// forbiddenTokens 是确定性静态扫描的裸引用黑名单（禁止墙钟/随机源与自动播放 GSAP）。
var forbiddenTokens = []string{
	"Math.random",
	"Date.now",
	"performance.now",
	"new Date(",
	"setTimeout(",
	"setInterval(",
	"requestAnimationFrame",
	"crypto.random",
	".play(",
	".restart(",
	".resume(",
	"paused: false",
	"paused:false",
	"ScrollTrigger",
	"ScrollSmoother",
	"ScrollToPlugin",
	"Draggable",
	"InertiaPlugin",
	"Observer",
	"gsap.utils.random",
	`"random(`,
	`'random(`,
}

var (
	gsapTimelineRe    = regexp.MustCompile(`gsap\.timeline\s*\(`)
	gsapPausedRe      = regexp.MustCompile(`paused\s*:\s*true`)
	htmlSurfaceRe     = regexp.MustCompile(`surface\s*:\s*["']html["']`)
	htmlGSAPRe        = regexp.MustCompile(`(useTimeline|useGSAP|gsap\.)`)
	importSpecifierRe = regexp.MustCompile(`(?m)^[ \t]*import[ \t]+(?:[^"'\n]*?[ \t]+from[ \t]+)?["']([^"']+)["']`)
)

// staticScan 复刻原 component-build.js 的静态扫描：禁墙钟/随机源、禁自动播放，
// 且只允许 @recut/runtime 作为外部 import（单文件组件白名单）。
func staticScan(source string) []string {
	issues := []string{}
	for _, token := range forbiddenTokens {
		if strings.Contains(source, token) {
			issues = append(issues, token)
		}
	}
	for _, loc := range gsapTimelineRe.FindAllStringIndex(source, -1) {
		end := loc[1] + 200
		if end > len(source) {
			end = len(source)
		}
		if !gsapPausedRe.MatchString(source[loc[0]:end]) {
			issues = append(issues, "gsap.timeline 必须 paused:true（只经 seek/progress 驱动）")
		}
	}
	if htmlSurfaceRe.MatchString(source) && htmlGSAPRe.MatchString(source) {
		issues = append(issues, "surface html 不支持 GSAP（无 DOM ref / 每帧 innerHTML 重写）；请改用 surface: react")
	}
	for _, match := range importSpecifierRe.FindAllStringSubmatch(source, -1) {
		specifier := match[1]
		if specifier != "@recut/runtime" && !strings.HasPrefix(specifier, "@recut/runtime/") {
			issues = append(issues, "非法 import: "+specifier)
		}
	}
	return issues
}

// Build 执行构建闸：静态扫描 → esbuild 编译 → 形状校验 → 落盘 bundle。
// 三段校验顺序与语义与原 Node 工具链一致（--loose 路径不做 strict tsc）。
func Build(filesRoot, versionID, source string) Result {
	if issues := staticScan(source); len(issues) > 0 {
		return Result{Error: map[string]any{"ok": false, "type": "determinism", "issues": issues}}
	}

	transformed := api.Transform(source, api.TransformOptions{
		Loader:          api.LoaderTSX,
		JSX:             api.JSXAutomatic,
		JSXImportSource: "@recut/runtime",
		Format:          api.FormatESModule,
		Target:          api.ES2022,
		Sourcemap:       api.SourceMapInline,
	})
	if len(transformed.Errors) > 0 {
		return Result{Error: map[string]any{"ok": false, "type": "compile", "error": formatESBuildMessages(transformed.Errors)}}
	}
	bundle := string(transformed.Code)

	if shapeErrors := shapeCheck(bundle); len(shapeErrors) > 0 {
		return Result{Error: map[string]any{"ok": false, "type": "shape", "errors": shapeErrors}}
	}

	segment := safeSegment(versionID)
	componentsDir := filepath.Join(filesRoot, "components")
	if err := os.MkdirAll(componentsDir, 0o755); err != nil {
		return Result{Error: map[string]any{"ok": false, "type": "write", "error": err.Error()}}
	}
	if err := os.WriteFile(filepath.Join(componentsDir, segment+".js"), []byte(bundle), 0o644); err != nil {
		return Result{Error: map[string]any{"ok": false, "type": "write", "error": err.Error()}}
	}

	sum := sha256.Sum256([]byte(bundle))
	return Result{OK: true, Bundle: bundle, BundleHash: hex.EncodeToString(sum[:])}
}

func formatESBuildMessages(messages []api.Message) string {
	formatted := api.FormatMessages(messages, api.FormatMessagesOptions{Kind: api.ErrorMessage})
	return strings.TrimSpace(strings.Join(formatted, "\n"))
}
