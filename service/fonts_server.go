/*
 * [INPUT]: 依赖 FontService 的目录/CSS/字体文件交付能力与标准 HTTP JSON 协议
 * [OUTPUT]: 对外提供字体目录（GET /v1/fonts）、自托管 @font-face CSS（GET /v1/fonts/google/{id}/css）、
 *          字体二进制分片（GET /v1/fonts/google/{id}/{file}.woff2）、本地上传字体列表/上传/交付/删除
 *          （GET/POST /v1/fonts/local、GET/DELETE /v1/fonts/local/{id}）的本地 HTTP API
 * [POS]: service 的字体服务传输层；编辑器 iframe 与 service 共用同一 loopback origin
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"errors"
	"io"
	"net/http"
	"strings"
)

func (s *Server) listFonts(w http.ResponseWriter, _ *http.Request) {
	if s.fonts == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("font service is unavailable"))
		return
	}
	catalog, err := s.fonts.Catalog()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (s *Server) fontGoogleCSS(w http.ResponseWriter, r *http.Request) {
	if s.fonts == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("font service is unavailable"))
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	css, err := s.fonts.CSS(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", fontsCacheControl)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_, _ = io.WriteString(w, css)
}

func (s *Server) fontGoogleFile(w http.ResponseWriter, r *http.Request) {
	if s.fonts == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("font service is unavailable"))
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	file := strings.TrimPrefix(strings.TrimSpace(r.PathValue("file")), "/")
	content, mime, err := s.fonts.FontFile(id, file)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", fontsCacheControl)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
	_, _ = w.Write(content)
}

func (s *Server) listLocalFonts(w http.ResponseWriter, _ *http.Request) {
	if s.fonts == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("font service is unavailable"))
		return
	}
	items, err := s.fonts.listUploaded()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) uploadLocalFont(w http.ResponseWriter, r *http.Request) {
	if s.fonts == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("font service is unavailable"))
		return
	}
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("无法读取上传的字体文件"))
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("font file is required"))
		return
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	family := strings.TrimSpace(r.FormValue("family"))
	entry, err := s.fonts.UploadLocal(family, header.Filename, content)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

func (s *Server) localFontFile(w http.ResponseWriter, r *http.Request) {
	if s.fonts == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("font service is unavailable"))
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	content, mime, err := s.fonts.LocalFontFile(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
	_, _ = w.Write(content)
}

func (s *Server) deleteLocalFont(w http.ResponseWriter, r *http.Request) {
	if s.fonts == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("font service is unavailable"))
		return
	}
	if err := s.fonts.DeleteLocal(strings.TrimSpace(r.PathValue("id"))); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
