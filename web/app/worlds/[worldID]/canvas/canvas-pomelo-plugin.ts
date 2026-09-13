/*
 * [INPUT]: 依赖 pomelo-core（PomeloPlugin / PomeloEditor）、pomelo-vello/overlay-dom（DomOverlay/cssColor）、
 * canvas-store、world-canvas/blocks/entity-card-metrics（entityCardRect）与 arrow-geometry（共享几何）
 * [OUTPUT]: 对外提供 CanvasBindsPlugin：pomelo 画布与 canvas-store 的交互绑定层——
 * 点击命中选择（实体卡/便签/文本/形状/属性节点/World 节点/语义关系线/自由箭头）解析为
 * CanvasSelection 驱动右侧面板；拖拽位移 + 四角 resize（transact 增量提交，pointerup 落回
 * canvas-store.moveElement + 去抖 persistGeometry；pointermove 经 editor.ticker 统一合帧，
 * 一帧至多一次 transact+重绘，pointerup 前 flush 最后一次 move）；「+」手柄（实体卡与 World 根节点
 * 左右缘中点各一个，自由元素不挂）拖出引导线：实体 → 实体 =
 * 受控关系确认（setPendingRelation），其余落点（含 World 节点）= 属性引导菜单（setAttrCreator，创建属性节点 +
 * 属性边）；双击实体卡进入容器（命名态再次双击先退出命名）；双击空白 = 最近类型快捷建卡
 * （Alt = 创建菜单）；右键 = 实体/便签文本上下文菜单（T3）；Delete/Backspace 删除关系/草稿、
 * 实体走删除确认（B.6）；选区 overlay + 「+」手柄 +
 * 引导草稿线（overlay 屏幕空间 / draft 世界空间，transform 变化自动重绘）
 * [POS]: worlds/[worldID]/canvas 的画布交互绑定层（resolveSelection / store↔document 同步）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import { PomeloPlugin } from "@/lib/pomelo/pomelo-core/pomelo-plugin";
import { DomOverlay, cssColor } from "@/lib/pomelo/pomelo-vello/overlay-dom";
import { WORLD_ELEMENT_ID, useWorldCanvasStore } from "./canvas-store";
import { resolveMediaPropsSrc } from "@/lib/world-media";
import { entityCardRect } from "@/lib/pomelo/world-canvas/blocks/entity-card-metrics";
import { pomeloPerf } from "@/lib/pomelo/pomelo-core/pomelo-perf";
import {
  bezierPoint,
  bezierTangent,
  curveSegment,
  distanceToRelation,
  drawDashedCurve,
  relationGeometry,
  splitQuadratic,
} from "@/lib/pomelo/world-canvas/arrow-geometry";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

const NODE_TYPES = new Set(["entity-card", "note", "free-element"]);
const RELATION_PREFIX = "arrow:";
const MIN_SIZE = 60;
const PERSIST_DEBOUNCE_MS = 400;

// block record 的有效矩形：实体卡用渲染固有尺寸（旧数据可能存了更小的 width/height，
// 命中/选区/「+」手柄必须与实际渲染一致）
function rectOfRecord(record: { type: string; attrs: Record<string, unknown> }): Rect {
  if (record.type === "entity-card") return entityCardRect(record.attrs);
  return {
    x: Number(record.attrs.x) || 0,
    y: Number(record.attrs.y) || 0,
    width: Number(record.attrs.width) || 0,
    height: Number(record.attrs.height) || 0,
  };
}

type MoveDrag = {
  pointerId: number;
  startWorld: Point;
  moved: Map<string, Point>;
};
type ResizeDrag = {
  pointerId: number;
  kind: "nw" | "ne" | "sw" | "se";
  blockId: string;
  startRect: Rect;
  // 图像媒体卡锁定纵横比（采纳时按素材 naturalWidth/Height 适配过）：height = width * aspect
  aspect?: number;
};
type LinkHandleDrag = {
  pointerId: number;
  kind: "start" | "mid" | "end";
  blockId: string;
  fromBlockId: string;
  toBlockId: string;
};
type DragState = MoveDrag | ResizeDrag | LinkHandleDrag | null;
type GuideDrag = {
  pointerId: number;
  sourceBlockId: string;
  anchorWorld: Point;
  pointerWorld: Point;
  hoverBlockId: string | null;
  screen: { x: number; y: number };
};

export class CanvasBindsPlugin extends PomeloPlugin {
  Name = "CanvasBindsPlugin";
  // 拖拽会话的实时几何（canvasId → {x,y,width?,height?}）：拖拽/缩放中每次 move 同步写入，
  // 供 syncDocFromCanvasStore 全量重建时优先采用（否则中途 dataVersion++ 的重建会用
  // store 旧位置把正在拖拽的元素弹回去，表现为「不跟手、然后才追上鼠标」）
  liveGeometry = new Map<string, { x: number; y: number; width?: number; height?: number }>();
  #overlay: DomOverlay | null = null;
  // 每帧 overlay 绘制（闭包，定义于 onEditorDidMount，可访问 toScreen/centerWorld 等）
  #paint?: () => void;
  // 进行中的 + 引导拖拽（drawOverlay 读取以隐藏手柄/绘制 hover 高亮）
  #guide: GuideDrag | null = null;
  // 连线三控制点拖拽时的节点中心热区吸附指示（drawOverlay 据此绘制）
  #snapZone: { kind: "start" | "end"; centerScreen: Point } | null = null;
  #cleanup?: () => void;
  // 拖拽合帧：pointermove 暂存的最新事件，经 editor.ticker 一帧至多 apply 一次
  #pendingMoveEvent: PointerEvent | null = null;
  static readonly #DRAG_KEY = "canvas-binds-drag";
  // 拖拽会话（adapter 级快照）：被拖块 + 相连箭头留在活层，其余场景冻结为一张快照
  #sessionActive = false;
  // hover 命中的节点（含周围热区）：决定「+」手柄是否出现（只 hover 才显示，非全画布常显）
  #hoverBlockId: string | null = null;
  // 标识编辑器画布 DOM（供宿主 overlay 定位/事件穿透判断）
  #view?: HTMLCanvasElement;

  get view() {
    return this.#view;
  }

  onEditorDidMount(editor: PomeloEditor) {
    const adapter = editor.renderAdapter;
    const view = adapter.getView();
    if (!view) return;
    this.#view = view;
    this.#overlay = new DomOverlay(editor.getContainerDom());

    const toWorld = (event: PointerEvent): Point => {
      const rect = view.getBoundingClientRect();
      const t = adapter.transform;
      return { x: (event.clientX - rect.left - t.x) / t.scale, y: (event.clientY - rect.top - t.y) / t.scale };
    };
    const toScreen = (world: Point): Point => {
      const t = adapter.transform;
      return { x: world.x * t.scale + t.x, y: world.y * t.scale + t.y };
    };

    // ---- 「+」手柄与引导层：实体卡左右缘中点各挂一个 + 手柄 ----
    const blockIdToCanvasId = (blockId: string) => {
      if (blockId === "shape:world") return WORLD_ELEMENT_ID;
      if (blockId.startsWith("entity:")) return `shape:${blockId.slice("entity:".length)}`;
      return blockId; // note/text/shape/attr/free-arrow：id 即 world_canvas 元素 id
    };
    type PlusHandle = { blockId: string; canvasId: string; anchorWorld: Point; screen: Point };
    const plusHandles = (): PlusHandle[] => {
      // 边必须有语义：受控关系只允许实体 ⇄ 实体（与后端 CreateRelation 的实体端点校验对齐）；
      // 便签/文本/形状/attr 等自由元素不挂「+」；只对 hover 命中的实体卡出现
      const handles: PlusHandle[] = [];
      const records = this.#hoverBlockId
        ? editor.state.getAllBlocks((item) => item.id === this.#hoverBlockId && item.id.startsWith("entity:"))
        : [];
      for (const record of records) {
        const rect = rectOf(record);
        if (rect.width <= 0 || rect.height <= 0) continue;
        for (const anchorWorld of [
          { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
          { x: rect.x, y: rect.y + rect.height / 2 },
        ]) {
          handles.push({
            blockId: record.id,
            canvasId: blockIdToCanvasId(record.id),
            anchorWorld,
            screen: toScreen(anchorWorld),
          });
        }
      }
      return handles;
    };
    const nodeTitleOf = (blockId: string): { title: string; canvasId: string } => {
      const store = useWorldCanvasStore.getState();
      const canvasId = blockIdToCanvasId(blockId);
      if (blockId === WORLD_ELEMENT_ID) return { title: store.worldName, canvasId };
      if (blockId.startsWith("entity:")) {
        const entity = store.entities.find((item) => item.id === blockId.slice("entity:".length));
        return { title: entity?.name ?? "实体", canvasId };
      }
      const element = store.elements.find((item) => item.id === blockId);
      const name = element?.name;
      const text = element?.props?.text;
      return { title: (typeof name === "string" && name) || (typeof text === "string" && text) || "元素", canvasId: blockId };
    };

    // ---- 命中优先级：节点内部先响应节点（自上而下）；link 只响应线体 ----
    const rectOf = rectOfRecord;
    const hitTest = (world: Point): { blockId: string; kind: "node" | "link" } | null => {
      const state = editor.state;
      const blocks = state.getAllBlocks((record) => !record.isRoot);
      const nodes = blocks.filter((record) => NODE_TYPES.has(record.type)).reverse();
      for (const record of nodes) {
        const rect = rectOf(record);
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (world.x >= rect.x && world.x <= rect.x + rect.width && world.y >= rect.y && world.y <= rect.y + rect.height) {
          return { blockId: record.id, kind: "node" };
        }
      }
      const arrows = blocks.filter((record) => record.type === "relation-arrow").reverse();
      for (const record of arrows) {
        const from = state.getBlockById(String(record.attrs.fromId ?? ""));
        const to = state.getBlockById(String(record.attrs.toId ?? ""));
        const geo = relationGeometry(from, to, record.attrs as never);
        if (!geo) continue;
        if (distanceToRelation(geo, world) < 8) return { blockId: record.id, kind: "link" };
      }
      return null;
    };

    // ---- 选中解析：blockId → CanvasSelection（落回 canvas-store） ----
    const selectBlock = (blockId: string) => {
      const store = useWorldCanvasStore.getState();
      if (blockId.startsWith(RELATION_PREFIX)) {
        const relation = store.relations.find((item) => item.id === blockId.slice(RELATION_PREFIX.length));
        if (relation) store.select({ type: "relation", relation });
        else store.select(null);
        return;
      }
      if (blockId === "shape:world") {
        store.select({ type: "world" });
        return;
      }
      if (blockId.startsWith("entity:")) {
        const entity = store.entities.find((item) => item.id === blockId.slice("entity:".length));
        if (entity) store.select({ type: "entity", entity });
        return;
      }
      // 便签/文本/形状/自由箭头 → 自由画布元素（id 即 world_canvas 元素 id）
      const element = store.elements.find((item) => item.id === blockId);
      if (!element) {
        store.select(null);
        return;
      }
      const record = editor.state.getBlockById(blockId);
      store.select({
        type: "canvas",
        element,
        ...(element.kind === "arrow"
          ? {
              fromEntityId: entityRefFromAttr(record?.attrs.fromElementId),
              toEntityId: entityRefFromAttr(record?.attrs.toElementId),
            }
          : {}),
      });
    };

    // ---- 选中对象的屏幕空间四角 resize 手柄（关系线不提供把手，语义锚点走面板） ----
    type CornerHandle = { kind: "nw" | "ne" | "sw" | "se"; screen: Point; blockId: string };
    const activeCorners = (): CornerHandle[] => {
      const selection = useWorldCanvasStore.getState().selection;
      if (!selection) return [];
      const candidates: string[] = [];
      if (selection.type === "entity") candidates.push(`entity:${selection.entity.id}`);
      else if (selection.type === "world") candidates.push("shape:world");
      else if (selection.type === "canvas" && selection.element.kind !== "arrow") candidates.push(selection.element.id);
      for (const blockId of candidates) {
        const record = editor.state.getBlockById(blockId);
        if (!record || record.isRoot) continue;
        const world = rectOfRecord(record);
        if (world.width <= 0 || world.height <= 0) continue;
        const tl = toScreen({ x: world.x, y: world.y });
        const br = toScreen({ x: world.x + world.width, y: world.y + world.height });
        return [
          { kind: "nw", screen: { x: tl.x, y: tl.y }, blockId },
          { kind: "ne", screen: { x: br.x, y: tl.y }, blockId },
          { kind: "sw", screen: { x: tl.x, y: br.y }, blockId },
          { kind: "se", screen: { x: br.x, y: br.y }, blockId },
        ];
      }
      return [];
    };

    let dragging: DragState = null;
    const isResize = (value: DragState): value is ResizeDrag => !!value && "startRect" in value;
    const isLinkDrag = (value: DragState): value is LinkHandleDrag =>
      !!value && "fromBlockId" in value && "blockId" in value && (value.kind === "start" || value.kind === "mid" || value.kind === "end");

    // 连线三控制点屏幕手柄（demo 版同款：exit t1 / 曲线中点 / enter t2）；
    // 语义关系边与自由草稿箭头都支持
    type LinkHandle = { kind: "start" | "mid" | "end"; screen: Point; blockId: string; fromBlockId: string; toBlockId: string };
    const activeLinkHandles = (): LinkHandle[] => {
      const selection = useWorldCanvasStore.getState().selection;
      if (!selection) return [];
      let arrowId: string | null = null;
      if (selection.type === "relation") arrowId = `${RELATION_PREFIX}${selection.relation.id}`;
      else if (selection.type === "canvas" && selection.element.kind === "arrow") arrowId = selection.element.id;
      if (!arrowId) return [];
      const record = editor.state.getBlockById(arrowId);
      if (!record) return [];
      const from = editor.state.getBlockById(String(record.attrs.fromId ?? ""));
      const to = editor.state.getBlockById(String(record.attrs.toId ?? ""));
      const geo = relationGeometry(from, to, record.attrs as never);
      if (!from || !to || !geo) return [];
      const mid = bezierPoint(geo.curve.p0, geo.curve.cp, geo.curve.p2, 0.5);
      return [
        { kind: "start", screen: toScreen(geo.t1), blockId: record.id, fromBlockId: String(record.attrs.fromId ?? ""), toBlockId: String(record.attrs.toId ?? "") },
        { kind: "mid", screen: toScreen(mid), blockId: record.id, fromBlockId: String(record.attrs.fromId ?? ""), toBlockId: String(record.attrs.toId ?? "") },
        { kind: "end", screen: toScreen(geo.t2), blockId: record.id, fromBlockId: String(record.attrs.fromId ?? ""), toBlockId: String(record.attrs.toId ?? "") },
      ];
    };

    const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

    // 「+」引导拖拽：从 + 手柄出发，拖到另一实体卡开关系确认；落空/点击 = 属性引导菜单
    const drawGuide = () => {
      this.drawOverlay(editor);
    };
    // 引导线终点吸附用的节点中心（世界坐标）
    const centerWorld = (blockId: string): Point => {
      const record = editor.state.getBlockById(blockId);
      if (!record) return { x: 0, y: 0 };
      const rect = rectOf(record);
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    // 覆盖层绘制：屏幕空间（guide 草稿线 + 「+」手柄 + 选区/关系高亮）
    this.#paint = () => {
      const overlay = this.#overlay;
      if (!overlay) return;
      const screen = adapter.getScreenSize();
      overlay.setSize(screen.width, screen.height);
      overlay.clearAll();
      const t = adapter.transform;
      const readOnly = useWorldCanvasStore.getState().readOnly;

      if (this.#guide) {
        const endWorld = this.#guide.hoverBlockId ? centerWorld(this.#guide.hoverBlockId) : this.#guide.pointerWorld;
        const a = toScreen(this.#guide.anchorWorld);
        const b = toScreen(endWorld);
        overlay.line(a.x, a.y, b.x, b.y, { stroke: cssColor(0x8b93a7, 0.9), strokeWidth: 2, dash: "6 4" });
        overlay.circle(b.x, b.y, 4, { fill: cssColor(0x8b93a7) });
      }

      if (!readOnly && !this.#guide && this.#hoverBlockId?.startsWith("entity:")) {
        const record = editor.state.getBlockById(this.#hoverBlockId);
        if (record && record.id.startsWith("entity:")) {
          const rect = rectOfRecord(record);
          if (rect.width > 0 && rect.height > 0) {
            for (const world of [
              { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
              { x: rect.x, y: rect.y + rect.height / 2 },
            ]) {
              const anchorPoint = toScreen(world);
              overlay.circle(anchorPoint.x, anchorPoint.y, 8, { stroke: cssColor(0xd4d4d8, 0.85), strokeWidth: 1.5, fill: cssColor(0x1c1d22) });
              overlay.line(anchorPoint.x - 3.5, anchorPoint.y, anchorPoint.x + 3.5, anchorPoint.y, { stroke: cssColor(0xd4d4d8), strokeWidth: 2 });
              overlay.line(anchorPoint.x, anchorPoint.y - 3.5, anchorPoint.x, anchorPoint.y + 3.5, { stroke: cssColor(0xd4d4d8), strokeWidth: 2 });
            }
          }
        }
      }

      const selection = useWorldCanvasStore.getState().selection;
      if (!selection) return;

      let relationArrowId: string | null = null;
      if (selection.type === "relation") relationArrowId = `${RELATION_PREFIX}${selection.relation.id}`;
      else if (selection.type === "canvas" && selection.element.kind === "arrow") relationArrowId = selection.element.id;
      if (relationArrowId) {
        const arrowRecord = editor.state.getBlockById(relationArrowId);
        if (arrowRecord) {
          const from = editor.state.getBlockById(String(arrowRecord.attrs.fromId ?? ""));
          const to = editor.state.getBlockById(String(arrowRecord.attrs.toId ?? ""));
          const geo = relationGeometry(from, to, arrowRecord.attrs as never);
          if (from && to && geo) {
            if (this.#snapZone) {
              overlay.circle(this.#snapZone.centerScreen.x, this.#snapZone.centerScreen.y, 14, { stroke: cssColor(0x4c8dff, 0.6), strokeWidth: 1.5 });
              overlay.circle(this.#snapZone.centerScreen.x, this.#snapZone.centerScreen.y, 22, { stroke: cssColor(0x4c8dff, 0.25), strokeWidth: 1 });
            }
            const leftPart = geo.ta > 0 ? splitQuadratic(geo.curve, geo.ta).left : geo.curve;
            const rightPart = geo.tb < 1 ? splitQuadratic(geo.curve, geo.tb).right : geo.curve;
            for (const part of [leftPart, rightPart]) {
              overlay.quad(toScreen(part.p0), toScreen(part.cp), toScreen(part.p2), { stroke: cssColor(0x8b93a7, 0.9), strokeWidth: 1.5, dash: "6 4" });
            }
            const midPart = curveSegment(geo, geo.ta, geo.tb);
            const a = toScreen(midPart.p0);
            const b = toScreen(midPart.p2);
            const cpScreen = toScreen(midPart.cp);
            overlay.quad(a, cpScreen, b, { stroke: cssColor(0xffffff, 0.95), strokeWidth: 5 });
            overlay.quad(a, cpScreen, b, { stroke: cssColor(0x4c8dff), strokeWidth: 2 });
            const tangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.tb);
            const angle = Math.atan2(tangent.y, tangent.x);
            overlay.polygon(
              [
                { x: b.x + Math.cos(angle) * 4, y: b.y + Math.sin(angle) * 4 },
                { x: b.x - 8 * Math.cos(angle) - 4 * Math.sin(angle), y: b.y - 8 * Math.sin(angle) + 4 * Math.cos(angle) },
                { x: b.x - 8 * Math.cos(angle) + 4 * Math.sin(angle), y: b.y - 8 * Math.sin(angle) - 4 * Math.cos(angle) },
              ],
              { fill: cssColor(0xffffff) },
            );
            const mid = bezierPoint(geo.curve.p0, geo.curve.cp, geo.curve.p2, 0.5);
            for (const world of [geo.t1, mid, geo.t2]) {
              const point = toScreen(world);
              overlay.circle(point.x, point.y, 4.5, { stroke: cssColor(0x4c8dff), strokeWidth: 2, fill: cssColor(0xffffff) });
            }
          }
        }
        return;
      }

      const candidates: string[] = [];
      if (selection.type === "entity") candidates.push(`entity:${selection.entity.id}`);
      else if (selection.type === "world") candidates.push("shape:world");
      else if (selection.type === "canvas") candidates.push(selection.element.id);
      for (const blockId of candidates) {
        const record = editor.state.getBlockById(blockId);
        if (!record || record.isRoot) continue;
        const world = rectOfRecord(record);
        const width = world.width;
        const height = world.height;
        if (width <= 0 || height <= 0) continue;
        const tl = toScreen({ x: world.x, y: world.y });
        overlay.roundedRect({ x: tl.x - 4, y: tl.y - 4, width: width * t.scale + 8, height: height * t.scale + 8 }, 8, { stroke: cssColor(0x4c8dff, 0.5), strokeWidth: 2 });
        for (const [hx, hy] of [
          [tl.x - 4, tl.y - 4],
          [tl.x + width * t.scale + 4, tl.y - 4],
          [tl.x - 4, tl.y + height * t.scale + 4],
          [tl.x + width * t.scale + 4, tl.y + height * t.scale + 4],
        ]) {
          overlay.roundedRect({ x: hx - 4, y: hy - 4, width: 8, height: 8 }, 1, { stroke: cssColor(0x4c8dff), strokeWidth: 2, fill: cssColor(0xffffff) });
        }
        break;
      }
    };

    // 拖拽/resize 提交：moveElement 本地影子 + persistGeometry 去抖
    const geometryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const commitGeometry = (canvasId: string, geometry: Record<string, unknown>) => {
      const store = useWorldCanvasStore.getState();
      if (store.readOnly) return;
      store.moveElement(canvasId, Math.round(Number(geometry.x) || 0), Math.round(Number(geometry.y) || 0));
      const existing = geometryTimers.get(canvasId);
      if (existing) clearTimeout(existing);
      geometryTimers.set(
        canvasId,
        setTimeout(() => {
          geometryTimers.delete(canvasId);
          void useWorldCanvasStore.getState().persistGeometry(canvasId, geometry);
        }, PERSIST_DEBOUNCE_MS),
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // 属性引导面板打开时：点击画布任意处（面板自身 mousedown 已 stopPropagation）即关闭
      if (useWorldCanvasStore.getState().attrCreator) useWorldCanvasStore.getState().setAttrCreator(null);
      const screen = { x: event.clientX - view.getBoundingClientRect().left, y: event.clientY - view.getBoundingClientRect().top };
      const world = toWorld(event);

      // 「+」手柄最优先：点击/拖出引导线（只读态不提供创建）
      if (useWorldCanvasStore.getState().attrCreator == null) {
        const plus = plusHandles().find((item) => Math.hypot(screen.x - item.screen.x, screen.y - item.screen.y) < 10);
        if (plus && !useWorldCanvasStore.getState().readOnly) {
          this.#guide = { pointerId: event.pointerId, sourceBlockId: plus.blockId, anchorWorld: plus.anchorWorld, pointerWorld: world, hoverBlockId: null, screen: { x: event.clientX, y: event.clientY } };
          view.setPointerCapture(event.pointerId);
          drawGuide();
          return;
        }
      }

      // 工具栏连线工具：linkMode 下点击实体卡即从该实体拖出引导线（复用「+」引导流程）；
      // 边必须有语义，自由元素不能作为连线起点
      if (useWorldCanvasStore.getState().linkMode && !useWorldCanvasStore.getState().readOnly) {
        const linkHit = hitTest(world);
        if (linkHit && linkHit.kind === "node" && linkHit.blockId.startsWith("entity:")) {
          const linkRecord = editor.state.getBlockById(linkHit.blockId);
          if (linkRecord) {
            const linkRect = rectOfRecord(linkRecord);
            if (linkRect.width > 0 && linkRect.height > 0) {
              const anchorWorld = { x: linkRect.x + linkRect.width, y: linkRect.y + linkRect.height / 2 };
              this.#guide = { pointerId: event.pointerId, sourceBlockId: linkHit.blockId, anchorWorld, pointerWorld: world, hoverBlockId: null, screen: { x: event.clientX, y: event.clientY } };
              view.setPointerCapture(event.pointerId);
              drawGuide();
              return;
            }
          }
        }
      }

      const linkHandle = activeLinkHandles().find((item) => Math.hypot(screen.x - item.screen.x, screen.y - item.screen.y) < 12);
      if (linkHandle && event.pointerId != null) {
        dragging = {
          pointerId: event.pointerId,
          kind: linkHandle.kind,
          blockId: linkHandle.blockId,
          fromBlockId: linkHandle.fromBlockId,
          toBlockId: linkHandle.toBlockId,
        };
        view.setPointerCapture(event.pointerId);
        return;
      }

      const corner = activeCorners().find((item) => Math.hypot(screen.x - item.screen.x, screen.y - item.screen.y) < 10);
      if (corner) {
        const record = editor.state.getBlockById(corner.blockId);
        const canvasId = blockIdToCanvasId(corner.blockId);
        const source = useWorldCanvasStore.getState().elements.find((item) => item.id === canvasId);
        // 图片媒体卡（独立 media 或属性卡）锁定纵横比；其余元素自由 resize
        const isImageMedia = Boolean(
          source &&
            ((source.kind === "media" && String(source.props?.modality ?? "image") === "image") ||
              (source.kind === "attr" && String(source.props?.media ?? "text") === "image")),
        );
        if (record) {
          const startRect = rectOf(record);
          dragging = {
            pointerId: event.pointerId,
            kind: corner.kind,
            blockId: corner.blockId,
            startRect,
            aspect: isImageMedia && startRect.width > 0 && startRect.height > 0 ? startRect.height / startRect.width : undefined,
          };
        } else {
          dragging = null;
        }
        view.setPointerCapture(event.pointerId);
        return;
      }

      const hit = hitTest(world);
      if (!hit) {
        useWorldCanvasStore.getState().select(null);
        return;
      }
      selectBlock(hit.blockId);
      // 关系线/自由箭头不拖拽位移（几何派生自两端节点）
      if (hit.kind === "link") return;
      if (useWorldCanvasStore.getState().readOnly) return;
      const record = editor.state.getBlockById(hit.blockId);
      if (!record) return;
      const rect = rectOf(record);
      dragging = { pointerId: event.pointerId, startWorld: world, moved: new Map([[hit.blockId, { x: rect.x, y: rect.y }]]) };
      view.setPointerCapture(event.pointerId);
    };

    // 拖拽会话：首次 move 时让 adapter 冻结场景；excluded = 被拖块 + 绑定它的箭头
    // （箭头几何由两端节点解析，留在快照里会跟丢，必须随被拖块每帧活渲染）
    const beginSessionIfPending = () => {
      if (this.#sessionActive || !dragging) return;
      const ids: string[] = [];
      if (isResize(dragging) || isLinkDrag(dragging)) ids.push(dragging.blockId);
      else ids.push(...dragging.moved.keys());
      const keySet = new Set(ids);
      const arrowIds = editor.state
        .getAllBlocks((record) => record.type === "relation-arrow" && (keySet.has(String(record.attrs.fromId ?? "")) || keySet.has(String(record.attrs.toId ?? ""))))
        .map((record) => record.id);
      this.#sessionActive = true;
      try {
        (editor.renderAdapter as { beginContentSession?: (ids: string[]) => void }).beginContentSession?.([...ids, ...arrowIds]);
      } catch (error) {
        console.warn("[CanvasBindsPlugin] content session failed", error);
      }
    };
    const endSession = () => {
      if (!this.#sessionActive) return;
      this.#sessionActive = false;
      try {
        (editor.renderAdapter as { endContentSession?: () => void }).endContentSession?.();
      } catch (error) {
        console.warn("[CanvasBindsPlugin] end content session failed", error);
      }
    };

    const applyDragMove = (event: PointerEvent) => {
      beginSessionIfPending();
      if (this.#guide && event.pointerId === this.#guide.pointerId) {
        const guide = this.#guide;
        const pointerWorld = toWorld(event);
        // 引导线指向实体卡时吸附其中心（受控关系的目标）
        const hit = hitTest(pointerWorld);
        const hoverBlockId = hit && hit.kind === "node" && hit.blockId !== guide.sourceBlockId && hit.blockId.startsWith("entity:") ? hit.blockId : null;
        this.#guide = { ...guide, pointerWorld, hoverBlockId };
        drawGuide();
        return;
      }
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const drag = dragging;
      const world = toWorld(event);
      if (isLinkDrag(drag)) {
        // 三控制点拖拽（demo 版）：start/end 调锚点比例（14px 屏幕像素内吸附回节点中心），
        // mid 调 bend（相对两端锚点直线中点的偏移）；只落在文档内存投影，不持久化
        const arrowRecord = editor.state.getBlockById(drag.blockId);
        const from = editor.state.getBlockById(drag.fromBlockId);
        const to = editor.state.getBlockById(drag.toBlockId);
        if (!arrowRecord || !from || !to) return;
        if (drag.kind === "mid") {
          const geo = relationGeometry(from, to, arrowRecord.attrs as never);
          if (!geo) return;
          const straightMid = { x: (geo.t1.x + geo.t2.x) / 2, y: (geo.t1.y + geo.t2.y) / 2 };
          editor.state.transact((hook) => {
            hook.updateBlock(drag.blockId, { bend: { dx: Math.round(world.x - straightMid.x), dy: Math.round(world.y - straightMid.y) } });
          });
        } else {
          const target = drag.kind === "start" ? from : to;
          const rect = rectOf(target);
          const rectW = rect.width || 200;
          const rectH = rect.height || 110;
          const centerScreen = toScreen({ x: rect.x + rectW / 2, y: rect.y + rectH / 2 });
          const pointerScreen = { x: event.clientX - view.getBoundingClientRect().left, y: event.clientY - view.getBoundingClientRect().top };
          const snapped = Math.hypot(pointerScreen.x - centerScreen.x, pointerScreen.y - centerScreen.y) < 14;
          this.#snapZone = snapped ? { kind: drag.kind, centerScreen } : null;
          const anchor = snapped
            ? { x: 0.5, y: 0.5 }
            : { x: clamp01((world.x - rect.x) / rectW), y: clamp01((world.y - rect.y) / rectH) };
          editor.state.transact((hook) => {
            hook.updateBlock(drag.blockId, drag.kind === "start" ? { fromAnchor: anchor } : { toAnchor: anchor });
          });
        }
        this.drawOverlay(editor);
        return;
      }
      if (isResize(drag)) {
        const start = drag.startRect;
        const fixedX = drag.kind === "ne" || drag.kind === "se" ? start.x : start.x + start.width;
        const fixedY = drag.kind === "sw" || drag.kind === "se" ? start.y : start.y + start.height;
        const record = editor.state.getBlockById(drag.blockId);
        if (!record) return;
        const x = Math.round(Math.min(world.x, fixedX));
        const y = Math.round(Math.min(world.y, fixedY));
        const width = Math.round(Math.max(MIN_SIZE, Math.abs(world.x - fixedX)));
        const height = Math.round(Math.max(MIN_SIZE, drag.aspect ? Math.max(MIN_SIZE, width * drag.aspect) : Math.abs(world.y - fixedY)));
        editor.state.transact((hook) => {
          hook.updateBlock(drag.blockId, { x, y, width, height });
        });
        this.liveGeometry.set(blockIdToCanvasId(drag.blockId), { x, y, width, height });
        this.drawOverlay(editor);
        return;
      }
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      editor.state.transact((hook) => {
        for (const [blockId, origin] of drag.moved) {
          const x = Math.round(origin.x + dx);
          const y = Math.round(origin.y + dy);
          hook.updateBlock(blockId, { x, y });
          this.liveGeometry.set(blockIdToCanvasId(blockId), { x, y });
        }
      });
      this.drawOverlay(editor);
    };

    // 拖拽合帧：pointermove 只记最新事件，经 editor.ticker 对齐 vsync，一帧至多一次 transact+重绘
    const cancelPendingMove = () => {
      this.editor.ticker.cancel(CanvasBindsPlugin.#DRAG_KEY);
      this.#pendingMoveEvent = null;
    };
    const flushPendingMove = () => {
      const pending = this.#pendingMoveEvent;
      cancelPendingMove();
      if (pending) applyDragMove(pending);
    };

    // hover 追踪：「+」手柄只在指针 hover 到节点（含矩形外 HOT_PAD 像素热区）时出现
    const HOT_PAD = 26;
    const updateHover = (event: PointerEvent, forceDraw = false): void => {
      if (useWorldCanvasStore.getState().readOnly) return;
      const world = toWorld(event);
      let hoveredId: string | null = null;
      const nodes = editor.state.getAllBlocks((record) => NODE_TYPES.has(record.type));
      for (let i = nodes.length - 1; i >= 0; i--) {
        const rect = rectOfRecord(nodes[i]);
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (
          world.x >= rect.x - HOT_PAD && world.x <= rect.x + rect.width + HOT_PAD &&
          world.y >= rect.y - HOT_PAD && world.y <= rect.y + rect.height + HOT_PAD
        ) {
          hoveredId = nodes[i].id;
          break;
        }
      }
      if (hoveredId !== this.#hoverBlockId || forceDraw) {
        this.#hoverBlockId = hoveredId;
        this.drawOverlay(editor);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      // 未在拖拽/引导时更新 hover（决定「+」手柄显隐）；拖拽中保持冻结避免手柄闪烁
      if (!dragging && !this.#guide) updateHover(event);
      const relevant = dragging && event.pointerId === dragging.pointerId;
      const guiding = this.#guide && event.pointerId === this.#guide.pointerId;
      if (!relevant && !guiding) return;
      this.#pendingMoveEvent = event;
      this.editor.ticker.schedule(CanvasBindsPlugin.#DRAG_KEY, () => {
        const pending = this.#pendingMoveEvent;
        this.#pendingMoveEvent = null;
        if (pending) applyDragMove(pending);
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      // 补齐最后一次未上帧的 move，保证提交位置=指针位置
      flushPendingMove();
      endSession();
      // 三控制点拖拽收尾：吸附回中心的清除锚点覆盖，回落默认中心
      if (dragging && isLinkDrag(dragging) && event.pointerId === dragging.pointerId) {
        const linkDrag = dragging;
        const clearStart = this.#snapZone?.kind === "start";
        const clearEnd = this.#snapZone?.kind === "end";
        if (clearStart || clearEnd) {
          editor.state.transact((hook) => {
            if (clearStart) hook.updateBlock(linkDrag.blockId, { fromAnchor: undefined });
            if (clearEnd) hook.updateBlock(linkDrag.blockId, { toAnchor: undefined });
          });
        }
        this.#snapZone = null;
        view.releasePointerCapture?.(event.pointerId);
        // 锚点/弯曲落回 canvas-store：语义关系 → 固有 anchor 元素；自由箭头 → 自身元素 props
        const selection = useWorldCanvasStore.getState().selection;
        if (!useWorldCanvasStore.getState().readOnly && selection) {
          if (linkDrag.blockId.startsWith(RELATION_PREFIX) && selection.type === "relation") {
            const record = editor.state.getBlockById(linkDrag.blockId);
            if (record) {
              void useWorldCanvasStore.getState().persistRelationGeometry(selection.relation.id, {
                fromAnchor: (record.attrs.fromAnchor as { x: number; y: number } | undefined) ?? undefined,
                toAnchor: (record.attrs.toAnchor as { x: number; y: number } | undefined) ?? undefined,
                bend: (record.attrs.bend as { dx: number; dy: number } | undefined) ?? undefined,
              });
            }
          } else if (selection.type === "canvas" && selection.element.kind === "arrow") {
            const record = editor.state.getBlockById(linkDrag.blockId);
            if (record) {
              void useWorldCanvasStore.getState().persistGeometry(selection.element.id, undefined, {
                fromAnchor: (record.attrs.fromAnchor as { x: number; y: number } | undefined) ?? undefined,
                toAnchor: (record.attrs.toAnchor as { x: number; y: number } | undefined) ?? undefined,
                bend: (record.attrs.bend as { dx: number; dy: number } | undefined) ?? undefined,
              });
            }
          }
        }
        dragging = null;
        this.drawOverlay(editor);
        return;
      }
      // 「+」引导收尾：命中另一实体卡 = 受控关系确认；点击/落空 = 属性引导菜单
      if (this.#guide && event.pointerId === this.#guide.pointerId) {
        const store = useWorldCanvasStore.getState();
        const guide = this.#guide;
        const source = nodeTitleOf(guide.sourceBlockId);
        // 关系创建：仅实体 → 实体（World 节点不是语义端点）
        if (guide.hoverBlockId?.startsWith("entity:") && guide.sourceBlockId.startsWith("entity:")) {
          // 关系创建：实体 → 实体，打开受控关系确认对话框
          store.setPendingRelation({
            fromEntityId: guide.sourceBlockId.slice("entity:".length),
            toEntityId: guide.hoverBlockId.slice("entity:".length),
          });
        } else {
          // 属性节点放置：跟随拖拽落点（指针世界坐标），所见即所得
          const dropWorld = toWorld(event);
          store.setAttrCreator({
            fromEntityId: source.canvasId,
            fromEntityTitle: source.title,
            screenX: event.clientX,
            screenY: event.clientY,
            worldX: Math.round(dropWorld.x),
            worldY: Math.round(dropWorld.y),
          });
        }
        this.#guide = null;
        view.releasePointerCapture?.(event.pointerId);
        drawGuide();
        // 连线工具连续多条（T5/B.10）：引导结束后保持 linkMode，回到「点击起点」态；Esc/选择模式退出
        return;
      }
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const store = useWorldCanvasStore.getState();
      if (isLinkDrag(dragging)) return; // link 拖拽在上面独立收尾
      if (!store.readOnly) {
        const liveIds: string[] = [];
        if (isResize(dragging)) {
          const record = editor.state.getBlockById(dragging.blockId);
          if (record) {
            const canvasId = blockIdToCanvasId(dragging.blockId);
            const geometry = {
              x: Math.round(Number(record.attrs.x) || 0),
              y: Math.round(Number(record.attrs.y) || 0),
              width: Math.round(Number(record.attrs.width) || 0),
              height: Math.round(Number(record.attrs.height) || 0),
            };
            this.liveGeometry.set(canvasId, { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height });
            commitGeometry(canvasId, geometry);
            liveIds.push(dragging.blockId);
          }
        } else {
          for (const blockId of dragging.moved.keys()) {
            const record = editor.state.getBlockById(blockId);
            if (!record) continue;
            const canvasId = blockIdToCanvasId(blockId);
            const x = Math.round(Number(record.attrs.x) || 0);
            const y = Math.round(Number(record.attrs.y) || 0);
            this.liveGeometry.set(canvasId, { x, y });
            commitGeometry(canvasId, { x, y });
            liveIds.push(blockId);
          }
        }
        // 提交完成：稍后清除实时几何（等 persist/重建消化完，避免抖动窗口）
        const live = this.liveGeometry;
        setTimeout(() => {
          for (const blockId of liveIds) live.delete(blockIdToCanvasId(blockId));
        }, PERSIST_DEBOUNCE_MS + 200);
        // 拖媒体元素到实体卡 = 挂接/换挂（B.12 拖放矩阵，T8）
        const movedIds = isResize(dragging) ? [dragging.blockId] : [...dragging.moved.keys()];
        if (!isResize(dragging) && movedIds.length === 1) {
          const world = toWorld(event);
          const blockId = movedIds[0];
          const element = store.elements.find((item) => item.id === blockIdToCanvasId(blockId));
          const targetEntityId = this.hitEntityAt(world);
          if (element && element.kind === "media" && targetEntityId) {
            const currentEntityId = String(element.props?.entityId ?? "");
            if (targetEntityId !== currentEntityId) {
              const target = store.entities.find((item) => item.id === targetEntityId);
              if (currentEntityId && target) {
                // 换挂确认：归档旧证据后挂新
                if (window.confirm(`把这份素材从「${store.entities.find((item) => item.id === currentEntityId)?.name ?? "…"}」移到「${target.name}」？`)) {
                  void store.attachMediaElement(element.id, targetEntityId);
                }
              } else {
                void store.attachMediaElement(element.id, targetEntityId);
              }
            }
          }
        }
      }
      view.releasePointerCapture?.(event.pointerId);
      dragging = null;
      this.drawOverlay(editor);
    };

    // 双击：实体卡进入容器（T6 后放开任何实体，此处先行退出命名态）；便签/文本 → 就地编辑（T4）；
    // 空白 → 在光标处弹创建菜单（B.7）
    const onDoubleClick = (event: MouseEvent) => {
      const rect = view.getBoundingClientRect();
      const world = toWorld({ clientX: event.clientX, clientY: event.clientY } as unknown as PointerEvent);
      const hitRecord = editor.state
        .getAllBlocks((record) => NODE_TYPES.has(record.type))
        .reverse()
        .find((record) => {
          const rect = rectOf(record);
          return world.x >= rect.x && world.x <= rect.x + rect.width && world.y >= rect.y && world.y <= rect.y + rect.height;
        });
      const store = useWorldCanvasStore.getState();
      if (!hitRecord) {
        // 关系线/标签双击 = 就地换类型 popover（T15）
        const arrows = editor.state.getAllBlocks((record) => record.type === "relation-arrow");
        for (const arrowRecord of arrows.reverse()) {
          const from = editor.state.getBlockById(String(arrowRecord.attrs.fromId ?? ""));
          const to = editor.state.getBlockById(String(arrowRecord.attrs.toId ?? ""));
          const geo = relationGeometry(from, to, arrowRecord.attrs as never);
          if (!geo) continue;
          if (distanceToRelation(geo, world) < 8) {
            if (store.readOnly || !arrowRecord.id.startsWith(RELATION_PREFIX)) return;
            store.setRelationTypePopover({ relationId: arrowRecord.id.slice(RELATION_PREFIX.length), screenX: event.clientX, screenY: event.clientY });
            return;
          }
        }
        if (store.readOnly) return;
        // 双击空白 = 在光标处弹创建菜单（Alt 兼容保留）
        store.setCreating(true, { screenX: event.clientX, screenY: event.clientY });
        return;
      }
      if (hitRecord.type === "entity-card") {
        // 双击任何实体 = 进入容器（T6/D3：含空容器，空态引导由宿主渲染）
        const entityId = hitRecord.id.slice("entity:".length);
        const entity = store.entities.find((item) => item.id === entityId);
        if (!entity) return;
        store.cancelInlineEdit(); // 命名态再次双击 = 退出命名并进入容器（B.7）
        store.setContext({ entityId, title: entity.name });
        return;
      }
      if (store.readOnly) return;
      if (hitRecord.type === "note" || (hitRecord.type === "free-element" && String(hitRecord.attrs.elementKind ?? "") === "text")) {
        store.startElementBodyEdit(
          hitRecord.id,
          hitRecord.type === "note" ? "note-body" : "text-body",
        );
        return;
      }
      // 属性元素双击 = 编辑文本值（提交时同步回实体 content 字段）
      if (hitRecord.type === "free-element" && String(hitRecord.attrs.elementKind ?? "") === "attr" && String(hitRecord.attrs.attrMedia ?? "text") === "text") {
        store.startElementBodyEdit(hitRecord.id, "attr-body");
        return;
      }
      // 媒体元素双击 = 预览（T8）
      if (hitRecord.type === "media") {
        const element = store.elements.find((item) => item.id === hitRecord.id);
        if (!element) return;
        const src = resolveMediaPropsSrc(store.apiBase, { assetId: element.props?.assetId ? String(element.props.assetId) : undefined, url: element.props?.url ? String(element.props.url) : undefined });
        if (src) store.setMediaPreview({ src, modality: String(element.props?.modality ?? "image"), name: element.name ?? "媒体" });
      }
    };

    // 右键菜单（T3）：实体 / 便签文本元素 → CanvasContextMenu；空白 = 关闭即可（浏览器默认菜单保留无妨）
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const rect = view.getBoundingClientRect();
      const world = toWorld({ clientX: event.clientX, clientY: event.clientY } as unknown as PointerEvent);
      const hit = hitTest(world);
      const store = useWorldCanvasStore.getState();
      if (!hit || hit.kind !== "node") {
        store.setContextMenu(null);
        return;
      }
      if (hit.blockId.startsWith("entity:")) {
        store.setContextMenu({ kind: "entity", entityId: hit.blockId.slice("entity:".length), screenX: event.clientX, screenY: event.clientY });
      } else if (hit.blockId.startsWith("shape:note-") || hit.blockId.startsWith("shape:text-")) {
        store.setContextMenu({ kind: "element", elementId: hit.blockId, screenX: event.clientX, screenY: event.clientY });
      } else {
        store.setContextMenu(null);
      }
    };

    // Delete/Backspace：只作用于可删对象（关系/自由草稿）；实体与世界节点是投影，不可删
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const store = useWorldCanvasStore.getState();
      if (event.key === "Escape") {
        store.setAttrCreator(null);
        store.setContextMenu(null);
        if (store.linkMode) store.setLinkMode(false);
        store.select(null);
        return;
      }
      // Cmd/Ctrl + [ = 上一层容器（B.11/T6）
      if (event.key === "[" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        store.exitContext();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !store.readOnly) {
        const selection = store.selection;
        if (!selection) return;
        if (selection.type === "relation") void store.removeRelation(selection.relation.id);
        else if (selection.type === "canvas") void store.removeElement(selection.element.id);
        else if (selection.type === "entity") store.setDeleteTarget(selection.entity); // 实体 = 删除确认（B.6）
      }
    };

    view.addEventListener("pointerdown", onPointerDown);
    view.addEventListener("pointermove", onPointerMove);
    view.addEventListener("pointerup", onPointerUp);
    view.addEventListener("pointercancel", onPointerUp);
    // 指针离开画布：手柄收起（hover 清空）
    const onPointerLeave = () => {
      this.#pendingMoveEvent = null;
      this.#hoverBlockId = null;
      this.drawOverlay(editor);
    };
    view.addEventListener("pointerleave", onPointerLeave);
    view.addEventListener("dblclick", onDoubleClick);
    view.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    const unsubTransform = adapter.onTransformEvent.on(() => this.drawOverlay(editor));
    this.#cleanup = () => {
      cancelPendingMove();
      view.removeEventListener("pointerdown", onPointerDown);
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("pointerup", onPointerUp);
      view.removeEventListener("pointercancel", onPointerUp);
      view.removeEventListener("pointerleave", onPointerLeave);
      view.removeEventListener("dblclick", onDoubleClick);
      view.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      unsubTransform.dispose();
      this.#overlay?.destroy();
      this.#overlay = null;
    };
  }

  onEditorWillUnmount() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }

  dispose() {
    this.#cleanup?.();
  }

  // 公开命中查询（T8 文件拖放）：世界坐标 → 实体 blockId（仅实体卡）
  hitEntityAt(world: Point): string | null {
    const editor = this.editor;
    if (!editor) return null;
    const hit = editor.state
      .getAllBlocks((record) => NODE_TYPES.has(record.type))
      .reverse()
      .find((record) => {
        const rect = rectOfRecord(record);
        return record.type === "entity-card" && rect.width > 0 && world.x >= rect.x && world.x <= rect.x + rect.width && world.y >= rect.y && world.y <= rect.y + rect.height;
      });
    return hit ? hit.id.slice("entity:".length) : null;
  }

  // 选区 overlay：屏幕空间绘制（stage 直挂）；
  // 节点/便签 = 矩形选框 + 四角 resize 手柄；关系线 = 曲线高亮覆盖 + 三控制点；
  // 所有节点左右缘中点各绘制「+」手柄（创建连线 / 属性引导入口）
  drawOverlay(editor: PomeloEditor) {
    // 覆盖层是纯 DOM/SVG 改动（不经过 transact）：demand-driven 渲染需显式置脏
    editor.renderAdapter.invalidate();
    pomeloPerf.time("overlay.draw", () => this.#paint?.());
  }
}

// 自由箭头绑定：world_canvas props { fromElementId: 'shape:<entityId>' } → 实体 id
function entityRefFromAttr(value: unknown): string | undefined {
  const text = typeof value === "string" ? value : "";
  return text && text.startsWith("shape:") ? text.slice("shape:".length) : undefined;
}
