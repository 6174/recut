/*
 * [INPUT]: 依赖 AgentManager 的本地持久化会话和 HTTP SSE 传输能力
 * [OUTPUT]: 对外提供通用 scope 的 Agent Session 创建、Codex 配置更新、OpenCode 实时模型目录（CLI 未安装时返回空目录）、按项目解析/全局保存 onboarding、查询、含图片资产引用与泛化消息上下文的发送、停止、结构化事件与仅内存 CLI 调试流订阅 HTTP API，并区分不存在和存储读取失败
 * [POS]: service 的结构化对话传输边界；与 terminal HTTP API 并存且互不代理
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Server) getAgentOnboarding(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("workspace storage is unavailable"))
		return
	}
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope == "media" || projectID == "media" {
		items, err := s.mediaOnboarding()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}
	if projectID == "" {
		items, err := s.store.GlobalOnboarding()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}
	items, err := s.store.Onboarding(projectID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) mediaOnboarding() ([]OnboardingGuide, error) {
	app := mediaSystemAppDescriptor()
	global, err := s.store.GlobalOnboarding()
	if err != nil {
		return nil, err
	}
	items := append(append([]OnboardingGuide{}, app.Manifest.Onboarding...), global...)
	return items, nil
}

func (s *Server) saveAgentOnboarding(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("workspace storage is unavailable"))
		return
	}
	input := struct {
		Items []OnboardingGuide `json:"items"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	if err := s.store.SaveGlobalOnboarding(input.Items); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": input.Items})
}

func (s *Server) listAgentSessions(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	sessions, err := s.agents.List(projectID, scope)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) listOpencodeModels(w http.ResponseWriter, r *http.Request) {
	// OpenCode is optional. Its absence is a normal capability state, not a
	// service failure; clients can use the empty directory to keep its picker
	// dormant while another runtime (for example Codex) remains usable.
	if _, available := s.store.agentCommands.Available("opencode"); !available {
		writeJSON(w, http.StatusOK, []OpencodeModel{})
		return
	}
	models, err := s.agents.cachedOpencodeModels(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	writeJSON(w, http.StatusOK, models)
}

func (s *Server) createAgentSession(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Runtime         string `json:"runtime"`
		CodexModel      string `json:"codexModel"`
		ReasoningEffort string `json:"reasoningEffort"`
		OpencodeModel   string `json:"opencodeModel"`
	}{}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	if input.Runtime == "" {
		input.Runtime = "codex"
	}
	session, err := s.agents.Create(input.Runtime, strings.TrimSpace(input.CodexModel), strings.TrimSpace(input.ReasoningEffort), strings.TrimSpace(input.OpencodeModel))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) getAgentSession(w http.ResponseWriter, r *http.Request) {
	detail, err := s.agents.Detail(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, errors.New("agent session not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) updateCodexConfiguration(w http.ResponseWriter, r *http.Request) {
	input := struct {
		CodexModel      string `json:"codexModel"`
		ReasoningEffort string `json:"reasoningEffort"`
	}{}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	session, err := s.agents.UpdateCodexConfiguration(r.PathValue("id"), strings.TrimSpace(input.CodexModel), strings.TrimSpace(input.ReasoningEffort))
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) updateOpencodeConfiguration(w http.ResponseWriter, r *http.Request) {
	input := struct {
		OpencodeModel string `json:"opencodeModel"`
	}{}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	session, err := s.agents.UpdateOpencodeConfiguration(r.PathValue("id"), strings.TrimSpace(input.OpencodeModel))
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) startAgentTurn(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Content  string        `json:"content"`
		AssetIDs []string      `json:"assetIds"`
		Contexts []TurnContext `json:"contexts"`
	}{}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	turn, err := s.agents.StartTurn(r.PathValue("id"), input.Content, input.AssetIDs, input.Contexts)
	if err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusCreated, turn)
}

func (s *Server) stopAgentTurn(w http.ResponseWriter, r *http.Request) {
	if err := s.agents.Stop(r.PathValue("id")); err != nil {
		writeError(w, http.StatusConflict, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) streamAgentEvents(w http.ResponseWriter, r *http.Request) {
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	exists, err := s.agents.SessionExists(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, errors.New("agent session not found"))
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming is unavailable"))
		return
	}
	ticker := time.NewTicker(changeHubPollInterval)
	defer ticker.Stop()
	for {
		events, err := s.agents.Events(r.PathValue("id"), after)
		if err != nil {
			return
		}
		for _, event := range events {
			data, _ := json.Marshal(event)
			if _, err := fmt.Fprintf(w, "id: %d\nevent: agent\ndata: %s\n\n", event.ID, data); err != nil {
				return
			}
			after = event.ID
		}
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-s.store.agentEvents.wait():
		case <-ticker.C:
		}
	}
}

// streamAgentCLI exposes the raw output owned by the currently running local
// CLI process. The manager deliberately keeps it in memory only; this endpoint
// is a live debugging surface, not a durable conversation archive.
func (s *Server) streamAgentCLI(w http.ResponseWriter, r *http.Request) {
	exists, err := s.agents.SessionExists(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, errors.New("agent session not found"))
		return
	}
	history, output, unsubscribe := s.agents.SubscribeCLIStream(r.PathValue("id"))
	defer unsubscribe()
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming is unavailable"))
		return
	}
	for _, entry := range history {
		data, _ := json.Marshal(entry)
		if _, err := fmt.Fprintf(w, "event: output\ndata: %s\n\n", data); err != nil {
			return
		}
	}
	if output == nil {
		_, _ = fmt.Fprint(w, "event: status\ndata: {\"available\":false}\n\n")
		flusher.Flush()
		return
	}
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case entry := <-output:
			data, _ := json.Marshal(entry)
			if _, err := fmt.Fprintf(w, "event: output\ndata: %s\n\n", data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
