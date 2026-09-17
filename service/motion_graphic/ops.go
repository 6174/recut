/*
 * [INPUT]: 依赖 Host（平台 DB/文件/事件）、构建层与提示词层。
 * [OUTPUT]: Motion Graphic 的全套 operation：create/revise/define/verify/list/source/update/archive/resolve，
 *           以及受限子 Agent 的 author/finalize 编排；构建成功才覆盖 current code。
 * [POS]: motion_graphic 包的领域操作层；无项目概念，宿主只做参数透传与错误翻译。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// 各 operation 名（AI 层统一 motion-graphic）。
const (
	OpCreate  = "motion-graphic.create"
	OpRevise  = "motion-graphic.revise"
	OpDefine  = "motion-graphic.define"
	OpVerify  = "motion-graphic.verify"
	OpList    = "motion-graphic.list"
	OpSource  = "motion-graphic.source"
	OpUpdate  = "motion-graphic.update"
	OpArchive = "motion-graphic.archive"
	OpResolve = "motion-graphic.resolve"
)

// Handlers 返回各 operation 的绑定实现（宿主注册用）。
func Handlers(h Host) map[string]func(map[string]any) (any, error) {
	s := &service{h: h}
	return map[string]func(map[string]any) (any, error){
		OpCreate:  s.create,
		OpRevise:  s.revise,
		OpDefine:  s.defineOp,
		OpVerify:  s.verify,
		OpList:    s.list,
		OpSource:  s.source,
		OpUpdate:  s.update,
		OpArchive: s.archive,
		OpResolve: s.resolve,
	}
}

// AssetID 是 MG 素材在消费方引用索引里的稳定 assetId。
func AssetID(id string) string { return "component:" + id }

// IDFromVersion 从 <id>@<codeVersion> 取回 material id。
func IDFromVersion(versionID string) string {
	if idx := strings.LastIndex(versionID, "@"); idx > 0 {
		return versionID[:idx]
	}
	return versionID
}

type service struct{ h Host }

func newMaterialID() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "ai-material"
	}
	return "ai-" + hex.EncodeToString(b)
}

func (s *service) db() (*sql.DB, error) { return s.h.DB() }

func (s *service) defineOp(input map[string]any) (any, error) {
	material, built, err := s.define(input, false)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"componentId": material.ID, "versionId": material.VersionID(), "version": material.CodeVersion, "status": material.Status}
	if material.Status == "failed" {
		out["buildError"] = built.Error
	}
	return out, nil
}

func (s *service) define(input map[string]any, forceVerified bool) (Material, Result, error) {
	source := str(input["source"])
	if strings.TrimSpace(source) == "" {
		return Material{}, Result{}, businessError("motion-graphic.define: source is required")
	}
	surface := fallback(str(input["surface"]), "r3f")
	if surface != "html" && surface != "react" && surface != "r3f" {
		return Material{}, Result{}, businessError("motion-graphic.define: invalid surface: " + surface)
	}
	id := str(input["componentId"])
	if id == "" {
		id = newMaterialID()
	}
	name := fallback(str(input["name"]), "AI Motion Graphic")
	keywords := asSlice(input["keywords"])
	if keywords == nil {
		keywords = []any{}
	}
	inputs := asSlice(input["inputs"])
	if inputs == nil {
		inputs = []any{}
	}
	mode := "local"
	if str(input["mode"]) == "fullscreen" {
		mode = "fullscreen"
	}
	db, err := s.db()
	if err != nil {
		return Material{}, Result{}, err
	}
	existing, exists := Read(db, id)
	if base := str(input["baseVersionId"]); base != "" && (!exists || existing.VersionID() != base) {
		return Material{}, Result{}, businessError("motion-graphic.define: stale baseVersionId; motion graphic changed while authoring")
	}
	version := int64(1)
	if exists {
		version = existing.CodeVersion + 1
	}
	versionID := VersionID(id, version)
	built := Build(s.h.AppRoot(), s.h.FilesRoot(), versionID, source)
	keywordsJSON, _ := json.Marshal(keywords)
	inputsJSON, _ := json.Marshal(inputs)
	material := Material{
		ID: id, Name: name, Surface: surface, KeywordsJSON: string(keywordsJSON), Mode: mode,
		Source: source, Bundle: built.Bundle, BundleHash: built.BundleHash, InputsJSON: string(inputsJSON),
		Status: "draft", CodeVersion: version, OriginAppID: str(input["originAppId"]), CreatedAt: nowISO(),
	}
	if !built.OK {
		errorJSON, _ := json.Marshal(built.Error)
		material.Status = "failed"
		material.LastErrorJSON = string(errorJSON)
		_ = RecordError(db, material)
		return material, built, nil
	}
	if forceVerified {
		material.Status = "verified"
	}
	if err := InsertDraft(db, material); err != nil {
		return Material{}, built, err
	}
	if forceVerified {
		report := map[string]any{"ok": true, "checks": []any{map[string]any{"name": "component-build", "pass": true}}, "mode": "main-agent-update", "evidence": map[string]any{"level": "build-passed", "by": "motion-graphic.update"}}
		reportJSON, _ := json.Marshal(report)
		_ = SetVerified(db, id, string(reportJSON), existing.CoverRef)
		s.h.OnVerified(id, versionID)
	}
	s.emitChanged(id, versionID, material.Status)
	return material, built, nil
}

func (s *service) verify(input map[string]any) (any, error) {
	versionID := str(input["versionId"])
	if versionID == "" {
		return nil, businessError("motion-graphic.verify: versionId is required")
	}
	id := IDFromVersion(versionID)
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	material, ok := Read(db, id)
	if !ok {
		return nil, businessError("motion-graphic.verify: version not found " + versionID)
	}
	if report := asMap(input["report"]); report != nil {
		return s.applyVerify(id, versionID, report), nil
	}
	return map[string]any{"assetId": AssetID(id), "versionId": material.VersionID(), "componentId": id, "status": material.Status, "report": decodeAny(material.TestReportJSON)}, nil
}

func (s *service) list(input map[string]any) (any, error) {
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	var materials []Material
	if ids := asSlice(input["ids"]); len(ids) > 0 {
		stringsIDs := make([]string, 0, len(ids))
		for _, id := range ids {
			stringsIDs = append(stringsIDs, str(id))
		}
		materials = ListByIDs(db, stringsIDs)
	} else {
		materials = ListAll(db)
	}
	out := make([]any, 0, len(materials))
	for _, m := range materials {
		out = append(out, s.materialView(m))
	}
	return map[string]any{"components": out}, nil
}

func (s *service) materialView(m Material) map[string]any {
	return map[string]any{
		"assetId":         AssetID(m.ID),
		"componentId":     m.ID,
		"latestVersionId": m.VersionID(),
		"versionId":       m.VersionID(),
		"name":            m.Name,
		"surface":         m.Surface,
		"mode":            fallback(m.Mode, "local"),
		"keywords":        m.Keywords(),
		"version":         m.CodeVersion,
		"status":          m.Status,
		"inputs":          m.Inputs(),
		"testReport":      decodeAny(m.TestReportJSON),
		"coverUrl":        s.coverURL(m.CoverRef),
	}
}

func (s *service) source(input map[string]any) (any, error) {
	id := str(input["componentId"])
	if id == "" {
		return nil, businessError("motion-graphic.source: componentId is required")
	}
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	material, ok := Read(db, id)
	if !ok {
		return nil, businessError("motion-graphic.source: no version for " + id)
	}
	return map[string]any{"componentId": id, "versionId": material.VersionID(), "version": material.CodeVersion, "source": material.Source}, nil
}

func (s *service) update(input map[string]any) (any, error) {
	id := str(input["componentId"])
	if id == "" {
		return nil, businessError("motion-graphic.update: componentId required")
	}
	if strings.TrimSpace(str(input["source"])) == "" {
		return nil, businessError("motion-graphic.update: source required")
	}
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	existing, ok := Read(db, id)
	if !ok || existing.Status != "verified" {
		return nil, businessErrorWithCode("no-verified-head", "motion-graphic.update: motion graphic has no verified record to update",
			"该 Motion Graphic 当前没有 verified 记录（可能是 draft/failed/archive）。update/revise 只能基于 verified 记录修改；请重新 create 生成新的 verified 素材，或先 list 确认状态。")
	}
	material, built, err := s.define(map[string]any{
		"componentId":   id,
		"baseVersionId": existing.VersionID(),
		"source":        input["source"],
		"surface":       existing.Surface,
		"name":          existing.Name,
		"keywords":      existing.Keywords(),
		"inputs":        existing.Inputs(),
		"mode":          existing.Mode,
	}, true)
	if err != nil {
		return nil, err
	}
	if material.Status != "verified" {
		return map[string]any{"ok": false, "versionId": material.VersionID(), "status": "failed", "buildError": built.Error}, nil
	}
	return map[string]any{
		"ok": true, "assetId": AssetID(id), "componentId": id,
		"versionId": material.VersionID(), "version": material.CodeVersion, "status": "verified",
		"evidence": map[string]any{"level": "build-passed", "by": "motion-graphic.update"}, "requiresVisualCheck": true,
	}, nil
}

func (s *service) archive(input map[string]any) (any, error) {
	id := str(input["componentId"])
	if id == "" {
		return nil, businessError("motion-graphic.archive: componentId is required")
	}
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	if _, ok := Read(db, id); !ok {
		return nil, businessError("motion-graphic.archive: motion graphic not found")
	}
	_ = Archive(db, id)
	s.emitChanged(id, "", "archived")
	return map[string]any{"ok": true, "componentId": id, "status": "archived"}, nil
}

func (s *service) resolve(input map[string]any) (any, error) {
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	out := []any{}
	if versionID := str(input["versionId"]); versionID != "" {
		if material, ok := Read(db, IDFromVersion(versionID)); ok {
			out = append(out, s.resolveView(material))
		}
	} else {
		for _, idValue := range asSlice(input["ids"]) {
			if material, ok := Read(db, str(idValue)); ok {
				out = append(out, s.resolveView(material))
			}
		}
	}
	return map[string]any{"components": out}, nil
}

func (s *service) resolveView(m Material) map[string]any {
	return map[string]any{
		"componentId": m.ID,
		"versionId":   m.VersionID(),
		"name":        m.Name,
		"surface":     fallback(m.Surface, "r3f"),
		"mode":        fallback(m.Mode, "local"),
		"status":      m.Status,
		"inputs":      m.Inputs(),
		"bundle":      m.Bundle,
		"bundleHash":  m.BundleHash,
		"coverUrl":    s.coverURL(m.CoverRef),
	}
}

// ---- 受限子 Agent -----------------------------------------------------------

var authorAllowedTools = []any{"recut.editor.motion-graphic.commit"}

func (s *service) create(input map[string]any) (any, error) {
	if tools, ok := input["subAgentTools"].([]any); ok {
		return s.finalize(tools, asSlice(input["items"]), "create")
	}
	items := asSlice(input["items"])
	if len(items) == 0 {
		return nil, businessError("motion-graphic.create: items required")
	}
	canvas := asMap(input["canvas"])
	composition := asMap(input["composition"])
	prompt := CreatePrompt(items, canvas, composition)
	mode := "local"
	if first := asMap(items[0]); first != nil && str(first["mode"]) == "fullscreen" {
		mode = "fullscreen"
	}
	timeout := len(items) * 150
	if timeout < 300 {
		timeout = 300
	}
	if timeout > 1800 {
		timeout = 1800
	}
	return map[string]any{"subAgent": map[string]any{
		"allowedTools":   authorAllowedTools,
		"prompt":         prompt,
		"canvas":         canvas,
		"timeoutSeconds": timeout,
		"focused":        map[string]any{"mode": mode},
		"items":          items,
	}}, nil
}

func (s *service) revise(input map[string]any) (any, error) {
	if tools, ok := input["subAgentTools"].([]any); ok {
		return s.finalize(tools, nil, "revise")
	}
	id := str(input["componentId"])
	instruction := str(input["instruction"])
	if id == "" || instruction == "" {
		return nil, businessError("motion-graphic.revise: componentId and instruction required")
	}
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	material, ok := Read(db, id)
	if !ok {
		return nil, businessError("motion-graphic.revise: motion graphic not found")
	}
	if material.Status != "verified" {
		return nil, businessError("motion-graphic.revise: motion graphic has no verified record to revise")
	}
	return map[string]any{"subAgent": map[string]any{
		"allowedTools": authorAllowedTools,
		"prompt":       RevisePrompt(instruction, material.Source),
		"focused":      map[string]any{"componentId": id, "baseVersionId": material.VersionID(), "mode": fallback(material.Mode, "local")},
	}}, nil
}

func (s *service) finalize(tools []any, items []any, mode string) (any, error) {
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	views := []any{}
	hasItems := len(items) > 0
	itemIndex := 0
	for _, toolValue := range tools {
		tool := asMap(toolValue)
		if tool == nil || str(tool["name"]) != "recut.editor.motion-graphic.commit" {
			continue
		}
		committed := asMap(tool["result"])
		versionID := str(committed["versionId"])
		if versionID == "" {
			return nil, businessError("motion graphic commit returned no versionId")
		}
		id := IDFromVersion(versionID)
		material, ok := Read(db, id)
		if !ok {
			return nil, businessError("motion graphic commit version not found: " + versionID)
		}
		if hasItems {
			item := asMap(items[itemIndex])
			itemMode := "local"
			if item != nil && str(item["mode"]) == "fullscreen" {
				itemMode = "fullscreen"
			}
			itemIndex++
			_ = SetMode(db, id, itemMode)
			material.Mode = itemMode
		}
		report := map[string]any{"ok": true, "checks": []any{map[string]any{"name": "component-build", "pass": true}}, "frames": []any{}, "mode": "headless-code"}
		_ = s.applyVerify(id, versionID, report)
		views = append(views, map[string]any{
			"assetId":     AssetID(id),
			"componentId": id,
			"versionId":   versionID,
			"status":      "verified",
			"mode":        fallback(material.Mode, "local"),
		})
	}
	if len(views) == 0 {
		return nil, businessError("motion graphic author finished without a commit")
	}
	assetIDs := make([]any, 0, len(views))
	for _, view := range views {
		assetIDs = append(assetIDs, asMap(view)["assetId"])
	}
	result := map[string]any{"components": views, "assetIds": assetIDs, "library": map[string]any{"tab": "media", "verification": "code-verified"}}
	if mode == "revise" {
		result["component"] = views[0]
	}
	return result, nil
}

func (s *service) applyVerify(id, versionID string, report map[string]any) any {
	status := "failed"
	if report != nil && report["ok"] == true {
		status = "verified"
	}
	coverRef := ""
	if status == "verified" {
		if cover := asMap(report["cover"]); cover != nil {
			if b64 := str(cover["fileBase64"]); b64 != "" {
				rel := "motion-graphics/covers/" + safeSegment(versionID) + ".png"
				if err := s.h.WriteBase64(rel, b64); err == nil {
					coverRef = rel
					report["cover"] = map[string]any{"path": rel, "mimeType": fallback(str(cover["mimeType"]), "image/png"), "width": number(cover["width"]), "height": number(cover["height"])}
				}
			}
		}
	}
	if db, err := s.db(); err == nil && status == "verified" {
		reportJSON, _ := json.Marshal(report)
		_ = SetVerified(db, id, string(reportJSON), coverRef)
		s.h.OnVerified(id, versionID)
	}
	s.emitChanged(id, versionID, status)
	return map[string]any{"assetId": AssetID(id), "versionId": versionID, "componentId": id, "status": status, "report": report}
}

func (s *service) coverURL(coverRef string) any {
	if coverRef == "" {
		return nil
	}
	return s.h.FilesURL(coverRef)
}

func (s *service) emitChanged(id, versionID, status string) {
	payload := map[string]any{"componentId": id, "versionId": versionID, "status": status}
	if status == "verified" {
		payload["library"] = map[string]any{"tab": "media"}
	}
	s.h.Emit("project.components.changed", payload)
}

func decodeAny(text string) any {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	var value any
	if json.Unmarshal([]byte(text), &value) != nil {
		return nil
	}
	return value
}
