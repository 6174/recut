/*
 * [INPUT]: 依赖 tldraw v5（Tldraw/Editor/BaseBoxShapeUtil/HTMLContainer/T + TLGlobalShapePropsMap 模块扩充）、
 * canvas-store 与 recut-worlds-client 类型
 * [OUTPUT]: 对外提供 tldraw 宿主：自定义 EntityCardShape（实体卡）与 WorldNodeShape（World 核心节点）经模块扩充
 * 注册进 TLShape 联合；便签/文本/形状/箭头复用原生 shape；store.listen(user/document) 作为唯一同步点
 * （rebuild 屏蔽窗 + 去抖持久化），删除同步到 world_relations/world_canvas，用户手绘自由元素自动持久化，
 * 实体间箭头绑定打开受控关系确认；选中解析为 store.selection 驱动右侧面板
 * [POS]: worlds/[worldID]/canvas 的画布底座层（本组件经 index.tsx dynamic(ssr:false) 挂载）；
 * 语义真相只在 world_entities + world_relations，tldraw store 是可持久化投影（RFC tldraw 映射）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import {
  BaseBoxShapeUtil,
  Editor,
  HTMLContainer,
  T,
  TLBaseShape,
  TLShapeId,
  Tldraw,
  stopEventPropagation,
} from "tldraw";
import "tldraw/tldraw.css";
import { ArrowLeft, Box, ChevronLeft, Globe2, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WorldCanvasElement, WorldEntity, WorldEntityRelation } from "@/lib/recut-worlds-client";
import {
  DEFAULT_ENTITY_SIZE,
  NOTE_SIZE,
  WORLD_ELEMENT_ID,
  WORLD_NODE_SIZE,
  elementPosition,
  gridPosition,
  useWorldCanvasStore,
} from "./canvas-store";

// ---------- 领域类型注册（v5：自定义 shape 必须扩充 TLGlobalShapePropsMap） ----------

type EntityCardProps = { entityId: string; w: number; h: number };
type WorldNodeProps = { w: number; h: number };

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "entity-card": EntityCardProps;
    "world-node": WorldNodeProps;
  }
}

type EntityCardShape = TLBaseShape<"entity-card", EntityCardProps>;
type WorldNodeShape = TLBaseShape<"world-node", WorldNodeProps>;

// ---------- 自定义 Shape Util ----------

export class EntityCardShapeUtil extends BaseBoxShapeUtil<EntityCardShape> {
  static override type = "entity-card" as const;
  static override props = {
    entityId: T.string,
    w: T.number,
    h: T.number,
  };

  override getDefaultProps(): EntityCardShape["props"] {
    return { entityId: "", w: DEFAULT_ENTITY_SIZE.width, h: DEFAULT_ENTITY_SIZE.height };
  }

  override getIndicatorPath(shape: EntityCardShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return path;
  }

  override component(shape: EntityCardShape) {
    return <EntityCardView entityId={shape.props.entityId} h={shape.props.h} w={shape.props.w} />;
  }
}

export class WorldNodeShapeUtil extends BaseBoxShapeUtil<WorldNodeShape> {
  static override type = "world-node" as const;
  static override props = { w: T.number, h: T.number };

  override getDefaultProps(): WorldNodeShape["props"] {
    return { w: WORLD_NODE_SIZE.width, h: WORLD_NODE_SIZE.height };
  }

  override getIndicatorPath(shape: WorldNodeShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 14);
    return path;
  }

  override component(shape: WorldNodeShape) {
    return <WorldNodeView h={shape.props.h} w={shape.props.w} />;
  }
}

function EntityCardView({ entityId, w, h }: { entityId: string; w: number; h: number }) {
  const entity = useWorldCanvasStore((state) => state.entities.find((item) => item.id === entityId));
  if (!entity) {
    return <HTMLContainer style={{ backgroundColor: "var(--color-muted)" }}>{null}</HTMLContainer>;
  }
  const color = entityColor(entity.kind);
  return (
    <HTMLContainer className="flex flex-col justify-between rounded-[10px] border-2 bg-card px-3 py-2.5" style={{ borderColor: color, height: h, pointerEvents: "none", width: w }}>
      <div>
        <div className="mb-1.5 h-1.5 w-8 rounded-full" style={{ backgroundColor: color }} />
        <p className="truncate text-[15px] font-semibold leading-5 text-foreground">{entity.title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {entity.kind}
          {entity.isProvisional ? " · 草稿" : ""}
        </p>
        <p className="mt-1 line-clamp-2 text-[10px] leading-3.5 text-muted-foreground">{entity.summary || "（无简述）"}</p>
      </div>
      {(entity.children?.length ?? 0) > 0 && (
        <button
          className="absolute bottom-1.5 right-1.5 grid size-5 place-items-center rounded-full text-[10px] text-white"
          onDoubleClick={(event) => {
            event.stopPropagation();
            useWorldCanvasStore.getState().setContext({ entityId: entity.id, title: entity.title });
          }}
          onPointerDown={(event) => stopEventPropagation(event)}
          style={{ backgroundColor: color, pointerEvents: "all" }}
          title="双击进入容器"
          type="button"
        >
          →
        </button>
      )}
    </HTMLContainer>
  );
}

function WorldNodeView({ w, h }: { w: number; h: number }) {
  const worldName = useWorldCanvasStore((state) => state.worldName);
  return (
    <HTMLContainer className="flex items-center gap-3 rounded-[14px] border-2 bg-card px-4" style={{ borderColor: "var(--color-primary)", height: h, pointerEvents: "none", width: w }}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl text-lg" style={{ backgroundColor: "color-mix(in srgb, var(--color-primary) 15%, transparent)", color: "var(--color-primary)" }}>
        ◍
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-foreground">{worldName}</p>
        <p className="text-[11px] text-muted-foreground">World 核心节点 · 点击查看</p>
      </div>
    </HTMLContainer>
  );
}

function entityColor(kind: string) {
  const colors: Record<string, string> = {
    character: "#e879f9",
    location: "#60a5fa",
    story: "#f59e0b",
    style: "#34d399",
    rule: "#a78bfa",
    reference: "#94a3b8",
  };
  return colors[kind] ?? "#94a3b8";
}

// ---------- 派生场景构建（store → tldraw） ----------
// shape id = world_canvas 元素 id；关系边派生投影 id = `shape:rel-<relationId>`。

const RELATION_PREFIX = "shape:rel-";
const MANAGED_TYPES = new Set(["entity-card", "world-node"]);
const FREE_TYPES = new Set(["note", "text", "geo", "arrow"]);

type DesiredShape = {
  id: string;
  type: "entity-card" | "world-node" | "note" | "text" | "geo" | "arrow";
  x: number;
  y: number;
  props: Record<string, unknown>;
};

function desiredShapes(state: ReturnType<typeof useWorldCanvasStore.getState>): DesiredShape[] {
  const shapes: DesiredShape[] = [];
  state.entities.forEach((entity: WorldEntity, index: number) => {
    const pos = elementPosition(state.elements, `shape:${entity.id}`, index);
    shapes.push({
      id: `shape:${entity.id}`,
      type: "entity-card",
      x: pos.x,
      y: pos.y,
      props: { entityId: entity.id, w: DEFAULT_ENTITY_SIZE.width, h: DEFAULT_ENTITY_SIZE.height },
    });
  });
  if (!state.context) {
    const worldElement = state.elements.find((element) => element.id === WORLD_ELEMENT_ID);
    const x = Number(worldElement?.geometry?.x);
    const y = Number(worldElement?.geometry?.y);
    const pos = worldElement && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 360, y: 40 };
    shapes.push({ id: WORLD_ELEMENT_ID, type: "world-node", x: pos.x, y: pos.y, props: { w: WORLD_NODE_SIZE.width, h: WORLD_NODE_SIZE.height } });
  }
  state.elements.forEach((element: WorldCanvasElement, index: number) => {
    if (element.kind === "entity" || element.id === WORLD_ELEMENT_ID) return;
    const pos = elementPosition(state.elements, element.id, index);
    const width = Number(element.geometry?.width) || NOTE_SIZE.width;
    const height = Number(element.geometry?.height) || NOTE_SIZE.height;
    if (element.kind === "note") {
      shapes.push({
        id: element.id,
        type: "note",
        x: pos.x,
        y: pos.y,
        props: { text: propString(element.props, "text"), w: width, h: height, color: "yellow" },
      });
      return;
    }
    if (element.kind === "text") {
      shapes.push({ id: element.id, type: "text", x: pos.x, y: pos.y, props: { text: propString(element.props, "text") } });
      return;
    }
    if (element.kind === "shape") {
      shapes.push({ id: element.id, type: "geo", x: pos.x, y: pos.y, props: { geo: mapShapeType(element), w: width, h: height } });
      return;
    }
    if (element.kind === "arrow") {
      const geometry = element.geometry as Record<string, unknown>;
      const dx = Number(geometry.dx) || 120;
      const dy = Number(geometry.dy) || 0;
      shapes.push({
        id: element.id,
        type: "arrow",
        x: pos.x,
        y: pos.y,
        // v5：start/end 是纯 VecModel（{x,y}），绑定语义由 createBinding 记录承担。
        props: { start: { x: 0, y: 0 }, end: { x: dx, y: dy } },
      });
    }
  });
  // 语义关系边（派生投影，带箭头绑定）
  const entityById = new Map(state.entities.map((entity) => [entity.id, entity]));
  for (const relation of state.relations as WorldEntityRelation[]) {
    const from = entityById.get(relation.fromEntityId);
    const to = entityById.get(relation.toEntityId);
    if (!from || !to) continue;
    const fromPos = elementPosition(state.elements, `shape:${from.id}`, 0);
    const toPos = elementPosition(state.elements, `shape:${to.id}`, 0);
    shapes.push({
      id: `${RELATION_PREFIX}${relation.id}`,
      type: "arrow",
      x: fromPos.x + DEFAULT_ENTITY_SIZE.width,
      y: fromPos.y + DEFAULT_ENTITY_SIZE.height / 2,
      props: {
        start: { x: 0, y: 0 },
        end: { x: toPos.x - (fromPos.x + DEFAULT_ENTITY_SIZE.width), y: toPos.y - fromPos.y },
      },
    });
  }
  return shapes;
}

function mapShapeType(element: WorldCanvasElement): "rectangle" | "ellipse" | "diamond" {
  if (element.props?.shapeType === "ellipse") return "ellipse";
  if (element.props?.shapeType === "diamond") return "diamond";
  return "rectangle";
}

function propString(props: Record<string, unknown> | undefined, key: string, fallback = ""): string {
  const value = props?.[key];
  return typeof value === "string" ? value : fallback;
}

function propNumber(props: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = props?.[key];
  return typeof value === "number" ? value : fallback;
}

// ---------- 同步实现（tldraw → store） ----------

type Tracked = Map<string, { canvasId?: string; relationId?: string; text?: string; x: number; y: number; w: number; h: number }>;

const GEOMETRY_DEBOUNCE_MS = 400;

function syncFromTldraw(editor: Editor, changes: { added?: Record<string, unknown>; updated?: Record<string, [unknown, unknown]>; removed?: Record<string, unknown> }, tracked: Tracked, geometryTimers: Map<string, ReturnType<typeof setTimeout>>) {
  const store = useWorldCanvasStore.getState();

  // 1. 删除同步：关系边 → removeRelation；实体/World 节点 → 立即复活（投影不可删，语义走面板）；
  // 自由元素 → removeElement。
  for (const [id, raw] of Object.entries(changes.removed ?? {})) {
    const record = raw as { type?: string; props?: Record<string, unknown>; x?: number; y?: number };
    const info = tracked.get(id);
    tracked.delete(id);
    if (info?.relationId) {
      void store.removeRelation(info.relationId);
      continue;
    }
    if (record.type === "entity-card") {
      restoreShape(editor, store.entities.find((entity) => entity.id === record.props?.entityId));
      continue;
    }
    if (record.type === "world-node") {
      restoreWorldNode(editor);
      continue;
    }
    if (info?.canvasId) {
      void store.removeElement(info.canvasId);
    }
  }

  // 2. 新增：用户手绘自由元素 → 持久化为 world_canvas；实体间箭头 → 受控关系确认
  for (const [id, raw] of Object.entries(changes.added ?? {})) {
    const shape = raw as { id: string; type: string; x: number; y: number; props?: Record<string, unknown> };
    if (tracked.has(id)) continue;
    if (!FREE_TYPES.has(shape.type)) continue;
    const contextId = store.context?.entityId ?? "";
    if (shape.type === "arrow") {
      const fromEntity = entityIdFromBinding(editor, id, "start");
      const toEntity = entityIdFromBinding(editor, id, "end");
      tracked.set(id, { canvasId: id, x: shape.x, y: shape.y, w: 0, h: 0 });
      void store
        .upsertElement({
          id,
          contextId,
          kind: "arrow",
          refKind: "",
          refId: "",
          name: "箭头",
          props: { fromElementId: fromEntity ? `shape:${fromEntity}` : "", toElementId: toEntity ? `shape:${toEntity}` : "" },
          geometry: { x: Math.round(shape.x), y: Math.round(shape.y), zIndex: 1 },
          style: {},
          layer: "0",
        })
        .then(() => {
          if (fromEntity && toEntity && fromEntity !== toEntity) {
            store.setPendingRelation({ arrowCanvasId: id, fromEntityId: fromEntity, toEntityId: toEntity });
          }
        });
      continue;
    }
    if (shape.type === "text") {
      const text = propString(shape.props, "text");
      tracked.set(id, { canvasId: id, x: shape.x, y: shape.y, w: 0, h: 0, text });
      void store.upsertElement({
        id,
        contextId,
        kind: "text",
        refKind: "",
        refId: "",
        name: text.slice(0, 20) || "文本",
        props: { text },
        geometry: { x: Math.round(shape.x), y: Math.round(shape.y), zIndex: 1 },
        style: {},
        layer: "0",
      });
      continue;
    }
    if (shape.type === "note") {
      const text = propString(shape.props, "text");
      const w = propNumber(shape.props, "w", NOTE_SIZE.width);
      const h = propNumber(shape.props, "h", NOTE_SIZE.height);
      tracked.set(id, { canvasId: id, x: shape.x, y: shape.y, w, h, text });
      void store.upsertElement({
        id,
        contextId,
        kind: "note",
        refKind: "",
        refId: "",
        name: "便签",
        props: { text },
        geometry: { x: Math.round(shape.x), y: Math.round(shape.y), width: Math.round(w), height: Math.round(h), zIndex: 1 },
        style: { color: "#fde68a" },
        layer: "0",
      });
      continue;
    }
    if (shape.type === "geo") {
      const w = propNumber(shape.props, "w", 100);
      const h = propNumber(shape.props, "h", 100);
      tracked.set(id, { canvasId: id, x: shape.x, y: shape.y, w, h });
      void store.upsertElement({
        id,
        contextId,
        kind: "shape",
        refKind: "",
        refId: "",
        name: "形状",
        props: { shapeType: propString(shape.props, "geo", "rectangle") },
        geometry: { x: Math.round(shape.x), y: Math.round(shape.y), width: Math.round(w), height: Math.round(h), zIndex: 1 },
        style: {},
        layer: "0",
      });
    }
  }

  // 3. 更新：几何/文本去抖提交
  for (const [id, pair] of Object.entries(changes.updated ?? {})) {
    const shape = pair?.[1] as { id: string; type: string; x: number; y: number; props?: Record<string, unknown> } | undefined;
    const info = tracked.get(id);
    if (!shape || !info?.canvasId) continue;
    const w = propNumber(shape.props, "w", 0);
    const h = propNumber(shape.props, "h", 0);
    const moved = Math.abs(info.x - shape.x) > 0.5 || Math.abs(info.y - shape.y) > 0.5 || Math.abs(info.w - w) > 0.5 || Math.abs(info.h - h) > 0.5;
    if (moved) {
      tracked.set(id, { ...info, x: shape.x, y: shape.y, w, h });
      const canvasId = info.canvasId;
      const existing = geometryTimers.get(id);
      if (existing) clearTimeout(existing);
      geometryTimers.set(
        id,
        setTimeout(() => {
          geometryTimers.delete(id);
          void store.persistGeometry(canvasId, {
            x: Math.round(shape.x),
            y: Math.round(shape.y),
            ...(w ? { width: Math.round(w) } : {}),
            ...(h ? { height: Math.round(h) } : {}),
          });
        }, GEOMETRY_DEBOUNCE_MS),
      );
    }
    if (shape.type === "text" || shape.type === "note") {
      const nextText = propString(shape.props, "text");
      if (info.text !== undefined && info.text !== nextText) {
        tracked.set(id, { ...info, text: nextText });
        void store.persistGeometry(info.canvasId, undefined, { text: nextText });
      }
    }
  }
}

// 投影复活：实体卡/World 节点被 tldraw 删除时立即按 store 数据重建（删除语义对象走面板/工具栏）。
function restoreShape(editor: Editor, entity?: WorldEntity) {
  if (!entity) return;
  const pos = elementPosition(useWorldCanvasStore.getState().elements, `shape:${entity.id}`, 0);
  editor.createShapes([
    { id: `shape:${entity.id}` as TLShapeId, type: "entity-card", x: pos.x, y: pos.y, props: { entityId: entity.id, w: DEFAULT_ENTITY_SIZE.width, h: DEFAULT_ENTITY_SIZE.height } } as never,
  ]);
}

function restoreWorldNode(editor: Editor) {
  const state = useWorldCanvasStore.getState();
  const worldElement = state.elements.find((element) => element.id === WORLD_ELEMENT_ID);
  const x = Number(worldElement?.geometry?.x);
  const y = Number(worldElement?.geometry?.y);
  const pos = worldElement && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 360, y: 40 };
  editor.createShapes([{ id: WORLD_ELEMENT_ID as TLShapeId, type: "world-node", x: pos.x, y: pos.y, props: { w: WORLD_NODE_SIZE.width, h: WORLD_NODE_SIZE.height } } as never]);
}

function entityIdFromBinding(editor: Editor, arrowId: string, terminal: "start" | "end"): string | null {
  const bindings = editor.getBindingsFromShape(arrowId as TLShapeId, "arrow") as Array<{ toId: TLShapeId; props: { terminal: string } }>;
  const binding = bindings.find((item) => item.props?.terminal === terminal);
  if (!binding) return null;
  const target = editor.getShape(binding.toId) as EntityCardShape | undefined;
  if (!target || target.type !== "entity-card") return null;
  return target.props.entityId;
}

function resolveSelection(editor: Editor, selectedIds: string[]) {
  const store = useWorldCanvasStore.getState();
  for (const id of selectedIds) {
    const shape = editor.getShape(id as TLShapeId);
    if (!shape) continue;
    if (shape.type === "entity-card") {
      const entity = store.entities.find((item) => item.id === (shape as EntityCardShape).props.entityId);
      if (entity) return { type: "entity", entity } as const;
    }
    if (shape.type === "world-node") return { type: "world" } as const;
    if (shape.type === "arrow" && id.startsWith(RELATION_PREFIX)) {
      const relation = store.relations.find((item) => item.id === id.slice(RELATION_PREFIX.length));
      if (relation) return { type: "relation", relation } as const;
    }
    if (shape.type === "note" || shape.type === "text" || shape.type === "geo" || shape.type === "arrow") {
      const element = store.elements.find((item) => item.id === id);
      if (element) {
        return {
          type: "canvas",
          element,
          fromEntityId: shape.type === "arrow" ? (entityIdFromBinding(editor, id, "start") ?? undefined) : undefined,
          toEntityId: shape.type === "arrow" ? (entityIdFromBinding(editor, id, "end") ?? undefined) : undefined,
        } as const;
      }
    }
  }
  return null;
}

// ---------- tldraw UI 覆盖：功能并入 tldraw 顶部同一行（无第二层 Header） ----------

function CanvasTopPanel({ onClose }: { onClose?: () => void }) {
  const context = useWorldCanvasStore((state) => state.context);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const notice = useWorldCanvasStore((state) => state.notice);
  const relatingFrom = useWorldCanvasStore((state) => state.relatingFrom);
  const relatingTo = useWorldCanvasStore((state) => state.relatingTo);
  const setContext = useWorldCanvasStore((state) => state.setContext);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  const addNote = useWorldCanvasStore((state) => state.addNote);
  return (
    <div className="flex h-11 min-w-0 items-center gap-2 px-2.5 text-sm">
      {onClose && (
        <button aria-label="返回设定视图" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose} type="button">
          <ArrowLeft className="size-4" />
        </button>
      )}
      {context ? (
        <>
          <button className="flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" onClick={() => setContext(null)} type="button">
            <ChevronLeft className="size-3" /> 全局画布
          </button>
          <span className="flex min-w-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">
            <Box className="size-3 shrink-0" />
            <span className="truncate">{context.title}</span>
          </span>
        </>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <Globe2 aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="truncate">{worldName}</span>
        </span>
      )}
      {!readOnly && (
        <span className="flex shrink-0 items-center gap-1.5">
          <button className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" onClick={() => setCreating(true)} type="button">
            <Plus className="size-3" /> 实体
          </button>
          <button className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" onClick={() => void addNote()} type="button">
            <Pencil className="size-3" /> 便签
          </button>
        </span>
      )}
      {relatingFrom && !relatingTo && <span className="shrink-0 text-xs text-primary">已选起点：点击目标实体建立关系</span>}
      {notice && <span className="truncate text-xs text-warning">{notice}</span>}
    </div>
  );
}

function CanvasSharePanel({ onClose }: { onClose?: () => void }) {
  if (!onClose) return null;
  return (
    <div className="flex items-center pr-2">
      <button
        className="flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-muted"
        onClick={onClose}
        type="button"
      >
        <Globe2 aria-hidden className="size-3.5" /> 设定视图
      </button>
    </div>
  );
}

// ---------- 宿主组件 ----------

function applyDesiredShapes(editor: Editor, track: (desired: DesiredShape[]) => void) {
  const desired = desiredShapes(useWorldCanvasStore.getState());
  editor.run(() => {
    const desiredIds = new Set(desired.map((shape) => shape.id));
    const stale: TLShapeId[] = [];
    for (const id of editor.getCurrentPageShapeIds()) {
      if (desiredIds.has(id)) continue;
      const shape = editor.getShape(id);
      if (!shape) continue;
      if (MANAGED_TYPES.has(shape.type) || FREE_TYPES.has(shape.type)) stale.push(id);
    }
    if (stale.length) editor.deleteShapes(stale);
    const relationBindings: Array<{ fromId: TLShapeId; toId: TLShapeId; type: "arrow"; props: Record<string, unknown> }> = [];
    for (const shape of desired) {
      const partial = { id: shape.id as TLShapeId, type: shape.type, x: shape.x, y: shape.y, props: shape.props } as never;
      if (editor.getShape(shape.id as TLShapeId)) {
        editor.updateShapes([partial]);
      } else {
        editor.createShapes([partial]);
      }
      if (shape.type === "arrow" && shape.id.startsWith(RELATION_PREFIX)) {
        const relationId = shape.id.slice(RELATION_PREFIX.length);
        const relation = useWorldCanvasStore.getState().relations.find((item) => item.id === relationId);
        if (relation) {
          relationBindings.push(
            { fromId: shape.id as TLShapeId, toId: `shape:${relation.fromEntityId}` as TLShapeId, type: "arrow", props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: true } },
            { fromId: shape.id as TLShapeId, toId: `shape:${relation.toEntityId}` as TLShapeId, type: "arrow", props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: true } },
          );
        }
      }
    }
    for (const binding of relationBindings) {
      if (editor.getShape(binding.toId)) editor.createBinding(binding as never);
    }
  });
  track(desired);
}

export function CanvasTldrawHost({ onClose }: { onClose?: () => void }) {
  const dataVersion = useWorldCanvasStore((state) => state.dataVersion);
  const context = useWorldCanvasStore((state) => state.context);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const editorRef = useRef<Editor | null>(null);
  const rebuildingRef = useRef(false);
  const trackedRef = useRef<Tracked>(new Map());
  const geometryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastSelectionRef = useRef("");
  const readyRef = useRef(false);

  // store → tldraw 场景重建（仅在 dataVersion / 上下文变化时；屏蔽窗内忽略同步回调）
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !readyRef.current) return;
    rebuildingRef.current = true;
    try {
      applyDesiredShapes(editor, (desired) => {
        desiredIdsIntoTracked(trackedRef.current, desired);
      });
    } finally {
      setTimeout(() => {
        rebuildingRef.current = false;
      }, 0);
    }
  }, [dataVersion, context, worldName]);

  const attachEditor = useCallback((editor: Editor) => {
    editorRef.current = editor;
    editor.updateInstanceState({ isGridMode: true });
    editor.user.updateUserPreferences({ colorScheme: "dark" });
    readyRef.current = true;
    // 初次挂载：按当前数据重建场景
    rebuildingRef.current = true;
    try {
      applyDesiredShapes(editor, (desired) => {
        desiredIdsIntoTracked(trackedRef.current, desired);
      });
    } finally {
      setTimeout(() => {
        rebuildingRef.current = false;
      }, 0);
    }
    // tldraw → store：文档同步（用户编辑）
    editor.store.listen((info) => {
      if (rebuildingRef.current) return;
      syncFromTldraw(editor, info.changes as never, trackedRef.current, geometryTimersRef.current);
    }, { source: "user", scope: "document" });
    // 选中 → 右侧详情面板
    editor.store.listen(() => {
      if (rebuildingRef.current) return;
      const ids = editor.getSelectedShapeIds();
      const key = [...ids].sort().join(",");
      if (key === lastSelectionRef.current) return;
      lastSelectionRef.current = key;
      useWorldCanvasStore.getState().select(resolveSelection(editor, ids as string[]));
    }, { scope: "session" });
  }, []);

  return (
    <div className="h-full min-h-0 w-full">
      <Tldraw
        components={useMemo(
          () => ({
            // 隐藏 pages 功能；调试/帮助菜单一并关闭。
            PageMenu: null,
            DebugMenu: null,
            DebugPanel: null,
            HelpMenu: null,
            // 工具栏功能并入 tldraw 顶部同一行：左=返回/面包屑/新建，右=切换设定视图。
            TopPanel: () => <CanvasTopPanel onClose={onClose} />,
            SharePanel: () => <CanvasSharePanel onClose={onClose} />,
          }),
          [onClose],
        )}
        onMount={attachEditor}
        shapeUtils={[EntityCardShapeUtil, WorldNodeShapeUtil]}
      />
    </div>
  );
}

function desiredIdsIntoTracked(tracked: Tracked, desired: DesiredShape[]) {
  tracked.clear();
  for (const shape of desired) {
    tracked.set(shape.id, {
      canvasId: shape.id.startsWith(RELATION_PREFIX) ? undefined : shape.id,
      relationId: shape.id.startsWith(RELATION_PREFIX) ? shape.id.slice(RELATION_PREFIX.length) : undefined,
      x: shape.x,
      y: shape.y,
      w: Number(shape.props.w) || 0,
      h: Number(shape.props.h) || 0,
      text: typeof shape.props.text === "string" ? shape.props.text : undefined,
    });
  }
}

void gridPosition;
