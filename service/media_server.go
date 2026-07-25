/*
 * [INPUT]: 依赖 MediaService 的平台级媒体边界与标准 HTTP JSON 协议
 * [OUTPUT]: 对外提供素材库、图片导入、模型路由、BYOK 凭据和生成任务（默认路由或受校验的模型/凭据直连）的本地 HTTP API
 * [POS]: service 的 Media Platform 传输层；工作台和系统 MCP 使用同一业务服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
)

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

func (s *Server) importMediaImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("image upload must be 20 MB or smaller"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("image file is required"))
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, 20<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	mimeType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(mimeType, "image/") {
		mimeType = http.DetectContentType(content)
	}
	asset, err := s.media.ImportImage(header.Filename, mimeType, content)
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
	path, _ := asset.Metadata["path"].(string)
	if path == "" {
		writeError(w, http.StatusNotFound, errors.New("media file not found"))
		return
	}
	if _, err := os.Stat(path); err != nil {
		writeError(w, http.StatusNotFound, errors.New("media file not found"))
		return
	}
	w.Header().Set("Content-Type", asset.MimeType)
	http.ServeFile(w, r, path)
}
