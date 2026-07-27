/*
 * [INPUT]: 依赖 React、素材内容 HTTP API 与统一素材详情模态框
 * [OUTPUT]: 对外提供 AgentMessageContent，将受控 media XML 节点渲染为紧凑可点击媒体卡片
 * [POS]: components 的 Agent 回复内容层；由 project-agent-panel 使用，不解析或注入任意 HTML
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ImageIcon, Music2, Video } from "lucide-react";
import { useState } from "react";
import { AssetPreviewDialog, mediaContentURL, type PreviewAsset } from "@/components/asset-preview-dialog";

type MediaType = "image" | "video" | "audio";
type Segment = { kind: "text"; value: string } | { kind: "media"; assetID: string; type: MediaType };

const mediaTag = /<media\s+([^>]*?)\s*\/?>(?:<\/media>)?/gi;
const attribute = /([\w-]+)\s*=\s*(["'])(.*?)\2/g;

export function AgentMessageContent({ apiBase, content }: { apiBase: string; content: string }) {
  const [preview, setPreview] = useState<PreviewAsset | null>(null);
  const [assets, setAssets] = useState<PreviewAsset[]>([]);
  const [error, setError] = useState("");
  const openPreview = async (assetID: string) => { setError(""); try { const [assetResponse, assetsResponse] = await Promise.all([fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}`), fetch(`${apiBase}/v1/media/assets`)]); if (!assetResponse.ok) throw new Error("素材已不可用"); setPreview(await assetResponse.json()); if (assetsResponse.ok) setAssets(await assetsResponse.json()); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开素材"); } };
  return <><div className="space-y-3 text-xs leading-5">{parseMessage(content).map((segment, index) => segment.kind === "text" ? <p className="whitespace-pre-wrap" key={index}>{segment.value}</p> : <MediaPreview apiBase={apiBase} assetID={segment.assetID} key={`${segment.assetID}-${index}`} onOpen={() => void openPreview(segment.assetID)} type={segment.type} />)}{error && <p className="text-destructive">{error}</p>}</div>{preview && <AssetPreviewDialog apiBase={apiBase} asset={preview} assets={assets} onClose={() => setPreview(null)} />}</>;
}

function parseMessage(content: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(mediaTag)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: "text", value: content.slice(cursor, start) });
    const attrs = parseAttributes(match[1]);
    const assetID = attrs.assetid ?? attrs.assetId;
    const type = attrs.type as MediaType;
    if (assetID && isMediaType(type)) segments.push({ kind: "media", assetID, type });
    else segments.push({ kind: "text", value: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < content.length) segments.push({ kind: "text", value: content.slice(cursor) });
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

function MediaPreview({ apiBase, assetID, onOpen, type }: { apiBase: string; assetID: string; onOpen: () => void; type: MediaType }) {
  const url = mediaContentURL(apiBase, assetID);
  const label = `${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}素材预览`;
  const Icon = type === "image" ? ImageIcon : type === "video" ? Video : Music2;
  return <button aria-label={`打开${label}`} className="group block w-56 overflow-hidden rounded-sm border bg-card text-left shadow-sm transition hover:border-primary hover:shadow-md" onClick={onOpen} type="button">{type === "image" ? <img alt={label} className="aspect-video w-full object-cover" src={url} /> : <div className="grid aspect-video place-items-center bg-muted text-muted-foreground"><Icon className="size-6" /></div>}<span className="flex items-center gap-1.5 border-t px-2 py-1.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground"><Icon className="size-3" />{label} · 点击查看</span></button>;
}
