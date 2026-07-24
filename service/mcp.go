/*
 * [INPUT]: 依赖 AgentBridge 会话鉴权、AppHost JavaScript runtime 与标准输入输出 JSON-RPC 流
 * [OUTPUT]: 对外提供 RunMCPStdio，将平台上下文与 manifest.mcp.tools 映射为受控 MCP 工具
 * [POS]: service 的 MCP Host；App 不自行启动 MCP server，所有调用经平台权限与会话边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func RunMCPStdio(bridge *AgentBridge, host *AppHost, input io.Reader, output io.Writer) error {
	session, err := bridge.Authenticate(os.Getenv("RECUT_AGENT_SESSION"), os.Getenv("RECUT_AGENT_TOKEN"))
	if err != nil {
		return err
	}
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	for scanner.Scan() {
		request := mcpRequest{}
		if json.Unmarshal(scanner.Bytes(), &request) != nil || len(request.ID) == 0 {
			continue
		}
		result, callErr := handleMCP(bridge, host, session, request)
		response := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(request.ID)}
		if callErr != nil {
			response["error"] = map[string]any{"code": -32000, "message": callErr.Error()}
		} else {
			response["result"] = result
		}
		data, _ := json.Marshal(response)
		if _, err := fmt.Fprintln(output, string(data)); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func handleMCP(bridge *AgentBridge, host *AppHost, session AgentSession, request mcpRequest) (any, error) {
	project, err := bridge.store.Get(session.ProjectID)
	if err != nil {
		return nil, err
	}
	app, ok := bridge.store.catalog.Get(project.AppID)
	if !ok {
		return nil, fmt.Errorf("project App is unavailable")
	}
	switch request.Method {
	case "initialize":
		return map[string]any{"protocolVersion": "2025-03-26", "serverInfo": map[string]string{"name": "recut-mcp-host", "version": "0.2.0"}, "capabilities": map[string]any{"tools": map[string]any{}}}, nil
	case "tools/list":
		tools := make([]map[string]any, 0, len(app.Manifest.MCP.Tools)+1)
		tools = append(tools, map[string]any{
			"name":        "recut.project_context",
			"description": "读取当前 Recut 项目的身份、版本、App、可用 Artifact 与 Agent 约束。任何项目任务开始时先调用此工具。",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		})
		for _, tool := range app.Manifest.MCP.Tools {
			tools = append(tools, map[string]any{"name": app.Manifest.ID + "." + tool.Name, "description": tool.Description, "inputSchema": tool.InputSchema})
		}
		return map[string]any{"tools": tools}, nil
	case "tools/call":
		input := struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}{}
		if err := json.Unmarshal(request.Params, &input); err != nil {
			return nil, err
		}
		if input.Name == "recut.project_context" {
			return projectContextTool(bridge, session)
		}
		prefix := app.Manifest.ID + "."
		if len(input.Name) <= len(prefix) || input.Name[:len(prefix)] != prefix {
			return nil, fmt.Errorf("tool %q is outside the current App", input.Name)
		}
		result, err := host.InvokeMCP(project.ID, app.Manifest.ID, input.Name[len(prefix):], input.Arguments)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": result}, nil
	default:
		return nil, fmt.Errorf("unsupported MCP method %q", request.Method)
	}
}

func projectContextTool(bridge *AgentBridge, session AgentSession) (any, error) {
	context, err := bridge.Context(session)
	if err != nil {
		return nil, err
	}
	artifacts, err := bridge.store.ListArtifacts(session.ProjectID)
	if err != nil {
		return nil, err
	}
	result := map[string]any{
		"project":      context.Project,
		"resourceRef":  context.ResourceRef,
		"revision":     context.Revision,
		"appState":     context.AppState,
		"instructions": context.Instructions,
		"artifacts":    artifacts,
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": result}, nil
}
