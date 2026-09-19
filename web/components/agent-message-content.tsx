/*
 * [INPUT]: 依赖共享 Asset SSE 缓存、素材内容 HTTP API 与统一素材详情模态框
 * [OUTPUT]: 对外提供 AgentMessageContent，将受控 media XML 节点渲染为紧凑可点击媒体卡片；异步素材显示实时/终态生成耗时，完成的视频以 iframe 子文档显示真实画面并在点击后打开详情
 * [POS]: components 的 Agent 回复内容层；由 project-agent-panel 使用，不解析或注入任意 HTML，状态由唯一 Asset 缓存驱动且不轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Captions, ImageIcon, Link2, LoaderCircle, Music2, Video } from "lucide-react";
import { useState } from "react";
import { AppReferenceCard, GenericReferenceCard, ProjectReferenceCard } from "@/components/agent-reference-card";
import { AssetPreviewDialog, mediaContentURL, type PreviewAsset } from "@/components/asset-preview-dialog";
import { GenerationDuration, type GenerationTiming } from "@/components/generation-duration";
import { useMediaAssetEvents } from "@/components/use-media-asset-events";
import { VideoFrame } from "@/components/video-frame";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import { parseInlineRefs } from "@/lib/rich-composer/protocol/parse";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";

type MediaType = "image" | "video" | "audio" | "transcript" | "document";
type Segment =
  | { kind: "text"; value: string }
  | { kind: "media"; assetID: string; type: MediaType }
  | { kind: "project"; projectId: string }
  | { kind: "app"; appId: string }
  | { kind: "reference"; sourceType: string; attrs: Record<string, string> };

export function AgentMessageContent({ apiBase, content }: { apiBase: string; content: string }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<PreviewAsset | null>(null);
  const [error, setError] = useState("");
  const { assetByID, assets } = useMediaAssetEvents();
  const openPreview = async (assetID: string) => { setError(""); const cached = assetByID[assetID]; if (cached) { setPreview(cached as unknown as PreviewAsset); return; } try { const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}`, { cache: "no-store" }); if (!response.ok) throw new Error(t("agent.message.assetUnavailable")); setPreview(await response.json() as PreviewAsset); } catch (cause) { setError(cause instanceof Error ? cause.message : t("agent.message.openFailed")); } };
  return <><div className="flex flex-wrap items-start gap-2 text-xs leading-5">{parseMessage(content).map((segment, index) => segment.kind === "text" ? <p className="w-full whitespace-pre-wrap" key={index}>{segment.value}</p> : segment.kind === "media" ? <MediaPreview apiBase={apiBase} assetID={segment.assetID} key={`${segment.assetID}-${index}`} onOpen={() => void openPreview(segment.assetID)} type={segment.type} /> : segment.kind === "project" ? <ProjectReferenceCard apiBase={apiBase} key={`project-${segment.projectId}-${index}`} projectId={segment.projectId} /> : segment.kind === "app" ? <AppReferenceCard apiBase={apiBase} key={`app-${segment.appId}-${index}`} appId={segment.appId} /> : <GenericReferenceCard attrs={segment.attrs} key={`${segment.sourceType}-${index}`} sourceType={segment.sourceType} />)}{error && <p className="w-full text-destructive">{error}</p>}</div>{preview && <AssetPreviewDialog apiBase={apiBase} asset={preview} assets={assets as unknown as PreviewAsset[]} onClose={() => setPreview(null)} />}</>;
}

// parseMessage 复用唯一注册表：任何已注册 type 的标签都渲染为对应卡片，未知标签原样保留为文本（前向兼容）。
function parseMessage(content: string): Segment[] {
  if (!content) return [{ kind: "text", value: "" }];
  const segments: Segment[] = [];
  let cursor = 0;
  const push = (segment: Segment) => { if (segment.kind === "text" && segment.value === "") return; segments.push(segment); };
  for (const ref of parseInlineRefs(content, contextProtocolRegistry())) {
    if (ref.start > cursor) push({ kind: "text", value: content.slice(cursor, ref.start) });
    const attrs = ref.attrs;
    if (ref.type === "media") {
      const assetID = attrs.assetid;
      const type = attrs.type as MediaType;
      if (assetID && isMediaType(type)) push({ kind: "media", assetID, type });
      else push({ kind: "text", value: ref.raw });
    } else if (ref.type === "project") {
      if (attrs.projectid) push({ kind: "project", projectId: attrs.projectid });
      else push({ kind: "text", value: ref.raw });
    } else if (ref.type === "app") {
      if (attrs.appid) push({ kind: "app", appId: attrs.appid });
      else push({ kind: "text", value: ref.raw });
    } else {
      push({ kind: "reference", sourceType: ref.type, attrs });
    }
    cursor = ref.end;
  }
  if (cursor < content.length) push({ kind: "text", value: content.slice(cursor) });
  return segments.length ? segments : [{ kind: "text", value: content }];
}

function isMediaType(value: string): value is MediaType {
  return value === "image" || value === "video" || value === "audio" || value === "transcript" || value === "reference";
}

type MediaPreviewStatus = "checking" | "proposed" | "queued" | "running" | "completed" | "failed";
type MediaPreviewStateData = GenerationTiming & {
  status: MediaPreviewStatus;
  error: string;
};

function MediaPreview({ apiBase, assetID, onOpen, type }: { apiBase: string; assetID: string; onOpen: () => void; type: MediaType }) {
  const { t } = useI18n();
  const { assetByID, ready } = useMediaAssetEvents();
  const asset = assetByID[assetID];
  const state: MediaPreviewStateData = asset
    ? { status: asset.status, error: asset.error ?? "", createdAt: asset.createdAt, metadata: asset.metadata }
    : ready
      ? { status: "failed", error: t("agent.message.assetUnavailable") }
      : { status: "checking", error: "" };
  const url = mediaContentURL(apiBase, assetID);
  const previewKey = type === "image" ? "agent.message.preview.image" : type === "video" ? "agent.message.preview.video" : type === "transcript" ? "agent.message.preview.transcript" : type === "document" ? "agent.message.preview.reference" : "agent.message.preview.audio";
  const label = t(previewKey);
  const Icon = type === "image" ? ImageIcon : type === "video" ? Video : type === "transcript" ? Captions : type === "document" ? Link2 : Music2;
  return <button aria-label={interpolate(t("agent.message.open"), { label })} className="group block w-56 overflow-hidden rounded-sm border bg-card text-left shadow-sm transition hover:border-primary hover:shadow-md" onClick={onOpen} type="button">{state.status === "completed" ? type === "image" ? <img alt={label} className="aspect-video w-full object-cover" src={url} /> : type === "video" ? <VideoFrame alt={label} className="aspect-video w-full" src={url} /> : <div className="grid aspect-video place-items-center bg-muted text-muted-foreground"><Icon className="size-6" /></div> : <MediaPreviewState state={state} />}<span className="flex items-center gap-1.5 border-t px-2 py-1.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground"><Icon className="size-3" />{label} · {t("agent.message.clickToView")}</span></button>;
}

function MediaPreviewState({ state }: { state: MediaPreviewStateData }) {
  const { t } = useI18n();
  if (state.status === "failed") return <div className="grid aspect-video place-items-center bg-muted px-3 text-center"><div><p className="text-[11px] font-medium text-destructive">{t("agent.message.generationFailed")}</p><GenerationDuration className="mt-1 block font-mono text-[10px] text-muted-foreground" item={state} />{state.error && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{state.error}</p>}</div></div>;
  if (state.status === "proposed") return <div className="grid aspect-video place-items-center bg-muted px-3 text-center text-muted-foreground"><p className="text-[11px] font-medium text-amber-600">{t("agent.message.planned")}</p></div>;
  return <div className="grid aspect-video place-items-center bg-muted text-center text-muted-foreground"><div><LoaderCircle className="mx-auto size-5 animate-spin text-primary" /><p className="mt-2 text-[11px]">{state.status === "checking" ? t("agent.message.checking") : t("agent.message.generating")}</p><GenerationDuration className="mt-1 block font-mono text-[10px] text-muted-foreground" item={state} /></div></div>;
}
