/*
 * [INPUT]: 依赖素材、任务生命周期契约与共享视频封面/计时组件
 * [OUTPUT]: 对外提供 AssetGrid，用 iframe 子文档视频封面、惰性图片与持久化/实时耗时渲染素材卡片
 * [POS]: media 页面列表渲染单元；从 page.tsx 拆出以隔离预览表现与页面编排，卡片点击由外层按钮统一接收
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Captions, ImageIcon, LoaderCircle } from "lucide-react";
import { GenerationDuration } from "@/components/generation-duration";
import { VideoFrame } from "@/components/video-frame";
import type { Asset, MediaJob } from "./media-types";

export function AssetGrid({
  apiBase,
  assets,
  jobs,
  onPreview,
}: {
  apiBase: string;
  assets: Asset[];
  jobs: MediaJob[];
  onPreview: (asset: Asset) => void;
}) {
  if (!assets.length && !jobs.length) {
    return (
      <div className="grid min-h-72 place-items-center rounded-xs border border-dashed bg-card text-center">
        <div>
          <ImageIcon className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有素材</p>
          <p className="mt-1 text-xs text-muted-foreground">点击“创建”选择资源类型和模型，或让左侧 Agent 协作创作。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {jobs.map((job) => <QueuedJobCard job={job} key={job.id} />)}
      {assets.map((asset) => <AssetCard apiBase={apiBase} asset={asset} key={asset.id} onPreview={onPreview} />)}
    </div>
  );
}

function QueuedJobCard({ job }: { job: MediaJob }) {
  return (
    <div className="overflow-hidden rounded-xs border border-primary/40 bg-primary/5 text-left">
      <div className="grid aspect-[4/3] place-items-center bg-primary/10"><div className="text-center">
        <span className="text-xs font-medium text-primary">{job.status === "failed" ? "生成失败" : "生成中…"}</span>
        <GenerationDuration className="mt-1 block font-mono text-[11px] text-muted-foreground" item={job} />
        <p className="mt-1 text-[11px] text-muted-foreground">正在建立素材引用…</p>
      </div></div>
      <div className="p-3">
        <p className="truncate text-xs font-medium">{job.prompt}</p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{job.status === "failed" ? (job.error ?? "任务未完成") : "正在请求模型并生成素材。"}</p>
        <div className="mt-3 flex justify-between font-mono text-[10px] text-muted-foreground"><span>{job.capability.replace(".generate", "").toUpperCase()}</span><span>{job.status.toUpperCase()}</span></div>
      </div>
    </div>
  );
}

function AssetCard({ apiBase, asset, onPreview }: { apiBase: string; asset: Asset; onPreview: (asset: Asset) => void }) {
  const contentURL = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/content`;
  return (
    <button className="overflow-hidden rounded-xs border bg-card text-left transition-colors hover:border-foreground/40 hover:bg-muted/20" onClick={() => onPreview(asset)} type="button">
      {asset.status !== "completed" ? <PendingAsset asset={asset} /> : asset.kind === "image" ? <div className="aspect-[4/3] bg-muted"><img alt={asset.name} className="h-full w-full object-cover" decoding="async" loading="lazy" src={contentURL} /></div> : asset.kind === "video" ? <VideoFrame alt={asset.name || "视频素材"} className="aspect-[4/3]" src={contentURL} /> : asset.kind === "transcript" ? <TranscriptCardPreview asset={asset} /> : <div className="grid aspect-[4/3] place-items-center bg-muted"><span className="text-xs text-muted-foreground">{asset.kind.toUpperCase()}</span></div>}
      <div className="p-3">
        <p className="truncate text-xs font-medium">{asset.name}</p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{asset.metadata.prompt ?? "导入素材"}</p>
        <div className="mt-3 flex justify-between font-mono text-[10px] text-muted-foreground"><span>{asset.origin.toUpperCase()}</span><span>{new Date(asset.createdAt).toLocaleDateString()}</span></div>
        <GenerationDuration className="mt-1 block font-mono text-[10px] text-muted-foreground" item={asset} />
      </div>
    </button>
  );
}

function TranscriptCardPreview({ asset }: { asset: Asset }) {
  const bundle = asset.metadata?.transcript;
  const segments = typeof bundle?.segmentCount === "number" ? bundle.segmentCount : undefined;
  const duration = typeof bundle?.duration === "number" ? bundle.duration : undefined;
  return <div className="grid aspect-[4/3] place-items-center bg-violet-600/10 text-violet-700"><span className="grid gap-1 text-center"><Captions className="mx-auto size-5" /><span className="font-mono text-[10px] font-medium">转写 · {segments ?? 0} 段{typeof duration === "number" ? ` · ${duration.toFixed(1)}s` : ""}</span></span></div>;
}

function PendingAsset({ asset }: { asset: Asset }) {
  const failed = asset.status === "failed";
  return (
    <div className="grid aspect-[4/3] place-items-center bg-primary/10 px-4 text-center"><div>
      {failed ? <span className="text-xs font-medium text-destructive">生成失败</span> : <LoaderCircle className="mx-auto size-5 animate-spin text-primary" />}
      <p className="mt-2 text-xs font-medium text-foreground">{failed ? asset.error ?? "任务未完成" : "生成中…"}</p>
      <GenerationDuration className="mt-1 block font-mono text-[11px] text-muted-foreground" item={asset} />
      {!failed && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">素材引用已建立，完成后会原位显示。</p>}
    </div></div>
  );
}
