/*
 * [INPUT]: 依赖本目录 Catalog、Store 与 TerminalManager 的本地服务
 * [OUTPUT]: 对外提供 Server 及 App 能力、项目产物、结构化 Agent 会话与终端 HTTP API
 * [POS]: service 的传输层，负责把受信任项目与扩展注册表映射为浏览器可消费的 API；对话和 PTY 协议并存
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type Server struct {
	apps      *Catalog
	store     *Store
	terminals *TerminalManager
	bridge    *AgentBridge
	agents    *AgentManager
	host      *AppHost
}

func NewServer(apps *Catalog, store *Store, terminals *TerminalManager, bridge *AgentBridge, agents *AgentManager, host *AppHost) *Server {
	return &Server{apps: apps, store: store, terminals: terminals, bridge: bridge, agents: agents, host: host}
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
	mux.HandleFunc("GET /v1/apps/{appID}/ui/{path...}", s.appUI)
	mux.HandleFunc("GET /v1/projects", s.listProjects)
	mux.HandleFunc("POST /v1/projects", s.createProject)
	mux.HandleFunc("GET /v1/projects/{id}", s.getProject)
	mux.HandleFunc("GET /v1/projects/{id}/artifacts", s.listArtifacts)
	mux.HandleFunc("POST /v1/projects/{id}/apps/{appID}/api/{name}", s.invokeAppAPI)
	mux.HandleFunc("GET /v1/events", s.projectEventsWS)
	mux.HandleFunc("POST /v1/projects/{id}/agent-tasks", s.startAgentTask)
	mux.HandleFunc("POST /v1/projects/{id}/proposals/{proposalID}/approve", s.approveProposal)
	mux.HandleFunc("GET /v1/agent-sessions", s.listAgentSessions)
	mux.HandleFunc("POST /v1/agent-sessions", s.createAgentSession)
	mux.HandleFunc("GET /v1/agent-sessions/{id}", s.getAgentSession)
	mux.HandleFunc("POST /v1/agent-sessions/{id}/turns", s.startAgentTurn)
	mux.HandleFunc("POST /v1/agent-sessions/{id}/stop", s.stopAgentTurn)
	mux.HandleFunc("GET /v1/agent-sessions/{id}/events", s.streamAgentEvents)
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

func (s *Server) listArtifacts(w http.ResponseWriter, r *http.Request) {
	artifacts, err := s.store.ListArtifacts(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, artifacts)
}

func (s *Server) invokeAppAPI(w http.ResponseWriter, r *http.Request) {
	input := map[string]any{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	result, err := s.host.InvokeAPI(r.PathValue("id"), r.PathValue("appID"), r.PathValue("name"), input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) appUI(w http.ResponseWriter, r *http.Request) {
	app, ok := s.apps.Get(r.PathValue("appID"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("App not found"))
		return
	}
	requested := filepath.Clean(strings.TrimPrefix(r.PathValue("path"), "/"))
	if requested == "." || strings.HasPrefix(requested, "..") || filepath.IsAbs(requested) {
		writeError(w, http.StatusBadRequest, errors.New("invalid UI path"))
		return
	}
	path := filepath.Join(app.Root, requested)
	if _, err := os.Stat(path); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	http.ServeFile(w, r, path)
}

func (s *Server) startAgentTask(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Instruction string `json:"instruction"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || strings.TrimSpace(input.Instruction) == "" {
		writeError(w, http.StatusBadRequest, errors.New("task instruction is required"))
		return
	}
	projectID := r.PathValue("id")
	if _, err := s.store.Get(projectID); err != nil {
		writeError(w, http.StatusNotFound, errors.New("project not found"))
		return
	}
	for _, candidate := range s.terminals.List() {
		if candidate.ProjectID == projectID && candidate.Command == "codex" && candidate.Running && candidate.ManagedBy == "recut-bridge" {
			if err := s.terminals.Write(candidate.ID, input.Instruction+"\n"); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			writeJSON(w, http.StatusAccepted, map[string]any{"terminalId": candidate.ID, "status": "running", "reused": true})
			return
		}
	}
	agentSession, token, err := s.bridge.CreateSession(projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	executable, err := os.Executable()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	executable, err = s.bridge.MaterializeCodexProject(agentSession, token, executable)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	projectRoot := s.store.projectDir(projectID)
	session, err := s.terminals.Start(TerminalStart{ProjectID: projectID, Command: "codex", Args: codexProjectArgs(projectRoot, executable, s.store.root, s.apps.Directory(), agentSession, token), CWD: projectRoot, SessionDir: s.store.terminalSessionsDir(projectID), InitialInput: launchPrompt(agentSession) + "\n" + input.Instruction + "\n", ManagedBy: "recut-bridge"})
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"terminalId": session.ID, "status": "running", "reused": false})
}

func (s *Server) approveProposal(w http.ResponseWriter, r *http.Request) {
	input := struct {
		SessionID string `json:"sessionId"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.SessionID == "" {
		writeError(w, http.StatusBadRequest, errors.New("agent session is required"))
		return
	}
	result, err := s.bridge.ApproveProposal(input.SessionID, r.PathValue("proposalID"))
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
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
	start := TerminalStart{ProjectID: projectID, Command: input.Command, Args: args, CWD: cwd, SessionDir: sessionDir, Cols: input.Cols, Rows: input.Rows}
	if projectID != "" && (input.Command == "codex" || input.Command == "claude") && len(args) == 0 {
		agentSession, token, err := s.bridge.CreateSession(projectID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		start.Env = []string{"RECUT_AGENT_SESSION=" + agentSession.ID, "RECUT_AGENT_TOKEN=" + token}
		start.ManagedBy = "recut-bridge"
		start.InitialInput = launchPrompt(agentSession) + "\n"
		executable, err := os.Executable()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if input.Command == "codex" {
			executable, err = s.bridge.MaterializeCodexProject(agentSession, token, executable)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			start.Env = nil
			start.Args = codexProjectArgs(cwd, executable, s.store.root, s.apps.Directory(), agentSession, token)
		} else {
			profile, err := s.bridge.WriteClientProfile(agentSession, executable)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			start.Args = []string{"--mcp-config", profile}
		}
	}
	session, err := s.terminals.Start(TerminalStart{
		ProjectID: start.ProjectID, Command: start.Command, Args: start.Args, CWD: start.CWD, SessionDir: start.SessionDir, Cols: start.Cols, Rows: start.Rows, Env: start.Env, InitialInput: start.InitialInput, ManagedBy: start.ManagedBy,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func launchPrompt(session AgentSession) string {
	return fmt.Sprintf("You are attached to Recut App Agent Bridge session %s. %s", session.ID, bridgeInstructions)
}

func tomlStringArray(values []string) string {
	quoted := make([]string, len(values))
	for index, value := range values {
		quoted[index] = fmt.Sprintf("%q", value)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

func codexProjectArgs(projectRoot, executable, dataDir, appsDir string, session AgentSession, token string) []string {
	return []string{"--dangerously-bypass-approvals-and-sandbox", "-C", projectRoot, "--config", fmt.Sprintf("projects.%q.trust_level=\"trusted\"", projectRoot), "--config", fmt.Sprintf("mcp_servers.recut.command=%q", executable), "--config", "mcp_servers.recut.args=" + tomlStringArray([]string{"--mcp-stdio", "--data-dir", dataDir, "--apps-dir", appsDir}), "--config", fmt.Sprintf("mcp_servers.recut.env={ RECUT_AGENT_SESSION = %q, RECUT_AGENT_TOKEN = %q }", session.ID, token)}
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
