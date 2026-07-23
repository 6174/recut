/*
 * [INPUT]: 依赖本目录 Catalog、Store 与 TerminalManager 的本地服务
 * [OUTPUT]: 对外提供 Server 及项目、终端会话 HTTP API 启动能力
 * [POS]: service 的传输层，负责把受信任项目目录映射为浏览器可消费的 API
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"sort"
	"strings"
)

type Server struct {
	apps      *Catalog
	store     *Store
	terminals *TerminalManager
}

func NewServer(apps *Catalog, store *Store, terminals *TerminalManager) *Server {
	return &Server{apps: apps, store: store, terminals: terminals}
}

func (s *Server) ListenAndServe(address string) error {
	return http.ListenAndServe(address, s.routes())
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /v1/apps", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, s.apps.List()) })
	mux.HandleFunc("GET /v1/projects", s.listProjects)
	mux.HandleFunc("POST /v1/projects", s.createProject)
	mux.HandleFunc("GET /v1/projects/{id}", s.getProject)
	mux.HandleFunc("GET /v1/agents", s.listAgents)
	mux.HandleFunc("GET /v1/terminals", s.listTerminals)
	mux.HandleFunc("POST /v1/terminals", s.startTerminal)
	mux.HandleFunc("GET /v1/terminals/{id}/events", s.streamTerminal)
	mux.HandleFunc("POST /v1/terminals/{id}/input", s.writeTerminal)
	mux.HandleFunc("POST /v1/terminals/{id}/resize", s.resizeTerminal)
	mux.HandleFunc("POST /v1/terminals/{id}/stop", s.stopTerminal)
	return withLocalCORS(mux)
}

type AgentStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Command   string `json:"command"`
	Available bool   `json:"available"`
}

func (s *Server) listAgents(w http.ResponseWriter, _ *http.Request) {
	agents := []AgentStatus{{ID: "codex", Name: "Codex", Command: "codex"}, {ID: "claude", Name: "Claude Code", Command: "claude"}}
	for index := range agents {
		_, err := exec.LookPath(agents[index].Command)
		agents[index].Available = err == nil
	}
	writeJSON(w, http.StatusOK, agents)
}

func withLocalCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "http://localhost:3000" || origin == "http://127.0.0.1:3000" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) listProjects(w http.ResponseWriter, _ *http.Request) {
	projects, err := s.store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	input := CreateInput{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	created, err := s.store.Create(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	project, err := s.store.Get(strings.TrimSpace(r.PathValue("id")))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("project not found"))
		return
	}
	writeJSON(w, http.StatusOK, project)
}

type startTerminalInput struct {
	ProjectID string   `json:"projectId"`
	Command   string   `json:"command"`
	Args      []string `json:"args"`
	Cols      uint16   `json:"cols"`
	Rows      uint16   `json:"rows"`
}

func (s *Server) listTerminals(w http.ResponseWriter, _ *http.Request) {
	terminals := s.terminals.List()
	sort.Slice(terminals, func(i, j int) bool { return terminals[i].StartedAt.After(terminals[j].StartedAt) })
	writeJSON(w, http.StatusOK, terminals)
}

func (s *Server) startTerminal(w http.ResponseWriter, r *http.Request) {
	input := startTerminalInput{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	projectID := strings.TrimSpace(input.ProjectID)
	cwd, sessionDir := s.store.projectsDir(), s.store.workspaceTerminalSessionsDir()
	if projectID != "" {
		if _, err := s.store.Get(projectID); err != nil {
			writeError(w, http.StatusNotFound, errors.New("project not found"))
			return
		}
		cwd, sessionDir = s.store.projectDir(projectID), s.store.terminalSessionsDir(projectID)
	}
	args := input.Args
	if input.Command == "codex" && len(args) == 0 {
		args = []string{"--dangerously-bypass-approvals-and-sandbox"}
	}
	session, err := s.terminals.Start(TerminalStart{
		ProjectID:  projectID,
		Command:    input.Command,
		Args:       args,
		CWD:        cwd,
		SessionDir: sessionDir,
		Cols:       input.Cols,
		Rows:       input.Rows,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) writeTerminal(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Data string `json:"data"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	if err := s.terminals.Write(r.PathValue("id"), input.Data); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) resizeTerminal(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Cols uint16 `json:"cols"`
		Rows uint16 `json:"rows"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	if err := s.terminals.Resize(r.PathValue("id"), input.Cols, input.Rows); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) stopTerminal(w http.ResponseWriter, r *http.Request) {
	if err := s.terminals.Stop(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) streamTerminal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	history, output, unsubscribe, err := s.terminals.Subscribe(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	defer unsubscribe()
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming is unavailable"))
		return
	}
	if history != "" {
		data, _ := json.Marshal(history)
		_, _ = fmt.Fprintf(w, "event: output\ndata: %s\n\n", data)
		flusher.Flush()
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case chunk := <-output:
			data, _ := json.Marshal(chunk)
			_, _ = fmt.Fprintf(w, "event: output\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
