/*
 * [INPUT]: 依赖本目录 Catalog、Store 与 TerminalManager 的本地服务
 * [OUTPUT]: 对外提供含启动时间的 health、带 INFO/WARN/ERROR 请求审计的 Server 及内嵌工作台、无入口重定向的 App UI、App 能力、项目产物、结构化 Agent 会话/新对话引导、OpenCode TUI 模型目录与终端 HTTP API
 * [POS]: service 的传输层，负责把受信任项目、内嵌本地工作台与扩展注册表映射为浏览器可消费的 API；对话和 PTY 协议并存
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Server struct {
	apps      *Catalog
	store     *Store
	terminals *TerminalManager
	bridge    *AgentBridge
	agents    *AgentManager
	host      *AppHost
	media     *MediaService
	updater   *ServiceUpdater
}

func NewServer(apps *Catalog, store *Store, terminals *TerminalManager, bridge *AgentBridge, agents *AgentManager, host *AppHost, media *MediaService, updater ...*ServiceUpdater) *Server {
	server := &Server{apps: apps, store: store, terminals: terminals, bridge: bridge, agents: agents, host: host, media: media}
	if len(updater) > 0 {
		server.updater = updater[0]
	}
	return server
}

func (s *Server) ListenAndServe(address string) error {
	return http.ListenAndServe(address, s.routes())
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":    "ok",
			"version":   ServiceVersion(),
			"startedAt": serviceStartedAt.Format(time.RFC3339Nano),
		})
	})
	mux.HandleFunc("GET /v1/system/status", s.systemStatus)
	mux.HandleFunc("GET /v1/system/logs", s.systemLogs)
	mux.HandleFunc("POST /v1/system/update", s.updateSystem)
	mux.HandleFunc("POST /v1/system/restart", s.restartSystem)
	mux.HandleFunc("GET /v1/apps", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, s.apps.List()) })
	mux.HandleFunc("GET /v1/apps/installed", s.listAppInstallations)
	mux.HandleFunc("POST /v1/apps/install", s.installApp)
	mux.HandleFunc("POST /v1/apps/{package}/update", s.updateApp)
	mux.HandleFunc("GET /v1/apps/{appID}/workspace", s.getStandaloneAppProject)
	mux.HandleFunc("GET /v1/apps/{appID}/ui/{path...}", s.appUI)
	mux.HandleFunc("GET /v1/projects", s.listProjects)
	mux.HandleFunc("POST /v1/projects", s.createProject)
	mux.HandleFunc("GET /v1/projects/{id}", s.getProject)
	mux.HandleFunc("GET /v1/projects/{id}/artifacts", s.listArtifacts)
	mux.HandleFunc("GET /v1/media/models", s.listMediaModels)
	mux.HandleFunc("GET /v1/media/system-project", s.getMediaSystemProject)
	mux.HandleFunc("GET /v1/media/providers", s.listMediaProviders)
	mux.HandleFunc("GET /v1/media/configuration", s.listMediaConfiguration)
	mux.HandleFunc("GET /v1/media/credentials", s.listMediaCredentials)
	mux.HandleFunc("POST /v1/media/credentials", s.saveMediaCredential)
	mux.HandleFunc("GET /v1/media/credentials/{id}/voices", s.listMediaVoices)
	mux.HandleFunc("GET /v1/media/routes", s.listMediaRoutes)
	mux.HandleFunc("POST /v1/media/routes", s.saveMediaRoute)
	mux.HandleFunc("GET /v1/media/events", s.streamMediaAssetEvents)
	mux.HandleFunc("GET /v1/media/assets", s.listMediaAssets)
	mux.HandleFunc("POST /v1/media/assets", s.importMediaAsset)
	mux.HandleFunc("GET /v1/media/assets/{id}", s.getMediaAsset)
	mux.HandleFunc("GET /v1/media/assets/{id}/content", s.getMediaAssetContent)
	mux.HandleFunc("POST /v1/media/assets/{id}/attach", s.attachMediaAsset)
	mux.HandleFunc("POST /v1/media/jobs", s.createMediaJob)
	mux.HandleFunc("GET /v1/media/jobs/{id}", s.getMediaJob)
	mux.HandleFunc("POST /v1/projects/{id}/apps/{appID}/api/{name}", s.invokeAppAPI)
	mux.HandleFunc("GET /v1/projects/{id}/apps/{appID}/files/{path...}", s.appFile)
	mux.HandleFunc("GET /v1/events", s.projectEventsWS)
	mux.HandleFunc("POST /v1/projects/{id}/agent-tasks", s.startAgentTask)
	mux.HandleFunc("POST /v1/projects/{id}/proposals/{proposalID}/approve", s.approveProposal)
	mux.HandleFunc("GET /v1/agent-sessions", s.listAgentSessions)
	mux.HandleFunc("GET /v1/agent-onboarding", s.getAgentOnboarding)
	mux.HandleFunc("PUT /v1/agent-onboarding", s.saveAgentOnboarding)
	mux.HandleFunc("POST /v1/agent-sessions", s.createAgentSession)
	mux.HandleFunc("GET /v1/agent-sessions/{id}", s.getAgentSession)
	mux.HandleFunc("PATCH /v1/agent-sessions/{id}/codex-configuration", s.updateCodexConfiguration)
	mux.HandleFunc("PATCH /v1/agent-sessions/{id}/opencode-configuration", s.updateOpencodeConfiguration)
	mux.HandleFunc("POST /v1/agent-sessions/{id}/turns", s.startAgentTurn)
	mux.HandleFunc("POST /v1/agent-sessions/{id}/stop", s.stopAgentTurn)
	mux.HandleFunc("GET /v1/agent-sessions/{id}/events", s.streamAgentEvents)
	mux.HandleFunc("GET /v1/agents", s.listAgents)
	mux.HandleFunc("GET /v1/agents/opencode/models", s.listOpencodeModels)
	mux.HandleFunc("GET /v1/terminals", s.listTerminals)
	mux.HandleFunc("POST /v1/terminals", s.startTerminal)
	mux.HandleFunc("GET /v1/terminals/{id}/events", s.streamTerminal)
	mux.HandleFunc("POST /v1/terminals/{id}/input", s.writeTerminal)
	mux.HandleFunc("POST /v1/terminals/{id}/resize", s.resizeTerminal)
	mux.HandleFunc("POST /v1/terminals/{id}/stop", s.stopTerminal)
	// 具体 API 路由优先于这个根路径；本地工作台和 API 因此始终共享同一个 loopback origin。
	mux.Handle("GET /", localWorkspaceHandler(localWorkspaceFiles()))
	return withRequestLogging(withLocalCORS(mux), log.Default())
}

func (s *Server) systemStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"version": ServiceVersion(), "selfUpdate": s.updater != nil, "selfRestart": s.updater.CanRestart()})
}

func (s *Server) updateSystem(w http.ResponseWriter, _ *http.Request) {
	if !s.updater.CanRestart() {
		writeError(w, http.StatusNotImplemented, errors.New("service self-update is unavailable"))
		return
	}
	version, err := s.updater.Update()
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	log.Printf("INFO service update applied version=%s", version)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "restarting", "version": version})
	s.updater.RestartSoon()
}

func (s *Server) restartSystem(w http.ResponseWriter, _ *http.Request) {
	if !s.updater.CanRestart() {
		writeError(w, http.StatusNotImplemented, errors.New("service restart is unavailable"))
		return
	}
	log.Printf("INFO service restart requested version=%s", ServiceVersion())
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "restarting", "version": ServiceVersion()})
	s.updater.RestartSoon()
}

type AgentStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Command   string `json:"command"`
	Available bool   `json:"available"`
}

func (s *Server) listAgents(w http.ResponseWriter, _ *http.Request) {
	agents := []AgentStatus{{ID: "codex", Name: "Codex", Command: "codex"}, {ID: "claude", Name: "Claude Code", Command: "claude"}, {ID: "opencode", Name: "OpenCode", Command: "opencode"}}
	for index := range agents {
		// 面板只需可用性；完整多 shell 扫描只在用户主动打开诊断页时执行。
		diagnostic := resolveAgentCommand(agents[index].Command, false)
		agents[index].Available = diagnostic.ResolvedPath != ""
		if agents[index].Available {
			log.Printf("INFO agent CLI resolved command=%s path=%q source=%q", agents[index].Command, diagnostic.ResolvedPath, diagnostic.Resolution)
		} else {
			log.Printf("WARN agent CLI unavailable command=%s service_path=%q", agents[index].Command, diagnostic.ServicePath)
		}
	}
	writeJSON(w, http.StatusOK, agents)
}

func (s *Server) systemLogs(w http.ResponseWriter, r *http.Request) {
	if !isLocalNetworkRequest(r) {
		writeError(w, http.StatusForbidden, errors.New("diagnostic logs are available only from the local network"))
		return
	}
	w.Header().Set("Content-Disposition", "inline; filename=recut-service-diagnostics.log")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprintf(w, "Recut service diagnostics\nGenerated: %s\nVersion: %s\n\n", time.Now().UTC().Format(time.RFC3339), ServiceVersion())
	for _, command := range []string{"codex", "claude", "opencode"} {
		data, _ := json.MarshalIndent(inspectAgentCommand(command), "", "  ")
		fmt.Fprintf(w, "%s CLI resolution\n%s\n\n", strings.ToUpper(command), data)
	}
	path, data, err := s.latestServiceLog()
	if err != nil {
		fmt.Fprintf(w, "Recent service log unavailable: %v\n", err)
		return
	}
	fmt.Fprintf(w, "Recent service log: %s\n%s", path, data)
}

func (s *Server) latestServiceLog() (string, []byte, error) {
	entries, err := os.ReadDir(filepath.Join(s.store.root, "logs"))
	if err != nil {
		return "", nil, err
	}
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), "service-") && strings.HasSuffix(entry.Name(), ".log") {
			paths = append(paths, filepath.Join(s.store.root, "logs", entry.Name()))
		}
	}
	if len(paths) == 0 {
		return "", nil, errors.New("no service log file exists")
	}
	sort.Sort(sort.Reverse(sort.StringSlice(paths)))
	file, err := os.Open(paths[0])
	if err != nil {
		return "", nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 256<<10))
	return paths[0], data, err
}

func isLocalNetworkRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	address, err := netip.ParseAddr(host)
	return err == nil && (address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast())
}

func withLocalCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/") && !isAppUIPath(r.URL.Path) {
			w.Header().Set("Cache-Control", "no-store")
		}
		origin := r.Header.Get("Origin")
		if allowedBrowserOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		if r.Method == http.MethodOptions {
			if origin != "" && !allowedBrowserOrigin(origin) {
				http.Error(w, "origin is not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isAppUIPath(path string) bool {
	return strings.HasPrefix(path, "/v1/apps/") && strings.Contains(path, "/ui/")
}

func allowedBrowserOrigin(origin string) bool {
	if origin == "https://recut.video" || origin == "https://www.recut.video" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return false
	}
	if parsed.Hostname() == "localhost" {
		return true
	}
	address, err := netip.ParseAddr(parsed.Hostname())
	return err == nil && (address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast())
}

func (s *Server) listAppInstallations(w http.ResponseWriter, _ *http.Request) {
	installations, err := s.apps.Installations()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, installations)
}

func (s *Server) installApp(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Repository string `json:"repository"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	installed, err := s.apps.InstallGitHub(input.Repository)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	log.Printf("INFO app installed id=%s package=%s", installed.Manifest.ID, installed.Package)
	writeJSON(w, http.StatusCreated, installed)
}

func (s *Server) updateApp(w http.ResponseWriter, r *http.Request) {
	updated, err := s.apps.UpdateInstallation(r.PathValue("package"))
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	log.Printf("INFO app updated id=%s package=%s revision=%s", updated.Manifest.ID, updated.Package, updated.Revision)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) getStandaloneAppProject(w http.ResponseWriter, r *http.Request) {
	project, err := s.store.EnsureStandaloneAppProject(strings.TrimSpace(r.PathValue("appID")))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, project)
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
	log.Printf("INFO project created id=%s app_id=%s", created.ID, created.AppID)
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

func (s *Server) appFile(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	appID := r.PathValue("appID")
	app, ok := s.apps.Get(appID)
	if !ok || !hasPermission(app.Manifest, "files") {
		writeError(w, http.StatusNotFound, errors.New("App file not found"))
		return
	}
	root, err := s.store.AppFilesRoot(projectID, appID)
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("App workspace not found"))
		return
	}
	requested := strings.TrimPrefix(r.PathValue("path"), "/")
	path, ok := sandboxPath(root, requested)
	if !ok {
		writeError(w, http.StatusBadRequest, errors.New("invalid App file path"))
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, errors.New("App file not found"))
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, path)
}

func sandboxPath(root, requested string) (string, bool) {
	clean := filepath.Clean(requested)
	if requested == "" || filepath.IsAbs(requested) || clean == "." || strings.HasPrefix(clean, "..") {
		return "", false
	}
	return filepath.Join(root, clean), true
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
	if strings.HasSuffix(requested, "/index.html") {
		w.Header().Set("Cache-Control", "no-cache")
		requestCopy := r.Clone(r.Context())
		urlCopy := *r.URL
		requestCopy.URL = &urlCopy
		requestCopy.URL.Path = strings.TrimSuffix(r.URL.Path, "index.html")
		r = requestCopy
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
	if recorder, ok := w.(interface{ recordRequestError(error) }); ok {
		recorder.recordRequestError(err)
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
