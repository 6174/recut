"use client";

import { Check, ChevronDown, ChevronUp, Copy, Download, FileText, Link2, LoaderCircle, Maximize2, Minimize2, Music2, Pencil, Plus, RotateCcw, Trash2, Video, X, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioWaveformPlayer } from "@/components/audio-waveform-player";
import { GenerationDuration } from "@/components/generation-duration";
import { mediaContextPayload } from "@/components/agent-panel-types";
import { PanelSection } from "@/components/panel-section";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import { useMediaAssetEvents } from "@/components/use-media-asset-events";
import { VideoFrame } from "@/components/video-frame";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import type { ContextOption } from "@/lib/context-catalog/types";
import { useMediaConfigurationStore } from "@/lib/media-configuration-store";
import { createProposal, updateProposalAsset, confirmProposalAsset, type GenerationProposal, type ProposalPatch, type ProposalReference } from "@/lib/media/proposal";
import { ProposalEditor, type ProposalModality } from "@/components/proposal-editor";
import { referenceDisplayText } from "@/lib/rich-composer/protocol/parse";
import type { RichComposerValue } from "@/lib/rich-composer/value";

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

export type PreviewAttribute = {
  key: string;
  label?: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "media" | "ref" | "url";
  value?: unknown;
  options?: string[];
  locked?: boolean;
  source?: "system" | "agent" | "user";
  provenance?: { by?: string; op?: string; jobId?: string; modelId?: string; at?: string };
};

export type PreviewAsset = {
  id: string;
  kind: "image" | "video" | "audio" | "transcript" | "document";
  name: string;
  origin: string;
  status: "proposed" | "queued" | "running" | "completed" | "failed";
  jobId?: string;
  remoteId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata: { prompt?: string; capability?: unknown; modelId?: unknown; output?: Record<string, unknown>; referenceIds?: unknown; generation?: unknown; generationStartedAt?: unknown; generationDurationMs?: unknown; content?: unknown; contentMeta?: unknown; attributes?: unknown; transcript?: { sourceAssetId?: string; model?: string; language?: string; duration?: number; segmentCount?: number }; document?: ReferenceMetadata };
};

export function mediaContext(asset: PreviewAsset) {
  const metadata = asset.metadata ?? {};
  const prompt = typeof metadata.prompt === "string" && metadata.prompt.trim();
  const transcript = transcriptMetadata(asset);
  const reference = metadata.document as ReferenceMetadata | undefined;
  return [
    `<media type="${asset.kind}" assetid="${asset.id}"/>`,
    `素材名称：${asset.name}`,
    `素材类型：${asset.kind === "transcript" ? "转写（源声音 + SRT + JSON）" : asset.kind === "document" ? "研究资料链接" : asset.kind}`,
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

// 是否已带生成配方：提案（可确认生成）与计划（只有 content/attributes）的区别所在。
function hasProposalRecipe(asset: PreviewAsset): boolean {
  const proposal = (asset.metadata as Record<string, unknown> | undefined)?.generation;
  const capability = (asset.metadata as Record<string, unknown> | undefined)?.capability;
  return Boolean((proposal && typeof proposal === "object") || (typeof capability === "string" && capability.length > 0));
}

// Remix 会复用什么生成能力：优先资产自身的 capability，否则按 kind 推断。
function remixCapabilityOf(asset: PreviewAsset): "image.generate" | "video.generate" | "speech.generate" {
  const capability = (asset.metadata as Record<string, unknown> | undefined)?.capability;
  if (capability === "image.generate" || capability === "video.generate" || capability === "speech.generate") return capability;
  if (asset.kind === "video") return "video.generate";
  if (asset.kind === "audio") return "speech.generate";
  return "image.generate";
}

// 提案的参考绑定：优先 metadata.generation.references（带 role/label），回退到扁平 referenceIds。
function proposalReferenceDrafts(asset: PreviewAsset): ProposalReference[] {
  const proposal = (asset.metadata as Record<string, unknown> | undefined)?.generation;
  const raw = proposal && typeof proposal === "object" ? (proposal as Record<string, unknown>).references : undefined;
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        ...(typeof item.kind === "string" ? { kind: item.kind } : {}),
        ...(typeof item.role === "string" ? { role: item.role } : {}),
        ...(typeof item.label === "string" ? { label: item.label } : {}),
      }))
      .filter((item) => item.id);
  }
  const ids = (asset.metadata as Record<string, unknown> | undefined)?.referenceIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string").map((id) => ({ id }))
    : [];
}

// 资产生命周期 → 提案状态机（与 canvas proposalFromAsset 同源，避免两套语义）。
function proposalStatusOf(status: string): GenerationProposal["status"] {
  if (status === "queued" || status === "running") return "generating";
  if (status === "failed") return "failed";
  if (status === "completed") return "done";
  return "pending";
}

function proposalModalityOf(asset: PreviewAsset): ProposalModality {
  if (asset.kind === "video") return "video";
  if (asset.kind === "audio") return "audio";
  return "image";
}

// 从全局资产构造共享 ProposalEditor 需要的规格（与画布读同一份契约）。
function proposalFromPreviewAsset(asset: PreviewAsset): GenerationProposal {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const raw = metadata.generation && typeof metadata.generation === "object" ? (metadata.generation as Record<string, unknown>) : {};
  return {
    status: proposalStatusOf(String(asset.status || "proposed")),
    prompt: typeof metadata.prompt === "string" ? metadata.prompt : "",
    references: proposalReferenceDrafts(asset),
    ...(typeof metadata.modelId === "string" ? { modelId: metadata.modelId } : {}),
    ...(typeof metadata.credentialId === "string" ? { credentialId: metadata.credentialId } : {}),
    ...(metadata.output && typeof metadata.output === "object" ? { params: metadata.output as Record<string, unknown> } : {}),
    ...(typeof raw.aspectRatio === "string" ? { aspectRatio: raw.aspectRatio } : {}),
    ...(typeof raw.durationSec === "number" ? { durationSec: raw.durationSec } : {}),
    ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    ...(raw.proposedBy === "agent" || raw.proposedBy === "user" ? { proposedBy: raw.proposedBy } : {}),
    ...(typeof raw.proposedAt === "string" ? { proposedAt: raw.proposedAt } : {}),
    ...(typeof raw.batchId === "string" ? { batchId: raw.batchId } : {}),
  };
}

// GenerationProposal 补丁 → 资产提案 PATCH（params 映射回 output）。
function toProposalPatch(patch: Partial<GenerationProposal>): ProposalPatch {
  return {
    ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
    ...(patch.references !== undefined ? { references: patch.references, referenceIds: patch.references.map((ref) => ref.id) } : {}),
    ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
    ...(patch.credentialId !== undefined ? { credentialId: patch.credentialId } : {}),
    ...(patch.params !== undefined ? { output: patch.params } : {}),
    ...(patch.aspectRatio !== undefined ? { aspectRatio: patch.aspectRatio } : {}),
    ...(patch.durationSec !== undefined ? { durationSec: patch.durationSec } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  };
}

export function AssetPreviewDialog({ apiBase, asset: initialAsset, assets = [], onClose, onRegenerate }: { apiBase: string; asset: PreviewAsset; assets?: PreviewAsset[]; onClose: () => void; onRegenerate?: (asset: PreviewAsset) => void }) {
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [asideWidth, setAsideWidth] = useState(360);
  const [activeAsset, setActiveAsset] = useState<PreviewAsset>(initialAsset);
  const [remixing, setRemixing] = useState(false);
  const [remixError, setRemixError] = useState("");
  const { assetByID, assets: liveAssets, upsertAsset } = useMediaAssetEvents();
  const configuration = useMediaConfigurationStore();
  useEffect(() => { setActiveAsset(initialAsset); }, [initialAsset.id]);
  useEffect(() => { void configuration.load(apiBase); }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveAsset = assetByID[activeAsset.id] as unknown as PreviewAsset | undefined;
  const asset = liveAsset ?? activeAsset;
  const status = asset.status || "completed";
  const origin = asset.origin || "imported";
  const metadata = asset.metadata || {};
  const ready = status === "completed";
  // proposed 下再分两种语义：带配方=待确认提案（可确认生成，且提示词/参考可编辑）；无配方=计划态（复制计划给 AI）。
  const plan = status === "proposed" && !hasProposalRecipe(asset);
  const editableProposal = status === "proposed" && hasProposalRecipe(asset);
  const referenceIDs = Array.isArray(metadata.referenceIds) ? metadata.referenceIds.filter((id): id is string => typeof id === "string") : [];
  const knownAssets = new Map(assets.map((item) => [item.id, item]));
  liveAssets.forEach((item) => knownAssets.set(item.id, item as unknown as PreviewAsset));
  const references = referenceIDs.map((id) => knownAssets.get(id)).filter((item): item is PreviewAsset => Boolean(item));
  const statusText = status === "failed" ? "生成失败" : plan ? "计划中" : status === "proposed" ? "待确认生成" : ready ? "已完成" : "生成中";
  const statusLabel = <><span>{statusText}</span><GenerationDuration className="font-mono text-[10px] text-muted-foreground" item={asset} /></>;
  // Remix：把已完成素材的可复用配方复制成一个新的提案资产，并让弹框切到它的编辑态。
  const canRemix = ready && typeof metadata.prompt === "string" && metadata.prompt.trim().length > 0;
  async function remix() {
    if (!canRemix || remixing) return;
    setRemixing(true);
    setRemixError("");
    try {
      const capability = remixCapabilityOf(asset);
      const proposal = (metadata.generation ?? {}) as Record<string, unknown>;
      // modelId 与 credentialId 必须成对提交（云 provider）；按 provider 找已配置凭据，
      // 找不到就整对省略，交给 capability 的默认路由解析，绝不只发 modelId。
      const sourceModelId = typeof metadata.modelId === "string" ? metadata.modelId : "";
      const sourceModel = configuration.providers.flatMap((provider) => provider.models).find((model) => model.id === sourceModelId && model.available);
      const sourceCredential = sourceModel ? configuration.credentials.find((item) => item.provider === sourceModel.provider) : undefined;
      const routePair = sourceModel && (sourceModel.provider === "local-audio" || sourceCredential)
        ? { modelId: sourceModel.id, ...(sourceCredential ? { credentialId: sourceCredential.id } : {}) }
        : {};
      const created = await createProposal(apiBase, {
        capability,
        prompt: String(metadata.prompt),
        ...routePair,
        ...(metadata.output && typeof metadata.output === "object" ? { output: metadata.output as Record<string, unknown> } : {}),
        ...(referenceIDs.length ? { referenceIds: referenceIDs } : {}),
        ...(typeof proposal.aspectRatio === "string" && proposal.aspectRatio ? { aspectRatio: proposal.aspectRatio } : {}),
        ...(typeof proposal.durationSec === "number" ? { durationSec: proposal.durationSec } : {}),
        ...(typeof proposal.note === "string" && proposal.note ? { note: proposal.note } : {}),
      });
      upsertAsset(created);
      setActiveAsset(created as unknown as PreviewAsset);
    } catch (error) {
      setRemixError(error instanceof Error ? error.message : "创建 Remix 失败，请重试。");
    } finally {
      setRemixing(false);
    }
  }
  async function copyContext() {
    await navigator.clipboard.writeText(mediaContext(asset));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  const onImageClick = (src: string) => setLightbox(src);
  // 预览与属性面板之间的拖拽分隔条：往左拖加宽属性面板，夹在 280px 与窗口 72% 之间。
  function startResize(event: React.MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = asideWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const max = Math.max(420, window.innerWidth * 0.72);
      setAsideWidth(Math.min(Math.max(startWidth - (moveEvent.clientX - startX), 280), max));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  // 必须 portal 到 body：素材详情会从 Chat 侧栏（z-0 层叠上下文）与画布浮层内打开，
  // 内联渲染会被困在所在层叠上下文里，被 world canvas（z-30）压住。
  // z-[90] 高于所有应用内模态（z-[60]/[70]/[80]），保证在素材选择浮层之上也能正常显示。
  if (typeof document === "undefined") return null;
  return createPortal(
    <div aria-modal="true" className={`fixed inset-0 z-[90] grid place-items-center bg-foreground/30 backdrop-blur-[1px] ${expanded ? "p-0" : "p-8"}`} onMouseDown={onClose} role="dialog">
      <section className={`flex flex-col overflow-hidden border bg-card shadow-2xl ${expanded ? "h-screen w-screen max-w-none rounded-none" : "h-[86vh] w-full max-w-5xl rounded-sm"}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-sm font-medium">{asset.name || "未命名素材"}</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{(asset.kind || "media").toUpperCase()} · {origin.toUpperCase()} · {status.toUpperCase()}</p>
          </div>
          <div className="flex items-center gap-1">
            <button aria-label={expanded ? "退出全屏" : "全屏展开"} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={() => setExpanded((value) => !value)} title={expanded ? "退出全屏" : "全屏展开"} type="button">{expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
            <button aria-label="关闭预览" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/40">
            <div className="flex min-h-full items-center justify-center p-5">
              <AssetContent apiBase={apiBase} asset={asset} status={status} onImageClick={onImageClick} />
            </div>
          </div>
          <div aria-label="调整属性面板宽度" className="relative w-1.5 shrink-0 cursor-col-resize border-l bg-border/40 hover:bg-primary/40" onMouseDown={startResize} role="separator" />
          <aside className="min-h-0 shrink-0 overflow-y-auto overscroll-contain p-4" style={{ width: asideWidth }}>
            <PanelSection
              action={
                canRemix ? <button className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted disabled:opacity-60" disabled={remixing} onClick={() => void remix()} type="button">{remixing ? <LoaderCircle className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}Remix</button>
                : ready && metadata.prompt && onRegenerate ? <button className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted" onClick={() => onRegenerate(asset)} type="button"><RotateCcw className="size-3" />再次生成</button>
                : undefined
              }
              first
              title="信息"
            >
              <dl className="space-y-4 text-xs">
                <div><dt className="text-muted-foreground">状态</dt><dd className="mt-1 flex items-center gap-1.5">{!ready && status !== "failed" && status !== "proposed" && <LoaderCircle className="size-3 animate-spin text-primary" />}{statusLabel}</dd>{asset.error && <dd className="mt-1 text-[11px] text-destructive">{asset.error}</dd>}</div>
                {remixError && <p className="text-[10px] text-destructive">{remixError}</p>}
                {editableProposal ? (
                  <ProposalEditor
                    apiBase={apiBase}
                    editorKey={asset.id}
                    modality={proposalModalityOf(asset)}
                    onChange={async (patch) => {
                      try {
                        const updated = await updateProposalAsset(apiBase, asset.id, toProposalPatch(patch));
                        upsertAsset(updated);
                      } catch (error) {
                        setRemixError(error instanceof Error ? error.message : "保存提案失败，请重试。");
                      }
                    }}
                    onConfirm={async () => {
                      try {
                        await confirmProposalAsset(apiBase, asset.id);
                        const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}`, { cache: "no-store" });
                        if (response.ok) upsertAsset(await response.json());
                      } catch (error) {
                        setRemixError(error instanceof Error ? error.message : "确认生成失败，请重试。");
                      }
                    }}
                    proposal={proposalFromPreviewAsset(asset)}
                  />
                ) : (
                  <>
                    {metadata.prompt !== undefined && <PromptSection prompt={String(metadata.prompt ?? "")} />}
                    {references.length > 0 && <div><dt className="text-muted-foreground">参考素材</dt><dd className="mt-2 grid grid-cols-3 gap-2">{references.map((ref) => <ReferencePreview key={ref.id} apiBase={apiBase} reference={ref} />)}</dd></div>}
                  </>
                )}
              </dl>
              <div>
                <button className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-xs border text-xs hover:bg-muted ${plan ? "border-primary/40 bg-primary/10 font-medium text-primary" : ""}`} onClick={() => void copyContext()} type="button">{copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}{copied ? "已复制，可粘贴给 AI" : plan ? "复制计划给 AI" : "复制素材上下文"}</button>
                <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{plan ? "把这条计划（说明 + 属性 + 引用）交给 AI 去生成。" : "复制受控资源引用和素材信息，直接粘贴到 Agent 对话即可。"}</p>
              </div>
            </PanelSection>
            <MaterialEditor apiBase={apiBase} asset={asset} />
          </aside>
        </div>
      </section>
      {lightbox && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-8 backdrop-blur" onMouseDown={(event) => { event.stopPropagation(); setLightbox(null); }}>
          <button aria-label="关闭大图" className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => setLightbox(null)} type="button"><X className="size-4" /></button>
          <img alt="preview" className="max-h-[90vh] max-w-[90vw] object-contain" src={lightbox} onMouseDown={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>,
    document.body,
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

function materialAttributesFromAsset(asset: PreviewAsset): PreviewAttribute[] {
  const raw = asset.metadata?.attributes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is PreviewAttribute => Boolean(item) && typeof item === "object" && typeof (item as PreviewAttribute).key === "string");
}

function materialContentFromAsset(asset: PreviewAsset): string {
  const value = asset.metadata?.content;
  return typeof value === "string" ? value : "";
}

function attributeDisplayValue(attribute: PreviewAttribute): string {
  if (attribute.value === undefined || attribute.value === null) return "";
  if (typeof attribute.value === "object") return JSON.stringify(attribute.value);
  return String(attribute.value);
}

function attributeSourceLabel(attribute: PreviewAttribute): string {
  const by = attribute.provenance?.by || attribute.source;
  if (by === "agent") return "AI";
  if (by === "system") return "系统";
  return "手动";
}

function attributeReadValue(attribute: PreviewAttribute): string {
  if (attribute.type === "boolean") return attribute.value === true ? "是" : attribute.value === false ? "否" : "—";
  return attributeDisplayValue(attribute) || "—";
}

function isMaterialAttributeEmpty(attribute: PreviewAttribute): boolean {
  return !(attribute.label ?? "").trim() && attributeDisplayValue(attribute).trim() === "";
}

// 手动可创建的属性类型（media/ref 也开放，让计划态能把「参考来源」直接指向素材）。
const MATERIAL_ATTR_TYPE_OPTIONS: { label: string; value: PreviewAttribute["type"] }[] = [
  { label: "文本", value: "text" },
  { label: "长文本", value: "textarea" },
  { label: "数字", value: "number" },
  { label: "开关", value: "boolean" },
  { label: "链接", value: "url" },
  { label: "选项", value: "select" },
  { label: "素材", value: "media" },
];

function materialAttributeTypeLabel(type: PreviewAttribute["type"]): string {
  return MATERIAL_ATTR_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? (type === "media" ? "素材" : type === "ref" ? "引用" : type);
}

function newMaterialAttributeKey(): string {
  return `field_${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
}

// 富文本值：持久化真相是 markdown + XML 文本，refs 由文本派生
function richValueOf(text: string): RichComposerValue {
  return { text, refs: [], isEmpty: !text };
}

const MATERIAL_CLAMP_CHARS = 140;
const MATERIAL_CLAMP_LINES = 4;

function needsMaterialClamp(value: string): boolean {
  return value.length > MATERIAL_CLAMP_CHARS || value.split("\n").length > MATERIAL_CLAMP_LINES;
}

// RichTextEditor：素材编辑面统一的富文本输入内核（referencing 模式，@ 打开上下文面板）。
// 编辑态最小高度按 leading-6 = 1.5rem/行，经 CSS 变量 + 后代选择器注入编辑器（RichComposer 自身不读 minRows）。
function RichTextEditor({ value, apiBase, placeholder, minRows = 2, maxRows, pinnedOptions, onChange }: { value: RichComposerValue; apiBase: string; placeholder?: string; minRows?: number; maxRows?: number; pinnedOptions?: ContextOption[]; onChange: (value: RichComposerValue) => void }) {
  return (
    <div className="rounded-xs border bg-background p-2 focus-within:border-primary/50 [&_.recut-rich-composer]:min-h-[var(--material-rich-min-h)]" style={{ "--material-rich-min-h": `${minRows * 1.5}rem` } as React.CSSProperties}>
      <RichComposer apiBase={apiBase} maxRows={maxRows} minRows={minRows} mode="referencing" onChange={onChange} pinnedOptions={pinnedOptions} placeholder={placeholder} value={value} variant="field" />
    </div>
  );
}

// MaterialRichFullscreen：放大编辑，与 world-entity RichFullscreenEditor 同入口（z-[100] 高于素材弹框 z-[90]）
function MaterialRichFullscreen({ label, value, apiBase, placeholder, pinnedOptions, onChange, onCommit, onCancel }: { label: string; value: RichComposerValue; apiBase: string; placeholder?: string; pinnedOptions?: ContextOption[]; onChange: (value: RichComposerValue) => void; onCommit: () => void; onCancel: () => void }) {
  return createPortal(
    <div aria-modal="true" className="fixed inset-0 z-[100] grid place-items-center bg-foreground/40 p-6 backdrop-blur-[1px]" onMouseDown={onCancel} role="dialog">
      <section className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">{label} · 放大编辑</p>
          <div className="flex gap-2">
            <button className="rounded-md border px-3 py-1 text-xs hover:bg-muted" onClick={onCancel} type="button">取消</button>
            <button className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90" onClick={onCommit} type="button">保存（⌘↵）</button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" onKeyDownCapture={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onCommit(); } else if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
          <RichTextEditor apiBase={apiBase} minRows={12} onChange={onChange} pinnedOptions={pinnedOptions} placeholder={placeholder ?? "输入内容，@ 引用素材与实体"} value={value} />
        </div>
        <footer className="shrink-0 border-t px-4 py-1.5 text-[10px] text-muted-foreground">⌘↵ 保存 · Esc 取消 · 输入 @ 引用素材与实体</footer>
      </section>
    </div>,
    document.body,
  );
}

// MaterialRichField：素材「说明」的富文本字段（对齐 world-entity RichFieldRow：展示态折叠 + 展开/收起、
// 编辑态 RichComposer + 放大全屏、⌘↵ 保存 / Esc 取消），把 value.text 存回素材 content。
function MaterialRichField({ value, apiBase, placeholder, minRows = 5, pinnedOptions, onSave }: { value: string; apiBase: string; placeholder?: string; minRows?: number; pinnedOptions?: ContextOption[]; onSave: (value: string) => Promise<void> | void }) {
  const registry = useMemo(() => contextProtocolRegistry(), []);
  const [editing, setEditing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<RichComposerValue>(() => richValueOf(value));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const initialRef = useRef(value);

  useEffect(() => {
    if (!editing) setDraft(richValueOf(value));
    initialRef.current = value;
  }, [value, editing]);

  const commit = async () => {
    setEditing(false);
    setFullscreen(false);
    if (draft.text === initialRef.current) return;
    setState("saving");
    try {
      await onSave(draft.text);
      initialRef.current = draft.text;
      setState("saved");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  };
  const cancel = () => {
    setDraft(richValueOf(initialRef.current));
    setEditing(false);
    setFullscreen(false);
  };

  const display = referenceDisplayText(value, registry).trim();
  const clampable = needsMaterialClamp(display);

  if (!editing) {
    return (
      <div className="group/field">
        <div className="flex items-baseline justify-end gap-2">
          {clampable && <button className="text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/field:opacity-100" onClick={() => setExpanded((next) => !next)} type="button">{expanded ? "收起" : "展开"}</button>}
          <button aria-label="编辑说明" className="text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/field:opacity-100" onClick={() => setEditing(true)} type="button">✎ 编辑</button>
        </div>
        <button className={`w-full break-words whitespace-pre-wrap rounded-xs px-1 py-0.5 text-left text-xs leading-5 hover:bg-muted/60 ${display ? "" : "text-muted-foreground/60"} ${clampable && !expanded ? "line-clamp-4" : expanded ? "max-h-[48vh] overflow-y-auto" : ""}`} onClick={() => setEditing(true)} type="button">{display || placeholder || "点击填写"}</button>
        {state === "saved" && <p className="mt-0.5 text-[10px] text-primary">已保存</p>}
        {state === "saving" && <p className="mt-0.5 text-[10px] text-muted-foreground">保存中…</p>}
        {state === "error" && <p className="mt-0.5 text-[10px] text-destructive">保存失败，请重试</p>}
      </div>
    );
  }

  return (
    <div onKeyDownCapture={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); } else if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
      <div className="flex items-baseline justify-end gap-2">
        <button aria-label="放大编辑说明" className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setFullscreen(true)} type="button"><Maximize2 className="size-3" />放大</button>
        <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={cancel} type="button">取消</button>
        <button className="text-[10px] text-primary hover:underline" onClick={() => void commit()} type="button">保存</button>
      </div>
      <div className="mt-1"><RichTextEditor apiBase={apiBase} maxRows={10} minRows={minRows} onChange={setDraft} pinnedOptions={pinnedOptions} placeholder={placeholder} value={draft} /></div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">⌘↵ 保存 · Esc 取消 · 输入 @ 引用素材与实体</p>
      {fullscreen && <MaterialRichFullscreen apiBase={apiBase} label="说明" onCancel={cancel} onChange={setDraft} onCommit={() => void commit()} pinnedOptions={pinnedOptions} placeholder={placeholder} value={draft} />}
    </div>
  );
}

// MaterialEditor 是全局素材「说明 + 属性」的编辑面，按 world-entity 的 PanelSection 分组渲染；
// 素材库、World 画布、编辑器共用同一框。说明与文本类属性统一走 world-entity 的富文本 + @ 引用协议
// （RichComposer referencing），保存 value.text；其余属性对齐 world-entity FieldRow：值行内编辑、失焦即存；
// 名称/类型/选项/删除收在标签旁 Hover 的铅笔 popover；锁定项结构只读、值可改。写入经 PATCH，SSE 回推刷新。
function MaterialEditor({ apiBase, asset }: { apiBase: string; asset: PreviewAsset }) {
  const [content, setContent] = useState(() => materialContentFromAsset(asset));
  const [attributes, setAttributes] = useState<PreviewAttribute[]>(() => materialAttributesFromAsset(asset));
  const [autoRenameKey, setAutoRenameKey] = useState<string | null>(null);
  const [attributesOpen, setAttributesOpen] = useState(() => attributes.length > 0);
  const attributesTouchedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirtyRef = useRef(false);
  // 新建但尚未落库的属性 key：为空时丢弃，不产生空属性。
  const pendingKeysRef = useRef<Set<string>>(new Set());
  // 当前素材作为 @ 面板「当前」组置顶项：可直接再次引用，并可下钻到它的扩展属性。
  const pinnedOptions = useMemo<ContextOption[]>(
    () => [
      {
        key: `media:${asset.id}`,
        sourceType: "media",
        group: "current",
        subKind: asset.kind,
        title: asset.name,
        subtitle: "当前素材 · 可下钻属性",
        badges: [{ key: "self", label: "当前", tone: "primary" }],
        data: asset,
        context: mediaContextPayload(asset.id),
        score: 0,
        pinned: true,
      },
    ],
    [asset],
  );

  useEffect(() => {
    if (dirtyRef.current) return;
    setContent(materialContentFromAsset(asset));
    setAttributes(materialAttributesFromAsset(asset));
  }, [asset.id, asset.updatedAt]);

  // 素材带属性（含 SSE 补齐）时默认展开一次；用户手动折叠后不再自动展开。
  useEffect(() => {
    if (!attributesTouchedRef.current && attributes.length > 0) setAttributesOpen(true);
  }, [attributes.length]);

  const updateAttribute = (index: number, patch: Partial<PreviewAttribute>) => {
    dirtyRef.current = true;
    setAttributes((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const removeAttribute = (index: number) => {
    const key = attributes[index]?.key ?? "";
    const next = attributes.filter((_, i) => i !== index);
    pendingKeysRef.current.delete(key);
    setAttributes(next);
    void persist({ attributes: next }).catch(() => {});
  };
  // 丢弃新建但未填写任何内容的属性（本地移除，不落库）。
  const discardAttribute = (key: string) => {
    pendingKeysRef.current.delete(key);
    setAttributes((prev) => prev.filter((item) => item.key !== key));
  };
  // popover 保存：把草稿原子地合并进该属性并立即落库（避免读到尚未更新的 state）。
  const saveAttributeDraft = (index: number, patch: Partial<PreviewAttribute>) => {
    const next = attributes.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setAttributes(next);
    void persist({ attributes: next }).catch(() => {});
  };
  const addAttribute = () => {
    const key = newMaterialAttributeKey();
    pendingKeysRef.current.add(key);
    attributesTouchedRef.current = true;
    setAttributesOpen(true);
    setAttributes((prev) => [...prev, { key, label: "", type: "text", value: "" }]);
    setAutoRenameKey(key);
  };
  async function persist(options?: { attributes?: PreviewAttribute[]; content?: string }) {
    // 未填写任何内容的新属性不落库。
    const source = options?.attributes ?? attributes;
    const nextContent = options?.content ?? content;
    const payloadAttributes = source.filter((attribute) => !(pendingKeysRef.current.has(attribute.key) && isMaterialAttributeEmpty(attribute)));
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: nextContent, attributes: payloadAttributes.map((attribute) => ({ key: attribute.key, label: attribute.label || undefined, type: attribute.type, value: attribute.value, options: attribute.options, locked: attribute.locked })) }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "保存失败，请稍后重试。");
      }
      dirtyRef.current = false;
      // 仅属性变更时收敛本地属性列表；内容单独保存不动未落库的空属性行。
      if (options?.attributes) {
        pendingKeysRef.current.clear();
        setAttributes(payloadAttributes);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请稍后重试。");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PanelSection defaultOpen={content.trim() !== ""} title="说明">
        <MaterialRichField apiBase={apiBase} onSave={(value) => { setContent(value); return persist({ content: value }); }} pinnedOptions={pinnedOptions} placeholder="这条素材是什么、画面/结构/用途…（AI 读懂后会写在这里）" value={content} />
      </PanelSection>
      <PanelSection
        action={<button className="flex h-6 items-center gap-1 rounded-xs border px-2 text-[10px] hover:bg-muted" onClick={addAttribute} type="button"><Plus className="size-3" />添加属性</button>}
        onOpenChange={(open) => { attributesTouchedRef.current = true; setAttributesOpen(open); }}
        open={attributesOpen}
        title={`属性（${attributes.length}）`}
      >
        <div className="space-y-3">
          {attributes.map((attribute, index) => (
            <AttributeRow
              apiBase={apiBase}
              attribute={attribute}
              autoOpenRename={autoRenameKey === attribute.key}
              key={attribute.key}
              onCommit={(patch) => {
                const next = patch ? attributes.map((item, i) => (i === index ? { ...item, ...patch } : item)) : attributes;
                if (patch) setAttributes(next);
                void persist({ attributes: next }).catch(() => {});
              }}
              onDiscard={() => discardAttribute(attribute.key)}
              onPatch={(patch) => updateAttribute(index, patch)}
              onRemove={() => removeAttribute(index)}
              onSaveDraft={(patch) => saveAttributeDraft(index, patch)}
              pending={pendingKeysRef.current.has(attribute.key)}
              pinnedOptions={pinnedOptions}
            />
          ))}
          {attributes.length === 0 && <p className="text-xs text-muted-foreground">暂无属性</p>}
        </div>
        {error && <p className="text-[10px] text-destructive">{error}</p>}
      </PanelSection>
    </>
  );
}

// media 属性值：规范形态是 { assetId, kind?, name? }（asset-attributes RFC §2.3）；
// 兼容历史遗留的裸 id 字符串（AI 曾把 refSource 写成 text + id）。
function mediaAttrValue(value: unknown): { assetId: string; name?: string; kind?: string } | null {
  if (typeof value === "string") {
    const assetId = value.trim();
    return assetId ? { assetId } : null;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    const assetId = typeof source.assetId === "string" ? source.assetId.trim() : "";
    if (!assetId) return null;
    return {
      assetId,
      ...(typeof source.name === "string" ? { name: source.name } : {}),
      ...(typeof source.kind === "string" ? { kind: source.kind } : {}),
    };
  }
  return null;
}

// MediaAttributeField：素材类型属性的取值控件——直接把属性指向一个素材（选择/替换/清除），
// 而不是编辑 id 字符串。复用共享 Asset SSE 缓存，无需跳转素材库。
function MediaAttributeField({ apiBase, value, onChange }: { apiBase: string; value: unknown; onChange: (value: { assetId: string; kind?: string; name?: string } | undefined) => void }) {
  const { assets } = useMediaAssetEvents();
  const [open, setOpen] = useState(false);
  const selected = mediaAttrValue(value);
  const options = useMemo(
    () => assets.filter((item) => item.status === "completed"),
    [assets],
  );
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
      {selected ? (
        <span className="inline-flex h-7 max-w-60 items-center gap-1 rounded-sm border bg-secondary/70 py-0.5 pr-1 pl-1 text-[10px]" title={selected.name || selected.assetId}>
          <img alt="" className="size-5 shrink-0 rounded-[2px] object-cover" src={mediaContentURL(apiBase, selected.assetId)} />
          <span className="truncate">{selected.name || selected.assetId}</span>
          <button aria-label="清除参考来源" className="ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => onChange(undefined)} type="button"><X className="size-3" /></button>
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">未设置</span>
      )}
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button className="flex h-6 items-center gap-1 rounded-xs border px-1.5 text-[10px] text-muted-foreground hover:bg-muted" type="button"><Plus className="size-3" />选择素材</button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-72 overflow-y-auto p-1.5">
          {options.length ? options.map((item) => (
            <button className="flex w-full items-center gap-2 rounded-xs px-1.5 py-1 text-left text-xs hover:bg-muted" key={item.id} onClick={() => { onChange({ assetId: item.id, kind: item.kind, name: item.name }); setOpen(false); }} type="button">
              <img alt="" className="size-6 shrink-0 rounded-[2px] object-cover" src={mediaContentURL(apiBase, item.id)} />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{item.kind}</span>
            </button>
          )) : <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">暂无可用素材</p>}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// 属性行：文本/长文本取值走富文本 + @（与 world-entity RichFieldRow 同协议：展示态剥离标签、
// 编辑态 RichComposer + 放大全屏、⌘↵ 保存 / Esc 取消）；其余类型仍为行内单值编辑（失焦即存）。
// 名称/类型/选项在 Hover 铅笔 popover 里以「草稿 + 保存 / 取消」编辑；锁定项不可改名/改类型/删除。
function AttributeRow({
  apiBase,
  attribute,
  pending,
  autoOpenRename,
  pinnedOptions,
  onPatch,
  onCommit,
  onRemove,
  onDiscard,
  onSaveDraft,
}: {
  apiBase: string;
  attribute: PreviewAttribute;
  pending: boolean;
  autoOpenRename: boolean;
  pinnedOptions?: ContextOption[];
  onPatch: (patch: Partial<PreviewAttribute>) => void;
  onCommit: (patch?: Partial<PreviewAttribute>) => void;
  onRemove: () => void;
  onDiscard: () => void;
  onSaveDraft: (patch: Partial<PreviewAttribute>) => void;
}) {
  const registry = useMemo(() => contextProtocolRegistry(), []);
  const structural = attribute.type === "media" || attribute.type === "ref";
  const rich = attribute.type === "text" || attribute.type === "textarea";
  const rawValue = attributeDisplayValue(attribute);
  const [renaming, setRenaming] = useState(autoOpenRename);
  const [draft, setDraft] = useState(() => ({ label: attribute.label ?? "", type: attribute.type, options: attribute.options ?? [] }));
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [richDraft, setRichDraft] = useState<RichComposerValue>(() => richValueOf(rawValue));
  const [richFullscreen, setRichFullscreen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const value = rich ? referenceDisplayText(rawValue, registry).trim() : attributeReadValue(attribute);
  const empty = rich ? value === "" : value === "—";
  const clampable = !structural && needsMaterialClamp(value);

  // 文本类走显式保存（@ 面板 portal 到 body，若按外部点击即存会误提交）；其余类型失焦即存。
  useEffect(() => {
    if (!editing || rich) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) {
        setEditing(false);
        onCommit();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    return () => document.removeEventListener("pointerdown", closeOnOutside, true);
  }, [editing, rich, onCommit]);

  // 富文本编辑：草稿只在本地，保存时把 value.text 一次性合并落库（避免逐键持久化与闭包过期）。
  function startRichEdit() {
    setRichDraft(richValueOf(rawValue));
    setEditing(true);
  }
  function commitRich() {
    setEditing(false);
    setRichFullscreen(false);
    onCommit({ value: richDraft.text });
  }
  function cancelRich() {
    setEditing(false);
    setRichFullscreen(false);
  }

  // 打开 popover 时把当前属性复制成草稿；取消/点击外部 = 丢弃草稿（新属性仍为空则移除）。
  function changeRename(open: boolean) {
    setRenaming(open);
    if (open) {
      setDraft({ label: attribute.label ?? "", type: attribute.type, options: attribute.options ?? [] });
      return;
    }
    if (pending && isMaterialAttributeEmpty(attribute)) onDiscard();
  }
  function confirmRename() {
    onSaveDraft({
      label: draft.label,
      type: draft.type,
      ...(draft.type === "select" ? { options: draft.options } : {}),
    });
    setRenaming(false);
  }

  return (
    <div className="group/attr">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">{attribute.label || attribute.key}</span>
          <Popover onOpenChange={changeRename} open={renaming}>
            <PopoverTrigger asChild>
              <button aria-label="编辑属性名称与类型" className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/attr:opacity-100" type="button"><Pencil className="size-3" /></button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-2 p-3">
              <div>
                <p className="mb-1 text-[10px] text-muted-foreground">属性名</p>
                <input autoFocus className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50 disabled:opacity-60" disabled={attribute.locked} onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))} placeholder="属性名" value={draft.label} />
              </div>
              <div>
                <p className="mb-1 text-[10px] text-muted-foreground">类型</p>
                {attribute.locked || structural ? (
                  <p className="text-xs">{materialAttributeTypeLabel(attribute.type)}</p>
                ) : (
                  <select
                    className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50"
                    onChange={(event) => {
                      const nextType = event.target.value as PreviewAttribute["type"];
                      setDraft((prev) => ({ ...prev, type: nextType, ...(nextType === "select" && prev.options.length === 0 ? { options: ["选项 A", "选项 B"] } : {}) }));
                    }}
                    value={draft.type}
                  >
                    {MATERIAL_ATTR_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                )}
              </div>
              {draft.type === "select" && !attribute.locked && (
                <div>
                  <p className="mb-1 text-[10px] text-muted-foreground">选项（逗号分隔）</p>
                  <input className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50" onChange={(event) => setDraft((prev) => ({ ...prev, options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} value={draft.options.join(", ")} />
                </div>
              )}
              {!attribute.locked && (
                <button className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-destructive hover:bg-destructive/10" onClick={() => { onRemove(); setRenaming(false); }} type="button"><Trash2 className="size-3" />删除属性</button>
              )}
              <div className="flex justify-end gap-1.5 border-t pt-2">
                <button className="h-7 rounded border px-2 text-[11px] text-muted-foreground hover:bg-muted" onClick={() => changeRename(false)} type="button">取消</button>
                <button className="h-7 rounded border border-primary/40 bg-primary/10 px-2 text-[11px] font-medium text-primary hover:bg-primary/20" onClick={confirmRename} type="button">保存</button>
              </div>
            </PopoverContent>
          </Popover>
          {clampable && <button className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setExpanded((next) => !next)} type="button">{expanded ? "收起" : "展开"}</button>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {attribute.type !== "text" && <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{materialAttributeTypeLabel(attribute.type)}</span>}
          <Badge>{attributeSourceLabel(attribute)}</Badge>
        </span>
      </div>
      {attribute.type === "boolean" ? (
        <label className="mt-0.5 flex items-center gap-2 text-sm"><input checked={attribute.value === true} onChange={(event) => onSaveDraft({ value: event.target.checked })} type="checkbox" />是</label>
      ) : attribute.type === "select" && attribute.options?.length ? (
        <select className="mt-0.5 w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50" onChange={(event) => onSaveDraft({ value: event.target.value })} value={attributeDisplayValue(attribute)}>
          <option value="">—</option>
          {attribute.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : attribute.type === "media" ? (
        <MediaAttributeField apiBase={apiBase} onChange={(next) => onSaveDraft({ value: next })} value={attribute.value} />
      ) : structural ? (
        <p className="mt-0.5 break-all rounded px-1 py-0.5 font-mono text-[11px] text-muted-foreground">{value}</p>
      ) : editing ? (
        rich ? (
          <div className="mt-0.5" onKeyDownCapture={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commitRich(); } else if (event.key === "Escape") { event.preventDefault(); cancelRich(); } }}>
            <RichTextEditor apiBase={apiBase} maxRows={10} onChange={setRichDraft} pinnedOptions={pinnedOptions} placeholder="输入内容，@ 引用素材与实体" value={richDraft} />
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">⌘↵ 保存 · Esc 取消 · 输入 @ 引用</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button className="flex h-6 items-center gap-0.5 rounded-xs border px-1.5 text-[10px] text-muted-foreground hover:bg-muted" onClick={() => setRichFullscreen(true)} type="button"><Maximize2 className="size-3" />放大</button>
                <button className="h-6 rounded-xs border px-1.5 text-[10px] text-muted-foreground hover:bg-muted" onClick={cancelRich} type="button">取消</button>
                <button className="h-6 rounded-xs border border-primary/40 bg-primary/10 px-1.5 text-[10px] font-medium text-primary hover:bg-primary/20" onClick={commitRich} type="button">保存</button>
              </span>
            </div>
            {richFullscreen && <MaterialRichFullscreen apiBase={apiBase} label={attribute.label || attribute.key} onCancel={cancelRich} onChange={setRichDraft} onCommit={commitRich} pinnedOptions={pinnedOptions} value={richDraft} />}
          </div>
        ) : attribute.type === "textarea" ? (
          <textarea autoFocus className="mt-0.5 min-h-16 w-full resize-y rounded border bg-background px-1.5 py-1 text-sm leading-6 outline-none focus:border-primary/50" onBlur={() => { setEditing(false); onCommit(); }} onChange={(event) => onPatch({ value: event.target.value })} value={attributeDisplayValue(attribute)} />
        ) : (
          <input autoFocus className="mt-0.5 w-full rounded border bg-background px-1.5 py-1 text-sm outline-none focus:border-primary/50" onBlur={() => { setEditing(false); onCommit(); }} onChange={(event) => onPatch({ value: attribute.type === "number" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value })} placeholder={attribute.type === "url" ? "https://" : ""} type={attribute.type === "number" ? "number" : "text"} value={attributeDisplayValue(attribute)} />
        )
      ) : (
        <button className={`mt-0.5 block w-full break-words whitespace-pre-wrap rounded px-1 py-0.5 text-left text-sm leading-6 hover:bg-muted/60 ${empty ? "text-muted-foreground/60" : ""} ${clampable && !expanded ? "line-clamp-4" : ""}`} onClick={() => (rich ? startRichEdit() : setEditing(true))} type="button">{value || "—"}</button>
      )}
    </div>
  );
}

function AssetContent({ apiBase, asset, status, onImageClick }: { apiBase: string; asset: PreviewAsset; status: string; onImageClick?: (src: string) => void }) {
  if (status !== "completed") return <PendingAssetContent apiBase={apiBase} asset={asset} status={status} />;
  const source = mediaContentURL(apiBase, asset.id);
  if (asset.kind === "image") return <button className="group relative" onClick={() => onImageClick?.(source)} type="button"><img alt={asset.name} className="max-h-[65vh] max-w-full cursor-zoom-in object-contain" src={source} /><span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/10 group-hover:opacity-100"><ZoomIn className="size-6 text-white drop-shadow" /></span></button>;
  if (asset.kind === "audio") return <AudioWaveformPlayer name={asset.name || "音频素材"} src={source} />;
  if (asset.kind === "transcript") return <TranscriptAssetContent apiBase={apiBase} asset={asset} />;
  if (asset.kind === "document") return <ReferenceAssetContent apiBase={apiBase} asset={asset} onImageClick={onImageClick} />;
  return <VideoFrame alt={asset.name || "视频素材"} className="w-full max-w-4xl rounded-xs bg-black" controls src={source} videoClassName="max-h-[65vh] object-contain" />;
}

function ReferenceAssetContent({ apiBase, asset, onImageClick }: { apiBase: string; asset: PreviewAsset; onImageClick?: (src: string) => void }) {
  const reference = asset.metadata?.document as ReferenceMetadata | undefined;
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

function PendingAssetContent({ apiBase, asset, status }: { apiBase: string; asset: PreviewAsset; status: string }) {
  const proposed = status === "proposed";
  const plan = proposed && !hasProposalRecipe(asset);
  if (plan) {
    return <div className="grid max-w-sm gap-3 text-center text-muted-foreground"><div><p className="text-sm font-medium text-sky-600">计划中</p><p className="mt-1 text-xs leading-5">这是一条生成计划（只有说明与属性，还没有配方）；复制素材上下文交给 AI 去生成。</p></div></div>;
  }
  return <div className="grid max-w-sm gap-3 text-center text-muted-foreground">{!proposed && <LoaderCircle className={`mx-auto size-8 ${status === "failed" ? "text-destructive" : "animate-spin text-primary"}`} />}<div><p className={`text-sm font-medium ${proposed ? "text-amber-600" : "text-foreground"}`}>{status === "failed" ? "生成失败" : proposed ? "待确认生成" : "生成中"}</p>{!proposed && <GenerationDuration className="mt-1 block font-mono text-[11px] text-muted-foreground" item={asset} />}<p className="mt-1 text-xs leading-5">{proposed ? "这是一条生成提案；确认后才提交生成并消耗额度。" : "素材引用已经建立；完成后会在这里原位可预览。"}</p>{asset.error && <p className="mt-2 text-xs text-destructive">{asset.error}</p>}{status === "failed" && <RetryDownloadButton apiBase={apiBase} asset={asset} />}</div></div>;
}

function RetryDownloadButton({ apiBase, asset }: { apiBase: string; asset: PreviewAsset }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!asset.jobId) return null;
  async function retry() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/retry-download`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "重新下载失败，请稍后重试。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新下载失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }
  return <div className="grid gap-1.5"><button className="mx-auto flex h-8 items-center gap-1.5 rounded-xs border px-3 text-xs hover:bg-muted disabled:opacity-60" disabled={pending} onClick={() => void retry()} type="button">{pending ? <LoaderCircle className="size-3.5 animate-spin text-primary" /> : <RotateCcw className="size-3.5" />}{pending ? "正在重新下载…" : "重新下载"}</button>{error && <p className="text-xs text-destructive">{error}</p>}</div>;
}

function ReferencePreview({ apiBase, reference }: { apiBase: string; reference: PreviewAsset }) {
  const ready = (reference.status || "completed") === "completed";
  const source = mediaContentURL(apiBase, reference.id);
  return <div className="min-w-0">{reference.kind === "image" && ready ? <img alt={reference.name} className="aspect-square w-full rounded-xs border object-cover" src={source} /> : reference.kind === "video" && ready ? <VideoFrame alt={reference.name || "参考视频"} className="aspect-square w-full rounded-xs border" src={source} /> : <div className="grid aspect-square place-items-center rounded-xs border bg-muted text-muted-foreground"><Music2 className="size-4" /></div>}<p className="mt-1 truncate text-[10px]" title={reference.name}>{reference.name}</p><GenerationDuration className="block truncate font-mono text-[9px] text-muted-foreground" item={reference} /></div>;
}

export function mediaContentURL(apiBase: string, assetID: string) {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}/content`;
}
