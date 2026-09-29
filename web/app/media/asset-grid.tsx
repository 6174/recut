/*
 * [INPUT]: 依赖 @tanstack/react-virtual 的行虚拟化、素材与任务生命周期契约与共享视频封面/计时组件
 * [OUTPUT]: 对外提供 AssetGrid，用与首页资源区一致的紧凑五列方形卡片、iframe 子文档视频封面、惰性图片与统一 More 菜单虚拟化渲染素材卡片，随滚动自动加载后续素材
 * [POS]: media 页面列表渲染单元；从 page.tsx 拆出以隔离预览表现与页面编排，滚动容器外借工作台内容区 [data-workspace-scroll]（与项目页一致），自身只按 scrollMargin 定位虚拟行，卡片点击由外层按钮统一接收
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Captions, ImageIcon, Link2, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardMoreMenu } from "@/components/card-more-menu";
import { MotionGraphicPreview } from "@/components/motion-graphic-preview";
import { VideoFrame } from "@/components/video-frame";
import { isConfirmableProposal, isPlanAsset } from "@/lib/media/proposal";
import type { Asset, MediaJob } from "./media-types";

// 与 Tailwind gap-3 一致：列间距由 gap-3 给，行间距由每行自身的 pb-3 给（绝对定位的行不参与 grid 行间距）。
const GRID_GAP = 12;
const ROW_OVERSCAN = 2;
// 紧凑五列方形规格：每行固定 5 张卡片，窄容器由 minmax(0, 1fr) 等比压缩。
const GRID_COLUMNS = 5;

type GridEntry =
  | { id: string; kind: "job"; job: MediaJob }
  | { id: string; kind: "asset"; asset: Asset };

export function AssetGrid({
  apiBase,
  assets,
  jobs,
  onDelete,
  onPreview,
  onRename,
}: {
  apiBase: string;
  assets: Asset[];
  jobs: MediaJob[];
  onDelete: (asset: Asset) => Promise<void>;
  onPreview: (asset: Asset) => void;
  onRename: (asset: Asset, name: string) => Promise<void>;
}) {
  // 网格自身不再是滚动容器：滚动条交给工作台内容区（[data-workspace-scroll]），与项目页对齐；
  // 虚拟化按该滚动元素定位，并用 scrollMargin 补偿标题/筛选占据的偏移。
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const entries = useMemo<GridEntry[]>(
    () => [
      ...jobs.map((job): GridEntry => ({ id: job.id, kind: "job", job })),
      ...assets.map((asset): GridEntry => ({ id: asset.id, kind: "asset", asset })),
    ],
    [assets, jobs],
  );
  const cellWidth =
    viewportWidth > 0
      ? (viewportWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS
      : 180;
  const rowCount = Math.ceil(entries.length / GRID_COLUMNS);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () =>
      (listRef.current?.closest("[data-workspace-scroll]") as HTMLElement | null) ??
      null,
    estimateSize: () => cellWidth + GRID_GAP,
    overscan: ROW_OVERSCAN,
    getItemKey: (index) => entries[index * GRID_COLUMNS]?.id ?? index,
    scrollMargin,
    useFlushSync: false,
  });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const scroller = list.closest("[data-workspace-scroll]") as HTMLElement | null;
    const sync = () => {
      setViewportWidth(list.clientWidth);
      if (scroller) {
        setScrollMargin(
          list.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            scroller.scrollTop,
        );
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(list);
    if (scroller) observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // 格子宽度变化会改行高，先清掉旧测量再按新尺寸重算。
  useEffect(() => {
    virtualizer.measure();
  }, [cellWidth, virtualizer]);

  if (!entries.length) {
    return (
      <div className="grid min-h-72 flex-1 place-items-center rounded-xs border border-dashed bg-card text-center">
        <div>
          <ImageIcon className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有素材</p>
          <p className="mt-1 text-xs text-muted-foreground">点击“创建”选择资源类型和模型，或让左侧 Agent 协作创作。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="relative w-full" ref={listRef} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * GRID_COLUMNS;
        return (
          <div
            className="absolute left-0 top-0 grid w-full items-start gap-3 pb-3"
            data-index={row.index}
            key={row.key}
            ref={virtualizer.measureElement}
            style={{
              gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
              transform: `translateY(${row.start - scrollMargin}px)`,
            }}
          >
            {entries.slice(start, start + GRID_COLUMNS).map((entry) =>
              entry.kind === "job" ? (
                <QueuedJobCard job={entry.job} key={entry.id} />
              ) : (
                <AssetCard
                  apiBase={apiBase}
                  asset={entry.asset}
                  key={entry.id}
                  onDelete={onDelete}
                  onPreview={onPreview}
                  onRename={onRename}
                />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

function QueuedJobCard({ job }: { job: MediaJob }) {
  const failed = job.status === "failed";
  return (
    <div className={`flex aspect-square flex-col overflow-hidden rounded-xs border text-left ${failed ? "bg-card" : "border-primary/40 bg-primary/5"}`}>
      <div className={`grid min-h-0 flex-1 place-items-center overflow-hidden ${failed ? "bg-muted" : "bg-primary/10"}`}>
        {failed ? (
          <div className="px-4 text-center">
            <TriangleAlert className="mx-auto size-4 text-muted-foreground/60" />
            <p className="mt-2 text-[11px] font-medium text-muted-foreground">生成失败</p>
          </div>
        ) : (
          <span className="text-xs font-medium text-primary">生成中…</span>
        )}
      </div>
      <div className="shrink-0 p-2.5">
        <p className="truncate text-xs font-medium">{job.prompt}</p>
        <p className="mt-1 truncate text-[10px] text-muted-foreground">{failed ? (job.error ?? "任务未完成") : "正在生成"}</p>
      </div>
    </div>
  );
}

function AssetCard({ apiBase, asset, onDelete, onPreview, onRename }: { apiBase: string; asset: Asset; onDelete: (asset: Asset) => Promise<void>; onPreview: (asset: Asset) => void; onRename: (asset: Asset, name: string) => Promise<void> }) {
  const contentURL = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/content`;
  // proposed 是一个服务端状态，但语义分两种：带配方=待确认提案；无配方=计划态。
  // 卡片只做预览与状态区分；主 action（确认生成 / 复制计划给 AI / Remix）都在素材详情里。
  const proposal = isConfirmableProposal(asset);
  const plan = isPlanAsset(asset);
  return <div className="group relative flex aspect-square flex-col rounded-xs border bg-card text-left transition-colors hover:border-foreground/40 hover:bg-muted/20">
    <button className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xs text-left" onClick={() => onPreview(asset)} type="button">
      <div className="min-h-0 flex-1 overflow-hidden">
        {proposal ? <ProposedAsset asset={asset} /> : plan ? <PlannedAsset asset={asset} /> : asset.status !== "completed" ? <PendingAsset asset={asset} /> : asset.kind === "image" ? <div className="h-full w-full bg-muted"><img alt={asset.name} className="h-full w-full object-cover" decoding="async" loading="lazy" src={contentURL} /></div> : asset.kind === "video" ? <VideoFrame alt={asset.name || "视频素材"} className="h-full w-full" src={contentURL} /> : asset.kind === "transcript" ? <TranscriptCardPreview asset={asset} /> : asset.kind === "document" ? <ReferenceCardPreview apiBase={apiBase} asset={asset} /> : asset.kind === "component" ? <ComponentCardPreview apiBase={apiBase} asset={asset} /> : <div className="grid h-full w-full place-items-center bg-muted"><span className="text-xs text-muted-foreground">{asset.kind.toUpperCase()}</span></div>}
      </div>
      <div className="shrink-0 p-2.5">
        <p className="truncate text-xs font-medium">{asset.name}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{proposal ? "待确认生成" : plan ? "计划中" : asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : asset.kind === "transcript" ? "转写" : asset.kind === "component" ? "组件" : "资料"}</p>
      </div>
    </button>
    <div className="absolute right-2 top-2"><CardMoreMenu itemName={asset.name} itemType="素材" onDelete={() => onDelete(asset)} onRename={(name) => onRename(asset, name)} /></div>
  </div>;
}

// 计划卡：content-first 占位素材，还没有生成配方；动作是复制计划给 AI，而不是确认生成。
function PlannedAsset({ asset }: { asset: Asset }) {
  const content = typeof asset.metadata.content === "string" ? asset.metadata.content : "";
  return (
    <div className="grid h-full w-full content-center gap-1.5 bg-sky-500/10 p-4 text-center">
      <span className="text-[11px] font-semibold text-sky-600">计划中</span>
      {content && <p className="line-clamp-4 text-[10px] leading-4 text-muted-foreground">{content}</p>}
    </div>
  );
}

// 提案卡：未确认的高价生成（视频等）。画布与编辑器同样读取资产的 proposed 状态。
function ProposedAsset({ asset }: { asset: Asset }) {
  const prompt = typeof asset.metadata.prompt === "string" ? asset.metadata.prompt : "";
  return (
    <div className="grid h-full w-full content-center gap-1.5 bg-amber-500/10 p-4 text-center">
      <span className="text-[11px] font-semibold text-amber-600">待确认生成</span>
      {prompt && <p className="line-clamp-4 text-[10px] leading-4 text-muted-foreground">{prompt}</p>}
    </div>
  );
}

function ReferenceCardPreview({ apiBase, asset }: { apiBase: string; asset: Asset }) {
  const reference = asset.metadata.document;
  const imagePart = reference?.parts?.image;
  if (imagePart) {
    const imageURL = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/parts/image`;
    return <div className="h-full w-full bg-muted"><img alt={asset.name} className="h-full w-full object-cover" decoding="async" loading="lazy" src={imageURL} /></div>;
  }
  return <div className="grid h-full w-full content-center gap-2 bg-primary/5 p-4 text-primary"><Link2 className="size-5" /><p className="font-mono text-[10px] uppercase">{reference?.sourceKind || "web"}</p><p className="line-clamp-3 text-xs leading-5 text-foreground">{reference?.summary || reference?.description || reference?.excerpt || "可复用研究资料"}</p></div>;
}

// 组件卡：Motion Graphic 组件素材。有封面用封面，否则在网格里实时渲染组件预览。
function ComponentCardPreview({ apiBase, asset }: { apiBase: string; asset: Asset }) {
  const component = asset.metadata.component;
  if (!component?.componentId) {
    return <div className="grid h-full w-full place-items-center bg-muted"><span className="text-xs text-muted-foreground">组件</span></div>;
  }
  if (component.coverUrl) {
    return <div className="h-full w-full bg-muted"><img alt={asset.name} className="h-full w-full object-cover" decoding="async" loading="lazy" src={component.coverUrl.startsWith("http") ? component.coverUrl : `${apiBase}${component.coverUrl}`} /></div>;
  }
  return (
    <div className="h-full w-full overflow-hidden bg-muted">
      <MotionGraphicPreview apiBase={apiBase} componentId={component.componentId} name={asset.name} surface={component.surface} versionId={component.versionId} />
    </div>
  );
}

function TranscriptCardPreview({ asset }: { asset: Asset }) {  const bundle = asset.metadata?.transcript;
  const segments = typeof bundle?.segmentCount === "number" ? bundle.segmentCount : undefined;
  const duration = typeof bundle?.duration === "number" ? bundle.duration : undefined;
  return <div className="grid h-full w-full place-items-center bg-violet-600/10 text-violet-700"><span className="grid gap-1 text-center"><Captions className="mx-auto size-5" /><span className="font-mono text-[10px] font-medium">转写 · {segments ?? 0} 段{typeof duration === "number" ? ` · ${duration.toFixed(1)}s` : ""}</span></span></div>;
}

function PendingAsset({ asset }: { asset: Asset }) {
  const failed = asset.status === "failed";
  if (failed) {
    return (
      <div className="grid h-full w-full min-h-0 place-items-center overflow-hidden bg-muted px-4 text-center">
        <div className="min-w-0">
          <TriangleAlert className="mx-auto size-4 text-muted-foreground/60" />
          <p className="mt-2 text-[11px] font-medium text-muted-foreground">生成失败</p>
          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground/60">{asset.error ?? "任务未完成"}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full w-full min-h-0 place-items-center overflow-hidden bg-primary/10 px-4 text-center"><div>
      <LoaderCircle className="mx-auto size-5 animate-spin text-primary" />
      <p className="mt-2 text-xs font-medium text-foreground">生成中…</p>
    </div></div>
  );
}
