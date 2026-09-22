/*
 * [INPUT]: 依赖 editorContext/editor_store/editor_model/editor_ops/editor_script。
 * [OUTPUT]: 项目、时间线、字幕、文稿、混音、目录、封面、导出与出帧 operation 的 Go 权威实现（project-operations/catalog-export/frame-render/subtitle-generate/assets 的等价物）。
 * [POS]: service editor 域的 operation 适配层；所有 mutation 委托 executeCommand，读模型直接消费纯函数。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"recut-service/motion_graphic"
)

// editorNativeHandlers 是 recut.editor 由 Go 权威承担的 operation 集合；未列出的 op 才回退到 goja background。
// motion-graphic.* 已平台化（recut.motion-graphic.*，见 motion_graphic_platform.go / motion_graphic_bridge.go）。
var editorNativeHandlers map[string]func(*editorContext, map[string]any) (any, error)

func init() {
	editorNativeHandlers = map[string]func(*editorContext, map[string]any) (any, error){
		"project.create":           editorProjectCreate,
		"project.load":             editorProjectLoad,
		"project.save":             editorProjectSave,
		"workflow.context":         editorWorkflowContext,
		"project.get":              editorProjectGet,
		"timeline.read":            editorTimelineRead,
		"element.get":              editorElementGet,
		"timeline.validate":        editorTimelineValidate,
		"project.updateSettings":   editorUpdateSettings,
		"project.lock":             editorProjectLock,
		"project.unlock":           editorProjectUnlock,
		"timeline.command":         editorTimelineCommand,
		"timeline.placeComponents": editorPlaceComponents,
		"timeline.placeAudio":      editorPlaceAudio,
		"history.undo":             editorHistoryUndo,
		"history.redo":             editorHistoryRedo,
		"timeline.delta":           editorTimelineDelta,
		"work.checkpoint":          editorWorkCheckpoint,
		"work.cancel":              editorWorkCancel,
		"subtitle.import":          editorSubtitleImport,
		"subtitle.export":          editorSubtitleExport,
		"script.attach":            editorScriptAttach,
		"script.read":              editorScriptRead,
		"script.apply":             editorScriptApply,
		"script.clean":             editorScriptClean,
		"script.find":              editorScriptFind,
		"script.fix-transcript":    editorScriptFixTranscript,
		"track.role":               editorTrackRole,
		"audio.smooth":             editorAudioSmooth,
		"library.browse":           editorLibraryBrowse,
		"export.start":             editorExportStart,
		"export.progress":          editorExportProgress,
		"export.complete":          editorExportComplete,
		"export.finalize":          editorExportFinalize,
		"export.list":              editorExportList,
		"cover.update":             editorCoverUpdate,
		"cover.get":                editorCoverGet,
		"cover.set-frame":          editorCoverSetFrame,
		"cover.set-asset":          editorCoverSetAsset,
		"cover.set-auto":           editorCoverSetAuto,
		"film.package.import":      editorFilmPackageImport,
		"frame.heartbeat":          editorFrameHeartbeat,
		"preview.frame":            editorPreviewFrame,
		"preview.batch":            editorPreviewBatch,
		"preview.contact-sheet":    editorPreviewContactSheet,
		"frame.finalize":           editorFrameFinalize,
		"asset.list":               editorAssetList,
		"asset.add":                editorAssetAdd,
		"asset.remove":             editorAssetRemove,
		"asset.archive":            editorAssetArchive,
		"subtitle.capabilities":    editorSubtitleCapabilities,
		"subtitle.generate":        editorSubtitleGenerate,
		"subtitle.status":          editorSubtitleStatus,
		"subtitle.cancel":          editorSubtitleCancel,
		"subtitle.retry-save":      editorSubtitleRetrySave,
		"subtitle.commit":          editorSubtitleCommit,
	}
}

func editorError(message string) error {
	return &mcpError{Kind: "business", Code: "invalid-request", Message: message}
}

func editorErrorWithCode(code, message, hint string, retryable bool, data any) error {
	return &mcpError{Kind: "business", Code: code, Message: message, Hint: hint, Retryable: retryable, Data: data}
}

// ---- 项目 -------------------------------------------------------------------
func editorProjectCreate(c *editorContext, input map[string]any) (any, error) {
	c.ensureSchema()
	project := makeDefaultProject(c.scopeID, edStr(input["name"]), edMap(input["settings"]), edSlice(input["materialAssetIds"]), c.locale)
	materials := edSlice(input["materialAssetIds"])
	if materials == nil {
		materials = []any{}
	}
	_, err := c.db.Exec("insert into editor_projects (project_id, project_json, version, updated_at) values (?, ?, ?, ?) "+
		"on conflict(project_id) do update set project_json = excluded.project_json, version = excluded.version, updated_at = excluded.updated_at",
		c.scopeID, marshalJSONNoEscape(project), 1, nowIso())
	if err != nil {
		return nil, err
	}
	return map[string]any{"projectId": c.scopeID, "project": project, "version": 1}, nil
}

func editorProjectLoad(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		project := makeDefaultProject(c.scopeID, "", nil, nil, c.locale)
		c.writeProject(project, nil)
		return map[string]any{"project": project, "version": 1}, nil
	}
	return map[string]any{"project": existing.Project, "version": existing.Version}, nil
}

func editorProjectSave(c *editorContext, input map[string]any) (any, error) {
	if edMap(input["project"]) == nil {
		return nil, editorError("project.save: missing project")
	}
	lock := c.readLock()
	if lock != nil && !lockExpired(lock) {
		return map[string]any{"ok": false, "locked": true, "lock": map[string]any{"owner": lock["owner"]}}, nil
	}
	var baseVersion *int64
	if input["baseVersion"] != nil && edIsNum(input["baseVersion"]) {
		v := int64(edNum(input["baseVersion"]))
		baseVersion = &v
	}
	write := c.writeProject(edMap(input["project"]), baseVersion)
	if !okBool(write["ok"]) {
		return map[string]any{"ok": false, "conflict": true, "currentVersion": write["currentVersion"]}, nil
	}
	c.emitDocumentChanged(int64(edNum(write["version"])), "ui", nil)
	return map[string]any{"ok": true, "version": write["version"], "savedAt": nowIso()}, nil
}

var editorFullActions = []string{
	"timeline.read", "element.get", "timeline.validate", "timeline.command", "timeline.placeComponents", "timeline.placeAudio",
	"timeline.delta", "history.undo", "history.redo", "project.lock", "project.unlock", "work.checkpoint", "work.cancel",
	"asset.list", "asset.add", "asset.remove", "asset.archive", "film.package.import", "subtitle.import", "subtitle.export", "subtitle.capabilities",
	"subtitle.generate", "subtitle.status", "subtitle.commit", "subtitle.cancel", "subtitle.retry-save", "script.read",
	"script.apply", "script.clean", "script.find", "script.fix-transcript", "script.attach", "track.role", "audio.smooth",
	"library.browse", "preview.frame", "preview.batch", "preview.contact-sheet", "export.start", "cover.get",
}

var editorInitialActions = []string{
	"project.create", "film.package.import", "timeline.command", "timeline.placeComponents", "asset.list", "asset.add", "asset.remove", "asset.archive",
	"subtitle.import", "subtitle.export", "subtitle.capabilities", "subtitle.generate", "subtitle.status", "subtitle.commit",
	"subtitle.cancel", "subtitle.retry-save", "script.attach", "track.role", "library.browse",
}

func editorWorkflowContext(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	var project map[string]any
	if existing != nil {
		project = existing.Project
	}
	condensed := condensedTimeline(project)
	lock := c.readLock()
	hasProject := existing != nil && project != nil
	hasElements := len(edSlice(condensed["clips"])) > 0
	locked := lock != nil && !lockExpired(lock)
	stage := "brief"
	if hasProject {
		if hasElements {
			stage = "editing"
		} else {
			stage = "ready"
		}
	}
	nextAction := "create_project"
	if hasProject {
		if hasElements {
			nextAction = "edit_timeline"
		} else {
			nextAction = "add_content"
		}
	}
	allowed := editorInitialActions
	if hasProject {
		allowed = editorFullActions
	}
	var settings any
	if project != nil && project["settings"] != nil {
		settings = project["settings"]
	}
	version := int64(0)
	if existing != nil {
		version = existing.Version
	}
	var aiLock any
	if locked {
		aiLock = map[string]any{"owner": lock["owner"], "since": lock["since"]}
	}
	return map[string]any{
		"projectId":       c.scopeID,
		"stage":           stage,
		"settings":        settings,
		"timeline":        map[string]any{"elements": len(edSlice(condensed["clips"])), "tracks": len(edSlice(condensed["tracks"]))},
		"durationSeconds": condensed["durationSec"],
		"version":         version,
		"aiLock":          aiLock,
		"nextAction":      nextAction,
		"allowedActions":  allowed,
		"authoring": map[string]any{
			"incrementalSync": true, "workUnits": true, "previewBatch": true, "contactSheet": true,
			"headlessPreview": false, "headlessExport": false,
		},
		"capabilities": map[string]any{
			"preview.frame": "ui-only", "preview.batch": "ui-only", "preview.contact-sheet": "ui-only",
			"export.start": "ui-async", "timeline.delta": true, "work.checkpoint": true, "work.cancel": true, "headless": false,
		},
		"paths": map[string]any{"appRoot": c.appRoot, "projectFilesRoot": c.filesRoot},
	}, nil
}

func editorProjectGet(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	var project map[string]any
	if existing != nil {
		project = existing.Project
	}
	lock := c.readLock()
	var name any
	var settings any
	if project != nil {
		if metadata := edMap(project["metadata"]); metadata != nil {
			name = metadata["name"]
		}
		if project["settings"] != nil {
			settings = project["settings"]
		}
	}
	version := int64(0)
	if existing != nil {
		version = existing.Version
	}
	var aiLock any
	if lock != nil && !lockExpired(lock) {
		aiLock = map[string]any{"owner": lock["owner"], "since": lock["since"]}
	}
	var materialIds any = []any{}
	if project != nil && project["materialAssetIds"] != nil {
		materialIds = project["materialAssetIds"]
	}
	return map[string]any{
		"name":             name,
		"settings":         settings,
		"version":          version,
		"durationSec":      projectDurationTicks(project) / editorTicksPerSecond,
		"materialAssetIds": materialIds,
		"aiLock":           aiLock,
	}, nil
}

func editorTimelineRead(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	var project map[string]any
	if existing != nil {
		project = existing.Project
	}
	condensed := condensedTimeline(project)
	lock := c.readLock()
	var aiLock any
	if lock != nil && !lockExpired(lock) {
		aiLock = map[string]any{"owner": lock["owner"]}
	}
	version := int64(0)
	if existing != nil {
		version = existing.Version
	}
	return map[string]any{
		"version":        version,
		"currentSceneId": condensed["currentSceneId"],
		"durationSec":    condensed["durationSec"],
		"settings":       condensed["settings"],
		"tracks":         condensed["tracks"],
		"clips":          condensed["clips"],
		"aiLock":         aiLock,
	}, nil
}

func editorElementGet(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["trackId"]) == "" || edStr(input["elementId"]) == "" {
		return nil, editorError("element.get: trackId + elementId required")
	}
	existing := c.readProject()
	var project map[string]any
	if existing != nil {
		project = existing.Project
	}
	detail := elementDetail(project, map[string]any{"trackId": input["trackId"], "elementId": input["elementId"]})
	if detail == nil {
		return nil, editorError("element.get: element not found")
	}
	version := int64(0)
	if existing != nil {
		version = existing.Version
	}
	return map[string]any{"version": version, "element": detail}, nil
}

func editorTimelineValidate(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	var project map[string]any
	if existing != nil {
		project = existing.Project
	}
	rows, err := queryMaps(c.db, "select ref_id from editor_assets where project_id = ? and type = 'component' and status = 'active'", c.scopeID)
	if err != nil {
		return nil, err
	}
	componentIDs := []string{}
	for _, row := range rows {
		componentIDs = append(componentIDs, edStr(row["ref_id"]))
	}
	violations := validateTimeline(project, componentIDs)
	version := int64(0)
	if existing != nil {
		version = existing.Version
	}
	return map[string]any{"version": version, "ok": len(violations) == 0, "violations": violations}, nil
}

func editorUpdateSettings(c *editorContext, input map[string]any) (any, error) {
	op := map[string]any{"type": "settings", "payload": map[string]any{"fps": input["fps"], "canvasSize": input["canvasSize"], "background": input["background"]}}
	if input["baseVersion"] != nil && edIsNum(input["baseVersion"]) {
		op["baseVersion"] = input["baseVersion"]
	}
	out := c.executeCommand(op)
	if okBool(out["ok"]) {
		if current := c.readProject(); current != nil && current.Project != nil {
			out["settings"] = current.Project["settings"]
		}
	}
	return out, nil
}

func editorProjectLock(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return nil, editorError("project.lock: project not found")
	}
	lock := c.readLock()
	if lock != nil && !lockExpired(lock) {
		return map[string]any{"ok": false, "locked": true, "lock": map[string]any{"owner": lock["owner"]}}, nil
	}
	owner := nonEmpty(edStr(input["owner"]), "agent")
	token := c.lockToken()
	c.writeLock(owner, token)
	c.emit("project:locked", map[string]any{"owner": owner, "version": existing.Version})
	return map[string]any{"ok": true, "lock": map[string]any{"owner": owner, "token": token, "since": nowIso()}, "version": existing.Version}, nil
}

func editorProjectUnlock(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	lock := c.readLock()
	if lock != nil && !lockExpired(lock) {
		owner := edStr(input["owner"])
		token := edStr(input["token"])
		if owner == "" || owner != edStr(lock["owner"]) {
			return map[string]any{"ok": false, "locked": true, "reason": "lock-owner-mismatch", "lock": map[string]any{"owner": lock["owner"]}}, nil
		}
		if token == "" || edStr(lock["token"]) == "" || token != edStr(lock["token"]) {
			return map[string]any{"ok": false, "locked": true, "reason": "lock-token-mismatch", "lock": map[string]any{"owner": lock["owner"]}}, nil
		}
	}
	c.clearLock()
	version := int64(0)
	if existing != nil {
		version = existing.Version
	}
	c.emit("project:unlocked", map[string]any{"version": version})
	c.emitDocumentChanged(version, "agent", nil)
	return map[string]any{"ok": true, "version": version}, nil
}

// ---- 组件引用归一化（组件存储归 M2 background；此处只解析引用）------------------
func editorProjectAssetID(assetType, refID string) string {
	return assetType + ":" + refID
}

func (c *editorContext) resolveComponentAsset(assetID string) (string, error) {
	c.ensureSchema()
	rows, err := queryMaps(c.db, "select asset_id, type, ref_id, status from editor_assets where project_id = ? and asset_id = ?", c.scopeID, assetID)
	if err != nil {
		return "", err
	}
	if len(rows) > 0 {
		asset := rows[0]
		if edStr(asset["type"]) == "component" && edStr(asset["status"]) == "active" {
			return edStr(asset["ref_id"]), nil
		}
	}
	// 项目侧的组件引用索引里没有（或已归档）：若 id 指向一个全局 verified 组件，则「用到时」自动
	// 登记一条项目引用。引用只落在项目侧（editor_assets，与 media_asset_projects 同构），全局
	// mg_materials 不存反向项目索引。
	if id, ok := c.registerGlobalComponentRef(assetID); ok {
		return id, nil
	}
	return "", editorError("timeline component asset is missing or archived: " + assetID)
}

// registerGlobalComponentRef 把 `component:<id>` 指向的全局 verified Motion Graphic 登记为当前项目的
// 组件引用（写项目侧 editor_assets）。仅认 `component:` 前缀；非组件 id、或组件不存在/未 verified/
// 已归档时返回 ok=false，由调用方决定报错。没有项目目标时无项目可登记，同样返回 false。
func (c *editorContext) registerGlobalComponentRef(assetID string) (string, bool) {
	if !strings.HasPrefix(assetID, "component:") || c.scopeID == "" {
		return "", false
	}
	id := strings.TrimPrefix(assetID, "component:")
	if id == "" {
		return "", false
	}
	db, err := c.host.store.WorkspaceDatabase()
	if err != nil {
		return "", false
	}
	material, ok := motion_graphic.Read(db, id)
	if !ok || material.Status != "verified" || material.ArchivedAt != "" {
		return "", false
	}
	c.upsertComponentAssetRef(id, material.VersionID())
	// 统一素材库的项目成员关系（与媒体同构）在「使用时」建立：把全局组件投影进 media_assets
	// 并 attach 到本项目（scopeID 非空），使素材面板可见。verify 时只做全局投影、不挂项目。
	mgHost{c: c}.projectComponentAsset(id, material.VersionID())
	return id, true
}

func (c *editorContext) normalizeComponentItems(items []any) ([]any, error) {
	out := []any{}
	for _, itemValue := range items {
		item := edMap(itemValue)
		next := map[string]any{}
		for k, v := range item {
			next[k] = v
		}
		var fromAsset string
		if edStr(next["assetId"]) != "" {
			resolved, err := c.resolveComponentAsset(edStr(next["assetId"]))
			if err != nil {
				return nil, err
			}
			fromAsset = resolved
		}
		if fromAsset != "" && edStr(next["componentId"]) != "" && fromAsset != edStr(next["componentId"]) {
			return nil, editorError("timeline component assetId and componentId do not match")
		}
		componentID := fromAsset
		if componentID == "" {
			componentID = edStr(next["componentId"])
		}
		if componentID == "" {
			return nil, editorError("timeline component requires assetId")
		}
		next["componentId"] = componentID
		if edStr(next["assetId"]) == "" {
			next["assetId"] = motion_graphic.AssetID(componentID)
		}
		out = append(out, next)
	}
	return out, nil
}

func (c *editorContext) normalizeComponentAssetOp(op map[string]any) (map[string]any, error) {
	normalized := map[string]any{"type": op["type"]}
	payload := map[string]any{}
	for k, v := range edMap(op["payload"]) {
		payload[k] = v
	}
	normalized["payload"] = payload
	if op["baseVersion"] != nil {
		normalized["baseVersion"] = op["baseVersion"]
	}
	if op["transactionId"] != nil {
		normalized["transactionId"] = op["transactionId"]
	}
	if edStr(op["type"]) == "component-placement" {
		items, err := c.normalizeComponentItems(edSlice(payload["items"]))
		if err != nil {
			return nil, err
		}
		payload["items"] = items
	} else if edStr(op["type"]) == "insert" {
		element := edMap(payload["element"])
		if element != nil && edStr(element["type"]) == "component" {
			items, err := c.normalizeComponentItems([]any{element})
			if err != nil {
				return nil, err
			}
			payload["element"] = items[0]
		}
	}
	return normalized, nil
}

func editorTimelineCommand(c *editorContext, input map[string]any) (any, error) {
	op := edMap(input["op"])
	if op == nil || edStr(op["type"]) == "" {
		return nil, editorError("timeline.command: op required")
	}
	normalized, err := c.normalizeComponentAssetOp(op)
	if err != nil {
		return nil, err
	}
	return c.executeCommand(normalized), nil
}

func editorPlaceComponents(c *editorContext, input map[string]any) (any, error) {
	items := edSlice(input["items"])
	if len(items) == 0 {
		return nil, editorError("timeline.placeComponents: items required")
	}
	normalized, err := c.normalizeComponentItems(items)
	if err != nil {
		return nil, err
	}
	op := map[string]any{"type": "component-placement", "payload": map[string]any{"sceneId": input["sceneId"], "trackType": nonEmpty(edStr(input["trackType"]), "graphic"), "items": normalized}}
	if input["baseVersion"] != nil {
		op["baseVersion"] = input["baseVersion"]
	}
	out := c.executeCommand(op)
	// 落轨即把组件加入项目素材库（项目引用）；登记已在 normalize 时完成，这里广播给前端面板。
	if okBool(out["ok"]) {
		for _, itemValue := range normalized {
			componentID := edStr(edMap(itemValue)["componentId"])
			if componentID == "" {
				continue
			}
			c.emit("project.components.changed", map[string]any{"componentId": componentID, "status": "verified", "asset": true, "library": map[string]any{"tab": "media"}})
		}
	}
	return out, nil
}

func editorNormalizeAudioPlacementItems(items []any) ([]any, error) {
	out := []any{}
	for _, itemValue := range items {
		item := edMap(itemValue)
		next := map[string]any{}
		for k, v := range item {
			next[k] = v
		}
		raw := edStr(next["mediaId"])
		if raw == "" {
			raw = edStr(next["assetId"])
		}
		if raw == "" {
			return nil, editorError("placeAudio: each item requires assetId (platform media asset)")
		}
		if strings.HasPrefix(raw, "audio:") {
			next["mediaId"] = strings.TrimPrefix(raw, "audio:")
		} else {
			next["mediaId"] = raw
		}
		delete(next, "assetId")
		next["sourceType"] = "upload"
		next["type"] = "audio"
		out = append(out, next)
	}
	return out, nil
}

func (c *editorContext) attachMediaAssetsToProject(mediaIDs []string) {
	if c.host.media == nil {
		return
	}
	for _, mediaID := range mediaIDs {
		_ = c.attachMedia(mediaID)
	}
}

func editorPlaceAudio(c *editorContext, input map[string]any) (any, error) {
	items := edSlice(input["items"])
	if len(items) == 0 {
		return nil, editorError("timeline.placeAudio: items required")
	}
	normalized, err := editorNormalizeAudioPlacementItems(items)
	if err != nil {
		return nil, err
	}
	placedMediaIDs := []string{}
	for _, itemValue := range normalized {
		placedMediaIDs = append(placedMediaIDs, edStr(edMap(itemValue)["mediaId"]))
	}
	// 落轨即把媒体素材加入项目素材库（项目引用）；不再维护单独的登记缓存。
	c.attachMediaAssetsToProject(placedMediaIDs)
	op := map[string]any{"type": "audio-placement", "payload": map[string]any{"sceneId": input["sceneId"], "items": normalized}}
	if input["baseVersion"] != nil {
		op["baseVersion"] = input["baseVersion"]
	}
	out := c.executeCommand(op)
	if okBool(out["ok"]) {
		c.emit("project.assets.changed", map[string]any{"kind": "audio", "mediaIds": placedMediaIDs, "library": map[string]any{"tab": "media"}})
	}
	return out, nil
}

func editorHistoryUndo(c *editorContext, input map[string]any) (any, error) {
	return c.undoLast(), nil
}

func editorHistoryRedo(c *editorContext, input map[string]any) (any, error) {
	return c.redoNext(), nil
}

func editorTimelineDelta(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return nil, editorError("timeline.delta: project not found")
	}
	fromVersion := int64(0)
	if input["fromVersion"] != nil && edIsNum(input["fromVersion"]) {
		fromVersion = int64(edNum(input["fromVersion"]))
	}
	return map[string]any{
		"ok":          true,
		"fromVersion": fromVersion,
		"toVersion":   existing.Version,
		"operations":  c.logSince(fromVersion),
		"document":    existing.Project,
	}, nil
}

func editorWorkCheckpoint(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	lock := c.readLock()
	checkpointSeq := c.currentDoneSeq()
	c.ensureSchema()
	var owner any
	var token any
	if lock != nil && !lockExpired(lock) {
		owner = lock["owner"]
		token = lock["token"]
	}
	version := int64(0)
	if existing != nil {
		version = existing.Version
	}
	_, err := c.db.Exec("insert into editor_work_checkpoints (project_id, checkpoint_seq, owner, lock_token, version, created_at) values (?, ?, ?, ?, ?, ?) "+
		"on conflict(project_id) do update set checkpoint_seq = excluded.checkpoint_seq, owner = excluded.owner, lock_token = excluded.lock_token, version = excluded.version, created_at = excluded.created_at",
		c.scopeID, checkpointSeq, owner, token, version, nowIso())
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "checkpointSeq": checkpointSeq, "version": version, "owner": owner, "token": token}, nil
}

func editorWorkCancel(c *editorContext, input map[string]any) (any, error) {
	checkpointSeq := int64(0)
	if input["checkpointSeq"] != nil && edIsNum(input["checkpointSeq"]) {
		checkpointSeq = int64(edNum(input["checkpointSeq"]))
	}
	lock := c.readLock()
	rows, err := queryMaps(c.db, "select checkpoint_seq, owner, lock_token from editor_work_checkpoints where project_id = ?", c.scopeID)
	if err != nil {
		return nil, err
	}
	var checkpoint map[string]any
	if len(rows) > 0 {
		checkpoint = rows[0]
	}
	if checkpoint == nil || int64(edNum(checkpoint["checkpoint_seq"])) != checkpointSeq {
		return map[string]any{"ok": false, "reason": "checkpoint-not-found", "checkpointSeq": checkpointSeq, "undoneSeqs": []any{}}, nil
	}
	owner := edStr(input["owner"])
	token := edStr(input["token"])
	if owner != "" && edStr(checkpoint["owner"]) != "" && owner != edStr(checkpoint["owner"]) {
		return map[string]any{"ok": false, "reason": "checkpoint-owner-mismatch", "checkpointSeq": checkpointSeq, "undoneSeqs": []any{}}, nil
	}
	if token != "" && edStr(checkpoint["lock_token"]) != "" && token != edStr(checkpoint["lock_token"]) {
		return map[string]any{"ok": false, "reason": "checkpoint-token-mismatch", "checkpointSeq": checkpointSeq, "undoneSeqs": []any{}}, nil
	}
	if edStr(checkpoint["owner"]) != "" && (owner == "" || token == "") {
		return map[string]any{"ok": false, "reason": "checkpoint-credentials-required", "checkpointSeq": checkpointSeq, "undoneSeqs": []any{}}, nil
	}
	checkpointOwner := edStr(checkpoint["owner"])
	if checkpointOwner != "" && (lock == nil || lockExpired(lock) || edStr(lock["owner"]) != checkpointOwner || (edStr(checkpoint["lock_token"]) != "" && edStr(lock["token"]) != "" && edStr(checkpoint["lock_token"]) != edStr(lock["token"]))) {
		return map[string]any{"ok": false, "reason": "checkpoint-not-owned", "checkpointSeq": checkpointSeq, "undoneSeqs": []any{}}, nil
	}
	undone := []any{}
	guard := 0
	for guard < 200 {
		guard++
		if c.currentDoneSeq() <= checkpointSeq {
			break
		}
		result := c.undoLast()
		if !okBool(result["ok"]) {
			existing := c.readProject()
			version := int64(0)
			if existing != nil {
				version = existing.Version
			}
			reason := "undo-failed"
			if r := edStr(result["reason"]); r != "" {
				reason = r
			}
			return map[string]any{"ok": false, "reason": reason, "error": result["error"], "checkpointSeq": checkpointSeq, "undoneSeqs": undone, "version": version}, nil
		}
		undone = append(undone, result["undidSeq"])
	}
	existing := c.readProject()
	version := int64(0)
	if existing != nil {
		version = existing.Version
	}
	if c.currentDoneSeq() > checkpointSeq {
		return map[string]any{"ok": false, "reason": "undo-guard-exceeded", "checkpointSeq": checkpointSeq, "undoneSeqs": undone, "version": version}, nil
	}
	return map[string]any{"ok": true, "checkpointSeq": checkpointSeq, "undoneSeqs": undone, "version": version}, nil
}

// ---- 字幕导入 / 导出 ---------------------------------------------------------
func editorSubtitleImport(c *editorContext, input map[string]any) (any, error) {
	content, ok := input["content"].(string)
	if !ok {
		return nil, editorError("subtitle.import: content (SRT/ASS text) required")
	}
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return nil, editorError("subtitle.import: project not found, run project.create first")
	}
	cues := parseSubtitleContent(content, edStr(input["fileName"]))
	if len(cues) == 0 {
		return map[string]any{"ok": false, "reason": "no-cues", "imported": 0}, nil
	}
	out := c.executeCommand(map[string]any{"type": "subtitle-import", "payload": map[string]any{
		"cues": cues, "style": input["style"], "trackId": input["trackId"], "startSec": input["startSec"], "source": input["source"],
	}})
	if okBool(out["ok"]) {
		out["imported"] = len(cues)
		result := edMap(out["result"])
		if result != nil {
			out["trackId"] = result["trackId"]
			out["firstCueRef"] = result["element"]
		} else {
			out["trackId"] = nil
			out["firstCueRef"] = nil
		}
		delete(out, "result")
	}
	return out, nil
}

func editorSubtitleExport(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	var project map[string]any
	if existing != nil {
		project = existing.Project
	}
	var track map[string]any
	scene := findScene(project, project["currentSceneId"])
	if scene != nil {
		tracks := edSceneTracks(scene)
		all := sceneTrackList(tracks)
		if edStr(input["trackId"]) != "" {
			track = findTrack(scene, input["trackId"])
		}
		if track == nil {
			for _, candidate := range all {
				if edStr(candidate["type"]) == "text" && candidate["captionStyle"] != nil {
					track = candidate
					break
				}
			}
		}
	}
	if track == nil {
		return map[string]any{"ok": false, "reason": "no-caption-track"}, nil
	}
	cueCount := 0
	for _, ev := range edSlice(track["elements"]) {
		e := edMap(ev)
		if e != nil && edStr(e["type"]) == "text" && e["subtitle"] != nil {
			cueCount++
		}
	}
	return map[string]any{"ok": true, "trackId": track["id"], "cueCount": cueCount, "srt": renderSrtFromTrack(track)}, nil
}

// ---- script 文稿面 ----------------------------------------------------------
func editorScriptAttach(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["trackId"]) == "" || edStr(input["elementId"]) == "" || edStr(input["assetId"]) == "" {
		return nil, editorError("script.attach: trackId + elementId + assetId (transcript) required")
	}
	return c.executeCommand(map[string]any{"type": "transcript-attach", "payload": map[string]any{
		"ref":      map[string]any{"trackId": input["trackId"], "elementId": input["elementId"]},
		"assetId":  input["assetId"],
		"source":   nonEmpty(edStr(input["source"]), "transcript"),
		"language": input["language"],
	}}), nil
}

func editorScriptRead(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return nil, editorError("script.read: project not found")
	}
	project := existing.Project
	scene := findScene(project, project["currentSceneId"])
	tracks := speechTracks(scene)
	var track map[string]any
	if edStr(input["trackId"]) != "" {
		track = findTrack(scene, input["trackId"])
	} else {
		for _, candidate := range tracks {
			found := false
			for _, ev := range edSlice(candidate["elements"]) {
				if hasTranscript(edMap(ev)) {
					found = true
					break
				}
			}
			if found {
				track = candidate
				break
			}
		}
	}
	if track == nil {
		return map[string]any{"ok": false, "reason": "no-speech-track", "hint": loc(c.locale, "先用 script.attach 给说话元素绑定 transcript（audio-studio 转写产物 assetId）", "First bind a transcript to a speech element with script.attach (audio-studio transcript assetId)")}, nil
	}
	var startRef map[string]any
	if edStr(input["trackId"]) != "" && edStr(input["elementId"]) != "" {
		startRef = map[string]any{"trackId": input["trackId"], "elementId": input["elementId"]}
	}
	run := findSpeechRun(track, startRef)
	if len(run) == 0 {
		return map[string]any{"ok": false, "reason": "no-transcript-source", "hint": loc(c.locale, "目标元素未绑定 transcript：script.attach 绑定转写 assetId", "Target element has no transcript attached: bind a transcript assetId with script.attach")}, nil
	}
	rendered := renderRunMarkdown(c.locale, track, run, c.transcriptLookup(), edBool(input["showSilence"]))
	if rendered.Count == 0 {
		return map[string]any{"ok": false, "reason": "no-transcript-source", "hint": loc(c.locale, "转写素材不可用：重新 script.attach 或先 audio-studio 转写", "Transcript asset unavailable: re-run script.attach or transcribe first in Audio Studio")}, nil
	}
	_ = c.writeText("scripts/timeline.md", rendered.Markdown)
	_ = c.writeText("scripts/timeline.baseline.md", rendered.Markdown)
	elementIDs := []any{}
	for _, el := range run {
		elementIDs = append(elementIDs, el["id"])
	}
	path := "scripts/timeline.md"
	if c.filesRoot != "" {
		path = c.filesRoot + "/scripts/timeline.md"
	}
	return map[string]any{
		"ok": true, "path": path, "content": rendered.Markdown, "version": existing.Version,
		"trackId": track["id"], "elements": elementIDs, "segments": rendered.Count, "language": rendered.Language,
	}, nil
}

func editorScriptApply(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return nil, editorError("script.apply: project not found")
	}
	edited, _ := input["content"].(string)
	if edited == "" {
		edited, _ = c.readText("scripts/timeline.md")
	}
	if edited == "" {
		return nil, editorError(loc(c.locale, "script.apply: 编辑后的文稿为空（传 content 或先 script.read 落盘）", "script.apply: edited script is empty (pass content or run script.read first)"))
	}
	baselineText, _ := c.readText("scripts/timeline.baseline.md")
	if strings.TrimSpace(baselineText) != "" && strings.TrimSpace(baselineText) == strings.TrimSpace(edited) {
		return map[string]any{"ok": true, "version": existing.Version, "applied": []any{}, "noop": true}, nil
	}
	project := existing.Project
	units := parseScriptMarkdown(edited)
	if len(units) == 0 {
		return map[string]any{"ok": false, "reason": "no-segments", "hint": loc(c.locale, "文稿里没有可识别的 seg 行", "No recognizable seg lines in the script")}, nil
	}
	scene, track, elementID := resolveSpeechTrackScene(project, units)
	if track == nil {
		return map[string]any{"ok": false, "reason": "address-not-found", "hint": loc(c.locale, "文稿里的轨道/元素不在当前项目：请重新 script.read", "Tracks/elements in the script are not in the current project: please run script.read again")}, nil
	}
	run := findSpeechRun(track, map[string]any{"trackId": track["id"], "elementId": elementID})
	if len(run) == 0 {
		return map[string]any{"ok": false, "reason": "no-transcript-source", "hint": loc(c.locale, "目标元素未绑定 transcript：请重新 script.read", "Target element has no transcript attached: please run script.read again")}, nil
	}
	baseline := buildBaselineOrdered(track, run, c.transcriptLookup())
	layout := computeScriptLayout(baseline, units, c.locale)
	if !layout.OK {
		return map[string]any{"ok": false, "reason": layout.Error}, nil
	}
	if len(layout.Pieces) == 0 {
		return map[string]any{"ok": false, "reason": "empty-layout", "hint": loc(c.locale, "目标布局为空：全部段被删？请检查文稿", "Target layout is empty: were all segments deleted? Please review the script")}, nil
	}
	_ = scene
	built := buildScriptOps(track, run, layout.Pieces)
	version := existing.Version
	applied := []any{}
	for _, op := range built.Ops {
		withBase := map[string]any{"type": op["type"], "payload": op["payload"], "baseVersion": float64(version)}
		out := c.executeCommand(withBase)
		if !okBool(out["ok"]) {
			reason := edStr(out["error"])
			if reason == "" {
				reason = edStr(out["reason"])
			}
			return map[string]any{"ok": false, "conflict": out["conflict"] == true, "reason": reason, "currentVersion": out["currentVersion"], "opsSince": out["opsSince"]}, nil
		}
		version = int64(edNum(out["version"]))
		applied = append(applied, op["type"])
	}
	_ = c.writeText("scripts/timeline.baseline.md", edited)
	return map[string]any{"ok": true, "version": version, "applied": applied, "pieces": len(layout.Pieces), "deleted": len(layout.Deleted)}, nil
}

func editorScriptClean(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return nil, editorError("script.clean: project not found")
	}
	project := existing.Project
	scene := findScene(project, project["currentSceneId"])
	tracks := speechTracks(scene)
	var track map[string]any
	if edStr(input["trackId"]) != "" {
		track = findTrack(scene, input["trackId"])
	} else {
		for _, candidate := range tracks {
			found := false
			for _, ev := range edSlice(candidate["elements"]) {
				if hasTranscript(edMap(ev)) {
					found = true
					break
				}
			}
			if found {
				track = candidate
				break
			}
		}
	}
	if track == nil {
		return map[string]any{"ok": false, "reason": "no-speech-track", "hint": loc(c.locale, "先用 script.attach 绑定 transcript", "First bind a transcript with script.attach")}, nil
	}
	var startRef map[string]any
	if edStr(input["trackId"]) != "" && edStr(input["elementId"]) != "" {
		startRef = map[string]any{"trackId": input["trackId"], "elementId": input["elementId"]}
	}
	run := findSpeechRun(track, startRef)
	if len(run) == 0 {
		return map[string]any{"ok": false, "reason": "no-transcript-source", "hint": loc(c.locale, "目标元素未绑定 transcript", "Target element has no transcript attached")}, nil
	}
	baseline := buildBaselineOrdered(track, run, c.transcriptLookup())
	units := []editorScriptUnit{}
	fillerRemoved := 0
	for _, base := range baseline {
		strikes := []editorStrike{}
		text := base.Text
		if edBool(input["fillers"]) {
			clean, parsed := strikeFillers(base.Text)
			strikes = parsed
			text = clean
			for _, s := range parsed {
				fillerRemoved += s.End - s.Start
			}
		}
		units = append(units, editorScriptUnit{Kind: "seg", TrackID: base.TrackID, ElementID: base.ElementID, Idx: base.Idx, Text: text, Strikes: strikes})
	}
	layout := computeScriptLayout(baseline, units, c.locale)
	if !layout.OK {
		return map[string]any{"ok": false, "reason": layout.Error}, nil
	}
	if edStr(input["silence"]) != "" {
		applySilenceRule(layout.Pieces, edStr(input["silence"]))
	}
	if len(layout.Pieces) == 0 {
		return map[string]any{"ok": false, "reason": "empty-layout"}, nil
	}
	built := buildScriptOps(track, run, layout.Pieces)
	version := existing.Version
	applied := []any{}
	for _, op := range built.Ops {
		withBase := map[string]any{"type": op["type"], "payload": op["payload"], "baseVersion": float64(version)}
		out := c.executeCommand(withBase)
		if !okBool(out["ok"]) {
			reason := edStr(out["error"])
			if reason == "" {
				reason = edStr(out["reason"])
			}
			return map[string]any{"ok": false, "conflict": out["conflict"] == true, "reason": reason, "currentVersion": out["currentVersion"]}, nil
		}
		version = int64(edNum(out["version"]))
		applied = append(applied, op["type"])
	}
	return map[string]any{"ok": true, "version": version, "applied": applied, "pieces": len(layout.Pieces), "fillerRemoved": fillerRemoved}, nil
}

func editorScriptFind(c *editorContext, input map[string]any) (any, error) {
	q := edStr(input["text"])
	if q == "" {
		return nil, editorError("script.find: text required")
	}
	existing := c.readProject()
	var project map[string]any
	if existing != nil {
		project = existing.Project
	}
	scene := findScene(project, project["currentSceneId"])
	tracks := speechTracks(scene)
	matches := []any{}
	needle := strings.ToLower(q)
	for _, track := range tracks {
		for _, ev := range edSlice(track["elements"]) {
			el := edMap(ev)
			if !hasTranscript(el) {
				continue
			}
			segments, _ := scriptSegments(el, c.transcriptLookup())
			for _, seg := range segments {
				if strings.Contains(strings.ToLower(seg.Text), needle) {
					matches = append(matches, map[string]any{
						"trackId": track["id"], "elementId": el["id"], "segment": seg.Idx, "text": seg.Text,
						"startSec": seg.TlStart, "endSec": seg.TlStart + seg.TlDur,
					})
				}
			}
		}
	}
	return map[string]any{"ok": true, "matches": matches}, nil
}

func editorScriptFixTranscript(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["trackId"]) == "" || edStr(input["elementId"]) == "" || !edIsNum(input["segmentIndex"]) || edStr(input["text"]) == "" {
		return nil, editorError("script.fix-transcript: trackId + elementId + segmentIndex + text required")
	}
	return c.executeCommand(map[string]any{"type": "transcript-fix", "payload": map[string]any{
		"ref":          map[string]any{"trackId": input["trackId"], "elementId": input["elementId"]},
		"segmentIndex": input["segmentIndex"],
		"text":         input["text"],
	}}), nil
}

// ---- 自动混音 ---------------------------------------------------------------
func editorTrackRole(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["trackId"]) == "" || edStr(input["role"]) == "" {
		return nil, editorError("track.role: trackId + role required")
	}
	return c.executeCommand(map[string]any{"type": "track-role", "payload": map[string]any{"trackId": input["trackId"], "role": input["role"], "duckDepthDb": input["duckDepthDb"]}}), nil
}

func editorAudioSmooth(c *editorContext, input map[string]any) (any, error) {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return nil, editorError("audio.smooth: project not found")
	}
	project := existing.Project
	scene := findScene(project, project["currentSceneId"])
	all := sceneTrackList(edSceneTracks(scene))
	fadeMs := editorAudioSmoothFadeMS
	if input["fadeMs"] != nil && edIsNum(input["fadeMs"]) {
		fadeMs = edNum(input["fadeMs"])
	}
	fadeSec := mathClamp(fadeMs/1000, 0.02, 0.5)
	ops := []map[string]any{}
	for _, track := range all {
		if edBool(track["muted"]) {
			continue
		}
		for _, ev := range edSlice(track["elements"]) {
			el := edMap(ev)
			if !isAudioCapable(el) {
				continue
			}
			if edBool(edMap(el["params"])["muted"]) {
				continue
			}
			durSec := secOf(edNum(el["duration"]))
			if durSec <= fadeSec*2.2 {
				continue
			}
			keys := edSlice(edMap(edMap(el["animations"])["volume"])["keys"])
			hasEdgeFade := len(keys) >= 2
			if hasEdgeFade {
				hasStart := false
				hasEnd := false
				for _, kv := range keys {
					k := edMap(kv)
					if edNum(k["time"]) < tickOf(fadeSec) {
						hasStart = true
					}
					if edNum(k["time"]) > edNum(el["duration"])-tickOf(fadeSec) {
						hasEnd = true
					}
				}
				hasEdgeFade = hasStart && hasEnd
			}
			if hasEdgeFade {
				continue
			}
			base := elementVolumeAt(el, durSec/2)
			ref := map[string]any{"trackId": track["id"], "elementId": el["id"]}
			ops = append(ops,
				map[string]any{"type": "keyframe-upsert", "payload": map[string]any{"ref": ref, "path": "volume", "atSec": secOf(edNum(el["startTime"])), "value": editorDuckFadeSilenceDB, "segmentToNext": "linear"}},
				map[string]any{"type": "keyframe-upsert", "payload": map[string]any{"ref": ref, "path": "volume", "atSec": secOf(edNum(el["startTime"]) + tickOf(fadeSec)), "value": base, "segmentToNext": "linear"}},
				map[string]any{"type": "keyframe-upsert", "payload": map[string]any{"ref": ref, "path": "volume", "atSec": secOf(edNum(el["startTime"]) + edNum(el["duration"]) - tickOf(fadeSec)), "value": base, "segmentToNext": "linear"}},
				map[string]any{"type": "keyframe-upsert", "payload": map[string]any{"ref": ref, "path": "volume", "atSec": secOf(edNum(el["startTime"]) + edNum(el["duration"])), "value": editorDuckFadeSilenceDB, "segmentToNext": "linear"}},
			)
		}
	}
	if len(ops) == 0 {
		return map[string]any{"ok": true, "version": existing.Version, "applied": 0, "reason": "nothing-to-smooth"}, nil
	}
	version := existing.Version
	applied := 0
	for _, op := range ops {
		withBase := map[string]any{"type": op["type"], "payload": op["payload"], "baseVersion": float64(version)}
		out := c.executeCommand(withBase)
		if !okBool(out["ok"]) {
			reason := edStr(out["error"])
			if reason == "" {
				reason = edStr(out["reason"])
			}
			return map[string]any{"ok": false, "conflict": out["conflict"] == true, "reason": reason, "currentVersion": out["currentVersion"]}, nil
		}
		version = int64(edNum(out["version"]))
		applied++
	}
	return map[string]any{"ok": true, "version": version, "applied": applied, "elementsSmoothed": len(ops) / 4}, nil
}

func mathClamp(v, lo, hi float64) float64 {
	return edClamp(v, lo, hi)
}

// ---- 目录 -------------------------------------------------------------------
var editorLibraryCatalogURLs = map[string]string{
	"effects": "https://cdn.recut.video/effects/catalog.json",
	"audio":   "https://cdn.recut.video/audio/catalog.json",
}

var editorLibraryBuiltinEffects = []any{
	map[string]any{"id": "effect.glass", "name": "Glass 玻璃", "keywords": []any{"glass", "玻璃", "折射", "refraction"}, "inputs": []any{
		map[string]any{"key": "centerX", "label": "中心 X", "type": "number", "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01},
		map[string]any{"key": "centerY", "label": "中心 Y", "type": "number", "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01},
		map[string]any{"key": "zoom", "label": "放大", "type": "number", "default": 1.34, "min": 1.0, "max": 4.0, "step": 0.01},
		map[string]any{"key": "ior", "label": "折射率", "type": "number", "default": 1.5, "min": 1.0, "max": 2.5, "step": 0.01},
	}},
	map[string]any{"id": "effect.magnify", "name": "Magnify 放大镜", "keywords": []any{"magnify", "放大镜", "放大", "zoom"}, "inputs": []any{
		map[string]any{"key": "centerX", "label": "中心 X", "type": "number", "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01},
		map[string]any{"key": "centerY", "label": "中心 Y", "type": "number", "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01},
		map[string]any{"key": "zoom", "label": "放大", "type": "number", "default": 1.7, "min": 1.0, "max": 5.0, "step": 0.01},
		map[string]any{"key": "radius", "label": "透镜半径", "type": "number", "default": 140.0, "min": 40.0, "max": 600.0, "step": 5.0},
	}},
	map[string]any{"id": "effect.glitch", "name": "Glitch 故障", "keywords": []any{"glitch", "故障", "信号", "tearing"}, "inputs": []any{
		map[string]any{"key": "intensity", "label": "强度", "type": "number", "default": 1.35, "min": 0.0, "max": 5.0, "step": 0.01},
	}},
	map[string]any{"id": "effect.crt", "name": "CRT 显像管", "keywords": []any{"crt", "显像管", "复古", "scanline"}, "inputs": []any{
		map[string]any{"key": "scan", "label": "扫描线", "type": "number", "default": 0.24, "min": 0.0, "max": 1.0, "step": 0.01},
		map[string]any{"key": "vignette", "label": "暗角", "type": "number", "default": 0.68, "min": 0.0, "max": 1.0, "step": 0.01},
	}},
	map[string]any{"id": "effect.vintage", "name": "Vintage 复古", "keywords": []any{"vintage", "复古", "胶片", "grain"}, "inputs": []any{
		map[string]any{"key": "intensity", "label": "强度", "type": "number", "default": 1.0, "min": 0.0, "max": 3.0, "step": 0.01},
	}},
}

func libraryHTTPJSON(url string, timeoutMs, maxBytes int) map[string]any {
	client := &http.Client{Timeout: time.Duration(timeoutMs) * time.Millisecond}
	resp, err := client.Get(url)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(maxBytes)))
	if err != nil {
		return nil
	}
	var doc map[string]any
	if json.Unmarshal(body, &doc) != nil {
		return nil
	}
	return doc
}

func (c *editorContext) loadEffectsCatalog() map[string]any {
	if doc := libraryHTTPJSON(editorLibraryCatalogURLs["effects"], 3000, 1<<20); doc != nil {
		return map[string]any{"effects": doc["effects"], "transitions": doc["transitions"], "luts": doc["luts"], "source": "cdn"}
	}
	if local := editorShippedCatalog(editorEffectsCatalogJSON); local != nil && local["effects"] != nil {
		return map[string]any{"effects": local["effects"], "transitions": local["transitions"], "luts": local["luts"], "source": "shipped"}
	}
	return map[string]any{"effects": editorLibraryBuiltinEffects, "transitions": []any{}, "luts": []any{}, "source": "builtin"}
}

func (c *editorContext) loadAudioCatalog() map[string]any {
	if doc := libraryHTTPJSON(editorLibraryCatalogURLs["audio"], 5000, 2<<20); doc != nil {
		return map[string]any{"music": doc["music"], "sfx": doc["sfx"], "source": "cdn"}
	}
	if local := editorShippedCatalog(editorAudioCatalogJSON); local != nil && local["sfx"] != nil {
		return map[string]any{"music": local["music"], "sfx": local["sfx"], "source": "shipped"}
	}
	return map[string]any{"music": []any{}, "sfx": []any{}, "source": "builtin"}
}

func libraryAssetURL(url string) string {
	clean := strings.TrimPrefix(edStr(url), "/")
	if strings.HasPrefix(clean, "http://") || strings.HasPrefix(clean, "https://") {
		return clean
	}
	return "https://cdn.recut.video/" + clean
}

func editorLibraryBrowse(c *editorContext, input map[string]any) (any, error) {
	category := edStr(input["category"])
	query := strings.ToLower(edStr(input["query"]))
	kindOf := map[string]string{"effects": "effect", "transitions": "transition", "luts": "lut", "sound-effects": "sound-effect", "music": "music"}
	items := []any{}
	push := func(kind string, entry map[string]any) {
		if category != "" && kindOf[category] != kind {
			return
		}
		keywords := ""
		if list := edSlice(entry["keywords"]); list != nil {
			parts := []string{}
			for _, k := range list {
				parts = append(parts, edStr(k))
			}
			keywords = strings.Join(parts, " ")
		}
		hay := strings.ToLower(edStr(entry["id"]) + " " + edStr(entry["name"]) + " " + keywords)
		if query != "" && !strings.Contains(hay, query) {
			return
		}
		merged := map[string]any{}
		for k, v := range entry {
			merged[k] = v
		}
		merged["kind"] = kind
		items = append(items, merged)
	}
	effects := c.loadEffectsCatalog()
	audio := c.loadAudioCatalog()
	for _, ev := range edSlice(effects["effects"]) {
		push("effect", edMap(ev))
	}
	for _, tv := range edSlice(effects["transitions"]) {
		push("transition", edMap(tv))
	}
	for _, lv := range edSlice(effects["luts"]) {
		push("lut", edMap(lv))
	}
	for _, sv := range edSlice(audio["sfx"]) {
		entry := edCloneMap(sv)
		entry["url"] = libraryAssetURL(edStr(entry["url"]))
		push("sound-effect", entry)
	}
	for _, mv := range edSlice(audio["music"]) {
		entry := edCloneMap(mv)
		entry["url"] = libraryAssetURL(edStr(entry["url"]))
		push("music", entry)
	}
	source := edStr(effects["source"])
	if source == "builtin" {
		source = edStr(audio["source"])
	}
	count := len(items)
	limit := 60
	if count < limit {
		limit = count
	}
	return map[string]any{"ok": true, "source": source, "count": count, "items": items[:limit]}, nil
}

// ---- 封面 -------------------------------------------------------------------
func (c *editorContext) readCoverPrefs() map[string]any {
	c.ensureSchema()
	rows, err := queryMaps(c.db, "select mode, frame_sec, asset_id from editor_cover_prefs where project_id = ?", c.scopeID)
	if err != nil || len(rows) == 0 {
		return map[string]any{"mode": "auto", "frameSec": nil, "assetId": ""}
	}
	r := rows[0]
	var frameSec any
	if r["frame_sec"] != nil {
		frameSec = edNum(r["frame_sec"])
	}
	return map[string]any{"mode": nonEmpty(edStr(r["mode"]), "auto"), "frameSec": frameSec, "assetId": edStr(r["asset_id"])}
}

func (c *editorContext) writeCoverPrefs(mode string, frameSec any, assetID string) {
	c.ensureSchema()
	_, _ = c.db.Exec("insert into editor_cover_prefs (project_id, mode, frame_sec, asset_id, updated_at) values (?, ?, ?, ?, ?) "+
		"on conflict(project_id) do update set mode = excluded.mode, frame_sec = excluded.frame_sec, asset_id = excluded.asset_id, updated_at = excluded.updated_at",
		c.scopeID, mode, frameSec, assetID, nowIso())
}

func coverExtension(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}

func editorCoverUpdate(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["fileBase64"]) == "" {
		return nil, editorError("cover.update: fileBase64 required")
	}
	mimeType := nonEmpty(edStr(input["mimeType"]), "image/png")
	path := "covers/cover" + coverExtension(mimeType)
	if err := c.writeBase64(path, edStr(input["fileBase64"])); err != nil {
		return nil, err
	}
	cover, err := c.setCoverImage(path, mimeType)
	if err != nil {
		return nil, err
	}
	prefs := c.readCoverPrefs()
	if edStr(prefs["mode"]) != "auto" {
		return map[string]any{"ok": true, "path": path, "mode": prefs["mode"], "skipped": true, "cover": cover}, nil
	}
	c.writeCoverPrefs("auto", nil, "")
	return map[string]any{"ok": true, "path": path, "mode": "auto", "cover": cover}, nil
}

func editorCoverGet(c *editorContext, input map[string]any) (any, error) {
	prefs := c.readCoverPrefs()
	return map[string]any{"ok": true, "mode": prefs["mode"], "frameSec": prefs["frameSec"], "assetId": prefs["assetId"], "cover": c.currentCover()}, nil
}

func editorCoverSetFrame(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["fileBase64"]) == "" {
		return nil, editorError("cover.set-frame: fileBase64 required")
	}
	mimeType := nonEmpty(edStr(input["mimeType"]), "image/png")
	path := "covers/cover" + coverExtension(mimeType)
	if err := c.writeBase64(path, edStr(input["fileBase64"])); err != nil {
		return nil, err
	}
	cover, err := c.setCoverImage(path, mimeType)
	if err != nil {
		return nil, err
	}
	var frameSec any
	if input["frameSec"] != nil && edIsNum(input["frameSec"]) {
		frameSec = edNum(input["frameSec"])
	}
	c.writeCoverPrefs("frame", frameSec, "")
	return map[string]any{"ok": true, "path": path, "mode": "frame", "frameSec": frameSec, "cover": cover}, nil
}

func editorCoverSetAsset(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["assetId"]) == "" {
		return nil, editorError("cover.set-asset: assetId required")
	}
	cover, err := c.setCover(edStr(input["assetId"]))
	if err != nil {
		return nil, err
	}
	c.writeCoverPrefs("asset", nil, edStr(input["assetId"]))
	return map[string]any{"ok": true, "mode": "asset", "assetId": input["assetId"], "cover": cover}, nil
}

func editorCoverSetAuto(c *editorContext, input map[string]any) (any, error) {
	c.writeCoverPrefs("auto", nil, "")
	return map[string]any{"ok": true, "mode": "auto"}, nil
}

// ---- film.package.import ----------------------------------------------------
func editorFilmPackageImport(c *editorContext, input map[string]any) (any, error) {
	pkg := edMap(input["pkg"])
	if pkg == nil {
		pkg = input
	}
	if pkg == nil {
		return nil, editorError("film.package.import: pkg required")
	}
	existing := c.readProject()
	var baseProject map[string]any
	if existing != nil && existing.Project != nil {
		baseProject = existing.Project
	} else {
		baseProject = makeDefaultProject(c.scopeID, loc(c.locale, "AI 短片草稿", "AI Short Film Draft"), nil, nil, c.locale)
	}
	project := edCloneMap(baseProject)
	now := nowIso()
	scene := findScene(project, project["currentSceneId"])
	ensureTextTrack := func() map[string]any { return findOrCreateTrack(scene, "text", float64(0), nil) }
	ensureAudioTrack := func() map[string]any { return findOrCreateTrack(scene, "audio", float64(0), nil) }
	scenes := edSlice(pkg["scenes"])
	script := edMap(pkg["script"])
	if script == nil {
		script = map[string]any{"beats": []any{}}
	}
	cursor := float64(0)
	for i, scv := range scenes {
		sc := edMap(scv)
		assetIDs := edSlice(sc["assetIds"])
		if assetIDs == nil {
			assetIDs = edSlice(sc["imageAssetIds"])
		}
		durationSec := 5.0
		if sc["durationSeconds"] != nil {
			durationSec = edNum(sc["durationSeconds"])
		} else if sc["durationSec"] != nil {
			durationSec = edNum(sc["durationSec"])
		}
		startTicks := tickOf(cursor)
		mainTrack := edMap(edSceneTracks(scene)["main"])
		title := edStr(sc["title"])
		for _, assetValue := range assetIDs {
			assetID := edStr(assetValue)
			idSuffix := assetID
			if len(idSuffix) > 8 {
				idSuffix = idSuffix[len(idSuffix)-8:]
			}
			name := title
			if name == "" {
				name = loc(c.locale, "镜头 "+strconv.Itoa(i+1), "Shot "+strconv.Itoa(i+1))
			}
			element := map[string]any{
				"id": "el-" + strconv.Itoa(i) + "-" + idSuffix, "name": name, "type": "video", "mediaId": assetID,
				"startTime": startTicks, "duration": tickOf(durationSec), "trimStart": float64(0), "trimEnd": tickOf(durationSec),
				"params": edCloneMap(editorCoreDefaultParams), "hidden": false,
			}
			mainTrack["elements"] = append(edSlice(mainTrack["elements"]), element)
		}
		shotDefault := loc(c.locale, "镜头 "+strconv.Itoa(i+1), "Shot "+strconv.Itoa(i+1))
		if title != "" && title != shotDefault {
			textTrack := ensureTextTrack()
			params := coreParamsForType("text")
			params["content"] = title
			textTrack["elements"] = append(edSlice(textTrack["elements"]), map[string]any{
				"id": "el-text-" + strconv.Itoa(i), "name": title, "type": "text",
				"startTime": startTicks, "duration": tickOf(durationSec), "trimStart": float64(0), "trimEnd": tickOf(durationSec),
				"params": params, "hidden": false,
			})
		}
		cursor += durationSec
	}
	audio := edMap(pkg["audio"])
	if audio != nil && edStr(audio["voiceoverAssetId"]) != "" {
		audioTrack := ensureAudioTrack()
		dur := cursor
		if dur == 0 {
			dur = 10
		}
		if audio["durationSeconds"] != nil {
			dur = edNum(audio["durationSeconds"])
		}
		audioTrack["elements"] = append(edSlice(audioTrack["elements"]), map[string]any{
			"id": "el-vo-" + edRandomSuffix()[:6], "name": loc(c.locale, "配音", "Voiceover"), "type": "audio",
			"sourceType": "upload", "mediaId": audio["voiceoverAssetId"], "startTime": float64(0),
			"duration": tickOf(dur), "trimStart": float64(0), "trimEnd": tickOf(dur),
			"params": edCloneMap(editorCoreDefaultAudioParams),
		})
	}
	if metadata := edMap(project["metadata"]); metadata != nil {
		metadata["updatedAt"] = now
	}
	scene["updatedAt"] = now
	write := c.writeProject(project, nil)
	if okBool(write["ok"]) {
		c.emitDocumentChanged(int64(edNum(write["version"])), "agent", nil)
	}
	return map[string]any{"ok": true, "elements": summarizeTimeline(project)}, nil
}

// ---- 出帧 / 导出 -------------------------------------------------------------
const editorFrameHeartbeatFreshMS = 30 * 1000
const editorFrameCallUITimeoutMS = 15000
const editorExportCallUITimeoutMS = 300000

func (c *editorContext) ensureFrameSchema() {
	c.ensureSchema()
}

func (c *editorContext) frameSessionFresh(maxAgeMs int64) bool {
	c.ensureFrameSchema()
	rows, err := queryMaps(c.db, "select last_seen_at from editor_frame_sessions where project_id = ?", c.scopeID)
	if err != nil || len(rows) == 0 {
		return false
	}
	last, err := time.Parse("2006-01-02T15:04:05.000Z", edStr(rows[0]["last_seen_at"]))
	if err != nil {
		last, err = time.Parse(time.RFC3339Nano, edStr(rows[0]["last_seen_at"]))
		if err != nil {
			return false
		}
	}
	return time.Since(last).Milliseconds() < maxAgeMs
}

func editorRejectStaleFrame(c *editorContext, expectedVersion any, actualVersion int64) error {
	if expectedVersion == nil || !edIsNum(expectedVersion) {
		return nil
	}
	if int64(edNum(expectedVersion)) == actualVersion {
		return nil
	}
	return editorErrorWithCode("timeline-version-stale",
		loc(c.locale, "时间线在出帧期间发生变化，已丢弃这张旧证据。", "The timeline changed during rendering; the stale frame was discarded."),
		loc(c.locale, "重新读取 timeline.read 后，在新 version 上重试。", "Read timeline.read again and retry against the new version."),
		true,
		map[string]any{"expectedVersion": int64(edNum(expectedVersion)), "actualVersion": actualVersion})
}

func (c *editorContext) currentTimelineVersion() int64 {
	existing := c.readProject()
	if existing == nil {
		return 0
	}
	return existing.Version
}

func editorFrameHeartbeat(c *editorContext, input map[string]any) (any, error) {
	now := nowIso()
	c.ensureFrameSchema()
	_, err := c.db.Exec("insert into editor_frame_sessions (project_id, last_seen_at, updated_at) values (?, ?, ?) "+
		"on conflict(project_id) do update set last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at",
		c.scopeID, now, now)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "at": now}, nil
}

func editorPreviewFrame(c *editorContext, input map[string]any) (any, error) {
	timeSec := -1.0
	if input["timeSec"] != nil && edIsNum(input["timeSec"]) {
		timeSec = edNum(input["timeSec"])
	}
	if timeSec < 0 {
		return nil, editorError("preview.frame: timeSec (>= 0 seconds) required")
	}
	if edStr(input["mode"]) == "headless" {
		return nil, editorErrorWithCode("headless-unavailable",
			loc(c.locale, "无头渲染尚未实现（P2）。", "Headless rendering is not implemented yet (P2)."),
			loc(c.locale, "请先打开编辑器，或等待 P2 无头渲染器上线。", "Open the editor first, or wait for the P2 headless renderer."), false, nil)
	}
	if !c.frameSessionFresh(editorFrameHeartbeatFreshMS) {
		return nil, editorErrorWithCode("editor-not-open",
			loc(c.locale, "编辑器前端未打开，无法出帧。", "The editor frontend is not open, so no frame can be rendered."),
			loc(c.locale, "请打开编辑器 UI 后重试；无前端场景需 P2 无头渲染（headless-unavailable）。", "Open the editor UI and retry; frontend-less scenarios need the P2 headless renderer (headless-unavailable)."), false, nil)
	}
	payload := map[string]any{
		"timeSec": timeSec, "width": nil, "height": nil, "pixelRatio": nil,
		"saveToLibrary": edBool(input["saveToLibrary"]), "expectedVersion": float64(c.currentTimelineVersion()),
	}
	if input["width"] != nil && edIsNum(input["width"]) {
		payload["width"] = edNum(input["width"])
	}
	if input["height"] != nil && edIsNum(input["height"]) {
		payload["height"] = edNum(input["height"])
	}
	if input["pixelRatio"] != nil && edIsNum(input["pixelRatio"]) {
		payload["pixelRatio"] = edNum(input["pixelRatio"])
	}
	job, err := c.callUI("frame.render", payload, "frame.finalize", editorFrameCallUITimeoutMS)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "jobId": job["id"], "requestId": job["id"], "mode": "ui", "timeoutMs": editorFrameCallUITimeoutMS}, nil
}

func editorPreviewBatch(c *editorContext, input map[string]any) (any, error) {
	times := edSlice(input["times"])
	if len(times) == 0 || len(times) > 32 {
		return nil, editorError("preview.batch: times must contain 1..32 non-negative seconds")
	}
	for _, t := range times {
		if !edIsNum(t) || edNum(t) < 0 {
			return nil, editorError("preview.batch: times must contain 1..32 non-negative seconds")
		}
	}
	if !c.frameSessionFresh(editorFrameHeartbeatFreshMS) {
		return nil, editorErrorWithCode("editor-not-open",
			loc(c.locale, "编辑器前端未打开，无法批量出帧。", "The editor frontend is not open, so batch frames cannot be rendered."),
			loc(c.locale, "请打开编辑器 UI 后重试。", "Open the editor UI and retry."), false, nil)
	}
	expectedVersion := float64(c.currentTimelineVersion())
	jobs := []any{}
	for _, t := range times {
		payload := map[string]any{
			"timeSec": edNum(t), "width": nil, "height": nil, "pixelRatio": nil,
			"saveToLibrary": edBool(input["saveToLibrary"]), "purpose": "settled-scenes", "expectedVersion": expectedVersion,
		}
		if input["width"] != nil && edIsNum(input["width"]) {
			payload["width"] = edNum(input["width"])
		}
		if input["height"] != nil && edIsNum(input["height"]) {
			payload["height"] = edNum(input["height"])
		}
		if input["pixelRatio"] != nil && edIsNum(input["pixelRatio"]) {
			payload["pixelRatio"] = edNum(input["pixelRatio"])
		}
		if edStr(input["purpose"]) != "" {
			payload["purpose"] = edStr(input["purpose"])
		}
		job, err := c.callUI("frame.render", payload, "frame.finalize", editorFrameCallUITimeoutMS)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, map[string]any{"jobId": job["id"], "requestId": job["id"], "timeSec": edNum(t)})
	}
	return map[string]any{"ok": true, "mode": "ui", "jobs": jobs, "count": len(jobs), "timeoutMs": editorFrameCallUITimeoutMS}, nil
}

func editorPreviewContactSheet(c *editorContext, input map[string]any) (any, error) {
	times := edSlice(input["times"])
	if len(times) == 0 || len(times) > 16 {
		return nil, editorError("preview.contact-sheet: times must contain 1..16 non-negative seconds")
	}
	for _, t := range times {
		if !edIsNum(t) || edNum(t) < 0 {
			return nil, editorError("preview.contact-sheet: times must contain 1..16 non-negative seconds")
		}
	}
	if !c.frameSessionFresh(editorFrameHeartbeatFreshMS) {
		return nil, editorErrorWithCode("editor-not-open",
			loc(c.locale, "编辑器前端未打开，无法生成 contact sheet。", "The editor frontend is not open, so a contact sheet cannot be rendered."),
			loc(c.locale, "请打开编辑器 UI 后重试。", "Open the editor UI and retry."), false, nil)
	}
	payload := map[string]any{
		"times": times, "width": nil, "height": nil, "pixelRatio": nil,
		"saveToLibrary": edBool(input["saveToLibrary"]), "expectedVersion": float64(c.currentTimelineVersion()),
	}
	if input["width"] != nil && edIsNum(input["width"]) {
		payload["width"] = edNum(input["width"])
	}
	if input["height"] != nil && edIsNum(input["height"]) {
		payload["height"] = edNum(input["height"])
	}
	if input["pixelRatio"] != nil && edIsNum(input["pixelRatio"]) {
		payload["pixelRatio"] = edNum(input["pixelRatio"])
	}
	job, err := c.callUI("frame.contactSheet", payload, "frame.finalize", editorFrameCallUITimeoutMS*2)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "jobId": job["id"], "requestId": job["id"], "mode": "ui", "timeoutMs": editorFrameCallUITimeoutMS * 2, "count": len(times)}, nil
}

func editorFrameFinalize(c *editorContext, input map[string]any) (any, error) {
	id := edStr(input["id"])
	if id == "" {
		return nil, editorError("frame.finalize: id required")
	}
	result := edMap(input["result"])
	fileBase64 := edStr(result["fileBase64"])
	if fileBase64 == "" {
		return nil, editorError("frame.finalize: result.fileBase64 missing")
	}
	if err := editorRejectStaleFrame(c, result["expectedVersion"], c.currentTimelineVersion()); err != nil {
		return nil, err
	}
	path := "frames/" + id + ".png"
	if err := c.writeBase64(path, fileBase64); err != nil {
		return nil, err
	}
	imageURL := c.filesURL(path)
	var assetID any
	if info, ok := c.asyncStatus(id); ok {
		payload := edMap(info["payload"])
		if edBool(payload["saveToLibrary"]) {
			if asset, err := c.importMediaFile(path, "frame-"+id+".png", "image/png"); err == nil {
				assetID = asset["id"]
			}
		}
	}
	return map[string]any{
		"imageUrl": imageURL, "width": result["width"], "height": result["height"],
		"version": result["version"], "assetId": assetID, "path": path,
	}, nil
}

func (c *editorContext) ensureExportSchema() {
	_, _ = c.db.Exec("create table if not exists editor_exports (" +
		"export_id text not null primary key, project_id text not null, settings_json text not null, " +
		"asset_id text, status text not null, created_at text not null, updated_at text not null)")
}

func (c *editorContext) finishExport(exportID, fileBase64, name, mimeType string) (map[string]any, error) {
	mp4Path := "exports/" + exportID + ".mp4"
	if err := c.writeBase64(mp4Path, fileBase64); err != nil {
		return nil, err
	}
	assetName := name
	if assetName == "" {
		assetName = loc(c.locale, "成片 "+exportID, "Export "+exportID)
	}
	if mimeType == "" {
		mimeType = "video/mp4"
	}
	asset, err := c.importMediaFile(mp4Path, assetName, mimeType)
	var assetID any
	if err == nil && asset != nil {
		assetID = asset["id"]
	}
	prefs := c.readCoverPrefs()
	if assetID != nil && edStr(prefs["mode"]) == "auto" {
		_, _ = c.setCover(edStr(assetID))
	}
	c.ensureExportSchema()
	_, _ = c.db.Exec("update editor_exports set asset_id = ?, status = 'completed', updated_at = ? where export_id = ?", assetID, nowIso(), exportID)
	return map[string]any{"exportId": exportID, "assetId": assetID}, nil
}

func editorExportStart(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["mode"]) == "headless" {
		return nil, editorErrorWithCode("headless-unavailable",
			loc(c.locale, "无头导出尚未实现（P2）。", "Headless export is not implemented yet (P2)."),
			loc(c.locale, "请打开编辑器后用 UI 路径导出，或等待 P2 无头渲染器。", "Open the editor and export via the UI path, or wait for the P2 headless renderer."), false, nil)
	}
	if !c.frameSessionFresh(editorFrameHeartbeatFreshMS) {
		return nil, editorErrorWithCode("editor-not-open",
			loc(c.locale, "编辑器前端未打开，无法导出。", "The editor frontend is not open, so export cannot run."),
			loc(c.locale, "请打开编辑器 UI 后重试；无前端场景需 P2 无头导出（headless-unavailable）。", "Open the editor UI and retry; frontend-less scenarios need the P2 headless exporter (headless-unavailable)."), false, nil)
	}
	existing := c.readProject()
	exportID := "export-" + strconv.FormatInt(time.Now().UnixMilli(), 36) + "-" + edRandomSuffix()[:6]
	c.ensureSchema()
	c.ensureExportSchema()
	canvas := editorDefaultCanvas
	if existing != nil && existing.Project != nil && existing.Project["settings"] != nil {
		if cs := edMap(edMap(existing.Project["settings"])["canvasSize"]); cs != nil {
			canvas = cs
		}
	}
	width := edNum(canvas["width"])
	height := edNum(canvas["height"])
	fps := 30.0
	if input["width"] != nil && edIsNum(input["width"]) {
		width = edNum(input["width"])
	}
	if input["height"] != nil && edIsNum(input["height"]) {
		height = edNum(input["height"])
	}
	if input["fps"] != nil && edIsNum(input["fps"]) {
		fps = edNum(input["fps"])
	}
	expectedVersion := int64(0)
	if existing != nil {
		expectedVersion = existing.Version
	}
	_, err := c.db.Exec("insert into editor_exports (export_id, project_id, settings_json, status, created_at, updated_at) values (?, ?, ?, 'encoding', ?, ?)",
		exportID, c.scopeID, marshalJSONNoEscape(map[string]any{"width": width, "height": height, "fps": fps, "mode": "ui", "expectedVersion": expectedVersion}), nowIso(), nowIso())
	if err != nil {
		return nil, err
	}
	job, err := c.callUI("export.encode", map[string]any{"exportId": exportID, "width": width, "height": height, "fps": fps, "expectedVersion": expectedVersion}, "export.finalize", editorExportCallUITimeoutMS)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "jobId": job["id"], "requestId": job["id"], "exportId": exportID, "mode": "ui", "timeoutMs": editorExportCallUITimeoutMS}, nil
}

func editorExportProgress(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["exportId"]) == "" || input["progress"] == nil || !edIsNum(input["progress"]) {
		return nil, editorError("export.progress: exportId + progress required")
	}
	progress := edClamp(edNum(input["progress"]), 0, 1)
	return map[string]any{"exportId": input["exportId"], "progress": progress}, nil
}

func editorExportComplete(c *editorContext, input map[string]any) (any, error) {
	if edStr(input["exportId"]) == "" || edStr(input["fileBase64"]) == "" {
		return nil, editorError("export.complete: exportId + fileBase64 required")
	}
	return c.finishExport(edStr(input["exportId"]), edStr(input["fileBase64"]), edStr(input["name"]), edStr(input["mimeType"]))
}

func editorExportFinalize(c *editorContext, input map[string]any) (any, error) {
	id := edStr(input["id"])
	if id == "" {
		return nil, editorError("export.finalize: id required")
	}
	result := edMap(input["result"])
	fileBase64 := edStr(result["fileBase64"])
	if fileBase64 == "" {
		return nil, editorError("export.finalize: result.fileBase64 missing")
	}
	if result["expectedVersion"] != nil && edIsNum(result["expectedVersion"]) {
		actual := int64(0)
		if existing := c.readProject(); existing != nil {
			actual = existing.Version
		}
		if int64(edNum(result["expectedVersion"])) != actual {
			return nil, editorErrorWithCode("timeline-version-stale",
				loc(c.locale, "时间线在导出期间发生变化，已丢弃这份旧成片。", "The timeline changed during export; the stale movie was discarded."),
				loc(c.locale, "重新读取 timeline.read 后，在新 version 上重试导出。", "Read timeline.read again and retry export against the new version."),
				true, map[string]any{"expectedVersion": int64(edNum(result["expectedVersion"])), "actualVersion": actual})
		}
	}
	exportID := edStr(result["exportId"])
	if exportID == "" {
		exportID = id
	}
	return c.finishExport(exportID, fileBase64, edStr(result["name"]), edStr(result["mimeType"]))
}

func editorExportList(c *editorContext, input map[string]any) (any, error) {
	c.ensureSchema()
	c.ensureExportSchema()
	rows, err := queryMaps(c.db, "select export_id, settings_json, asset_id, status, created_at from editor_exports where project_id = ? order by created_at desc", c.scopeID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"exports": rows}, nil
}

// ---- assets（项目素材引用索引）------------------------------------------------
// editorBackfillComponentAssets 刷新项目引用索引里 MG 素材的当前版本句柄；
// 素材真相在全局 mg_materials，这里只维护「本项目引了哪些 MG」。
func editorBackfillComponentAssets(c *editorContext) {
	c.ensureSchema()
	migrateEditorComponents(c)
	migrateLegacyMotionGraphicFiles(c)
	db, err := c.host.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	rows, err := queryMaps(c.db, "select ref_id from editor_assets where project_id = ? and type = 'component' and status = 'active'", c.scopeID)
	if err != nil {
		return
	}
	for _, row := range rows {
		id := edStr(row["ref_id"])
		if id == "" {
			continue
		}
		if material, ok := motion_graphic.Read(db, id); ok && material.Status == "verified" {
			_, _ = c.db.Exec("update editor_assets set ref_version_id = ?, updated_at = ? where project_id = ? and type = 'component' and ref_id = ?",
				material.VersionID(), nowIso(), c.scopeID, id)
		}
	}
}

func parseJSONValue(text string, fallback any) any {
	if text == "" {
		return fallback
	}
	var value any
	if json.Unmarshal([]byte(text), &value) != nil {
		return fallback
	}
	return value
}

func editorListProjectAssets(c *editorContext) []any {
	editorBackfillComponentAssets(c)
	rows, err := queryMaps(c.db,
		"select asset_id, type, ref_id, ref_version_id, status, created_at, updated_at "+
			"from editor_assets where project_id = ? and status = 'active' order by updated_at desc",
		c.scopeID)
	if err != nil {
		return []any{}
	}
	db, _ := c.host.store.WorkspaceDatabase()
	out := []any{}
	for _, row := range rows {
		asset := map[string]any{
			"assetId": row["asset_id"], "type": row["type"], "refId": row["ref_id"],
			"refVersionId": row["ref_version_id"], "status": row["status"],
			"createdAt": row["created_at"], "updatedAt": row["updated_at"],
		}
		if edStr(row["type"]) == "component" && db != nil {
			material, ok := motion_graphic.Read(db, edStr(row["ref_id"]))
			if !ok {
				continue
			}
			asset["componentId"] = material.ID
			asset["versionId"] = material.VersionID()
			asset["name"] = nonEmpty(material.Name, material.ID)
			asset["surface"] = nonEmpty(material.Surface, "r3f")
			asset["mode"] = nonEmpty(material.Mode, "local")
			asset["keywords"] = material.Keywords()
			asset["version"] = material.CodeVersion
			asset["componentStatus"] = nonEmpty(material.Status, "draft")
			asset["inputs"] = material.Inputs()
			asset["testReport"] = parseJSONValue(material.TestReportJSON, nil)
			if material.CoverRef != "" {
				asset["coverUrl"] = platformFileURL(material.CoverRef)
			} else {
				asset["coverUrl"] = nil
			}
		}
		out = append(out, asset)
	}
	return out
}

func editorAssetList(c *editorContext, input map[string]any) (any, error) {
	return map[string]any{"assets": editorListProjectAssets(c)}, nil
}

// editorAssetAdd adds a global media asset to the project's asset library
// (a project reference), so it appears in the editor's asset panel. It never
// imports bytes or touches the timeline.
func editorAssetAdd(c *editorContext, input map[string]any) (any, error) {
	assetID := edStr(input["assetId"])
	if assetID == "" {
		return nil, editorError("asset.add: assetId is required")
	}
	// 组件是全局素材，其项目成员关系同样落在项目侧引用索引；`component:` 前缀不再走媒体 attach。
	if strings.HasPrefix(assetID, "component:") {
		componentID, ok := c.registerGlobalComponentRef(assetID)
		if !ok {
			return nil, editorError("asset.add: component asset is missing, archived or not verified: " + assetID)
		}
		c.emit("project.components.changed", map[string]any{"componentId": componentID, "status": "verified", "asset": true})
		return map[string]any{"ok": true, "assetId": assetID}, nil
	}
	if err := c.attachMedia(assetID); err != nil {
		return nil, err
	}
	c.emit("project.assets.changed", map[string]any{"kind": "media", "mediaIds": []string{assetID}, "library": map[string]any{"tab": "media"}})
	return map[string]any{"ok": true, "assetId": assetID}, nil
}

// editorAssetRemove detaches a global media asset from the project's asset
// library (the inverse of asset.add). The global asset and its bytes survive;
// only the project reference is removed. The timeline is not touched.
func editorAssetRemove(c *editorContext, input map[string]any) (any, error) {
	assetID := edStr(input["assetId"])
	if assetID == "" {
		return nil, editorError("asset.remove: assetId is required")
	}
	if !c.target.IsProject() {
		return nil, editorError("asset.remove: a project target is required")
	}
	if c.host.media == nil {
		return nil, editorError("asset.remove: media service is unavailable")
	}
	if err := c.host.media.DetachProjectAsset(assetID, c.target.ProjectID); err != nil {
		return nil, err
	}
	c.emit("project.assets.changed", map[string]any{"kind": "media", "mediaIds": []string{assetID}, "library": map[string]any{"tab": "media"}})
	return map[string]any{"ok": true, "assetId": assetID}, nil
}

func editorAssetArchive(c *editorContext, input map[string]any) (any, error) {
	assetType := edStr(input["type"])
	refID := edStr(input["refId"])
	if assetType == "" || refID == "" {
		return nil, editorError("asset.archive: type and refId are required")
	}
	c.ensureSchema()
	_, err := c.db.Exec("update editor_assets set status = 'archived', updated_at = ? where project_id = ? and type = ? and ref_id = ?", nowIso(), c.scopeID, assetType, refID)
	if err != nil {
		return nil, err
	}
	if assetType == "component" {
		c.emit("project.components.changed", map[string]any{"componentId": refID, "status": "archived", "asset": true})
	}
	return map[string]any{"ok": true, "assetId": editorProjectAssetID(assetType, refID), "status": "archived"}, nil
}

// ---- 字幕生成（能力桥）-------------------------------------------------------
const editorSubtitleAudioStudioAppID = "recut.audio-studio"

var editorSubtitleASRModels = []any{"qwen3-asr-0.6b", "qwen3-asr-1.7b", "whisper-small", "whisper-medium", "whisper-large-v3"}
var editorSubtitleLanguages = []any{"auto", "zh", "en"}

func editorSubtitleValue(input map[string]any, name string) string {
	return strings.TrimSpace(edStr(input[name]))
}

func editorSubtitleReuseKey(targetAssetID, model, language string) string {
	return targetAssetID + "|" + model + "|" + language
}

func (c *editorContext) ensureSubtitleJobSchema() {
	_, _ = c.db.Exec("create table if not exists subtitle_jobs (" +
		"project_id text not null, job_id text not null, transcript_id text not null default '', " +
		"target_asset_id text not null default '', target_kind text not null default '', " +
		"model text not null default '', language text not null default '', reuse_key text not null default '', " +
		"status text not null default 'queued', transcript_asset_id text not null default '', " +
		"error text not null default '', created_at text not null, updated_at text not null, " +
		"primary key (project_id, job_id))")
}

func (c *editorContext) writeSubtitleJob(jobID string, fields map[string]any) {
	now := nowIso()
	createdAt := edStr(fields["createdAt"])
	if createdAt == "" {
		createdAt = now
	}
	_, _ = c.db.Exec("insert or replace into subtitle_jobs (project_id, job_id, transcript_id, target_asset_id, target_kind, model, language, reuse_key, status, transcript_asset_id, error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		c.scopeID, jobID, edStr(fields["transcriptId"]), edStr(fields["targetAssetId"]), edStr(fields["targetKind"]),
		edStr(fields["model"]), edStr(fields["language"]), edStr(fields["reuseKey"]), nonEmpty(edStr(fields["status"]), "queued"),
		edStr(fields["transcriptAssetId"]), edStr(fields["error"]), createdAt, now)
}

func (c *editorContext) updateSubtitleJobStatus(jobID, status, transcriptAssetID, errText string) {
	_, _ = c.db.Exec("update subtitle_jobs set status = ?, transcript_asset_id = ?, error = ?, updated_at = ? where project_id = ? and job_id = ?",
		status, transcriptAssetID, errText, nowIso(), c.scopeID, jobID)
}

func editorSubtitleCapabilities(c *editorContext, input map[string]any) (any, error) {
	inspect := c.capabilityInspect(editorSubtitleAudioStudioAppID)
	reason := "unknown"
	if !okBool(inspect["ready"]) {
		if edStr(inspect["status"]) == "not-installed" {
			reason = "not-installed"
		} else {
			reason = "stale"
		}
	}
	base := map[string]any{
		"appId": editorSubtitleAudioStudioAppID, "ready": false, "envReady": false,
		"asrModels": editorSubtitleASRModels, "installedModels": []any{}, "languages": editorSubtitleLanguages,
		"status": nonEmpty(edStr(inspect["status"]), "not-installed"), "reason": reason,
		"code": edStr(inspect["code"]), "message": edStr(inspect["message"]), "action": edStr(inspect["action"]),
	}
	if inspect["install"] != nil {
		base["install"] = inspect["install"]
	} else {
		base["install"] = nil
	}
	if reason == "not-installed" || reason == "stale" {
		return base, nil
	}
	statusCall, _ := c.capabilityInvoke(editorSubtitleAudioStudioAppID, "audio.status", map[string]any{})
	var status map[string]any
	if statusCall != nil && okBool(statusCall["ok"]) {
		status = edMap(statusCall["result"])
	}
	envReady := status != nil && okBool(status["ready"])
	installed := []any{}
	if status != nil {
		if asr := edMap(status["asr"]); asr != nil {
			if list := edSlice(asr["installed"]); list != nil {
				installed = list
			}
		}
	}
	if !envReady {
		reason = "env"
	} else if len(installed) == 0 {
		reason = "no-model"
	} else {
		reason = "ready"
	}
	action := ""
	if !envReady {
		action = nonEmpty(edStr(status["error"]), nonEmpty(edStr(status["action"]), "Open Audio Studio, prepare its runtime, then install an ASR model."))
	}
	envError := ""
	if !envReady && status != nil {
		envError = edStr(status["error"])
	}
	return map[string]any{
		"appId": editorSubtitleAudioStudioAppID, "ready": envReady, "envReady": envReady,
		"asrModels": editorSubtitleASRModels, "installedModels": installed, "languages": editorSubtitleLanguages,
		"status": nonEmpty(edStr(inspect["status"]), "not-installed"), "reason": reason,
		"code": edStr(inspect["code"]), "message": edStr(inspect["message"]), "action": action,
		"install": inspect["install"], "envError": envError,
	}, nil
}

func editorSubtitleGenerate(c *editorContext, input map[string]any) (any, error) {
	targetAssetID := editorSubtitleValue(input, "targetAssetId")
	if targetAssetID == "" {
		targetAssetID = editorSubtitleValue(input, "assetId")
	}
	kind := "video"
	if edStr(input["kind"]) == "audio" {
		kind = "audio"
	}
	model := nonEmpty(editorSubtitleValue(input, "model"), "whisper-small")
	language := nonEmpty(editorSubtitleValue(input, "language"), "auto")
	if targetAssetID == "" {
		return nil, editorError("subtitle.generate: targetAssetId required")
	}
	if !editorContainsString(anyToStrings(editorSubtitleASRModels), model) {
		return nil, editorError("subtitle.generate: unsupported model " + model)
	}
	if !editorContainsString(anyToStrings(editorSubtitleLanguages), language) {
		return nil, editorError("subtitle.generate: unsupported language " + language)
	}
	c.ensureSubtitleJobSchema()
	reuseKey := editorSubtitleReuseKey(targetAssetID, model, language)
	active, _ := queryMaps(c.db, "select job_id from subtitle_jobs where project_id = ? and reuse_key = ? and status in ('queued','running') order by created_at desc limit 1", c.scopeID, reuseKey)
	if len(active) > 0 {
		return map[string]any{"jobId": edStr(active[0]["job_id"]), "reused": true}, nil
	}
	done, _ := queryMaps(c.db, "select job_id, transcript_id, transcript_asset_id from subtitle_jobs where project_id = ? and reuse_key = ? and status = 'completed' and transcript_asset_id != '' order by created_at desc limit 1", c.scopeID, reuseKey)
	if len(done) > 0 {
		return map[string]any{"jobId": edStr(done[0]["job_id"]), "reused": true, "completed": true, "transcriptId": edStr(done[0]["transcript_id"]), "transcriptAssetId": edStr(done[0]["transcript_asset_id"])}, nil
	}
	invoke, err := c.capabilityInvoke(editorSubtitleAudioStudioAppID, "audio.transcribe", map[string]any{"assetId": targetAssetID, "kind": kind, "model": model, "language": language, "saveToLibrary": true})
	if err != nil {
		return nil, err
	}
	if invoke == nil || !okBool(invoke["ok"]) {
		e := edMap(invoke["error"])
		return map[string]any{"ok": false, "code": nonEmpty(edStr(e["code"]), "provider.error"), "message": nonEmpty(edStr(e["message"]), "audio.transcribe failed"), "hint": e["hint"], "retryable": e["retryable"], "phase": e["phase"]}, nil
	}
	result := edMap(invoke["result"])
	transcriptID := ""
	if transcript := edMap(result["transcript"]); transcript != nil {
		transcriptID = edStr(transcript["id"])
	}
	if okBool(result["reused"]) && transcriptID != "" {
		jobID := "reuse-" + transcriptID
		c.writeSubtitleJob(jobID, map[string]any{"transcriptId": transcriptID, "targetAssetId": targetAssetID, "targetKind": kind, "model": model, "language": language, "reuseKey": reuseKey, "status": "completed", "transcriptAssetId": edStr(result["transcriptAssetId"])})
		return map[string]any{"jobId": jobID, "reused": true, "completed": true, "transcriptId": transcriptID, "transcriptAssetId": edStr(result["transcriptAssetId"])}, nil
	}
	jobID := ""
	if job := edMap(result["job"]); job != nil {
		jobID = edStr(job["id"])
	}
	if jobID == "" {
		return map[string]any{"ok": false, "code": "provider.error", "message": "audio.transcribe did not return a job id"}, nil
	}
	c.writeSubtitleJob(jobID, map[string]any{"transcriptId": transcriptID, "targetAssetId": targetAssetID, "targetKind": kind, "model": model, "language": language, "reuseKey": reuseKey, "status": "queued"})
	return map[string]any{"jobId": jobID, "reused": false, "transcriptId": transcriptID}, nil
}

func editorSubtitleStatus(c *editorContext, input map[string]any) (any, error) {
	jobID := editorSubtitleValue(input, "jobId")
	if jobID == "" {
		return nil, editorError("subtitle.status: jobId required")
	}
	c.ensureSubtitleJobSchema()
	rows, _ := queryMaps(c.db, "select transcript_id, target_asset_id, target_kind, status, transcript_asset_id, error from subtitle_jobs where project_id = ? and job_id = ?", c.scopeID, jobID)
	if len(rows) == 0 {
		return map[string]any{"ok": false, "reason": "job-not-found"}, nil
	}
	row := rows[0]
	transcriptID := edStr(row["transcript_id"])
	if transcriptID != "" {
		poll, _ := c.capabilityInvoke(editorSubtitleAudioStudioAppID, "audio.transcript", map[string]any{"id": transcriptID})
		if poll != nil && okBool(poll["ok"]) && poll["result"] != nil {
			rec := edMap(poll["result"])
			providerStatus := nonEmpty(edStr(rec["status"]), "queued")
			transcriptAssetID := edStr(rec["transcriptAssetId"])
			if transcriptAssetID == "" {
				transcriptAssetID = edStr(rec["savedAssetId"])
			}
			c.updateSubtitleJobStatus(jobID, providerStatus, transcriptAssetID, edStr(rec["error"]))
			completed := providerStatus == "completed" || edStr(rec["srt"]) != "" || edSlice(rec["segments"]) != nil
			if completed {
				segments := edSlice(rec["segments"])
				if segments == nil {
					segments = []any{}
				}
				return map[string]any{"jobId": jobID, "status": "completed", "transcriptId": transcriptID, "transcriptAssetId": transcriptAssetID,
					"segments": segments, "srt": edStr(rec["srt"]), "model": edStr(rec["model"]), "language": edStr(rec["language"])}, nil
			}
			status := "running"
			if providerStatus == "completed" || providerStatus == "failed" || providerStatus == "cancelled" || providerStatus == "timed_out" {
				status = providerStatus
			}
			return map[string]any{"jobId": jobID, "status": status, "transcriptId": transcriptID, "error": edStr(rec["error"])}, nil
		}
		pollError := edMap(edMap(poll)["error"])
		return map[string]any{"jobId": jobID, "status": "error", "retryable": edBool(pollError["retryable"]),
			"error": nonEmpty(edStr(pollError["message"]), nonEmpty(edStr(pollError["code"]), "audio.transcript unavailable")), "transcriptId": transcriptID}, nil
	}
	status := "running"
	if s := edStr(row["status"]); s == "completed" || s == "failed" || s == "cancelled" || s == "timed_out" {
		status = s
	}
	return map[string]any{"jobId": jobID, "status": status, "transcriptAssetId": edStr(row["transcript_asset_id"]), "error": edStr(row["error"])}, nil
}

func editorSubtitleCancel(c *editorContext, input map[string]any) (any, error) {
	jobID := editorSubtitleValue(input, "jobId")
	if jobID == "" {
		return nil, editorError("subtitle.cancel: jobId required")
	}
	c.ensureSubtitleJobSchema()
	rows, _ := queryMaps(c.db, "select status from subtitle_jobs where project_id = ? and job_id = ?", c.scopeID, jobID)
	if len(rows) == 0 {
		return map[string]any{"ok": false, "reason": "job-not-found"}, nil
	}
	status := edStr(rows[0]["status"])
	if status == "completed" || status == "failed" || status == "cancelled" || status == "timed_out" {
		return map[string]any{"ok": true, "status": status, "alreadyTerminal": true}, nil
	}
	cancelled := false
	active, _ := c.capabilityInvoke(editorSubtitleAudioStudioAppID, "audio.status", map[string]any{})
	if active != nil && okBool(active["ok"]) {
		if activeJob := edMap(edMap(active["result"])["activeJob"]); activeJob != nil {
			jobStatus := edStr(activeJob["status"])
			if edStr(activeJob["id"]) == jobID && (jobStatus == "queued" || jobStatus == "running") {
				cancelCall, _ := c.capabilityInvoke(editorSubtitleAudioStudioAppID, "audio.cancel", map[string]any{})
				cancelled = cancelCall != nil && okBool(cancelCall["ok"])
			}
		}
	}
	c.updateSubtitleJobStatus(jobID, "cancelled", "", "用户取消")
	return map[string]any{"ok": true, "status": "cancelled", "cancelled": cancelled}, nil
}

func editorSubtitleRetrySave(c *editorContext, input map[string]any) (any, error) {
	jobID := editorSubtitleValue(input, "jobId")
	if jobID == "" {
		return nil, editorError("subtitle.retry-save: jobId required")
	}
	c.ensureSubtitleJobSchema()
	rows, _ := queryMaps(c.db, "select transcript_id, status, transcript_asset_id from subtitle_jobs where project_id = ? and job_id = ?", c.scopeID, jobID)
	if len(rows) == 0 {
		return map[string]any{"ok": false, "reason": "job-not-found"}, nil
	}
	transcriptID := edStr(rows[0]["transcript_id"])
	if transcriptID == "" {
		return map[string]any{"ok": false, "reason": "no-transcript-id"}, nil
	}
	inv, _ := c.capabilityInvoke(editorSubtitleAudioStudioAppID, "audio.transcript", map[string]any{"id": transcriptID})
	if inv != nil && okBool(inv["ok"]) && inv["result"] != nil {
		rec := edMap(inv["result"])
		transcriptAssetID := edStr(rec["transcriptAssetId"])
		if transcriptAssetID == "" {
			transcriptAssetID = edStr(rec["savedAssetId"])
		}
		if transcriptAssetID != "" {
			c.updateSubtitleJobStatus(jobID, "completed", transcriptAssetID, "")
			return map[string]any{"ok": true, "transcriptAssetId": transcriptAssetID}, nil
		}
		return map[string]any{"ok": false, "message": nonEmpty(edStr(rec["error"]), "transcription finished but the transcript is not in the library yet")}, nil
	}
	e := edMap(edMap(inv)["error"])
	return map[string]any{"ok": false, "message": nonEmpty(edStr(e["message"]), "audio.transcript unavailable")}, nil
}

func editorSubtitleCommit(c *editorContext, input map[string]any) (any, error) {
	transcriptAssetID := editorSubtitleValue(input, "transcriptAssetId")
	if transcriptAssetID == "" {
		transcriptAssetID = editorSubtitleValue(input, "assetId")
	}
	if transcriptAssetID == "" {
		return nil, editorError("subtitle.commit: transcriptAssetId required")
	}
	if err := c.attachMedia(transcriptAssetID); err != nil {
		return nil, err
	}
	c.emit("project.assets.changed", map[string]any{"kind": "any", "mediaIds": []string{transcriptAssetID}, "library": map[string]any{"tab": "media"}})
	attached := false
	if edStr(input["trackId"]) != "" && edStr(input["elementId"]) != "" {
		out := c.executeCommand(map[string]any{"type": "transcript-attach", "payload": map[string]any{
			"ref":      map[string]any{"trackId": input["trackId"], "elementId": input["elementId"]},
			"assetId":  transcriptAssetID,
			"source":   nonEmpty(edStr(input["source"]), "transcript"),
			"language": input["language"],
		}})
		attached = okBool(out["ok"])
	}
	return map[string]any{"ok": true, "transcriptAssetId": transcriptAssetID, "attached": attached}, nil
}

// ---- 小工具 -----------------------------------------------------------------
func anyToStrings(values []any) []string {
	out := []string{}
	for _, v := range values {
		out = append(out, edStr(v))
	}
	return out
}
