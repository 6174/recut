/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditor / PomeloEditorState.fromJSON）、pomelo-vello（VelloRendererAdapter /
 *          RendererUnsupportedError）、world-canvas（WORLD_VELLO_BLOCKS / GridPlugin）、lib/i18n 与
 *          lib/marketing-worlds 的画布投影数据
 * [OUTPUT]: 对外提供 MarketingWorldCanvasVello：官网世界观详情的真实世界画布预览宿主——把 MarketingWorldCanvas
 *          映射为 pomelo 文档（entity-card / media / note / relation-arrow），经 VelloRendererAdapter(WebGPU) 渲染；
 *          按宽度自适应 fit、拖拽平移、⌘/Ctrl+滚轮缩放；WebGPU 不可用时经 onUnsupported 交回宿主回退
 * [POS]: web/components 的官网画布预览渲染层；由 marketing-world-canvas-preview.tsx 经 dynamic(ssr:false) 懒挂载，
 *        自身不读取工作台状态、不写入任何数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import { PomeloEditorState } from "@/lib/pomelo/pomelo-core/pomelo-state";
import { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import type { PomeloBlockRecord } from "@/lib/pomelo/pomelo-core/pomelo-renderer";
import { VelloRendererAdapter, RendererUnsupportedError, RendererInitError } from "@/lib/pomelo/pomelo-vello/pomelo-vello-adapter";
import { WORLD_VELLO_BLOCKS } from "@/lib/pomelo/world-canvas/blocks/vello-world-blocks";
import { GridPlugin } from "@/lib/pomelo/world-canvas/plugins/grid-plugin";
import { type Locale, t } from "@/lib/i18n";
import type { MarketingCanvasElement, MarketingWorldCanvas } from "@/lib/marketing-worlds";

const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const FIT_PADDING = 48;

export type MarketingWorldCanvasVelloProps = {
  canvas: MarketingWorldCanvas;
  locale: Locale;
  onReady?: () => void;
  onUnsupported?: (message: string) => void;
};

// 关系类型 → 连线标签（与工作台 relationLabel 对齐；未收录回退原始 type）。
const RELATION_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    appears_in: "出现于", part_of: "属于", belongs_to: "师门", located_in: "位于", references: "引用",
    contains: "包含", owns: "拥有", created_by: "创作于", father: "父亲", mother: "母亲", child: "子女", friend: "朋友", enemy: "敌对",
  },
  en: {
    appears_in: "Appears in", part_of: "Part of", belongs_to: "Belongs to", located_in: "Located in", references: "References",
    contains: "Contains", owns: "Owns", created_by: "Created by", father: "Father", mother: "Mother", child: "Child", friend: "Friend", enemy: "Enemy",
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 类型 id → 官网本地化标签（缺 key 时回退原 id）。 */
function entityTypeLabel(kind: string, locale: Locale): string {
  if (!kind) return "";
  const key = `worlds.entity.${kind}`;
  const label = t("marketing", locale, key);
  return label === key ? kind : label;
}

function relationLabel(type: string, locale: Locale): string {
  if (!type) return "";
  return RELATION_LABELS[locale][type] ?? type;
}

/** MarketingWorldCanvas → pomelo 文档记录（block id 与真实画布约定对齐：实体 `entity:<id>`、关系 `arrow:<id>`）。 */
function buildRecords(canvas: MarketingWorldCanvas, locale: Locale): PomeloBlockRecord[] {
  const records: PomeloBlockRecord[] = canvas.elements.map((element: MarketingCanvasElement, index: number) => {
    const key = element.key || `el-${index}`;
    if (element.kind === "entity") {
      return {
        id: `entity:${element.entityId || key}`,
        type: "entity-card",
        attrs: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          title: element.name,
          desc: entityTypeLabel(element.typeLabel, locale),
          coverUrl: element.imageUrl || "",
        },
      };
    }
    if (element.kind === "media") {
      return {
        id: `media:${key}`,
        type: "media",
        attrs: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          modality: "image",
          src: element.url,
          label: element.name || "",
        },
      };
    }
    return {
      id: `note:${key}`,
      type: "note",
      attrs: { x: element.x, y: element.y, width: element.width, height: element.height, text: element.text },
    };
  });
  // 语义关系连线（复用 RelationArrowBlockV）：两端实体块 id 与工作台一致（entity:<id>）；
  // 不传 color，跟随 block 默认灰（与工作台 renderBlock 缺省一致）
  canvas.relations.forEach((relation, index) => {
    const toRole = relation.toRole ?? "";
    records.push({
      id: `arrow:${relation.id || index}`,
      type: "relation-arrow",
      attrs: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fromId: `entity:${relation.from}`,
        toId: `entity:${relation.to}`,
        label: relationLabel(relation.fromRole, locale),
        fromRole: relation.fromRole,
        toRole,
        hasReverse: toRole !== "",
        reverseLabel: toRole ? relationLabel(toRole, locale) : "",
        relationType: relation.fromRole,
      },
    });
  });
  return records;
}

function contentBounds(canvas: MarketingWorldCanvas) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of canvas.elements) {
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + element.height);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height };
  return { minX, minY, maxX, maxY };
}

/** 初始视口：按宽度自适应（不超过 1:1），横向居中、纵向太矮时居中否则贴顶。 */
function fitToWidth(editor: PomeloEditor, canvas: MarketingWorldCanvas) {
  const adapter = editor.renderAdapter as VelloRendererAdapter;
  const view = adapter.getView();
  if (!view) return;
  const rect = view.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const { minX, minY, maxX, maxY } = contentBounds(canvas);
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const scale = clamp(Math.min((rect.width - FIT_PADDING * 2) / contentW, 1), MIN_SCALE, MAX_SCALE);
  const x = (rect.width - contentW * scale) / 2 - minX * scale;
  const y = contentH * scale < rect.height - FIT_PADDING * 2 ? (rect.height - contentH * scale) / 2 - minY * scale : FIT_PADDING - minY * scale;
  adapter.setTransform(x, y, scale);
  adapter.renderNow();
}

/** 真实世界画布预览宿主：pomelo 文档 + vello(WebGPU) 渲染 + 平移缩放。 */
export default function MarketingWorldCanvasVello({ canvas, locale, onReady, onUnsupported }: MarketingWorldCanvasVelloProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PomeloEditor | null>(null);
  const callbacksRef = useRef({ onReady, onUnsupported });
  callbacksRef.current = { onReady, onUnsupported };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = new PomeloEditor({
      state: PomeloEditorState.fromJSON({ id: "marketing-world-canvas", children: buildRecords(canvas, locale) }),
      container,
      plugins: [new GridPlugin()],
      blockTypes: WORLD_VELLO_BLOCKS,
      renderAdapter: new VelloRendererAdapter(),
    });
    editorRef.current = editor;
    let disposed = false;
    void editor.onInit()
      .then(() => {
        if (disposed || editorRef.current !== editor) return;
        fitToWidth(editor, canvas);
        callbacksRef.current.onReady?.();
      })
      .catch((error) => {
        if (disposed) return;
        callbacksRef.current.onUnsupported?.(
          error instanceof RendererUnsupportedError || error instanceof RendererInitError
            ? error.message
            : `世界画布渲染器初始化失败：${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return () => {
      disposed = true;
      // editor.destroy 只清理 pixi 的 app；vello 的 rasterizer/底图需显式释放
      (editor.renderAdapter as VelloRendererAdapter).destroy();
      editor.destroy();
      editorRef.current = null;
    };
  }, [canvas, locale]);

  // 平移（拖拽）/ 缩放（⌘/Ctrl+滚轮，普通滚轮留给页面滚动）
  useEffect(() => {
    const container = containerRef.current;
    const editor = editorRef.current;
    if (!container || !editor) return;
    const adapter = editor.renderAdapter as VelloRendererAdapter;
    let panning: { pointerId: number; x: number; y: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      panning = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      container.setPointerCapture(event.pointerId);
      container.style.cursor = "grabbing";
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panning || event.pointerId !== panning.pointerId) return;
      const current = adapter.transform;
      adapter.setTransform(current.x + (event.clientX - panning.x), current.y + (event.clientY - panning.y), current.scale);
      panning.x = event.clientX;
      panning.y = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!panning || event.pointerId !== panning.pointerId) return;
      panning = null;
      container.releasePointerCapture?.(event.pointerId);
      container.style.cursor = "grab";
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const current = adapter.transform;
      const scale = clamp(current.scale * Math.exp(-event.deltaY * 0.002), MIN_SCALE, MAX_SCALE);
      const worldX = (screenX - current.x) / current.scale;
      const worldY = (screenY - current.y) / current.scale;
      adapter.setTransform(screenX - worldX * scale, screenY - worldY * scale, scale);
    };

    container.style.cursor = "grab";
    container.style.touchAction = "none";
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.style.cursor = "";
      container.style.touchAction = "";
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("wheel", onWheel);
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden [&_canvas]:block" />;
}
