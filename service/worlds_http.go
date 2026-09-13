/*
 * [INPUT]: 依赖 Store、WorldStore、MediaService 与标准库 net/http JSON 编码
 * [OUTPUT]: 对外提供 RESTful /v1/worlds 资源路由：World/Entity 分页读取、创建/修改/Reference/Resolve、
 * readiness 就绪度投影（Onboarding RFC）与项目 World Context 的读与写；结构化 WorldsError 信封与 HTTP 状态映射；处理器只解码/校验/调用 store，不含 Canonical 逻辑
 * [POS]: service 的 Creation Worlds HTTP 传输层；路由拼写是 RESTful（/v1/worlds），SDK 与 MCP 用 recut.worlds.*
 * 命名能力；系统 Worlds UI 与 App 背景都经本 facade，绝不直接访问 world_* 表
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

func (s *Server) worldsStore() *WorldStore {
	if s.worlds == nil {
		return NewWorldStore(s.store, s.media)
	}
	return s.worlds
}

func (s *Server) listWorlds(w http.ResponseWriter, r *http.Request) {
	// UI opened the worlds page: opportunistically refresh the platform
	// catalog in the background (throttled + single-flight) so newly
	// published entries appear without waiting for the 24h ticker.
	if s.worldCatalog != nil {
		s.worldCatalog.Touch()
	}
	input := ListWorldsInput{Text: r.URL.Query().Get("text"), Type: WorldKind(r.URL.Query().Get("type")), Cursor: r.URL.Query().Get("cursor")}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		input.Limit, _ = strconv.Atoi(raw)
	}
	items, nextCursor, err := s.worldsStore().ListWorlds(input)
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "nextCursor": optionalCursor(nextCursor)})
}

func (s *Server) createWorld(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name         string         `json:"name"`
		Type         WorldKind      `json:"type"`
		Description  string         `json:"description"`
		Identity     map[string]any `json:"identity"`
		CoverAssetID string         `json:"coverAssetId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	world, err := s.worldsStore().CreateWorld(CreateWorldInput{
		Name: input.Name, Type: input.Type, Description: input.Description,
		Identity: input.Identity, CoverAssetID: input.CoverAssetID,
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, world)
}

func (s *Server) getWorld(w http.ResponseWriter, r *http.Request) {
	world, err := s.worldsStore().GetWorld(r.PathValue("worldID"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, world)
}

func (s *Server) updateWorld(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name               *string        `json:"name"`
		Description        *string        `json:"description"`
		Identity           map[string]any `json:"identity"`
		SkillMd            *string        `json:"skillMd"`
		ExpectedRevisionID string         `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	world, err := s.worldsStore().UpdateWorld(UpdateWorldInput{
		WorldID: r.PathValue("worldID"), Name: input.Name, Description: input.Description,
		Identity: input.Identity, SkillMd: input.SkillMd, ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, world)
}

func (s *Server) forkWorld(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil && err.Error() != "EOF" {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	world, err := s.worldsStore().ForkWorld(ForkWorldInput{WorldID: r.PathValue("worldID"), Name: input.Name})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, world)
}

func (s *Server) archiveWorld(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil && err.Error() != "EOF" {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	changed, err := s.worldsStore().ArchiveWorldForUser(r.PathValue("worldID"), "http")
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"archived": true, "changed": changed})
}

func (s *Server) briefWorld(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RevisionID string         `json:"revisionId"`
		Selection  WorldSelection `json:"selection"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil && err.Error() != "EOF" {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	brief, err := s.worldsStore().Brief(BriefInput{WorldID: r.PathValue("worldID"), RevisionID: input.RevisionID, Selection: input.Selection})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, brief)
}

func (s *Server) getWorldReadiness(w http.ResponseWriter, r *http.Request) {
	readiness, err := s.worldsStore().Readiness(r.PathValue("worldID"), r.URL.Query().Get("scenario"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, readiness)
}

func (s *Server) getWorldsCatalog(w http.ResponseWriter, r *http.Request) {
	syncer := s.worldCatalog
	if syncer == nil {
		// No daemon-owned syncer (tests / App-side servers): resolve on demand.
		syncer = NewWorldCatalogSyncer(s.store.root, s.worldsStore())
	} else {
		// Same double-guarantee as listWorlds: keep the cached catalog fresh
		// whenever a client reads it, without blocking the response.
		syncer.Touch()
	}
	catalog := syncer.CachedCatalog()
	if catalog == nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "world catalog is not available yet"))
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (s *Server) listWorldEntities(w http.ResponseWriter, r *http.Request) {
	input := ListEntitiesInput{
		WorldID: r.PathValue("worldID"), TypeID: r.URL.Query().Get("typeId"),
		Text: r.URL.Query().Get("text"), Cursor: r.URL.Query().Get("cursor"),
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		input.Limit, _ = strconv.Atoi(raw)
	}
	input.IncludeProvisional = r.URL.Query().Get("includeProvisional") == "true"
	items, nextCursor, err := s.worldsStore().ListEntities(input)
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "nextCursor": optionalCursor(nextCursor)})
}

func (s *Server) createWorldEntity(w http.ResponseWriter, r *http.Request) {
	var input UpsertEntityInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	input.WorldID = r.PathValue("worldID")
	input.CreatedBy = "http"
	entity, err := s.worldsStore().UpsertEntity(input)
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, entity)
}

func (s *Server) getWorldEntity(w http.ResponseWriter, r *http.Request) {
	entity, err := s.worldsStore().GetEntity(r.PathValue("worldID"), r.PathValue("entityID"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, entity)
}

func (s *Server) updateWorldEntity(w http.ResponseWriter, r *http.Request) {
	var input UpsertEntityInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	input.WorldID = r.PathValue("worldID")
	input.EntityID = r.PathValue("entityID")
	input.CreatedBy = "http"
	entity, err := s.worldsStore().UpsertEntity(input)
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, entity)
}

func (s *Server) attachWorldReference(w http.ResponseWriter, r *http.Request) {
	s.attachWorldEvidence(w, r)
}

func (s *Server) listWorldEvidence(w http.ResponseWriter, r *http.Request) {
	evidence, err := s.worldsStore().ListEvidence(r.PathValue("worldID"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": evidence})
}

func (s *Server) attachWorldEvidence(w http.ResponseWriter, r *http.Request) {
	var input struct {
		EntityID           string                `json:"entityId"`
		AssetID            string                `json:"assetId"`
		URL                string                `json:"url"`
		Role               string                `json:"role"`
		Label              string                `json:"label"`
		Purpose            string                `json:"purpose"`
		Status             string                `json:"status"`
		Collection         string                `json:"collection"`
		Modality           string                `json:"modality"`
		Segment            *WorldEvidenceSegment `json:"segment"`
		ExpectedRevisionID string                `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	reference, err := s.worldsStore().AttachReference(AttachReferenceInput{
		WorldID: r.PathValue("worldID"), EntityID: input.EntityID, AssetID: input.AssetID, URL: input.URL,
		Role: input.Role, Label: input.Label, Purpose: input.Purpose, Status: input.Status,
		Collection: input.Collection, Modality: input.Modality, Segment: input.Segment,
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, reference)
}

func (s *Server) archiveWorldEvidence(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	if err := s.worldsStore().ArchiveEvidence(ArchiveEvidenceInput{WorldID: r.PathValue("worldID"), EvidenceID: r.PathValue("evidenceID"), ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http"}); err != nil {
		writeWorldsError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) updateWorldEvidence(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Purpose            string `json:"purpose"`
		Status             string `json:"status"`
		Label              string `json:"label"`
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	evidence, err := s.worldsStore().UpdateEvidence(UpdateEvidenceInput{
		WorldID: r.PathValue("worldID"), EvidenceID: r.PathValue("evidenceID"),
		Purpose: input.Purpose, Status: input.Status, Label: input.Label,
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, evidence)
}

func (s *Server) resolveWorld(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RevisionID string         `json:"revisionId"`
		Selection  WorldSelection `json:"selection"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	context, err := s.worldsStore().Resolve(ResolveInput{WorldID: r.PathValue("worldID"), RevisionID: input.RevisionID, Selection: input.Selection})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, context)
}

func (s *Server) getProjectWorldContext(w http.ResponseWriter, r *http.Request) {
	context, err := s.worldsStore().GetProjectContext(r.PathValue("projectID"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	if context == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, context)
}

func (s *Server) putProjectWorldContext(w http.ResponseWriter, r *http.Request) {
	var input struct {
		WorldID    string         `json:"worldId"`
		RevisionID string         `json:"revisionId"`
		Selection  WorldSelection `json:"selection"`
		Replace    bool           `json:"replace"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	binding, err := s.worldsStore().BindProject(BindProjectInput{
		ProjectID: r.PathValue("projectID"), WorldID: input.WorldID, RevisionID: input.RevisionID,
		Selection: input.Selection, Replace: input.Replace, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, binding)
}

func (s *Server) listWorldRelations(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("worldID")
	entityID := r.URL.Query().Get("entityId")
	if entityID != "" {
		items, err := s.worldsStore().ListRelations(worldID, entityID)
		if err != nil {
			writeWorldsError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}
	writeWorldsError(w, worldsError(WorldsErrContextInvalid, "entityId query is required"))
}

func (s *Server) createWorldRelation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		FromEntityID       string         `json:"fromEntityId"`
		ToEntityID         string         `json:"toEntityId"`
		RelationType       string         `json:"relationType"`
		ScopeEntityID      string         `json:"scopeEntityId"`
		Metadata           map[string]any `json:"metadata"`
		ExpectedRevisionID string         `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	relation, err := s.worldsStore().CreateRelation(CreateRelationInput{
		WorldID: r.PathValue("worldID"), FromEntityID: input.FromEntityID, ToEntityID: input.ToEntityID,
		RelationType: input.RelationType, ScopeEntityID: input.ScopeEntityID, Metadata: input.Metadata,
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, relation)
}

func (s *Server) updateWorldRelation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		FromEntityID       string `json:"fromEntityId"`
		ToEntityID         string `json:"toEntityId"`
		RelationType       string `json:"relationType"`
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	relation, err := s.worldsStore().UpdateRelation(UpdateRelationInput{
		WorldID: r.PathValue("worldID"), RelationID: r.PathValue("relationID"),
		FromEntityID: input.FromEntityID, ToEntityID: input.ToEntityID, RelationType: input.RelationType,
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, relation)
}

func (s *Server) deleteWorldRelation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	if err := s.worldsStore().DeleteRelation(r.PathValue("worldID"), r.PathValue("relationID"), input.ExpectedRevisionID, "http"); err != nil {
		writeWorldsError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getWorldEntityTypes(w http.ResponseWriter, r *http.Request) {
	items, err := s.worldsStore().ListEntityTypes(r.PathValue("worldID"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "relations": ListWorldRelationTypes()})
}

func (s *Server) upsertWorldEntityType(w http.ResponseWriter, r *http.Request) {
	var input struct {
		TypeID   string              `json:"id"`
		Name     string              `json:"name"`
		Icon     string              `json:"icon"`
		Color    string              `json:"color"`
		BaseKind string              `json:"baseKind"`
		Fields   []EntityTypeField   `json:"fields"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	item, err := s.worldsStore().UpsertEntityType(UpsertEntityTypeInput{
		WorldID: r.PathValue("worldID"), TypeID: input.TypeID, Name: input.Name, Icon: input.Icon,
		Color: input.Color, BaseKind: input.BaseKind, Fields: input.Fields, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// getCanvasDocument serves canvas.get: one whole document (root when no
// contextId), lazily migrating legacy element rows on first touch.
func (s *Server) getCanvasDocument(w http.ResponseWriter, r *http.Request) {
	doc, err := s.worldsStore().GetCanvasDocument(r.PathValue("worldID"), r.URL.Query().Get("contextId"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

// saveCanvasDocument serves canvas.save: whole-document write with optimistic
// version check (CANVAS_VERSION_CONFLICT on stale reads).
func (s *Server) saveCanvasDocument(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ContextID       string               `json:"contextId"`
		Elements        []WorldCanvasElement `json:"elements"`
		ExpectedVersion int                  `json:"version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	doc, err := s.worldsStore().SaveCanvasDocument(r.PathValue("worldID"), input.ContextID, input.Elements, input.ExpectedVersion)
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

// listCanvasDocuments serves canvas.docs: the world's document index.
func (s *Server) listCanvasDocuments(w http.ResponseWriter, r *http.Request) {
	items, err := s.worldsStore().ListCanvasDocuments(r.PathValue("worldID"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// updateCanvasDocumentOps serves canvas.doc.update: element-level ops applied
// inside one document (AI/MCP parity with the legacy upsert/remove).
func (s *Server) updateCanvasDocumentOps(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ContextID string        `json:"contextId"`
		Ops       []CanvasDocOp `json:"ops"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	doc, err := s.worldsStore().UpdateCanvasDocumentOps(r.PathValue("worldID"), input.ContextID, input.Ops)
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

func (s *Server) promoteWorldCanvas(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Kind               string `json:"kind"`
		RelationType       string `json:"relationType"`
		Field              string `json:"field"`
		TypeID             string `json:"typeId"`
		Title              string `json:"title"`
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	result, err := s.worldsStore().PromoteCanvasElement(PromoteCanvasElementInput{
		WorldID: r.PathValue("worldID"), ElementID: r.PathValue("elementID"), TypeID: input.TypeID,
		RelationType: input.RelationType, Field: input.Field, Title: input.Title,
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) createWorldEntityChild(w http.ResponseWriter, r *http.Request) {
	var input CreateChildEntityInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	input.WorldID = r.PathValue("worldID")
	input.ParentID = r.PathValue("entityID")
	input.CreatedBy = "http"
	entity, err := s.worldsStore().CreateChildEntity(input)
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, entity)
}

func (s *Server) promoteWorldEntity(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	entity, err := s.worldsStore().PromoteEntity(r.PathValue("worldID"), r.PathValue("entityID"), input.ExpectedRevisionID, "http")
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, entity)
}

// 删除实体（T2）：归档实体与子图 + 级联清理关系/证据/画布投影；回传影响范围统计。
func (s *Server) deleteWorldEntity(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&input)
	}
	result, err := s.worldsStore().DeleteEntity(DeleteEntityInput{
		WorldID: r.PathValue("worldID"), EntityID: r.PathValue("entityID"),
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// 版本历史（T12）：最近 50 条 revision 摘要。
func (s *Server) listWorldRevisions(w http.ResponseWriter, r *http.Request) {
	items, err := s.worldsStore().ListRevisions(r.PathValue("worldID"))
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// AI 候选实体（T13/B.16，契约先行）：POST { text, limit } → { candidates: [{kind,title,summary,content}] }。
// 候选生成依赖 LLM 通道（复用 agent 基建），v1 尚未接线：固定返回 501 + AI_NOT_CONFIGURED，
// 前端契约与 UI 已按此实现，后端接入后无需再改前端。
func (s *Server) suggestWorldEntities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": "AI_NOT_CONFIGURED", "message": "AI entity suggestion is not wired to an LLM channel yet"}})
}

// 回滚（T12）：非破坏指针回移，语义状态按目标 revision 的 canonical 重建。
func (s *Server) revertWorldRevision(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&input)
	}
	detail, err := s.worldsStore().RevertToRevision(r.PathValue("worldID"), r.PathValue("revisionID"), input.ExpectedRevisionID, "http")
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func writeWorldsError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	var worldErr *WorldsError
	if errors.As(err, &worldErr) {
		switch worldErr.Code {
		case WorldsErrNotFound, WorldsErrEntityNotFound, WorldsErrRevisionNotFound, WorldsErrAssetNotFound:
			status = http.StatusNotFound
		case WorldsErrRevisionConflict, WorldsErrProjectAlreadyBound, WorldsErrReadOnly:
			status = http.StatusConflict
		case WorldsErrAccessDenied:
			status = http.StatusForbidden
		default:
			status = http.StatusBadRequest
		}
	} else if errors.Is(err, sql.ErrNoRows) {
		status = http.StatusNotFound
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": asWorldsError(err)})
}

func optionalCursor(cursor string) string {
	return cursor
}
