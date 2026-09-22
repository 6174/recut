/*
 * [INPUT]: 依赖 AppHost（store/media/async/capabilities）、Target 与项目文件根。
 * [OUTPUT]: editor Go 域运行上下文：scope、appstate DB、文件读写（项目根；全局目标时为
 *           平台文件根，见 Store.PlatformFilesRoot）、事件广播、媒体/能力桥、封面与 callUI 原语。
 * [POS]: service editor 域的宿主适配层；让 Go 实现与 goja ctx.* 能力一一对应，App 授权来自 editor_app.go 的原生契约。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type editorContext struct {
	host      *AppHost
	target    Target
	app       App
	locale    Locale
	scopeID   string
	db        *sql.DB
	filesRoot string
	appRoot   string
}

func newEditorContext(host *AppHost, target Target, app App, locale Locale) (*editorContext, error) {
	db, err := host.store.AppStateDatabase(app.Manifest.ID)
	if err != nil {
		return nil, err
	}
	// 全局目标（无 App、无项目）没有项目文件根；平台全局素材（如 MG bundle/封面）
	// 的落盘由 mgHost 直接使用平台文件根，不依赖这里。
	filesRoot := ""
	switch {
	case target.IsProject():
		resolved, rootErr := host.store.ProjectFilesRoot(target.ProjectID)
		if rootErr != nil {
			return nil, rootErr
		}
		filesRoot = resolved
	case target.AppID != "":
		resolved, rootErr := host.store.AppStateFilesRoot(target.AppID)
		if rootErr != nil {
			return nil, rootErr
		}
		filesRoot = resolved
	}
	scopeID := ""
	if target.IsProject() {
		scopeID = target.ProjectID
	}
	return &editorContext{
		host:      host,
		target:    target,
		app:       app,
		locale:    locale,
		scopeID:   scopeID,
		db:        db,
		filesRoot: filesRoot,
		appRoot:   app.Root,
	}, nil
}

// emit 广播一条项目事件到 events 账本（前端 project WS channel 的数据源）。
func (c *editorContext) emit(eventType string, payload map[string]any) {
	if c.scopeID == "" {
		return
	}
	event := map[string]any{"type": eventType, "at": time.Now().UTC()}
	for k, v := range payload {
		event[k] = v
	}
	c.host.store.AppendEvent(c.scopeID, event)
}

func (c *editorContext) emitDocumentChanged(version int64, source string, details map[string]any) {
	payload := map[string]any{"version": version, "source": source}
	for k, v := range details {
		payload[k] = v
	}
	c.emit("project.document.changed", payload)
}

// ---- 项目文件读写 -----------------------------------------------------------
func editorSafeFile(root, rel string) (string, error) {
	clean := filepath.Clean(rel)
	if rel == "" || filepath.IsAbs(rel) || clean == "." || strings.HasPrefix(clean, "..") {
		return "", errors.New("file path escapes App sandbox")
	}
	return filepath.Join(root, clean), nil
}

func (c *editorContext) writeText(rel, content string) error {
	path, err := editorSafeFile(c.filesRoot, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func (c *editorContext) readText(rel string) (string, error) {
	path, err := editorSafeFile(c.filesRoot, rel)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (c *editorContext) writeBase64(rel, b64 string) error {
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		return err
	}
	path, err := editorSafeFile(c.filesRoot, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (c *editorContext) filesURL(rel string) string {
	return c.target.filesURL(c.app.Manifest.ID, rel)
}

func (c *editorContext) projectFilesRoot() string {
	return c.filesRoot
}

// ---- 封面 -------------------------------------------------------------------
func (c *editorContext) setCover(assetID string) (map[string]any, error) {
	project, err := c.host.setProjectCover(c.target, assetID)
	if err != nil {
		return nil, err
	}
	return normalizeCover(project.Cover), nil
}

func (c *editorContext) setCoverImage(rel, mimeType string) (map[string]any, error) {
	project, err := c.host.setProjectCoverFile(c.target, rel, mimeType)
	if err != nil {
		return nil, err
	}
	return normalizeCover(project.Cover), nil
}

func (c *editorContext) currentCover() map[string]any {
	project, err := c.host.store.Get(c.target.ProjectID)
	if err != nil {
		return nil
	}
	return normalizeCover(project.Cover)
}

// normalizeCover 把平台 ProjectCover 归一化为封面对外契约的 camelCase 形态。
func normalizeCover(cover *ProjectCover) map[string]any {
	if cover == nil {
		return nil
	}
	return map[string]any{
		"source":   cover.Source,
		"assetId":  cover.AssetID,
		"kind":     cover.Kind,
		"filePath": cover.FilePath,
		"mimeType": cover.MimeType,
	}
}

// ---- 媒体 -------------------------------------------------------------------
func (c *editorContext) mediaAvailable() bool {
	return c.host.media != nil
}

func (c *editorContext) importMediaFile(rel, name, mimeType string) (map[string]any, error) {
	if c.host.media == nil {
		return nil, errors.New("media service is unavailable")
	}
	path, err := editorSafeFile(c.filesRoot, rel)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if name == "" {
		name = filepath.Base(path)
	}
	asset, err := c.host.media.ImportMediaReader(name, mimeType, file)
	if err != nil {
		return nil, err
	}
	if c.target.IsProject() {
		if err := c.host.media.Attach(asset.ID, c.target.ProjectID); err != nil {
			return nil, err
		}
	}
	return importedAssetResult(asset), nil
}

func (c *editorContext) attachMedia(assetID string) error {
	if c.host.media == nil {
		return errors.New("media service is unavailable")
	}
	if _, err := c.host.media.GetAsset(assetID); err != nil {
		return fmt.Errorf("media.attach: asset not found: %s", assetID)
	}
	if c.target.IsProject() {
		return c.host.media.Attach(assetID, c.target.ProjectID)
	}
	return nil
}

// transcript 解析 completed 转写素材为 { language, segments }（与 ctx.media.transcript 同源）。
func (c *editorContext) transcript(assetID string) (map[string]any, bool) {
	if c.host.media == nil || assetID == "" {
		return nil, false
	}
	asset, err := c.host.media.GetAsset(assetID)
	if err != nil || asset.Status != "completed" {
		return nil, false
	}
	if _, jsonBytes, jsonErr := c.host.media.GetAssetPart(asset.ID, "transcript.json"); jsonErr == nil {
		var doc struct {
			Language string           `json:"language"`
			Duration float64          `json:"duration"`
			Segments []map[string]any `json:"segments"`
		}
		if err := json.Unmarshal(jsonBytes, &doc); err == nil {
			segments := make([]any, 0, len(doc.Segments))
			for _, s := range doc.Segments {
				segments = append(segments, map[string]any{"start": s["start"], "end": s["end"], "text": s["text"]})
			}
			return map[string]any{"language": doc.Language, "duration": doc.Duration, "segments": segments}, true
		}
	}
	if _, srtBytes, srtErr := c.host.media.GetAssetPart(asset.ID, "srt"); srtErr == nil {
		return map[string]any{"language": nil, "duration": float64(0), "segments": parseTranscriptSrt(string(srtBytes))}, true
	}
	return nil, false
}

func (c *editorContext) transcriptLookup() editorTranscriptLookup {
	return func(assetID string) (map[string]any, bool) {
		return c.transcript(assetID)
	}
}

// ---- 能力桥 -----------------------------------------------------------------
func (c *editorContext) capabilityInspect(appID string) map[string]any {
	return c.host.capabilityInspect(appID, c.locale)
}

func (c *editorContext) capabilityInvoke(appID, name string, input map[string]any) (map[string]any, error) {
	return c.host.capabilityInvoke(c.target, appID, name, input, "", c.locale)
}

// ---- 异步 Handle / App→UI RPC ----------------------------------------------
func (c *editorContext) callUI(method string, payload map[string]any, completeOp string, timeoutMs int) (map[string]any, error) {
	if !c.target.IsProject() {
		return nil, errors.New("callUI requires a project target")
	}
	if timeoutMs <= 0 {
		timeoutMs = 120000
	}
	op, err := c.host.async.Create("project", c.target.ProjectID, c.app.Manifest.ID, method, payload, completeOp, timeoutMs)
	if err != nil {
		return nil, err
	}
	c.host.store.AppendEvent(c.target.ProjectID, map[string]any{
		"type": "app.rpc.request", "id": op.ID, "method": method,
		"payload": payload, "appId": c.app.Manifest.ID, "at": time.Now().UTC(),
	})
	return map[string]any{"id": op.ID, "requestId": op.ID, "status": string(op.Status)}, nil
}

func (c *editorContext) asyncStatus(id string) (map[string]any, bool) {
	op, err := c.host.async.FindByID(id)
	if err != nil {
		return nil, false
	}
	return asyncOpView(op), true
}

// ---- 小工具 -----------------------------------------------------------------
func jsonEscapeFalse(v any) []byte {
	var buf strings.Builder
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(v); err != nil {
		return []byte("null")
	}
	return []byte(strings.TrimRight(buf.String(), "\n"))
}

func marshalJSONNoEscape(v any) string {
	return string(jsonEscapeFalse(v))
}
