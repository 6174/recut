/*
 * [INPUT]: 依赖 Zustand、Recut service 的 Agent 运行时、模型、引导与会话列表 HTTP API
 * [OUTPUT]: 对外提供按 service endpoint 去重的 Agent 共享快照、按 scope 缓存的会话列表、当前会话与详情快照及写操作后的局部回写
 * [POS]: web/lib 的 Agent 服务端数据唯一缓存；组件拥有 SSE 连接但将增量回写此处，路由切换不重复读取已有对话
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";

import type { AgentRuntimeStatus } from "@/components/agent-install-guide";
import type { Detail, OpencodeModel, Session } from "@/components/agent-panel-types";

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
  activeSessionIDByScope: Record<string, string | null>;
  detailsBySessionID: Record<string, Detail>;
  detailStateBySessionID: Record<string, "idle" | "loading" | "ready" | "failed">;
  loadRuntimeStatus: (endpoint: string, force?: boolean) => Promise<AgentRuntimeStatus[] | null>;
  loadOpencodeModels: (endpoint: string, force?: boolean) => Promise<OpencodeModel[]>;
  loadOnboarding: (endpoint: string, scope: string, force?: boolean) => Promise<AgentGuide[]>;
  saveGlobalOnboarding: (endpoint: string, items: AgentGuide[]) => Promise<void>;
  loadSessions: (endpoint: string, scope: string, force?: boolean) => Promise<Session[]>;
  upsertSession: (endpoint: string, scope: string, session: Session) => void;
  setActiveSession: (endpoint: string, scope: string, sessionID: string | null) => void;
  loadSessionDetail: (endpoint: string, sessionID: string, force?: boolean) => Promise<Detail>;
  upsertSessionDetail: (endpoint: string, detail: Detail) => void;
};

const requests = new Map<string, Promise<unknown>>();

// Scope strings classify a conversation's current workspace context for
// history filtering and onboarding. They are not session identity: sessions are
// unbound and can travel across scopes.
export function agentScopeKey(projectID: string | null) {
  if (projectID === "media") return "media";
  return projectID ? `project:${projectID}` : "general";
}

export const mediaScopeKey = "media";
export function appScopeKey(appID: string) {
  return `app:${appID}`;
}

// scopeContext maps a scope string to the session workspace context hint sent
// when creating a session. Only project scopes carry a real Project ID.
export function scopeContext(scope: string): { projectId?: string; appId?: string; appView?: string } {
  if (scope.startsWith("project:")) return { projectId: scope.slice("project:".length) };
  if (scope === "media") return { appId: "recut.media-library", appView: "media" };
  if (scope.startsWith("app:")) return { appId: scope.slice("app:".length), appView: "standalone" };
  return {};
}

// sessionHistoryLabel gives a human label for a scope's conversation history.
export function sessionHistoryLabel(scope: string) {
  if (scope === "general") return "通用对话历史";
  if (scope === "media") return "素材库会话历史";
  if (scope.startsWith("app:")) return "此 App 的会话历史";
  if (scope.startsWith("project:")) return "此项目的会话历史";
  return "会话历史";
}

function scopeQuery(scope: string) {
  if (scope === "general") return "scope=general";
  if (scope === "media") return "scope=media";
  if (scope.startsWith("app:")) return `scope=${encodeURIComponent(scope)}`;
  if (scope.startsWith("project:")) return `projectId=${encodeURIComponent(scope.slice("project:".length))}`;
  return "";
}

function sessionURL(endpoint: string, scope: string) {
  return `${endpoint}/v1/agent-sessions?${scopeQuery(scope)}`;
}

function requestOnce<T>(key: string, request: () => Promise<T>) {
  const current = requests.get(key) as Promise<T> | undefined;
  if (current) return current;
  const pending = request().finally(() => requests.delete(key));
  requests.set(key, pending);
  return pending;
}

function emptyAgentSnapshot(endpoint: string) {
  return {
    endpoint,
    runtimeStatus: null,
    opencodeModels: null,
    onboardingByScope: {},
    sessionsByScope: {},
    activeSessionIDByScope: {},
    detailsBySessionID: {},
    detailStateBySessionID: {},
  };
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  endpoint: null,
  runtimeStatus: null,
  opencodeModels: null,
  onboardingByScope: {},
  sessionsByScope: {},
  activeSessionIDByScope: {},
  detailsBySessionID: {},
  detailStateBySessionID: {},
  loadRuntimeStatus: async (endpoint, force = false) => {
    if (get().endpoint !== endpoint) set(emptyAgentSnapshot(endpoint));
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
    if (get().endpoint !== endpoint) set(emptyAgentSnapshot(endpoint));
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
    if (get().endpoint !== endpoint) set(emptyAgentSnapshot(endpoint));
    const cached = get().onboardingByScope[scope];
    if (!force && cached) return cached;
    return requestOnce(`${endpoint}:onboarding:${scope}`, async () => {
      const query = scopeQuery(scope);
      const response = await fetch(`${endpoint}/v1/agent-onboarding${query ? `?${query}` : ""}`);
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
    if (get().endpoint !== endpoint) set(emptyAgentSnapshot(endpoint));
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
  setActiveSession: (endpoint, scope, sessionID) => {
    if (get().endpoint !== endpoint) return;
    set((state) => ({ activeSessionIDByScope: { ...state.activeSessionIDByScope, [scope]: sessionID } }));
  },
  loadSessionDetail: async (endpoint, sessionID, force = false) => {
    if (get().endpoint !== endpoint) set(emptyAgentSnapshot(endpoint));
    const cached = get().detailsBySessionID[sessionID];
    if (!force && cached) return cached;
    set((state) => ({ detailStateBySessionID: { ...state.detailStateBySessionID, [sessionID]: "loading" } }));
    return requestOnce(`${endpoint}:session:${sessionID}`, async () => {
      try {
        const response = await fetch(`${endpoint}/v1/agent-sessions/${sessionID}`);
        if (!response.ok) throw new Error("无法读取对话");
        const detail = await response.json() as Detail;
        if (get().endpoint === endpoint) {
          set((state) => ({
            detailsBySessionID: { ...state.detailsBySessionID, [sessionID]: detail },
            detailStateBySessionID: { ...state.detailStateBySessionID, [sessionID]: "ready" },
          }));
        }
        return detail;
      } catch (cause) {
        if (get().endpoint === endpoint) {
          set((state) => ({ detailStateBySessionID: { ...state.detailStateBySessionID, [sessionID]: "failed" } }));
        }
        throw cause;
      }
    });
  },
  upsertSessionDetail: (endpoint, detail) => {
    if (get().endpoint !== endpoint) return;
    set((state) => ({
      detailsBySessionID: { ...state.detailsBySessionID, [detail.id]: detail },
      detailStateBySessionID: { ...state.detailStateBySessionID, [detail.id]: "ready" },
    }));
  },
}));
