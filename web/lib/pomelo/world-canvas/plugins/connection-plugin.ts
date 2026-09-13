/*
 * [INPUT]: 依赖 pomelo-core（PomeloPlugin / PomeloEditor）、pomelo-vello/overlay-dom（DomOverlay/cssColor）、
 * demo-store 与 world-canvas/blocks/entity-card-metrics（entityCardRect）
 * [OUTPUT]: 对外提供 ConnectionPlugin：connect 模式下从实体卡按下拖拽出一条草稿连线，
 * 移动时命中探测并吸附到目标卡中心（对应 tldraw ArrowShapeTool → updateArrowTerminal 的
 * 「拖拽终点 → 命中 shape → 绑定」流程的简化版），松手在另一张卡上即 createRelation；
 * 草稿绘制在渲染器无关的 DomOverlay（屏幕空间 SVG），含目标卡高亮
 * [POS]: lib/pomelo/world-canvas 的连线插件（学习自 tldraw 的 arrow/binding 代码路径）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";
import { DomOverlay, cssColor } from "../../pomelo-vello/overlay-dom";
import { useWorldDemoStore } from "../demo-store";
import { entityCardRect } from "../blocks/entity-card-metrics";

type Point = { x: number; y: number };

type EntityHit = { blockId: string; entityId: string; center: Point; rect: { x: number; y: number; width: number; height: number } };

type Draft = {
  pointerId: number;
  from: EntityHit;
  end: Point;
  target: EntityHit | null;
};

export class ConnectionPlugin extends PomeloPlugin {
  Name = "ConnectionPlugin";
  #overlay: DomOverlay | null = null;
  #draft: Draft | null = null;
  #cleanup?: () => void;

  onEditorDidMount(editor: PomeloEditor) {
    const adapter = editor.renderAdapter;
    const view = adapter.getView();
    if (!view) return;
    const overlay = new DomOverlay(editor.getContainerDom());
    this.#overlay = overlay;

    const toWorld = (event: PointerEvent): Point => {
      const rect = view.getBoundingClientRect();
      const t = adapter.transform;
      return { x: (event.clientX - rect.left - t.x) / t.scale, y: (event.clientY - rect.top - t.y) / t.scale };
    };
    const toScreen = (world: Point): Point => {
      const t = adapter.transform;
      return { x: world.x * t.scale + t.x, y: world.y * t.scale + t.y };
    };

    // 命中实体卡（不含 World 节点/便签——语义关系只连实体）
    const hitEntity = (world: Point): EntityHit | null => {
      const blocks = editor.state.getAllBlocks((record) => record.type === "entity-card").reverse();
      for (const record of blocks) {
        const r = entityCardRect(record.attrs as Record<string, unknown>);
        if (world.x >= r.x && world.x <= r.x + r.width && world.y >= r.y && world.y <= r.y + r.height) {
          return { blockId: record.id, entityId: record.id.slice("entity:".length), center: { x: r.x + r.width / 2, y: r.y + r.height / 2 }, rect: r };
        }
      }
      return null;
    };

    // 草稿绘制（屏幕空间 SVG）：起点节点内段虚线，边缘→终点实线（吸附目标时高亮双描边 + 目标卡高亮框）
    const paint = () => {
      const draft = this.#draft;
      overlay.setSize(adapter.getScreenSize().width, adapter.getScreenSize().height);
      overlay.clearAll();
      if (!draft) return;
      const fromRect = draft.from.rect;
      const fromCenter = { x: fromRect.x + fromRect.width / 2, y: fromRect.y + fromRect.height / 2 };
      const dx = draft.end.x - fromCenter.x;
      const dy = draft.end.y - fromCenter.y;
      let t = Infinity;
      if (dx > 0) t = Math.min(t, (fromRect.x + fromRect.width - fromCenter.x) / dx);
      else if (dx < 0) t = Math.min(t, (fromRect.x - fromCenter.x) / dx);
      if (dy > 0) t = Math.min(t, (fromRect.y + fromRect.height - fromCenter.y) / dy);
      else if (dy < 0) t = Math.min(t, (fromRect.y - fromCenter.y) / dy);
      t = Math.max(0, t);
      const edge = { x: fromCenter.x + dx * t, y: fromCenter.y + dy * t };
      const a = toScreen(fromCenter);
      const e = toScreen(edge);
      const end = toScreen(draft.end);
      // 起点节点内段：虚线（与选中态一致：锚点默认在节点中心）
      overlay.line(a.x, a.y, e.x, e.y, { stroke: cssColor(0x8b93a7, 0.9), strokeWidth: 1.5, dash: "6 4" });
      // 边缘 → 终点：实线（吸附目标时用高亮双描边）
      if (draft.target) {
        overlay.line(e.x, e.y, end.x, end.y, { stroke: cssColor(0xffffff, 0.95), strokeWidth: 5 });
        overlay.line(e.x, e.y, end.x, end.y, { stroke: cssColor(0x4c8dff), strokeWidth: 2 });
      } else {
        overlay.line(e.x, e.y, end.x, end.y, { stroke: cssColor(0x7c9cff, 0.9), strokeWidth: 2 });
      }
      overlay.circle(end.x, end.y, 4, { fill: cssColor(0x7c9cff) });
      if (draft.target) {
        const r = draft.target.rect;
        const tl = toScreen({ x: r.x, y: r.y });
        const br = toScreen({ x: r.x + r.width, y: r.y + r.height });
        overlay.roundedRect({ x: tl.x - 5, y: tl.y - 5, width: br.x - tl.x + 10, height: br.y - tl.y + 10 }, 12, { stroke: cssColor(0x34d399, 0.9), strokeWidth: 2 });
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (useWorldDemoStore.getState().mode !== "connect") return;
      const world = toWorld(event);
      const hit = hitEntity(world);
      if (!hit) return;
      this.#draft = { pointerId: event.pointerId, from: hit, end: hit.center, target: null };
      view.setPointerCapture(event.pointerId);
      useWorldDemoStore.getState().select(null);
      editor.renderAdapter.invalidate();
    };

    const onPointerMove = (event: PointerEvent) => {
      const draft = this.#draft;
      if (!draft || event.pointerId !== draft.pointerId) return;
      const world = toWorld(event);
      const target = hitEntity(world);
      // tldraw 的 updateArrowTerminal：终点吸附到命中 shape
      const end = target && target.blockId !== draft.from.blockId ? target.center : world;
      this.#draft = { ...draft, end, target: target && target.blockId !== draft.from.blockId ? target : null };
      paint();
      editor.renderAdapter.invalidate();
    };

    const onPointerUp = (event: PointerEvent) => {
      const draft = this.#draft;
      if (!draft || event.pointerId !== draft.pointerId) return;
      const store = useWorldDemoStore.getState();
      if (draft.target && draft.target.blockId !== draft.from.blockId) {
        store.createRelation(draft.from.entityId, draft.target.entityId);
        store.setMode("select");
      }
      this.#draft = null;
      paint();
      editor.renderAdapter.invalidate();
      view.releasePointerCapture?.(event.pointerId);
    };

    view.addEventListener("pointerdown", onPointerDown);
    view.addEventListener("pointermove", onPointerMove);
    view.addEventListener("pointerup", onPointerUp);
    view.addEventListener("pointercancel", onPointerUp);
    // transform（缩放/平移）变化时重绘草稿，保持屏幕空间几何正确
    const unsubTransform = adapter.onTransformEvent.on(() => paint());
    this.#cleanup = () => {
      view.removeEventListener("pointerdown", onPointerDown);
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("pointerup", onPointerUp);
      view.removeEventListener("pointercancel", onPointerUp);
      unsubTransform.dispose();
      this.#draft = null;
      overlay.destroy();
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
}
