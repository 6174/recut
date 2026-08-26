/*
 * [INPUT]: 依赖 MCP Host 的 handleMCP、AgentBridge 会话鉴权、Device Token 与标准库 HTTP JSON-RPC 协议
 * [OUTPUT]: 对外提供符合 Streamable HTTP 语义的唯一 loopback MCP 入口、设备 token 生命周期管理 API 与只读的按全局/App 分组的 MCP 工具清单（GET /v1/mcp/tools）；HTTP Agent 与无会话 stdio bridge 以 Bearer token 鉴权，会话 stdio bridge 以会话 header 透传身份
 * [POS]: service 的传输边界；Claude Code/OpenCode 直接连接本端点，Codex 与内置 Agent 经无状态 --mcp 适配器接入，工具执行与长驻任务状态全部由常驻 daemon 统一管理
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 *
 * 错误面架构（rfc/2026-08-19 P2）：mcpError 信封。业务/校验/冲突错误 = *mcpError 且 Kind ≠ transport，
 * 作为正常结果 {ok:false,...} 返回；只有传输/协议故障才以 JSON-RPC error 呈现。
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

// mcpError 是 MCP 边界的类型化错误信封（架构 P2：业务/校验/冲突/终态错误是"正常结果"，只有传输/协议
// 故障才以 JSON-RPC error 呈现）。App background 经 recut.error(payload) 声明业务错误，MCP 边界
// 统一翻译；消费方看 kind/code/hint 而非堆栈文本。
type mcpError struct {
	Kind      string `json:"kind"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Hint      string `json:"hint,omitempty"`
	Retryable bool   `json:"retryable,omitempty"`
	Data      any    `json:"data,omitempty"`
}

func (e *mcpError) Error() string { return e.Message }

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
		var env *mcpError
		if errors.As(callErr, &env) && env.Kind != "" && env.Kind != "transport" {
			// 业务/校验/终态错误是"正常完成的结果"：带 content（文本可读）+ structuredContent（程序可读）
			// + isError（平台 toolResultFailed 识别为失败），而非 JSON-RPC error 崩溃。
			envelope := map[string]any{
				"ok": false, "kind": env.Kind, "code": env.Code, "message": env.Message,
				"hint": env.Hint, "retryable": env.Retryable, "data": env.Data,
			}
			data, _ := json.Marshal(envelope)
			response["result"] = map[string]any{
				"content":           []map[string]string{{"type": "text", "text": string(data)}},
				"structuredContent": structuredMCPContent(envelope),
				"isError":           true,
			}
		} else {
			response["error"] = map[string]any{"code": -32000, "message": callErr.Error()}
		}
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
