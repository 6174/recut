/*
 * [INPUT]: 依赖 pixi.js、pomelo-core（PomeloPlugin / PomeloEditor / PixiRendererAdapter）、
 * demo-store 与 arrow-geometry（共享几何）
 * [OUTPUT]: 对外提供 SelectionPlugin：
 * - 点击命中选择（实体卡/便签/World 节点/关系线），节点内部永远先响应节点；
 * - 拖拽位移（transact updateBlock 增量提交，pointerup 落回 demo-store）；
 *   pointermove 经 editor.ticker 统一合帧（一帧至多一次 transact+重绘，对齐 vsync），pointerup 前 flush 最后一次 move；
 * - resize：节点选区四角控制点拖拽调整宽高（对角固定，屏幕像素手柄）；
 * - link 选中覆盖线高亮（曲线贯穿两端控制点，节点内段短虚线，节点外段白+蓝双描边），
 *   三控制点可拖：start/end 调锚点在节点内的比例位置，mid 调曲线弯曲；
 * - 选区 overlay 画在 stage（屏幕空间）：线宽/手柄尺寸不随 zoom 变化，transform 变化自动重绘
 * [POS]: lib/pomelo/world-canvas 的选择插件（connect 模式下让位给 ConnectionPlugin）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import type { PixiRendererAdapter } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";
import { useWorldDemoStore } from "../demo-store";
import { entityCardRect } from "../blocks/entity-card-block";
import {
  bezierPoint,
  bezierTangent,
  curveSegment,
  distanceToRelation,
  drawDashedCurve,
  relationGeometry,
  splitQuadratic,
} from "../arrow-geometry";

type Rect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

type Hit = { blockId: string; storeId: string; kind: "entity" | "note" | "world" | "media" | "relation"; rect?: Rect };

type LinkHandleDrag = {
  pointerId: number;
  kind: "start" | "mid" | "end";
  arrowBlockId: string;
  relationId: string;
  fromBlockId: string;
  toBlockId: string;
};

type ResizeDrag = {
  pointerId: number;
  kind: "nw" | "ne" | "sw" | "se";
  blockId: string;
  storeId: string;
  kindLabel: "entity" | "note" | "world" | "media";
  startRect: Rect;
};

type MoveDrag = {
  pointerId: number;
  startWorld: Point;
  moved: Record<string, Point>;
};

type DragState = LinkHandleDrag | ResizeDrag | MoveDrag | null;

const MIN_SIZE = 80;

export class SelectionPlugin extends PomeloPlugin {
  Name = "SelectionPlugin";
  #overlay = new PIXI.Graphics();
  #cleanup?: () => void;
  // start/end 控制点拖拽时的中心热区吸附状态（drawOverlay 据此画热区指示圈）
  #snapZone: { kind: "start" | "end"; centerScreen: Point } | null = null;

  // 拖拽合帧：pointermove 只记最新事件，经 editor.ticker 对齐 vsync，一帧至多一次 transact+重绘
  #pendingMoveEvent: PointerEvent | null = null;
  static readonly #DRAG_KEY = "selection-drag";

  onEditorDidMount(editor: PomeloEditor) {
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    const view = adapter.app.view as HTMLCanvasElement;
    // 选区 overlay 画在 stage（屏幕空间）：线宽/手柄尺寸不随 zoom 变化（tldraw 同款）
    adapter.app.stage.addChild(this.#overlay);

    const toWorld = (event: PointerEvent): Point => {
      const rect = view.getBoundingClientRect();
      const t = adapter.transform;
      return { x: (event.clientX - rect.left - t.x) / t.scale, y: (event.clientY - rect.top - t.y) / t.scale };
    };
    const toScreen = (world: Point): Point => {
      const t = adapter.transform;
      return { x: world.x * t.scale + t.x, y: world.y * t.scale + t.y };
    };
    const screenRect = (rect: Rect): Rect => {
      const tl = toScreen({ x: rect.x, y: rect.y });
      const br = toScreen({ x: rect.x + rect.width, y: rect.y + rect.height });
      return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
    };

    const hitTest = (world: Point): Hit | null => {
      const state = editor.state;
      const blocks = state.getAllBlocks((record) => !record.isRoot);
      // 命中优先级：节点内部永远先响应节点（自上而下），link 只响应节点之外的线体
      const nodes = blocks.filter((record) => record.type === "entity-card" || record.type === "note" || record.type === "world-node" || record.type === "media-node").reverse();
      for (const record of nodes) {
        const rect: Rect = record.type === "entity-card" ? entityCardRect(record.attrs as Record<string, unknown>) : {
          x: Number(record.attrs.x) || 0,
          y: Number(record.attrs.y) || 0,
          width: Number(record.attrs.width) || 0,
          height: Number(record.attrs.height) || 0,
        };
        if (world.x >= rect.x && world.x <= rect.x + rect.width && world.y >= rect.y && world.y <= rect.y + rect.height) {
          const kind: Hit["kind"] = record.type === "entity-card" ? "entity" : record.type === "note" ? "note" : record.type === "media-node" ? "media" : "world";
          return { blockId: record.id, storeId: record.id, kind, rect };
        }
      }
      const arrows = blocks.filter((record) => record.type === "relation-arrow").reverse();
      for (const record of arrows) {
        const from = state.getBlockById(String(record.attrs.fromId ?? ""));
        const to = state.getBlockById(String(record.attrs.toId ?? ""));
        const geo = relationGeometry(from, to, record.attrs as never);
        if (!geo) continue;
        if (distanceToRelation(geo, world) < 8) {
          return { blockId: record.id, storeId: record.id.replace(/^arrow:/, ""), kind: "relation" };
        }
      }
      return null;
    };

    type LinkHandle = { kind: "start" | "mid" | "end"; screen: Point; arrowBlockId: string; fromBlockId: string; toBlockId: string };
    type CornerHandle = { kind: "nw" | "ne" | "sw" | "se"; screen: Point; blockId: string; storeId: string; kindLabel: "entity" | "note" | "world" | "media" };

    // 当前选中对象的屏幕空间手柄（link 三控制点 / 节点四角 resize）
    const activeHandles = (): { link: LinkHandle[]; corners: CornerHandle[] } => {
      const selectedId = useWorldDemoStore.getState().selectedId;
      if (!selectedId) return { link: [], corners: [] };
      const link: LinkHandle[] = [];
      const corners: CornerHandle[] = [];
      const arrowRecord = editor.state.getBlockById(`arrow:${selectedId}`);
      if (arrowRecord) {
        const from = editor.state.getBlockById(String(arrowRecord.attrs.fromId ?? ""));
        const to = editor.state.getBlockById(String(arrowRecord.attrs.toId ?? ""));
        const geo = relationGeometry(from, to, arrowRecord.attrs as never);
        if (from && to && geo) {
          const mid = bezierPoint(geo.curve.p0, geo.curve.cp, geo.curve.p2, 0.5);
          link.push(
            { kind: "start", screen: toScreen(geo.t1), arrowBlockId: arrowRecord.id, fromBlockId: String(arrowRecord.attrs.fromId ?? ""), toBlockId: String(arrowRecord.attrs.toId ?? "") },
            { kind: "mid", screen: toScreen(mid), arrowBlockId: arrowRecord.id, fromBlockId: String(arrowRecord.attrs.fromId ?? ""), toBlockId: String(arrowRecord.attrs.toId ?? "") },
            { kind: "end", screen: toScreen(geo.t2), arrowBlockId: arrowRecord.id, fromBlockId: String(arrowRecord.attrs.fromId ?? ""), toBlockId: String(arrowRecord.attrs.toId ?? "") },
          );
        }
        return { link, corners };
      }
      for (const candidate of [selectedId === "world" ? "world" : `entity:${selectedId}`, `note:${selectedId}`, `media:${selectedId}`]) {
        const record = editor.state.getBlockById(candidate);
        if (!record || record.isRoot) continue;
        const localRect: Rect = record.type === "entity-card" ? entityCardRect(record.attrs as Record<string, unknown>) : {
          x: Number(record.attrs.x) || 0,
          y: Number(record.attrs.y) || 0,
          width: Number(record.attrs.width) || 0,
          height: Number(record.attrs.height) || 0,
        };
        if (localRect.width <= 0 || localRect.height <= 0) continue;
        const rect = screenRect(localRect);
        const kindLabel = record.type === "entity-card" ? "entity" : record.type === "note" ? "note" : record.type === "media-node" ? "media" : "world";
        const storeId = candidate.replace(/^(entity|note|media):/, "");
        corners.push(
          { kind: "nw", screen: { x: rect.x, y: rect.y }, blockId: record.id, storeId, kindLabel },
          { kind: "ne", screen: { x: rect.x + rect.width, y: rect.y }, blockId: record.id, storeId, kindLabel },
          { kind: "sw", screen: { x: rect.x, y: rect.y + rect.height }, blockId: record.id, storeId, kindLabel },
          { kind: "se", screen: { x: rect.x + rect.width, y: rect.y + rect.height }, blockId: record.id, storeId, kindLabel },
        );
        break;
      }
      return { link, corners };
    };

    type HandleDrag = {
      pointerId: number;
      kind: "start" | "mid" | "end";
      arrowBlockId: string;
      relationId: string;
      fromBlockId: string;
      toBlockId: string;
    };
    let dragging: DragState = null;
    const isLinkHandleDrag = (value: DragState): value is HandleDrag => !!value && "kind" in value && (value.kind === "start" || value.kind === "mid" || value.kind === "end") && "arrowBlockId" in value;
    const isResizeDrag = (value: DragState): value is ResizeDrag => !!value && "kind" in value && (value.kind === "nw" || value.kind === "ne" || value.kind === "sw" || value.kind === "se") && "blockId" in value;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (useWorldDemoStore.getState().mode === "connect") return;
      const screen = { x: event.clientX - view.getBoundingClientRect().left, y: event.clientY - view.getBoundingClientRect().top };
      const world = toWorld(event);
      const store = useWorldDemoStore.getState();

      // 1) 手柄优先（屏幕像素半径命中，与渲染一致）
      const { link, corners } = activeHandles();
      const linkHandle = link.find((item) => Math.hypot(screen.x - item.screen.x, screen.y - item.screen.y) < 10);
      if (linkHandle && store.selectedId) {
        dragging = {
          pointerId: event.pointerId,
          kind: linkHandle.kind,
          arrowBlockId: linkHandle.arrowBlockId,
          relationId: store.selectedId,
          fromBlockId: linkHandle.fromBlockId,
          toBlockId: linkHandle.toBlockId,
        };
        view.setPointerCapture(event.pointerId);
        return;
      }
      const corner = corners.find((item) => Math.hypot(screen.x - item.screen.x, screen.y - item.screen.y) < 10);
      if (corner && store.selectedId) {
        const record = editor.state.getBlockById(corner.blockId);
        if (record) {
          dragging = {
            pointerId: event.pointerId,
            kind: corner.kind,
            blockId: corner.blockId,
            storeId: corner.storeId,
            kindLabel: corner.kindLabel,
            startRect: {
              x: Number(record.attrs.x) || 0,
              y: Number(record.attrs.y) || 0,
              width: Number(record.attrs.width) || 0,
              height: Number(record.attrs.height) || 0,
            },
          };
          view.setPointerCapture(event.pointerId);
          return;
        }
      }

      // 2) 命中选择 + 拖拽位移
      const hit = hitTest(world);
      if (!hit) {
        store.select(null);
        return;
      }
      if (hit.kind === "relation") store.select(hit.storeId);
      else if (hit.kind === "world") store.select("world");
      else store.select(hit.storeId.replace(/^(entity|note|media):/, ""));

      if (hit.kind === "relation" || hit.kind === "world") return;
      const record = editor.state.getBlockById(hit.blockId);
      dragging = {
        pointerId: event.pointerId,
        startWorld: world,
        moved: { [hit.blockId]: { x: Number(record?.attrs.x) || 0, y: Number(record?.attrs.y) || 0 } },
      };
      view.setPointerCapture(event.pointerId);
    };

    const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

    const applyDragMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const world = toWorld(event);
      if (isLinkHandleDrag(dragging)) {
        const arrowRecord = editor.state.getBlockById(dragging.arrowBlockId);
        const from = editor.state.getBlockById(dragging.fromBlockId);
        const to = editor.state.getBlockById(dragging.toBlockId);
        if (!arrowRecord || !from || !to) return;
        const handle = dragging;
        if (handle.kind === "mid") {
          // 中间控制点：相对两端锚点直线中点的偏移（控制曲线弯曲）
          const geo = relationGeometry(from, to, arrowRecord.attrs as never);
          if (!geo) return;
          const straightMid = { x: (geo.t1.x + geo.t2.x) / 2, y: (geo.t1.y + geo.t2.y) / 2 };
          editor.state.transact((hook) => {
            hook.updateBlock(handle.arrowBlockId, { bend: { dx: Math.round(world.x - straightMid.x), dy: Math.round(world.y - straightMid.y) } });
          });
        } else {
          // start/end 控制点：锚点在所属节点内的归一化比例位置（默认 0.5,0.5 节点中心）；
          // 节点中心热区（屏幕 14px）内吸附回中心，提交时清除覆盖
          const target = handle.kind === "start" ? from : to;
          const rectX = Number(target.attrs.x) || 0;
          const rectY = Number(target.attrs.y) || 0;
          const rectW = Number(target.attrs.width) || 200;
          const rectH = Number(target.attrs.height) || 110;
          const centerScreen = toScreen({ x: rectX + rectW / 2, y: rectY + rectH / 2 });
          const viewRect = view.getBoundingClientRect();
          const pointerScreen = { x: event.clientX - viewRect.left, y: event.clientY - viewRect.top };
          const snapped = Math.hypot(pointerScreen.x - centerScreen.x, pointerScreen.y - centerScreen.y) < 14;
          this.#snapZone = snapped ? { kind: handle.kind, centerScreen } : null;
          const anchor = snapped
            ? { x: 0.5, y: 0.5 }
            : { x: clamp01((world.x - rectX) / rectW), y: clamp01((world.y - rectY) / rectH) };
          editor.state.transact((hook) => {
            hook.updateBlock(handle.arrowBlockId, handle.kind === "start" ? { fromAnchor: anchor } : { toAnchor: anchor });
          });
        }
        this.drawOverlay(editor);
        return;
      }
      if (isResizeDrag(dragging)) {
        // resize：对角固定（fixed），拖拽角跟随指针（world）；世界坐标取整避免亚像素
        const start = dragging.startRect;
        const fixedX = dragging.kind === "ne" || dragging.kind === "se" ? start.x : start.x + start.width;
        const fixedY = dragging.kind === "sw" || dragging.kind === "se" ? start.y : start.y + start.height;
        const x = Math.min(world.x, fixedX);
        const y = Math.min(world.y, fixedY);
        const width = Math.max(MIN_SIZE, Math.abs(world.x - fixedX));
        const height = Math.max(MIN_SIZE, Math.abs(world.y - fixedY));
        const resize = dragging;
        editor.state.transact((hook) => {
          hook.updateBlock(resize.blockId, { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
        });
        this.drawOverlay(editor);
        return;
      }
      const dx = world.x - dragging.startWorld.x;
      const dy = world.y - dragging.startWorld.y;
      const move = dragging;
      editor.state.transact((hook) => {
        for (const [blockId, origin] of Object.entries(move.moved)) {
          // 取整避免亚像素：文字按整像素栅格化
          hook.updateBlock(blockId, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
        }
      });
      this.drawOverlay(editor);
    };

    const cancelPendingMove = () => {
      this.editor.ticker.cancel(SelectionPlugin.#DRAG_KEY);
      this.#pendingMoveEvent = null;
    };

    // pointerup 前补齐最后一次未上帧的 move，保证提交位置=指针位置
    const flushPendingMove = () => {
      const pending = this.#pendingMoveEvent;
      this.editor.ticker.cancel(SelectionPlugin.#DRAG_KEY);
      this.#pendingMoveEvent = null;
      if (pending && dragging && pending.pointerId === dragging.pointerId) applyDragMove(pending);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      // 统一 ticker 合帧：只保留最新一次 move，对齐 vsync 渲染，避免事件驱动渲染错过帧截止
      this.#pendingMoveEvent = event;
      this.editor.ticker.schedule(SelectionPlugin.#DRAG_KEY, () => {
        const pending = this.#pendingMoveEvent;
        this.#pendingMoveEvent = null;
        if (pending && dragging && pending.pointerId === dragging.pointerId) applyDragMove(pending);
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      flushPendingMove();
      const store = useWorldDemoStore.getState();
      if (isLinkHandleDrag(dragging)) {
        // 把拖拽中的锚点/弯曲落回 demo-store（dataVersion++ 触发文档对齐重建）
        const arrowRecord = editor.state.getBlockById(dragging.arrowBlockId);
        // 吸附回中心的锚点提交 undefined（清除覆盖，回落默认中心）
        const clearStart = this.#snapZone?.kind === "start";
        const clearEnd = this.#snapZone?.kind === "end";
        if (arrowRecord) {
          store.updateRelationGeometry(dragging.relationId, {
            fromAnchor: clearStart ? undefined : (arrowRecord.attrs.fromAnchor as { x: number; y: number } | undefined) ?? undefined,
            toAnchor: clearEnd ? undefined : (arrowRecord.attrs.toAnchor as { x: number; y: number } | undefined) ?? undefined,
            bend: (arrowRecord.attrs.bend as { dx: number; dy: number } | undefined) ?? undefined,
          });
        }
        this.#snapZone = null;
        view.releasePointerCapture?.(event.pointerId);
        dragging = null;
        this.drawOverlay(editor);
        return;
      }
      if (isResizeDrag(dragging)) {
        const resize = dragging;
        const record = editor.state.getBlockById(resize.blockId);
        if (record) {
          const patch = {
            x: Math.round(Number(record.attrs.x) || 0),
            y: Math.round(Number(record.attrs.y) || 0),
            width: Math.round(Number(record.attrs.width) || 0),
            height: Math.round(Number(record.attrs.height) || 0),
          };
          if (resize.kindLabel === "entity") store.updateEntity(resize.storeId, patch);
          else if (resize.kindLabel === "note") store.updateNote(resize.storeId, patch);
          else if (resize.kindLabel === "media") store.updateMediaNode(resize.storeId, patch);
          // world 节点尺寸只存在编辑器文档内（demo 不持久化）
        }
        view.releasePointerCapture?.(event.pointerId);
        dragging = null;
        this.drawOverlay(editor);
        return;
      }
      const moveDrag = dragging;
      for (const blockId of Object.keys(moveDrag.moved)) {
        const record = editor.state.getBlockById(blockId);
        if (!record) continue;
        const x = Math.round(Number(record.attrs.x) || 0);
        const y = Math.round(Number(record.attrs.y) || 0);
        if (blockId.startsWith("entity:")) {
          store.updateEntityPosition(blockId.slice("entity:".length), x, y);
        } else if (blockId.startsWith("note:")) {
          store.updateNote(blockId.slice("note:".length), { x, y });
        } else if (blockId.startsWith("media:")) {
          store.updateMediaNode(blockId.slice("media:".length), { x, y });
        }
        // world 节点位置只存在编辑器文档内（demo 不持久化）
      }
      view.releasePointerCapture?.(event.pointerId);
      dragging = null;
      this.drawOverlay(editor);
    };

    view.addEventListener("pointerdown", onPointerDown);
    view.addEventListener("pointermove", onPointerMove);
    view.addEventListener("pointerup", onPointerUp);
    view.addEventListener("pointercancel", onPointerUp);
    // transform（缩放/平移）变化时重绘选区，保持屏幕空间尺寸不变
    const unsubTransform = adapter.onTransformEvent.on(() => this.drawOverlay(editor));
    this.#cleanup = () => {
      cancelPendingMove();
      view.removeEventListener("pointerdown", onPointerDown);
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("pointerup", onPointerUp);
      view.removeEventListener("pointercancel", onPointerUp);
      unsubTransform.dispose();
      this.#overlay.destroy();
    };
  }

  // 选区 overlay：屏幕空间绘制（stage 直挂），节点=矩形选框+四角 resize 手柄，
  // link=曲线覆盖线（节点内短虚线 + 节点外双描边高亮）+ 三控制点
  drawOverlay(editor: PomeloEditor) {
    const g = this.#overlay;
    g.clear();
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    const t = adapter.transform;
    const selectedId = useWorldDemoStore.getState().selectedId;
    if (!selectedId) return;
    const toScreen = (world: Point): Point => ({ x: world.x * t.scale + t.x, y: world.y * t.scale + t.y });
    const toScreenRect = (rect: Rect): Rect => {
      const tl = toScreen({ x: rect.x, y: rect.y });
      const br = toScreen({ x: rect.x + rect.width, y: rect.y + rect.height });
      return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
    };

    // link 选中：覆盖线高亮
    const arrowRecord = editor.state.getBlockById(`arrow:${selectedId}`);
    if (arrowRecord) {
      const from = editor.state.getBlockById(String(arrowRecord.attrs.fromId ?? ""));
      const to = editor.state.getBlockById(String(arrowRecord.attrs.toId ?? ""));
      const geo = relationGeometry(from, to, arrowRecord.attrs as never);
      if (!from || !to || !geo) return;
      // 拖拽 start/end 时的节点中心热区指示圈
      if (this.#snapZone) {
        g.lineStyle({ width: 1.5, color: 0x4c8dff, alpha: 0.6, alignment: 0.5 });
        g.drawCircle(this.#snapZone.centerScreen.x, this.#snapZone.centerScreen.y, 14);
        g.lineStyle({ width: 1, color: 0x4c8dff, alpha: 0.25, alignment: 0.5 });
        g.drawCircle(this.#snapZone.centerScreen.x, this.#snapZone.centerScreen.y, 22);
      }
      // 节点内段：短虚线（曲线贯穿两端控制点）；拆分子曲线保证与 line 本体同一几何
      g.lineStyle({ width: 1.5, color: 0x8b93a7, alpha: 0.9, alignment: 0.5 });
      const leftPart = geo.ta > 0 ? splitQuadratic(geo.curve, geo.ta).left : geo.curve;
      const rightPart = geo.tb < 1 ? splitQuadratic(geo.curve, geo.tb).right : geo.curve;
      for (const part of [leftPart, rightPart]) {
        drawDashedCurve(g, { p0: toScreen(part.p0), cp: toScreen(part.cp), p2: toScreen(part.p2) });
      }
      // 节点外段：白色外描边 + 蓝色内描边（用拆分后的子曲线，与 line 本体完全重合）
      const midPart = curveSegment(geo, geo.ta, geo.tb);
      const a = toScreen(midPart.p0);
      const b = toScreen(midPart.p2);
      const cp = toScreen(midPart.cp);
      g.lineStyle({ width: 5, color: 0xffffff, alpha: 0.95, alignment: 0.5 });
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo(cp.x, cp.y, b.x, b.y);
      g.lineStyle({ width: 2, color: 0x4c8dff, alpha: 1, alignment: 0.5 });
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo(cp.x, cp.y, b.x, b.y);
      // 箭头高亮：沿曲线在边界 b 处的切线
      const tangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.tb);
      const angle = Math.atan2(tangent.y, tangent.x);
      g.lineStyle(0);
      g.beginFill(0xffffff);
      g.moveTo(b.x + Math.cos(angle) * 4, b.y + Math.sin(angle) * 4);
      g.lineTo(b.x - 8 * Math.cos(angle) - 4 * Math.sin(angle), b.y - 8 * Math.sin(angle) + 4 * Math.cos(angle));
      g.lineTo(b.x - 8 * Math.cos(angle) + 4 * Math.sin(angle), b.y - 8 * Math.sin(angle) - 4 * Math.cos(angle));
      g.closePath();
      g.endFill();
      // 三控制点：start（默认节点中心）/ 中点 / end
      const mid = bezierPoint(geo.curve.p0, geo.curve.cp, geo.curve.p2, 0.5);
      for (const world of [geo.t1, mid, geo.t2]) {
        const point = toScreen(world);
        g.lineStyle(2, 0x4c8dff, 1);
        g.beginFill(0xffffff);
        g.drawCircle(point.x, point.y, 4.5);
        g.endFill();
      }
      return;
    }

    // 节点/便签选中：矩形选框 + 四角 resize 手柄
    const blockId = selectedId === "world" ? "world" : `entity:${selectedId}`;
    for (const candidate of [blockId, `note:${selectedId}`, `media:${selectedId}`]) {
      const record = editor.state.getBlockById(candidate);
      if (!record || record.isRoot) continue;
      const localRect: Rect = record.type === "entity-card" ? entityCardRect(record.attrs as Record<string, unknown>) : {
        x: Number(record.attrs.x) || 0,
        y: Number(record.attrs.y) || 0,
        width: Number(record.attrs.width) || 0,
        height: Number(record.attrs.height) || 0,
      };
      if (localRect.width <= 0 || localRect.height <= 0) continue;
      const rect = toScreenRect(localRect);
      g.lineStyle(2, 0x4c8dff, 1, 0.5);
      g.drawRoundedRect(rect.x - 4, rect.y - 4, rect.width + 8, rect.height + 8, 6);
      g.lineStyle(2, 0x4c8dff, 1);
      g.beginFill(0xffffff);
      for (const [hx, hy] of [
        [rect.x - 4, rect.y - 4],
        [rect.x + rect.width + 4, rect.y - 4],
        [rect.x - 4, rect.y + rect.height + 4],
        [rect.x + rect.width + 4, rect.y + rect.height + 4],
      ]) {
        g.drawRect(hx - 4, hy - 4, 8, 8);
      }
      g.endFill();
      break;
    }
  }

  onEditorWillUnmount() {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }

  dispose() {
    this.#cleanup?.();
  }
}
