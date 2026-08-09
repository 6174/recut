/*
 * [INPUT]: 依赖 MCP Host 的 handleMCP、AgentBridge 会话鉴权与标准库 HTTP JSON-RPC 协议
 * [OUTPUT]: 对外提供 loopback MCP HTTP 入口（唯一常驻 MCP Host）、设备 token 生命周期管理 API 与只读的按全局/App 分组的 MCP 工具清单（GET /v1/mcp/tools）；会话身份经 X-Recut-Session/X-Recut-Token header 透传，缺失时以匿名会话兜底
 * [POS]: service 的传输边界；所有 stdio Agent 都经无状态 --mcp 转发器接入本端点，工具执行与长驻任务状态全部由常驻 daemon 统一管理
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

func (s *Server) mcpHTTP(w http.ResponseWriter, r *http.Request) {
	if !isLocalNetworkRequest(r) {
		writeError(w, http.StatusForbidden, errors.New("MCP HTTP is available only from the local network"))
		return
	}
	// 会话身份优先：--mcp 转发器带 RECUT_AGENT_SESSION/RECUT_AGENT_TOKEN 时
	// 还原真实 Agent 会话（驱动会话工作区与 skills/import 工具）；外部接入
	// 未携带会话时以匿名会话执行平台工具与显式 target 的 App 操作。
	session := AgentSession{ID: "anonymous"}
	if sessionID := r.Header.Get("X-Recut-Session"); sessionID != "" {
		authenticated, err := s.bridge.Authenticate(sessionID, r.Header.Get("X-Recut-Token"))
		if err != nil {
			writeError(w, http.StatusUnauthorized, err)
			return
		}
		session = authenticated
	}
	request := mcpRequest{}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON-RPC request"))
		return
	}
	result, callErr := handleMCP(s.bridge, s.host, s.media, session, request)
	response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(request.ID)}
	if callErr != nil {
		response["error"] = map[string]any{"code": -32000, "message": callErr.Error()}
	} else {
		response["result"] = result
	}
	writeJSON(w, http.StatusOK, response)
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
