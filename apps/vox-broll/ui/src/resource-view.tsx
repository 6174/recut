/**
 * [INPUT]: 依赖 Resource 类型与 React 图文展示原语
 * [OUTPUT]: 对外提供按 B-roll 创作阶段渲染的人类可读资源摘要与详情
 * [POS]: vox-broll 的资源展示语义层；将内部 content JSON 翻译为图、文、清单和镜头卡，不承担数据读写
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Resource } from "./main";

type RecordValue = Record<string, unknown>;
type LookContent = { assetId?: string; prompt?: string; definition?: string };

const labels: Record<string, string> = {
  topic: "主题", premise: "核心观点", direction: "创作方向", summary: "摘要", definition: "风格定义", prompt: "生成提示词",
  palette: "色彩", paperTechnique: "纸张技法", typeTreatment: "字体处理", texture: "纹理", mood: "情绪",
  hook: "开场钩子", narrative: "叙事", composition: "画面构图", headline: "画面标题", layers: "画面层次",
  motion: "动效", camera: "镜头", narration: "旁白", music: "音乐", captions: "字幕", mix: "混音",
  aspectRatio: "画幅", duration: "时长", format: "格式", export: "导出", checklist: "检查清单",
};

const mediaURL = (assetId: string) => `/v1/media/assets/${encodeURIComponent(assetId)}/content`;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean).join("、") : typeof value === "string" || typeof value === "number" ? String(value) : "";
const title = (key: string) => labels[key] || key.replace(/([A-Z])/g, " $1").trim();
const isLook = (resource: Resource) => resource.kind.toLowerCase() === "look";

export function isLegacyLook(resource: Resource) {
  const content = record(resource.content);
  return isLook(resource) && (!text(content.assetId) || !text(content.prompt));
}

function ids(content: RecordValue, singular: string, plural: string) {
  const values = [content[singular], ...(Array.isArray(content[plural]) ? content[plural] : [])];
  return [...new Set(values.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function imageIDs(content: RecordValue) {
  const assetIDs = [content.assetId, content.imageAssetId, content.referenceAssetId, ...ids(content, "imageAssetId", "imageAssetIds"), ...ids(content, "referenceAssetId", "referenceAssetIds")];
  return [...new Set(assetIDs.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function AssetImages({ content, compact = false }: { content: RecordValue; compact?: boolean }) {
  const assetIDs = imageIDs(content);
  if (!assetIDs.length) return null;
  return <div className={compact ? "aspect-video overflow-hidden rounded-md bg-muted" : "grid gap-3 sm:grid-cols-2"}>{assetIDs.map((id) => <img alt="创作参考图" className={compact ? "size-full object-cover" : "aspect-video w-full rounded-md border object-cover"} key={id} src={mediaURL(id)} />)}</div>;
}

function MediaPlayers({ content, compact }: { content: RecordValue; compact: boolean }) {
  if (compact) return null;
  const videos = ids(content, "videoAssetId", "videoAssetIds");
  const audio = ids(content, "audioAssetId", "audioAssetIds");
  if (!videos.length && !audio.length) return null;
  return <div className="grid gap-3">{videos.map((id) => <video className="aspect-video w-full rounded-md border bg-muted" controls key={id} src={mediaURL(id)} />)}{audio.map((id) => <audio className="w-full" controls key={id} src={mediaURL(id)} />)}</div>;
}

function Field({ name, value }: { name: string; value: unknown }) {
  const content = text(value);
  return content ? <div className="grid gap-1"><dt className="text-xs font-medium text-muted-foreground">{title(name)}</dt><dd className="text-sm leading-6 text-foreground">{content}</dd></div> : null;
}

function ItemList({ items, titleKey }: { items: unknown; titleKey: string }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <div className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">{title(titleKey)}</p><ol className="grid gap-2">{items.map((item, index) => {
    const value = record(item);
    const heading = text(value.title || value.name || value.shot || value.beat || item) || `第 ${index + 1} 项`;
    const detail = text(value.description || value.action || value.purpose || value.composition || value.motion || value);
    const image = text(value.imageAssetId);
    const video = text(value.videoAssetId);
    const audio = text(value.audioAssetId);
    return <li className="grid gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm" key={`${heading}-${index}`}><p className="font-medium">{index + 1}. {heading}</p>{detail && detail !== heading && <p className="leading-5 text-muted-foreground">{detail}</p>}{image && <img alt={`${heading} 参考图`} className="aspect-video w-full rounded border object-cover" src={mediaURL(image)} />}{video && <video className="aspect-video w-full rounded border bg-muted" controls src={mediaURL(video)} />}{audio && <audio className="w-full" controls src={mediaURL(audio)} />}</li>;
  })}</ol></div>;
}

function LookView({ content, compact }: { content: RecordValue; compact: boolean }) {
  const look = content as LookContent;
  const incomplete = !look.assetId || !look.prompt;
  if (incomplete) return <div className="rounded-md border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">{compact ? "缺少参考图与原始提示词，需重新生成。" : "旧格式资源：未保存风格参考图和原始提示词。请移出当前方案后重新生成，不能把它当作有效视觉风格。"}</div>;
  return <div className="grid gap-3"><AssetImages compact={compact} content={content} />{!compact && <Field name="prompt" value={look.prompt} />}{!compact && <Field name="definition" value={look.definition} />}{compact && <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{look.prompt || look.definition || "缺少风格提示词"}</p>}{!compact && <div className="grid gap-3 sm:grid-cols-2"><Field name="palette" value={content.palette} /><Field name="paperTechnique" value={content.paperTechnique} /><Field name="typeTreatment" value={content.typeTreatment} /><Field name="texture" value={content.texture} /><Field name="mood" value={content.mood} /></div>}</div>;
}

function StageView({ resource, compact }: { resource: Resource; compact: boolean }) {
  const content = record(resource.content);
  if (isLook(resource)) return <LookView compact={compact} content={content} />;
  const kind = resource.kind.toLowerCase();
  const list = kind === "beats" ? content.beats || content.items : kind === "keyframes" ? content.keyframes || content.shots : kind === "motion" ? content.shots || content.moves : kind === "delivery" ? content.checklist : undefined;
  const fields = kind === "brief" ? ["topic", "premise", "direction"] : kind === "beats" ? ["hook", "narrative", "summary"] : kind === "keyframes" ? ["composition", "headline", "layers"] : kind === "motion" ? ["motion", "camera"] : kind === "audio" ? ["narration", "music", "captions", "mix"] : kind === "delivery" ? ["aspectRatio", "duration", "format", "export"] : ["summary", "definition", "direction"];
  const first = fields.map((key) => text(content[key])).find(Boolean) || text(resource.content) || "尚未填写可展示内容";
  if (compact) return <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{first}</p>;
  return <div className="grid gap-4"><AssetImages content={content} /><MediaPlayers compact={compact} content={content} /><dl className="grid gap-3 sm:grid-cols-2">{fields.map((key) => <Field key={key} name={key} value={content[key]} />)}</dl><ItemList items={list} titleKey={kind === "keyframes" ? "关键画面" : kind === "motion" ? "动效镜头" : kind === "delivery" ? "检查清单" : "叙事节拍"} /></div>;
}

export function resourceSummary(resource: Resource) {
  const content = record(resource.content);
  if (isLook(resource)) return text(content.definition || content.prompt) || "视觉风格参考图";
  const fields = resource.kind.toLowerCase() === "brief" ? ["topic", "premise", "direction"] : resource.kind.toLowerCase() === "beats" ? ["hook", "narrative", "summary"] : resource.kind.toLowerCase() === "keyframes" ? ["composition", "headline"] : resource.kind.toLowerCase() === "motion" ? ["motion", "camera"] : resource.kind.toLowerCase() === "audio" ? ["narration", "music"] : ["summary", "definition", "direction"];
  return fields.map((key) => text(content[key])).find(Boolean) || "点击查看完整内容";
}

export function ResourcePresentation({ compact = false, resource }: { compact?: boolean; resource: Resource }) {
  return <StageView compact={compact} resource={resource} />;
}

export function resourceKindLabel(kind: string) {
  return ({ Brief: "创作方向", Beats: "内容结构", Look: "视觉参考", Keyframes: "分镜画面", Motion: "动画与转场", Audio: "配音与音乐", Delivery: "导出设置" } as Record<string, string>)[kind] || kind;
}
