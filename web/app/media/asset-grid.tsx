/*
 * [INPUT]: 依赖素材、任务生命周期契约与共享视频封面/计时组件
 * [OUTPUT]: 对外提供 AssetGrid，用与首页资源区一致的紧凑方形卡片、iframe 子文档视频封面、惰性图片与统一 More 菜单渲染素材卡片
 * [POS]: media 页面列表渲染单元；从 page.tsx 拆出以隔离预览表现与页面编排，卡片点击由外层按钮统一接收
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Captions, ImageIcon, Link2, LoaderCircle } from "lucide-react";
import { CardMoreMenu } from "@/components/card-more-menu";
import { VideoFrame } from "@/components/video-frame";
import type { Asset, MediaJob } from "./media-types";

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
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
      {jobs.map((job) => <QueuedJobCard job={job} key={job.id} />)}
      {assets.map((asset) => <AssetCard apiBase={apiBase} asset={asset} key={asset.id} onDelete={onDelete} onPreview={onPreview} onRename={onRename} />)}
    </div>
  );
}

function QueuedJobCard({ job }: { job: MediaJob }) {
  return (
    <div className="overflow-hidden rounded-xs border border-primary/40 bg-primary/5 text-left">
      <div className="grid aspect-square place-items-center bg-primary/10"><div className="text-center">
        <span className="text-xs font-medium text-primary">{job.status === "failed" ? "生成失败" : "生成中…"}</span>
      </div></div>
      <div className="p-2.5">
        <p className="truncate text-xs font-medium">{job.prompt}</p>
        <p className="mt-1 truncate text-[10px] text-muted-foreground">{job.status === "failed" ? (job.error ?? "任务未完成") : "正在生成"}</p>
      </div>
    </div>
  );
}

function AssetCard({ apiBase, asset, onDelete, onPreview, onRename }: { apiBase: string; asset: Asset; onDelete: (asset: Asset) => Promise<void>; onPreview: (asset: Asset) => void; onRename: (asset: Asset, name: string) => Promise<void> }) {
  const contentURL = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/content`;
  return <div className="group relative overflow-visible rounded-xs border bg-card text-left transition-colors hover:border-foreground/40 hover:bg-muted/20">
    <button className="block w-full overflow-hidden text-left" onClick={() => onPreview(asset)} type="button">
      {asset.status !== "completed" ? <PendingAsset asset={asset} /> : asset.kind === "image" ? <div className="aspect-square bg-muted"><img alt={asset.name} className="h-full w-full object-cover" decoding="async" loading="lazy" src={contentURL} /></div> : asset.kind === "video" ? <VideoFrame alt={asset.name || "视频素材"} className="aspect-square" src={contentURL} /> : asset.kind === "transcript" ? <TranscriptCardPreview asset={asset} /> : asset.kind === "reference" ? <ReferenceCardPreview apiBase={apiBase} asset={asset} /> : <div className="grid aspect-square place-items-center bg-muted"><span className="text-xs text-muted-foreground">{asset.kind.toUpperCase()}</span></div>}
      <div className="p-2.5">
        <p className="truncate text-xs font-medium">{asset.name}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : asset.kind === "transcript" ? "转写" : "资料"}</p>
      </div>
    </button>
    <div className="absolute right-2 top-2"><CardMoreMenu itemName={asset.name} itemType="素材" onDelete={() => onDelete(asset)} onRename={(name) => onRename(asset, name)} /></div>
  </div>;
}

function ReferenceCardPreview({ apiBase, asset }: { apiBase: string; asset: Asset }) {
  const reference = asset.metadata.reference;
  const imagePart = reference?.parts?.image;
  if (imagePart) {
    const imageURL = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/parts/image`;
    return <div className="aspect-[4/3] bg-muted"><img alt={asset.name} className="h-full w-full object-cover" decoding="async" loading="lazy" src={imageURL} /></div>;
  }
  return <div className="grid aspect-square content-center gap-2 bg-primary/5 p-4 text-primary"><Link2 className="size-5" /><p className="font-mono text-[10px] uppercase">{reference?.sourceKind || "web"}</p><p className="line-clamp-3 text-xs leading-5 text-foreground">{reference?.summary || reference?.description || reference?.excerpt || "可复用研究资料"}</p></div>;
}

function TranscriptCardPreview({ asset }: { asset: Asset }) {
  const bundle = asset.metadata?.transcript;
  const segments = typeof bundle?.segmentCount === "number" ? bundle.segmentCount : undefined;
  const duration = typeof bundle?.duration === "number" ? bundle.duration : undefined;
  return <div className="grid aspect-square place-items-center bg-violet-600/10 text-violet-700"><span className="grid gap-1 text-center"><Captions className="mx-auto size-5" /><span className="font-mono text-[10px] font-medium">转写 · {segments ?? 0} 段{typeof duration === "number" ? ` · ${duration.toFixed(1)}s` : ""}</span></span></div>;
}

function PendingAsset({ asset }: { asset: Asset }) {
  const failed = asset.status === "failed";
  return (
    <div className="grid aspect-square place-items-center bg-primary/10 px-4 text-center"><div>
      {failed ? <span className="text-xs font-medium text-destructive">生成失败</span> : <LoaderCircle className="mx-auto size-5 animate-spin text-primary" />}
      <p className="mt-2 text-xs font-medium text-foreground">{failed ? asset.error ?? "任务未完成" : "生成中…"}</p>
    </div></div>
  );
}
