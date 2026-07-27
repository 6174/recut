/*
 * [INPUT]: 依赖素材资产元数据、素材内容 API 与 lucide-react 图标
 * [OUTPUT]: 对外提供 AssetPreviewDialog 统一素材详情模态框，播放音频并预览图片
 * [POS]: web 的跨页面素材查看入口；素材库与 Agent 对话通过同一视图查看资产
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ImageIcon, Music2, RotateCcw, X } from "lucide-react";

export type PreviewAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  origin: string;
  createdAt: string;
  metadata: { prompt?: string; capability?: unknown; modelId?: unknown; referenceIds?: unknown };
};

export function AssetPreviewDialog({ apiBase, asset, assets = [], onClose, onRegenerate }: { apiBase: string; asset: PreviewAsset; assets?: PreviewAsset[]; onClose: () => void; onRegenerate?: (asset: PreviewAsset) => void }) {
  const referenceIDs = Array.isArray(asset.metadata.referenceIds) ? asset.metadata.referenceIds.filter((id): id is string => typeof id === "string") : [];
  const references = referenceIDs.map((id) => assets.find((item) => item.id === id)).filter((item): item is PreviewAsset => Boolean(item));
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-8 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog"><section className="w-full max-w-4xl overflow-hidden rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-3"><div><p className="text-sm font-medium">{asset.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{asset.kind.toUpperCase()} · {asset.origin.toUpperCase()}</p></div><button aria-label="关闭预览" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><div className="grid max-h-[78vh] overflow-y-auto md:grid-cols-[minmax(0,1fr)_280px]"><div className="grid min-h-80 place-items-center bg-muted/30 p-5">{asset.kind === "image" ? <img alt={asset.name} className="max-h-[65vh] max-w-full object-contain" src={mediaContentURL(apiBase, asset.id)} /> : asset.kind === "audio" ? <div className="w-full max-w-lg"><Music2 className="mx-auto mb-4 size-8 text-muted-foreground" /><audio className="w-full" controls preload="metadata" src={mediaContentURL(apiBase, asset.id)}>你的浏览器不支持音频播放。</audio></div> : <p className="text-xs text-muted-foreground">视频预览将在此显示。</p>}</div><aside className="border-l p-5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">生成信息</p>{asset.metadata.prompt && onRegenerate && <button className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted" onClick={() => onRegenerate(asset)} type="button"><RotateCcw className="size-3" />再次生成</button>}</div><dl className="mt-4 space-y-4 text-xs"><div><dt className="text-muted-foreground">提示词</dt><dd className="mt-1 leading-5">{asset.metadata.prompt ?? "无"}</dd></div>{referenceIDs.length > 0 && <div><dt className="text-muted-foreground">参考素材</dt><dd className="mt-2 grid grid-cols-2 gap-2">{references.map((reference) => <div className="min-w-0" key={reference.id}>{reference.kind === "image" ? <img alt={reference.name} className="aspect-square w-full rounded-xs border object-cover" src={mediaContentURL(apiBase, reference.id)} /> : <div className="grid aspect-square place-items-center rounded-xs border bg-muted text-muted-foreground">{reference.kind === "audio" ? <Music2 className="size-4" /> : <ImageIcon className="size-4" />}</div>}<p className="mt-1 truncate text-[10px]" title={reference.name}>{reference.name}</p></div>)}{references.length < referenceIDs.length && <p className="col-span-2 text-[11px] text-muted-foreground">部分参考素材已不可用。</p>}</dd></div>}<div><dt className="text-muted-foreground">创建时间</dt><dd className="mt-1">{new Date(asset.createdAt).toLocaleString()}</dd></div></dl></aside></div></section></div>;
}

export function mediaContentURL(apiBase: string, assetID: string) {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}/content`;
}
