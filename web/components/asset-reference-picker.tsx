/*
 * [INPUT]: 依赖共享 Asset SSE 缓存、素材内容 API、VideoFrame、GenerationDuration 与 lucide-react 图标
 * [OUTPUT]: 对外提供素材引用选择面板、@ 快速候选、带真实图片/视频缩略图和生成时长的引用 token 与 `<media>` 剪贴板解析
 * [POS]: components 的资源引用交互层；项目对话与全局素材库共享同一稳定 assetId 协议，完成态媒体不以类型图标替代预览，运行态从 Asset 真相显示时长
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AtSign, Film, Image as ImageIcon, Music2, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { GenerationDuration } from "@/components/generation-duration";
import { useMediaAssetEvents } from "@/components/use-media-asset-events";
import { VideoFrame } from "@/components/video-frame";

export type AssetReference = {
  assetId: string;
  name: string;
  mimeType: string;
  kind: "image" | "video" | "audio";
  origin: string;
  status: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};
type Asset = Omit<AssetReference, "assetId"> & {
  id: string;
  error?: string;
  projectIds?: string[];
  updatedAt?: string;
};
type Scope = "project" | "library";

const mediaTag = /<media\s+type="(image|video|audio)"\s+assetid="([^"]+)"\s*\/>/gi;

function normalizeAsset(value: Partial<Asset> & { id?: unknown }): Asset {
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";
  const kind = value.kind === "video" || value.kind === "audio" || value.kind === "image"
    ? value.kind
    : mimeType.startsWith("video/")
      ? "video"
      : mimeType.startsWith("audio/")
        ? "audio"
        : "image";
  return {
    id: typeof value.id === "string" ? value.id : "",
    name: typeof value.name === "string" && value.name.trim() ? value.name : "未命名素材",
    mimeType,
    kind,
    origin: typeof value.origin === "string" && value.origin ? value.origin : "素材库",
    status: typeof value.status === "string" && value.status ? value.status : "completed",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    metadata: value.metadata,
    error: typeof value.error === "string" ? value.error : undefined,
    projectIds: Array.isArray(value.projectIds)
      ? value.projectIds.filter((projectID): projectID is string => typeof projectID === "string")
      : [],
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

function assetPrompt(asset: Asset) {
  return typeof asset.metadata?.prompt === "string" && asset.metadata.prompt.trim()
    ? asset.metadata.prompt
    : null;
}

function isProjectAsset(asset: Asset, projectID: string | null) {
  return !projectID || asset.projectIds?.includes(projectID);
}

function matches(asset: Asset, query: string) {
  return `${asset.name} ${asset.kind} ${asset.origin}`.toLowerCase().includes(query.toLowerCase());
}

export function mediaReferenceIDs(value: string) {
  return [...value.matchAll(mediaTag)].map((match) => match[2]).filter((id): id is string => Boolean(id));
}

export function mediaReferenceText(value: string) {
  return value
    .replace(mediaTag, "")
    .replace(/^素材(?:名称|类型|来源|状态)：.*(?:\r?\n|$)/gm, "")
    .replace(/^生成提示词：.*(?:\r?\n|$)/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function AssetReferenceChip({ apiBase, reference, onRemove }: { apiBase: string; reference: AssetReference; onRemove?: () => void }) {
  const { assetByID } = useMediaAssetEvents();
  const asset = assetByID[reference.assetId]
    ? normalizeAsset(assetByID[reference.assetId])
    : normalizeAsset({ ...reference, id: reference.assetId });
  return <div className="group inline-flex h-7 max-w-60 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pl-1 pr-1.5 text-[10px] text-foreground"><AssetThumbnail apiBase={apiBase} asset={asset} className="size-5 shrink-0 overflow-hidden rounded-[2px]" iconClassName="size-3" /><span className="truncate">{asset.name}</span><GenerationDuration className="shrink-0 font-mono text-[9px] text-muted-foreground" item={asset} />{onRemove && <button aria-label={`移除 ${asset.name}`} className="ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground" onClick={onRemove} type="button"><X className="size-3" /></button>}</div>;
}

export function AssetReferenceMenu({ apiBase, projectID, query, selectedIDs, onPick, onOpenLibrary }: { apiBase: string; projectID: string | null; query: string; selectedIDs: string[]; onPick: (asset: Asset) => void; onOpenLibrary: () => void }) {
  const { assets: cachedAssets, ready } = useMediaAssetEvents();
  const assets = useMemo(() => cachedAssets.map(normalizeAsset), [cachedAssets]);
  const options = projectID ? assets.filter((asset) => isProjectAsset(asset, projectID)) : assets;
  const visible = options.filter((asset) => !selectedIDs.includes(asset.id) && matches(asset, query)).slice(0, 5);
  return <section className="absolute bottom-full left-0 z-30 mb-2 w-80 overflow-hidden rounded-md border bg-popover shadow-[var(--shadow-overlay)]"><div className="flex items-center justify-between border-b px-3 py-2"><span className="flex items-center gap-1.5 text-xs font-medium"><AtSign className="size-3.5" />引用资源</span><button className="text-[10px] text-primary hover:underline" onClick={onOpenLibrary} type="button">浏览全部</button></div><div className="max-h-52 overflow-y-auto p-1.5">{!ready ? <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">正在读取资源…</p> : visible.length ? visible.map((asset) => <AssetOption apiBase={apiBase} asset={asset} key={asset.id} onPick={onPick} />) : <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">没有匹配的项目资源</p>}</div></section>;
}

export function AssetReferenceDialog({ apiBase, open, projectID, selectedIDs, onClose, onPick }: { apiBase: string; open: boolean; projectID: string | null; selectedIDs: string[]; onClose: () => void; onPick: (asset: Asset) => void }) {
  const [scope, setScope] = useState<Scope>(projectID ? "project" : "library");
  const [query, setQuery] = useState("");
  const { assets: cachedAssets, ready } = useMediaAssetEvents();
  const assets = useMemo(() => cachedAssets.map(normalizeAsset), [cachedAssets]);
  const activeScope = scope === "project" && projectID ? "project" : "library";
  const scoped = activeScope === "project" ? assets.filter((asset) => isProjectAsset(asset, projectID)) : assets;
  const visible = scoped.filter((asset) => !selectedIDs.includes(asset.id) && matches(asset, query));
  if (!open) return null;
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog"><section className="flex max-h-[min(680px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-3"><div><p className="text-sm font-medium">引用资源</p><p className="mt-0.5 text-[11px] text-muted-foreground">选择后会以稳定引用加入本条消息。</p></div><button aria-label="关闭资源选择" className="grid size-8 place-items-center rounded-xs hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><div className="flex items-center gap-3 border-b px-5 py-3"><div className="flex rounded-sm border p-0.5 text-xs">{projectID && <button className={`rounded-[2px] px-2.5 py-1 ${activeScope === "project" ? "bg-secondary font-medium" : "text-muted-foreground"}`} onClick={() => setScope("project")} type="button">项目资源</button>}<button className={`rounded-[2px] px-2.5 py-1 ${activeScope === "library" ? "bg-secondary font-medium" : "text-muted-foreground"}`} onClick={() => setScope("library")} type="button">素材库</button></div><span className="hidden text-[10px] text-muted-foreground sm:block">{visible.length} 个可引用资源</span><label className="relative ml-auto block w-56"><span className="sr-only">搜索资源</span><Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input autoFocus className="h-8 w-full rounded-sm border bg-background pl-7 pr-2 text-xs outline-none focus:border-primary" onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、类型或来源" value={query} /></label></div><div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">{!ready ? <p className="col-span-full py-12 text-center text-xs text-muted-foreground">正在读取资源…</p> : visible.length ? visible.map((asset) => <AssetTile apiBase={apiBase} asset={asset} key={asset.id} onPick={onPick} />) : <p className="col-span-full py-12 text-center text-xs text-muted-foreground">没有可引用的资源</p>}</div></section></div>;
}

function AssetOption({ apiBase, asset, onPick }: { apiBase: string; asset: Asset; onPick: (asset: Asset) => void }) {
  return <button className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left hover:bg-muted" onClick={() => onPick(asset)} type="button"><AssetThumbnail apiBase={apiBase} asset={asset} className="size-7 shrink-0 overflow-hidden rounded-sm" iconClassName="size-4" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{asset.name}</span><span className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">{asset.kind.toUpperCase()} · {asset.origin}{assetPrompt(asset) ? ` · ${assetPrompt(asset)}` : ""}<GenerationDuration className="shrink-0 font-mono" item={asset} /></span></span></button>;
}

function AssetTile({ apiBase, asset, onPick }: { apiBase: string; asset: Asset; onPick: (asset: Asset) => void }) {
  const prompt = assetPrompt(asset);
  return <button className="group overflow-hidden rounded-sm border bg-card text-left transition-colors hover:border-primary hover:shadow-sm" onClick={() => onPick(asset)} title={`${asset.name} · ${asset.kind} · ${asset.origin}${prompt ? ` · ${prompt}` : ""}`} type="button"><div className="relative"><AssetThumbnail apiBase={apiBase} asset={asset} className="aspect-[4/3] w-full" iconClassName="size-5" /><span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-sm bg-background/90 px-1.5 py-1 text-[10px] font-medium shadow-sm"><AssetKindIcon className="size-3" kind={asset.kind} />{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "音频"}</span>{asset.status !== "completed" && <GenerationDuration className="absolute right-2 top-2 rounded-sm bg-background/90 px-1.5 py-1 font-mono text-[10px] text-muted-foreground shadow-sm" item={asset} />}<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-2 pb-2 pt-7 text-white"><p className="truncate text-xs font-medium">{asset.name}</p></div></div><div className="min-w-0 border-t px-2 py-1.5"><p className="truncate text-[10px] text-muted-foreground">{prompt ?? asset.origin}</p><GenerationDuration className="mt-0.5 block font-mono text-[10px] text-muted-foreground" item={asset} /></div></button>;
}

function AssetThumbnail({ apiBase, asset, className, iconClassName }: { apiBase: string; asset: Asset; className: string; iconClassName: string }) {
  const source = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/content`;
  const complete = !asset.status || asset.status === "completed";
  if (complete && asset.kind === "image") return <img alt="" className={`${className} object-cover`} src={source} />;
  if (complete && asset.kind === "video") return <VideoFrame alt={`${asset.name || "视频素材"} 视频缩略图`} className={className} src={source} />;
  return <div className={`grid place-items-center bg-muted text-muted-foreground ${className}`}><AssetKindIcon className={iconClassName} kind={asset.kind} /></div>;
}

function AssetKindIcon({ className = "size-4", kind }: { className?: string; kind: Asset["kind"] }) {
  return kind === "image" ? <ImageIcon className={className} /> : kind === "video" ? <Film className={className} /> : <Music2 className={className} />;
}
