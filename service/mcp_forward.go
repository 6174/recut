/*
 * [INPUT]: 依赖标准库 HTTP、JSON、IO 与 OS 环境；作为常驻 Daemon 的薄 stdio 转发器
 * [OUTPUT]: 对外提供 `recut-service --mcp`：把任意 stdio Agent（会话内 opencode/Codex/Claude 或外部 Codex）的 JSON-RPC 转发到 Daemon 的 POST /v1/mcp；补齐与 Host 一致的 MCP 协议版本，若进程携带 RECUT_AGENT_SESSION/RECUT_AGENT_TOKEN，则以会话身份 header 转发，daemon 侧据此解析真实会话
 * [POS]: service 的 Agent 传输边界；不执行业务，只做协议转发。短生命周期、无状态，启动不初始化 store 也不做任何状态收敛，因此不会干扰常驻 daemon 管理的长驻任务
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
)

func RunMCPForward(target string, input io.Reader, output io.Writer) error {
	sessionID := os.Getenv("RECUT_AGENT_SESSION")
	sessionToken := os.Getenv("RECUT_AGENT_TOKEN")
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	var calls sync.WaitGroup
	var outputMu sync.Mutex
	var outputErr error
	for scanner.Scan() {
		line := scanner.Bytes()
		request := mcpRequest{}
		if json.Unmarshal(line, &request) != nil || len(request.ID) == 0 {
			continue
		}
		calls.Add(1)
		go func(request mcpRequest) {
			defer calls.Done()
			response := forwardMCPRequest(target, sessionID, sessionToken, request)
			outputMu.Lock()
			defer outputMu.Unlock()
			if outputErr == nil {
				_, outputErr = fmt.Fprintln(output, string(response))
			}
		}(request)
	}
	calls.Wait()
	if err := scanner.Err(); err != nil {
		return err
	}
	return outputErr
}

func forwardMCPRequest(target, sessionID, sessionToken string, request mcpRequest) []byte {
	payload, err := json.Marshal(request)
	if err != nil {
		return errorResponse(request.ID, err)
	}
	httpRequest, err := http.NewRequest(http.MethodPost, target+"/v1/mcp", bytes.NewReader(payload))
	if err != nil {
		return errorResponse(request.ID, err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	// stdio MCP does not carry HTTP headers. The daemon's Streamable HTTP Host
	// correctly requires this header after initialization, so the adapter owns
	// the transport translation and always forwards its negotiated version.
	httpRequest.Header.Set("MCP-Protocol-Version", mcpProtocolVersion)
	if sessionID != "" {
		httpRequest.Header.Set("X-Recut-Session", sessionID)
		httpRequest.Header.Set("X-Recut-Token", sessionToken)
	}
	response, err := http.DefaultClient.Do(httpRequest)
	if err != nil {
		return errorResponse(request.ID, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return errorResponse(request.ID, err)
	}
	if response.StatusCode != http.StatusOK {
		return errorResponse(request.ID, errors.New(string(body)))
	}
	// Daemon 侧 writeJSON 用 json.Encoder.Encode，body 已带结尾换行；
	// 去掉尾部空白再交给 Fprintln，避免每个响应多打一个空行。
	return bytes.TrimRight(body, "\r\n")
}

func errorResponse(id json.RawMessage, err error) []byte {
	response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(id), "error": map[string]any{"code": -32000, "message": err.Error()}}
	data, _ := json.Marshal(response)
	return data
}
