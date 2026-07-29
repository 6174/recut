/*
 * [INPUT]: 依赖 MediaService 的平台级媒体边界与标准 HTTP JSON 协议
 * [OUTPUT]: 对外提供素材库、图片/视频/音频导入、模型路由、BYOK 凭据、动态音色、生成任务及 durable Asset SSE 的本地 HTTP API
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
)

const mediaAssetEventPollInterval = 250 * time.Millisecond
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
	project, err := s.store.EnsureMediaSystemProject()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, project)
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

	ticker := time.NewTicker(mediaAssetEventPollInterval)
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
	r.Body = http.MaxBytesReader(w, r.Body, maxMediaUploadBytes)
	if err := r.ParseMultipartForm(maxMediaUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("media upload must be 50 MB or smaller"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("media file is required"))
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxMediaUploadBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	mimeType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(mimeType, "audio/") && !strings.HasPrefix(mimeType, "video/") {
		mimeType = http.DetectContentType(content)
	}
	asset, err := s.media.ImportMedia(header.Filename, mimeType, content)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

func (s *Server) saveMediaCredential(w http.ResponseWriter, r *http.Request) {
	input := struct {
		ID       string `json:"id"`
		Provider string `json:"provider"`
		Name     string `json:"name"`
		APIBase  string `json:"apiBase"`
		APIKey   string `json:"apiKey"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	credential, err := s.media.SaveCredential(MediaCredential{ID: input.ID, Provider: input.Provider, Name: input.Name, APIBase: input.APIBase}, input.APIKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, credential)
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

func (s *Server) getMediaAssetContent(w http.ResponseWriter, r *http.Request) {
	asset, err := s.media.GetAsset(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("media asset not found"))
		return
	}
	if asset.Status != "completed" {
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
