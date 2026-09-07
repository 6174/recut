/*
 * [INPUT]: 依赖 pomelo-core（PomeloPlugin / PomeloEditor / PixiRendererAdapter）与 demo-store / doc-sync
 * [OUTPUT]: 对外提供 SelectionPlugin：点击命中选择（实体卡/便签/World 节点/关系线）、拖拽位移
 * （transact updateBlock 增量提交，pointerup 时落回 demo-store）、空白点击取消选择，
 * 以及选中描边 overlay（绘制在 mountpoint host 内随 transform 同步）
 * [POS]: lib/pomelo/world-canvas 的选择插件（connect 模式下让位给 ConnectionPlugin）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import type { PixiRendererAdapter } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";
import { useWorldDemoStore } from "../demo-store";
import { centerOf, edgeAnchor } from "../blocks/relation-arrow-block";

type Rect = { x: number; y: number; width: number; height: number };

type Hit = { blockId: string; storeId: string; kind: "entity" | "note" | "world" | "relation"; rect?: Rect };

export class SelectionPlugin extends PomeloPlugin {
  Name = "SelectionPlugin";
  #overlay = new PIXI.Graphics();
  #cleanup?: () => void;

  onEditorDidMount(editor: PomeloEditor) {
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    const view = adapter.app.view as HTMLCanvasElement;
    adapter.mountpointBlock.hostElement.el.addChild(this.#overlay);

    const toWorld = (event: PointerEvent) => {
      const rect = view.getBoundingClientRect();
      const t = adapter.transform;
      return { x: (event.clientX - rect.left - t.x) / t.scale, y: (event.clientY - rect.top - t.y) / t.scale };
    };

    const hitTest = (world: { x: number; y: number }): Hit | null => {
      const state = editor.state;
      const blocks = state.getAllBlocks((record) => !record.isRoot);
      // 命中优先级：节点内部永远先响应节点（自上而下），link 只响应节点之外的线体
      const nodes = blocks.filter((record) => record.type === "entity-card" || record.type === "note" || record.type === "world-node").reverse();
      for (const record of nodes) {
        const rect: Rect = {
          x: Number(record.attrs.x) || 0,
          y: Number(record.attrs.y) || 0,
          width: Number(record.attrs.width) || 0,
          height: Number(record.attrs.height) || 0,
        };
        if (world.x >= rect.x && world.x <= rect.x + rect.width && world.y >= rect.y && world.y <= rect.y + rect.height) {
          return { blockId: record.id, storeId: record.id, kind: record.type === "entity-card" ? "entity" : record.type === "note" ? "note" : "world", rect };
        }
      }
      // link 命中：点到线段距离（可见段：边缘锚点 → target 边缘）
      const arrows = blocks.filter((record) => record.type === "relation-arrow").reverse();
      for (const record of arrows) {
        const from = state.getBlockById(String(record.attrs.fromId ?? ""));
        const to = state.getBlockById(String(record.attrs.toId ?? ""));
        if (!from || !to) continue;
        const c1 = centerOf(from);
        const c2 = centerOf(to);
        if (!c1 || !c2) continue;
        const a = edgeAnchor(c1, c2, Number(from.attrs.width) || 200, Number(from.attrs.height) || 110);
        const b = edgeAnchor(c2, c1, Number(to.attrs.width) || 200, Number(to.attrs.height) || 110);
        if (distanceToSegment(world, a, b) < 8) {
          return { blockId: record.id, storeId: record.id.replace(/^arrow:/, ""), kind: "relation" };
        }
      }
      return null;
    };

    let dragging: { pointerId: number; startWorld: { x: number; y: number }; moved: Record<string, { x: number; y: number }> } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (useWorldDemoStore.getState().mode === "connect") return;
      const world = toWorld(event);
      const hit = hitTest(world);
      const store = useWorldDemoStore.getState();
      if (!hit) {
        store.select(null);
        return;
      }
      // 选择解析：block id → store 语义对象
      if (hit.kind === "relation") store.select(hit.storeId);
      else if (hit.kind === "world") store.select("world");
      else store.select(hit.storeId.replace(/^(entity|note):/, ""));

      if (hit.kind === "relation" || hit.kind === "world") return;
      const record = editor.state.getBlockById(hit.blockId);
      dragging = {
        pointerId: event.pointerId,
        startWorld: world,
        moved: { [hit.blockId]: { x: Number(record?.attrs.x) || 0, y: Number(record?.attrs.y) || 0 } },
      };
      view.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const world = toWorld(event);
      const dx = world.x - dragging.startWorld.x;
      const dy = world.y - dragging.startWorld.y;
      editor.state.transact((hook) => {
        for (const [blockId, origin] of Object.entries(dragging!.moved)) {
          // 取整避免亚像素：文字按整像素栅格化
          hook.updateBlock(blockId, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
        }
      });
      this.drawOverlay(editor);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const store = useWorldDemoStore.getState();
      for (const blockId of Object.keys(dragging.moved)) {
        const record = editor.state.getBlockById(blockId);
        if (!record) continue;
        const x = Number(record.attrs.x) || 0;
        const y = Number(record.attrs.y) || 0;
        if (blockId.startsWith("entity:")) {
          store.updateEntityPosition(blockId.slice("entity:".length), Math.round(x), Math.round(y));
        } else if (blockId.startsWith("note:")) {
          store.updateNote(blockId.slice("note:".length), { x: Math.round(x), y: Math.round(y) });
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
    this.#cleanup = () => {
      view.removeEventListener("pointerdown", onPointerDown);
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("pointerup", onPointerUp);
      view.removeEventListener("pointercancel", onPointerUp);
      this.#overlay.destroy();
    };
  }

  // 选中描边 overlay：世界坐标绘制，随 mountpoint transform 自动同步。
  // link（关系线）选中走「覆盖线」模式：节点内中心段虚线 + 边缘到 target 高亮双描边 + 三控制点
  drawOverlay(editor: PomeloEditor) {
    const g = this.#overlay;
    g.clear();
    const selectedId = useWorldDemoStore.getState().selectedId;
    if (!selectedId) return;

    // link 选中：覆盖线高亮（参考 tldraw arrow 选中态）
    const arrowRecord = editor.state.getBlockById(`arrow:${selectedId}`);
    if (arrowRecord) {
      const from = editor.state.getBlockById(String(arrowRecord.attrs.fromId ?? ""));
      const to = editor.state.getBlockById(String(arrowRecord.attrs.toId ?? ""));
      if (!from || !to) return;
      const c1 = centerOf(from)!;
      const c2 = centerOf(to)!;
      const a = edgeAnchor(c1, c2, Number(from.attrs.width) || 200, Number(from.attrs.height) || 110);
      const b = edgeAnchor(c2, c1, Number(to.attrs.width) || 200, Number(to.attrs.height) || 110);
      // 1) 节点内部段：虚线（不响应 link 语义，仅示意绑定锚点在节点中心）
      g.lineStyle({ width: 1.5, color: 0x8b93a7, alpha: 0.9, alignment: 0.5 });
      for (let t = 0; t < 1; t += 0.1) {
        g.moveTo(c1.x + (a.x - c1.x) * t, c1.y + (a.y - c1.y) * t);
        g.lineTo(c1.x + (a.x - c1.x) * Math.min(1, t + 0.05), c1.y + (a.y - c1.y) * Math.min(1, t + 0.05));
      }
      // 2) 边缘 → target：白色外描边 + 蓝色内描边（双描边高亮）
      g.lineStyle({ width: 5, color: 0xffffff, alpha: 0.95, alignment: 0.5 });
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.lineStyle({ width: 2, color: 0x4c8dff, alpha: 1, alignment: 0.5 });
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      // 箭头高亮
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      g.lineStyle(0);
      g.beginFill(0xffffff);
      g.moveTo(b.x + Math.cos(angle) * 4, b.y + Math.sin(angle) * 4);
      g.lineTo(b.x - 8 * Math.cos(angle) + 4 * -Math.sin(angle), b.y - 8 * Math.sin(angle) + 4 * Math.cos(angle));
      g.lineTo(b.x - 8 * Math.cos(angle) - 4 * -Math.sin(angle), b.y - 8 * Math.sin(angle) - 4 * Math.cos(angle));
      g.closePath();
      g.endFill();
      // 3) 三个控制点：start（默认在节点中心）/ 中点 / end
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      for (const point of [c1, mid, b]) {
        g.lineStyle(2, 0x4c8dff, 1);
        g.beginFill(0xffffff);
        g.drawCircle(point.x, point.y, 4.5);
        g.endFill();
      }
      return;
    }

    // 节点/便签选中：矩形选框 + 四角控制点
    const blockId = selectedId === "world" ? "world" : `entity:${selectedId}`;
    for (const candidate of [blockId, `note:${selectedId}`]) {
      const record = editor.state.getBlockById(candidate);
      if (!record || record.isRoot) continue;
      const x = Number(record.attrs.x) || 0;
      const y = Number(record.attrs.y) || 0;
      const width = Number(record.attrs.width) || 0;
      const height = Number(record.attrs.height) || 0;
      if (width <= 0 || height <= 0) continue;
      g.lineStyle(2, 0x7c9cff, 0.9, 1);
      g.drawRoundedRect(x - 5, y - 5, width + 10, height + 10, 12);
      g.lineStyle(0);
      g.beginFill(0x7c9cff);
      for (const [hx, hy] of [
        [x - 5, y - 5],
        [x + width + 5, y - 5],
        [x - 5, y + height + 5],
        [x + width + 5, y + height + 5],
      ]) {
        g.drawCircle(hx, hy, 4);
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

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}
