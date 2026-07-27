/*
 * [INPUT]: 依赖共享 Asset SSE 缓存、素材元数据/内容 API、GenerationDuration、VideoFrame 与 lucide-react 图标
 * [OUTPUT]: 对外提供 AssetPreviewDialog 统一素材详情模态框；运行中素材按 assetId 从共享缓存原位更新并显示实时/最终生成耗时，同时预览完成的图片、视频首帧/播放器和音频
 * [POS]: web 的跨页面素材查看入口；素材库与 Agent 对话通过同一视图查看资产，不轮询单个 Asset 或依赖父视图刷新
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, Copy, LoaderCircle, Music2, RotateCcw, Video, X } from "lucide-react";
import { useState } from "react";
import { GenerationDuration } from "@/components/generation-duration";
import { useMediaAssetEvents } from "@/components/use-media-asset-events";
import { VideoFrame } from "@/components/video-frame";

export type PreviewAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  origin: string;
  status: "queued" | "running" | "completed" | "failed";
  jobId?: string;
  remoteId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata: { prompt?: string; capability?: unknown; modelId?: unknown; referenceIds?: unknown; generationStartedAt?: unknown; generationDurationMs?: unknown };
};

export function mediaContext(asset: PreviewAsset) {
  // 历史导入素材没有 generation metadata；复制上下文也必须和预览一样可用。
  const metadata = asset.metadata ?? {};
  const prompt = typeof metadata.prompt === "string" && metadata.prompt.trim();
  return [
    `<media type="${asset.kind}" assetid="${asset.id}"/>`,
    `素材名称：${asset.name}`,
    `素材类型：${asset.kind}`,
    `素材来源：${asset.origin}`,
    `素材状态：${asset.status}`,
    ...(prompt ? [`生成提示词：${prompt}`] : []),
  ].join("\n");
}

export function AssetPreviewDialog({ apiBase, asset: initialAsset, assets = [], onClose, onRegenerate }: { apiBase: string; asset: PreviewAsset; assets?: PreviewAsset[]; onClose: () => void; onRegenerate?: (asset: PreviewAsset) => void }) {
  const [copied, setCopied] = useState(false);
  const { assetByID, assets: liveAssets } = useMediaAssetEvents();
  const asset = (assetByID[initialAsset.id] as unknown as PreviewAsset | undefined) ?? initialAsset;
  // Older workspaces predate Asset lifecycle fields. Keep their records
  // previewable instead of trusting an upgraded UI type at runtime.
  const status = asset.status || "completed";
  const origin = asset.origin || "imported";
  const metadata = asset.metadata || {};
  const ready = status === "completed";
  const referenceIDs = Array.isArray(metadata.referenceIds) ? metadata.referenceIds.filter((id): id is string => typeof id === "string") : [];
  const knownAssets = new Map(assets.map((item) => [item.id, item]));
  liveAssets.forEach((item) => knownAssets.set(item.id, item as unknown as PreviewAsset));
  const references = referenceIDs.map((id) => knownAssets.get(id)).filter((item): item is PreviewAsset => Boolean(item));
  const statusText = status === "failed" ? "生成失败" : ready ? "已完成" : "生成中";
  const statusLabel = <><span>{statusText}</span><GenerationDuration className="font-mono text-[10px] text-muted-foreground" item={asset} /></>;
  async function copyContext() {
    await navigator.clipboard.writeText(mediaContext(asset));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-8 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog"><section className="w-full max-w-4xl overflow-hidden rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-3"><div><p className="text-sm font-medium">{asset.name || "未命名素材"}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{(asset.kind || "media").toUpperCase()} · {origin.toUpperCase()} · {status.toUpperCase()}</p></div><button aria-label="关闭预览" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><div className="grid max-h-[78vh] overflow-y-auto md:grid-cols-[minmax(0,1fr)_280px]"><div className="grid min-h-80 place-items-center bg-muted/30 p-5"><AssetContent apiBase={apiBase} asset={asset} status={status} /></div><aside className="border-l p-5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">生成信息</p>{ready && metadata.prompt && onRegenerate && <button className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted" onClick={() => onRegenerate(asset)} type="button"><RotateCcw className="size-3" />再次生成</button>}</div><button className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-xs border text-xs hover:bg-muted" onClick={() => void copyContext()} type="button">{copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}{copied ? "已复制，可粘贴给 AI" : "复制素材上下文"}</button><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">复制受控资源引用和素材信息，直接粘贴到 Agent 对话即可。</p><dl className="mt-4 space-y-4 text-xs"><div><dt className="text-muted-foreground">状态</dt><dd className="mt-1 flex items-center gap-1.5">{!ready && status !== "failed" && <LoaderCircle className="size-3 animate-spin text-primary" />}{ready && <Video className="size-3 text-primary" />}{statusLabel}</dd>{asset.error && <dd className="mt-1 leading-5 text-destructive">{asset.error}</dd>}</div><div><dt className="text-muted-foreground">提示词</dt><dd className="mt-1 leading-5">{metadata.prompt ?? "无"}</dd></div>{referenceIDs.length > 0 && <div><dt className="text-muted-foreground">参考素材</dt><dd className="mt-2 grid grid-cols-2 gap-2">{references.map((reference) => <ReferencePreview apiBase={apiBase} key={reference.id} reference={reference} />)}{references.length < referenceIDs.length && <p className="col-span-2 text-[11px] text-muted-foreground">部分参考素材已不可用。</p>}</dd></div>}<div><dt className="text-muted-foreground">创建时间</dt><dd className="mt-1">{asset.createdAt ? new Date(asset.createdAt).toLocaleString() : "未知"}</dd></div></dl></aside></div></section></div>;
}

function AssetContent({ apiBase, asset, status }: { apiBase: string; asset: PreviewAsset; status: string }) {
  if (status !== "completed") return <PendingAssetContent asset={asset} status={status} />;
  const source = mediaContentURL(apiBase, asset.id);
  if (asset.kind === "image") return <img alt={asset.name} className="max-h-[65vh] max-w-full object-contain" src={source} />;
  if (asset.kind === "audio") return <div className="w-full max-w-lg"><Music2 className="mx-auto mb-4 size-8 text-muted-foreground" /><audio className="w-full" controls preload="metadata" src={source}>你的浏览器不支持音频播放。</audio></div>;
  return <VideoFrame alt={asset.name || "视频素材"} className="w-full max-w-4xl rounded-xs bg-black" controls src={source} videoClassName="max-h-[65vh] object-contain" />;
}

function PendingAssetContent({ asset, status }: { asset: PreviewAsset; status: string }) {
  return <div className="grid max-w-sm gap-3 text-center text-muted-foreground"><LoaderCircle className={`mx-auto size-8 ${status === "failed" ? "text-destructive" : "animate-spin text-primary"}`} /><div><p className="text-sm font-medium text-foreground">{status === "failed" ? "生成失败" : "生成中"}</p><GenerationDuration className="mt-1 block font-mono text-[11px] text-muted-foreground" item={asset} /><p className="mt-1 text-xs leading-5">素材引用已经建立；完成后会在这里原位可预览。</p>{asset.error && <p className="mt-2 text-xs text-destructive">{asset.error}</p>}</div></div>;
}

function ReferencePreview({ apiBase, reference }: { apiBase: string; reference: PreviewAsset }) {
  const ready = (reference.status || "completed") === "completed";
  const source = mediaContentURL(apiBase, reference.id);
  return <div className="min-w-0">{reference.kind === "image" && ready ? <img alt={reference.name} className="aspect-square w-full rounded-xs border object-cover" src={source} /> : reference.kind === "video" && ready ? <VideoFrame alt={reference.name || "参考视频"} className="aspect-square w-full rounded-xs border" src={source} /> : <div className="grid aspect-square place-items-center rounded-xs border bg-muted text-muted-foreground"><Music2 className="size-4" /></div>}<p className="mt-1 truncate text-[10px]" title={reference.name}>{reference.name}</p><GenerationDuration className="block truncate font-mono text-[9px] text-muted-foreground" item={reference} /></div>;
}

export function mediaContentURL(apiBase: string, assetID: string) {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}/content`;
}
