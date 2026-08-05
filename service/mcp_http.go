/*
 * [INPUT]: 依赖 MCP Host 的 handleMCP、Store 的设备 token 与标准库 HTTP JSON-RPC 协议
 * [OUTPUT]: 对外提供 loopback MCP HTTP 入口（Bearer 设备 token 鉴权）与设备 token 生命周期管理 API
 * [POS]: service 的外部 Agent 传输边界；外部调用无 Recut 内部会话，平台工具可用，App 操作落到显式 target 或 appstate
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

func (s *Server) mcpHTTP(w http.ResponseWriter, r *http.Request) {
	if !isLocalNetworkRequest(r) {
		writeError(w, http.StatusForbidden, errors.New("MCP HTTP is available only from the local network"))
		return
	}
	token, err := s.store.AuthenticateDeviceToken(bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	request := mcpRequest{}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON-RPC request"))
		return
	}
	session := AgentSession{ID: "device:" + token.ID}
	result, callErr := handleMCP(s.bridge, s.host, s.media, session, request)
	response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(request.ID)}
	if callErr != nil {
		response["error"] = map[string]any{"code": -32000, "message": callErr.Error()}
	} else {
		response["result"] = result
	}
	writeJSON(w, http.StatusOK, response)
}

func bearerToken(r *http.Request) string {
	authorization := r.Header.Get("Authorization")
	if strings.HasPrefix(authorization, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
	}
	return ""
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
