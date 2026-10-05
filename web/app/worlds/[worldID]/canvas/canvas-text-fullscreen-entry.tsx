/*
 * [INPUT]: 依赖 react、lucide-react（Maximize2）、pomelo-core（PomeloRendererAdapter）、
 *          canvas-store（hoveredBlockId / draggingBlockId / selection / editor / startElementBodyEdit /
 *          elements）与适配器 transform
 * [OUTPUT]: 对外提供 CanvasTextFullscreenEntry：文本卡（便签/自由文本/文本属性卡）右上角的**常驻全屏入口**——
 *           指针 hover 或选中该卡片时，在卡片右上角浮出一枚全屏按钮，点击直接进入全屏编辑器（可编辑可保存，
 *           无需先双击进就地编辑）。尺寸/位置用屏幕空间（世界坐标经适配器 transform 换算），随视口平移/缩放重排。
 *           只对文本类卡片显示（note / free-element:text / free-element:attr-text）；媒体/形状/实体卡不显示；
 *           拖动文本框（draggingBlockId 非空）时隐藏——按钮不随实时几何重排，会停在旧位置；视口 <= LOW_DETAIL_SCALE
 *           文本框已退化为面预览时也隐藏（预览态不需要放大入口）。
 * [POS]: worlds/[worldID]/canvas 的画布覆盖层（就地编辑器的伴生入口，与 CanvasInlineEditor 同层）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PomeloRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-renderer";
import { LOW_DETAIL_SCALE } from "@/lib/pomelo/world-canvas/graph-theme";
import { useWorldCanvasStore } from "./canvas-store";

export function CanvasTextFullscreenEntry() {
  const editor = useWorldCanvasStore((state) => state.editor);
  const elements = useWorldCanvasStore((state) => state.elements);
  const hoveredBlockId = useWorldCanvasStore((state) => state.hoveredBlockId);
  const draggingBlockId = useWorldCanvasStore((state) => state.draggingBlockId);
  const selection = useWorldCanvasStore((state) => state.selection);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const [tick, setTick] = useState(0);
  // 指针移到按钮上时会离开画布 view（触发 pointerleave 清 hoveredBlockId）：用本状态把按钮「钉住」，
  // 否则按钮一出现就因指针离开画布而消失，永远点不到。hover 清空加一点宽限，避免跨越空隙闪烁。
  const [buttonHovered, setButtonHovered] = useState(false);
  const [hoverGrace, setHoverGrace] = useState(false);
  const pinnedRef = useRef<string | null>(null);

  // 视口变化时重算屏幕位置（transform 事件驱动重渲染）
  useEffect(() => {
    if (!editor) return;
    const adapter = editor.renderAdapter as PomeloRendererAdapter;
    const unsubscribe = adapter.onTransformEvent.on(() => setTick((n) => n + 1));
    return () => unsubscribe.dispose();
  }, [editor]);

  // hover 清空后留一小段宽限：指针从卡片移向按钮会先触发 view 的 pointerleave 再触发按钮 mouseenter，
  // 不留宽限按钮会在这一瞬被卸载，mouseenter 永不触发 → 点不到。
  useEffect(() => {
    if (hoveredBlockId || selection) {
      setHoverGrace(true);
      return;
    }
    const timer = setTimeout(() => setHoverGrace(false), 160);
    return () => clearTimeout(timer);
  }, [hoveredBlockId, selection]);

  void tick;

  // 入口目标：指针在按钮上时钉住上一次目标；否则 hover 的块优先，其次当前选中元素
  const selectedId = selection?.type === "canvas" ? selection.element.id : null;
  const candidate = hoveredBlockId ?? selectedId;
  if (candidate) pinnedRef.current = candidate;
  const targetBlockId = candidate ?? (buttonHovered || hoverGrace ? pinnedRef.current : null);

  // 拖动该文本框时隐藏：全屏入口不参与实时几何重排，留着会停在旧位置
  if (!editor || readOnly || !targetBlockId || draggingBlockId) return null;

  // block id 即 world_canvas 元素 id（实体卡另有 entity: 前缀，非文本入口）
  const element = elements.find((item) => item.id === targetBlockId);
  if (!element) return null;
  const kind =
    element.kind === "note"
      ? "note-body"
      : element.kind === "text"
        ? "text-body"
        : element.kind === "attr" && String(element.props?.media ?? "text") === "text"
          ? "attr-body"
          : null;
  if (!kind) return null;

  const record = editor.state.getBlockById(targetBlockId);
  if (!record || record.isRoot) return null;
  const t = (editor.renderAdapter as PomeloRendererAdapter).transform;
  // 低细节（文本框已退化为面预览）：不显示放大入口
  if (t.scale <= LOW_DETAIL_SCALE) return null;
  const x = Number(record.attrs.x) || 0;
  const y = Number(record.attrs.y) || 0;
  const w = Number(record.attrs.width) || 0;
  const h = Number(record.attrs.height) || 0;
  if (w <= 0 || h <= 0) return null;
  // 卡片右上角（屏幕空间），按钮贴在其内侧
  const right = (x + w) * t.scale + t.x;
  const top = y * t.scale + t.y;
  // 极小缩放下的按钮下界，保证仍可点
  const size = Math.max(18, Math.min(24, 20 * Math.max(0.6, t.scale)));

  return (
    <button
      aria-label="全屏查看"
      className="absolute z-20 flex items-center justify-center rounded border border-border/60 bg-card/90 text-muted-foreground shadow outline-none hover:text-foreground"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        useWorldCanvasStore.getState().startElementBodyEdit(targetBlockId, kind, { fullscreen: true });
      }}
      onMouseDown={(event) => {
        // 阻止指针事件落到画布：否则会先 select/drag，进而在 click 前改变 hover/选中
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseEnter={() => setButtonHovered(true)}
      onMouseLeave={() => setButtonHovered(false)}
      onDoubleClick={(event) => event.stopPropagation()}
      style={{ left: right - size - 6, top: top + 6, width: size, height: size }}
      title="全屏查看"
      type="button"
    >
      <Maximize2 style={{ width: size * 0.6, height: size * 0.6 }} />
    </button>
  );
}
