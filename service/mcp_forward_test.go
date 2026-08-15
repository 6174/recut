/*
 * [INPUT]: 依赖 stdio JSON-RPC 请求、HTTP 测试服务与 mcpProtocolVersion 常量
 * [OUTPUT]: 验证 stdio 到 Streamable HTTP 适配器补齐 MCP 协议版本与会话身份 header
 * [POS]: service MCP 传输边界的回归测试；防止内置 Agent 因遗漏 HTTP-only 协议 header 而丢失全部 Recut 工具
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMCPForwardAddsProtocolAndSessionHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/mcp" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if version := request.Header.Get("MCP-Protocol-Version"); version != mcpProtocolVersion {
			t.Fatalf("protocol version = %q, want %q", version, mcpProtocolVersion)
		}
		if session := request.Header.Get("X-Recut-Session"); session != "session-1" {
			t.Fatalf("session header = %q", session)
		}
		if token := request.Header.Get("X-Recut-Token"); token != "token-1" {
			t.Fatalf("token header = %q", token)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}`))
	}))
	defer server.Close()

	response := string(forwardMCPRequest(server.URL, "session-1", "token-1", mcpRequest{ID: []byte("1"), Method: "tools/list", Params: []byte("{}")}))
	if !strings.Contains(response, `"tools":[]`) {
		t.Fatalf("forwarded response = %s", response)
	}
}
