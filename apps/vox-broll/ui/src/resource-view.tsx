/**
 * [INPUT]: 依赖 Resource 类型与 React 图文展示原语
 * [OUTPUT]: 对外提供按 B-roll 创作阶段渲染的人类可读资源摘要、缩略文本、真实视频缩略预览、图片与音视频播放器详情
 * [POS]: vox-broll 的资源展示语义层；将内部 content JSON 翻译为图、文、视频画面和清单，不承担数据读写
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useState } from "react";
import type { Resource } from "./main";

type RecordValue = Record<string, unknown>;
type MediaSnapshot = { assetId?: string; text?: string; imageAssetIds?: string[] };
type LookContent = { media?: MediaSnapshot; definition?: string };
type AssetState = { status?: "queued" | "running" | "completed" | "failed"; error?: string };

const labels: Record<string, string> = {
  topic: "主题", premise: "核心观点", direction: "创作方向", summary: "摘要", definition: "风格定义", prompt: "生成提示词",
  palette: "色彩", paperTechnique: "纸张技法", typeTreatment: "字体处理", texture: "纹理", mood: "情绪",
  hook: "开场钩子", narrative: "叙事", composition: "画面构图", headline: "画面标题", layers: "画面层次",
  scene: "场景", videoDirection: "视频方向", narration: "旁白", music: "音乐", captions: "字幕", mix: "混音",
  aspectRatio: "画幅", duration: "时长", format: "格式", export: "导出", checklist: "检查清单",
};

const mediaURL = (assetId: string) => `/v1/media/assets/${encodeURIComponent(assetId)}/content`;
const assetURL = (assetId: string) => `/v1/media/assets/${encodeURIComponent(assetId)}`;
const videoPreviewURL = (assetId: string) => `${mediaURL(assetId)}#t=0.001`;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean).join("、") : typeof value === "string" || typeof value === "number" ? String(value) : "";
const title = (key: string) => labels[key] || key.replace(/([A-Z])/g, " $1").trim();
const isLook = (resource: Resource) => resource.kind.toLowerCase() === "look";

export function useAssetState(assetId: string) {
  const [asset, setAsset] = useState<AssetState | null>(null);
  useEffect(() => {
    let active = true;
    let timer = 0;
    const schedule = () => { timer = window.setTimeout(() => void load(), 2500); };
    async function load() {
      try {
        const response = await fetch(assetURL(assetId), { cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 404 ? "素材不存在或已被删除" : "无法读取素材状态");
        const current = await response.json() as AssetState;
        const next = { ...current, status: current.status || "completed" };
        if (!active) return;
        setAsset(next);
        if (next.status !== "completed" && next.status !== "failed") schedule();
      } catch (cause) {
        if (active) setAsset({ status: "failed", error: cause instanceof Error ? cause.message : "无法读取素材状态" });
      }
    }
    setAsset(null);
    void load();
    return () => { active = false; window.clearTimeout(timer); };
  }, [assetId]);
  return asset;
}

function PendingMedia({ asset, compact = false }: { asset: AssetState | null; compact?: boolean }) {
  const failed = asset?.status === "failed";
  const loading = !asset;
  return <div className={`grid place-items-center border border-dashed bg-muted/40 px-3 text-center text-xs text-muted-foreground ${compact ? "size-full border-0" : "min-h-20 rounded"}`}><div><p className={failed ? "font-medium text-destructive" : "font-medium text-primary"}>{failed ? "生成失败" : loading ? "正在读取素材…" : "生成中…"}</p><p className="mt-1 text-[11px] leading-4">{asset?.error || "素材引用已建立，完成后会原位可播放。"}</p></div></div>;
}

function AssetImage({ alt, assetId, className }: { alt: string; assetId: string; className: string }) {
  const asset = useAssetState(assetId);
  if (!asset || asset.status !== "completed") return <PendingMedia asset={asset} />;
  return <img alt={alt} className={className} src={mediaURL(assetId)} />;
}

function AssetPlayer({ assetId, kind }: { assetId: string; kind: "video" | "audio" }) {
  const asset = useAssetState(assetId);
  if (!asset || asset.status !== "completed") return <PendingMedia asset={asset} />;
  return kind === "video" ? <video aria-label="场景视频" className="aspect-video w-full rounded-md border bg-muted" controls playsInline preload="metadata" src={mediaURL(assetId)} /> : <audio className="w-full" controls src={mediaURL(assetId)} />;
}

export function AssetVideoPreview({ assetId, title }: { assetId: string; title: string }) {
  const asset = useAssetState(assetId);
  const [contentError, setContentError] = useState(false);
  useEffect(() => setContentError(false), [assetId]);
  if (!asset || asset.status !== "completed") return <PendingMedia asset={asset} compact />;
  if (contentError) return <PendingMedia asset={{ status: "failed", error: "视频内容不可读取" }} compact />;
  return <video aria-label={`${title} 视频预览`} autoPlay className="size-full object-cover" loop muted onError={() => setContentError(true)} playsInline preload="auto" src={videoPreviewURL(assetId)} />;
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
  return [...new Set([snapshotAssetID(content.video), ...ids(content, "videoAssetId", "videoAssetIds")].filter(Boolean))];
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

export function resourceImageURLs(resource: Resource) {
  const content = record(resource.content);
  const lookAssetID = isLook(resource) ? text(record(content.media).assetId) : "";
  const keyframeImages = resource.kind.toLowerCase() === "keyframes" && Array.isArray(content.keyframes)
    ? content.keyframes.map((item) => snapshotAssetID(record(item).image))
    : [];
  const assetIDs = [...new Set([lookAssetID, ...imageIDs(content), ...keyframeImages].filter(Boolean))];
  return assetIDs.map(mediaURL);
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
  return <div className={compact ? "aspect-video overflow-hidden rounded-md bg-muted" : "grid gap-3 sm:grid-cols-2"}>{assetIDs.map((id) => <AssetImage alt="创作参考图" assetId={id} className={compact ? "size-full object-cover" : "aspect-video w-full rounded-md border object-cover"} key={id} />)}</div>;
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
    return <li className="grid gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm" key={`${heading}-${index}`}><p className="font-medium">{index + 1}. {heading}</p>{detail && detail !== heading && <p className="leading-5 text-muted-foreground">{detail}</p>}{image && <AssetImage alt={`${heading} 参考图`} assetId={image} className="aspect-video w-full rounded border object-cover" />}{video && <AssetPlayer assetId={video} kind="video" />}{audio && <AssetPlayer assetId={audio} kind="audio" />}</li>;
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
