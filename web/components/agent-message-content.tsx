/*
 * [INPUT]: 依赖 React 与 Recut Media 内容 HTTP API
 * [OUTPUT]: 对外提供 AgentMessageContent，将受控 media XML 节点渲染为可预览媒体
 * [POS]: components 的 Agent 回复内容层；由 project-agent-panel 使用，不解析或注入任意 HTML
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { type ReactNode } from "react";

type MediaType = "image" | "video" | "audio";
type Segment = { kind: "text"; value: string } | { kind: "media"; assetID: string; type: MediaType };

const mediaTag = /<media\s+([^>]*?)\s*\/?>(?:<\/media>)?/gi;
const attribute = /([\w-]+)\s*=\s*(["'])(.*?)\2/g;

export function AgentMessageContent({ apiBase, content }: { apiBase: string; content: string }) {
  return <div className="space-y-3 text-xs leading-5">{parseMessage(content).map((segment, index) => segment.kind === "text" ? <p className="whitespace-pre-wrap" key={index}>{segment.value}</p> : <MediaPreview apiBase={apiBase} assetID={segment.assetID} key={`${segment.assetID}-${index}`} type={segment.type} />)}</div>;
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

function MediaPreview({ apiBase, assetID, type }: { apiBase: string; assetID: string; type: MediaType }) {
  const url = `${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}/content`;
  const label = `${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}素材预览`;
  const player: Record<MediaType, ReactNode> = {
    image: <img alt={label} className="max-h-72 w-full rounded-sm object-contain" src={url} />,
    video: <video className="max-h-72 w-full rounded-sm bg-muted" controls preload="metadata" src={url} />,
    audio: <audio className="w-full" controls preload="metadata" src={url} />,
  };
  return <figure className="overflow-hidden rounded-sm border bg-muted/30"><div className="p-1">{player[type]}</div><figcaption className="border-t px-2 py-1 font-mono text-[10px] text-muted-foreground">{label} · {assetID}</figcaption></figure>;
}
