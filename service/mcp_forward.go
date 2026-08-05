/*
 * [INPUT]: 依赖标准库 HTTP、JSON 与 IO；作为常驻 Daemon 的薄 stdio 转发器
 * [OUTPUT]: 对外提供 `recut mcp`：把外部 Agent（Codex/Claude Code/OpenCode）的 stdio JSON-RPC 转发到 Daemon 的 POST /v1/mcp
 * [POS]: service 的外部 Agent 接入点；不执行业务，只做带 Bearer 鉴权的协议转发
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
	"sync"
)

func RunMCPForward(target, token string, input io.Reader, output io.Writer) error {
	if token == "" {
		return errors.New("device token is required (recut agent link, then pass RECUT_DEVICE_TOKEN)")
	}
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
			response := forwardMCPRequest(target, token, request)
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

func forwardMCPRequest(target, token string, request mcpRequest) []byte {
	payload, err := json.Marshal(request)
	if err != nil {
		return errorResponse(request.ID, err)
	}
	httpRequest, err := http.NewRequest(http.MethodPost, target+"/v1/mcp", bytes.NewReader(payload))
	if err != nil {
		return errorResponse(request.ID, err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer "+token)
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
	return body
}

func errorResponse(id json.RawMessage, err error) []byte {
	response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(id), "error": map[string]any{"code": -32000, "message": err.Error()}}
	data, _ := json.Marshal(response)
	return data
}
