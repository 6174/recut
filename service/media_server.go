/*
 * [INPUT]: 依赖 MediaService 的平台级媒体边界与标准 HTTP JSON 协议
 * [OUTPUT]: 对外提供素材库、无固定大小上限的流式图片/视频/音频导入、可重命名/删除的 Asset、转写 bundle 与 reference 素材的 parts 交付、模型路由、BYOK 凭据、动态音色、生成任务及 durable Asset SSE 的本地 HTTP API
 * [POS]: service 的 Media Platform 传输层；工作台和系统 MCP 使用同一业务服务，SSE 只传播本地 Asset 真相
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"database/sql"
)

const completedMediaCacheControl = "public, max-age=31536000, immutable"

type mediaAssetSnapshot struct {
	Cursor int64        `json:"cursor"`
	Assets []MediaAsset `json:"assets"`
}

type mediaAssetUpdate struct {
	ID    int64      `json:"id"`
	Asset MediaAsset `json:"asset"`
}

func (s *Server) listMediaModels(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.media.Models())
}
func (s *Server) getMediaSystemProject(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, mediaScopeDescriptor())
}

// mediaScopeDescriptor is the stable identity of the platform media scope. Media
// conversations are unbound sessions (no Project); the media tools operate on
// workspace-level Assets directly.
func mediaScopeDescriptor() map[string]any {
	return map[string]any{
		"id":            "media",
		"name":          "素材库",
		"appId":         mediaSystemAppID,
		"appVersion":    "1.0.0",
		"formatVersion": formatVersion,
		"kind":          "scope",
	}
}

func (s *Server) listMediaProviders(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.media.Providers())
}
func (s *Server) listMediaConfiguration(w http.ResponseWriter, _ *http.Request) {
	configuration, err := s.media.ConfiguredModels()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, configuration)
}

func (s *Server) listMediaCredentials(w http.ResponseWriter, _ *http.Request) {
	items, err := s.media.ListCredentials()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) listMediaVoices(w http.ResponseWriter, r *http.Request) {
	voices, err := s.media.ListVoices(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, voices)
}

func (s *Server) listMediaRoutes(w http.ResponseWriter, _ *http.Request) {
	items, err := s.media.ListRoutes()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) listMediaAssets(w http.ResponseWriter, r *http.Request) {
	items, err := s.media.ListAssets(strings.TrimSpace(r.URL.Query().Get("projectId")))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// streamMediaAssetEvents exposes the durable Asset event ledger. An initial
// subscriber receives a full snapshot; a reconnect that supplies a cursor
// receives every committed update after that cursor. No provider state is
// queried here, so the browser always observes the same local truth as MCP
// submitters and the daemon.
func (s *Server) streamMediaAssetEvents(w http.ResponseWriter, r *http.Request) {
	after, hasCursor, err := mediaAssetEventCursor(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	latest, err := s.media.LatestAssetEventID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	// A cursor from a prior workspace cannot be replayed. A snapshot is the
	// only safe recovery because it replaces stale browser state atomically.
	if after > latest {
		hasCursor = false
	}
	var snapshot mediaAssetSnapshot
	if !hasCursor {
		assets, err := s.media.ListAssets("")
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		snapshot = mediaAssetSnapshot{Cursor: latest, Assets: assets}
		after = latest
	}

	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming is unavailable"))
		return
	}
	if !hasCursor && !writeMediaSSE(w, "", "media.snapshot", snapshot) {
		return
	}
	flusher.Flush()

	ticker := time.NewTicker(changeHubPollInterval)
	defer ticker.Stop()
	for {
		events, err := s.media.AssetEvents(after)
		if err != nil {
			return
		}
		for _, event := range events {
			after = event.ID
			asset, err := s.media.GetAsset(event.AssetID)
			if err != nil {
				// Asset deletion is not currently exposed, but advancing the
				// durable cursor keeps a future deletion API from wedging SSE.
				continue
			}
			if !writeMediaSSE(w, strconv.FormatInt(event.ID, 10), "asset.updated", mediaAssetUpdate{ID: event.ID, Asset: asset}) {
				return
			}
		}
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-s.store.mediaEvents.wait():
		case <-ticker.C:
		}
	}
}

func mediaAssetEventCursor(r *http.Request) (int64, bool, error) {
	value := strings.TrimSpace(r.URL.Query().Get("after"))
	if value == "" {
		value = strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	}
	if value == "" {
		return 0, false, nil
	}
	cursor, err := strconv.ParseInt(value, 10, 64)
	if err != nil || cursor < 0 {
		return 0, false, errors.New("media event cursor must be a non-negative integer")
	}
	return cursor, true, nil
}

func writeMediaSSE(w io.Writer, id, event string, value any) bool {
	data, err := json.Marshal(value)
	if err != nil {
		return false
	}
	if id != "" {
		_, err = fmt.Fprintf(w, "id: %s\n", id)
	}
	if err == nil {
		_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
	}
	return err == nil
}

func (s *Server) importMediaAsset(w http.ResponseWriter, r *http.Request) {
	// ParseMultipartForm spills files beyond this small memory buffer to disk.
	// It is not an upload limit: ImportMediaReader streams the selected file into
	// the content-addressed media store without retaining its bytes in memory.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("无法读取上传的媒体文件"))
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("media file is required"))
		return
	}
	defer file.Close()
	mimeType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(mimeType, "audio/") && !strings.HasPrefix(mimeType, "video/") {
		content, err := io.ReadAll(io.LimitReader(file, 512))
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		mimeType = http.DetectContentType(content)
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}
	asset, err := s.media.ImportMediaReader(header.Filename, mimeType, file)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

func (s *Server) deleteMediaCredential(w http.ResponseWriter, r *http.Request) {
	if err := s.media.DeleteCredential(r.PathValue("id")); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, errors.New("media credential not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) saveMediaCredential(w http.ResponseWriter, r *http.Request) {
	input := struct {
		ID             string            `json:"id"`
		Provider       string            `json:"provider"`
		Name           string            `json:"name"`
		APIBase        string            `json:"apiBase"`
		APIKey         string            `json:"apiKey"`
		ModelOverrides map[string]string `json:"modelOverrides"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	credential, err := s.media.SaveCredential(MediaCredential{ID: input.ID, Provider: input.Provider, Name: input.Name, APIBase: input.APIBase, ModelOverrides: input.ModelOverrides}, input.APIKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, credential)
}

// createMediaShare publishes one completed Asset as a temporary public URL
// (7-day default TTL, unguessable token). Provider reference publishing goes
// through the same path internally.
func (s *Server) createMediaShare(w http.ResponseWriter, r *http.Request) {
	input := struct {
		AssetID string `json:"assetId"`
		TTLDays int    `json:"ttlDays"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || strings.TrimSpace(input.AssetID) == "" {
		writeError(w, http.StatusBadRequest, errors.New("assetId is required"))
		return
	}
	asset, err := s.media.GetAsset(strings.TrimSpace(input.AssetID))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("media asset not found"))
		return
	}
	share, err := s.media.SharePublish(asset, input.TTLDays)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, share)
}

func (s *Server) listMediaShares(w http.ResponseWriter, r *http.Request) {
	assetID := strings.TrimSpace(r.URL.Query().Get("assetId"))
	if assetID == "" {
		writeError(w, http.StatusBadRequest, errors.New("assetId is required"))
		return
	}
	shares, err := s.media.ListShares(assetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, shares)
}

func (s *Server) deleteMediaShare(w http.ResponseWriter, r *http.Request) {
	if err := s.media.RevokeShare(r.PathValue("id")); err != nil {
		if errors.Is(err, ErrShareNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) saveMediaRoute(w http.ResponseWriter, r *http.Request) {
	input := MediaRoute{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	route, err := s.media.SaveRoute(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, route)
}

func (s *Server) createMediaJob(w http.ResponseWriter, r *http.Request) {
	input := GenerateMediaInput{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	job, err := s.media.Generate(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (s *Server) getMediaJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.media.GetJob(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("media job not found"))
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) getMediaAsset(w http.ResponseWriter, r *http.Request) {
	asset, err := s.media.GetAsset(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("media asset not found"))
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (s *Server) updateMediaAsset(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Name string `json:"name"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	asset, err := s.media.RenameAsset(r.PathValue("id"), input.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (s *Server) deleteMediaAsset(w http.ResponseWriter, r *http.Request) {
	// 带 projectId 则是「从当前项目解除引用」，全局素材保留；不带才是真正全局删除素材。
	if projectID := strings.TrimSpace(r.URL.Query().Get("projectId")); projectID != "" {
		if err := s.media.DetachProjectAsset(r.PathValue("id"), projectID); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.media.DeleteAsset(r.PathValue("id")); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) retryMediaAssetDownload(w http.ResponseWriter, r *http.Request) {
	asset, err := s.media.RetryAssetDownload(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (s *Server) attachMediaAsset(w http.ResponseWriter, r *http.Request) {
	input := struct {
		ProjectID string `json:"projectId"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.ProjectID == "" {
		writeError(w, http.StatusBadRequest, errors.New("projectId is required"))
		return
	}
	if err := s.media.Attach(r.PathValue("id"), input.ProjectID); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// getMediaAssetPart serves a named content part of an Asset bundle: transcript
// Assets expose srt/json parts while reference Assets expose body text and
// image parts. Parts are immutable content-addressed files, so the same
// long-lived cache policy as primary content applies.
func (s *Server) getMediaAssetPart(w http.ResponseWriter, r *http.Request) {
	partName := strings.TrimSpace(r.PathValue("part"))
	if partName == "" {
		writeError(w, http.StatusBadRequest, errors.New("asset part name is required"))
		return
	}
	asset, err := s.media.GetAsset(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("media asset not found"))
		return
	}
	if asset.Status == "deleted" {
		writeJSON(w, http.StatusGone, map[string]string{"code": "asset_deleted", "assetId": asset.ID})
		return
	}
	part, content, err := s.media.GetAssetPart(asset.ID, partName)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.Header().Set("Cache-Control", completedMediaCacheControl)
	w.Header().Set("Content-Type", part.MimeType)
	w.Write(content)
}

func (s *Server) getMediaAssetContent(w http.ResponseWriter, r *http.Request) {
	asset, err := s.media.GetAsset(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("media asset not found"))
		return
	}
	if asset.Status != "completed" {
		if asset.Status == "deleted" {
			writeJSON(w, http.StatusGone, map[string]string{"code": "asset_deleted", "assetId": asset.ID})
			return
		}
		message := "media asset is still generating"
		if asset.Status == "failed" {
			message = asset.Error
			if message == "" {
				message = "media asset generation failed"
			}
		}
		writeError(w, http.StatusConflict, errors.New(message))
		return
	}
	path, _ := asset.Metadata["path"].(string)
	if path == "" {
		writeError(w, http.StatusNotFound, errors.New("media file not found"))
		return
	}
	if _, err := os.Stat(path); err != nil {
		writeError(w, http.StatusNotFound, errors.New("media file not found"))
		return
	}
	// A completed Asset's bytes are content-addressed and never change. Let the
	// browser reuse a decoded preview instead of reopening the same local video
	// for every card remount or scroll pass.
	w.Header().Set("Cache-Control", completedMediaCacheControl)
	w.Header().Set("Content-Type", asset.MimeType)
	http.ServeFile(w, r, path)
}
