/*
 * [INPUT]: 依赖本目录 Catalog、Store（含 Agent CLI 定位缓存）与 TerminalManager 的本地服务
 * [OUTPUT]: 对外提供含启动时间的 health、带 INFO/WARN/ERROR 请求审计且可由组合根优雅关停的短请求与事件流 HTTP Server、可重命名/删除的项目与素材、内嵌工作台、无入口重定向的 App UI、App 安装/单个或批量更新、按归属分组的 Skill 状态/软链接、App 能力、项目产物、结构化 Agent 会话/新对话引导、缓存化 CLI 可用性、OpenCode TUI 模型目录、Agent CLI 调试流与终端 HTTP API（含受项目文件根约束的相对工作目录），并为 app.localhost 等本机开发 Host 提供 CORS
 * [POS]: service 的传输层，负责把受信任项目、内嵌本地工作台与扩展注册表映射为浏览器可消费的 API；只构造 HTTP Server，进程信号和关停策略归组合根所有
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
	fonts     *FontService
	updater   *ServiceUpdater
	skill     *RecutSkillManager
	worlds    *WorldStore
	bus       *EventBus
}

func NewServer(apps *Catalog, store *Store, terminals *TerminalManager, bridge *AgentBridge, agents *AgentManager, host *AppHost, media *MediaService, updater ...*ServiceUpdater) *Server {
	server := &Server{apps: apps, store: store, terminals: terminals, bridge: bridge, agents: agents, host: host, media: media, bus: newEventBus()}
	if store != nil {
		server.worlds = NewWorldStore(store, media)
		server.fonts = NewFontService(store.root)
		server.fonts.loadCacheIndex()
	}
	if len(updater) > 0 {
		server.updater = updater[0]
	}
	if store != nil {
		server.skill = NewRecutSkillManager(store.root)
	}
	return server
}

func (s *Server) HTTPServer(address string) *http.Server {
	return s.httpServer(address, 30*time.Second)
}

func (s *Server) StreamHTTPServer(address string) *http.Server {
	// SSE/WebSocket 必须保持长连接；它们运行在独立端口，不能耗尽短请求连接池。
	return s.httpServer(address, 0)
}

func (s *Server) httpServer(address string, writeTimeout time.Duration) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		WriteTimeout:      writeTimeout,
	}
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
	mux.HandleFunc("GET /v1/skills/recut", s.recutSkillStatus)
	mux.HandleFunc("POST /v1/skills/recut/links", s.linkRecutSkill)
	mux.HandleFunc("GET /v1/skills", s.skillsStatus)
	mux.HandleFunc("POST /v1/skills/links", s.linkSkill)
	mux.HandleFunc("GET /v1/apps", s.listApps)
	mux.HandleFunc("GET /v1/apps/store", s.listAppStore)
	mux.HandleFunc("GET /v1/apps/installed", s.listAppInstallations)
	mux.HandleFunc("GET /v1/preferences", s.getPreferences)
	mux.HandleFunc("PUT /v1/preferences", s.putPreferences)
	mux.HandleFunc("GET /v1/apps/events", s.streamAppInstallationEvents)
	mux.HandleFunc("POST /v1/apps/install", s.installApp)
	mux.HandleFunc("POST /v1/apps/update", s.updateApps)
	mux.HandleFunc("POST /v1/apps/{package}/update", s.updateApp)
	mux.HandleFunc("GET /v1/apps/{appID}/workspace", s.getAppWorkspaceScope)
	mux.HandleFunc("GET /v1/apps/{appID}/files/{path...}", s.appStateFile)
	mux.HandleFunc("GET /v1/apps/{appID}/ui/{path...}", s.appUI)
	mux.HandleFunc("POST /v1/apps/{appID}/api/{name}", s.invokeAppStateAPI)
	mux.HandleFunc("GET /v1/projects", s.listProjects)
	mux.HandleFunc("POST /v1/projects", s.createProject)
	mux.HandleFunc("GET /v1/projects/{id}", s.getProject)
	mux.HandleFunc("PATCH /v1/projects/{id}", s.updateProject)
	mux.HandleFunc("DELETE /v1/projects/{id}", s.deleteProject)
	mux.HandleFunc("GET /v1/projects/{id}/artifacts", s.listArtifacts)
	mux.HandleFunc("GET /v1/projects/{id}/cover", s.projectCover)
	mux.HandleFunc("GET /v1/projects/{projectID}/world-context", s.getProjectWorldContext)
	mux.HandleFunc("PUT /v1/projects/{projectID}/world-context", s.putProjectWorldContext)
	mux.HandleFunc("GET /v1/worlds", s.listWorlds)
	mux.HandleFunc("POST /v1/worlds", s.createWorld)
	mux.HandleFunc("GET /v1/worlds/{worldID}", s.getWorld)
	mux.HandleFunc("PATCH /v1/worlds/{worldID}", s.updateWorld)
	mux.HandleFunc("GET /v1/worlds/{worldID}/entities", s.listWorldEntities)
	mux.HandleFunc("POST /v1/worlds/{worldID}/entities", s.createWorldEntity)
	mux.HandleFunc("GET /v1/worlds/{worldID}/entities/{entityID}", s.getWorldEntity)
	mux.HandleFunc("PATCH /v1/worlds/{worldID}/entities/{entityID}", s.updateWorldEntity)
	mux.HandleFunc("GET /v1/worlds/{worldID}/evidence", s.listWorldEvidence)
	mux.HandleFunc("POST /v1/worlds/{worldID}/evidence", s.attachWorldEvidence)
	mux.HandleFunc("PATCH /v1/worlds/{worldID}/evidence/{evidenceID}", s.updateWorldEvidence)
	mux.HandleFunc("POST /v1/worlds/{worldID}/evidence/{evidenceID}/archive", s.archiveWorldEvidence)
	mux.HandleFunc("POST /v1/worlds/{worldID}/references", s.attachWorldReference)
	mux.HandleFunc("POST /v1/worlds/{worldID}/resolve", s.resolveWorld)
	mux.HandleFunc("GET /v1/media/models", s.listMediaModels)
	mux.HandleFunc("GET /v1/media/system-project", s.getMediaSystemProject)
	mux.HandleFunc("GET /v1/media/providers", s.listMediaProviders)
	mux.HandleFunc("GET /v1/media/configuration", s.listMediaConfiguration)
	mux.HandleFunc("GET /v1/media/credentials", s.listMediaCredentials)
	mux.HandleFunc("POST /v1/media/credentials", s.saveMediaCredential)
	mux.HandleFunc("DELETE /v1/media/credentials/{id}", s.deleteMediaCredential)
	mux.HandleFunc("GET /v1/media/credentials/{id}/voices", s.listMediaVoices)
	mux.HandleFunc("GET /v1/media/routes", s.listMediaRoutes)
	mux.HandleFunc("POST /v1/media/routes", s.saveMediaRoute)
	mux.HandleFunc("GET /v1/media/events", s.streamMediaAssetEvents)
	mux.HandleFunc("GET /v1/media/assets", s.listMediaAssets)
	mux.HandleFunc("POST /v1/media/assets", s.importMediaAsset)
	mux.HandleFunc("GET /v1/media/assets/{id}", s.getMediaAsset)
	mux.HandleFunc("PATCH /v1/media/assets/{id}", s.updateMediaAsset)
	mux.HandleFunc("DELETE /v1/media/assets/{id}", s.deleteMediaAsset)
	mux.HandleFunc("GET /v1/media/assets/{id}/content", s.getMediaAssetContent)
	mux.HandleFunc("GET /v1/media/assets/{id}/parts/{part}", s.getMediaAssetPart)
	mux.HandleFunc("POST /v1/media/assets/{id}/attach", s.attachMediaAsset)
	mux.HandleFunc("POST /v1/media/jobs", s.createMediaJob)
	mux.HandleFunc("GET /v1/media/jobs/{id}", s.getMediaJob)
	mux.HandleFunc("GET /v1/fonts", s.listFonts)
	mux.HandleFunc("GET /v1/fonts/google/{id}/css", s.fontGoogleCSS)
	mux.HandleFunc("GET /v1/fonts/google/{id}/{file...}", s.fontGoogleFile)
	mux.HandleFunc("GET /v1/fonts/local", s.listLocalFonts)
	mux.HandleFunc("POST /v1/fonts/local", s.uploadLocalFont)
	mux.HandleFunc("GET /v1/fonts/local/{id}/content", s.localFontFile)
	mux.HandleFunc("DELETE /v1/fonts/local/{id}", s.deleteLocalFont)
	mux.HandleFunc("POST /v1/projects/{id}/apps/{appID}/api/{name}", s.invokeAppAPI)
	mux.HandleFunc("GET /v1/projects/{id}/apps/{appID}/files/{path...}", s.appFile)
	mux.HandleFunc("GET /v1/events", s.realtimeWS)
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
	mux.HandleFunc("GET /v1/agent-sessions/{id}/cli-stream", s.streamAgentCLI)
	mux.HandleFunc("GET /v1/mcp", s.mcpHTTP)
	mux.HandleFunc("POST /v1/mcp", s.mcpHTTP)
	mux.HandleFunc("GET /v1/mcp/tools", s.mcpTools)
	mux.HandleFunc("GET /v1/device-tokens", s.listDeviceTokens)
	mux.HandleFunc("POST /v1/device-tokens", s.createDeviceToken)
	mux.HandleFunc("DELETE /v1/device-tokens/{id}", s.revokeDeviceToken)
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
		// 面板只需可用性；定位缓存只验证路径，完整多 shell 扫描仅由诊断页触发。
		process, available := s.store.agentCommands.Available(agents[index].Command)
		agents[index].Available = available
		if agents[index].Available {
			log.Printf("INFO agent CLI available command=%s path=%q", agents[index].Command, process.Path)
		} else {
			log.Printf("WARN agent CLI unavailable command=%s", agents[index].Command)
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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
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
	if origin == "https://recut.video" || origin == "https://www.recut.video" || origin == "https://app.recut.video" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return false
	}
	if parsed.Hostname() == "localhost" || strings.HasSuffix(parsed.Hostname(), ".localhost") {
		return true
	}
	address, err := netip.ParseAddr(parsed.Hostname())
	return err == nil && (address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast())
}

func (s *Server) listApps(w http.ResponseWriter, r *http.Request) {
	apps, err := s.apps.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	locale := DetectLocale(r)
	for index := range apps {
		apps[index].Manifest = apps[index].Manifest.LocalizedFor(locale)
	}
	writeJSON(w, http.StatusOK, apps)
}

func (s *Server) listAppStore(w http.ResponseWriter, r *http.Request) {
	apps, err := s.store.AppStoreFor(DetectLocale(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, apps)
}

func (s *Server) listAppInstallations(w http.ResponseWriter, r *http.Request) {
	installations, err := s.apps.Installations()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	// 与 GET /v1/apps 同口径：按 Accept-Language 本地化每个安装的 manifest（名称/描述/onboarding）。
	locale := DetectLocale(r)
	for index := range installations {
		installations[index].Manifest = installations[index].Manifest.LocalizedFor(locale)
	}
	writeJSON(w, http.StatusOK, installations)
}

// streamAppInstallationEvents tells the workspace when a background Git fetch
// has refreshed the installation snapshot. The browser then performs one
// normal directory read; this stream carries no duplicated installation state.
func (s *Server) streamAppInstallationEvents(w http.ResponseWriter, r *http.Request) {
	if s.apps == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("App catalog is unavailable"))
		return
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
	version, changes := s.apps.installationChangeSnapshot()
	if !writeAppInstallationSSE(w, "event: app.installations.updated\ndata: {}\n\n") {
		return
	}
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-changes:
			nextVersion, nextChanges := s.apps.installationChangeSnapshot()
			changes = nextChanges
			if nextVersion == version {
				continue
			}
			version = nextVersion
			if !writeAppInstallationSSE(w, "event: app.installations.updated\ndata: {}\n\n") {
				return
			}
			flusher.Flush()
		}
	}
}

func writeAppInstallationSSE(w io.Writer, value string) bool {
	_, err := io.WriteString(w, value)
	return err == nil
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

func (s *Server) updateApps(w http.ResponseWriter, _ *http.Request) {
	result, err := s.apps.UpdateInstallations()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	for _, app := range result.Updated {
		log.Printf("INFO app updated id=%s package=%s revision=%s", app.Manifest.ID, app.Package, app.Revision)
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) getAppWorkspaceScope(w http.ResponseWriter, r *http.Request) {
	appID := strings.TrimSpace(r.PathValue("appID"))
	app, ok := s.apps.Get(appID)
	if !ok || app.Manifest.Kind != StandaloneApp {
		writeError(w, http.StatusNotFound, errors.New("standalone app is unavailable"))
		return
	}
	if _, err := s.store.AppStateDatabase(appID); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	app.Manifest = app.Manifest.LocalizedFor(DetectLocale(r))
	writeJSON(w, http.StatusOK, map[string]any{
		"id":            appID,
		"name":          app.Manifest.Name,
		"appId":         appID,
		"appVersion":    app.Manifest.Version,
		"formatVersion": formatVersion,
		"kind":          "appstate",
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

func (s *Server) updateProject(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Name string `json:"name"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	project, err := s.store.Rename(strings.TrimSpace(r.PathValue("id")), input.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Delete(strings.TrimSpace(r.PathValue("id"))); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listArtifacts(w http.ResponseWriter, r *http.Request) {
	artifacts, err := s.store.ListArtifacts(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, artifacts)
}

// projectCover serves the current project cover. File-based covers (source
// "file") are read from the project files root with a no-cache policy because
// the editor refreshes the first-frame cover frequently; asset-based covers
// redirect to the immutable media content URL.
func (s *Server) projectCover(w http.ResponseWriter, r *http.Request) {
	project, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("project not found"))
		return
	}
	if project.Cover == nil {
		writeError(w, http.StatusNotFound, errors.New("project has no cover"))
		return
	}
	if project.Cover.Source == "file" {
		root, err := s.store.ProjectFilesRoot(project.ID)
		if err != nil {
			writeError(w, http.StatusNotFound, errors.New("project files root is unavailable"))
			return
		}
		path, ok := sandboxPath(root, project.Cover.FilePath)
		if !ok {
			writeError(w, http.StatusBadRequest, errors.New("invalid cover file path"))
			return
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			writeError(w, http.StatusNotFound, errors.New("cover file not found"))
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		if project.Cover.MimeType != "" {
			w.Header().Set("Content-Type", project.Cover.MimeType)
		}
		http.ServeFile(w, r, path)
		return
	}
	if project.Cover.AssetID == "" {
		writeError(w, http.StatusNotFound, errors.New("project cover is unavailable"))
		return
	}
	http.Redirect(w, r, "/v1/media/assets/"+url.PathEscape(project.Cover.AssetID)+"/content", http.StatusFound)
}

func (s *Server) invokeAppAPI(w http.ResponseWriter, r *http.Request) {
	input := map[string]any{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	projectID := r.PathValue("id")
	appID := r.PathValue("appID")
	target := Target{ProjectID: projectID, AppID: appID}
	result, err := s.host.InvokeAPILocale(target, appID, r.PathValue("name"), input, DetectLocale(r))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// invokeAppStateAPI routes standalone App operations to the App's global
// appstate target. Standalone Apps own no Project, so the target is the App
// itself and ctx.project is null inside their background.js.
func (s *Server) invokeAppStateAPI(w http.ResponseWriter, r *http.Request) {
	appID := strings.TrimSpace(r.PathValue("appID"))
	app, ok := s.apps.Get(appID)
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("app is unavailable"))
		return
	}
	if app.Manifest.Kind != StandaloneApp {
		writeError(w, http.StatusBadRequest, errors.New("project apps require a project target"))
		return
	}
	input := map[string]any{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	result, err := s.host.InvokeAPILocale(Target{AppID: appID}, appID, r.PathValue("name"), input, DetectLocale(r))
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
	root, err := s.store.ProjectFilesRoot(projectID)
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("App workspace not found"))
		return
	}
	s.serveSandboxedFile(w, r, root)
}

func (s *Server) appStateFile(w http.ResponseWriter, r *http.Request) {
	appID := r.PathValue("appID")
	app, ok := s.apps.Get(appID)
	if !ok || !hasPermission(app.Manifest, "files") {
		writeError(w, http.StatusNotFound, errors.New("App file not found"))
		return
	}
	root, err := s.store.AppStateFilesRoot(appID)
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("App workspace not found"))
		return
	}
	s.serveSandboxedFile(w, r, root)
}

func (s *Server) serveSandboxedFile(w http.ResponseWriter, r *http.Request, root string) {
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

type startTerminalInput struct {
	ProjectID string   `json:"projectId"`
	Command   string   `json:"command"`
	Args      []string `json:"args"`
	CWD       string   `json:"cwd"`
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
	cwd, sessionDir := s.store.projectsDir(), s.store.TerminalSessionsDir()
	if projectID != "" {
		if _, err := s.store.Get(projectID); err != nil {
			writeError(w, http.StatusNotFound, errors.New("project not found"))
			return
		}
		cwd = s.store.projectDir(projectID)
		if input.CWD != "" {
			filesRoot, err := s.store.ProjectFilesRoot(projectID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			cwd, err = terminalWorkingDirectory(filesRoot, input.CWD)
			if err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
		}
	} else if input.CWD != "" {
		writeError(w, http.StatusBadRequest, errors.New("terminal cwd requires a project"))
		return
	}
	args := input.Args
	start := TerminalStart{ProjectID: projectID, Command: input.Command, Args: args, CWD: cwd, SessionDir: sessionDir, Cols: input.Cols, Rows: input.Rows, Env: []string{"TERM=xterm-256color", "COLORTERM=truecolor"}}
	if (input.Command == "codex" || input.Command == "claude") && len(args) == 0 {
		agentSession, token, err := s.bridge.CreateSession(SessionContext{})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		workspace := s.bridge.WorkspaceDir(agentSession)
		start.Env = []string{"RECUT_AGENT_SESSION=" + agentSession.ID, "RECUT_AGENT_TOKEN=" + token}
		start.ManagedBy = "recut-bridge"
		start.InitialInput = launchPrompt(agentSession) + "\n"
		start.CWD = workspace
		start.SessionDir = s.store.TerminalSessionsDir()
		executable, err := os.Executable()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if input.Command == "codex" {
			workspace, err = s.bridge.MaterializeCodexWorkspace(agentSession, token, executable)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			start.Env = nil
			start.CWD = workspace
			start.Args = []string{"exec"}
		} else {
			profile, err := s.bridge.WriteClaudeProfile(agentSession, executable)
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

// terminalWorkingDirectory resolves an API-provided project-relative directory.
// It deliberately permits normal shell navigation after launch, while preventing
// an embedded App from using the session-start API to escape its own file root.
func terminalWorkingDirectory(filesRoot, relative string) (string, error) {
	if filepath.IsAbs(relative) {
		return "", errors.New("terminal cwd must be relative to project files")
	}
	clean := filepath.Clean(relative)
	if clean == "." {
		return filesRoot, nil
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("terminal cwd must stay within project files")
	}
	root, err := filepath.EvalSymlinks(filesRoot)
	if err != nil {
		return "", fmt.Errorf("resolve project files: %w", err)
	}
	candidate, err := filepath.EvalSymlinks(filepath.Join(root, clean))
	if err != nil {
		return "", fmt.Errorf("resolve terminal cwd: %w", err)
	}
	relation, err := filepath.Rel(root, candidate)
	if err != nil || relation == ".." || strings.HasPrefix(relation, ".."+string(filepath.Separator)) {
		return "", errors.New("terminal cwd must stay within project files")
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("terminal cwd must be a directory")
	}
	return candidate, nil
}

func launchPrompt(session AgentSession) string {
	return fmt.Sprintf("You are attached to Recut App Agent Bridge session %s. %s", session.ID, bridgeInstructions)
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
