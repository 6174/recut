/*
 * [INPUT]: 依赖 Zustand、Recut service 的 Agent 运行时、模型、引导与会话列表 HTTP API
 * [OUTPUT]: 对外提供按 service endpoint 去重的 Agent 共享快照、按 scope 缓存的会话列表及写操作后的局部回写
 * [POS]: web/lib 的 Agent 元数据唯一缓存；对话详情仍由组件持有的 SSE 维护，路由切换不重复读取低频快照
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";

import type { AgentRuntimeStatus } from "@/components/agent-install-guide";
import type { OpencodeModel, Session } from "@/components/agent-panel-types";

export type AgentGuide = {
  id: string;
  title: string;
  description: string;
  prompt: string;
};

type AgentStore = {
  endpoint: string | null;
  runtimeStatus: AgentRuntimeStatus[] | null;
  opencodeModels: OpencodeModel[] | null;
  onboardingByScope: Record<string, AgentGuide[]>;
  sessionsByScope: Record<string, Session[]>;
  loadRuntimeStatus: (endpoint: string, force?: boolean) => Promise<AgentRuntimeStatus[] | null>;
  loadOpencodeModels: (endpoint: string, force?: boolean) => Promise<OpencodeModel[]>;
  loadOnboarding: (endpoint: string, scope: string, force?: boolean) => Promise<AgentGuide[]>;
  saveGlobalOnboarding: (endpoint: string, items: AgentGuide[]) => Promise<void>;
  loadSessions: (endpoint: string, scope: string, force?: boolean) => Promise<Session[]>;
  upsertSession: (endpoint: string, scope: string, session: Session) => void;
};

const requests = new Map<string, Promise<unknown>>();

export function agentScopeKey(projectID: string | null) {
  return projectID ? `project:${projectID}` : "general";
}

function sessionURL(endpoint: string, scope: string) {
  const query = scope === "general" ? "scope=general" : `projectId=${encodeURIComponent(scope.slice("project:".length))}`;
  return `${endpoint}/v1/agent-sessions?${query}`;
}

function requestOnce<T>(key: string, request: () => Promise<T>) {
  const current = requests.get(key) as Promise<T> | undefined;
  if (current) return current;
  const pending = request().finally(() => requests.delete(key));
  requests.set(key, pending);
  return pending;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  endpoint: null,
  runtimeStatus: null,
  opencodeModels: null,
  onboardingByScope: {},
  sessionsByScope: {},
  loadRuntimeStatus: async (endpoint, force = false) => {
    if (get().endpoint !== endpoint) set({ endpoint, runtimeStatus: null, opencodeModels: null, onboardingByScope: {}, sessionsByScope: {} });
    const cached = get().runtimeStatus;
    if (!force && cached) return cached;
    return requestOnce(`${endpoint}:agents`, async () => {
      const response = await fetch(`${endpoint}/v1/agents`);
      if (!response.ok) return null;
      const runtimeStatus = await response.json() as AgentRuntimeStatus[];
      if (get().endpoint === endpoint) set({ runtimeStatus });
      return runtimeStatus;
    });
  },
  loadOpencodeModels: async (endpoint, force = false) => {
    if (get().endpoint !== endpoint) set({ endpoint, runtimeStatus: null, opencodeModels: null, onboardingByScope: {}, sessionsByScope: {} });
    const cached = get().opencodeModels;
    if (!force && cached) return cached;
    return requestOnce(`${endpoint}:opencode-models`, async () => {
      const response = await fetch(`${endpoint}/v1/agents/opencode/models`);
      if (!response.ok) return [];
      const opencodeModels = await response.json() as OpencodeModel[];
      if (get().endpoint === endpoint) set({ opencodeModels });
      return opencodeModels;
    });
  },
  loadOnboarding: async (endpoint, scope, force = false) => {
    if (get().endpoint !== endpoint) set({ endpoint, runtimeStatus: null, opencodeModels: null, onboardingByScope: {}, sessionsByScope: {} });
    const cached = get().onboardingByScope[scope];
    if (!force && cached) return cached;
    return requestOnce(`${endpoint}:onboarding:${scope}`, async () => {
      const query = scope === "general" ? "" : `?projectId=${encodeURIComponent(scope.slice("project:".length))}`;
      const response = await fetch(`${endpoint}/v1/agent-onboarding${query}`);
      if (!response.ok) return [];
      const payload = await response.json() as { items?: AgentGuide[] };
      const items = payload.items ?? [];
      if (get().endpoint === endpoint) set((state) => ({ onboardingByScope: { ...state.onboardingByScope, [scope]: items } }));
      return items;
    });
  },
  saveGlobalOnboarding: async (endpoint, items) => {
    const response = await fetch(`${endpoint}/v1/agent-onboarding`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    if (!response.ok) throw new Error("保存失败");
    if (get().endpoint === endpoint) set({ onboardingByScope: { general: items } });
  },
  loadSessions: async (endpoint, scope, force = false) => {
    if (get().endpoint !== endpoint) set({ endpoint, runtimeStatus: null, opencodeModels: null, onboardingByScope: {}, sessionsByScope: {} });
    const cached = get().sessionsByScope[scope];
    if (!force && cached) return cached;
    return requestOnce(`${endpoint}:sessions:${scope}`, async () => {
      const response = await fetch(sessionURL(endpoint, scope));
      if (!response.ok) throw new Error("无法读取会话列表");
      const sessions = await response.json() as Session[];
      if (get().endpoint === endpoint) set((state) => ({ sessionsByScope: { ...state.sessionsByScope, [scope]: sessions } }));
      return sessions;
    });
  },
  upsertSession: (endpoint, scope, session) => {
    if (get().endpoint !== endpoint) return;
    set((state) => ({ sessionsByScope: { ...state.sessionsByScope, [scope]: [session, ...(state.sessionsByScope[scope] ?? []).filter((item) => item.id !== session.id)] } }));
  },
}));
