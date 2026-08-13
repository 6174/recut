/*
 * [INPUT]: 依赖 Zustand 与 recut-worlds-client 的浏览器传输适配器
 * [OUTPUT]: 对外提供 Creation Worlds 的跨路由内存缓存：World 列表分页、World 详情、Entity 列表/详情快照、
 * 各自独立的读取状态与失败原因、请求去重与写操作后的显式失效刷新；禁止页面级轮询
 * [POS]: web/lib 的 Worlds 目录缓存；缓存键按 {endpoint, text, type, cursor} / {endpoint, worldId} /
 * {endpoint, worldId, kind, cursor} 划分，任何写或绑定成功后显式失效
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { createRecutWorldsClient, type EntityKind, type WorldDetail, type WorldEntity, type WorldEntitySummary, type WorldKind, type WorldSummary } from "./recut-worlds-client";

export type WorldsLoadState = "loading" | "ready" | "failed";

type WorldsStore = {
  endpoint: string | null;
  page: WorldSummary[];
  pageState: WorldsLoadState;
  pageError: string;
  detailsByID: Record<string, WorldDetail>;
  entitiesByKey: Record<string, WorldEntitySummary[]>;
  entityByKey: Record<string, WorldEntity>;
  loadPage: (endpoint: string, input?: { text?: string; type?: WorldKind; cursor?: string; limit?: number }, force?: boolean) => Promise<WorldSummary[]>;
  loadDetail: (endpoint: string, worldId: string, force?: boolean) => Promise<WorldDetail>;
  loadEntities: (endpoint: string, worldId: string, input?: { kind?: EntityKind; text?: string; cursor?: string; limit?: number }, force?: boolean) => Promise<WorldEntitySummary[]>;
  loadEntity: (endpoint: string, worldId: string, entityId: string, force?: boolean) => Promise<WorldEntity>;
  invalidate: (worldId?: string) => void;
};

const pageRequests = new Map<string, Promise<WorldSummary[]>>();
const detailRequests = new Map<string, Promise<WorldDetail>>();
const entitiesRequests = new Map<string, Promise<WorldEntitySummary[]>>();
const entityRequests = new Map<string, Promise<WorldEntity>>();

const pageKey = (input?: { text?: string; type?: WorldKind; cursor?: string; limit?: number }) => `${input?.text ?? ""}|${input?.type ?? ""}|${input?.cursor ?? ""}|${input?.limit ?? 50}`;
const entitiesKey = (input?: { kind?: EntityKind; text?: string; cursor?: string; limit?: number }) => `${input?.kind ?? ""}|${input?.text ?? ""}|${input?.cursor ?? ""}|${input?.limit ?? 50}`;

function emptyWorlds(endpoint: string) {
  return {
    endpoint,
    page: [],
    pageState: "loading" as const,
    pageError: "",
    detailsByID: {},
    entitiesByKey: {},
    entityByKey: {},
  };
}

export const useWorldsStore = create<WorldsStore>((set, get) => ({
  endpoint: null,
  page: [],
  pageState: "loading",
  pageError: "",
  detailsByID: {},
  entitiesByKey: {},
  entityByKey: {},
  loadPage: async (endpoint, input, force = false) => {
    if (get().endpoint !== endpoint) set(emptyWorlds(endpoint));
    const key = `${endpoint}:${pageKey(input)}`;
    if (!force && get().pageState === "ready" && key === `${get().endpoint}:${pageKey(input)}`) return get().page;
    const current = pageRequests.get(key);
    if (current) return current;
    const pending = (async () => {
      set({ pageState: "loading", pageError: "" });
      try {
        const page = await createRecutWorldsClient(endpoint).list(input);
        if (get().endpoint === endpoint) {
          set({ page: page.items, pageState: "ready" });
        }
        return page.items;
      } catch (cause) {
        if (get().endpoint === endpoint) {
          set({ pageState: "failed", pageError: messageOf(cause) });
        }
        return [];
      } finally {
        pageRequests.delete(key);
      }
    })();
    pageRequests.set(key, pending);
    return pending;
  },
  loadDetail: async (endpoint, worldId, force = false) => {
    if (get().endpoint !== endpoint) set(emptyWorlds(endpoint));
    const cached = get().detailsByID[worldId];
    if (!force && cached) return cached;
    const key = `${endpoint}:world:${worldId}`;
    const current = detailRequests.get(key);
    if (current) return current;
    const pending = (async () => {
      const detail = await createRecutWorldsClient(endpoint).get({ worldId });
      if (get().endpoint === endpoint) {
        set((state) => ({ detailsByID: { ...state.detailsByID, [worldId]: detail } }));
      }
      return detail;
    })().finally(() => detailRequests.delete(key));
    detailRequests.set(key, pending);
    return pending;
  },
  loadEntities: async (endpoint, worldId, input, force = false) => {
    if (get().endpoint !== endpoint) set(emptyWorlds(endpoint));
    const key = `${endpoint}:${worldId}:${entitiesKey(input)}`;
    const cached = get().entitiesByKey[key];
    if (!force && cached) return cached;
    const current = entitiesRequests.get(key);
    if (current) return current;
    const pending = (async () => {
      const page = await createRecutWorldsClient(endpoint).entities.list({ worldId, ...input });
      if (get().endpoint === endpoint) {
        set((state) => ({ entitiesByKey: { ...state.entitiesByKey, [key]: page.items } }));
      }
      return page.items;
    })().finally(() => entitiesRequests.delete(key));
    entitiesRequests.set(key, pending);
    return pending;
  },
  loadEntity: async (endpoint, worldId, entityId, force = false) => {
    if (get().endpoint !== endpoint) set(emptyWorlds(endpoint));
    const key = `${worldId}:${entityId}`;
    const cached = get().entityByKey[key];
    if (!force && cached) return cached;
    const current = entityRequests.get(key);
    if (current) return current;
    const pending = (async () => {
      const entity = await createRecutWorldsClient(endpoint).entities.get({ worldId, entityId });
      if (get().endpoint === endpoint) {
        set((state) => ({ entityByKey: { ...state.entityByKey, [key]: entity } }));
      }
      return entity;
    })().finally(() => entityRequests.delete(key));
    entityRequests.set(key, pending);
    return pending;
  },
  invalidate: (worldId) => {
    set((state) => {
      const detailsByID = worldId ? { ...state.detailsByID } : {};
      if (worldId) delete detailsByID[worldId];
      const entityByKey: Record<string, WorldEntity> = {};
      const entitiesByKey: Record<string, WorldEntitySummary[]> = {};
      for (const [key, value] of Object.entries(state.entityByKey)) {
        if (!worldId || key.startsWith(`${worldId}:`)) continue;
        entityByKey[key] = value;
      }
      const entityListPrefix = worldId && state.endpoint ? `${state.endpoint}:${worldId}:` : "";
      for (const [key, value] of Object.entries(state.entitiesByKey)) {
        if (entityListPrefix && key.startsWith(entityListPrefix)) continue;
        if (!entityListPrefix && !worldId) continue;
        entitiesByKey[key] = value;
      }
      return { page: [], pageState: "loading", pageError: "", detailsByID, entityByKey, entitiesByKey };
    });
  },
}));

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "服务未说明原因";
}
