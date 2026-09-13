/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditor/PomeloEditorState）、pomelo-vello（VelloRendererAdapter/world-blocks/overlay-dom）
 * [OUTPUT]: 对外提供 /dev/world-vello：world-canvas 四类 block 的 vello-native 版本渲染 + DOM/SVG overlay 验证页；
 *           暴露 window.__worldVelloDebug（含 select/clearOverlay）。
 * [POS]: pomelo-vello 的 world block + overlay 迁移验证入口（M2）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import { PomeloEditorState } from "@/lib/pomelo/pomelo-core/pomelo-state";
import { VelloRendererAdapter } from "@/lib/pomelo/pomelo-vello/pomelo-vello-adapter";
import { DomOverlay } from "@/lib/pomelo/pomelo-vello/overlay-dom";
import {
  EntityCardBlockV,
  MediaNodeBlockV,
  NoteBlockV,
  RelationArrowBlockV,
  WorldNodeBlockV,
  WORLD_VELLO_BLOCKS,
  entityCardRectV,
} from "@/lib/pomelo/world-canvas/blocks/vello-world-blocks";

declare global {
  interface Window {
    __worldVelloDebug?: {
      editor: PomeloEditor;
      adapter: VelloRendererAdapter;
      debugState(): unknown;
      renderNow(): void;
      moveBlock(id: string, dx: number, dy: number): void;
      cardRect(id: string): { x: number; y: number; width: number; height: number } | null;
      select(id: string): boolean;
      clearOverlay(): void;
    };
  }
}

export default function WorldVelloDemoPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const container = containerRef.current;
    if (!wrap || !container) return;
    const state = PomeloEditorState.fromJSON({
      id: "world-vello-demo",
      children: [
        { id: "world", type: WorldNodeBlockV.type, attrs: { x: -40, y: -120, width: 220, height: 80, title: "世界" } },
        { id: "e1", type: EntityCardBlockV.type, attrs: { x: 0, y: 0, width: 264, height: 0, title: "林晚", desc: "主角 · 剑客" } },
        { id: "e2", type: EntityCardBlockV.type, attrs: { x: 360, y: 40, width: 264, height: 0, title: "旧城", desc: "地点 · 故事起点" } },
        { id: "n1", type: NoteBlockV.type, attrs: { x: 0, y: 260, width: 220, height: 120, text: "便签：开场钩子" } },
        { id: "m1", type: MediaNodeBlockV.type, attrs: { x: 360, y: 280, width: 200, height: 150 } },
        { id: "r1", type: RelationArrowBlockV.type, attrs: { x: 0, y: 0, width: 0, height: 0, fromId: "e1", toId: "e2", label: "生活在", color: "#60a5fa" } },
      ],
    });
    const adapter = new VelloRendererAdapter();
    const editor = new PomeloEditor({
      state,
      container,
      plugins: [],
      blockTypes: WORLD_VELLO_BLOCKS,
      renderAdapter: adapter,
    });
    const overlay = new DomOverlay(wrap);
    let disposed = false;
    void (async () => {
      await editor.onInit();
      if (disposed) return;
      const vp = adapter.viewport;
      if (vp) {
        overlay.setSize(vp.width, vp.height);
        adapter.setTransform((vp.width - 660 * vp.zoom) / 2, (vp.height - 460 * vp.zoom) / 2, vp.zoom);
        adapter.renderNow();
      }
      window.__worldVelloDebug = {
        editor,
        adapter,
        debugState: () => adapter.debugState(),
        renderNow: () => adapter.renderNow(),
        moveBlock: (id, dx, dy) => {
          const record = state.getBlockById(id);
          if (!record) return;
          state.transact((hook) => {
            hook.updateBlock(id, { x: (Number(record.attrs.x) || 0) + dx, y: (Number(record.attrs.y) || 0) + dy });
          });
          adapter.renderNow();
        },
        cardRect: (id) => {
          const record = state.getBlockById(id);
          return record ? entityCardRectV(record.attrs as Record<string, unknown>) : null;
        },
        select: (id) => {
          const record = state.getBlockById(id);
          const viewport = adapter.viewport;
          if (!record || !viewport) return false;
          const rect = entityCardRectV(record.attrs as Record<string, unknown>);
          overlay.setSize(viewport.width, viewport.height);
          overlay.drawSelection(rect, { x: viewport.panX, y: viewport.panY, scale: viewport.zoom });
          return true;
        },
        clearOverlay: () => overlay.clear(),
      };
    })();
    return () => {
      disposed = true;
      delete window.__worldVelloDebug;
      overlay.destroy();
      adapter.destroy();
      editor.destroy();
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-dvh w-full overflow-hidden bg-[#0b0f19]">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
