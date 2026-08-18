/*
 * [INPUT]: 依赖 realtime-channel 单例与子 Agent job 类型
 * [OUTPUT]: 页面级子 Agent job 状态单例：按 jobId 去重的 subagent channel 订阅（refcount）、
 *           实时帧应用到 job 快照并通知监听者；卡片与全局预览弹框共享同一快照，避免同一 job
 *           的重复订阅/退订在服务端互相截断
 * [POS]: web/lib 的子 Agent 状态边界；消费方只读快照，不直接碰 WS 订阅
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useReducer } from "react";

import type { SubagentJob } from "@/components/agent-panel-types";
import { getRealtimeChannel } from "@/lib/realtime-channel";

type Listener = (job: SubagentJob | null, available: boolean) => void;

type Entry = {
  jobId: string;
  apiBase: string;
  job: SubagentJob | null;
  available: boolean;
  refs: number;
  listeners: Set<Listener>;
  unsubscribe: (() => void) | null;
};

const entries = new Map<string, Entry>();

function notify(entry: Entry) {
  for (const listener of entry.listeners) listener(entry.job, entry.available);
}

function ensure(jobId: string, apiBase: string): Entry {
  let entry = entries.get(jobId);
  if (entry) {
    entry.refs += 1;
    return entry;
  }
  entry = {
    jobId,
    apiBase,
    job: null,
    available: true,
    refs: 1,
    listeners: new Set(),
    unsubscribe: null,
  };
  entries.set(jobId, entry);
  entry.unsubscribe = getRealtimeChannel(apiBase).subscribe("subagent", jobId, (frame) => {
    const data = frame.data as (Record<string, unknown> & { job?: SubagentJob; available?: boolean });
    if (data && "available" in data) {
      entry.available = false;
      notify(entry);
      return;
    }
    if (data && data.job) {
      entry.job = data.job;
      notify(entry);
    }
  });
  return entry;
}

function release(jobId: string) {
  const entry = entries.get(jobId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.unsubscribe?.();
  entries.delete(jobId);
}

/**
 * 用工具 output 解析出的初始 job 视图预置快照（仅当尚无快照时生效），
 * 让卡片无需等 WS 回放即可显示状态。
 */
export function seedSubagentJob(job: SubagentJob | null) {
  if (!job) return;
  const entry = entries.get(job.id);
  if (entry && !entry.job) entry.job = job;
}

/**
 * 订阅一个子 Agent job 的实时状态。调用方在组件卸载时自动退订；
 * 多个消费方（卡片 + 弹框）共享同一条底层 WS 订阅。
 */
export function useSubagentJob(jobId: string | undefined, apiBase: string) {
  const [, force] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (!jobId) return;
    const entry = ensure(jobId, apiBase);
    const listener: Listener = () => force();
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      release(jobId);
    };
  }, [jobId, apiBase]);
  if (!jobId) return { job: null, available: false };
  const entry = entries.get(jobId);
  return { job: entry?.job ?? null, available: entry?.available ?? false };
}
