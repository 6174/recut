/*
 * [INPUT]: 依赖共享 Asset SSE 缓存、素材内容 HTTP API 与统一素材详情模态框
 * [OUTPUT]: 对外提供 AgentMessageContent，将受控 media XML 节点渲染为紧凑可点击媒体卡片；异步素材显示实时/终态生成耗时，完成的视频以 iframe 子文档显示真实画面并在点击后打开详情
 * [POS]: components 的 Agent 回复内容层；由 project-agent-panel 使用，不解析或注入任意 HTML，状态由唯一 Asset 缓存驱动且不轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ImageIcon, LoaderCircle, Music2, Video } from "lucide-react";
import { useState } from "react";
import { AppReferenceCard, ProjectReferenceCard } from "@/components/agent-reference-card";
import { AssetPreviewDialog, mediaContentURL, type PreviewAsset } from "@/components/asset-preview-dialog";
import { GenerationDuration, type GenerationTiming } from "@/components/generation-duration";
import { useMediaAssetEvents } from "@/components/use-media-asset-events";
import { VideoFrame } from "@/components/video-frame";

type MediaType = "image" | "video" | "audio";
type Segment = { kind: "text"; value: string } | { kind: "media"; assetID: string; type: MediaType } | { kind: "project"; projectId: string } | { kind: "app"; appId: string };

const mediaTag = /<media\s+([^>]*?)\s*\/?>(?:<\/media>)?/gi;
const projectTag = /<project\s+([^>]*?)\s*\/?>/gi;
const appTag = /<app\s+([^>]*?)\s*\/?>/gi;
const attribute = /([\w-]+)\s*=\s*(["'])(.*?)\2/g;

export function AgentMessageContent({ apiBase, content }: { apiBase: string; content: string }) {
  const [preview, setPreview] = useState<PreviewAsset | null>(null);
  const [error, setError] = useState("");
  const { assetByID, assets } = useMediaAssetEvents();
  const openPreview = async (assetID: string) => { setError(""); const cached = assetByID[assetID]; if (cached) { setPreview(cached as unknown as PreviewAsset); return; } try { const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}`, { cache: "no-store" }); if (!response.ok) throw new Error("素材已不可用"); setPreview(await response.json() as PreviewAsset); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开素材"); } };
  return <><div className="flex flex-wrap items-start gap-2 text-xs leading-5">{parseMessage(content).map((segment, index) => segment.kind === "text" ? <p className="w-full whitespace-pre-wrap" key={index}>{segment.value}</p> : segment.kind === "media" ? <MediaPreview apiBase={apiBase} assetID={segment.assetID} key={`${segment.assetID}-${index}`} onOpen={() => void openPreview(segment.assetID)} type={segment.type} /> : segment.kind === "project" ? <ProjectReferenceCard apiBase={apiBase} key={`project-${segment.projectId}-${index}`} projectId={segment.projectId} /> : <AppReferenceCard apiBase={apiBase} key={`app-${segment.appId}-${index}`} appId={segment.appId} />)}{error && <p className="w-full text-destructive">{error}</p>}</div>{preview && <AssetPreviewDialog apiBase={apiBase} asset={preview} assets={assets as unknown as PreviewAsset[]} onClose={() => setPreview(null)} />}</>;
}

function parseMessage(content: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  const push = (segment: Segment) => { if (segment.kind === "text" && segment.value === "") return; segments.push(segment); };
  for (const match of content.matchAll(new RegExp(`(?:${mediaTag.source})|(?:${projectTag.source})|(?:${appTag.source})`, "gi"))) {
    const start = match.index ?? 0;
    if (start > cursor) push({ kind: "text", value: content.slice(cursor, start) });
    const raw = match[0];
    if (raw.startsWith("<media")) {
      const attrs = parseAttributes(match[1]);
      const assetID = attrs.assetid ?? attrs.assetId;
      const type = attrs.type as MediaType;
      if (assetID && isMediaType(type)) push({ kind: "media", assetID, type });
      else push({ kind: "text", value: raw });
    } else if (raw.startsWith("<project")) {
      const projectId = parseAttributes(match[1]).projectid ?? parseAttributes(match[1]).projectId;
      if (projectId) push({ kind: "project", projectId });
      else push({ kind: "text", value: raw });
    } else if (raw.startsWith("<app")) {
      const appId = parseAttributes(match[1]).appid ?? parseAttributes(match[1]).appId;
      if (appId) push({ kind: "app", appId });
      else push({ kind: "text", value: raw });
    } else {
      push({ kind: "text", value: raw });
    }
    cursor = start + raw.length;
  }
  if (cursor < content.length) push({ kind: "text", value: content.slice(cursor) });
  return segments.length ? segments : [{ kind: "text", value: content }];
}

function parseAttributes(source: string) {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(attribute)) attrs[match[1]] = match[3];
  return attrs;
}

function isMediaType(value: string): value is MediaType {
  return value === "image" || value === "video" || value === "audio";
}

type MediaPreviewStatus = "checking" | "queued" | "running" | "completed" | "failed";
type MediaPreviewStateData = GenerationTiming & {
  status: MediaPreviewStatus;
  error: string;
};

function MediaPreview({ apiBase, assetID, onOpen, type }: { apiBase: string; assetID: string; onOpen: () => void; type: MediaType }) {
  const { assetByID, ready } = useMediaAssetEvents();
  const asset = assetByID[assetID];
  const state: MediaPreviewStateData = asset
    ? { status: asset.status, error: asset.error ?? "", createdAt: asset.createdAt, metadata: asset.metadata }
    : ready
      ? { status: "failed", error: "素材已不可用" }
      : { status: "checking", error: "" };
  const url = mediaContentURL(apiBase, assetID);
  const label = `${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}素材预览`;
  const Icon = type === "image" ? ImageIcon : type === "video" ? Video : Music2;
  return <button aria-label={`打开${label}`} className="group block w-56 overflow-hidden rounded-sm border bg-card text-left shadow-sm transition hover:border-primary hover:shadow-md" onClick={onOpen} type="button">{state.status === "completed" ? type === "image" ? <img alt={label} className="aspect-video w-full object-cover" src={url} /> : type === "video" ? <VideoFrame alt={label} className="aspect-video w-full" src={url} /> : <div className="grid aspect-video place-items-center bg-muted text-muted-foreground"><Icon className="size-6" /></div> : <MediaPreviewState state={state} />}<span className="flex items-center gap-1.5 border-t px-2 py-1.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground"><Icon className="size-3" />{label} · 点击查看</span></button>;
}

function MediaPreviewState({ state }: { state: MediaPreviewStateData }) {
  if (state.status === "failed") return <div className="grid aspect-video place-items-center bg-muted px-3 text-center"><div><p className="text-[11px] font-medium text-destructive">生成失败</p><GenerationDuration className="mt-1 block font-mono text-[10px] text-muted-foreground" item={state} />{state.error && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{state.error}</p>}</div></div>;
  return <div className="grid aspect-video place-items-center bg-muted text-center text-muted-foreground"><div><LoaderCircle className="mx-auto size-5 animate-spin text-primary" /><p className="mt-2 text-[11px]">{state.status === "checking" ? "正在读取素材状态…" : "生成中…"}</p><GenerationDuration className="mt-1 block font-mono text-[10px] text-muted-foreground" item={state} /></div></div>;
}
