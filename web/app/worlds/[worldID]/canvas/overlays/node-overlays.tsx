/*
 * [INPUT]: 依赖 react、pomelo-core（PomeloRendererAdapter）、arrow-geometry（blockRect 渲染有效矩形）、
 *   graph-theme（LOW_DETAIL_SCALE）、
 *   canvas-store（editor/elements/entities/selection/selectedIds/hoveredBlockId/draggingBlockId/readOnly/aiLocked/
 *   inlineEdit/dataVersion/worldId/elementsContextId）、canvas-asset-status（assets）、overlays/{subject,registry,toolbar,composer}
 * [OUTPUT]: 对外提供 CanvasNodeOverlays：画布节点生成 overlay 宿主——解析单选/hover 的 block → OverlaySubject，
 *   按注册表取工具栏（节点上方）与输入框（节点下方）插件，屏幕空间锚定（transform 随视口重排、边缘翻转/clamp、
 *   低缩放/只读/AI 锁/拖拽/多选隐藏，hover 清理加宽限避免指针移向 overlay 时闪退）；内置插件在模块加载时注册
 * [POS]: worlds/[worldID]/canvas/overlays 的 React 宿主（邻接 CanvasInlineEditor 挂进 canvas-pomelo 根）（RFC 2026-10-07）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PomeloRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-renderer";
import { blockRect } from "@/lib/pomelo/world-canvas/arrow-geometry";
import { LOW_DETAIL_SCALE } from "@/lib/pomelo/world-canvas/graph-theme";
import { useWorldCanvasStore } from "../canvas-store";
import { useCanvasAssetStatusStore } from "../canvas-asset-status";
import { generationComposerPlugin } from "./composer";
import { entityBodyComposerPlugin } from "./entity-composer";
import { nodeOverlaysFor, registerNodeOverlay } from "./registry";
import { generationSubjectOf } from "./subject";
import { nodeToolbarPlugin } from "./toolbar";
import type { NodeOverlayContext, NodeOverlayKind } from "./types";

const GAP = 8;

// 内置插件注册（同 id 幂等；StrictMode 重复调用安全）
let registered = false;
function ensureBuiltins() {
  if (registered) return;
  registered = true;
  registerNodeOverlay(nodeToolbarPlugin);
  registerNodeOverlay(generationComposerPlugin);
  registerNodeOverlay(entityBodyComposerPlugin);
}

type Rect = { x: number; y: number; width: number; height: number };

function rectOfBlock(blockId: string): Rect | null {
  const editor = useWorldCanvasStore.getState().editor;
  const record = editor?.state.getBlockById(blockId);
  if (!editor || !record || record.isRoot) return null;
  // 用渲染有效矩形（blockRect 应用各 block 注册的 resolver）：实体卡高度由内容派生，
  // 与 attrs.height 存储值可能不一致；overlay 锚点必须与选区/连线所见一致。
  const rect = blockRect(record);
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function selectedBlockIdOf(selection: ReturnType<typeof useWorldCanvasStore.getState>["selection"], selectedIds: string[]): string | null {
  if (selectedIds.length > 1) return null;
  if (!selection) return null;
  if (selection.type === "entity") return `entity:${selection.entity.id}`;
  if (selection.type === "canvas") return selection.element.id;
  return null;
}

// 单个 overlay 落点：读 transform 把世界 rect 换算屏幕坐标；按 kind 放节点上方/下方，越界翻转 + 左右 clamp。
function OverlaySurface({
  kind,
  blockId,
  presence,
  rootRef,
  onHoverChange,
}: {
  kind: NodeOverlayKind;
  blockId: string;
  presence: "selected" | "hovered";
  rootRef: { current: HTMLDivElement | null };
  onHoverChange: (hovered: boolean) => void;
}) {
  const editor = useWorldCanvasStore((state) => state.editor);
  const elements = useWorldCanvasStore((state) => state.elements);
  const entities = useWorldCanvasStore((state) => state.entities);
  const assets = useCanvasAssetStatusStore((state) => state.assets);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const contextId = useWorldCanvasStore((state) => state.elementsContextId);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // 量出 overlay 自身尺寸后按 left/top 定位——**不用 CSS transform**：transform（以及 backdrop-filter）
  // 会成为 position:fixed 后代（富文本 @ 面板的 anchor）的 containing block，导致 @ 面板飞出画布。
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () =>
      setSize((prev) => (prev.width === el.offsetWidth && prev.height === el.offsetHeight ? prev : { width: el.offsetWidth, height: el.offsetHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  if (!editor) return null;
  const subject = generationSubjectOf({ elements, entities, assets }, blockId);
  if (!subject) return null;
  const adapter = editor.renderAdapter as PomeloRendererAdapter;
  const transform = adapter.transform;
  const scale = transform.scale;
  if (scale <= LOW_DETAIL_SCALE) return null;
  const rect = rectOfBlock(blockId);
  if (!rect) return null;

  const ctx: NodeOverlayContext = { blockId, subject, presence, worldId, contextId, readOnly, scale };
  const plugin = nodeOverlaysFor(ctx)[kind][0];
  if (!plugin) return null;

  const centerX = (rect.x + rect.width / 2) * scale + transform.x;
  const topEdge = rect.y * scale + transform.y;
  const bottomEdge = (rect.y + rect.height) * scale + transform.y;
  const rootW = rootRef.current?.clientWidth ?? Number.POSITIVE_INFINITY;
  const rootH = rootRef.current?.clientHeight ?? Number.POSITIVE_INFINITY;

  const width = size.width || (kind === "composer" ? 520 : 220);
  const height = size.height || (kind === "composer" ? 180 : 34);
  const left = Math.min(Math.max(centerX - width / 2, GAP), Math.max(GAP, rootW - width - GAP));
  const flipAbove = kind === "composer" ? bottomEdge + GAP + height > rootH : topEdge - GAP - height < 0;
  const top = kind === "toolbar"
    ? (flipAbove ? bottomEdge + GAP : topEdge - GAP - height)
    : (flipAbove ? topEdge - GAP - height : bottomEdge + GAP);

  return (
    <div
      className={`absolute ${kind === "composer" ? "z-30" : "z-20"} pointer-events-auto`}
      data-node-overlay={kind}
      data-overlay-block={blockId}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      ref={wrapRef}
      style={{ left, top, visibility: size.width ? "visible" : "hidden" }}
    >
      {plugin.render(ctx)}
    </div>
  );
}

export function CanvasNodeOverlays() {
  ensureBuiltins();
  const editor = useWorldCanvasStore((state) => state.editor);
  const selection = useWorldCanvasStore((state) => state.selection);
  const selectedIds = useWorldCanvasStore((state) => state.selectedIds);
  const hoveredBlockId = useWorldCanvasStore((state) => state.hoveredBlockId);
  const draggingBlockId = useWorldCanvasStore((state) => state.draggingBlockId);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const aiLocked = useWorldCanvasStore((state) => state.aiLocked);
  const inlineEdit = useWorldCanvasStore((state) => state.inlineEdit);
  const dataVersion = useWorldCanvasStore((state) => state.dataVersion);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef<string | null>(null);
  const [overlayHovered, setOverlayHovered] = useState(false);
  const [grace, setGrace] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const adapter = editor.renderAdapter as PomeloRendererAdapter;
    const unsubscribe = adapter.onTransformEvent.on(() => setTick((n) => n + 1));
    return () => unsubscribe.dispose();
  }, [editor]);

  // hover 清空后留一小段宽限：指针从节点移向 overlay 会先触发画布的 pointerleave，再触发 overlay 的 mouseenter，
  // 不留宽限 overlay 会在这一瞬被卸载，mouseenter 永不触发 → 点不到。
  useEffect(() => {
    if (hoveredBlockId || selectedIds.length === 1 || overlayHovered) {
      setGrace(true);
      return;
    }
    const timer = setTimeout(() => setGrace(false), 200);
    return () => clearTimeout(timer);
  }, [hoveredBlockId, selectedIds.length, overlayHovered]);

  void tick;
  void dataVersion;

  if (!editor || readOnly || aiLocked || draggingBlockId || inlineEdit) return null;
  if (selectedIds.length > 1) return null;

  const selectedBlockId = selectedBlockIdOf(selection, selectedIds);
  const candidate = hoveredBlockId ?? selectedBlockId;
  if (candidate) pinnedRef.current = candidate;
  const toolbarBlockId = candidate ?? (overlayHovered || grace ? pinnedRef.current : null);
  const toolbarPresence: "selected" | "hovered" = hoveredBlockId && hoveredBlockId !== selectedBlockId ? "hovered" : "selected";
  if (!toolbarBlockId && !selectedBlockId) return null;

  return (
    <div className="pointer-events-none absolute inset-0" ref={rootRef}>
      {toolbarBlockId && (
        <OverlaySurface blockId={toolbarBlockId} kind="toolbar" onHoverChange={setOverlayHovered} presence={toolbarPresence} rootRef={rootRef} />
      )}
      {selectedBlockId && (
        <OverlaySurface blockId={selectedBlockId} kind="composer" onHoverChange={setOverlayHovered} presence="selected" rootRef={rootRef} />
      )}
    </div>
  );
}
