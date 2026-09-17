/*
 * [INPUT]: 依赖 editorContext（appstate DB、事件广播）与 editor_model/editor_ops 的纯函数。
 * [OUTPUT]: SQLite schema、项目读写、乐观锁、命令日志、undo/redo、锁与工作单元检查点（project-store.js 的 Go 权威实现）。
 * [POS]: service editor 域的持久化与事务边界；不注册外部 operation。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"strconv"
	"time"
)

const editorAILockTimeoutMS = int64(5 * 60 * 1000)

type editorProjectRow struct {
	Project          map[string]any
	RegisteredAssets []any
	Version          int64
	UpdatedAt        string
}

func (c *editorContext) ensureSchema() {
	statements := []string{
		"create table if not exists editor_projects (" +
			"project_id text not null primary key, " +
			"project_json text not null, " +
			"registered_assets_json text not null default '[]', " +
			"version integer not null default 1, " +
			"updated_at text not null)",
		"create table if not exists editor_command_log (" +
			"seq integer not null, " +
			"project_id text not null, " +
			"op_json text not null, " +
			"before_scenes_json text not null, " +
			"base_version integer not null, " +
			"result_version integer not null, " +
			"state text not null default 'done', " +
			"created_at text not null, " +
			"primary key (project_id, seq))",
		"create table if not exists editor_ai_locks (" +
			"project_id text not null primary key, " +
			"owner text not null, " +
			"token text not null default '', " +
			"since text not null, " +
			"last_op_at text not null)",
		"create table if not exists editor_work_checkpoints (" +
			"project_id text not null primary key, checkpoint_seq integer not null, " +
			"owner text, lock_token text, version integer not null, created_at text not null)",
		"create table if not exists editor_cover_prefs (" +
			"project_id text not null primary key, " +
			"mode text not null default 'auto', " +
			"frame_sec real, " +
			"asset_id text not null default '', " +
			"updated_at text not null)",
		"create table if not exists editor_components (" +
			"component_id text not null primary key, " +
			"project_id text not null, " +
			"name text not null, " +
			"surface text not null, " +
			"keywords_json text not null default '[]', " +
			"head_version_id text, " +
			"archived_at text, " +
			"mode text not null default 'local', " +
			"created_at text not null, " +
			"updated_at text not null)",
		"create table if not exists editor_component_versions (" +
			"version_id text not null primary key, " +
			"component_id text not null, " +
			"version integer not null, " +
			"source text not null, " +
			"bundle_hash text not null, " +
			"bundle text not null, " +
			"inputs_json text not null, " +
			"status text not null default 'draft', " +
			"test_report_json text, " +
			"cover_path text not null default '', " +
			"created_at text not null, " +
			"verified_at text)",
		"create table if not exists editor_assets (" +
			"asset_id text not null primary key, " +
			"project_id text not null, " +
			"type text not null, " +
			"ref_id text not null, " +
			"ref_version_id text, " +
			"status text not null default 'active', " +
			"created_at text not null, " +
			"updated_at text not null, " +
			"unique (project_id, type, ref_id))",
		"create table if not exists editor_exports (" +
			"export_id text not null primary key, project_id text not null, settings_json text not null, " +
			"asset_id text, status text not null, created_at text not null, updated_at text not null)",
		"create table if not exists editor_frame_sessions (" +
			"project_id text not null primary key, last_seen_at text not null, updated_at text not null)",
		"create table if not exists subtitle_jobs (" +
			"project_id text not null, job_id text not null, transcript_id text not null default '', " +
			"target_asset_id text not null default '', target_kind text not null default '', " +
			"model text not null default '', language text not null default '', reuse_key text not null default '', " +
			"status text not null default 'queued', transcript_asset_id text not null default '', " +
			"error text not null default '', created_at text not null, updated_at text not null, " +
			"primary key (project_id, job_id))",
	}
	for _, statement := range statements {
		_, _ = c.db.Exec(statement)
	}
	for _, alter := range []string{
		"alter table editor_ai_locks add column token text not null default ''",
		"alter table editor_components add column archived_at text",
		"alter table editor_components add column mode text not null default 'local'",
		"alter table editor_component_versions add column cover_path text not null default ''",
	} {
		_, _ = c.db.Exec(alter)
	}
}

// queryMaps 把查询结果按列名转为 []map[string]any（[]byte 归一为 string）。
func queryMaps(db *sql.DB, query string, args ...any) ([]map[string]any, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, column := range columns {
			switch v := values[i].(type) {
			case []byte:
				row[column] = string(v)
			default:
				row[column] = v
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (c *editorContext) readProject() *editorProjectRow {
	c.ensureSchema()
	rows, err := queryMaps(c.db, "select project_json, registered_assets_json, version, updated_at from editor_projects where project_id = ?", c.scopeID)
	if err != nil || len(rows) == 0 {
		return nil
	}
	row := rows[0]
	var project map[string]any
	if err := json.Unmarshal([]byte(edStr(row["project_json"])), &project); err != nil {
		project = nil
	}
	var registered []any
	_ = json.Unmarshal([]byte(edStr(row["registered_assets_json"])), &registered)
	if registered == nil {
		registered = []any{}
	}
	return &editorProjectRow{
		Project:          project,
		RegisteredAssets: registered,
		Version:          int64(edNum(row["version"])),
		UpdatedAt:        edStr(row["updated_at"]),
	}
}

func (c *editorContext) writeProject(project map[string]any, registeredAssets []any, baseVersion *int64) map[string]any {
	c.ensureSchema()
	existing := c.readProject()
	current := int64(0)
	if existing != nil {
		current = existing.Version
	}
	if baseVersion != nil && current != *baseVersion {
		return map[string]any{"ok": false, "conflict": true, "currentVersion": current}
	}
	nextVersion := int64(1)
	if existing != nil {
		nextVersion = existing.Version + 1
	}
	nextRegistered := registeredAssets
	if nextRegistered == nil {
		if existing != nil {
			nextRegistered = existing.RegisteredAssets
		} else {
			nextRegistered = []any{}
		}
	}
	if project != nil {
		project["version"] = nextVersion
	}
	result, err := c.db.Exec("insert into editor_projects (project_id, project_json, registered_assets_json, version, updated_at) values (?, ?, ?, ?, ?) "+
		"on conflict(project_id) do update set "+
		"project_json = excluded.project_json, registered_assets_json = excluded.registered_assets_json, "+
		"version = excluded.version, updated_at = excluded.updated_at "+
		"where editor_projects.version = ?",
		c.scopeID, marshalJSONNoEscape(project), marshalJSONNoEscape(nextRegistered), nextVersion, nowIso(), current)
	if err != nil {
		return map[string]any{"ok": false, "conflict": true, "currentVersion": current}
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return map[string]any{"ok": false, "conflict": true, "currentVersion": current}
	}
	return map[string]any{"ok": true, "version": nextVersion, "registeredAssets": nextRegistered}
}

// ---- 锁 ---------------------------------------------------------------------
func (c *editorContext) readLock() map[string]any {
	rows, err := queryMaps(c.db, "select owner, token, since, last_op_at from editor_ai_locks where project_id = ?", c.scopeID)
	if err != nil || len(rows) == 0 {
		return nil
	}
	r := rows[0]
	return map[string]any{"owner": edStr(r["owner"]), "token": edStr(r["token"]), "since": edStr(r["since"]), "lastOpAt": edStr(r["last_op_at"])}
}

func lockExpired(lock map[string]any) bool {
	if lock == nil {
		return false
	}
	last, err := time.Parse("2006-01-02T15:04:05.000Z", edStr(lock["lastOpAt"]))
	if err != nil {
		last, err = time.Parse(time.RFC3339Nano, edStr(lock["lastOpAt"]))
		if err != nil {
			return false
		}
	}
	return time.Since(last).Milliseconds() > editorAILockTimeoutMS
}

func (c *editorContext) lockToken() string {
	return "lock-" + strconv.FormatInt(time.Now().UnixMilli(), 36) + "-" + edRandomSuffix()
}

func (c *editorContext) writeLock(owner, token string) {
	c.ensureSchema()
	_, _ = c.db.Exec("insert into editor_ai_locks (project_id, owner, token, since, last_op_at) values (?, ?, ?, ?, ?) "+
		"on conflict(project_id) do update set owner = excluded.owner, token = excluded.token, since = excluded.since, last_op_at = excluded.last_op_at",
		c.scopeID, owner, token, nowIso(), nowIso())
}

func (c *editorContext) clearLock() {
	_, _ = c.db.Exec("delete from editor_ai_locks where project_id = ?", c.scopeID)
}

func (c *editorContext) touchLock() {
	_, _ = c.db.Exec("update editor_ai_locks set last_op_at = ? where project_id = ?", nowIso(), c.scopeID)
}

// ---- 命令日志 ---------------------------------------------------------------
func (c *editorContext) nextLogSeq() int64 {
	rows, err := queryMaps(c.db, "select coalesce(max(seq), 0) as m from editor_command_log where project_id = ?", c.scopeID)
	if err != nil || len(rows) == 0 {
		return 1
	}
	return int64(edNum(rows[0]["m"])) + 1
}

func (c *editorContext) currentDoneSeq() int64 {
	c.ensureSchema()
	rows, err := queryMaps(c.db, "select coalesce(max(seq), 0) as m from editor_command_log where project_id = ? and state = 'done'", c.scopeID)
	if err != nil || len(rows) == 0 {
		return 0
	}
	return int64(edNum(rows[0]["m"]))
}

func (c *editorContext) logSince(afterVersion int64) []any {
	rows, err := queryMaps(c.db, "select op_json from editor_command_log where project_id = ? and result_version > ? order by seq asc", c.scopeID, afterVersion)
	if err != nil {
		return []any{}
	}
	out := []any{}
	for _, row := range rows {
		var op any
		if json.Unmarshal([]byte(edStr(row["op_json"])), &op) == nil {
			out = append(out, op)
		}
	}
	return out
}

// headVersionStatus 读组件 head 版本的验证状态（组件存储仍归 background/M2）。
func (c *editorContext) headVersionStatus(componentID string) (string, bool) {
	c.ensureSchema()
	rows, err := queryMaps(c.db,
		"select v.status from editor_component_versions v "+
			"where v.version_id = (select head_version_id from editor_components where component_id = ? and project_id = ?)",
		componentID, c.scopeID)
	if err != nil || len(rows) == 0 {
		return "", false
	}
	return edStr(rows[0]["status"]), true
}

func opComponentIDs(op map[string]any) []string {
	out := []string{}
	payload := edMap(op["payload"])
	if edStr(op["type"]) == "insert" {
		element := edMap(payload["element"])
		if edStr(element["type"]) == "component" && edStr(element["componentId"]) != "" {
			out = append(out, edStr(element["componentId"]))
		}
	}
	if edStr(op["type"]) == "component-placement" {
		for _, itemValue := range edSlice(payload["items"]) {
			item := edMap(itemValue)
			if id := edStr(item["componentId"]); id != "" {
				out = append(out, id)
			}
		}
	}
	return out
}

// executeCommand 事务式：apply op → 快照 → 落库 → append 日志 → version 递增。
func (c *editorContext) executeCommand(op map[string]any) map[string]any {
	c.ensureSchema()
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return map[string]any{"ok": false, "error": "timeline.command: project not found, run project.create first"}
	}
	baseVersion := existing.Version
	if op["baseVersion"] != nil && edIsNum(op["baseVersion"]) {
		baseVersion = int64(edNum(op["baseVersion"]))
	}
	if baseVersion != existing.Version {
		return map[string]any{"ok": false, "conflict": true, "currentVersion": existing.Version, "opsSince": c.logSince(baseVersion)}
	}
	for _, componentID := range opComponentIDs(op) {
		status, ok := c.headVersionStatus(componentID)
		if !ok || status != "verified" {
			return map[string]any{"ok": false, "error": "component must be verified in the component library before it can be inserted into the timeline"}
		}
	}
	seq := c.nextLogSeq()
	project := edCloneMap(existing.Project)
	beforeProject := edCloneMap(project)
	result, err := applyOp(project, map[string]any{"type": op["type"], "payload": nonNilMap(op["payload"])}, editorOpOptions{Seq: float64(seq), Locale: c.locale})
	if err != nil {
		return map[string]any{"ok": false, "error": editorErrorMessage(err)}
	}
	metadata := edMap(project["metadata"])
	if metadata == nil {
		metadata = map[string]any{"id": c.scopeID, "name": loc(c.locale, "未命名剪辑", "Untitled project")}
		project["metadata"] = metadata
	}
	metadata["updatedAt"] = nowIso()
	write := c.writeProject(project, nil, &existing.Version)
	if !okBool(write["ok"]) {
		return map[string]any{"ok": false, "conflict": true, "currentVersion": write["currentVersion"]}
	}
	project["version"] = write["version"]
	_, _ = c.db.Exec("update editor_command_log set state = 'dropped' where project_id = ? and state = 'undone'", c.scopeID)
	storedOp := map[string]any{"type": op["type"], "payload": nonNilMap(op["payload"])}
	if op["transactionId"] != nil {
		storedOp["transactionId"] = op["transactionId"]
	}
	_, _ = c.db.Exec("insert into editor_command_log (seq, project_id, op_json, before_scenes_json, base_version, result_version, state, created_at) values (?, ?, ?, ?, ?, ?, 'done', ?)",
		seq, c.scopeID, marshalJSONNoEscape(storedOp), marshalJSONNoEscape(beforeProject), existing.Version, int64(edNum(write["version"])), nowIso())
	lock := c.readLock()
	if lock != nil {
		c.touchLock()
	}
	details := map[string]any{
		"fromVersion": existing.Version,
		"toVersion":   int64(edNum(write["version"])),
		"operations":  []any{storedOp},
		"document":    project,
	}
	if op["transactionId"] != nil {
		details["transactionId"] = op["transactionId"]
	} else {
		details["transactionId"] = nil
	}
	c.emitDocumentChanged(int64(edNum(write["version"])), "agent", details)
	var lockView any
	if lock != nil {
		lockView = map[string]any{"owner": lock["owner"]}
	}
	return map[string]any{
		"ok":      true,
		"version": int64(edNum(write["version"])),
		"seq":     seq,
		"result":  result,
		"changed": true,
		"lock":    lockView,
	}
}

func (c *editorContext) undoLast() map[string]any {
	c.ensureSchema()
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return map[string]any{"ok": false, "error": "history: project not found"}
	}
	rows, err := queryMaps(c.db, "select seq, before_scenes_json from editor_command_log where project_id = ? and state = 'done' order by seq desc limit 1", c.scopeID)
	if err != nil || len(rows) == 0 {
		return map[string]any{"ok": false, "reason": "nothing-to-undo"}
	}
	row := rows[0]
	var project map[string]any
	if err := json.Unmarshal([]byte(edStr(row["before_scenes_json"])), &project); err != nil || project == nil {
		project = edCloneMap(existing.Project)
	}
	metadata := edMap(project["metadata"])
	if metadata == nil {
		metadata = map[string]any{"id": c.scopeID, "name": loc(c.locale, "未命名剪辑", "Untitled project")}
		project["metadata"] = metadata
	}
	metadata["updatedAt"] = nowIso()
	write := c.writeProject(project, nil, &existing.Version)
	if !okBool(write["ok"]) {
		return map[string]any{"ok": false, "conflict": true, "currentVersion": write["currentVersion"]}
	}
	project["version"] = write["version"]
	_, _ = c.db.Exec("update editor_command_log set state = 'undone' where project_id = ? and seq = ?", c.scopeID, int64(edNum(row["seq"])))
	c.emitDocumentChanged(int64(edNum(write["version"])), "agent", map[string]any{
		"fromVersion": existing.Version,
		"toVersion":   int64(edNum(write["version"])),
		"operations":  []any{},
		"document":    project,
	})
	return map[string]any{"ok": true, "version": int64(edNum(write["version"])), "undidSeq": int64(edNum(row["seq"]))}
}

func (c *editorContext) redoNext() map[string]any {
	c.ensureSchema()
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return map[string]any{"ok": false, "error": "history: project not found"}
	}
	rows, err := queryMaps(c.db, "select seq, op_json from editor_command_log where project_id = ? and state = 'undone' order by seq desc limit 1", c.scopeID)
	if err != nil || len(rows) == 0 {
		return map[string]any{"ok": false, "reason": "nothing-to-redo"}
	}
	row := rows[0]
	var op map[string]any
	if err := json.Unmarshal([]byte(edStr(row["op_json"])), &op); err != nil || op == nil {
		return map[string]any{"ok": false, "error": "corrupt op"}
	}
	project := edCloneMap(existing.Project)
	result, err := applyOp(project, op, editorOpOptions{Seq: float64(int64(edNum(row["seq"]))), Locale: c.locale})
	if err != nil {
		return map[string]any{"ok": false, "error": editorErrorMessage(err)}
	}
	if metadata := edMap(project["metadata"]); metadata != nil {
		metadata["updatedAt"] = nowIso()
	}
	write := c.writeProject(project, nil, &existing.Version)
	if !okBool(write["ok"]) {
		return map[string]any{"ok": false, "conflict": true, "currentVersion": write["currentVersion"]}
	}
	project["version"] = write["version"]
	_, _ = c.db.Exec("update editor_command_log set state = 'done', result_version = ? where project_id = ? and seq = ?", int64(edNum(write["version"])), c.scopeID, int64(edNum(row["seq"])))
	c.emitDocumentChanged(int64(edNum(write["version"])), "agent", map[string]any{
		"fromVersion": existing.Version,
		"toVersion":   int64(edNum(write["version"])),
		"operations":  []any{op},
		"document":    project,
	})
	return map[string]any{"ok": true, "version": int64(edNum(write["version"])), "redidSeq": int64(edNum(row["seq"])), "result": result}
}

// ---- 默认项目 / 汇总 --------------------------------------------------------
func makeDefaultProject(scopeID, name string, settings map[string]any, materialAssetIds []any, locale Locale) map[string]any {
	now := nowIso()
	mainTrackID := "track-main-" + edRandomSuffix()[:8]
	sceneID := "scene-" + edRandomSuffix()[:8]
	fps := editorDefaultFPS
	if settings != nil && settings["fps"] != nil {
		fps = edMap(settings["fps"])
	}
	canvasSize := editorDefaultCanvas
	if settings != nil && settings["canvasSize"] != nil {
		canvasSize = edMap(settings["canvasSize"])
	}
	background := map[string]any{"type": "color", "color": "#000000"}
	if settings != nil && settings["background"] != nil {
		background = edMap(settings["background"])
	}
	if name == "" {
		name = loc(locale, "未命名剪辑", "Untitled project")
	}
	if materialAssetIds == nil {
		materialAssetIds = []any{}
	}
	return map[string]any{
		"metadata": map[string]any{"id": scopeID, "name": name, "thumbnail": nil, "duration": float64(0), "createdAt": now, "updatedAt": now},
		"scenes": []any{
			map[string]any{
				"id":        sceneID,
				"name":      "Main scene",
				"isMain":    true,
				"tracks":    map[string]any{"overlay": []any{}, "main": map[string]any{"id": mainTrackID, "name": "Main", "type": "video", "elements": []any{}, "muted": false, "hidden": false}, "audio": []any{}},
				"bookmarks": []any{},
				"createdAt": now,
				"updatedAt": now,
			},
		},
		"currentSceneId":   sceneID,
		"settings":         map[string]any{"fps": fps, "canvasSize": canvasSize, "background": background},
		"version":          float64(1),
		"materialAssetIds": materialAssetIds,
	}
}

func projectDurationTicks(project map[string]any) float64 {
	maxEnd := float64(0)
	for _, sv := range edSlice(project["scenes"]) {
		for _, track := range sceneTrackList(edSceneTracks(edMap(sv))) {
			for _, ev := range edSlice(track["elements"]) {
				el := edMap(ev)
				end := edNum(el["startTime"]) + edNum(el["duration"])
				if end > maxEnd {
					maxEnd = end
				}
			}
		}
	}
	return maxEnd
}

func summarizeTimeline(project map[string]any) map[string]any {
	c := condensedTimeline(project)
	return map[string]any{"elements": len(edSlice(c["clips"])), "tracks": len(edSlice(c["tracks"]))}
}

// ---- 小工具 -----------------------------------------------------------------
func okBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func editorErrorMessage(err error) string {
	if me, ok := err.(*mcpError); ok {
		return me.Message
	}
	return err.Error()
}
