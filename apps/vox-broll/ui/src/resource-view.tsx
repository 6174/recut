/**
 * [INPUT]: 依赖 Resource 类型、共享 Asset SSE 缓存与 React 图文展示原语
 * [OUTPUT]: 对外提供按 B-roll 创作阶段渲染的人类可读资源摘要、缩略文本、带生成耗时的真实视频预览、图片与音视频播放器详情；兼容顶层和历史嵌套视频引用
 * [POS]: vox-broll 的资源展示语义层；将内部 content JSON 翻译为图、文、视频画面和清单，所有异步 Asset 由共享缓存驱动并在真实生成态显示计时，终态只读取后端 generation metadata，优先单段 Scene 的顶层视频并兼容旧多项 Scene
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useState } from "react";
import type { Resource } from "./main";
import { type AssetState, useMediaAssetEvents } from "./use-media-asset-events";

type RecordValue = Record<string, unknown>;
type MediaSnapshot = { assetId?: string; text?: string; imageAssetIds?: string[] };
type LookContent = { media?: MediaSnapshot; definition?: string };

const labels: Record<string, string> = {
  topic: "主题", premise: "核心观点", direction: "创作方向", summary: "摘要", definition: "风格定义", prompt: "生成提示词",
  palette: "色彩", paperTechnique: "纸张技法", typeTreatment: "字体处理", texture: "纹理", mood: "情绪",
  hook: "开场钩子", narrative: "叙事", composition: "画面构图", headline: "画面标题", layers: "画面层次",
  scene: "场景", videoDirection: "视频方向", narration: "旁白", music: "音乐", captions: "字幕", mix: "混音",
  aspectRatio: "画幅", duration: "时长", format: "格式", export: "导出", checklist: "检查清单",
};

const mediaURL = (assetId: string) => `/v1/media/assets/${encodeURIComponent(assetId)}/content`;
const videoPreviewURL = (assetId: string) => `${mediaURL(assetId)}#t=0.001`;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean).join("、") : typeof value === "string" || typeof value === "number" ? String(value) : "";
const title = (key: string) => labels[key] || key.replace(/([A-Z])/g, " $1").trim();
const isLook = (resource: Resource) => resource.kind.toLowerCase() === "look";
const isGenerating = (asset: AssetState | null) => asset?.status === "queued" || asset?.status === "running";

function timestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function generationStartedAt(asset: AssetState | null) {
  return timestamp(asset?.metadata?.generationStartedAt) ?? timestamp(asset?.createdAt);
}

function finalGenerationDuration(asset: AssetState | null) {
  const value = asset?.metadata?.generationDurationMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatGenerationDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function useGenerationElapsedMs(asset: AssetState | null) {
  const startedAt = generationStartedAt(asset);
  const generating = isGenerating(asset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!generating || startedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [generating, startedAt]);
  if (generating) return startedAt === null ? null : Math.max(0, now - startedAt);
  const finalDuration = finalGenerationDuration(asset);
  return finalDuration;
}

function GenerationDuration({ asset, overlay = false }: { asset: AssetState | null; overlay?: boolean }) {
  const elapsed = useGenerationElapsedMs(asset);
  if (elapsed === null) return null;
  const label = isGenerating(asset) ? `${asset?.status === "queued" ? "等待生成" : "生成中"} · ${formatGenerationDuration(elapsed)}` : `生成耗时 · ${formatGenerationDuration(elapsed)}`;
  return <p className={overlay ? "absolute bottom-1.5 right-1.5 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] text-foreground shadow-sm backdrop-blur" : "mt-1 font-mono text-[11px] text-muted-foreground"}>{label}</p>;
}

export function useAssetState(assetId: string) {
  const { assetByID, ready } = useMediaAssetEvents();
  return assetByID[assetId] ?? (ready ? { id: assetId, kind: "image" as const, status: "failed" as const, error: "素材不存在或已被删除" } : null);
}

function PendingMedia({ asset, compact = false }: { asset: AssetState | null; compact?: boolean }) {
  const failed = asset?.status === "failed";
  const loading = !asset;
  const pendingLabel = asset?.status === "queued" ? "等待生成…" : "生成中…";
  return <div className={`grid place-items-center border border-dashed bg-muted/40 px-3 text-center text-xs text-muted-foreground ${compact ? "size-full border-0" : "min-h-20 rounded"}`}><div><p className={failed ? "font-medium text-destructive" : "font-medium text-primary"}>{failed ? "生成失败" : loading ? "正在读取素材…" : pendingLabel}</p><GenerationDuration asset={asset} /><p className="mt-1 text-[11px] leading-4">{asset?.error || "素材引用已建立，完成后会原位可播放。"}</p></div></div>;
}

export function AssetImagePreview({ alt, assetId, className, compact = false }: { alt: string; assetId: string; className: string; compact?: boolean }) {
  const asset = useAssetState(assetId);
  if (!asset || asset.status !== "completed") return <PendingMedia asset={asset} compact={compact} />;
  return <div className={`relative overflow-hidden ${className}`}><img alt={alt} className="size-full object-cover" src={mediaURL(assetId)} /><GenerationDuration asset={asset} overlay /></div>;
}

function AssetPlayer({ assetId, kind }: { assetId: string; kind: "video" | "audio" }) {
  const asset = useAssetState(assetId);
  if (!asset || asset.status !== "completed") return <PendingMedia asset={asset} />;
  const player = kind === "video" ? <video aria-label="场景视频" className="aspect-video w-full rounded-md border bg-muted" controls playsInline preload="metadata" src={mediaURL(assetId)} /> : <audio className="w-full" controls src={mediaURL(assetId)} />;
  return <div className="grid gap-1">{player}<GenerationDuration asset={asset} /></div>;
}

export function AssetVideoPreview({ assetId, title }: { assetId: string; title: string }) {
  const asset = useAssetState(assetId);
  const [contentError, setContentError] = useState(false);
  useEffect(() => setContentError(false), [assetId]);
  if (!asset || asset.status !== "completed") return <PendingMedia asset={asset} compact />;
  if (contentError) return <PendingMedia asset={{ ...asset, status: "failed", error: "视频内容不可读取" }} compact />;
  return <div className="relative size-full"><video aria-label={`${title} 视频预览`} autoPlay className="size-full object-cover" loop muted onError={() => setContentError(true)} playsInline preload="auto" src={videoPreviewURL(assetId)} /><GenerationDuration asset={asset} overlay /></div>;
}

export function isLegacyLook(resource: Resource) {
  const content = record(resource.content);
  const media = record(content.media);
  return isLook(resource) && (!text(media.assetId) || !text(media.text));
}

function ids(content: RecordValue, singular: string, plural: string) {
  const values = [content[singular], ...(Array.isArray(content[plural]) ? content[plural] : [])];
  return [...new Set(values.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function imageIDs(content: RecordValue) {
  const assetIDs = [content.assetId, content.imageAssetId, content.referenceAssetId, ...ids(content, "imageAssetId", "imageAssetIds"), ...ids(content, "referenceAssetId", "referenceAssetIds")];
  return [...new Set(assetIDs.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function snapshotAssetID(value: unknown) {
  return text(record(value).assetId);
}

function videoAssetIDs(content: RecordValue) {
  const items = [...(Array.isArray(content.scenes) ? content.scenes : []), ...(Array.isArray(content.shots) ? content.shots : [])];
  const nested = items.flatMap((item) => {
    const value = record(item);
    return [snapshotAssetID(value.video), ...ids(value, "videoAssetId", "videoAssetIds")];
  });
  return [...new Set([snapshotAssetID(content.video), ...ids(content, "videoAssetId", "videoAssetIds"), ...nested].filter(Boolean))];
}

export function resourceVideoAssetIDs(resource: Resource) {
  const content = record(resource.content);
  const nested = [content.scenes, content.shots]
    .filter(Array.isArray)
    .flatMap((items) => items.flatMap((item) => videoAssetIDs(record(item))));
  return [...new Set([...videoAssetIDs(content), ...nested])];
}

function audioSnapshotID(value: unknown) {
  return snapshotAssetID(record(value).audio) || text(record(value).audioAssetId);
}

function itemHeading(value: RecordValue, item: unknown) {
  return text(value.title || value.name || value.shot || value.beat || value.id || item);
}

function itemDetails(value: RecordValue) {
  return ["description", "action", "narration", "visual", "purpose", "composition", "motion", "music", "soundEffects", "captions", "durationSec"]
    .map((key) => text(value[key]))
    .filter(Boolean);
}

export function resourceImageAssetIDs(resource: Resource) {
  const content = record(resource.content);
  const lookAssetID = isLook(resource) ? text(record(content.media).assetId) : "";
  const keyframeImages = resource.kind.toLowerCase() === "keyframes" && Array.isArray(content.keyframes)
    ? content.keyframes.map((item) => snapshotAssetID(record(item).image))
    : [];
  return [...new Set([lookAssetID, ...imageIDs(content), ...keyframeImages].filter(Boolean))];
}

export function resourceImageURLs(resource: Resource) {
  return resourceImageAssetIDs(resource).map(mediaURL);
}

export function resourcePreviewLines(resource: Resource) {
  const content = record(resource.content);
  const kind = resource.kind.toLowerCase();
  const fields = kind === "brief" ? ["topic", "premise", "direction"] : kind === "beats" ? ["hook", "narrative", "summary"] : kind === "keyframes" ? ["composition", "headline", "layers"] : kind === "audio" ? ["narration", "music", "captions"] : kind === "scenes" ? ["scene", "videoDirection"] : kind === "delivery" ? ["aspectRatio", "duration", "format", "export"] : ["summary", "definition", "direction"];
  const list = kind === "beats" ? content.beats || content.items : kind === "keyframes" ? content.keyframes || content.shots : kind === "audio" ? content.scenes : kind === "scenes" ? content.scenes || content.shots : undefined;
  const entries = Array.isArray(list) ? list.map((item) => {
    const value = record(item);
    return [itemHeading(value, item), ...itemDetails(value)];
  }).flat() : [];
  const lines = [...fields.map((key) => text(content[key])), ...entries].filter(Boolean);
  return [...new Set(lines)].slice(0, 3);
}

function AssetImages({ content, compact = false }: { content: RecordValue; compact?: boolean }) {
  const assetIDs = imageIDs(content);
  if (!assetIDs.length) return null;
  return <div className={compact ? "aspect-video overflow-hidden rounded-md bg-muted" : "grid gap-3 sm:grid-cols-2"}>{assetIDs.map((id) => <AssetImagePreview alt="创作参考图" assetId={id} className={compact ? "size-full" : "aspect-video w-full rounded-md border"} compact={compact} key={id} />)}</div>;
}

function MediaPlayers({ content, compact }: { content: RecordValue; compact: boolean }) {
  if (compact) return null;
  const videos = videoAssetIDs(content);
  const audio = ids(content, "audioAssetId", "audioAssetIds");
  if (!videos.length && !audio.length) return null;
  return <div className="grid gap-3">{videos.map((id) => <AssetPlayer assetId={id} key={id} kind="video" />)}{audio.map((id) => <AssetPlayer assetId={id} key={id} kind="audio" />)}</div>;
}

function Field({ name, value }: { name: string; value: unknown }) {
  const content = text(value);
  return content ? <div className="grid gap-1"><dt className="text-xs font-medium text-muted-foreground">{title(name)}</dt><dd className="text-sm leading-6 text-foreground">{content}</dd></div> : null;
}

function ItemList({ items, titleKey }: { items: unknown; titleKey: string }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <div className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">{title(titleKey)}</p><ol className="grid gap-2">{items.map((item, index) => {
    const value = record(item);
    const heading = itemHeading(value, item) || `第 ${index + 1} 项`;
    const detail = itemDetails(value).filter((detail) => detail !== heading).join(" · ");
    const image = snapshotAssetID(value.image) || text(value.imageAssetId);
    const video = snapshotAssetID(value.video) || text(value.videoAssetId);
    const audio = audioSnapshotID(value);
    return <li className="grid gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm" key={`${heading}-${index}`}><p className="font-medium">{index + 1}. {heading}</p>{detail && detail !== heading && <p className="leading-5 text-muted-foreground">{detail}</p>}{image && <AssetImagePreview alt={`${heading} 参考图`} assetId={image} className="aspect-video w-full rounded border" />}{video && <AssetPlayer assetId={video} kind="video" />}{audio && <AssetPlayer assetId={audio} kind="audio" />}</li>;
  })}</ol></div>;
}

function LookView({ content, compact }: { content: RecordValue; compact: boolean }) {
  const look = content as LookContent;
  const media = look.media || {};
  const incomplete = !media.assetId || !media.text;
  if (incomplete) return <div className="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">{compact ? "缺少参考图与原始提示词，需重新生成。" : "旧格式资源：未保存风格参考图和原始提示词。请移出当前方案后重新生成，不能把它当作有效视觉风格。"}</div>;
  return <div className="grid gap-3"><AssetImages compact={compact} content={{ ...content, assetId: media.assetId }} />{!compact && <Field name="prompt" value={media.text} />}{!compact && <Field name="definition" value={look.definition} />}{compact && <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{media.text || look.definition || "缺少风格提示词"}</p>}{!compact && <div className="grid gap-3 sm:grid-cols-2"><Field name="palette" value={content.palette} /><Field name="paperTechnique" value={content.paperTechnique} /><Field name="typeTreatment" value={content.typeTreatment} /><Field name="texture" value={content.texture} /><Field name="mood" value={content.mood} /></div>}</div>;
}

function StageView({ resource, compact }: { resource: Resource; compact: boolean }) {
  const content = record(resource.content);
  if (isLook(resource)) return <LookView compact={compact} content={content} />;
  const kind = resource.kind.toLowerCase();
  const list = kind === "beats" ? content.beats || content.items : kind === "keyframes" ? content.keyframes || content.shots : kind === "audio" ? content.scenes : kind === "scenes" ? content.scenes || content.shots : kind === "delivery" ? content.checklist : undefined;
  const fields = kind === "brief" ? ["topic", "premise", "direction"] : kind === "beats" ? ["hook", "narrative", "summary"] : kind === "keyframes" ? ["composition", "headline", "layers"] : kind === "audio" ? ["narration", "music", "captions", "mix"] : kind === "scenes" ? ["beatId", "durationSec", "visualAction", "cutPoint"] : kind === "delivery" ? ["aspectRatio", "duration", "format", "export"] : ["summary", "definition", "direction"];
  const first = fields.map((key) => text(content[key])).find(Boolean) || text(resource.content) || "尚未填写可展示内容";
  if (compact) return <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{first}</p>;
  return <div className="grid gap-4"><AssetImages content={content} /><MediaPlayers compact={compact} content={content} /><dl className="grid gap-3 sm:grid-cols-2">{fields.map((key) => <Field key={key} name={key} value={content[key]} />)}</dl><ItemList items={list} titleKey={kind === "keyframes" ? "关键画面" : kind === "audio" ? "声音时间线" : kind === "scenes" ? "场景视频" : kind === "delivery" ? "检查清单" : "叙事节拍"} /></div>;
}

export function resourceSummary(resource: Resource) {
  const content = record(resource.content);
  if (isLook(resource)) return text(content.definition || record(content.media).text) || "视觉风格参考图";
  return resourcePreviewLines(resource)[0] || "点击查看完整内容";
}

export function ResourcePresentation({ compact = false, resource }: { compact?: boolean; resource: Resource }) {
  return <StageView compact={compact} resource={resource} />;
}

export function resourceKindLabel(kind: string) {
  return ({ Brief: "创作方向", Beats: "内容结构", Look: "视觉参考", Keyframes: "分镜画面", Audio: "配音与音乐", Scenes: "场景视频", Delivery: "导出设置" } as Record<string, string>)[kind] || kind;
}
