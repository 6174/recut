/*
 * [INPUT]: 依赖 react/createPortal、lucide-react、components/rich-composer（富文本 @ 引用）、components/model-picker、
 *   components/compact-parameters（核心参数 chip）、components/recipe-parameters（高级：完整 schema 表单）、
 *   components/asset-preview-dialog（放大预览）、ui/popover、media-configuration-store、
 *   media-types（Asset/normalizeAsset/Capability/Model/ModelParameter）、canvas-store（runMediaJob/apiBase/readOnly）、
 *   canvas-asset-status（资产状态）、panel/element-recipe-draft-store（按元素持久化配方草稿）、
 *   panel/world-media-picker（当前画布/World 参考）、overlays/subject（composerEligible）、overlays/types、
 *   rich-composer/value（normalizeValue）、context-catalog/registry
 * [OUTPUT]: 对外提供 generationComposerPlugin（内置输入框插件）与 NodeGenerationComposer：节点下方的生成输入框——
 *   富文本提示词（@ 引用素材/世界实体）+ 参考缩略图（点击放大）+ 单行底栏（模型 chip · 分辨率/尺寸 chip · 高级设置 · 生成/再生成）
 *   + 右上角全屏入口（大尺寸、稳定的输入/选表单）。空内容或 AI 生成内容时由宿主挂出；
 *   点击即直接生成（runMediaJob，图片/视频/音频同一路径），不再落提案；提案态按钮显示「生成」。
 * [POS]: worlds/[worldID]/canvas/overlays 的生成输入框插件（RFC 2026-10-07 §3.3）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Globe, Image as ImageIcon, Loader2, Maximize2, Minimize2, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AssetPreviewDialog, mediaContentURL, type PreviewAsset } from "@/components/asset-preview-dialog";
import { AssetReferenceDialog, type MediaPickerKind } from "@/components/asset-reference-picker";
import { CompactParameters } from "@/components/compact-parameters";
import { ModelPicker } from "@/components/model-picker";
import { RecipeParameters } from "@/components/recipe-parameters";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import type { ContextOption } from "@/lib/context-catalog/types";
import { mediaContextPayload } from "@/components/agent-panel-types";
import type { MediaEventAsset } from "@/components/use-media-asset-events";
import { normalizeValue, type RichComposerValue } from "@/lib/rich-composer/value";
import { isLocalProvider, useMediaConfigurationStore } from "@/lib/media-configuration-store";
import { normalizeAsset, type Asset, type Capability, type Model as MediaModel, type ModelParameter } from "@/app/media/media-types";
import { useWorldCanvasStore } from "../canvas-store";
import { useCanvasAssetStatusStore } from "../canvas-asset-status";
import { EMPTY_RECIPE_DRAFT, useElementRecipeDraftStore, type RecipeDraft, type RecipeReference } from "../panel/element-recipe-draft-store";
import { WorldMediaPicker } from "../panel/world-media-picker";
import { composerEligible } from "./subject";
import type { MediaGenerationSubject, NodeOverlayContext, NodeOverlayPlugin } from "./types";

const RECIPE_CAPABILITY: Record<MediaGenerationSubject["modality"], Capability> = {
  image: "image.generate",
  video: "video.generate",
  audio: "speech.generate",
};
const MODALITY_LABEL: Record<MediaGenerationSubject["modality"], string> = { image: "图片", video: "视频", audio: "音频" };

// 核心参数（留在底栏）：分辨率 / 尺寸 / 画幅。其余收进「高级设置」，高级设置仍 follow 模型的 parameters schema。
// 用「分词 + 词表」判定，避免子串误命中（durationSeconds 里的 "ratio" 不是画幅）。
const CORE_TOKENS = new Set(["size", "resolution", "aspect", "ratio", "width", "height", "dimension", "dimensions"]);
function isCoreParameter(parameter: ModelParameter): boolean {
  const text = `${parameter.name} ${parameter.label ?? ""}`;
  if (/尺寸|分辨率|画幅|比例/.test(text)) return true;
  const tokens = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.:]+/)
    .map((token) => token.toLowerCase());
  return tokens.some((token) => CORE_TOKENS.has(token));
}
const CHIP = "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export const generationComposerPlugin: NodeOverlayPlugin = {
  id: "generation-composer",
  kind: "composer",
  priority: 0,
  match: (ctx) => composerEligible(ctx.subject),
  render: (ctx) => <NodeGenerationComposer ctx={ctx} />,
};

// 富文本正文里的引用标签 → 结构化参考（<reference id …/> 与 @ 面板的 <media …/> 同构）。
function refsFromValue(value: RichComposerValue): RecipeReference[] {
  const out: RecipeReference[] = [];
  for (const ref of value.refs) {
    if (ref.type === "reference" && ref.attrs.id) {
      out.push({ id: ref.attrs.id, ...(ref.attrs.kind ? { kind: ref.attrs.kind } : {}), ...(ref.attrs.label ? { name: ref.attrs.label } : {}) });
    } else if (ref.type === "media" && ref.attrs.assetid) {
      out.push({ id: ref.attrs.assetid, ...(ref.attrs.type ? { kind: ref.attrs.type } : {}), ...(ref.attrs.name ? { name: ref.attrs.name } : {}) });
    }
  }
  return out;
}

function mergeRefs(existing: RecipeReference[], mentioned: RecipeReference[]): RecipeReference[] {
  if (!mentioned.length) return existing;
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of mentioned) byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item });
  return Array.from(byId.values());
}

function toPreviewAsset(asset: Asset): PreviewAsset {
  return {
    id: asset.id,
    kind: asset.kind as PreviewAsset["kind"],
    name: asset.name,
    origin: asset.origin,
    status: asset.status,
    ...(asset.jobId ? { jobId: asset.jobId } : {}),
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    metadata: asset.metadata,
  };
}

export function NodeGenerationComposer({ ctx }: { ctx: NodeOverlayContext }) {
  const subject = ctx.subject as MediaGenerationSubject;
  const { elementId, modality } = subject;
  const capability = RECIPE_CAPABILITY[modality];
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const runMediaJob = useWorldCanvasStore((state) => state.runMediaJob);

  const draft = useElementRecipeDraftStore((state) => state.drafts[elementId]) ?? EMPTY_RECIPE_DRAFT;
  const setDraft = useElementRecipeDraftStore((state) => state.setDraft);
  const { prompt, modelId, withCurrentRef, references, params } = draft;

  const assetId = subject.assetId;
  const asset = useCanvasAssetStatusStore((state) => (assetId ? state.assets[assetId] : undefined));
  const status = useCanvasAssetStatusStore((state) => (assetId ? state.statuses[assetId] : undefined));
  const proposed = status === "proposed" || asset?.status === "proposed";
  const generating = status === "generating" || asset?.status === "running" || asset?.status === "queued";

  const registry = useMemo(() => contextProtocolRegistry(), []);
  const [promptValue, setPromptValue] = useState<RichComposerValue>(() => normalizeValue(prompt, registry));
  const promptTextRef = useRef(promptValue.text);
  promptTextRef.current = promptValue.text;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [worldPickerOpen, setWorldPickerOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);

  const configuration = useMediaConfigurationStore();
  useEffect(() => {
    void configuration.load(apiBase);
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prompt !== promptTextRef.current) setPromptValue(normalizeValue(prompt, registry));
  }, [prompt, registry]);

  // metadata 回填：换图/生成完成后把资产配方填回输入框（用户已编辑则不动）。
  useEffect(() => {
    const metadata = asset?.metadata;
    if (!metadata) return;
    const existing = useElementRecipeDraftStore.getState().drafts[elementId];
    if (existing?.edited) return;
    const patch: Partial<RecipeDraft> = {};
    if (typeof metadata.prompt === "string" && metadata.prompt) patch.prompt = metadata.prompt;
    if (typeof metadata.modelId === "string" && metadata.modelId) patch.modelId = metadata.modelId;
    if (metadata.output && typeof metadata.output === "object") patch.params = { ...(existing?.params ?? {}), ...(metadata.output as Record<string, unknown>) };
    if (Array.isArray(metadata.referenceIds)) {
      const ids = (metadata.referenceIds as unknown[]).filter((id): id is string => typeof id === "string" && id !== assetId);
      const known = new Map((existing?.references ?? []).map((item) => [item.id, item]));
      patch.references = ids.map((id) => known.get(id) ?? { id });
    }
    const changed = Object.entries(patch).some(([key, value]) => JSON.stringify((existing as Record<string, unknown> | undefined)?.[key]) !== JSON.stringify(value));
    if (changed) useElementRecipeDraftStore.getState().setDraft(elementId, patch);
  }, [asset, elementId, assetId]);

  // Radix 浮层（模型/枚举/高级）在画布上点外部不关闭：画布 pointerdown 调了 preventDefault，Radix 会跳过。
  // 用捕获阶段监听补发 Escape（捕获先于画布 preventDefault 触发），仅当确有浮层打开且点到浮层/本 overlay 之外。
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || target.closest("[data-radix-popper-content-wrapper]")) return;
      if (target.closest('[data-node-overlay="composer"]') || target.closest('[data-composer-fullscreen]')) return;
      if (!document.querySelector("[data-radix-popper-content-wrapper]")) return;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  const models: MediaModel[] = configuration.providers.flatMap((provider) => provider.models).filter((model) => model.capability === capability && model.available);
  const routeModelId = configuration.routes.find((route) => route.capability === capability && route.enabled)?.modelId ?? "";
  const selectedModel = models.find((model) => model.id === (modelId || routeModelId)) ?? models[0];
  const credential = configuration.credentials.find((item) => item.provider === selectedModel?.provider);
  const keyless = isLocalProvider(selectedModel?.provider, configuration.providers);
  const allParameters: ModelParameter[] = selectedModel?.parameters ?? [];
  const coreParameters = allParameters.filter(isCoreParameter);
  const advancedParameters = allParameters.filter((parameter) => !isCoreParameter(parameter));

  const edit = (patch: Partial<RecipeDraft>) => setDraft(elementId, { ...patch, edited: true });
  const handlePromptChange = (value: RichComposerValue) => {
    setPromptValue(value);
    setDraft(elementId, { prompt: value.text, references: mergeRefs(references, refsFromValue(value)), edited: true });
  };

  // 缩略图放大：按 id 拉完整素材再进全局素材预览框（避免引用只有 id、kind 缺失时被当成节点模态渲染成视频）。
  const openReferencePreview = async (item: RecipeReference) => {
    const cached = useCanvasAssetStatusStore.getState().assets[item.id];
    if (cached) {
      setPreviewAsset(toPreviewAsset(cached));
      return;
    }
    const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(item.id)}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    setPreviewAsset(toPreviewAsset(normalizeAsset((await response.json()) as Asset)));
  };

  const refs = [
    ...(withCurrentRef && assetId ? [{ id: assetId, kind: modality, name: asset?.name, label: asset?.name ?? "" }] : []),
    ...references.filter((item) => item.id !== assetId).map((item) => ({ id: item.id, kind: item.kind ?? modality, name: item.name, label: item.name ?? item.id })),
  ];
  const referenceIds = Array.from(new Set(refs.map((item) => item.id)));

  // @ 面板「当前」组：把当前用作底图的素材 + 已加入的参考素材置顶，方便直接 @ 复用。
  const pinnedOptions = useMemo<ContextOption[]>(() => {
    const list: Array<{ id: string; kind: string; name: string }> = [];
    if (withCurrentRef && assetId) list.push({ id: assetId, kind: modality, name: asset?.name ?? "当前素材" });
    for (const item of references) {
      if (item.id === assetId) continue;
      list.push({ id: item.id, kind: item.kind ?? modality, name: item.name ?? item.id });
    }
    return list.map((item) => {
      const kind = item.kind === "video" ? "video" : item.kind === "audio" ? "audio" : "image";
      const assetEvent: MediaEventAsset = { id: item.id, kind, mimeType: "", name: item.name, origin: "参考素材", status: "completed", createdAt: "", updatedAt: "", metadata: {} };
      return {
        key: `media:${item.id}`,
        sourceType: "media",
        group: "media",
        subKind: kind,
        title: item.name,
        subtitle: kind,
        badges: [{ key: "ref", label: "参考", tone: "muted" }],
        data: assetEvent,
        context: mediaContextPayload(item.id),
        score: 0,
      } as ContextOption;
    });
  }, [withCurrentRef, assetId, asset?.name, modality, references]);

  const canSubmit = Boolean(selectedModel && prompt.trim() && (keyless || credential)) && !busy && !readOnly;
  const buttonLabel = generating ? "生成中…" : proposed ? "生成" : assetId ? "再生成" : "生成";

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await runMediaJob(elementId, {
        capability,
        modelId: selectedModel!.id,
        credentialId: credential?.id,
        prompt: prompt.trim(),
        referenceIds,
        output: { ...params },
      });
    } finally {
      setBusy(false);
    }
  };

  const renderReferences = () => (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {references.filter((item) => item.id !== assetId).map((item) => (
        <div className="group/ref relative size-9 overflow-hidden rounded-md border" key={item.id} title={item.name ?? item.id}>
          <button className="block size-full cursor-zoom-in" onClick={() => void openReferencePreview(item)} title={`${item.name ?? item.id} · 点击放大`} type="button">
            {item.kind === "video" ? (
              <video className="size-full object-cover" muted src={mediaContentURL(apiBase, item.id)} />
            ) : item.kind === "audio" ? (
              <div className="grid size-full place-items-center bg-muted/40 text-xs">♪</div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={item.name ?? ""} className="size-full object-cover" src={mediaContentURL(apiBase, item.id)} />
            )}
          </button>
          <button
            aria-label={`移除参考 ${item.name ?? item.id}`}
            className="absolute right-0 top-0 hidden rounded bg-card/90 p-0.5 text-muted-foreground hover:text-destructive group-hover/ref:block"
            onClick={(event) => {
              event.stopPropagation();
              edit({ references: references.filter((ref) => ref.id !== item.id) });
            }}
            type="button"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
      <button className="inline-flex h-9 items-center gap-1 rounded-md border border-dashed px-2 text-[10px] text-muted-foreground hover:bg-muted" onClick={() => setPickerOpen(true)} title="从素材库选择参考（可上传）" type="button">
        <ImageIcon className="size-3.5" /> 参考
      </button>
      <button className="inline-flex h-9 items-center gap-1 rounded-md border border-dashed px-2 text-[10px] text-muted-foreground hover:bg-muted" onClick={() => setWorldPickerOpen(true)} title="从当前画布 / 当前 World 选择参考" type="button">
        <Globe className="size-3.5" /> World
      </button>
    </div>
  );

  const renderPrompt = (expanded: boolean) => (
    <div className={`rounded-lg border bg-background p-2 transition-colors focus-within:border-primary ${expanded ? "flex min-h-0 flex-1 flex-col" : "min-h-[84px]"}`}>
      <RichComposer
        apiBase={apiBase}
        className={expanded ? "h-full" : undefined}
        maxRows={expanded ? 40 : 6}
        minRows={expanded ? 10 : 2}
        mode="referencing"
        onChange={handlePromptChange}
        pinnedOptions={pinnedOptions}
        placeholder={modality === "audio" ? "输入需要朗读的文本，@ 可引用素材…" : modality === "video" ? "输入视频提示词，@ 可引用素材/实体…" : "输入画面描述，@ 可引用素材/实体…"}
        value={promptValue}
        variant="field"
      />
    </div>
  );

  const renderBar = () => (
    <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
      {models.length && selectedModel ? (
        <div className="w-[150px] shrink-0 [&_button>span>span:last-child]:hidden">
          <ModelPicker
            credentialConnected={(providerID) => isLocalProvider(providerID, configuration.providers) || configuration.credentials.some((item) => item.provider === providerID)}
            id={`node-composer-${elementId}`}
            models={models}
            onChange={(id) => edit({ modelId: id })}
            providerName={(providerID) => configuration.providers.find((item) => item.id === providerID)?.name ?? providerID}
            value={selectedModel.id}
          />
        </div>
      ) : (
        <span className="shrink-0 text-[10px] text-muted-foreground">没有可用模型</span>
      )}
      {modality !== "audio" && <CompactParameters onChange={(name, value) => edit({ params: { ...params, [name]: value } })} parameters={coreParameters} values={params} />}
      {modality !== "audio" && advancedParameters.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className={CHIP} title="高级设置（模型全部参数）" type="button">
              <SlidersHorizontal className="size-3 opacity-70" /> 高级
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3">
            <RecipeParameters onChange={(name, value) => edit({ params: { ...params, [name]: value } })} parameters={advancedParameters} values={params} />
          </PopoverContent>
        </Popover>
      )}
      <span className="min-w-2 flex-1" />
      <button
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        disabled={!canSubmit}
        onClick={() => void submit()}
        type="button"
      >
        {busy || generating ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {buttonLabel}
      </button>
    </div>
  );

  const overlays = (
    <>
      {previewAsset && <AssetPreviewDialog apiBase={apiBase} asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
      {pickerOpen && (
        <AssetReferenceDialog
          apiBase={apiBase}
          allowUpload
          description="作为生成参考的图片 / 视频 / 音频素材，可多选。"
          kinds={["image", "video", "audio"] as MediaPickerKind[]}
          multiple
          onClose={() => setPickerOpen(false)}
          onPick={() => {}}
          onPickMany={(picked) => {
            const known = new Set(references.map((item) => item.id));
            edit({ references: [...references, ...picked.filter((item) => !known.has(item.id)).map((item) => ({ id: item.id, name: item.name, kind: item.kind }))] });
            setPickerOpen(false);
          }}
          open
          projectID={null}
          selectedIDs={references.map((item) => item.id)}
          title="选择参考素材"
        />
      )}
      <WorldMediaPicker
        onClose={() => setWorldPickerOpen(false)}
        onPick={(items) => {
          const known = new Set(references.map((item) => item.id));
          edit({ references: [...references, ...items.filter((item) => !known.has(item.id))] });
        }}
        open={worldPickerOpen}
        selectedIds={references.map((item) => item.id)}
      />
    </>
  );

  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[85] grid place-items-center bg-foreground/40 p-6 backdrop-blur-[1px]" data-composer-fullscreen onMouseDown={() => setFullscreen(false)}>
        <section className="flex h-[min(780px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <header className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">生成 · {MODALITY_LABEL[modality]}</p>
            <button aria-label="退出全屏" className="grid size-7 place-items-center rounded hover:bg-muted" onClick={() => setFullscreen(false)} type="button">
              <Minimize2 className="size-3.5" />
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            {renderReferences()}
            {renderPrompt(true)}
            {renderBar()}
          </div>
        </section>
        {overlays}
      </div>,
      document.body,
    );
  }

  return (
    <div className="pointer-events-auto relative w-[min(520px,calc(100vw-2rem))] rounded-xl border bg-card p-2.5 shadow-2xl">
      <button
        aria-label="全屏编辑"
        className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setFullscreen(true)}
        title="全屏编辑（更大的输入与表单区）"
        type="button"
      >
        <Maximize2 className="size-3.5" />
      </button>
      {renderReferences()}
      {renderPrompt(false)}
      {renderBar()}
      {overlays}
    </div>
  );
}
