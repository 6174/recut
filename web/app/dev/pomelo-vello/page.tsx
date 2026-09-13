/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditor/PomeloEditorState）、pomelo-vello（VelloRendererAdapter/DemoCardBlock）
 * [OUTPUT]: 对外提供 /dev/pomelo-vello 路由：用 VelloRendererAdapter 驱动 pomelo 文档（demo-card blocks）的
 *           瓦片渲染；暴露 window.__pomeloVelloDebug 供 Playwright 驱动。
 * [POS]: M2 vello 适配器验证入口；正式画布仍走 worlds/[worldID]/canvas。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import { PomeloEditorState } from "@/lib/pomelo/pomelo-core/pomelo-state";
import { VelloRendererAdapter } from "@/lib/pomelo/pomelo-vello/pomelo-vello-adapter";
import { DemoCardBlock, demoCardRecord } from "@/lib/pomelo/pomelo-vello/demo-blocks";

declare global {
  interface Window {
    __pomeloVelloDebug?: {
      editor: PomeloEditor;
      adapter: VelloRendererAdapter;
      debugState(): unknown;
      renderNow(): void;
      moveBlock(id: string, dx: number, dy: number): void;
      cards(): Array<{ id: string; x: number; y: number; width: number; height: number }>;
    };
  }
}

export default function PomeloVelloDemoPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const state = PomeloEditorState.fromJSON({
      id: "pomelo-vello-demo",
      children: [
        demoCardRecord("card-1", 0, 0, "Alpha", "#3b82f6"),
        demoCardRecord("card-2", 320, 0, "Beta", "#8b5cf6"),
        demoCardRecord("card-3", 160, 200, "Gamma", "#10b981"),
      ],
    });
    const adapter = new VelloRendererAdapter();
    const editor = new PomeloEditor({
      state,
      container,
      plugins: [],
      blockTypes: [DemoCardBlock],
      renderAdapter: adapter,
    });
    let disposed = false;
    void (async () => {
      await editor.onInit();
      if (disposed) return;
      const vp = adapter.viewport;
      if (vp) {
        const offsetX = (vp.width - 580 * vp.zoom) / 2;
        const offsetY = (vp.height - 340 * vp.zoom) / 2;
        adapter.setTransform(offsetX, offsetY, vp.zoom);
        adapter.renderNow();
      }
      window.__pomeloVelloDebug = {
        editor,
        adapter,
        debugState: () => adapter.debugState(),
        renderNow: () => adapter.renderNow(),
        moveBlock: (id, dx, dy) => {
          const record = state.getBlockById(id);
          if (!record) return;
          state.transact((hook) => {
            hook.updateBlock(id, {
              x: (Number(record.attrs.x) || 0) + dx,
              y: (Number(record.attrs.y) || 0) + dy,
            });
          });
          adapter.renderNow();
        },
        cards: () =>
          state
            .getAllBlocks((record) => record.type === DemoCardBlock.type)
            .map((record) => ({
              id: record.id,
              x: Number(record.attrs.x) || 0,
              y: Number(record.attrs.y) || 0,
              width: Number(record.attrs.width) || 0,
              height: Number(record.attrs.height) || 0,
            })),
      };
    })();
    return () => {
      disposed = true;
      delete window.__pomeloVelloDebug;
      adapter.destroy();
      editor.destroy();
    };
  }, []);

  return <div ref={containerRef} className="h-dvh w-full overflow-hidden bg-[#0b0f19]" />;
}
