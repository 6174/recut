/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditor / PixiRendererAdapter / PomeloEditorState.fromJSON）、
 * world-canvas 的 blocks / ViewportPlugin、canvas-store、pixi.js 与 lucide-react
 * [OUTPUT]: 对外提供 CanvasPomeloHost：真实世界画布的 pomelo 底座（tldraw 方案的替换）——
 * canvas-store（world_entities/world_relations/world_canvas 唯一语义真相）→ pomelo 文档全量重建；
 * ViewportPlugin（平移/缩放）+ CanvasBindsPlugin（选中解析/拖拽位移与 resize 持久化/进入容器/删除）；
 * 画布工具（模式/连线/插入/undo/缩放菜单）由 CanvasToolbarItems 承载并合并进全局 Header（canvas-top-bar.tsx），
 * 世界工具栏与「设定视图」切换仍上提到全局 Header（canvas-top-bar.tsx）；
 * 自由元素映射：note→NoteBlock、text/shape→FreeElementBlock、绑定两实体的自由箭头→复用
 * RelationArrowBlock 投影（未绑定箭头暂不渲染）；画面 delta 同步经 moveElement + persistGeometry
 * [POS]: worlds/[worldID]/canvas 的画布底座层（本组件经 index.tsx dynamic(ssr:false) 挂载）；
 * 语义真相只在 world_entities + world_relations，pomelo 文档是内存投影（canvas 变更永不产 revision）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import * as PIXI from "pixi.js";
import { PixiBlock } from "@/lib/pomelo/pomelo-core/pomelo-pixi/pomelo-pixi-block";
import { PomeloEditorState } from "@/lib/pomelo/pomelo-core/pomelo-state";
import { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import { PixiRendererAdapter } from "@/lib/pomelo/pomelo-core/pomelo-pixi/pomelo-pixi-adapter";
import { EntityCardBlock } from "@/lib/pomelo/world-canvas/blocks/entity-card-block";
import { NoteBlock, WorldNodeBlock } from "@/lib/pomelo/world-canvas/blocks/note-and-world-blocks";
import { RelationArrowBlock } from "@/lib/pomelo/world-canvas/blocks/relation-arrow-block";
import { ViewportPlugin, centerContent, panBy } from "@/lib/pomelo/world-canvas/plugins/viewport-plugin";
import { GridPlugin } from "@/lib/pomelo/world-canvas/plugins/grid-plugin";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, drawShadowCard } from "@/lib/pomelo/world-canvas/canvas-theme";
import { attrMediaLabel } from "@/lib/pomelo/world-canvas/entity-color";
import { drawElementCaption } from "@/lib/pomelo/world-canvas/truncate-text";
import { CanvasBindsPlugin } from "./canvas-pomelo-plugin";
import { entityImageUrls } from "./canvas-image";import { type AttrCreator, type AttrMedia, DEFAULT_ENTITY_SIZE, NOTE_SIZE, WORLD_ELEMENT_ID, WORLD_NODE_SIZE, elementPosition, useWorldCanvasStore, type Point } from "./canvas-store";
import { useWorldDemoStore as useWorldCanvasDemoStore } from "@/lib/pomelo/world-canvas/demo-store";
import type { WorldCanvasElement, WorldEntity } from "@/lib/recut-worlds-client";

// ---------- 自由元素 Block：text（纯文本）/ shape（几何轮廓） ----------

export class FreeElementBlock extends PixiBlock {
  static type = "free-element";

  renderBlock() {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const elementKind = String(attrs.elementKind ?? "shape");
    const shapeType = String(attrs.shapeType ?? "rectangle");
    const text = String(attrs.text ?? "");
    const width = Number(attrs.width) || 120;
    const height = Number(attrs.height) || 60;
    const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';

    const container = new PIXI.Container();
    drawElementCaption(container, {
      title:
        elementKind === "attr"
          ? `${attrMediaLabel(String(attrs.attrMedia ?? "text"))}${text ? ` · ${text.slice(0, 12)}` : ""}`
          : elementKind === "text"
            ? "文本"
            : "形状",
      icon:
        elementKind === "attr"
          ? ({ text: "📄", image: "🖼️", audio: "🎵", video: "🎬" } as Record<string, string>)[String(attrs.attrMedia ?? "text")] ?? "◍"
          : elementKind === "text"
            ? "📄"
            : "◆",
      maxWidth: 180,
    });
    if (elementKind === "text") {
      const textObj = new PIXI.Text(text || "（空文本）", {
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 20,
        fill: 0xd4d4d8,
        wordWrap: true,
        wordWrapWidth: Math.max(40, width),
        breakWords: true,
      });
      textObj.position.set(0, 0);
      container.addChild(textObj);
    } else if (elementKind === "attr") {
      // 属性预览卡：统一视觉（深色卡面 + 细边框 + 柔和投影），左上小图标+类型名，中间大图标占位
      const media = String(attrs.attrMedia ?? "text");
      drawShadowCard(container, width, height, { radius: 12 });

      const mediaIcons: Record<string, string> = { text: "📄", image: "🖼️", audio: "🎵", video: "🎬" };
      const badge = new PIXI.Text(mediaIcons[media] ?? "◍", { fontFamily: FONT, fontSize: 11 });
      badge.position.set(10, 8);
      container.addChild(badge);
      const title = new PIXI.Text(attrMediaLabel(media), { fontFamily: FONT, fontSize: 11, fill: TEXT_SECONDARY });
      title.position.set(28, 9);
      container.addChild(title);

      if (media === "text" && text) {
        const body = new PIXI.Text(text, {
          fontFamily: FONT,
          fontSize: 11,
          lineHeight: 17,
          fill: TEXT_PRIMARY,
          wordWrap: true,
          wordWrapWidth: Math.max(20, width - 20),
          breakWords: true,
        });
        body.position.set(10, 30);
        container.addChild(body);
      } else {
        const hero = new PIXI.Text(mediaIcons[media] ?? "◍", {
          fontFamily: FONT,
          fontSize: Math.min(48, height / 2),
          fill: TEXT_TERTIARY,
        });
        hero.anchor.set(0.5);
        hero.position.set(width / 2, height / 2 + 6);
        container.addChild(hero);
      }
    } else {
      const g = new PIXI.Graphics();
      g.beginFill(0xffffff, 0.03);
      g.lineStyle(1.5, 0x52525b, 1, 1);
      if (shapeType === "ellipse") {
        g.drawEllipse(width / 2, height / 2, width / 2, height / 2);
      } else if (shapeType === "diamond") {
        g.moveTo(width / 2, 0);
        g.lineTo(width, height / 2);
        g.lineTo(width / 2, height);
        g.lineTo(0, height / 2);
        g.closePath();
      } else {
        g.drawRoundedRect(0, 0, width, height, 8);
      }
      g.endFill();
      container.addChild(g);
      if (text) {
        const label = new PIXI.Text(text, {
          fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
          fontSize: 11,
          lineHeight: 16,
          fill: 0xa1a1aa,
          wordWrap: true,
          wordWrapWidth: Math.max(20, width - 16),
          breakWords: true,
        });
        label.position.set(10, 10);
        container.addChild(label);
      }
    }

    container.position.set(x, y);
    container.eventMode = "none";
    return container;
  }
}

// ---------- canvas-store → pomelo document 映射（block id 约定与 tldraw shape id 对齐） ----------

type PomeloRecord = { id: string; type: string; attrs: Record<string, unknown> };

// 拖拽/缩放会话中的实时几何（由 CanvasBindsPlugin.liveGeometry 提供）：
// 全量重建时优先采用，避免中途 dataVersion++ 的重建把正在拖拽的元素弹回 store 旧位置
function livePosOf(live: Map<string, { x: number; y: number }> | undefined, canvasId: string): Point | null {
  const value = live?.get(canvasId);
  return value ? { x: value.x, y: value.y } : null;
}

function buildPomeloRecords(
  state: ReturnType<typeof useWorldCanvasStore.getState>,
  liveGeometry?: Map<string, { x: number; y: number; width?: number; height?: number }>,
) {
  const records: PomeloRecord[] = [];
  // canvasId → 实时尺寸（拖拽/缩放中的 width/height 覆盖）
  const liveSizes = new Map<string, { width: number; height: number }>();
  if (liveGeometry) {
    for (const [canvasId, geo] of liveGeometry) {
      if (Number.isFinite(geo.width) && Number.isFinite(geo.height)) liveSizes.set(canvasId, { width: geo.width!, height: geo.height! });
    }
  }

  state.entities.forEach((entity: WorldEntity, index: number) => {
    const canvasId = `shape:${entity.id}`;
    const pos = livePosOf(liveGeometry, canvasId) ?? elementPosition(state.elements, canvasId, index);
    const element = state.elements.find((item) => item.id === canvasId);
    const liveSize = liveSizes.get(canvasId);
    const imageUrls = entityImageUrls(state.apiBase, entity);
    records.push({
      id: `entity:${entity.id}`,
      type: "entity-card",
      attrs: {
        x: pos.x,
        y: pos.y,
        width: liveSize?.width ?? (Number(element?.geometry?.width) || DEFAULT_ENTITY_SIZE.width),
        height: liveSize?.height ?? (Number(element?.geometry?.height) || DEFAULT_ENTITY_SIZE.height),
        title: entity.title,
        subtitle: "",
        tags: [],
        desc: entity.summary || "",
        kind: entity.kind,
        cover: "",
        coverUrl: imageUrls[0] ?? "",
        photoUrls: imageUrls.slice(1, 10),
        photos: [],
        isProvisional: entity.isProvisional ? true : undefined,
      },
    });
  });

  if (!state.context) {
    const worldElement = state.elements.find((element) => element.id === WORLD_ELEMENT_ID);
    const x = Number(worldElement?.geometry?.x);
    const y = Number(worldElement?.geometry?.y);
    const pos = livePosOf(liveGeometry, WORLD_ELEMENT_ID) ?? (worldElement && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 360, y: 40 });
    records.push({
      id: WORLD_ELEMENT_ID,
      type: "world-node",
      attrs: { x: pos.x, y: pos.y, width: WORLD_NODE_SIZE.width, height: WORLD_NODE_SIZE.height, title: state.worldName },
    });
  }

  state.elements.forEach((element: WorldCanvasElement, index: number) => {
    if (element.kind === "entity" || element.id === WORLD_ELEMENT_ID) return;
    const pos = livePosOf(liveGeometry, element.id) ?? elementPosition(state.elements, element.id, index);
    const liveSize = liveSizes.get(element.id);
    const width = liveSize?.width ?? (Number(element.geometry?.width) || NOTE_SIZE.width);
    const height = liveSize?.height ?? (Number(element.geometry?.height) || NOTE_SIZE.height);
    if (element.kind === "attr") {
      // 属性节点：文本/图片/音频/视频预览卡（AI 生成/上传内容承载物）
      const media = String(element.props?.media ?? "text");
      records.push({
        id: element.id,
        type: "free-element",
        attrs: {
          x: pos.x,
          y: pos.y,
          width: Number(element.geometry?.width) || (media === "text" ? 160 : 200),
          height: Number(element.geometry?.height) || (media === "text" ? 90 : 140),
          elementKind: "attr",
          attrMedia: media,
          text: String(element.props?.text ?? ""),
        },
      });
      return;
    }
    if (element.kind === "note") {
      records.push({
        id: element.id,
        type: "note",
        attrs: { x: pos.x, y: pos.y, width, height, text: String(element.props?.text ?? "") },
      });
      return;
    }
    if (element.kind === "text") {
      records.push({
        id: element.id,
        type: "free-element",
        attrs: { x: pos.x, y: pos.y, width: Number(element.geometry?.width) || 120, height: 24, elementKind: "text", text: String(element.props?.text ?? "") },
      });
      return;
    }
    if (element.kind === "shape") {
      records.push({
        id: element.id,
        type: "free-element",
        attrs: {
          x: pos.x,
          y: pos.y,
          width,
          height,
          elementKind: "shape",
          shapeType: element.props?.shapeType ?? "rectangle",
          text: String(element.props?.text ?? ""),
        },
      });
      return;
    }
    if (element.kind === "arrow") {
      // 草稿箭头投影：属性边（attrMedia 区分文本/图片/音频/视频）与实体间连线 bean 复用关系线渲染
      const fromElementId = String(element.props?.fromElementId ?? "");
      const toElementId = String(element.props?.toElementId ?? "");
      if (!fromElementId || !toElementId) return;
      const attrMedia = String(element.props?.attrMedia ?? "");
      const edgeType = String(element.props?.edgeType ?? "");
      const node = (ref: string) => (ref === WORLD_ELEMENT_ID ? ref : ref.replace(/^shape:/, "entity:"));
      const draftAnchor = {
        fromAnchor: element.props?.fromAnchor as { x: number; y: number } | undefined,
        toAnchor: element.props?.toAnchor as { x: number; y: number } | undefined,
        bend: element.props?.bend as { dx: number; dy: number } | undefined,
      };
      records.push({
        id: element.id,
        type: "relation-arrow",
        attrs: {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          fromId: node(fromElementId),
          toId: node(toElementId),
          label: attrMedia ? `属性 · ${attrMediaLabel(attrMedia)}` : edgeType || "",
          relationType: attrMedia ? `attr_${attrMedia}` : edgeType,
          ...(draftAnchor.fromAnchor ? { fromAnchor: draftAnchor.fromAnchor } : {}),
          ...(draftAnchor.toAnchor ? { toAnchor: draftAnchor.toAnchor } : {}),
          ...(draftAnchor.bend ? { bend: draftAnchor.bend } : {}),
        },
      });
    }
  });

  const entityById = new Map(state.entities.map((entity) => [entity.id, entity]));
  const seenRelations = new Set<string>();
  // 关系锚点覆盖：shape:rel-<relationId> anchor 元素（kind=arrow + props.relationId）
  const anchorOverrides = new Map<string, Record<string, unknown>>();
  for (const element of state.elements) {
    if (element.kind !== "arrow" || !element.props?.relationId) continue;
    anchorOverrides.set(String(element.props.relationId), element.props as Record<string, unknown>);
  }
  for (const relation of state.relations) {
    if (!entityById.has(relation.fromEntityId) || !entityById.has(relation.toEntityId)) continue;
    // 同一双端 + 同类型的重复关系只画第一条（历史数据可能存在重复边）
    const key = `${relation.fromEntityId}→${relation.toEntityId}·${relation.type}`;
    if (seenRelations.has(key)) continue;
    seenRelations.add(key);
    const anchorProp = anchorOverrides.get(relation.id) ?? {};
    const fromAnchor = anchorProp?.fromAnchor as { x: number; y: number } | undefined;
    const toAnchor = anchorProp?.toAnchor as { x: number; y: number } | undefined;
    const bend = anchorProp?.bend as { dx: number; dy: number } | undefined;
    records.push({
      id: `arrow:${relation.id}`,
      type: "relation-arrow",
      attrs: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fromId: `entity:${relation.fromEntityId}`,
        toId: `entity:${relation.toEntityId}`,
        label: relation.type,
        relationType: relation.type,
        ...(fromAnchor ? { fromAnchor } : {}),
        ...(toAnchor ? { toAnchor } : {}),
        ...(bend ? { bend } : {}),
      },
    });
  }
  return records;
}

function syncDocFromCanvasStore(editor: PomeloEditor) {
  const records = buildPomeloRecords(useWorldCanvasStore.getState(), (editor.pluginRegistry.get("CanvasBindsPlugin") as CanvasBindsPlugin | undefined)?.liveGeometry);
  editor.state.transact((hook) => {
    const existing = editor.state.getAllBlocks((record) => !record.isRoot).map((record) => record.id);
    existing.forEach((id) => hook.removeBlock(id));
    records.forEach((record) => hook.addBlock({ id: record.id, type: record.type, attrs: record.attrs } as never));
  });
}

// ---------- 世界工具栏已全部上提到全局 Header（canvas-top-bar.tsx），画布内不再保留顶部覆盖层 ----------

// ---------- 「+」属性引导面板（极简两步：edge 类型 + 节点类型，点节点类型即创建） ----------

function AttrCreatorPanel() {
  const creator = useWorldCanvasStore((state) => state.attrCreator);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const setAttrCreator = useWorldCanvasStore((state) => state.setAttrCreator);
  const createAttribute = useWorldCanvasStore((state) => state.createAttribute);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  // edge 类型：属性边（默认，画布层 edges）+ 受控关系词表类型（语义标签）
  const [edgeType, setEdgeType] = useState("attr");
  if (!creator || readOnly) return null;
  const edgeOptions = [{ id: "attr", label: "属性" }, ...relationTypes.map((item: { id: string; labelZh?: string }) => ({ id: item.id, label: item.labelZh ?? item.id }))];
  const mediaOptions: Array<{ media: AttrMedia; label: string; icon: string }> = [
    { media: "text", label: "文本", icon: "≡" },
    { media: "image", label: "图片", icon: "🖼" },
    { media: "audio", label: "音频", icon: "♪" },
    { media: "video", label: "视频", icon: "▶" },
  ];
  const create = (media: AttrMedia) => {
    void createAttribute(
      creator.fromEntityId,
      media,
      { x: Number.isFinite(creator.worldX) ? creator.worldX! : 420, y: Number.isFinite(creator.worldY) ? creator.worldY! : 300 },
      undefined,
      edgeType,
    );
    setAttrCreator(null);
  };
  return (
    <div className="fixed z-40 w-64 rounded-xl border border-border bg-card p-3 text-sm shadow-2xl" style={{ left: Math.min(Math.max(16, creator.screenX), (typeof window !== "undefined" ? window.innerWidth - 280 : 800)), top: Math.min(Math.max(16, creator.screenY), (typeof window !== "undefined" ? window.innerHeight - 240 : 600)) }} onMouseDown={(event) => event.stopPropagation()}>
      <p className="mb-2 truncate text-xs text-muted-foreground">从 {creator.fromEntityTitle} 生成</p>
      <p className="mb-1 text-[10px] text-muted-foreground">边类型</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {edgeOptions.map((option) => (
          <button
            key={option.id}
            className={`rounded-md border px-2 py-1 text-xs ${edgeType === option.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
            onClick={() => setEdgeType(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mb-1 text-[10px] text-muted-foreground">节点类型 · 点击即创建</p>
      <div className="grid grid-cols-4 gap-1.5">
        {mediaOptions.map((option) => (
          <button
            key={option.media}
            className="flex items-center justify-center gap-1 rounded-md border border-border px-1.5 py-2 text-xs hover:border-primary/60 hover:bg-primary/5"
            onClick={() => create(option.media)}
            type="button"
          >
            <span aria-hidden>{option.icon}</span>
            {option.label}
          </button>
        ))}
      </div>
      <button className="mt-2 w-full rounded-md px-2 py-1 text-center text-xs text-muted-foreground hover:bg-muted" onClick={() => setAttrCreator(null)} type="button">
        取消
      </button>
    </div>
  );
}

// ---------- 抓手模式：panMode 时覆盖画布，截获指针拖拽平移视口（工具组在全局 Header） ----------

function PanOverlay({ editorRef }: { editorRef: RefObject<PomeloEditor | null> }) {
  const panMode = useWorldCanvasStore((state) => state.panMode);
  const panDrag = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  if (!panMode) return null;
  const applyPan = (dx: number, dy: number) => {
    const editor = editorRef.current;
    if (!editor || (dx === 0 && dy === 0)) return;
    const adapter = editor.renderAdapter as PixiRendererAdapter;
    const next = panBy({ ...adapter.transform }, dx, dy);
    adapter.setTransform(next.x, next.y, next.scale);
    useWorldCanvasDemoStore.getState().setTransform(next);
  };
  return (
    <div
      className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        panDrag.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      }}
      onPointerMove={(event) => {
        const drag = panDrag.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        applyPan(event.clientX - drag.lastX, event.clientY - drag.lastY);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
      }}
      onPointerUp={() => {
        panDrag.current = null;
      }}
      onPointerCancel={() => {
        panDrag.current = null;
      }}
    />
  );
}

// ---------- 宿主组件 ----------

export function CanvasPomeloHost() {
  const dataVersion = useWorldCanvasStore((state) => state.dataVersion);
  const context = useWorldCanvasStore((state) => state.context);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const selection = useWorldCanvasStore((state) => state.selection);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PomeloEditor | null>(null);
  const pluginRef = useRef<CanvasBindsPlugin | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || editorRef.current) return;
    const bindsPlugin = new CanvasBindsPlugin();
    const editor = new PomeloEditor({
      state: PomeloEditorState.fromJSON({ id: "world-canvas", children: [] }),
      container,
      plugins: [new GridPlugin(), new ViewportPlugin(), bindsPlugin],
      blockTypes: [EntityCardBlock, NoteBlock, WorldNodeBlock, RelationArrowBlock, FreeElementBlock],
      renderAdapter: new PixiRendererAdapter({ transparentBackground: true, antialias: true }),
    });
    editorRef.current = editor;
    pluginRef.current = bindsPlugin;
    let cancelled = false;
    void editor.onInit().then(() => {
      if (cancelled || editorRef.current !== editor) return;
      // 背景由容器 CSS var(--background) 提供（adapter 以 backgroundAlpha:0 初始化）；
      // 点状网格由 GridPlugin 绘制
      syncDocFromCanvasStore(editor);
      centerContent(editor);
      useWorldCanvasStore.getState().setEditor(editor);
      setReady(true);
      // e2e/调试句柄（仅 dev 构建暴露）
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as Record<string, unknown>).__worldCanvasDebug = { editor, store: useWorldCanvasStore, rebuild: () => syncDocFromCanvasStore(editor) };
      }
    });
    return () => {
      cancelled = true;
      if (process.env.NODE_ENV !== "production") {
        delete (window as unknown as Record<string, unknown>).__worldCanvasDebug;
      }
      editor.destroy();
      editorRef.current = null;
      pluginRef.current = null;
      useWorldCanvasStore.getState().setEditor(null);
      setReady(false);
    };
  }, []);

  // store → 文档重建（仅 dataVersion / 上下文 / worldName 变化时；拖拽走插件 transact，不重建）
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !ready) return;
    syncDocFromCanvasStore(editor);
  }, [dataVersion, context, worldName, ready]);

  // 选中变化 → 重绘选区 overlay
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !ready) return;
    pluginRef.current?.drawOverlay(editor);
  }, [selection, dataVersion, ready]);

  return (
    <div className="relative h-full min-h-0 w-full bg-background">
      <div ref={containerRef} className="absolute inset-0 [&_canvas]:block" />
      <PanOverlay editorRef={editorRef} />
      <AttrCreatorPanel />
    </div>
  );
}
