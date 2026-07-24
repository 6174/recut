/*
 * [INPUT]: 依赖 AgentBridge 的会话鉴权、状态投影与命令事务，以及标准输入输出 JSON-RPC 流
 * [OUTPUT]: 对外提供 RunMCPStdio，暴露通用 App Agent Bridge MCP 工具集
 * [POS]: service 的 MCP 传输适配器；不包含任何 App 的业务语义
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

func RunMCPStdio(bridge *AgentBridge, input io.Reader, output io.Writer) error {
	session, err := bridge.Authenticate(os.Getenv("RECUT_AGENT_SESSION"), os.Getenv("RECUT_AGENT_TOKEN"))
	if err != nil {
		return err
	}
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	for scanner.Scan() {
		request := mcpRequest{}
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			continue
		}
		if len(request.ID) == 0 {
			continue
		}
		result, callErr := handleMCP(bridge, session, request)
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

func handleMCP(bridge *AgentBridge, session AgentSession, request mcpRequest) (any, error) {
	switch request.Method {
	case "initialize":
		return map[string]any{"protocolVersion": "2025-03-26", "serverInfo": map[string]string{"name": "recut-agent-bridge", "version": "0.1.0"}, "capabilities": map[string]any{"tools": map[string]any{}, "resources": map[string]any{}}}, nil
	case "resources/list":
		context, err := bridge.Context(session)
		if err != nil {
			return nil, err
		}
		return map[string]any{"resources": []map[string]any{{"uri": context.ResourceRef + "/context", "name": "Recut project context", "mimeType": "application/json"}}}, nil
	case "tools/list":
		return map[string]any{"tools": []map[string]any{
			{"name": "app.describe_capabilities", "description": "Describe the generic App Agent Bridge contract.", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
			{"name": "app.get_context", "description": "Read the current project summary, available state resources, and revision.", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
			{"name": "app.read_source_state", "description": "Read one declared App source-state resource by its relative path.", "inputSchema": map[string]any{"type": "object", "required": []string{"path"}, "properties": map[string]any{"path": map[string]string{"type": "string"}}}},
			{"name": "app.propose_command", "description": "Validate a replace_source_state command without changing application state.", "inputSchema": map[string]any{"type": "object", "required": []string{"name", "path", "value", "expectedRevision"}, "properties": map[string]any{"name": map[string]string{"type": "string"}, "path": map[string]string{"type": "string"}, "value": map[string]string{}, "expectedRevision": map[string]string{"type": "string"}}}},
			{"name": "app.commit_command", "description": "Commit a previously proposed command if the revision is still current.", "inputSchema": map[string]any{"type": "object", "required": []string{"proposalId", "expectedRevision"}, "properties": map[string]any{"proposalId": map[string]string{"type": "string"}, "expectedRevision": map[string]string{"type": "string"}}}},
			{"name": "app.undo_transaction", "description": "Undo one transaction from this agent session if the revision is still current.", "inputSchema": map[string]any{"type": "object", "required": []string{"transactionId", "expectedRevision"}, "properties": map[string]any{"transactionId": map[string]string{"type": "string"}, "expectedRevision": map[string]string{"type": "string"}}}},
		}}, nil
	case "tools/call":
		input := struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}{}
		if err := json.Unmarshal(request.Params, &input); err != nil {
			return nil, err
		}
		var result any
		var err error
		switch input.Name {
		case "app.describe_capabilities":
			result = map[string]any{"resources": []string{"project", "declared-source-state"}, "commands": []string{"replace_source_state"}, "workflow": []string{"get_context", "read_source_state", "propose_command", "commit_command", "undo_transaction"}, "instructions": bridgeInstructions}
		case "app.get_context":
			result, err = bridge.Context(session)
		case "app.read_source_state":
			result, err = bridge.ReadSourceState(session, stringArgument(input.Arguments, "path"))
		case "app.propose_command":
			result, err = bridge.Propose(session, stringArgument(input.Arguments, "name"), stringArgument(input.Arguments, "path"), stringArgument(input.Arguments, "expectedRevision"), input.Arguments["value"])
		case "app.commit_command":
			result, err = bridge.Commit(session, stringArgument(input.Arguments, "proposalId"), stringArgument(input.Arguments, "expectedRevision"))
		case "app.undo_transaction":
			result, err = bridge.Undo(session, stringArgument(input.Arguments, "transactionId"), stringArgument(input.Arguments, "expectedRevision"))
		default:
			err = fmt.Errorf("unknown tool %q", input.Name)
		}
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(result)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": result}, nil
	default:
		return nil, fmt.Errorf("unsupported MCP method %q", request.Method)
	}
}

func stringArgument(values map[string]any, name string) string {
	value, _ := values[name].(string)
	return value
}
