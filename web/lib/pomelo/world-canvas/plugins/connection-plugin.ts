/*
 * [INPUT]: 依赖 pixi.js、pomelo-core（PomeloPlugin / PixiRendererAdapter）与 demo-store
 * [OUTPUT]: 对外提供 ConnectionPlugin：connect 模式下从实体卡按下拖拽出一条草稿连线，
 * 移动时命中探测并吸附到目标卡中心（对应 tldraw ArrowShapeTool → updateArrowTerminal 的
 * 「拖拽终点 → 命中 shape → 绑定」流程的简化版），松手在另一张卡上即 createRelation；
 * 草稿绘制在 mountpoint host 内随 transform 同步，含目标卡高亮
 * [POS]: lib/pomelo/world-canvas 的连线插件（学习自 tldraw 的 arrow/binding 代码路径）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import type { PomeloEditor } from "../../pomelo-core/pomelo-editor";
import type { PixiRendererAdapter } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { PomeloPlugin } from "../../pomelo-core/pomelo-plugin";
import { useWorldDemoStore } from "../demo-store";

export class ConnectionPlugin extends PomeloPlugin {
  Name = "ConnectionPlugin";
  #draft = new PIXI.Graphics();
  #highlight = new PIXI.Graphics();
  #cleanup?: () => void;

  onEditorDidMount(editor: PomeloEditor) {
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    const view = adapter.app.view as HTMLCanvasElement;
    const host = adapter.mountpointBlock.hostElement.el;
    host.addChild(this.#draft);
    host.addChild(this.#highlight);

    const toWorld = (event: PointerEvent) => {
      const rect = view.getBoundingClientRect();
      const t = adapter.transform;
      return { x: (event.clientX - rect.left - t.x) / t.scale, y: (event.clientY - rect.top - t.y) / t.scale };
    };

    // 命中实体卡（不含 World 节点/便签——语义关系只连实体）
    const hitEntity = (world: { x: number; y: number }) => {
      const blocks = editor.state.getAllBlocks((record) => record.type === "entity-card").reverse();
      for (const record of blocks) {
        const x = Number(record.attrs.x) || 0;
        const y = Number(record.attrs.y) || 0;
        const width = Number(record.attrs.width) || 200;
        const height = Number(record.attrs.height) || 110;
        if (world.x >= x && world.x <= x + width && world.y >= y && world.y <= y + height) {
          return { blockId: record.id, entityId: record.id.slice("entity:".length), center: { x: x + width / 2, y: y + height / 2 } };
        }
      }
      return null;
    };

    let drafting: { pointerId: number; from: { blockId: string; entityId: string; center: { x: number; y: number } } } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (useWorldDemoStore.getState().mode !== "connect") return;
      const world = toWorld(event);
      const hit = hitEntity(world);
      if (!hit) return;
      drafting = { pointerId: event.pointerId, from: hit };
      view.setPointerCapture(event.pointerId);
      useWorldDemoStore.getState().select(null);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drafting || event.pointerId !== drafting.pointerId) return;
      const world = toWorld(event);
      const target = hitEntity(world);
      // tldraw 的 updateArrowTerminal：终点吸附到命中 shape
      const end = target && target.blockId !== drafting.from.blockId ? target.center : world;
      const g = this.#draft;
      g.clear();
      g.lineStyle(2, 0x7c9cff, 0.9);
      g.moveTo(drafting.from.center.x, drafting.from.center.y);
      g.lineTo(end.x, end.y);
      g.lineStyle(0);
      g.beginFill(0x7c9cff);
      g.drawCircle(end.x, end.y, 4);
      g.endFill();

      const hl = this.#highlight;
      hl.clear();
      if (target && target.blockId !== drafting.from.blockId) {
        const record = editor.state.getBlockById(target.blockId);
        const x = Number(record?.attrs.x) || 0;
        const y = Number(record?.attrs.y) || 0;
        const width = Number(record?.attrs.width) || 200;
        const height = Number(record?.attrs.height) || 110;
        hl.lineStyle(2, 0x34d399, 0.9, 1);
        hl.drawRoundedRect(x - 5, y - 5, width + 10, height + 10, 12);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drafting || event.pointerId !== drafting.pointerId) return;
      const world = toWorld(event);
      const target = hitEntity(world);
      const store = useWorldDemoStore.getState();
      if (target && target.blockId !== drafting.from.blockId) {
        store.createRelation(drafting.from.entityId, target.entityId);
        store.setMode("select");
      }
      this.#draft.clear();
      this.#highlight.clear();
      view.releasePointerCapture?.(event.pointerId);
      drafting = null;
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
      this.#draft.destroy();
      this.#highlight.destroy();
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
