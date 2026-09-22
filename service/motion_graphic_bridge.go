/*
 * [INPUT]: 依赖 editorContext（项目/引用/事件命名空间）、Store.PlatformFilesRoot（平台全局文件根）
 *          与 motion_graphic 全域素材包。
 * [OUTPUT]: motion_graphic 的平台宿主适配：素材真相在平台全局（workspace DB + 平台文件根，
 *           无 AppID）、可选的「顺带登记项目引用」、项目派生上下文，以及 editor 私有组件表到
 *           全局 mg_materials 的一次性迁移。
 * [POS]: service 与 motion_graphic 包的接缝；MG 领域逻辑全在 motion_graphic 包，这里只做宿主适配。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"recut-service/media"
	"recut-service/motion_graphic"
)

func preferenceSet(db *sql.DB, key string) bool {
	rows, err := queryMaps(db, "select value_json from workspace_preferences where key = ?", key)
	return err == nil && len(rows) > 0
}

func setPreference(db *sql.DB, key, value string) {
	_, _ = db.Exec("insert into workspace_preferences (key, value_json, updated_at) values (?, ?, ?) on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at",
		key, value, nowIso())
}

type mgHost struct{ c *editorContext }

func (h mgHost) DB() (*sql.DB, error) { return h.c.host.store.WorkspaceDatabase() }
func (h mgHost) FilesRoot() string {
	root, err := h.c.host.store.PlatformFilesRoot()
	if err != nil {
		return ""
	}
	return root
}
func (h mgHost) IsZh() bool { return h.c.locale == LocaleZh }
func (h mgHost) Emit(eventType string, payload map[string]any) {
	h.c.emit(eventType, payload)
}
func (h mgHost) OnVerified(id, versionID string) {
	// MG 组件首先是统一素材库的一员：投影一条 kind=component 的全局 Asset，
	// 使其像图片/视频一样出现在素材库、可预览、可挂项目引用。
	h.projectComponentAsset(id, versionID)
	// 只有消费方提供了项目目标时才顺带登记项目引用。
	if h.c.scopeID == "" {
		return
	}
	h.c.upsertComponentAssetRef(id, versionID)
}

// projectComponentAsset 把 MG 组件投影进统一 media_assets（kind=component），
// 元数据（版本/surface/inputs/coverUrl/brief）统一在素材里；组件源码仍归 mg_materials。
func (h mgHost) projectComponentAsset(id, versionID string) {
	db, err := h.DB()
	if err != nil {
		return
	}
	material, ok := motion_graphic.Read(db, id)
	if !ok {
		return
	}
	mediaService := h.c.host.media
	if mediaService == nil {
		return
	}
	inputs := any([]any{})
	if parsed := decodeEditorJSON(material.InputsJSON); parsed != nil {
		inputs = parsed
	}
	coverURL := ""
	if material.CoverRef != "" {
		coverURL = platformFileURL(material.CoverRef)
	}
	_, _ = mediaService.UpsertComponentAsset(media.ComponentAssetImport{
		ID:          motion_graphic.AssetID(id),
		Name:        material.Name,
		MimeType:    "application/vnd.recut.component+json",
		Origin:      "motion-graphic",
		ComponentID: id,
		VersionID:   versionID,
		Version:     material.CodeVersion,
		Surface:     material.Surface,
		Mode:        material.Mode,
		Status:      material.Status,
		CoverURL:    coverURL,
		Inputs:      inputs,
		Brief:       material.Name,
		ProjectID:   h.c.scopeID,
	})
}

// decodeEditorJSON 解析一段 JSON 文本为通用值；空串或非法 JSON 返回 nil。
func decodeEditorJSON(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	var decoded any
	if err := json.Unmarshal([]byte(value), &decoded); err != nil {
		return nil
	}
	return decoded
}

func (h mgHost) WriteBase64(rel, b64 string) error {
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		return err
	}
	root, err := h.c.host.store.PlatformFilesRoot()
	if err != nil {
		return err
	}
	path, err := editorSafeFile(root, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (h mgHost) FilesURL(rel string) string {
	return platformFileURL(rel)
}

// upsertComponentAssetRef 在项目引用索引里登记/刷新一条 MG 素材引用。
func (c *editorContext) upsertComponentAssetRef(id, versionID string) {
	c.ensureSchema()
	_, _ = c.db.Exec("insert into editor_assets (asset_id, project_id, type, ref_id, ref_version_id, status, created_at, updated_at) values (?, ?, 'component', ?, ?, 'active', ?, ?) "+
		"on conflict(asset_id) do update set ref_version_id = excluded.ref_version_id, status = 'active', updated_at = excluded.updated_at",
		motion_graphic.AssetID(id), c.scopeID, id, versionID, nowIso(), nowIso())
}

// motionGraphicContext 构造 motion_graphic 操作所需的宿主上下文：素材真相在平台全局
// （workspace DB + 平台文件根），这里只借用编辑器平台模块的项目/引用/事件命名空间；
// 没有项目目标时退化为纯全局创作，不登记任何项目引用。
func (h *AppHost) motionGraphicContext(target Target, locale Locale) (*editorContext, error) {
	return newEditorContext(h, target, App{Manifest: Manifest{ID: editorSystemAppID}}, locale)
}

// motionGraphicExec 执行一个 motion_graphic operation（平台分发路径，App 无关）：
// 注入项目派生的画布/合成上下文，并把 motion_graphic.Error 翻译为平台错误信封。
func (h *AppHost) motionGraphicExec(target Target, op string, input map[string]any, locale Locale) (any, error) {
	c, err := h.motionGraphicContext(target, locale)
	if err != nil {
		return nil, err
	}
	migrateEditorComponents(c)
	migrateLegacyMotionGraphicFiles(c)
	migrateMotionGraphicAssets(c)
	if op == motion_graphic.OpCreate || op == motion_graphic.OpRevise {
		if _, ok := input["canvas"]; !ok {
			input["canvas"] = editorCanvasContext(c)
		}
		if _, ok := input["composition"]; !ok {
			input["composition"] = editorCompositingContext(c)
		}
	}
	handler := motion_graphic.Handlers(mgHost{c: c})[op]
	if handler == nil {
		return nil, editorError("unknown motion graphic operation: " + op)
	}
	result, err := handler(input)
	return result, mgTranslateError(err)
}

func mgTranslateError(err error) error {
	if err == nil {
		return nil
	}
	var mgErr *motion_graphic.Error
	if errors.As(err, &mgErr) {
		return &mcpError{Kind: mgErr.Kind, Code: mgErr.Code, Message: mgErr.Message, Hint: mgErr.Hint, Retryable: mgErr.Retryable, Data: mgErr.Data}
	}
	return err
}

// editorCanvasContext / editorCompositingContext 从项目文档推导创建 prompt 需要的上下文。
func editorCanvasContext(c *editorContext) map[string]any {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return nil
	}
	settings := edMap(existing.Project["settings"])
	if settings == nil {
		return nil
	}
	return edMap(settings["canvasSize"])
}

func editorCompositingContext(c *editorContext) map[string]any {
	existing := c.readProject()
	if existing == nil || existing.Project == nil {
		return map[string]any{"overMedia": false}
	}
	project := existing.Project
	scenes := edSlice(project["scenes"])
	if len(scenes) == 0 {
		return map[string]any{"overMedia": false}
	}
	scene := edMap(scenes[0])
	if current := edStr(project["currentSceneId"]); current != "" {
		for _, sceneValue := range scenes {
			candidate := edMap(sceneValue)
			if edStr(candidate["id"]) == current {
				scene = candidate
				break
			}
		}
	}
	tracks := edMap(scene["tracks"])
	if tracks == nil {
		return map[string]any{"overMedia": false}
	}
	list := []any{}
	if main := edMap(tracks["main"]); main != nil {
		list = append(list, main)
	}
	list = append(list, edSlice(tracks["overlay"])...)
	list = append(list, edSlice(tracks["audio"])...)
	for _, trackValue := range list {
		for _, elValue := range edSlice(edMap(trackValue)["elements"]) {
			elementType := edStr(edMap(elValue)["type"])
			if elementType == "video" || elementType == "image" {
				return map[string]any{"overMedia": true}
			}
		}
	}
	return map[string]any{"overMedia": false}
}

// ---- 迁移：editor 私有组件表 → 全局 mg_materials ----------------------------

const mgMigrationPrefKey = "mg_materials_migrated_v1"

func migrateEditorComponents(c *editorContext) {
	if c == nil || c.host == nil || c.host.store == nil {
		return
	}
	db, err := c.host.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	if preferenceSet(db, mgMigrationPrefKey) {
		return
	}
	c.ensureSchema()
	rows, err := queryMaps(c.db, "select c.component_id, c.name, c.surface, c.keywords_json, c.mode, c.archived_at, c.created_at, "+
		"v.source, v.bundle, v.bundle_hash, v.inputs_json, v.status, v.test_report_json, v.cover_path, v.version "+
		"from editor_components c left join editor_component_versions v on v.version_id = c.head_version_id")
	if err == nil {
		for _, row := range rows {
			id := edStr(row["component_id"])
			if id == "" {
				continue
			}
			if _, exists := motion_graphic.Read(db, id); !exists {
				_ = motion_graphic.InsertDraft(db, motion_graphic.Material{
					ID:             id,
					Name:           nonEmpty(edStr(row["name"]), id),
					Surface:        nonEmpty(edStr(row["surface"]), "r3f"),
					KeywordsJSON:   nonEmpty(edStr(row["keywords_json"]), "[]"),
					Mode:           nonEmpty(edStr(row["mode"]), "local"),
					Source:         edStr(row["source"]),
					Bundle:         edStr(row["bundle"]),
					BundleHash:     edStr(row["bundle_hash"]),
					InputsJSON:     nonEmpty(edStr(row["inputs_json"]), "[]"),
					Status:         nonEmpty(edStr(row["status"]), "draft"),
					CodeVersion:    int64(edNum(row["version"])),
					TestReportJSON: edStr(row["test_report_json"]),
					CoverRef:       edStr(row["cover_path"]),
					OriginAppID:    "recut.editor",
					ArchivedAt:     edStr(row["archived_at"]),
					CreatedAt:      nonEmpty(edStr(row["created_at"]), nowIso()),
				})
			}
			links, linkErr := queryMaps(c.db, "select project_id from editor_components where component_id = ?", id)
			if linkErr == nil {
				for _, link := range links {
					if projectID := edStr(link["project_id"]); projectID != "" {
						c.db.Exec("insert or ignore into editor_assets (asset_id, project_id, type, ref_id, ref_version_id, status, created_at, updated_at) values (?, ?, 'component', ?, null, 'active', ?, ?)",
							motion_graphic.AssetID(id), projectID, id, nowIso(), nowIso())
					}
				}
			}
		}
	}
	setPreference(db, mgMigrationPrefKey, "1")
}

// mgFilesMigrationPrefKey 标记「MG 文件已从 editor appstate 迁到平台全局文件根」。
const mgFilesMigrationPrefKey = "mg_files_migrated_v1"

// motionGraphicLegacyAppID 是 MG 文件迁移前借用过的 App 命名空间（只用于读取旧文件）。
const motionGraphicLegacyAppID = "recut.editor"

// migrateLegacyMotionGraphicFiles 把早期落在 `appstate/recut.editor/files` 下的 MG
// bundle/封面复制到平台全局文件根。MG 现在读平台根（`platformFileURL`），旧 roll 的
// `cover_ref` 若仍指向 appstate 会 404；这里按 `cover_ref` 一次性搬移，幂等且不删除旧文件。
func migrateLegacyMotionGraphicFiles(c *editorContext) {
	if c == nil || c.host == nil || c.host.store == nil {
		return
	}
	db, err := c.host.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	if preferenceSet(db, mgFilesMigrationPrefKey) {
		return
	}
	platformRoot, err := c.host.store.PlatformFilesRoot()
	if err != nil {
		return
	}
	legacyRoot, legacyErr := c.host.store.AppStateFilesRoot(motionGraphicLegacyAppID)
	if legacyErr == nil {
		for _, material := range motion_graphic.ListAll(db) {
			rel := material.CoverRef
			if rel == "" {
				continue
			}
			target, targetErr := editorSafeFile(platformRoot, rel)
			if targetErr != nil {
				continue
			}
			if _, statErr := os.Stat(target); statErr == nil {
				continue
			}
			source, sourceErr := editorSafeFile(legacyRoot, rel)
			if sourceErr != nil {
				continue
			}
			data, readErr := os.ReadFile(source)
			if readErr != nil {
				continue
			}
			if mkErr := os.MkdirAll(filepath.Dir(target), 0o755); mkErr != nil {
				continue
			}
			_ = os.WriteFile(target, data, 0o644)
		}
	}
	setPreference(db, mgFilesMigrationPrefKey, "1")
}

// mgAssetProjectionPrefKey 标记「既有 MG 组件已回填为统一组件素材」。
const mgAssetProjectionPrefKey = "mg_assets_projected_v1"

// migrateMotionGraphicAssets 把库里既有的 MG 组件一次性回填成统一素材（kind=component），
// 让历史组件也出现在素材库；幂等，只回填尚未投影的组件。
func migrateMotionGraphicAssets(c *editorContext) {
	if c == nil || c.host == nil || c.host.store == nil || c.host.media == nil {
		return
	}
	db, err := c.host.store.WorkspaceDatabase()
	if err != nil {
		return
	}
	if preferenceSet(db, mgAssetProjectionPrefKey) {
		return
	}
	host := mgHost{c: c}
	for _, material := range motion_graphic.ListAll(db) {
		host.projectComponentAsset(material.ID, material.VersionID())
	}
	setPreference(db, mgAssetProjectionPrefKey, "1")
}
