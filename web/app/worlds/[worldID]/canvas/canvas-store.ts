/*
 * [INPUT]: 依赖 Zustand 与 recut-worlds-client（entities/canvas/relations/entityTypes 传输适配器）
 * [OUTPUT]: 对外提供 Recursive World Canvas 的单一数据源：会话配置（open）、当前上下文的实体/画布元素/关系/
 * 类型目录、视图状态（缩放/选中节点/连线草稿/对话框）与全部写动作；画布元素写 world_canvas 不产 revision，
 * 语义写（实体/关系/promote）产出 revision 并在 revision 冲突时刷新后重试一次；附几何工具函数与尺寸常量
 * [POS]: worlds/[worldID]/canvas 的 zustand 状态层；组件层只读 store 快照并触发动作，不各自持有画布数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import {
  createRecutWorldsClient,
  type EntityKind,
  type WorldCanvasElement,
  type WorldEntity,
  type WorldEntityRelation,
  type WorldEntityType,
  type WorldRelationType,
} from "@/lib/recut-worlds-client";

export type Point = { x: number; y: number };

// '' = 全局画布；否则为父实体 id（递归容器上下文）。
export type CanvasContext = { entityId: string; title: string } | null;

// 右侧详情面板的选中对象：World 核心节点、实体节点、语义关系边或自由画布元素。
export type CanvasSelection =
  | { type: "entity"; entity: WorldEntity }
  | { type: "world" }
  | { type: "relation"; relation: WorldEntityRelation }
  | { type: "canvas"; element: WorldCanvasElement; fromEntityId?: string; toEntityId?: string }
  | null;

export const DEFAULT_ENTITY_SIZE = { width: 200, height: 110 };
export const NOTE_SIZE = { width: 150, height: 100 };
export const WORLD_ELEMENT_ID = "shape:world";
export const WORLD_NODE_SIZE = { width: 260, height: 100 };

// 实体类型 → 卡片描边色；颜色只表达类型，不承载关系语义（RFC 视觉语言）。
export const typeColors: Record<string, string> = {
  character: "#e879f9",
  location: "#60a5fa",
  story: "#f59e0b",
  style: "#34d399",
  rule: "#a78bfa",
  reference: "#94a3b8",
};

export function gridPosition(index: number): Point {
  return { x: 40 + (Math.max(0, index) % 4) * 260, y: 40 + Math.floor(Math.max(0, index) / 4) * 180 };
}

// 画布元素位置：已持久化几何优先，否则按 gridPosition 兜底。
export function elementPosition(elements: WorldCanvasElement[], id: string, fallbackIndex = 0): Point {
  const element = elements.find((item) => item.id === id);
  const x = Number(element?.geometry?.x);
  const y = Number(element?.geometry?.y);
  if (element && Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return gridPosition(fallbackIndex);
}

export function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "画布操作失败";
}

function isRevisionConflict(cause: unknown) {
  return (cause as { code?: string } | null)?.code === "WORLD_REVISION_CONFLICT";
}

export type CanvasElementInput = {
  id: string;
  contextId: string;
  kind: string;
  refKind: string;
  refId: string;
  name: string;
  props: Record<string, unknown>;
  geometry: Record<string, unknown>;
  style: Record<string, unknown>;
  layer: string;
};

type WorldCanvasState = {
  apiBase: string;
  worldId: string;
  worldName: string;
  readOnly: boolean;
  revisionId: string;
  context: CanvasContext;
  entities: WorldEntity[];
  elements: WorldCanvasElement[];
  relations: WorldEntityRelation[];
  relationTypes: WorldRelationType[];
  entityTypes: WorldEntityType[];
  notice: string;
  zoom: number;
  selection: CanvasSelection;
  relatingFrom: string | null;
  relatingTo: string | null;
  creating: boolean;
  promotingId: string | null;
  dataVersion: number;
  pendingRelation: { fromEntityId: string; toEntityId: string; arrowCanvasId?: string } | null;
  open: (input: { apiBase: string; worldId: string; worldName: string; readOnly: boolean; revisionId: string }) => void;
  load: (force?: boolean) => Promise<void>;
  refreshRevision: () => Promise<void>;
  setContext: (context: CanvasContext) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  select: (selection: CanvasSelection) => void;
  startRelating: (entityId: string) => void;
  pickRelatingTarget: (entityId: string) => void;
  cancelRelating: () => void;
  moveElement: (id: string, x: number, y: number) => void;
  upsertElement: (input: CanvasElementInput) => Promise<WorldCanvasElement>;
  persistGeometry: (id: string, geometryOverride?: Record<string, unknown>, propsOverride?: Record<string, unknown>) => Promise<void>;
  createEntity: (kind: string, title: string) => Promise<void>;
  createChildEntity: (parentId: string, kind: string, title: string) => Promise<void>;
  addNote: () => Promise<void>;
  removeElement: (id: string) => Promise<void>;
  createRelation: (fromEntityId: string, toEntityId: string, relationType: string) => Promise<void>;
  removeRelation: (relationId: string) => Promise<void>;
  promote: (elementId: string, input?: { kind?: string; title?: string; relationType?: string }) => Promise<void>;
  setCreating: (creating: boolean) => void;
  setPromoting: (elementId: string | null) => void;
  setPendingRelation: (pendingRelation: { fromEntityId: string; toEntityId: string; arrowCanvasId?: string } | null) => void;
};

export const useWorldCanvasStore = create<WorldCanvasState>((set, get) => ({
  apiBase: "",
  worldId: "",
  worldName: "",
  readOnly: false,
  revisionId: "",
  context: null,
  entities: [],
  elements: [],
  relations: [],
  relationTypes: [],
  entityTypes: [],
  notice: "",
  zoom: 1,
  selection: null,
  relatingFrom: null,
  relatingTo: null,
  creating: false,
  promotingId: null,
  dataVersion: 0,
  pendingRelation: null,

  open: (input) => {
    const state = get();
    if (state.worldId === input.worldId && state.apiBase === input.apiBase && state.readOnly === input.readOnly) {
      set({ worldName: input.worldName });
      void get().load(true);
      return;
    }
    set({
      ...input,
      context: null,
      entities: [],
      elements: [],
      relations: [],
      relationTypes: [],
      entityTypes: [],
      notice: "",
      zoom: 1,
      selection: null,
      relatingFrom: null,
      relatingTo: null,
      creating: false,
      promotingId: null,
      pendingRelation: null,
    });
    void get().load(true);
  },

  load: async (force = false) => {
    const { apiBase, worldId } = get();
    if (!apiBase || !worldId) return;
    const contextId = get().context?.entityId ?? "";
    try {
      const client = createRecutWorldsClient(apiBase);
      const [entityList, canvas, entityTypeData] = await Promise.all([
        client.entities.list({ worldId, limit: 500, includeProvisional: true }),
        client.canvas.list({ worldId, contextId }),
        client.entityTypes.list({ worldId }),
      ]);
      const scope = entityList.items.filter((summary) => (contextId ? summary.parentId === contextId : !summary.parentId));
      const full = await Promise.all(scope.map((summary) => client.entities.get({ worldId, entityId: summary.id }).catch(() => null)));
      // 上下文已切换时丢弃过期响应。
      if (get().worldId !== worldId || (get().context?.entityId ?? "") !== contextId) return;
      const entities = full.filter((entity): entity is WorldEntity => entity !== null);
      const ids = new Set(entities.map((entity) => entity.id));
      const relations: WorldEntityRelation[] = [];
      for (const entity of entities) {
        for (const relation of entity.relations ?? []) {
          if (!relation.scopeEntityId || relation.scopeEntityId === contextId) relations.push(relation);
        }
      }
      set({
        entities,
        elements: canvas,
        relations: relations.filter((relation) => ids.has(relation.fromEntityId) && ids.has(relation.toEntityId)),
        relationTypes: entityTypeData.relations ?? [],
        entityTypes: entityTypeData.items ?? [],
        dataVersion: get().dataVersion + 1,
        ...(force ? { notice: "" } : {}),
      });
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  refreshRevision: async () => {
    const { apiBase, worldId } = get();
    if (!apiBase || !worldId) return;
    try {
      const detail = await createRecutWorldsClient(apiBase).get({ worldId });
      if (detail.revision?.id) set({ revisionId: detail.revision.id });
    } catch {
      // 保持当前 revisionId；下次写操作仍会走冲突重试。
    }
  },

  // 语义写统一约定：先按当前 revision 执行，冲突时 refreshRevision 后重试一次（见各写动作）。

  setContext: (context) => {
    set({ context, selection: null, relatingFrom: null, relatingTo: null });
    void get().load(true);
  },
  zoomIn: () => set((state) => ({ zoom: Math.min(2, state.zoom + 0.2) })),
  zoomOut: () => set((state) => ({ zoom: Math.max(0.4, state.zoom - 0.2) })),
  resetZoom: () => set({ zoom: 1 }),
  select: (selection) => set({ selection }),
  startRelating: (entityId) => set({ relatingFrom: entityId, relatingTo: null, selection: null }),
  pickRelatingTarget: (entityId) => {
    const { relatingFrom } = get();
    if (!relatingFrom || relatingFrom === entityId) return;
    set({ relatingTo: entityId });
  },
  cancelRelating: () => set({ relatingFrom: null, relatingTo: null }),

  moveElement: (id, x, y) =>
    set((state) => {
      if (!state.elements.some((element) => element.id === id)) {
        // 首次拖拽尚未持久化的元素（如 World 核心节点/实体投影）：先落一个本地影子元素。
        const isWorld = id === WORLD_ELEMENT_ID;
        const ghost: WorldCanvasElement = {
          id,
          worldId: state.worldId,
          contextId: "",
          kind: isWorld ? "world" : "entity",
          refKind: isWorld ? "" : "entity",
          refId: isWorld ? "" : id.replace(/^shape:/, ""),
          name: "",
          props: {},
          geometry: { x, y },
          style: {},
          layer: "0",
          createdAt: "",
          updatedAt: "",
        };
        return { elements: [...state.elements, ghost] };
      }
      return {
        elements: state.elements.map((element) =>
          element.id === id ? { ...element, geometry: { ...element.geometry, x, y } } : element,
        ),
      };
    }),

  upsertElement: async (input) => {
    const client = createRecutWorldsClient(get().apiBase);
    const saved = await client.canvas.upsert({ worldId: get().worldId, ...input });
    set((state) => ({ elements: [...state.elements.filter((element) => element.id !== saved.id), saved] }));
    return saved;
  },

  // 把画布元素（几何/属性覆盖后）写回 world_canvas；几何持久化与文本提交共用此路径。
  persistGeometry: async (id, geometryOverride, propsOverride) => {
    const element = get().elements.find((item) => item.id === id);
    if (!element) return;
    try {
      await get().upsertElement({
        id: element.id,
        contextId: element.contextId ?? "",
        kind: element.kind,
        refKind: element.refKind ?? "",
        refId: element.refId ?? "",
        name: element.name ?? "",
        props: { ...(element.props ?? {}), ...(propsOverride ?? {}) },
        geometry: { ...(element.geometry ?? {}), ...(geometryOverride ?? {}) },
        style: element.style ?? {},
        layer: element.layer ?? "0",
      });
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  createEntity: async (kind, title) => {
    const { apiBase, worldId } = get();
    const run = async (revisionId: string) => {
      const entity = await createRecutWorldsClient(apiBase).entities.upsert({
        worldId,
        kind: kind as EntityKind,
        title,
        content: {},
        expectedRevisionId: revisionId,
      });
      return entity;
    };
    try {
      const entity = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      const pos = gridPosition(get().elements.length);
      await get().upsertElement({
        id: `shape:${entity.id}`,
        contextId: get().context?.entityId ?? "",
        kind: "entity",
        refKind: "entity",
        refId: entity.id,
        name: entity.title,
        props: { collapsed: false },
        geometry: { ...pos, ...DEFAULT_ENTITY_SIZE, zIndex: 1 },
        style: {},
        layer: "0",
      });
      await get().load(true);
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  createChildEntity: async (parentId, kind, title) => {
    const { apiBase, worldId } = get();
    const run = async (revisionId: string) =>
      createRecutWorldsClient(apiBase).entities.children({
        worldId,
        entityId: parentId,
        kind: kind as EntityKind,
        title,
        content: {},
        expectedRevisionId: revisionId,
      });
    try {
      const child = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      await get().upsertElement({
        id: `shape:${child.id}`,
        contextId: parentId,
        kind: "entity",
        refKind: "entity",
        refId: child.id,
        name: child.title,
        props: { collapsed: false },
        geometry: { x: 40, y: 40, ...DEFAULT_ENTITY_SIZE, zIndex: 1 },
        style: {},
        layer: "0",
      });
      await get().load(true);
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  addNote: async () => {
    const id = `shape:note-${Date.now()}`;
    const pos = { x: 60 + (get().elements.length % 3) * 200, y: 60 + Math.floor(get().elements.length / 3) * 160 };
    try {
      await get().upsertElement({
        id,
        contextId: get().context?.entityId ?? "",
        kind: "note",
        refKind: "",
        refId: "",
        name: "便签",
        props: { text: "" },
        geometry: { ...pos, ...NOTE_SIZE, zIndex: 1 },
        style: { color: "#fde68a" },
        layer: "0",
      });
      await get().load(true);
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  removeElement: async (id) => {
    try {
      await createRecutWorldsClient(get().apiBase).canvas.remove({ worldId: get().worldId, elementId: id });
      set((state) => ({
        elements: state.elements.filter((element) => element.id !== id),
        selection:
          state.selection?.type === "entity" && id === `shape:${state.selection.entity.id}` ? null : state.selection,
      }));
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  createRelation: async (fromEntityId, toEntityId, relationType) => {
    const run = async (revisionId: string) =>
      createRecutWorldsClient(get().apiBase).relations.create({
        worldId: get().worldId,
        fromEntityId,
        toEntityId,
        relationType,
        scopeEntityId: get().context?.entityId || undefined,
        expectedRevisionId: revisionId,
      });
    try {
      await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      set({ relatingFrom: null, relatingTo: null, pendingRelation: null });
      await get().load(true);
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  removeRelation: async (relationId) => {
    const run = async (revisionId: string) =>
      createRecutWorldsClient(get().apiBase).relations.remove({
        worldId: get().worldId,
        relationId,
        expectedRevisionId: revisionId,
      });
    try {
      await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      await get().load(true);
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  promote: async (elementId, input = {}) => {
    const run = async (revisionId: string) =>
      createRecutWorldsClient(get().apiBase).canvas.promote({
        worldId: get().worldId,
        elementId,
        ...input,
        expectedRevisionId: revisionId,
      });
    try {
      await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      set({ promotingId: null });
      await get().load(true);
    } catch (cause) {
      set({ notice: messageOf(cause) });
    }
  },

  setCreating: (creating) => set({ creating }),
  setPromoting: (promotingId) => set({ promotingId }),
  setPendingRelation: (pendingRelation) => set({ pendingRelation }),
}));

export type WorldCanvasStore = ReturnType<typeof useWorldCanvasStore.getState>;
