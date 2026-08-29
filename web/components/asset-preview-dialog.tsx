"use client";

import { Check, ChevronDown, ChevronUp, Copy, Download, FileText, Link2, LoaderCircle, Music2, RotateCcw, Video, X, ZoomIn } from "lucide-react";
import { useEffect, useState } from "react";
import { AudioWaveformPlayer } from "@/components/audio-waveform-player";
import { GenerationDuration } from "@/components/generation-duration";
import { useMediaAssetEvents } from "@/components/use-media-asset-events";
import { VideoFrame } from "@/components/video-frame";
import { Badge } from "@/components/ui/badge";

export type ReferenceMetadata = {
  url?: string;
  sourceKind?: string;
  title?: string;
  summary?: string;
  description?: string;
  excerpt?: string;
  author?: string;
  publishedAt?: string;
  siteName?: string;
  language?: string;
  thumbnailUrl?: string;
  contentMimeType?: string;
  contentLength?: number;
  contentWordCount?: number;
  media?: {
    channelName?: string;
    channelUrl?: string;
    durationSeconds?: number;
    viewCount?: number;
    likeCount?: number;
    language?: string;
  };
  parts?: Record<string, { name?: string; contentHash?: string; mimeType?: string; sizeBytes?: number }>;
};

export type PreviewAsset = {
  id: string;
  kind: "image" | "video" | "audio" | "transcript" | "reference";
  name: string;
  origin: string;
  status: "queued" | "running" | "completed" | "failed";
  jobId?: string;
  remoteId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata: { prompt?: string; capability?: unknown; modelId?: unknown; referenceIds?: unknown; generationStartedAt?: unknown; generationDurationMs?: unknown; transcript?: { sourceAssetId?: string; model?: string; language?: string; duration?: number; segmentCount?: number }; reference?: ReferenceMetadata };
};

export function mediaContext(asset: PreviewAsset) {
  const metadata = asset.metadata ?? {};
  const prompt = typeof metadata.prompt === "string" && metadata.prompt.trim();
  const transcript = transcriptMetadata(asset);
  const reference = metadata.reference as ReferenceMetadata | undefined;
  return [
    `<media type="${asset.kind}" assetid="${asset.id}"/>`,
    `素材名称：${asset.name}`,
    `素材类型：${asset.kind === "transcript" ? "转写（源声音 + SRT + JSON）" : asset.kind === "reference" ? "研究资料链接" : asset.kind}`,
    `素材来源：${asset.origin}`,
    `素材状态：${asset.status}`,
    ...(transcript ? [
      `转写来源素材：${transcript.sourceAssetId || "未知"}`,
      `转写模型：${transcript.model || "未知"}`,
      `语言：${transcript.language || "未知"}`,
      `时长：${transcript.duration ?? 0} 秒`,
      `分段数：${transcript.segmentCount ?? 0}`,
    ] : []),
    ...(reference ? [
      `研究资料链接：${reference.url || "未知"}`,
      `来源类型：${reference.sourceKind || "web"}`,
      `作者：${reference.author || reference.media?.channelName || "未知"}`,
      `发布时间：${reference.publishedAt || "未知"}`,
      `站点：${reference.siteName || "未知"}`,
      `语言：${reference.language || reference.media?.language || "未知"}`,
      ...(typeof reference.media?.durationSeconds === "number" ? [`时长：${reference.media.durationSeconds} 秒`] : []),
      ...(typeof reference.media?.viewCount === "number" ? [`播放量：${reference.media.viewCount}`] : []),
      ...(typeof reference.media?.likeCount === "number" ? [`点赞数：${reference.media.likeCount}`] : []),
      ...(reference.summary ? [`事实摘要：${reference.summary}`] : []),
      ...(typeof reference.contentWordCount === "number" ? [`正文：约 ${reference.contentWordCount} 词`] : []),
    ] : []),
    ...(prompt ? [`生成提示词：${prompt}`] : []),
  ].join("\n");
}

export function AssetPreviewDialog({ apiBase, asset: initialAsset, assets = [], onClose, onRegenerate }: { apiBase: string; asset: PreviewAsset; assets?: PreviewAsset[]; onClose: () => void; onRegenerate?: (asset: PreviewAsset) => void }) {
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const { assetByID, assets: liveAssets } = useMediaAssetEvents();
  const asset = (assetByID[initialAsset.id] as unknown as PreviewAsset | undefined) ?? initialAsset;
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
  const onImageClick = (src: string) => setLightbox(src);
  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-8 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog">
      <section className="flex w-full max-w-5xl flex-col overflow-hidden rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-sm font-medium">{asset.name || "未命名素材"}</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{(asset.kind || "media").toUpperCase()} · {origin.toUpperCase()} · {status.toUpperCase()}</p>
          </div>
          <button aria-label="关闭预览" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button>
        </header>
        <div className="grid max-h-[78vh] min-h-0 overflow-hidden md:grid-cols-[1.55fr_340px]">
          <div className="grid min-h-0 place-items-center overflow-auto bg-muted/40 p-5">
            <AssetContent apiBase={apiBase} asset={asset} status={status} onImageClick={onImageClick} />
          </div>
          <aside className="min-h-0 overflow-y-auto border-l p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium">生成信息</p>
              {ready && metadata.prompt && onRegenerate && <button className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted" onClick={() => onRegenerate(asset)} type="button"><RotateCcw className="size-3" />再次生成</button>}
            </div>
            <button className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-xs border text-xs hover:bg-muted" onClick={() => void copyContext()} type="button">{copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}{copied ? "已复制，可粘贴给 AI" : "复制素材上下文"}</button>
            <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">复制受控资源引用和素材信息，直接粘贴到 Agent 对话即可。</p>
            <dl className="mt-4 space-y-4 text-xs">
              <div><dt className="text-muted-foreground">状态</dt><dd className="mt-1 flex items-center gap-1.5">{!ready && status !== "failed" && <LoaderCircle className="size-3 animate-spin text-primary" />}{statusLabel}</dd>{asset.error && <dd className="mt-1 text-[11px] text-destructive">{asset.error}</dd>}</div>
              {metadata.prompt !== undefined && <PromptSection prompt={String(metadata.prompt ?? "")} />}
              {references.length > 0 && <div><dt className="text-muted-foreground">参考素材</dt><dd className="mt-2 grid grid-cols-3 gap-2">{references.map((ref) => <ReferencePreview key={ref.id} apiBase={apiBase} reference={ref} />)}</dd></div>}
            </dl>
          </aside>
        </div>
      </section>
      {lightbox && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-8 backdrop-blur" onMouseDown={() => setLightbox(null)}>
          <button aria-label="关闭大图" className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => setLightbox(null)} type="button"><X className="size-4" /></button>
          <img alt="preview" className="max-h-[90vh] max-w-[90vw] object-contain" src={lightbox} onMouseDown={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function PromptSection({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isLong = prompt.length > 300;
  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  if (!isLong) {
    return (
      <div>
        <dt className="flex items-center justify-between text-muted-foreground"><span>提示词</span><button className="grid size-6 place-items-center rounded-xs hover:bg-muted" onClick={() => void copyPrompt()} type="button">{copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}</button></dt>
        <dd className="mt-1 whitespace-pre-wrap break-words text-xs leading-5">{prompt || "（无）"}</dd>
      </div>
    );
  }
  return (
    <div>
      <dt className="flex items-center justify-between text-muted-foreground"><span>提示词</span><button className="grid size-6 place-items-center rounded-xs hover:bg-muted" onClick={() => void copyPrompt()} type="button">{copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}</button></dt>
      <dd className={`relative mt-1 rounded-md border p-2.5 ${expanded ? "max-h-[45vh] overflow-y-auto" : "max-h-32 overflow-hidden"}`}>
        <p className="whitespace-pre-wrap break-words text-xs leading-5">{prompt}</p>
        {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />}
      </dd>
      <button className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setExpanded((v) => !v)} type="button">
        {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}{expanded ? "收起" : "展开全部"}
      </button>
    </div>
  );
}

function AssetContent({ apiBase, asset, status, onImageClick }: { apiBase: string; asset: PreviewAsset; status: string; onImageClick?: (src: string) => void }) {
  if (status !== "completed") return <PendingAssetContent asset={asset} status={status} />;
  const source = mediaContentURL(apiBase, asset.id);
  if (asset.kind === "image") return <button className="group relative" onClick={() => onImageClick?.(source)} type="button"><img alt={asset.name} className="max-h-[65vh] max-w-full cursor-zoom-in object-contain" src={source} /><span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/10 group-hover:opacity-100"><ZoomIn className="size-6 text-white drop-shadow" /></span></button>;
  if (asset.kind === "audio") return <AudioWaveformPlayer name={asset.name || "音频素材"} src={source} />;
  if (asset.kind === "transcript") return <TranscriptAssetContent apiBase={apiBase} asset={asset} />;
  if (asset.kind === "reference") return <ReferenceAssetContent apiBase={apiBase} asset={asset} onImageClick={onImageClick} />;
  return <VideoFrame alt={asset.name || "视频素材"} className="w-full max-w-4xl rounded-xs bg-black" controls src={source} videoClassName="max-h-[65vh] object-contain" />;
}

function ReferenceAssetContent({ apiBase, asset, onImageClick }: { apiBase: string; asset: PreviewAsset; onImageClick?: (src: string) => void }) {
  const reference = asset.metadata?.reference as ReferenceMetadata | undefined;
  const url = typeof reference?.url === "string" ? reference.url : "";
  const mediaMeta = reference?.media;
  const rows: { label: string; value: string }[] = [];
  if (reference?.siteName) rows.push({ label: "站点", value: reference.siteName });
  if (reference?.author || mediaMeta?.channelName) rows.push({ label: "作者", value: reference?.author || mediaMeta?.channelName || "" });
  if (reference?.publishedAt) rows.push({ label: "发布时间", value: reference.publishedAt });
  if (reference?.language || mediaMeta?.language) rows.push({ label: "语言", value: reference?.language || mediaMeta?.language || "" });
  if (typeof mediaMeta?.durationSeconds === "number") rows.push({ label: "时长", value: formatTimecode(mediaMeta.durationSeconds) });
  if (typeof mediaMeta?.viewCount === "number") rows.push({ label: "播放量", value: mediaMeta.viewCount.toLocaleString() });
  if (typeof mediaMeta?.likeCount === "number") rows.push({ label: "点赞", value: mediaMeta.likeCount.toLocaleString() });
  if (typeof reference?.contentWordCount === "number") rows.push({ label: "正文", value: `${reference.contentWordCount} 词` });
  const imageSrc = transcriptPartURL(apiBase, asset.id, "image");
  return <div className="grid w-full max-w-2xl gap-4 rounded-sm border bg-card p-6 text-left"><span className="grid size-10 place-items-center rounded-sm bg-primary/10 text-primary"><Link2 className="size-5" /></span><div><p className="text-sm font-medium">{asset.name}</p><p className="mt-1 text-xs text-muted-foreground">{reference?.sourceKind || "web"} · 可跨项目复用的研究资料</p></div>{reference?.parts?.image && <button className="group relative" onClick={() => onImageClick?.(imageSrc)} type="button"><img alt={`${asset.name} 图片资料`} className="max-h-72 w-full cursor-zoom-in rounded-xs border bg-muted/40 object-contain" src={imageSrc} /><span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/10 group-hover:opacity-100"><ZoomIn className="size-6 text-white drop-shadow" /></span></button>}{reference?.description && <p className="text-xs leading-5 text-muted-foreground">{reference.description}</p>}{reference?.summary && <p className="text-sm leading-6">{reference.summary}</p>}{reference?.excerpt && <blockquote className="border-l-2 border-primary/40 pl-3 text-xs leading-5 italic">{reference.excerpt}</blockquote>}{rows.length > 0 && <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs">{rows.map((row) => <div key={row.label}><dt className="text-muted-foreground">{row.label}</dt><dd className="mt-0.5 truncate" title={row.value}>{row.value}</dd></div>)}</dl>}{reference?.parts?.content && <ArticleContent apiBase={apiBase} assetID={asset.id} mimeType={reference.contentMimeType || "text/markdown"} />}{url ? <a className="truncate text-sm text-primary underline underline-offset-4" href={url} rel="noreferrer" target="_blank">打开原始资料</a> : <p className="text-sm text-destructive">资料链接缺失</p>}</div>;
}

function ArticleContent({ apiBase, assetID, mimeType }: { apiBase: string; assetID: string; mimeType: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(transcriptPartURL(apiBase, assetID, "content"), { cache: "no-store" });
        if (!response.ok) throw new Error("无法读取文章正文。");
        const text = await response.text();
        if (!cancelled) setContent(text);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "无法读取文章正文。");
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, assetID]);
  const markdown = mimeType === "text/markdown";
  return <div><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">文章正文</p><a className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted" download href={transcriptPartURL(apiBase, assetID, "content")} type="button"><Download className="size-3" />正文</a></div>{error ? <p className="mt-2 text-xs text-destructive">{error}</p> : content === null ? <p className="mt-2 text-xs text-muted-foreground">正在读取正文…</p> : markdown ? <div className="mt-2 max-h-80 overflow-auto rounded-xs border bg-muted/40 p-3"><p className="whitespace-pre-wrap text-xs leading-5">{content}</p></div> : <pre className="mt-2 max-h-80 overflow-auto rounded-xs border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{content}</pre>}</div>;
}

type TranscriptSegment = { start: number; end: number; text: string; speaker?: string; emotion?: string };

type TranscriptMetadata = {
  sourceAssetId?: string;
  model?: string;
  language?: string;
  duration?: number;
  segmentCount?: number;
  parts?: Record<string, { name?: string; contentHash?: string; mimeType?: string; sizeBytes?: number }>;
};

function transcriptMetadata(asset: PreviewAsset): TranscriptMetadata | null {
  const value = asset.metadata?.transcript;
  if (!value || typeof value !== "object") return null;
  return value as TranscriptMetadata;
}

function transcriptPartURL(apiBase: string, assetID: string, part: string) {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}/parts/${encodeURIComponent(part)}`;
}

function formatTimecode(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3600000).toString().padStart(2, "0");
  const minutes = Math.floor((milliseconds % 3600000) / 60000).toString().padStart(2, "0");
  const secs = Math.floor((milliseconds % 60000) / 1000).toString().padStart(2, "0");
  return `${hours}:${minutes}:${secs}`;
}

function TranscriptAssetContent({ apiBase, asset }: { apiBase: string; asset: PreviewAsset }) {
  const source = mediaContentURL(apiBase, asset.id);
  const meta = transcriptMetadata(asset);
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [srt, setSRT] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [showSRT, setShowSRT] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(transcriptPartURL(apiBase, asset.id, "json"), { cache: "no-store" });
        if (!response.ok) throw new Error("无法读取转写 JSON。");
        const payload = await response.json() as { segments?: TranscriptSegment[] };
        if (!cancelled) setSegments(payload.segments ?? []);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "无法读取转写内容。");
      }
      try {
        const response = await fetch(transcriptPartURL(apiBase, asset.id, "srt"), { cache: "no-store" });
        if (response.ok && !cancelled) setSRT(await response.text());
      } catch { /* SRT 缺失时只展示分段 */ }
    })();
    return () => { cancelled = true; };
  }, [apiBase, asset.id]);
  const items = segments ?? [];
  return <div className="grid w-full max-w-3xl gap-4">
    <AudioWaveformPlayer name={asset.name || "转写素材"} src={source} />
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge className="bg-violet-600/10 text-violet-600">转写</Badge>
      {meta?.model && <Badge>{meta.model}</Badge>}
      {meta?.language && <Badge>{meta.language === "auto" ? "自动检测" : meta.language}</Badge>}
      {typeof meta?.duration === "number" && <Badge>{meta.duration.toFixed(1)} 秒</Badge>}
      <Badge>{typeof meta?.segmentCount === "number" ? meta.segmentCount : items.length} 段</Badge>
    </div>
    <div className="flex items-center justify-between gap-3">
      <button className="flex h-7 items-center gap-1.5 rounded-xs border px-2 text-[11px] hover:bg-muted" onClick={() => setShowSRT((visible) => !visible)} type="button"><FileText className="size-3" />{showSRT ? "收起 SRT" : "预览 SRT"}</button>
      <div className="flex gap-1.5">
        <a className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted" download href={transcriptPartURL(apiBase, asset.id, "srt")} type="button"><Download className="size-3" />SRT</a>
        <a className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted" download href={transcriptPartURL(apiBase, asset.id, "json")} type="button"><Download className="size-3" />JSON</a>
      </div>
    </div>
    {showSRT && <pre className="max-h-52 overflow-auto rounded-xs border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{srt || "（没有可用的 SRT）"}</pre>}
    {loadError ? <p className="text-xs text-destructive">{loadError}</p> : <div className="max-h-72 overflow-auto rounded-xs border">
      {items.length ? items.map((segment, index) => <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3 border-b px-3 py-2 last:border-0" key={`${asset.id}-${index}`}><span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">{formatTimecode(segment.start)} → {formatTimecode(segment.end)}</span><p className="text-xs leading-5">{segment.text}</p></div>) : <p className="px-4 py-6 text-center text-xs text-muted-foreground">正在读取转写分段…</p>}
    </div>}
  </div>;
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
