/*
 * [INPUT]: 依赖 AgentBridge 的通用 job 生命周期与 App 提供的 run 闭包。
 * [OUTPUT]: 平台通用的"受限子 Agent job"生命周期；状态、进度、取消与诊断查询，经 recut.job.* 暴露。
 * [POS]: service 的通用子 Agent 任务控制面；只编排执行，不读写时间线、不解析模型 JSON。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"errors"
	"time"
)

// AgentJob 是一次受限子 Agent 运行的通用生命周期对象。run 由 App 适配器（background 声明的 subAgent op）提供，
// 平台只负责排队、运行、状态、取消与诊断查询。
type AgentJob struct {
	ID        string
	Target    Target
	Status    string
	Phase     string
	Result    any
	Error     string
	CreatedAt time.Time
	UpdatedAt time.Time
	cancel    context.CancelFunc
	done      chan struct{}
	run       func(ctx context.Context) (any, error)
}

func (b *AgentBridge) startAgentJob(target Target, run func(ctx context.Context) (any, error)) (*AgentJob, error) {
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
	go b.runAgentJob(ctx, job)
	return job, nil
}

func (b *AgentBridge) runAgentJob(ctx context.Context, job *AgentJob) {
	b.updateAgentJob(job.ID, "running", "authoring", nil, "")
	result, err := job.run(ctx)
	if err != nil {
		status := "failed"
		if errors.Is(ctx.Err(), context.Canceled) {
			status = "cancelled"
		}
		b.updateAgentJob(job.ID, status, "complete", nil, err.Error())
		close(job.done)
		return
	}
	b.updateAgentJob(job.ID, "completed", "complete", result, "")
	close(job.done)
}

func (b *AgentBridge) updateAgentJob(id, status, phase string, result any, message string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	job := b.agentJobs[id]
	if job == nil {
		return
	}
	job.Status, job.Phase, job.UpdatedAt = status, phase, time.Now().UTC()
	if result != nil {
		job.Result = result
	}
	job.Error = message
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
	return map[string]any{
		"id": job.ID, "kind": "sub-agent", "status": job.Status, "phase": job.Phase,
		"result": job.Result, "error": job.Error, "createdAt": job.CreatedAt, "updatedAt": job.UpdatedAt,
	}, true
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

func (b *AgentBridge) waitAgentJob(id string, timeout time.Duration) (map[string]any, bool) {
	job, ok := b.agentJob(id)
	if !ok {
		return nil, false
	}
	view, _ := b.agentJobView(id)
	if view["status"] == "queued" || view["status"] == "running" {
		select {
		case <-job.done:
		case <-time.After(timeout):
		}
	}
	return b.agentJobView(id)
}
