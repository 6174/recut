/*
 * [INPUT]: 依赖 MCP Host 的 handleMCP、AgentBridge 会话鉴权、Device Token 与标准库 HTTP JSON-RPC 协议
 * [OUTPUT]: 对外提供符合 Streamable HTTP 语义的唯一 loopback MCP 入口、设备 token 生命周期管理 API 与只读的按全局/App 分组的 MCP 工具清单（GET /v1/mcp/tools）；全局 Agent 以 Bearer token 鉴权，stdio bridge 以会话 header 透传身份
 * [POS]: service 的传输边界；全局 Codex、Claude Code、OpenCode 直接连接本端点，内置 Agent 暂经无状态 --mcp 适配器接入，工具执行与长驻任务状态全部由常驻 daemon 统一管理
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const mcpProtocolVersion = "2025-03-26"

func (s *Server) mcpHTTP(w http.ResponseWriter, r *http.Request) {
	if !isLocalNetworkRequest(r) {
		writeError(w, http.StatusForbidden, errors.New("MCP HTTP is available only from the local network"))
		return
	}
	if r.Method == http.MethodGet {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, errors.New("Recut does not publish server-initiated MCP messages"))
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, errors.New("MCP endpoint accepts POST only"))
		return
	}
	if !acceptsMCPJSON(r.Header.Get("Accept")) {
		writeError(w, http.StatusNotAcceptable, errors.New("Accept must allow application/json or text/event-stream"))
		return
	}
	if contentType := r.Header.Get("Content-Type"); contentType != "" && !strings.HasPrefix(contentType, "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, errors.New("Content-Type must be application/json"))
		return
	}
	session, err := s.mcpSession(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	request := mcpRequest{}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON-RPC request"))
		return
	}
	if request.JSONRPC != "2.0" || strings.TrimSpace(request.Method) == "" {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON-RPC request"))
		return
	}
	if request.Method != "initialize" && r.Header.Get("MCP-Protocol-Version") != mcpProtocolVersion {
		writeError(w, http.StatusBadRequest, errors.New("MCP-Protocol-Version must be "+mcpProtocolVersion))
		return
	}
	result, callErr := handleMCP(s.bridge, s.host, s.media, session, request)
	if len(request.ID) == 0 || string(request.ID) == "null" {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(request.ID)}
	if callErr != nil {
		response["error"] = map[string]any{"code": -32000, "message": callErr.Error()}
	} else {
		response["result"] = result
	}
	w.Header().Set("MCP-Protocol-Version", mcpProtocolVersion)
	writeJSON(w, http.StatusOK, response)
}

func acceptsMCPJSON(accept string) bool {
	return accept == "" || strings.Contains(accept, "*/*") || strings.Contains(accept, "application/json") || strings.Contains(accept, "text/event-stream")
}

func (s *Server) mcpSession(r *http.Request) (AgentSession, error) {
	if sessionID := r.Header.Get("X-Recut-Session"); sessionID != "" {
		return s.bridge.Authenticate(sessionID, r.Header.Get("X-Recut-Token"))
	}
	secret := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if _, err := s.store.AuthenticateDeviceToken(secret); err != nil {
		return AgentSession{}, err
	}
	return AgentSession{ID: "external"}, nil
}

// mcpTools serves the settings panel's Recut MCP tab: the platform's global
// tools plus each installed App's MCP operations, grouped by owning App.
func (s *Server) mcpTools(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, mcpToolGroups(s.bridge))
}

func (s *Server) createDeviceToken(w http.ResponseWriter, r *http.Request) {
	input := struct {
		Scope []string `json:"scope"`
		TTL   int      `json:"ttlSeconds"`
	}{}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON body"))
		return
	}
	ttl := time.Duration(input.TTL) * time.Second
	if input.TTL > 0 && ttl > 365*24*time.Hour {
		ttl = 365 * 24 * time.Hour
	}
	token, secret, err := s.store.CreateDeviceToken(input.Scope, ttl)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "secret": secret, "note": "secret is shown once"})
}

func (s *Server) revokeDeviceToken(w http.ResponseWriter, r *http.Request) {
	if err := s.store.RevokeDeviceToken(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listDeviceTokens(w http.ResponseWriter, _ *http.Request) {
	tokens, err := s.store.ListDeviceTokens()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, tokens)
}
