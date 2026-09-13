/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditor / PomeloEditorState.fromJSON）、pomelo-vello（VelloRendererAdapter）、
 * world-canvas 的 vello blocks / plugins / doc-sync / demo-store
 * [OUTPUT]: 对外提供 PomeloWorldCanvasDemo：tldraw 替代方案的 demo 宿主——pomelo core + vello 渲染 +
 * plugins 机制的无限画布；组合顶部工具栏（新建/连线模式/undo/redo/缩放）、右侧详情面板（loomic 交互结构：
 * 选中 → 面板编辑）、左下提示与底部缩放指示；结构变化经 syncDocFromStore 重建文档
 * [POS]: lib/pomelo/world-canvas 的组合根（demo 路由 app/dev/pomelo-canvas/page.tsx dynamic(ssr:false) 引用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VelloRendererAdapter } from "../pomelo-vello/pomelo-vello-adapter";
import { PomeloEditor } from "../pomelo-core/pomelo-editor";
import { PomeloEditorState } from "../pomelo-core/pomelo-state";
import { WORLD_VELLO_BLOCKS } from "./blocks/vello-world-blocks";
import { GridPlugin } from "./plugins/grid-plugin";
import { ConnectionPlugin } from "./plugins/connection-plugin";
import { KeyboardPlugin } from "./plugins/keyboard-plugin";
import { SelectionPlugin } from "./plugins/selection-plugin";
import { ViewportPlugin, centerContent, zoomByCenter } from "./plugins/viewport-plugin";
import { useWorldDemoStore } from "./demo-store";
import { syncDocFromStore, worldNodeBlock } from "./doc-sync";
import { DetailPanel } from "./detail-panel";
import { Toolbar } from "./toolbar";

const KINDS = ["character", "location", "story", "style", "rule", "reference"];

export default function PomeloWorldCanvasDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PomeloEditor | null>(null);
  const selectionPluginRef = useRef<SelectionPlugin | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const dataVersion = useWorldDemoStore((state) => state.dataVersion);
  const selectedId = useWorldDemoStore((state) => state.selectedId);
  const notice = useWorldDemoStore((state) => state.notice);
  const zoom = useWorldDemoStore((state) => state.transform.scale);

  // 编辑器挂载（仅一次）
  useEffect(() => {
    const container = containerRef.current;
    if (!container || editorRef.current) return;
    const state = PomeloEditorState.fromJSON({
      id: "pomelo-world-demo",
      children: [worldNodeBlock(useWorldDemoStore.getState().worldName)],
    });
    const selectionPlugin = new SelectionPlugin();
    const editor = new PomeloEditor({
      state,
      container,
      plugins: [new GridPlugin(), new ViewportPlugin(), selectionPlugin, new ConnectionPlugin(), new KeyboardPlugin()],
      blockTypes: WORLD_VELLO_BLOCKS,
      renderAdapter: new VelloRendererAdapter({ preferGpu: true }),
    });
    editorRef.current = editor;
    selectionPluginRef.current = selectionPlugin;
    (window as unknown as { __pomeloEditor?: PomeloEditor }).__pomeloEditor = editor;
    void editor.onInit().then(() => {
      // StrictMode 下 editor1 可能在 onInit 恢复前已被销毁，避免对已销毁编辑器做初始化
      if (editorRef.current !== editor) return;
      // 真实案例式浅色画布（demo 内覆盖 display 默认深色，不影响引擎其他编辑器）
      // 背景由容器 CSS var(--background) 提供
      syncDocFromStore(editor.state);
      centerContent(editor);
      setEditorReady(true);
    });
    return () => {
      editor.destroy();
      editorRef.current = null;
      selectionPluginRef.current = null;
      setEditorReady(false);
    };
  }, []);

  // 结构变化 → 全量重建文档（拖拽位移走插件 transact，不触发重建）
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editorReady) return;
    syncDocFromStore(editor.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, editorReady]);

  // 选中变化 → 刷新选中描边 overlay
  useEffect(() => {
    const editor = editorRef.current;
    selectionPluginRef.current?.drawOverlay(editor!);
  }, [selectedId, dataVersion, editorReady]);

  const handleZoom = useCallback((factor: number) => {
    if (editorRef.current) zoomByCenter(editorRef.current, factor);
  }, []);

  const handleCenter = useCallback(() => {
    if (editorRef.current) centerContent(editorRef.current);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Toolbar
        kinds={KINDS}
        editor={editorRef}
        editorReady={editorReady}
        onZoomIn={() => handleZoom(1.2)}
        onZoomOut={() => handleZoom(1 / 1.2)}
        onCenter={handleCenter}
      />
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 [&_canvas]:block" />
        <DetailPanel />
        {notice && (
          <div className="absolute bottom-4 left-4 z-10 max-w-sm rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            {notice}
          </div>
        )}
        <div className="absolute bottom-4 right-[21.5rem] z-10 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          {(zoom * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
}
