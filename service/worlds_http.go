/*
 * [INPUT]: 依赖 Store、WorldStore、MediaService 与标准库 net/http JSON 编码
 * [OUTPUT]: 对外提供 RESTful /v1/worlds 资源路由：World/Entity 分页读取、创建/修改/Reference/Resolve 与
 * 项目 World Context 的读与写；结构化 WorldsError 信封与 HTTP 状态映射；处理器只解码/校验/调用 store，不含 Canonical 逻辑
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
		ExpectedRevisionID string         `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	world, err := s.worldsStore().UpdateWorld(UpdateWorldInput{
		WorldID: r.PathValue("worldID"), Name: input.Name, Description: input.Description,
		Identity: input.Identity, ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, world)
}

func (s *Server) listWorldEntities(w http.ResponseWriter, r *http.Request) {
	input := ListEntitiesInput{
		WorldID: r.PathValue("worldID"), Kind: WorldEntityKind(r.URL.Query().Get("kind")),
		Text: r.URL.Query().Get("text"), Cursor: r.URL.Query().Get("cursor"),
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		input.Limit, _ = strconv.Atoi(raw)
	}
	items, nextCursor, err := s.worldsStore().ListEntities(input)
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "nextCursor": optionalCursor(nextCursor)})
}

func (s *Server) createWorldEntity(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Kind               string         `json:"kind"`
		Title              string         `json:"title"`
		Summary            string         `json:"summary"`
		Content            map[string]any `json:"content"`
		ExpectedRevisionID string         `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	entity, err := s.worldsStore().UpsertEntity(UpsertEntityInput{
		WorldID: r.PathValue("worldID"), Kind: WorldEntityKind(input.Kind), Title: input.Title,
		Summary: input.Summary, Content: input.Content, ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
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
	var input struct {
		Title              string         `json:"title"`
		Summary            string         `json:"summary"`
		Content            map[string]any `json:"content"`
		ExpectedRevisionID string         `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	entity, err := s.worldsStore().UpsertEntity(UpsertEntityInput{
		WorldID: r.PathValue("worldID"), EntityID: r.PathValue("entityID"),
		Title: input.Title, Summary: input.Summary, Content: input.Content,
		ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, entity)
}

func (s *Server) attachWorldReference(w http.ResponseWriter, r *http.Request) {
	var input struct {
		EntityID           string `json:"entityId"`
		AssetID            string `json:"assetId"`
		Role               string `json:"role"`
		Label              string `json:"label"`
		ExpectedRevisionID string `json:"expectedRevisionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeWorldsError(w, worldsError(WorldsErrContextInvalid, "invalid JSON body"))
		return
	}
	reference, err := s.worldsStore().AttachReference(AttachReferenceInput{
		WorldID: r.PathValue("worldID"), EntityID: input.EntityID, AssetID: input.AssetID,
		Role: input.Role, Label: input.Label, ExpectedRevisionID: input.ExpectedRevisionID, CreatedBy: "http",
	})
	if err != nil {
		writeWorldsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, reference)
}

func (s *Server) resolveWorld(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RevisionID string        `json:"revisionId"`
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

func writeWorldsError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	var worldErr *WorldsError
	if errors.As(err, &worldErr) {
		switch worldErr.Code {
		case WorldsErrNotFound, WorldsErrEntityNotFound, WorldsErrRevisionNotFound, WorldsErrAssetNotFound:
			status = http.StatusNotFound
		case WorldsErrRevisionConflict, WorldsErrProjectAlreadyBound:
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
