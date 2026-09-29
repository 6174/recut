/*
 * [INPUT]: 依赖 next/dynamic、lib/i18n、lib/marketing-worlds（画布投影 + 实体树 + 类型标签）与
 *          components/world-entity-tree（与工作台共用的大纲树渲染件）；动态加载 marketing-world-canvas-vello
 *          （真实 pomelo-vello 画布宿主）；locale 由 marketing-worlds 注入，不回引 marketing-site 以避开循环依赖
 * [OUTPUT]: 对外提供 MarketingWorldCanvasPreview（/worlds/:id 详情的世界画布区块）与可复用的 MarketingWorldCanvasStage——
 *          固定高度框内加载真实 vello 画布（实体卡 + 语义关系连线，拖拽平移 / ⌘滚轮缩放 / 单击选中设定），
 *          WebGPU 不可用时只提示不支持（不做静态画布回退），滚动进入视口才懒加载；
 *          右侧 dock 与工作台同构：上半只读属性 panel + 可拖拽 resizer + 下半大纲 panel（世界根节点 = 回到整体视图，
 *          点实体 = 选中并把该实体卡居中；只读预览只有根画布，没有子世界可进）
 * [POS]: web/components 的官网画布预览壳；数据仍由服务端页面经 props 注入，本文件不发请求
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import dynamic from "next/dynamic";
import { Globe2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WorldEntityTree } from "@/components/world-entity-tree";
import { t, type Locale } from "@/lib/i18n";
import { entityTypeLabel, type MarketingWorld, type MarketingWorldCanvas, type MarketingWorldEntity } from "@/lib/marketing-worlds";
import { buildEntityTreeGroups, type EntityTreeItem } from "@/lib/world-entity-tree";

/** 大纲下发的视口请求（nonce 保证重复点同一节点也重放） */
type CanvasViewRequest = { nonce: number; target: { kind: "fit" } | { kind: "entity"; entityId: string } };

// 真实画布依赖 WebGPU/DOM，仅客户端挂载；模块独立按需下载，避免污染官网主包。
const MarketingWorldCanvasVello = dynamic(() => import("./marketing-world-canvas-vello"), { ssr: false });

// dock 内两个 panel 的高度下限：拖 resizer 时两边都还看得见；高度没拖过时平分（测量前用 DEFAULT_OUTLINE_HEIGHT 兜底）
const MIN_OUTLINE_HEIGHT = 120;
const MIN_DETAIL_HEIGHT = 120;
const DEFAULT_OUTLINE_HEIGHT = 150;

export function MarketingWorldCanvasPreview({ world, locale }: { world: MarketingWorld; locale: Locale }) {
  const canvas = world.canvas;
  if (!canvas || !canvas.elements.length) return null;
  return (
    <section className="mt-12">
      <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "worlds.canvas.eyebrow")}</p>
      <div className="relative mt-4 h-[360px] w-full overflow-hidden rounded-2xl border bg-background sm:h-[460px] lg:h-[540px]">
        <MarketingWorldCanvasStage canvas={canvas} entities={world.entities} locale={locale} tree={world.tree} worldName={world.name} />
      </div>
    </section>
  );
}

/** 只读世界画布舞台：真实 vello 画布 + 右侧 dock（属性 / 大纲），WebGPU 不可用时提示不支持；官网详情页与首页案例播放器共用。 */
export function MarketingWorldCanvasStage({
  canvas,
  locale,
  tree,
  entities,
  worldName,
}: {
  canvas: MarketingWorldCanvas;
  locale: Locale;
  tree?: EntityTreeItem[];
  /** 实体摘要（发布物里每页最多 6 条）：只读属性 panel 的内容来源 */
  entities?: MarketingWorldEntity[];
  worldName?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [shouldMount, setShouldMount] = useState(false);
  const [velloReady, setVelloReady] = useState(false);
  const [supported, setSupported] = useState(true);
  const [viewRequest, setViewRequest] = useState<CanvasViewRequest | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 折叠集（默认全展开，只有显式折叠的节点在这里）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // dock 内竖向分配（与工作台同一套交互）：没拖过时两个 panel 平分
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const [outlineHeight, setOutlineHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    setDockHeight(dockRef.current?.getBoundingClientRect().height ?? 0);
  }, []);
  const resolvedOutlineHeight = outlineHeight ?? (dockHeight > 0 ? Math.round(dockHeight / 2) : DEFAULT_OUTLINE_HEIGHT);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const nonceRef = useRef(0);

  // 滚动进入视口前不挂载真实画布，避免每个世界详情页都下载 wasm + 字体。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldMount(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const treeItems = tree ?? [];
  const groups = useMemo(() => buildEntityTreeGroups(treeItems), [treeItems]);
  const nodeById = useMemo(() => new Map(treeItems.map((item) => [item.id, item])), [treeItems]);
  const detailById = useMemo(() => new Map((entities ?? []).map((entity) => [entity.id, entity])), [entities]);
  const canvasEntityIds = useMemo(
    () => new Set(canvas.elements.filter((element) => element.kind === "entity").map((element) => element.entityId)),
    [canvas],
  );
  // 树上选中的节点（含没在画布上的）与详情里的实体摘要（只有发布物列出的几条）
  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const selectedEntity = selectedId ? detailById.get(selectedId) ?? null : null;
  const selectedTitle = selectedEntity?.title ?? selectedNode?.name ?? "";
  const selectedKind = selectedEntity?.kind ?? selectedNode?.typeId ?? "";

  const requestView = (target: CanvasViewRequest["target"]) => {
    nonceRef.current += 1;
    setViewRequest({ nonce: nonceRef.current, target });
  };
  const resizeTo = (clientY: number) => {
    const drag = resizeRef.current;
    if (!drag) return;
    const containerHeight = dockRef.current?.getBoundingClientRect().height ?? 0;
    const max = Math.max(MIN_OUTLINE_HEIGHT, containerHeight - MIN_DETAIL_HEIGHT);
    setOutlineHeight(Math.min(max, Math.max(MIN_OUTLINE_HEIGHT, drag.startHeight - (clientY - drag.startY))));
  };
  return (
    <div ref={rootRef} className="absolute inset-0 flex">
      <div className="relative min-w-0 flex-1">
        {shouldMount && supported && (
          <div className={velloReady ? "absolute inset-0" : "pointer-events-none absolute inset-0 opacity-0"}>
            <MarketingWorldCanvasVello
              canvas={canvas}
              locale={locale}
              onReady={() => setVelloReady(true)}
              onSelectEntity={setSelectedId}
              onUnsupported={() => setSupported(false)}
              viewRequest={viewRequest}
            />
          </div>
        )}
        {!supported && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <p className="max-w-sm rounded-lg border border-border/70 bg-muted/40 px-4 py-3 text-center text-xs leading-5 text-muted-foreground">
              {t("marketing", locale, "worlds.canvas.fallback")}
            </p>
          </div>
        )}
        {velloReady && (
          <span className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
            {t("marketing", locale, "worlds.canvas.hint")}
          </span>
        )}
      </div>
      {treeItems.length > 0 && (
        <div ref={dockRef} className="flex w-56 shrink-0 flex-col overflow-hidden border-l bg-background">
          {/* 上：只读属性 panel（选中设定的事实） */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-card px-3">
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <h3 className="truncate text-xs font-semibold">{selectedId ? selectedTitle : t("marketing", locale, "worlds.canvas.properties")}</h3>
                {selectedId && selectedKind && <span className="shrink-0 text-[10px] text-muted-foreground">{entityTypeLabel(selectedKind, locale)}</span>}
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
              {selectedId ? <MarketingEntityFacts entity={selectedEntity} fallbackTitle={selectedTitle} /> : <p className="leading-5 text-muted-foreground">{t("marketing", locale, "worlds.canvas.selectHint")}</p>}
            </div>
          </section>
          {/* 中：拖拽调整两个 panel 的高度分配 */}
          <div
            aria-label={t("marketing", locale, "worlds.canvas.outline")}
            className="group relative h-1.5 shrink-0 cursor-row-resize touch-none"
            onPointerCancel={() => {
              resizeRef.current = null;
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              resizeRef.current = { startY: event.clientY, startHeight: resolvedOutlineHeight };
            }}
            onPointerMove={(event) => resizeTo(event.clientY)}
            onPointerUp={() => {
              resizeRef.current = null;
            }}
            role="separator"
          >
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border group-hover:bg-foreground/25" />
          </div>
          {/* 下：大纲 panel（世界根节点 + 完整实体树） */}
          <section className="flex shrink-0 flex-col overflow-hidden" style={{ height: resolvedOutlineHeight }}>
            <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-card px-3">
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <h3 className="text-xs font-semibold">{t("marketing", locale, "worlds.canvas.outline")}</h3>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{treeItems.length}</span>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
              <button
                className={`mb-1.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted ${
                  selectedId ? "text-foreground/90" : "bg-secondary font-medium text-foreground"
                }`}
                onClick={() => {
                  setSelectedId(null);
                  requestView({ kind: "fit" });
                }}
                type="button"
              >
                <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{worldName}</span>
              </button>
              <WorldEntityTree
                activeId={selectedId}
                collapsedIds={collapsed}
                groups={groups}
                isFocusable={(node) => canvasEntityIds.has(node.id)}
                labelOf={(typeId) => entityTypeLabel(typeId, locale)}
                onSelect={(node) => {
                  setSelectedId(node.id);
                  requestView({ kind: "entity", entityId: node.id });
                }}
                onToggleCollapse={(entityId) =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(entityId)) next.delete(entityId);
                    else next.add(entityId);
                    return next;
                  })
                }
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** 只读属性：封面 + 简介（发布物里实体只有这些可展示字段）；没有摘要条目时至少显示名称。 */
function MarketingEntityFacts({ entity, fallbackTitle }: { entity: MarketingWorldEntity | null; fallbackTitle: string }) {
  if (!entity) return <p className="leading-5 text-muted-foreground">{fallbackTitle}</p>;
  return (
    <div className="space-y-2">
      {entity.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={entity.title} className="w-full rounded-lg border bg-muted object-cover" loading="lazy" src={entity.imageUrl} />
      )}
      {entity.summary ? (
        <p className="leading-5 text-muted-foreground">{entity.summary}</p>
      ) : (
        <p className="text-muted-foreground">—</p>
      )}
    </div>
  );
}
