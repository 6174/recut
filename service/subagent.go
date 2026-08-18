/*
 * [INPUT]: 依赖 AgentBridge 的受限会话、Codex CLI 与通用工具调用收集。
 * [OUTPUT]: 平台通用的"受限子 Agent"执行器；由 App（background）声明上下文与受限工具范围，平台只负责运行。
 * [POS]: service 的通用子 Agent runner；App 无关，不解析模型 JSON，不触碰时间线。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// SubAgentRequest 描述一次受限子 Agent 运行所需的上下文与工具范围。
// AllowedTools / Prompt / Focused 均由 App（background）动态声明；Focused 是不透明聚焦上下文，
// 平台只透传、不理解其内部字段（如 editor 的 componentId/mode 由 editor 的 component.commit 消费）。
type SubAgentRequest struct {
	// AllowedTools 是子 Agent 唯一可用的受限工具面（App 声明）。
	AllowedTools []string
	// Prompt 是子 Agent 的上下文/任务提示（App 声明）。
	Prompt string
	// Focused 是 App 声明的聚焦上下文（不透明 map），随受限工具调用一并注入 session。
	Focused map[string]any
	// Model / ReasoningEffort 可选覆盖；缺省继承父会话。
	Model          string
	ReasoningEffort string
	// Timeout 可选；缺省使用全局默认。
	Timeout time.Duration
}

const defaultSubAgentTimeout = 90 * time.Second
const subAgentDiagnosticLimit = 32 << 10
const defaultSubAgentModel = "gpt-5.6-terra"
const defaultSubAgentEffort = "medium"

type subAgentDiagnosticTail struct {
	mu   sync.Mutex
	data []byte
}

func (t *subAgentDiagnosticTail) Write(chunk []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.data = append(t.data, chunk...)
	if len(t.data) > subAgentDiagnosticLimit {
		t.data = append([]byte(nil), t.data[len(t.data)-subAgentDiagnosticLimit:]...)
	}
	return len(chunk), nil
}

func (t *subAgentDiagnosticTail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.data)
}

// runFocusedSubAgent 在只读 sandbox 中以受限工具面运行一个同模型子 Agent，
// 返回它发起的全部受限工具调用的结构化结果（App 无关，结果按工具名收集）。
// 子 Agent 会话与通用 Agent 会话同构：落 agent_sessions 账本（受限工具面标记）、stdout 事件流解析后
// 写入 agent_events（审计），仅执行形态是一次性的（受限只读 CLI 进程）。
// 模型与推理参数继承调用方会话（运行时无关），由子 Agent CLI 校验；不假设父会话是哪种 agent。
func runFocusedSubAgent(ctx context.Context, bridge *AgentBridge, host *AppHost, session AgentSession, target Target, req SubAgentRequest, jobID string) ([]agentToolCall, error) {
	model := req.Model
	effort := req.ReasoningEffort
	if model == "" {
		model = session.Model
	}
	if model == "" {
		model = defaultSubAgentModel
	}
	if effort == "" {
		effort = session.ReasoningEffort
	}
	if effort == "" {
		effort = defaultSubAgentEffort
	}
	child, token, err := bridge.CreateSession(SessionContext{
		TaskID:          session.TaskID,
		Runtime:         session.Runtime,
		Model:           model,
		ReasoningEffort: effort,
		AllowedTools:    append([]string(nil), req.AllowedTools...),
		Target:          target,
		Focused:         req.Focused,
	})
	if err != nil {
		return nil, err
	}
	workspace := bridge.WorkspaceDir(child)
	defer os.RemoveAll(filepath.Dir(workspace))
	// 持久化子 Agent 会话行（审计链 parent -> job -> child），并把 job 关联到 child。
	var childSessionID string
	if bridge.agents != nil {
		codexModel, reasoningEffort, opencodeModel := "", "", ""
		if session.Runtime == "codex" {
			codexModel, reasoningEffort = model, effort
		} else if session.Runtime == "opencode" {
			opencodeModel = model
		}
		title := "子 Agent 任务"
		if job, ok := bridge.agentJob(jobID); ok && job.Operation != "" {
			title = "子 Agent · " + job.Operation
		}
		if persisted, createErr := bridge.agents.CreateChildSession(session.ID, jobID, session.Runtime, codexModel, reasoningEffort, opencodeModel, title, req.AllowedTools); createErr == nil {
			childSessionID = persisted.ID
			bridge.setAgentJobChild(jobID, childSessionID)
		} else {
			log.Printf("WARN subagent child session persistence failed job_id=%s: %v", jobID, createErr)
		}
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = defaultSubAgentTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	commands := newAgentCommandResolver(bridge.store.root)

	var cmd *exec.Cmd
	var stdout, stderr io.ReadCloser
	switch session.Runtime {
	case "opencode":
		cmd, stdout, stderr, err = runOpencodeSubAgent(ctx, commands, bridge, child, token, executable, workspace, model, req.Prompt)
	case "codex":
		cmd, stdout, stderr, err = runCodexSubAgent(ctx, commands, bridge, child, token, executable, workspace, model, effort, req.Prompt)
	default:
		return nil, fmt.Errorf("sub-agent runtime %q is not supported", session.Runtime)
	}
	if err != nil {
		return nil, err
	}
	var streams sync.WaitGroup
	var stdoutTail, stderrTail subAgentDiagnosticTail
	streams.Add(2)
	go func() { defer streams.Done(); scanSubagentEvents(bridge, childSessionID, session.Runtime, stdout, &stdoutTail) }()
	go func() { defer streams.Done(); _, _ = io.Copy(io.MultiWriter(io.Discard, &stderrTail), stderr) }()
	err = cmd.Wait()
	_ = stdout.Close()
	_ = stderr.Close()
	streams.Wait()
	if err != nil {
		diagnostic := stderrTail.String()
		if diagnostic == "" {
			diagnostic = stdoutTail.String()
		}
		if diagnostic != "" {
			return nil, fmt.Errorf("sub-agent did not finish: %w: %s", err, diagnostic)
		}
		return nil, fmt.Errorf("sub-agent did not finish: %w", err)
	}
	calls, ok := bridge.AgentToolCalls(child.ID)
	if !ok || len(calls) == 0 {
		return nil, errors.New("sub-agent finished without calling any restricted tool")
	}
	return calls, nil
}

// scanSubagentEvents 把子 Agent CLI 的 JSON 事件流逐行解析并写入子会话的 agent_events 账本，
// 与父会话（runCodex / runOpencode 的 scanner 模式）同构；stdout 同时保留为诊断 tail。
func scanSubagentEvents(bridge *AgentBridge, childSessionID, runtime string, stdout io.Reader, tail *subAgentDiagnosticTail) {
	if bridge == nil || bridge.agents == nil || childSessionID == "" {
		_, _ = io.Copy(io.MultiWriter(io.Discard, tail), stdout)
		return
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		_, _ = tail.Write(line)
		_, _ = tail.Write([]byte("\n"))
		var raw map[string]any
		if json.Unmarshal(line, &raw) != nil {
			continue
		}
		switch runtime {
		case "codex":
			_ = bridge.agents.handleCodexEvent(childSessionID, "", raw)
		case "opencode":
			bridge.agents.handleOpencodeEvent(childSessionID, "", raw)
		}
	}
}

// runCodexSubAgent 组装 codex CLI 子 Agent 命令（受限工具面由 ComponentAuthorMCPOverrides 注入）。
func runCodexSubAgent(ctx context.Context, commands *AgentCommandResolver, bridge *AgentBridge, child AgentSession, token, executable, workspace, model, effort, prompt string) (*exec.Cmd, io.ReadCloser, io.ReadCloser, error) {
	args := []string{
		"exec", "--skip-git-repo-check", "--ignore-rules",
		"-s", "read-only", "--model", model,
		"--config", fmt.Sprintf("model_reasoning_effort=%q", effort),
	}
	args = append(args, bridge.ComponentAuthorMCPOverrides(child, token, executable)...)
	args = append(args, "--json", "--", prompt)
	cmd, stdout, stderr, err := commands.Start(ctx, "codex", args, workspace, nil)
	if err != nil {
		return nil, nil, nil, agentCLIUnavailableError("Codex", "codex")
	}
	return cmd, stdout, stderr, nil
}

// runOpencodeSubAgent 组装 opencode CLI 子 Agent 命令（opencode run）。
// opencode 用工作区的 opencode.json 接入 MCP；会话 AllowedTools 已在平台侧把工具面缩到受限集合，
// 子 Agent 即便连上 full recut server 也只能调用允许的工具。
func runOpencodeSubAgent(ctx context.Context, commands *AgentCommandResolver, bridge *AgentBridge, child AgentSession, token, executable, workspace, model, prompt string) (*exec.Cmd, io.ReadCloser, io.ReadCloser, error) {
	dir, err := bridge.WriteOpencodeWorkspaceTo(workspace, child, token, executable)
	if err != nil {
		return nil, nil, nil, err
	}
	args := []string{"run", prompt, "--format", "json", "--print-logs", "--auto", "--dir", dir, "--model", model}
	cmd, stdout, stderr, err := commands.Start(ctx, "opencode", args, workspace, nil)
	if err != nil {
		return nil, nil, nil, agentCLIUnavailableError("OpenCode", "opencode")
	}
	return cmd, stdout, stderr, nil
}

// startAppSubAgentJob 是 mcp.go 应用操作分发的通用入口：对 manifest 标记 subAgent 的 op，
// 启动一个通用受限子 Agent job（authorize → run → finalize），返回可经 recut.job.* 观察的 job。
func startAppSubAgentJob(bridge *AgentBridge, host *AppHost, session AgentSession, target Target, appID, operation string, payload map[string]any, locale Locale) (map[string]any, error) {
	if host == nil {
		return nil, errors.New("sub-agent host is unavailable")
	}
	if !target.IsProject() {
		return nil, errors.New("sub-agent requires a project target")
	}
	run := func(ctx context.Context, jobID string) (any, error) {
		return runDeclaredSubAgent(ctx, bridge, host, session, target, appID, operation, payload, locale, jobID)
	}
	job, err := bridge.startAgentJob(target, run)
	if err != nil {
		return nil, err
	}
	bridge.setAgentJobMeta(job.ID, appID, operation, session.ID)
	bridge.registerSubagentToolCall(session.ID, job.ID, appID, operation)
	view, ok := bridge.agentJobView(job.ID)
	if !ok {
		return nil, errors.New("sub-agent job view unavailable")
	}
	return view, nil
}

// agentRunMCPTool 是平台通用 recut.agent.run 工具：任一 App 都能以
// "background 声明 SubAgentRequest + 平台通用 runner 执行" 的方式运行受限子 Agent。
// 输入 { app, operation, payload, target? }；返回一个可经 recut.job.* 观察的子 Agent job。
func agentRunMCPTool(bridge *AgentBridge, host *AppHost, session AgentSession, arguments map[string]any, locale Locale) (any, error) {
	appID, _ := arguments["app"].(string)
	operation, _ := arguments["operation"].(string)
	appID = trim(appID)
	operation = trim(operation)
	if appID == "" || operation == "" {
		return nil, errors.New("recut.agent.run: app and operation are required")
	}
	if _, ok := bridge.store.catalog.Get(appID); !ok {
		return nil, fmt.Errorf("app %q is unavailable", appID)
	}
	payload, _ := arguments["payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	target := Target{AppID: appID}
	if pid := explicitProjectID(arguments); pid != "" {
		if err := bridge.store.projectOwnedBy(pid, appID); err != nil {
			return nil, fmt.Errorf("invalid target %q: %w", pid, err)
		}
		target = Target{ProjectID: pid, AppID: appID}
	}
	view, err := startAppSubAgentJob(bridge, host, session, target, appID, operation, payload, locale)
	if err != nil {
		return nil, err
	}
	data, _ := json.Marshal(view)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": view}, nil
}

// runDeclaredSubAgent 执行一个由 background 动态声明请求的受限子 Agent，分三阶段：
// 1) authorize：调 background operation 取 SubAgentRequest（上下文+工具范围由 background 声明）；
// 2) run：用平台通用 runner 执行（持久化子会话 + 事件落账本），收集受限工具调用；
// 3) finalize：把工具调用结果回传同一 operation（subAgentTools），由 background 产出最终结果。
// 每个阶段边界显式更新 job phase（authorizing → running → finalizing → complete）。
func runDeclaredSubAgent(ctx context.Context, bridge *AgentBridge, host *AppHost, session AgentSession, target Target, appID, operation string, payload map[string]any, locale Locale, jobID string) (any, error) {
	// 在 job goroutine 内尽早登记 meta，避免与调用方 setAgentJobMeta 竞态导致早期事件缺 appId/operation。
	bridge.setAgentJobMeta(jobID, appID, operation, session.ID)
	setPhase := func(phase string) { bridge.setAgentJobPhase(jobID, phase) }
	setPhase("authorizing")
	raw, err := host.InvokeAPILocale(target, appID, operation, payload, locale)
	if err != nil {
		return nil, fmt.Errorf("%s failed: %w", operation, err)
	}
	req, ok := subAgentRequestFrom(raw)
	if !ok {
		return nil, fmt.Errorf("%s did not return a subAgent request", operation)
	}
	calls, err := runFocusedSubAgent(ctx, bridge, host, session, target, req, jobID)
	if err != nil {
		return nil, err
	}
	setPhase("finalizing")
	tools := make([]map[string]any, 0, len(calls))
	for _, call := range calls {
		tools = append(tools, map[string]any{"name": call.Name, "result": call.Result})
	}
	finalInput := map[string]any{}
	for k, v := range payload {
		finalInput[k] = v
	}
	finalInput["subAgentTools"] = tools
	return host.InvokeAPILocale(target, appID, operation, finalInput, locale)
}

// subAgentRequestFrom 从 background 返回中解析 SubAgentRequest；非 subAgent 响应返回 ok=false。
func subAgentRequestFrom(result any) (SubAgentRequest, bool) {
	requestMap, _ := result.(map[string]any)
	subAgentRaw, _ := requestMap["subAgent"].(map[string]any)
	if subAgentRaw == nil {
		return SubAgentRequest{}, false
	}
	req := SubAgentRequest{
		AllowedTools:    toStringSlice(subAgentRaw["allowedTools"]),
		Prompt:          trim(toString(subAgentRaw["prompt"])),
		Focused:         toAnyMap(subAgentRaw["focused"]),
		Model:           trim(toString(subAgentRaw["model"])),
		ReasoningEffort: trim(toString(subAgentRaw["reasoningEffort"])),
	}
	if len(req.AllowedTools) == 0 || req.Prompt == "" {
		return SubAgentRequest{}, false
	}
	return req, true
}

func toAnyMap(value any) map[string]any {
	m, _ := value.(map[string]any)
	return m
}

func toStringSlice(value any) []string {
	raw, _ := value.([]any)
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

func trim(s string) string { return strings.TrimSpace(s) }

func toString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
