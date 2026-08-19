/*
 * [INPUT]: 依赖 AgentBridge 的通用 job 生命周期与 App 提供的 run 闭包。
 * [OUTPUT]: 平台通用的"受限子 Agent job"生命周期；状态、进度、取消与诊断查询，经 recut.job.* 暴露；
 *           每次状态/阶段变化都持久化为 agent_events 的 subagent.job 事件（审计）并实时扇出到
 *           subagent 流（ws subagent channel），子会话状态随 job 终态同步。
 * [POS]: service 的通用子 Agent 任务控制面；只编排执行，不读写时间线、不解析模型 JSON。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 *
 * 架构（rfc/2026-08-19）：job 携带工具调用账本（Calls，commit 发生时即追加）；终态含 interrupted
 *（子 Agent 被杀但 part 结果成功 finalize）；recut.job.wait 是受 agentJobWaitWindow 限定的短轮询。
 */
package main

import (
	"context"
	"errors"
	"time"
)

// AgentJob 是一次受限子 Agent 运行的通用生命周期对象。run 由 App 适配器（background 声明的 subAgent op）提供，
// 平台只负责排队、运行、状态、取消与诊断查询。job 的生命周期事件（status/phase 变化）既持久化为审计账本，
// 也经 subagent 流实时推送（ws subagent channel）。
type AgentJob struct {
	ID        string
	Target    Target
	Status    string
	Phase     string
	Result    any
	Error     string
	CreatedAt time.Time
	UpdatedAt time.Time
	// Meta 供审计链与前端卡片/预览展示（App/operation/父会话/子会话）。
	AppID           string
	Operation       string
	ParentSessionID string
	ChildSessionID  string
	// Calls 是子 Agent 会话内受限工具调用的结构化结果，发生时即追加（架构 P1 单一事实源：
	// 子 Agent 被杀也保留在 job 上，finalize 与失败摘要都从这里投影）。
	Calls  []agentToolCall
	cancel context.CancelFunc
	done   chan struct{}
	run    func(ctx context.Context, jobID string) (any, error)
}

func (b *AgentBridge) startAgentJob(target Target, run func(ctx context.Context, jobID string) (any, error)) (*AgentJob, error) {
	id, err := newID()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	now := time.Now().UTC()
	job := &AgentJob{ID: id, Target: target, Status: "queued", Phase: "queued", CreatedAt: now, UpdatedAt: now, cancel: cancel, done: make(chan struct{}), run: run}
	b.mu.Lock()
	b.agentJobs[id] = job
	b.mu.Unlock()
	b.beginSubagentStream(id)
	go b.runAgentJob(ctx, job)
	return job, nil
}

func (b *AgentBridge) runAgentJob(ctx context.Context, job *AgentJob) {
	b.updateAgentJob(job.ID, "running", "authoring", nil, "", "job.updated")
	result, err := job.run(ctx, job.ID)
	if err != nil {
		// 子 Agent 被杀但部分提交成功 finalize：落 interrupted 终态并携带部分结果（架构 P4：终态即结果）。
		var interrupted *subagentInterruptedError
		if errors.As(err, &interrupted) {
			b.updateAgentJob(job.ID, "interrupted", "complete", interrupted.Result, err.Error(), "job.interrupted")
			close(job.done)
			return
		}
		status, event := "failed", "job.failed"
		if errors.Is(ctx.Err(), context.Canceled) {
			status, event = "cancelled", "job.cancelled"
		}
		b.updateAgentJob(job.ID, status, "complete", nil, err.Error(), event)
		close(job.done)
		return
	}
	b.updateAgentJob(job.ID, "completed", "complete", result, "", "job.completed")
	close(job.done)
}

// recordAgentJobCall 把受限工具调用结果发生时即追加到 job（唯一被 child 引用、唯一最终 delivery 来源）。
func (b *AgentBridge) recordAgentJobCall(jobID string, call agentToolCall) {
	b.mu.Lock()
	if job := b.agentJobs[jobID]; job != nil {
		job.Calls = append(job.Calls, call)
	}
	b.mu.Unlock()
}

// agentJobByChild 由子会话 ID 反查 job（child session 是 job 的执行单元，1:1）。
func (b *AgentBridge) agentJobByChild(childSessionID string) (*AgentJob, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, job := range b.agentJobs {
		if job.ChildSessionID == childSessionID {
			return job, true
		}
	}
	return nil, false
}

// updateAgentJob 更新 job 状态/阶段并发布一条生命周期事件（审计账本 + subagent 流）。
// status 或 phase 为空串表示该项不变；event 缺省 job.updated。
func (b *AgentBridge) updateAgentJob(id, status, phase string, result any, message string, event string) {
	b.mu.Lock()
	job := b.agentJobs[id]
	if job == nil {
		b.mu.Unlock()
		return
	}
	if status != "" {
		job.Status = status
	}
	if phase != "" {
		job.Phase = phase
	}
	job.UpdatedAt = time.Now().UTC()
	if result != nil {
		job.Result = result
	}
	job.Error = message
	if event == "" {
		event = "job.updated"
	}
	view := b.agentJobViewLocked(job)
	childSessionID := job.ChildSessionID
	b.mu.Unlock()
	b.emitSubagentEvent(id, event, view)
	if status == "completed" || status == "failed" || status == "cancelled" {
		if b.agents != nil && childSessionID != "" {
			b.agents.UpdateChildSessionStatus(childSessionID, status)
		}
	}
}

// setAgentJobMeta 登记 job 的 App/operation/父会话关联（审计链），不触发事件（job 启动时写入）。
func (b *AgentBridge) setAgentJobMeta(id, appID, operation, parentSessionID string) {
	b.mu.Lock()
	if job := b.agentJobs[id]; job != nil {
		job.AppID, job.Operation, job.ParentSessionID = appID, operation, parentSessionID
	}
	b.mu.Unlock()
}

// setAgentJobPhase 更新 job 阶段并发布 job.updated。
func (b *AgentBridge) setAgentJobPhase(id, phase string) {
	b.updateAgentJob(id, "", phase, nil, "", "job.updated")
}

// setAgentJobChild 登记子 Agent 会话并推进到 running 阶段（子会话创建后调用）。
func (b *AgentBridge) setAgentJobChild(id, childSessionID string) {
	b.mu.Lock()
	if job := b.agentJobs[id]; job != nil {
		job.ChildSessionID = childSessionID
	}
	b.mu.Unlock()
	b.updateAgentJob(id, "", "running", nil, "", "job.updated")
}

func (b *AgentBridge) agentJob(id string) (*AgentJob, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	job, ok := b.agentJobs[id]
	return job, ok
}

func (b *AgentBridge) agentJobView(id string) (map[string]any, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	job, ok := b.agentJobs[id]
	if !ok {
		return nil, false
	}
	return b.agentJobViewLocked(job), true
}

// agentJobViewLocked 必须在持有 b.mu 时调用。
func (b *AgentBridge) agentJobViewLocked(job *AgentJob) map[string]any {
	view := map[string]any{
		"id":              job.ID,
		"kind":            "sub-agent",
		"status":          job.Status,
		"phase":           job.Phase,
		"result":          job.Result,
		"error":           job.Error,
		"createdAt":       iso(job.CreatedAt),
		"updatedAt":       iso(job.UpdatedAt),
		"appId":           job.AppID,
		"operation":       job.Operation,
		"parentSessionId": job.ParentSessionID,
		"childSessionId":  job.ChildSessionID,
		"elapsedMs":       time.Since(job.CreatedAt).Milliseconds(),
	}
	if len(job.Calls) > 0 {
		view["toolCalls"] = job.Calls
	}
	return view
}

func (b *AgentBridge) cancelAgentJob(id string) (map[string]any, bool) {
	b.mu.Lock()
	job, ok := b.agentJobs[id]
	status := ""
	if ok {
		status = job.Status
	}
	b.mu.Unlock()
	if !ok {
		return nil, false
	}
	if status == "queued" || status == "running" {
		job.cancel()
		return map[string]any{"jobId": id, "kind": "sub-agent", "cancelled": true}, true
	}
	return map[string]any{"jobId": id, "kind": "sub-agent", "cancelled": false, "status": status}, true
}

// agentJobWaitWindow 是 recut.job.wait 单次阻塞窗口。阻塞 HTTP 长轮询与 Streamable HTTP 传输不兼容
// （连接会在任务收尾/空闲期被断开，2026-08-19 会话与既有 trace-issues 均复现 EOF）；单次 ≤15s 即返回
// 当前状态，等待方轮询，连接永不长期占用（架构 P2：等待用事件/短轮询，不用阻塞长轮询）。
const agentJobWaitWindow = 15 * time.Second

func (b *AgentBridge) waitAgentJob(id string, timeout time.Duration) (map[string]any, bool) {
	job, ok := b.agentJob(id)
	if !ok {
		return nil, false
	}
	view, _ := b.agentJobView(id)
	if view["status"] == "queued" || view["status"] == "running" {
		wait := timeout
		if wait <= 0 || wait > agentJobWaitWindow {
			wait = agentJobWaitWindow
		}
		select {
		case <-job.done:
		case <-time.After(wait):
		}
	}
	return b.agentJobView(id)
}
