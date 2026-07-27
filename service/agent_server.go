/*
 * [INPUT]: 依赖 AgentManager 的本地持久化会话和 HTTP SSE 传输能力
 * [OUTPUT]: 对外提供 Agent Session 创建、查询、含图片资产引用的发送、停止与事件订阅 HTTP API
 * [POS]: service 的结构化对话传输边界；与 terminal HTTP API 并存且互不代理
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Server) listAgentSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.agents.List(strings.TrimSpace(r.URL.Query().Get("projectId")))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) createAgentSession(w http.ResponseWriter, r *http.Request) {
	input := struct {
		ProjectID       string `json:"projectId"`
		Runtime         string `json:"runtime"`
		CodexModel      string `json:"codexModel"`
		ReasoningEffort string `json:"reasoningEffort"`
	}{}
	if json.NewDecoder(r.Body).Decode(&input) != nil || strings.TrimSpace(input.ProjectID) == "" {
		writeError(w, http.StatusBadRequest, errors.New("projectId is required"))
		return
	}
	if input.Runtime == "" {
		input.Runtime = "codex"
	}
	session, err := s.agents.Create(strings.TrimSpace(input.ProjectID), input.Runtime, strings.TrimSpace(input.CodexModel), strings.TrimSpace(input.ReasoningEffort))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) getAgentSession(w http.ResponseWriter, r *http.Request) {
	detail, err := s.agents.Detail(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("agent session not found"))
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) startAgentTurn(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Content  string   `json:"content"`
		AssetIDs []string `json:"assetIds"`
	}{}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	turn, err := s.agents.StartTurn(r.PathValue("id"), input.Content, input.AssetIDs)
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
	if _, err := s.agents.Detail(r.PathValue("id")); err != nil {
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
	ticker := time.NewTicker(250 * time.Millisecond)
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
		case <-ticker.C:
		}
	}
}
