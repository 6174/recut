/*
 * [INPUT]: 依赖 Zustand 与 recut-worlds-client（entities/canvas/relations/entityTypes 传输适配器）
 * [OUTPUT]: 对外提供 Recursive World Canvas 的单一数据源（含 T1 增量投影：语义写后合并返回对象而非
 * load(true)；T2 面板动作 saveEntityField/confirmEntity/deleteEntity/updateWorldMeta；T3 创建系统
 * createEntity/createChildEntity 草稿化 + 命名态 + 创建/右键菜单状态；T4 就地编辑 inlineEdit；T6 容器
 * 视图默认包含容器自身 entity（load 时把 context 实体 unshift 进 entities）：会话配置（open）、当前上下文的实体/画布元素/关系/
 * 类型目录、视图状态（缩放/选中节点/连线草稿/对话框，含详情面板停靠侧 panelSide 左右可切并持久化）
 * 与全部写动作（关系原位改 updateRelation：类型/方向 patch，保留 id/scope 与画布锚点）；画布元素写 world_canvas 不产 revision，
 * 语义写（实体/关系/promote）产出 revision 并在 revision 冲突时刷新后重试一次；附几何工具函数与尺寸常量。
 * 画布存储为文档粒度（RFC 2026-09-09）：一张画布 = 一个 Document，canvas.get/save 整包读写 + version 乐观锁；
 * 元素级动作（upsertElement/persistGeometry/moveElement/removeElement）只改本地文档 + 脏集合，去抖整包落库，
 * 冲突时拉远端按 id 合并脏集重试一次；内层画布是独立文档，实体投影位置跨层天然隔离。
 * 统一 Entity 模型（RFC 2026-09-09）：实体字段 = title/kind/content → name/typeId/intro/detail/attrs；
 * saveEntityField 签名改为 {name?, intro?, detail?, attrKey?, value?} 单字段 patch（attrs 全量替换语义，
  * 按 attrKey 原位 patch 当前 full attrs 后整包 upsert）；实体素材 = media 属性（attachMediaAttr/
  * attachMediaElement），「参考素材」网格/封面按钮/A 虚线挂接线已退役——卡面图源 = 遍历 media
  * attrs 的统一投影；evidence.attach/update 写通道退役，evidence.archive 仅留 legacy 解挂兼容
 * [POS]: worlds/[worldID]/canvas 的 zustand 状态层；组件层只读 store 快照并触发动作，不各自持有画布数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import type { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import { entityCardContentHeight } from "@/lib/pomelo/world-canvas/blocks/entity-card-metrics";
import {
  createRecutWorldsClient,
  type EntityAttr,
  type EntityKind,
  type WorldCanvasElement,
  type WorldEntity,
  type WorldEntityRelation,
  type WorldEntityType,
  type WorldRelationType,
} from "@/lib/recut-worlds-client";
import { applyCanvasError } from "./canvas-errors";
import { entityPhotoUrls } from "./canvas-image";
import { attrValueOf } from "./entity-attrs";

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

// 「+」引导层：从实体/World 节点的 + 手柄拖出后，要么连到另一实体开关系确认，
// 要么在当前位置弹引导菜单创建属性节点（文本/图片/音频/视频）。
// 属性边/属性元素归属当前上下文（Level）：全局=Level 0（World 的属性），实体容器=该实体的属性。
export type AttrMedia = "text" | "image" | "audio" | "video";
export type AttrCreator = { fromEntityId: string; fromEntityTitle: string; screenX: number; screenY: number; worldX?: number; worldY?: number } | null;

// 就地编辑（T4）：双击便签/文本在卡位渲染 DOM 编辑器；rect 为世界坐标（宿主换算屏幕位置）。
// T3 扩展：entity-title = 创建后命名态 / 右键重命名（单行输入，Enter/blur 提交，Esc 保留默认名）
export type InlineEdit =
  | { kind: "note-body" | "text-body"; elementId: string; rect: { x: number; y: number; width: number; height: number }; value: string }
  // attr-title = 新建属性命名态；attr-body = 属性文本值编辑（提交时同步回实体 content 字段）
  | { kind: "attr-title" | "attr-body"; elementId: string; rect: { x: number; y: number; width: number; height: number }; value: string }
  | { kind: "entity-title"; entityId: string; rect: { x: number; y: number; width: number; height: number }; value: string }
  | null;

// 右键菜单（T3）：实体 / 便签文本元素；screen 坐标由宿主渲染菜单
export type CanvasContextMenu = {
  kind: "entity" | "element";
  entityId?: string;
  elementId?: string;
  screenX: number;
  screenY: number;
} | null;

// 轻反馈 toast（B.4/T10）：结构性语义操作 3s 自消；错误态带重试由调用方决定
export type CanvasToast = { id: number; text: string; kind: "info" | "success" | "error"; action?: { label: string; run: () => void } };

// 最近变更（T12/B.14 语义撤销）：建/删实体、建/删关系、改字段、挂接/确认设定等；
// undo 为闭包（回写旧值 / 删除 / 重建），v1 不含「删除实体」的恢复（回收站 P2）
export type CanvasChange = { id: number; label: string; at: string; undo: () => Promise<void> | void };

export const DEFAULT_ENTITY_SIZE = { width: 264, height: 328 };
export const NOTE_SIZE = { width: 150, height: 100 };
export const WORLD_ELEMENT_ID = "shape:world";
export const WORLD_NODE_SIZE = { width: 200, height: 200 };

// 实体类型 → 卡片描边色；颜色只表达类型，不承载关系语义（RFC 视觉语言）。
export const typeColors: Record<string, string> = {
  character: "#e879f9",
  object: "#fbbf24",
  location: "#60a5fa",
  story: "#f59e0b",
  style: "#34d399",
  rule: "#a78bfa",
};

export function gridPosition(index: number): Point {
  return { x: 40 + (Math.max(0, index) % 4) * 260, y: 40 + Math.floor(Math.max(0, index) / 4) * 180 };
}

// 画布元素位置：已持久化几何优先，否则按 gridPosition 兜底。
// （文档粒度存储后，位置就是元素在本文档 geometry 里的字段，无需分层读写）
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

// 按 id 合并式替换/追加（T1 增量投影：语义写后不再 load(true) 全量拉取，直接合并 API 返回对象）
function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((existing) => existing.id === item.id)
    ? list.map((existing) => (existing.id === item.id ? item : existing))
    : [...list, item];
}

// 默认实体名（B.5 自动确认规则的「非默认名」判定；B.7 命名态预填同名）；reference 预设已退役
export const DEFAULT_ENTITY_TITLES: Record<string, string> = {
  character: "新人物",
  location: "新地点",
  object: "新物件",
  story: "新故事",
  style: "新风格",
  rule: "新规则",
};

export function isDefaultEntityTitle(typeId: string, title: string): boolean {
  return title.trim() === (DEFAULT_ENTITY_TITLES[typeId] ?? "新设定");
}

// 最近使用类型（B.7 双击空白快捷创建）与最近自定义类型（创建菜单自定义区，至多 3 个）
const LAST_KIND_KEY = "wc:lastKind";
const RECENT_TYPES_KEY = "wc:recentTypes";

// 详情面板停靠侧（左/右均可）：localStorage 持久化，默认右侧（兼容既有习惯）
export type PanelSide = "left" | "right";
const PANEL_SIDE_KEY = "wc:panelSide";

export function readPanelSide(): PanelSide {
  try {
    return localStorage.getItem(PANEL_SIDE_KEY) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
}

function savePanelSide(side: PanelSide) {
  try {
    localStorage.setItem(PANEL_SIDE_KEY, side);
  } catch {
    // localStorage 不可用时静默（隐私模式等）
  }
}

// 属性面板显隐（T17 重构）：默认打开；Header icon 切换；选中元素自动打开，空选回落 World 态
export type PanelOpenState = boolean;

export function readLastKind(): string {
  try {
    return localStorage.getItem(LAST_KIND_KEY) ?? "character";
  } catch {
    return "character";
  }
}

function saveLastKind(kind: string) {
  try {
    localStorage.setItem(LAST_KIND_KEY, kind);
    const recent = new Set<string>([kind, ...readRecentCustomTypes()]);
    localStorage.setItem(RECENT_TYPES_KEY, JSON.stringify([...recent].slice(0, 3)));
  } catch {
    // localStorage 不可用时静默（隐私模式等）
  }
}

export function readRecentCustomTypes(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_TYPES_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
}

// ---- 文档粒度画布保存机制（RFC 2026-09-09）----
// 本地编辑（upsert/remove/persistGeometry/moveElement）只改 store 内的文档，
// 脏元素记入 canvasSaveState，去抖整包 canvas.save 落库；version 冲突时
// 拉远端文档按 id 合并脏集重试一次。非响应式状态：放 zustand 外的模块单例。
// 去抖很短（150ms）：元素变更都发生在交互收尾（pointerup/文本提交），标脏即调度，
// 本地服务下几乎即时落库；批量/连发由去抖合并成一次整包保存。
const CANVAS_SAVE_DEBOUNCE_MS = 150;

const canvasSaveState = {
  timer: null as ReturnType<typeof setTimeout> | null,
  dirty: new Set<string>(),
  removed: new Set<string>(),
  saving: false,
};

function markCanvasDirty(id: string, removed = false) {
  canvasSaveState.dirty.add(id);
  if (removed) canvasSaveState.removed.add(id);
  scheduleCanvasSave();
}

function scheduleCanvasSave() {
  if (canvasSaveState.timer) clearTimeout(canvasSaveState.timer);
  canvasSaveState.timer = setTimeout(() => {
    canvasSaveState.timer = null;
    void flushCanvasSave();
  }, CANVAS_SAVE_DEBOUNCE_MS);
}

// 立即落盘当前文档（上下文切换/卸载前调用，避免丢最后一次去抖窗口）
async function flushCanvasSave(): Promise<void> {
  if (canvasSaveState.saving) {
    scheduleCanvasSave();
    return;
  }
  const state = useWorldCanvasStore.getState();
  if (!state.apiBase || !state.worldId || state.readOnly) return;
  if (!canvasSaveState.dirty.size && !canvasSaveState.removed.size) return;
  canvasSaveState.saving = true;
  const contextId = state.context?.entityId ?? "";
  const dirty = new Set(canvasSaveState.dirty);
  const removed = new Set(canvasSaveState.removed);
  const save = async (elements: WorldCanvasElement[], version: number) => {
    const doc = await createRecutWorldsClient(state.apiBase).canvas.save({
      worldId: state.worldId,
      contextId,
      elements,
      version,
    });
    useWorldCanvasStore.setState({ docVersion: doc.version });
  };
  try {
    await save(useWorldCanvasStore.getState().elements, useWorldCanvasStore.getState().docVersion);
    for (const id of dirty) canvasSaveState.dirty.delete(id);
    for (const id of removed) canvasSaveState.dirty.delete(id);
    canvasSaveState.removed.clear();
  } catch (cause) {
    const code = (cause as { code?: string } | null)?.code;
    if (code === "CANVAS_VERSION_CONFLICT") {
      // 冲突合并：远端文档为底，回放本地脏元素/删除，再以新 version 重试一次。
      // context 已切换则丢弃本次合并（脏集属于旧层文档，不能写进新层）
      if ((useWorldCanvasStore.getState().context?.entityId ?? "") !== contextId) {
        canvasSaveState.dirty.clear();
        canvasSaveState.removed.clear();
      } else {
        try {
          const remote = await createRecutWorldsClient(state.apiBase).canvas.get({
            worldId: state.worldId,
            contextId,
          });
          const latest = useWorldCanvasStore.getState();
          const byId = new Map(remote.elements.map((element) => [element.id, element]));
          for (const id of removed) byId.delete(id);
          for (const element of latest.elements) {
            if (dirty.has(element.id)) byId.set(element.id, element);
          }
          await save([...byId.values()], remote.version);
          for (const id of dirty) canvasSaveState.dirty.delete(id);
          canvasSaveState.removed.clear();
        } catch (mergeCause) {
          useWorldCanvasStore.setState({ notice: messageOf(mergeCause) });
        }
      }
    } else {
      useWorldCanvasStore.setState({ notice: messageOf(cause) });
    }
  } finally {
    canvasSaveState.saving = false;
  }
}

// 卸载兜底：去抖窗口内刷新/关闭页面时，用 sendBeacon 把当前文档强制落盘
// （flushCanvasSave 的异步 fetch 在 unload 后不可靠）。仅在有脏数据时发送。
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const state = useWorldCanvasStore.getState();
    if (!state.apiBase || !state.worldId || state.readOnly) return;
    if (!canvasSaveState.dirty.size && !canvasSaveState.removed.size) return;
    if (canvasSaveState.timer) {
      clearTimeout(canvasSaveState.timer);
      canvasSaveState.timer = null;
    }
    const body = JSON.stringify({
      contextId: state.context?.entityId ?? "",
      elements: state.elements,
      version: state.docVersion,
    });
    const url = `${state.apiBase}/v1/worlds/${encodeURIComponent(state.worldId)}/canvas/doc`;
    navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    canvasSaveState.dirty.clear();
    canvasSaveState.removed.clear();
  });
}

// 统一 Entity 模型（RFC 2026-09-09）：实体素材 = media 属性，不再有 evidence.attach 写通道；
// references 为 legacy 只读投影，仅渲染。

function modalityLabelOf(modality: string): string {
  const labels: Record<string, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" };
  return labels[modality] ?? "素材";
}

// 命名态定位（已不再于创建时启动；EntityCardBlockV 渲染公式参考值）
const ENTITY_CARD_IMAGE_H = 160;
const ENTITY_CARD_PAD = 14;

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
  // 容器导航路径（B.11）：面包屑唯一导航真相；contextTrail 最后一个 = 当前 context
  contextTrail: Array<{ entityId: string; title: string }>;
  entities: WorldEntity[];
  elements: WorldCanvasElement[];
  // 当前文档（context 层）的服务端 version：整包保存的乐观锁
  docVersion: number;
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
  attrCreator: AttrCreator;
  // 工具栏连线工具：激活后点击任意节点即可拖出引导线（与「+」手柄同一引导流程）
  linkMode: boolean;
  // 工具栏抓手模式：CanvasPomeloHost 渲染全画布平移 overlay，截获指针拖拽平移视口
  panMode: boolean;
  // pomelo 编辑器实例（canvas-pomelo 挂载后登记，工具栏按钮经它驱动视口/undo/网格）
  editor: PomeloEditor | null;
  pendingRelation: { fromEntityId: string; toEntityId: string; arrowCanvasId?: string } | null;
  inlineEdit: InlineEdit;
  // 删除确认对话框目标（T2：展示影响范围后确认）
  deleteTarget: WorldEntity | null;
  // 「添加字段」对话框目标 kind（类型级字段，T2）
  addFieldFor: string | null;
  // 创建菜单锚点（T3）：screen 坐标；null = 视口中心（顶栏 + 按钮）
  creatingAt: { screenX: number; screenY: number } | null;
  // 右键菜单（T3）
  contextMenu: CanvasContextMenu;
  // toast 队列（B.4）：3s 自消，至多同屏 3 条
  toasts: CanvasToast[];
  open: (input: { apiBase: string; worldId: string; worldName: string; readOnly: boolean; revisionId: string }) => void;
  load: (force?: boolean) => Promise<void>;
  refreshRevision: () => Promise<void>;
  setContext: (context: CanvasContext) => void;
  // URL 深链恢复（?ctx=<entityId>）：取实体标题后走标准 setContext 进入容器
  restoreContext: (entityId: string) => Promise<void>;
  exitContext: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  select: (selection: CanvasSelection) => void;
  startRelating: (entityId: string) => void;
  pickRelatingTarget: (entityId: string) => void;
  cancelRelating: () => void;
  setAttrCreator: (creator: AttrCreator) => void;
  setLinkMode: (linkMode: boolean) => void;
  setPanMode: (panMode: boolean) => void;
  setEditor: (editor: PomeloEditor | null) => void;
  addFreeElement: (kind: "text" | AttrMedia, pos: Point) => Promise<void>;
  createAttribute: (fromElementId: string, media: AttrMedia, pos: Point, initial?: { text?: string; fileName?: string; label?: string; assetId?: string; assetName?: string }, edgeType?: string) => Promise<string | null>;
  // 属性值回写实体 content（label 映射 type schema 字段 key；否则 label 即 key）
  syncAttrValue: (element: WorldCanvasElement, text: string) => Promise<void>;
  renameAttrLabel: (elementId: string, label: string) => Promise<void>;
  // 关系锚点持久化：写固有 anchor 元素（shape:rel-<relationId>），语义由 relationId 关联
  persistRelationGeometry: (relationId: string, geometry: { fromAnchor?: { x: number; y: number }; toAnchor?: { x: number; y: number }; bend?: { dx: number; dy: number } }) => Promise<void>;
  moveElement: (id: string, x: number, y: number) => void;
  upsertElement: (input: CanvasElementInput) => Promise<WorldCanvasElement>;
  persistGeometry: (id: string, geometryOverride?: Record<string, unknown>, propsOverride?: Record<string, unknown>) => Promise<void>;
  // T3 创建：落点可选（默认网格位）；标题缺省 = 类型默认名 + isProvisional 草稿 + 进入命名态。
  // 返回新实体 id（失败 null），供「+」引导在同一流程内补建默认关系。
  createEntity: (kind: string, opts?: { title?: string; pos?: Point }) => Promise<string | null>;
  createChildEntity: (parentId: string, kind: string, opts?: { title?: string }) => Promise<void>;
  addNote: (pos?: Point) => Promise<void>;
  removeElement: (id: string) => Promise<void>;
  createRelation: (fromEntityId: string, toEntityId: string, relationType: string, opts?: { scopeEntityId?: string }) => Promise<void>;
  removeRelation: (relationId: string) => Promise<void>;
  // 原位改关系（T5）：类型与方向 patch，保留 relation id、scope 与画布锚点（relations.update）
  updateRelation: (relation: WorldEntityRelation, patch: { relationType?: string; fromEntityId?: string; toEntityId?: string }) => Promise<void>;
  // 换类型（面板/标签就地换）：updateRelation 的语义别名
  changeRelationType: (relation: WorldEntityRelation, relationType: string) => Promise<void>;
  // 交换方向（A → B 变 B → A）：等价 updateRelation 交换两端
  swapRelationDirection: (relation: WorldEntityRelation) => Promise<void>;
  promote: (elementId: string, input?: { typeId?: string; name?: string; relationType?: string }) => Promise<void>;
  setPromoting: (elementId: string | null) => void;
  setPendingRelation: (pendingRelation: { fromEntityId: string; toEntityId: string; arrowCanvasId?: string } | null) => void;
  startInlineEdit: (edit: NonNullable<InlineEdit>) => void;
  cancelInlineEdit: () => void;
  // 右键/面板触发的就地编辑入口（T3）：rect 依 store 元素几何计算，无需编辑器句柄
  startEntityRename: (entityId: string, anchor?: { screenX: number; screenY: number }) => void;
  startElementBodyEdit: (elementId: string, kind: "note-body" | "text-body" | "attr-body") => void;
  commitInlineEdit: (value: string) => Promise<void>;
  // 实体名重命名（面板输入框 / 就地重命名共用）：冲突重试一次 + 合并返回实体（T1 语义）
  renameEntity: (entity: WorldEntity, title: string) => Promise<void>;
  // 字段保存（T2 面板）：单字段 patch（attrKey+value 全量 attrs 替换语义）或 name/intro/detail；
  // 正式实体产 revision，草稿不产。media 属性值 = {assetId, name?, kind?}
  saveEntityField: (
    entity: WorldEntity,
    patch: { name?: string; intro?: string; detail?: string; attrKey?: string; attrLabel?: string; attrType?: EntityAttr["type"]; attrOptions?: string[]; value?: unknown },
  ) => Promise<void>;
  // 确认设定（草稿 → 正式，产 revision）
  confirmEntity: (entityId: string) => Promise<void>;
  // 删除设定（影响范围确认后调用；后端级联子图/关系/证据/画布投影）
  deleteEntity: (entityId: string) => Promise<void>;
  // World 名称/简介编辑（World 态面板）
  updateWorldMeta: (patch: { name?: string; description?: string; skillMd?: string }) => Promise<void>;
  setDeleteTarget: (entity: WorldEntity | null) => void;
  setAddFieldFor: (kind: string | null) => void;
  // T8 媒体：素材来源浮层（仅独立素材；实体媒体 = media 属性，无独立「挂接目标」状态）与预览浮层
  mediaSource: Record<string, never> | null;
  mediaPreview: { src: string; modality: string; name: string } | null;
  setMediaSource: (input: Record<string, never> | null) => void;
  // 画面删除（T16/D7 P1）：实体卡从画布移除，设定本身保留；outline 面板可放回
  hideEntityFromCanvas: (entityId: string) => Promise<void>;
  unhideEntity: (entityId: string) => Promise<void>;
  setMediaPreview: (preview: { src: string; modality: string; name: string } | null) => void;
  // 独立媒体元素落画布（assetId/url 二选一）
  addMediaElement: (props: { modality: string; assetId?: string; url?: string; name?: string }, pos: Point) => Promise<void>;
  // 面板换图（媒体元素）：persist props.assetId/name（画布投影随 dataVersion 重建）
  setMediaElementAsset: (elementId: string, media: { assetId: string; name?: string } | null) => Promise<void>;
  // 面板换图（attr 属性元素）：persist props.assetId/name；若有属性边连到实体，按字段映射回写 media 属性值
  setAttrMediaAsset: (elementId: string, media: { assetId: string; name?: string } | null) => Promise<void>;
  // 挂接（统一 Entity 模型）：media 属性写入（url 素材不支持），元素保留为独立投影（A 虚线/封面
  // 通道已退役——卡面图源改为遍历 media attrs 的统一投影）
  attachMediaElement: (elementId: string, entityId: string, opts?: { keepElement?: boolean }) => Promise<void>;
  detachMediaElement: (elementId: string) => Promise<void>;
  // 素材挂为实体 media 属性（统一 Entity 模型写通道；assetId 必填，url 素材不支持挂接）；返回新 attrKey
  attachMediaAttr: (entityId: string, media: { assetId: string; name?: string; kind: string }, label?: string) => Promise<string | null>;
  // 删除实体上的 media 属性（attrKey 精确删除；其余 attrs 保持）
  removeMediaAttr: (entityId: string, attrKey: string) => Promise<void>;
  // 最近变更（T12 语义撤销）：最近 10 条语义操作，逐条撤销
  changeLog: CanvasChange[];
  logChange: (label: string, undo: () => Promise<void> | void) => void;
  undoChange: (id: number) => Promise<void>;
  // 版本快照/回滚（T12）：快照列表 + 指针回移 + 面板开合
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  // 大纲/搜索侧栏（T14）
  outlineOpen: boolean;
  setOutlineOpen: (open: boolean) => void;
  // 详情面板停靠侧（左/右）；切换即时生效并持久化
  panelSide: PanelSide;
  panelOpen: boolean;
  setPanelSide: (side: PanelSide) => void;
  setPanelOpen: (panelOpen: boolean) => void;
  // AI 用描述添加设定（T13/B.16）：候选对话框
  aiDialogOpen: boolean;
  setAiDialogOpen: (open: boolean) => void;
  // 关系标签双击就地换类型（T15）
  relationTypePopover: { relationId: string; screenX: number; screenY: number } | null;
  setRelationTypePopover: (popover: { relationId: string; screenX: number; screenY: number } | null) => void;
  revertToRevision: (revisionId: string) => Promise<void>;
  setCreating: (creating: boolean, at?: { screenX: number; screenY: number }) => void;
  setContextMenu: (menu: CanvasContextMenu) => void;
  toast: (text: string, kind?: CanvasToast["kind"], action?: CanvasToast["action"]) => void;
  dismissToast: (id: number) => void;
};

export const useWorldCanvasStore = create<WorldCanvasState>((set, get) => ({
  apiBase: "",
  worldId: "",
  worldName: "",
  readOnly: false,
  revisionId: "",
  context: null,
  contextTrail: [],
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
  docVersion: 0,
  attrCreator: null,
  pendingRelation: null,
  inlineEdit: null,
  deleteTarget: null,
  addFieldFor: null,
  mediaSource: null,
  mediaPreview: null,
  creatingAt: null,
  contextMenu: null,
  toasts: [],
  changeLog: [],
  historyOpen: false,
  outlineOpen: false,
  panelSide: readPanelSide(),
  panelOpen: true,
  aiDialogOpen: false,
  relationTypePopover: null,
  linkMode: false,
  panMode: false,
  editor: null,

  open: (input) => {
    void flushCanvasSave();
    const state = get();
    if (state.worldId === input.worldId && state.apiBase === input.apiBase && state.readOnly === input.readOnly) {
      set({ worldName: input.worldName });
      void get().load(true);
      return;
    }
    set({
      ...input,
      context: null,
      contextTrail: [],
      entities: [],
      elements: [],
      docVersion: 0,
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
      attrCreator: null,
      pendingRelation: null,
      inlineEdit: null,
      deleteTarget: null,
      addFieldFor: null,
      mediaSource: null,
      mediaPreview: null,
      creatingAt: null,
      contextMenu: null,
      toasts: [],
      changeLog: [],
      historyOpen: false,
      outlineOpen: false,
      aiDialogOpen: false,
      relationTypePopover: null,
      linkMode: false,
      panMode: false,
    });
    void get().load(true);
  },

  load: async (force = false) => {
    const { apiBase, worldId } = get();
    if (!apiBase || !worldId) return;
    const contextId = get().context?.entityId ?? "";
    try {
      const client = createRecutWorldsClient(apiBase);
      // 文档粒度存储：刷新前先落盘当前文档的去抖窗口
      await flushCanvasSave();
      const [entityList, doc, entityTypeData] = await Promise.all([
        client.entities.list({ worldId, limit: 500, includeProvisional: true }),
        client.canvas.get({ worldId, contextId }),
        client.entityTypes.list({ worldId }),
      ]);
      const scope = entityList.items.filter((summary) => (contextId ? summary.parentId === contextId : !summary.parentId));
      const full = await Promise.all(scope.map((summary) => client.entities.get({ worldId, entityId: summary.id }).catch(() => null)));
      // 容器自身 entity 默认也在本容器画布中（T6/D3：进入子世界能直接看到当前实体卡）
      if (contextId) {
        const self = await client.entities.get({ worldId, entityId: contextId }).catch(() => null);
        if (self && (get().context?.entityId ?? "") === contextId) full.unshift(self);
      }
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
        elements: doc.elements,
        docVersion: doc.version,
        relations: relations.filter((relation) => ids.has(relation.fromEntityId) && ids.has(relation.toEntityId)),
        relationTypes: entityTypeData.relations ?? [],
        entityTypes: entityTypeData.items ?? [],
        dataVersion: get().dataVersion + 1,
        ...(force ? { notice: "" } : {}),
      });
    } catch (cause) {
      applyCanvasError(cause);
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
    // 切层前先落盘当前层文档（flush 捕获的是切换前的 context 快照）
    void flushCanvasSave();
    const prev = get().context;
    const trail = get().contextTrail;
    let nextTrail: Array<{ entityId: string; title: string }> = [];
    if (context) {
      const idx = trail.findIndex((item) => item.entityId === context.entityId);
      // 已在路径中 = 向上（面包屑点击）截断；否则 = 向下进入，追加一级
      nextTrail = idx >= 0 ? trail.slice(0, idx + 1) : [...trail, context];
    }
    set({ context, contextTrail: nextTrail, selection: null, relatingFrom: null, relatingTo: null, inlineEdit: null });
    void get().load(true);
  },

  // URL 深链恢复：实体标题就绪后走标准 setContext（面包屑/导航语义一致）
  restoreContext: async (entityId) => {
    const { apiBase, worldId } = get();
    if (!apiBase || !worldId || get().context) return;
    try {
      const entity = await createRecutWorldsClient(apiBase).entities.get({ worldId, entityId });
      if (get().context || get().worldId !== worldId) return;
      get().setContext({ entityId: entity.id, title: entity.name });
    } catch {
      // 深链可能过期（实体已删/已换世界）：静默留在根画布
    }
  },
  // 上一层容器（Cmd+[ / 面包屑折叠）：弹出一级；已到根则回全局
  exitContext: () => {
    void flushCanvasSave();
    const trail = get().contextTrail;
    if (!trail.length) return;
    const nextTrail = trail.slice(0, -1);
    const context = nextTrail.length ? nextTrail[nextTrail.length - 1] : null;
    set({ context, contextTrail: nextTrail, selection: null, relatingFrom: null, relatingTo: null, inlineEdit: null });
    void get().load(true);
  },
  zoomIn: () => set((state) => ({ zoom: Math.min(2, state.zoom + 0.2) })),
  zoomOut: () => set((state) => ({ zoom: Math.max(0.4, state.zoom - 0.2) })),
  resetZoom: () => set({ zoom: 1 }),
  // 选中元素 = 自动打开属性面板（T17：空选回落 World 态属性）；点空白清选不关面板
  select: (selection) =>
    set((state) => ({ selection, panelOpen: selection ? true : state.panelOpen })),
  startRelating: (entityId) => set({ relatingFrom: entityId, relatingTo: null, selection: null }),
  pickRelatingTarget: (entityId) => {
    const { relatingFrom } = get();
    if (!relatingFrom || relatingFrom === entityId) return;
    set({ relatingTo: entityId });
  },
  cancelRelating: () => set({ relatingFrom: null, relatingTo: null }),

  // 「+」引导菜单锚点；宿主组件以屏幕坐标渲染引导面板
  setAttrCreator: (attrCreator) => set({ attrCreator }),

  setLinkMode: (linkMode) => set({ linkMode, selection: linkMode ? null : get().selection }),

  setPanMode: (panMode) => set({ panMode }),

  setEditor: (editor) => set({ editor }),

  // 工具栏独立插入：text=自由文本元素；image/audio/video=独立属性节点（kind=attr，无属性边）
  addFreeElement: async (kind, pos) => {
    const id = `shape:${kind}-${Date.now()}`;
    const labels: Record<string, string> = { text: "文本", image: "图片", audio: "音频", video: "视频" };
    try {
      await get().upsertElement({
        id,
        contextId: get().context?.entityId ?? "",
        kind: kind === "text" ? "text" : "attr",
        refKind: "",
        refId: "",
        name: labels[kind] ?? kind,
        props: kind === "text" ? { text: "" } : { media: kind, text: "" },
        geometry:
          kind === "text"
            ? { x: Math.round(pos.x), y: Math.round(pos.y), width: 220, zIndex: 1 }
            : { x: Math.round(pos.x), y: Math.round(pos.y), width: 220, height: 150, zIndex: 1 },
        style: {},
        layer: "0",
      });
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 创建属性节点 + 属性边（两笔 world_canvas 写，均不产 revision）：
  // 属性元素 kind=attr（props.media 区分文本/图片/音频/视频），
  // 属性边 kind=arrow（props.fromElementId → toElementId + attrMedia + edgeType —— 边类型：
  // attr=属性边；其他取受控关系词表的类型名做语义标签）。同处当前上下文（Level 语义由
  // world_canvas 的 contextId 承担：全局=Level 0，实体容器=该实体的属性层）。
  createAttribute: async (fromElementId, media, pos, initial, edgeType = "attr") => {
    set({ attrCreator: null });
    const attrId = `shape:attr-${Date.now()}`;
    const arrowId = `shape:arrow-${Date.now()}`;
    const contextId = get().context?.entityId ?? "";
    const mediaLabels: Record<AttrMedia, string> = { text: "文本", image: "图片", audio: "音频", video: "视频" };
    try {
      await get().upsertElement({
        id: attrId,
        contextId,
        kind: "attr",
        refKind: "",
        refId: "",
        name: initial?.label ? `属性 · ${initial.label}` : `属性 · ${mediaLabels[media]}`,
        props: {
          media,
          text: initial?.text ?? "",
          fileName: initial?.fileName ?? "",
          label: initial?.label ?? "",
          ...(initial?.assetId ? { assetId: initial.assetId, assetName: initial.assetName ?? "" } : {}),
        },
        geometry: { x: Math.round(pos.x), y: Math.round(pos.y), width: 260, height: 140, zIndex: 1 },
        style: {},
        layer: "0",
      });
      await get().upsertElement({
        id: arrowId,
        contextId,
        kind: "arrow",
        refKind: "",
        refId: "",
        name: `属性边 · ${initial?.label || mediaLabels[media]}`,
        props: { fromElementId, toElementId: attrId, attrMedia: media, edgeType },
        geometry: { x: Math.round(pos.x), y: Math.round(pos.y), zIndex: 1 },
        style: {},
        layer: "0",
      });
      return attrId;
    } catch (cause) {
      applyCanvasError(cause);
      return null;
    }
  },

  // 属性值同步（边即属性关联）：attr 元素 → 找到挂到它的属性边 → fromElementId 解析实体；
  // label 优先映射 type schema 字段 key（右侧面板落在「字段」区），否则以 label 为 content key
  syncAttrValue: async (element, text) => {
    const label = String(element.props?.label ?? "") || String(element.name ?? "").replace(/^属性 · /, "");
    if (!label) return;
    const arrow = get().elements.find(
      (item) => item.kind === "arrow" && String(item.props?.toElementId ?? "") === element.id && String(item.props?.edgeType ?? "attr") === "attr",
    );
    const entityId = String(arrow?.props?.fromElementId ?? "").replace(/^shape:/, "");
    const entity = get().entities.find((item) => item.id === entityId);
    if (!entity) return;
    const entityType = get().entityTypes.find((item) => item.id === entity.typeId);
    const matched = (entityType?.fields ?? []).find((field) => (field.label ?? field.key) === label || field.key === label);
    await get().saveEntityField(entity, { attrKey: matched?.key ?? label, value: text });
    // 属性投影同步（文档版）：attr 元素 props.value 回写进本地文档，随统一保存落库
    markCanvasDirty(element.id);
    set((state) => ({
      elements: state.elements.map((item) =>
        item.kind === "attr" && item.refId === entity.id
          ? { ...item, props: { ...(item.props ?? {}), value: text } }
          : item,
      ),
    }));
    scheduleCanvasSave();
  },

  // 属性重命名（画布命名态与右侧边面板共用）：写 props.label + 元素名，并同步属性边名与实体 content 字段；
  // dataVersion 推进让投影层（卡片徽标/边标签）立即重建
  renameAttrLabel: async (elementId, label) => {
    const trimmed = label.trim() || "属性";
    await get().persistGeometry(elementId, undefined, { label: trimmed });
    set((state) => ({
      elements: state.elements.map((item) => {
        if (item.id === elementId) return { ...item, name: `属性 · ${trimmed}` };
        if (item.kind === "arrow" && String(item.props?.toElementId ?? "") === elementId && String(item.props?.edgeType ?? "attr") === "attr") {
          return { ...item, name: `属性边 · ${trimmed}` };
        }
        return item;
      }),
      dataVersion: state.dataVersion + 1,
    }));
    const named = get().elements.find((item) => item.id === elementId);
    // 媒体属性卡（props.media≠text）props.text 恒为空，同步空值会把实体 media 属性值冲掉——跳过
    if (named && String(named.props?.media ?? "text") === "text") await get().syncAttrValue(named, String(named.props?.text ?? ""));
  },

  moveElement: (id, x, y) => {
    markCanvasDirty(id);
    set((state) => {
      if (!state.elements.some((element) => element.id === id)) {
        // 首次拖拽尚未入文档的元素（罕见兜底）：先落一个本地影子元素，随统一保存落库
        const isWorld = id === WORLD_ELEMENT_ID;
        const ghost: WorldCanvasElement = {
          id,
          worldId: state.worldId,
          contextId: state.context?.entityId ?? "",
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
    });
  },

  upsertElement: (input) => {
    // 文档粒度存储（RFC 2026-09-09）：元素变更只改本地文档，随去抖整包保存落库
    const now = new Date().toISOString();
    const saved: WorldCanvasElement = {
      id: input.id,
      worldId: get().worldId,
      contextId: input.contextId ?? get().context?.entityId ?? "",
      kind: input.kind,
      refKind: input.refKind ?? "",
      refId: input.refId ?? "",
      name: input.name ?? "",
      props: input.props ?? {},
      geometry: input.geometry ?? {},
      style: input.style ?? {},
      layer: input.layer ?? "0",
      createdAt: get().elements.find((element) => element.id === input.id)?.createdAt ?? now,
      updatedAt: now,
    };
    markCanvasDirty(input.id);
    set((state) => ({
      elements: [...state.elements.filter((element) => element.id !== saved.id), saved],
      // 元素增删/属性更新都推进 dataVersion：文档同步层按 block id diff（T1-c），
      // 属性更新走 updateRecord 原地更新，不再全量重建
      dataVersion: state.dataVersion + 1,
    }));
    scheduleCanvasSave();
    return Promise.resolve(saved);
  },

  // 把画布元素（几何/属性覆盖后）写进本地文档，随统一保存落库；文本提交共用此路径。
  persistGeometry: (id, geometryOverride, propsOverride) => {
    markCanvasDirty(id);
    set((state) => ({
      elements: state.elements.map((element) =>
        element.id === id
          ? {
              ...element,
              props: { ...(element.props ?? {}), ...(propsOverride ?? {}) },
              geometry: { ...(element.geometry ?? {}), ...(geometryOverride ?? {}) },
              updatedAt: new Date().toISOString(),
            }
          : element,
      ),
    }));
    scheduleCanvasSave();
    return Promise.resolve();
  },

  // T3 创建系统：标题缺省用类型默认名；创建即写库（无草稿流程，直接落正式实体），
  // 直接落默认标题卡片，不进入命名态（改名走双击实体卡/右侧面板）
  createEntity: async (kind, opts = {}) => {
    const { apiBase, worldId } = get();
    const title = opts.title?.trim() || DEFAULT_ENTITY_TITLES[kind] || "新设定";
    const run = async (revisionId: string) => {
      const entity = await createRecutWorldsClient(apiBase).entities.upsert({
        worldId,
        typeId: kind as EntityKind,
        name: title,
        // 容器内创建 = 该实体的子设定（递归容器）：不挂 parent 会落回全局，进子世界后过滤不到
        ...(get().context?.entityId ? { parentId: get().context!.entityId } : {}),
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
      const pos = opts.pos ?? gridPosition(get().elements.length);
      await get().upsertElement({
        id: `shape:${entity.id}`,
        contextId: get().context?.entityId ?? "",
        kind: "entity",
        refKind: "entity",
        refId: entity.id,
        name: entity.name,
        props: { collapsed: false },
        geometry: { ...pos, ...DEFAULT_ENTITY_SIZE, zIndex: 1 },
        style: {},
        layer: "0",
      });
      // 增量投影：合并返回对象（entity 卡由 entities 驱动渲染，dataVersion 必须在合并后推进，
      // 否则与 upsertElement 之间的 await 边界会让文档重建跑在实体合并之前 → 卡片不出现）
      set((state) => ({
        entities: upsertById(state.entities, entity),
        elements: state.elements.map((element) =>
          element.refKind === "entity" && element.refId === entity.id ? { ...element, name: entity.name } : element,
        ),
        dataVersion: state.dataVersion + 1,
        creating: false,
        creatingAt: null,
        selection: { type: "entity", entity },
      }));
      saveLastKind(kind);
      get().logChange(`创建「${entity.name}」`, () => void get().deleteEntity(entity.id));
      return entity.id;
    } catch (cause) {
      applyCanvasError(cause);
      return null;
    }
  },

  createChildEntity: async (parentId, kind, opts = {}) => {
    const { apiBase, worldId } = get();
    const title = opts.title?.trim() || DEFAULT_ENTITY_TITLES[kind] || "新设定";
    const run = async (revisionId: string) =>
      createRecutWorldsClient(apiBase).entities.children({
        worldId,
        entityId: parentId,
        typeId: kind as EntityKind,
        name: title,
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
        name: child.name,
        props: { collapsed: false },
        geometry: { x: 40, y: 40, ...DEFAULT_ENTITY_SIZE, zIndex: 1 },
        style: {},
        layer: "0",
      });
      // 增量投影：合并子实体并同步父实体的 children 摘要（T1-a）；dataVersion 在合并后推进
      set((state) => ({
        entities: upsertById(
          state.entities.map((entity) =>
            entity.id === parentId && entity.children && !entity.children.some((item) => item.id === child.id)
              ? { ...entity, children: [...entity.children, { id: child.id, typeId: child.typeId, name: child.name, intro: child.intro, worldId: child.worldId, parentId: child.parentId, containerRole: child.containerRole, isProvisional: child.isProvisional, updatedAt: child.updatedAt }] }
              : entity,
          ),
          child,
        ),
        dataVersion: state.dataVersion + 1,
        creating: false,
        creatingAt: null,
        selection: { type: "entity", entity: child },
      }));
      saveLastKind(kind);
      get().logChange(`创建「${child.name}」`, () => void get().deleteEntity(child.id));
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  addNote: async (pos) => {
    const id = `shape:note-${Date.now()}`;
    const fallback = { x: 60 + (get().elements.length % 3) * 200, y: 60 + Math.floor(get().elements.length / 3) * 160 };
    const at = pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : fallback;
    try {
      await get().upsertElement({
        id,
        contextId: get().context?.entityId ?? "",
        kind: "note",
        refKind: "",
        refId: "",
        name: "便签",
        props: { text: "" },
        geometry: { ...at, ...NOTE_SIZE, zIndex: 1 },
        style: { color: "#fde68a" },
        layer: "0",
      });
      await get().load(true);
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  removeElement: async (id) => {
    // 已挂接媒体元素删除 = 归档其证据（B.8：删除元素 ≠ 删除证据，但挂接关系解除）
    const element = get().elements.find((item) => item.id === id);
    if (element?.kind === "media" && element.props?.evidenceId) {
      try {
        await createRecutWorldsClient(get().apiBase).evidence.archive({
          worldId: get().worldId,
          evidenceId: String(element.props.evidenceId),
          expectedRevisionId: get().revisionId,
        });
      } catch (cause) {
        applyCanvasError(cause);
      }
    }
    // 文档粒度存储：本地移除 + 统一保存落库
    markCanvasDirty(id, true);
    set((state) => ({
      elements: state.elements.filter((element) => element.id !== id),
      dataVersion: state.dataVersion + 1,
      selection:
        state.selection?.type === "entity" && id === `shape:${state.selection.entity.id}` ? null : state.selection,
    }));
    scheduleCanvasSave();
  },

  createRelation: async (fromEntityId, toEntityId, relationType, opts = {}) => {
    // 自环禁止（B.10）
    if (fromEntityId === toEntityId) {
      set({ pendingRelation: null, relatingFrom: null, relatingTo: null });
      get().toast("不能与自身建立关系", "error");
      return;
    }
    // 同一双端/同类型去重（历史数据可能存在重复边，不再追加）
    if (get().relations.some((relation) => relation.fromEntityId === fromEntityId && relation.toEntityId === toEntityId && relation.type === relationType)) {
      set({ pendingRelation: null, relatingFrom: null, relatingTo: null });
      get().toast("已存在这条关系", "info");
      return;
    }
    const run = async (revisionId: string) =>
      createRecutWorldsClient(get().apiBase).relations.create({
        worldId: get().worldId,
        fromEntityId,
        toEntityId,
        relationType,
        scopeEntityId: opts.scopeEntityId !== undefined ? opts.scopeEntityId : get().context?.entityId || undefined,
        expectedRevisionId: revisionId,
      });
    try {
      const relation = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      set({ relatingFrom: null, relatingTo: null, pendingRelation: null });
      // 增量投影：合并返回的关系（仅当前 context scope 且两端可见，与 load 同一过滤规则）
      const contextId = get().context?.entityId ?? "";
      const ids = new Set(get().entities.map((entity) => entity.id));
      if (
        relation.fromEntityId !== relation.toEntityId &&
        ids.has(relation.fromEntityId) &&
        ids.has(relation.toEntityId) &&
        (!relation.scopeEntityId || relation.scopeEntityId === contextId)
      ) {
        set((state) => ({ relations: upsertById(state.relations, relation), dataVersion: state.dataVersion + 1 }));
      }
      // 结构性轻反馈（B.4）
      const titleOf = (id: string) => get().entities.find((entity) => entity.id === id)?.name ?? id;
      const scopeSuffix = relation.scopeEntityId ? "（局部）" : "";
      get().toast(`已建立关系：${titleOf(relation.fromEntityId)} → ${titleOf(relation.toEntityId)}${scopeSuffix}`, "success");
      get().logChange(`建立关系 ${titleOf(relation.fromEntityId)}→${titleOf(relation.toEntityId)}`, () => void get().removeRelation(relation.id));
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  updateRelation: async (relation, patch) => {
    const nextType = patch.relationType?.trim() || relation.type;
    const nextFrom = patch.fromEntityId || relation.fromEntityId;
    const nextTo = patch.toEntityId || relation.toEntityId;
    if (nextType === relation.type && nextFrom === relation.fromEntityId && nextTo === relation.toEntityId) return;
    if (nextFrom === nextTo) {
      get().toast("不能与自身建立关系", "error");
      return;
    }
    const run = async (revisionId: string) =>
      createRecutWorldsClient(get().apiBase).relations.update({
        worldId: get().worldId,
        relationId: relation.id,
        ...(nextType !== relation.type ? { relationType: nextType } : {}),
        ...(nextFrom !== relation.fromEntityId ? { fromEntityId: nextFrom } : {}),
        ...(nextTo !== relation.toEntityId ? { toEntityId: nextTo } : {}),
        expectedRevisionId: revisionId,
      });
    try {
      const saved = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      set((state) => ({
        relations: state.relations.map((item) => (item.id === saved.id ? saved : item)),
        selection:
          state.selection?.type === "relation" && state.selection.relation.id === saved.id
            ? { type: "relation", relation: saved }
            : state.selection,
        dataVersion: state.dataVersion + 1,
      }));
      const titleOf = (id: string) => get().entities.find((entity) => entity.id === id)?.name ?? id;
      if (nextFrom === relation.fromEntityId && nextTo === relation.toEntityId) {
        get().toast(`关系类型已改为 ${nextType}`, "success");
      } else {
        get().toast(`关系方向已改为 ${titleOf(nextFrom)} → ${titleOf(nextTo)}`, "success");
      }
      get().logChange(
        `修改关系 ${titleOf(relation.fromEntityId)}→${titleOf(relation.toEntityId)}`,
        () => void get().updateRelation(saved, { relationType: relation.type, fromEntityId: relation.fromEntityId, toEntityId: relation.toEntityId }),
      );
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  changeRelationType: async (relation, relationType) => {
    if (relation.type === relationType) return;
    await get().updateRelation(relation, { relationType });
  },

  swapRelationDirection: async (relation) => {
    await get().updateRelation(relation, { fromEntityId: relation.toEntityId, toEntityId: relation.fromEntityId });
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
      set((state) => ({
        relations: state.relations.filter((relation) => relation.id !== relationId),
        dataVersion: state.dataVersion + 1,
      }));
      const removed = get().relations.find((relation) => relation.id === relationId);
      if (removed) {
        get().logChange(`删除关系 ${removed.type}`, () => void get().createRelation(removed.fromEntityId, removed.toEntityId, removed.type, { scopeEntityId: removed.scopeEntityId ?? undefined }));
      }
      get().toast("已删除此关系", "success");
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 关系锚点持久化：落在固有 anchor 元素上（kind=arrow + relationId，不渲染为连线投影）；
  // 传 undefined 即清除锚点覆盖（回落默认中心）。释放时清除 undefined 的 key 由 JSON 序列化自然裁剪。
  persistRelationGeometry: async (relationId, geometry) => {
    try {
      await get().upsertElement({
        id: `shape:rel-${relationId}`,
        contextId: get().context?.entityId ?? "",
        kind: "arrow",
        refKind: "",
        refId: relationId,
        name: "关系锚点",
        props: { relationId, fromAnchor: geometry.fromAnchor, toAnchor: geometry.toAnchor, bend: geometry.bend },
        geometry: { x: 0, y: 0, zIndex: 0 },
        style: {},
        layer: "0",
      });
    } catch (cause) {
      applyCanvasError(cause);
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
      const result = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      set({ promotingId: null });
      // 增量投影：按 promote 结果合并（T1-a）；note 元素被服务端改绑为实体投影，本地同步该变更
      if (result.promoted === "entity") {
        set((state) => ({
          entities: upsertById(state.entities, result.entity),
          elements: state.elements.map((element) =>
            element.id === elementId
              ? { ...element, kind: "entity", refKind: "entity", refId: result.entity.id, name: result.entity.name }
              : element,
          ),
        }));
      } else {
        const contextId = get().context?.entityId ?? "";
        const ids = new Set(get().entities.map((entity) => entity.id));
        const relation = result.relation;
        if (ids.has(relation.fromEntityId) && ids.has(relation.toEntityId) && (!relation.scopeEntityId || relation.scopeEntityId === contextId)) {
          set((state) => ({ relations: upsertById(state.relations, relation) }));
        }
      }
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  setCreating: (creating, at) => set({ creating, creatingAt: at ?? null }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  // toast：3s 自消（错误带动作不自动消）
  toast: (text, kind = "info", action) => {
    const id = Date.now() + Math.random();
    set((state) => ({ toasts: [...state.toasts.slice(-2), { id, text, kind, action }] }));
    if (!action) setTimeout(() => get().dismissToast(id), 3000);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),

  // 最近变更（T12）：至多 10 条，后进先出撤销
  logChange: (label, undo) =>
    set((state) => ({ changeLog: [{ id: Date.now() + Math.random(), label, at: new Date().toLocaleTimeString(), undo }, ...state.changeLog].slice(0, 10) })),
  undoChange: async (id) => {
    const entry = get().changeLog.find((item) => item.id === id);
    if (!entry) return;
    set((state) => ({ changeLog: state.changeLog.filter((item) => item.id !== id) }));
    await entry.undo();
    get().toast(`已撤销：${entry.label}`, "success");
  },
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  setOutlineOpen: (outlineOpen) => set({ outlineOpen }),

  setPanelSide: (side) => {
    savePanelSide(side);
    set({ panelSide: side });
  },
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setAiDialogOpen: (aiDialogOpen) => set({ aiDialogOpen }),
  setRelationTypePopover: (relationTypePopover) => set({ relationTypePopover }),
  // 回滚（T12）：非破坏指针回移；成功后全量刷新 + 更新 revisionId
  revertToRevision: async (revisionId) => {
    try {
      const detail = await createRecutWorldsClient(get().apiBase).revisions.revert({
        worldId: get().worldId,
        revisionId,
        expectedRevisionId: get().revisionId || undefined,
      });
      if (detail.revision?.id) set({ revisionId: detail.revision.id, worldName: detail.name, historyOpen: false });
      await get().load(true);
      get().toast("已回滚到所选版本", "success");
    } catch (cause) {
      applyCanvasError(cause);
    }
  },
  setPromoting: (promotingId) => set({ promotingId }),
  setPendingRelation: (pendingRelation) => set({ pendingRelation }),
  setDeleteTarget: (deleteTarget) => set({ deleteTarget }),
  setAddFieldFor: (addFieldFor) => set({ addFieldFor }),

  // 就地编辑（T4）：状态由插件双击写入，宿主渲染 DOM 编辑器；提交经 persistGeometry（props.text）
  startInlineEdit: (edit) => set({ inlineEdit: edit }),
  cancelInlineEdit: () => set({ inlineEdit: null }),

  // 右键/菜单触发的实体重命名：命名态同一通道（rect = 卡标题行世界坐标）
  startEntityRename: (entityId) => {
    const state = get();
    const entity = state.entities.find((item) => item.id === entityId);
    const element = state.elements.find((item) => item.refKind === "entity" && item.refId === entityId);
    if (!entity || !element) return;
    const x = Number(element.geometry?.x) || 0;
    const y = Number(element.geometry?.y) || 0;
    const width = Math.max(Number(element.geometry?.width) || DEFAULT_ENTITY_SIZE.width, 240);
    const height = Number(element.geometry?.height) || DEFAULT_ENTITY_SIZE.height;
    const contentH = entityCardContentHeight({ photoUrls: entityPhotoUrls(state.apiBase, entity).slice(0, 9) });
    const imageH = ENTITY_CARD_IMAGE_H + Math.max(0, Math.max(height, contentH) - contentH);
    set({
      inlineEdit: {
        kind: "entity-title",
        entityId,
        rect: { x, y: y + imageH + ENTITY_CARD_PAD - 2, width: width - ENTITY_CARD_PAD * 2, height: 24 },
        value: entity.name,
      },
    });
  },

  // 右键/菜单触发的便签/文本正文编辑（T4 面板与画布同一保存通道）
  startElementBodyEdit: (elementId, kind) => {
    const element = get().elements.find((item) => item.id === elementId);
    if (!element) return;
    const x = Number(element.geometry?.x) || 0;
    const y = Number(element.geometry?.y) || 0;
    const width = Math.max(Number(element.geometry?.width) || NOTE_SIZE.width, 120);
    // 各形态的默认高度与画布 Block 对齐：文本块默认 24；便签/属性沿用几何高度（缺省为便签高）
    const fallbackHeight = kind === "text-body" ? 24 : NOTE_SIZE.height;
    const height = Math.max(Number(element.geometry?.height) || fallbackHeight, 24);
    set({
      inlineEdit: {
        kind,
        elementId,
        rect: { x, y, width, height },
        value: String(element.props?.text ?? ""),
      },
    });
  },

  commitInlineEdit: async (value) => {
    const edit = get().inlineEdit;
    set({ inlineEdit: null });
    if (!edit) return;
    if (edit.kind === "entity-title") {
      const entity = get().entities.find((item) => item.id === edit.entityId);
      if (entity) await get().renameEntity(entity, value);
      return;
    }
    const element = get().elements.find((item) => item.id === edit.elementId);
    if (!element) return;
    // 属性命名态：重命名属性（label + 元素名 + 属性边名），并把当前文本登记为实体 content 字段
    if (edit.kind === "attr-title") {
      await get().renameAttrLabel(element.id, value);
      return;
    }
    // 属性文本编辑：持久化 text 并同步回实体 content 字段
    if (edit.kind === "attr-body") {
      if ((element.props?.text ?? "") === value) return;
      await get().persistGeometry(element.id, undefined, { text: value });
      await get().syncAttrValue(element, value);
      return;
    }
    // 未变更不写库
    if ((element.props?.text ?? "") === value) return;
    await get().persistGeometry(element.id, undefined, { text: value });
  },

  renameEntity: async (entity, title) => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === entity.name) return;
    const { apiBase, worldId } = get();
    // 统一 Entity 模型（RFC 2026-09-09）：upsert = 全量字段语义，携带当前 full attrs + name/intro/detail
    const run = (revisionId: string) =>
      createRecutWorldsClient(apiBase).entities.upsert({
        worldId,
        entityId: entity.id,
        typeId: entity.typeId,
        name: trimmed,
        intro: entity.intro,
        detail: entity.detail,
        attrs: entity.attrs,
        expectedRevisionId: revisionId,
      });
    try {
      const saved = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      // 合并实体 + 同步元素投影（卡片徽标/命中标题读元素 name）；dataVersion 推进文档 diff
      set((state) => ({
        entities: upsertById(state.entities, saved),
        elements: state.elements.map((element) =>
          element.refKind === "entity" && element.refId === saved.id ? { ...element, name: saved.name } : element,
        ),
        dataVersion: state.dataVersion + 1,
      }));
      get().logChange(`重命名「${saved.name}」`, () => void get().renameEntity(saved, entity.name));
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 字段保存（T2，统一 Entity 模型）：单字段 patch（attrKey+value）或 name/intro/detail；
  // attrs 为全量替换语义 —— 取当前 full attrs 拷贝、按 attrKey 原位 patch 后整包 upsert；草稿不产 revision（B.5）
  saveEntityField: async (entity, patch) => {
    const { apiBase, worldId } = get();
    const attrs: EntityAttr[] = (entity.attrs ?? []).map((attr) => ({ ...attr }));
    let attrIndex = -1;
    if (patch.attrKey !== undefined) {
      attrIndex = attrs.findIndex((attr) => attr.key === patch.attrKey);
      if (attrIndex >= 0) attrs[attrIndex] = { ...attrs[attrIndex], value: patch.value };
      else attrs.push({ key: patch.attrKey, label: patch.attrLabel ?? patch.attrKey, type: patch.attrType ?? "text", ...(patch.attrOptions?.length ? { options: [...patch.attrOptions] } : {}), ...(patch.value !== undefined ? { value: patch.value as unknown } : {}) });
    }
    const name = patch.name !== undefined ? patch.name : entity.name;
    const intro = patch.intro !== undefined ? patch.intro : entity.intro;
    const detail = patch.detail !== undefined ? patch.detail : entity.detail;
    const run = (revisionId: string) =>
      createRecutWorldsClient(apiBase).entities.upsert({
        worldId,
        entityId: entity.id,
        typeId: entity.typeId,
        name,
        intro,
        detail,
        attrs,
        expectedRevisionId: revisionId,
      });
    try {
      const saved = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      set((state) => ({
        entities: upsertById(state.entities, saved),
        elements: state.elements.map((element) =>
          element.refKind === "entity" && element.refId === saved.id ? { ...element, name: saved.name } : element,
        ),
        dataVersion: state.dataVersion + 1,
      }));
      // 语义撤销（T12）：单字段回写旧值；attr 新建撤销 = 旧值 undefined
      const undoPatch: { name?: string; intro?: string; detail?: string; attrKey?: string; attrLabel?: string; attrType?: EntityAttr["type"]; value?: unknown } = {};
      if (patch.name !== undefined) undoPatch.name = entity.name;
      if (patch.intro !== undefined) undoPatch.intro = entity.intro;
      if (patch.detail !== undefined) undoPatch.detail = entity.detail;
      if (patch.attrKey !== undefined) {
        undoPatch.attrKey = patch.attrKey;
        undoPatch.attrLabel = patch.attrLabel;
        undoPatch.attrType = patch.attrType;
        undoPatch.value = attrIndex >= 0 ? entity.attrs?.[attrIndex]?.value : undefined;
      }
      get().logChange(`修改「${name}」`, () => void get().saveEntityField(entity, undoPatch));
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  confirmEntity: async (entityId) => {
    const run = (revisionId: string) =>
      createRecutWorldsClient(get().apiBase).entities.promote({ worldId: get().worldId, entityId, expectedRevisionId: revisionId });
    try {
      const entity = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      set((state) => ({
        entities: upsertById(state.entities, entity),
        elements: state.elements.map((element) =>
          element.refKind === "entity" && element.refId === entity.id ? { ...element, name: entity.name } : element,
        ),
        dataVersion: state.dataVersion + 1,
      }));
      get().logChange(`确认设定「${entity.name}」`, () => {});
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  deleteEntity: async (entityId) => {
    const run = (revisionId: string) =>
      createRecutWorldsClient(get().apiBase).entities.remove({ worldId: get().worldId, entityId, expectedRevisionId: revisionId });
    try {
      await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      set((state) => ({
        entities: state.entities.filter((entity) => entity.id !== entityId),
        elements: state.elements.filter((element) => !(element.refKind === "entity" && element.refId === entityId)),
        relations: state.relations.filter((relation) => relation.fromEntityId !== entityId && relation.toEntityId !== entityId),
        selection: state.selection?.type === "entity" && state.selection.entity.id === entityId ? null : state.selection,
        dataVersion: state.dataVersion + 1,
      }));
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  updateWorldMeta: async (patch) => {
    const run = (revisionId?: string) =>
      createRecutWorldsClient(get().apiBase).update({ worldId: get().worldId, ...patch, expectedRevisionId: revisionId });
    try {
      const detail = await run(get().revisionId || undefined).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId || undefined);
      });
      if (detail.revision?.id) set({ revisionId: detail.revision.id });
      if (patch.name !== undefined) set({ worldName: detail.name });
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // ---------- T8 媒体元素与证据 ----------

  setMediaSource: (mediaSource) => set({ mediaSource }),

  // 画面删除（T16）：实体投影元素 props.hidden = true（元素保留，设定不动，不产 revision）
  hideEntityFromCanvas: async (entityId) => {
    const element = get().elements.find((item) => item.refKind === "entity" && item.refId === entityId);
    if (!element) return;
    try {
      await get().upsertElement({
        id: element.id,
        contextId: element.contextId ?? "",
        kind: element.kind,
        refKind: element.refKind ?? "",
        refId: element.refId ?? "",
        name: element.name ?? "",
        props: { ...(element.props ?? {}), hidden: true },
        geometry: element.geometry ?? {},
        style: element.style ?? {},
        layer: element.layer ?? "0",
      });
      set((state) => ({
        selection: state.selection?.type === "entity" && state.selection.entity.id === entityId ? null : state.selection,
      }));
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 放回画布（T16）：清除 hidden；无投影元素时在网格位重建
  unhideEntity: async (entityId) => {
    const state = get();
    const entity = state.entities.find((item) => item.id === entityId);
    if (!entity) return;
    const element = state.elements.find((item) => item.refKind === "entity" && item.refId === entityId);
    try {
      if (element) {
        await get().upsertElement({
          id: element.id,
          contextId: element.contextId ?? "",
          kind: element.kind,
          refKind: element.refKind ?? "",
          refId: element.refId ?? "",
          name: element.name ?? "",
          props: { ...(element.props ?? {}), hidden: false },
          geometry: element.geometry ?? {},
          style: element.style ?? {},
          layer: element.layer ?? "0",
        });
      } else {
        await get().upsertElement({
          id: `shape:${entityId}`,
          contextId: state.context?.entityId ?? "",
          kind: "entity",
          refKind: "entity",
          refId: entityId,
          name: entity.name,
          props: { collapsed: false },
          geometry: { ...gridPosition(state.elements.length), ...DEFAULT_ENTITY_SIZE, zIndex: 1 },
          style: {},
          layer: "0",
        });
      }
    } catch (cause) {
      applyCanvasError(cause);
    }
  },
  setMediaPreview: (mediaPreview) => set({ mediaPreview }),

  // 面板换图（媒体元素）：null = 清除（保留元素骨架，待用户重新选择来源）
  setMediaElementAsset: async (elementId, media) => {
    try {
      await get().persistGeometry(elementId, undefined, media ? { assetId: media.assetId, name: media.name ?? "" } : { assetId: "", name: "" });
      set((state) => ({ dataVersion: state.dataVersion + 1 }));
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 面板换图（attr 属性元素）：props 持久化 + （若挂到实体）字段值回写 = 统一 Entity 模型的 media 属性
  setAttrMediaAsset: async (elementId, media) => {
    try {
      await get().persistGeometry(elementId, undefined, media ? { assetId: media.assetId, assetName: media.name ?? "" } : { assetId: "", assetName: "" });
      set((state) => ({ dataVersion: state.dataVersion + 1 }));
      const element = get().elements.find((item) => item.id === elementId);
      if (element && media) {
        // 属性边即属性关联：解析实体与字段映射，media 属性值 = {assetId,name,kind}（与 AssetFieldRow 同构）
        const arrow = get().elements.find(
          (item) => item.kind === "arrow" && String(item.props?.toElementId ?? "") === element.id && String(item.props?.edgeType ?? "attr") === "attr",
        );
        const entityId = String(arrow?.props?.fromElementId ?? "").replace(/^shape:/, "");
        const entity = get().entities.find((item) => item.id === entityId);
        if (entity) {
          const label = String(element.props?.label ?? "") || String(element.name ?? "").replace(/^属性 · /, "");
          const kind = String(element.props?.media ?? "image");
          const entityType = get().entityTypes.find((item) => item.id === entity.typeId);
          const matched = (entityType?.fields ?? []).find((field) => (field.label ?? field.key) === label || field.key === label);
          await get().saveEntityField(entity, {
            attrKey: matched?.key ?? label,
            attrLabel: label,
            attrType: "media",
            value: { assetId: media.assetId, ...(media.name ? { name: media.name } : {}), kind },
          });
        }
      }
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 独立媒体元素落画布（kind='media'；不产 revision）
  addMediaElement: async (props, pos) => {
    try {
      await get().upsertElement({
        id: `shape:media-${Date.now()}`,
        contextId: get().context?.entityId ?? "",
        kind: "media",
        refKind: "",
        refId: "",
        name: props.name ?? "媒体",
        props: { modality: props.modality, assetId: props.assetId ?? "", url: props.url ?? "" },
        geometry: { x: Math.round(pos.x), y: Math.round(pos.y), width: 220, height: 150, zIndex: 1 },
        style: {},
        layer: "0",
      });
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 素材挂为实体 media 属性（统一 Entity 模型）：attrKey 生成 `a_<ts>`，全量 attrs 替换语义；
  // 冲突重试一次（复用 saveEntityField 的 upsert 约定），返回新 attrKey（失败 = null）
  attachMediaAttr: async (entityId, media, label) => {
    const entity = get().entities.find((item) => item.id === entityId);
    if (!entity) return null;
    const attrKey = `a_${Date.now().toString(36)}`;
    try {
      await get().saveEntityField(entity, {
        attrKey,
        attrLabel: label ?? modalityLabelOf(media.kind),
        attrType: "media",
        value: { assetId: media.assetId, ...(media.name ? { name: media.name } : {}), kind: media.kind },
      });
      return attrKey;
    } catch (cause) {
      applyCanvasError(cause);
      return null;
    }
  },

  // 删除实体 media 属性：全量 attrs 过滤后 upsert（冲突重试一次）
  removeMediaAttr: async (entityId, attrKey) => {
    const entity = get().entities.find((item) => item.id === entityId);
    if (!entity) return;
    const removedValue = attrValueOf(entity, attrKey);
    const attrs = (entity.attrs ?? []).filter((attr) => attr.key !== attrKey);
    const { apiBase, worldId } = get();
    const run = (revisionId: string) =>
      createRecutWorldsClient(apiBase).entities.upsert({
        worldId,
        entityId: entity.id,
        typeId: entity.typeId,
        name: entity.name,
        intro: entity.intro,
        detail: entity.detail,
        attrs,
        expectedRevisionId: revisionId,
      });
    try {
      const saved = await run(get().revisionId).catch(async (cause) => {
        if (!isRevisionConflict(cause)) throw cause;
        await get().refreshRevision();
        return run(get().revisionId);
      });
      const attrIndex = (entity.attrs ?? []).findIndex((attr) => attr.key === attrKey);
      set((state) => ({ entities: upsertById(state.entities, saved), dataVersion: state.dataVersion + 1 }));
      // 语义撤销：把被删属性原样塞回（saveEntityField 按 key patch，属性已不存在 → 重建）
      get().logChange("删除素材属性", () => {
        const current = useWorldCanvasStore.getState().entities.find((item) => item.id === entity.id);
        if (current) {
          void get().saveEntityField(current, {
            attrKey,
            attrLabel: entity.attrs?.[attrIndex]?.label ?? attrKey,
            attrType: entity.attrs?.[attrIndex]?.type ?? "media",
            value: removedValue,
          });
        }
      });
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 挂接（统一 Entity 模型）：写入 media 属性 + 元素 props 记 attrKey（换挂先删旧属性）；不再画
  // A 虚线、不再有封面通道——卡面图源 = 实体 attrs 中 media 的统一投影
  attachMediaElement: async (elementId, entityId) => {
    const element = get().elements.find((item) => item.id === elementId);
    if (!element) return;
    const entity = get().entities.find((item) => item.id === entityId);
    if (!entity) return;
    const assetId = String(element.props?.assetId ?? "");
    if (!assetId) {
      get().toast("URL 素材暂不支持挂接为设定字段，已保留为独立素材", "info");
      return;
    }
    // 换挂：先前已挂过的旧 media 属性解除引用（不删用户数据）
    const prevAttrKey = element.props?.attrKey ? String(element.props.attrKey) : "";
    const prevEntityId = element.props?.entityId ? String(element.props.entityId) : "";
    try {
      const kind = String(element.props?.modality ?? "image");
      const attrKey = await get().attachMediaAttr(entityId, {
        assetId,
        name: typeof element.name === "string" && element.name ? element.name : undefined,
        kind,
      });
      if (!attrKey) return;
      set((state) => ({
        elements: state.elements.map((item) =>
          item.id === elementId ? { ...item, props: { ...(item.props ?? {}), attrKey, entityId } } : item,
        ),
      }));
      if (prevAttrKey && prevAttrKey !== attrKey && prevEntityId === entityId) await get().removeMediaAttr(entityId, prevAttrKey);
      get().logChange(`添加「${entity.name}」的媒体属性`, () => void get().removeMediaAttr(entityId, attrKey));
      get().toast(`已将${modalityLabelOf(kind)}添加为「${entity.name}」的媒体属性`, "success");
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 解挂：移除 A 线 + 删除实体上的 media 属性（legacy evidenceId 证据仍走 archive 只读兼容通道）
  detachMediaElement: async (elementId) => {
    const element = get().elements.find((item) => item.id === elementId);
    const attrKey = element?.props?.attrKey ? String(element.props.attrKey) : "";
    const evidenceId = element?.props?.evidenceId;
    const entityId = element?.props?.entityId ? String(element.props.entityId) : "";
    try {
      const line = get().elements.find((item) => item.kind === "arrow" && item.props?.fromElementId === elementId && item.props?.edgeType === "attach");
      if (line) {
        markCanvasDirty(line.id, true);
        scheduleCanvasSave();
      }
      set((state) => ({
        elements: state.elements.filter((item) => item.id !== line?.id),
      }));
      if (evidenceId) {
        await createRecutWorldsClient(get().apiBase).evidence.archive({
          worldId: get().worldId,
          evidenceId: evidenceId as string,
          expectedRevisionId: get().revisionId,
        });
      } else if (attrKey && entityId) {
        await get().removeMediaAttr(entityId, attrKey);
      }
      set((state) => ({
        elements: state.elements.map((item) =>
          item.id === elementId ? { ...item, props: { ...(item.props ?? {}), attrKey: "", evidenceId: "", entityId: "" } } : item,
        ),
      }));
    } catch (cause) {
      applyCanvasError(cause);
    }
  },

  // 设为封面已退役（统一 Entity 模型：卡面图源 = 遍历 media attrs 的统一投影，首个 image attr
  // 即封面；显式 background attr 若存在仍优先）——setMediaCover / 「封面」按钮一并移除
}));

export type WorldCanvasStore = ReturnType<typeof useWorldCanvasStore.getState>;
