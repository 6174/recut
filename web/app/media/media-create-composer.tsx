/*
 * [INPUT]: 依赖 react、lucide-react、RichComposer（@ 引用素材）、ModelPicker、CompactParameters、
 *   RecipeParameters、AssetReferenceDialog（可上传参考）、AssetPreviewDialog（缩略图放大）、ui/popover、
 *   media-configuration-store（Provider/凭据/路由）、media-types、agent-panel-context（MG 预填全局对话）
 * [OUTPUT]: 对外提供 MediaCreateComposer 与 MediaCreateDraft/ComposerModality：素材库内容区底部常驻的
 *   直接生成输入框——底栏左侧「生成类型」下拉（图片/视频/音频/动作图形）+ 参考行（缩略图 + 参考按钮，
 *   在输入框上方）+ prompt + 底栏（模型 · 音色 · 核心参数 · 高级 · 生成）+ 右上角全屏编辑；
 *   图片/音频走 /v1/media/jobs 直生、视频走 /v1/media/proposals
 *   待确认提案（门禁不变），动作图形（MG）不提交生成，只把引导 prompt 预填进左侧全局 chat（不自动发送）
 * [POS]: web/app/media 的直接生成 composer；与 World 画布 NodeGenerationComposer 同源原子，不自造控件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronDown, Image as ImageIcon, Layers, Loader2, Maximize2, Minimize2, Music2, SlidersHorizontal, Sparkles, Video, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AssetPreviewDialog, mediaContentURL, type PreviewAsset } from "@/components/asset-preview-dialog";
import { AssetReferenceDialog, type MediaPickerKind } from "@/components/asset-reference-picker";
import { CompactParameters } from "@/components/compact-parameters";
import { ModelPicker } from "@/components/model-picker";
import { RecipeParameters } from "@/components/recipe-parameters";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomSelect } from "@/components/ui/select-field";
import type { ContextOption } from "@/lib/context-catalog/types";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import { mediaContextPayload } from "@/components/agent-panel-types";
import type { MediaEventAsset } from "@/components/use-media-asset-events";
import { normalizeValue, type RichComposerValue } from "@/lib/rich-composer/value";
import { useAgentPanelContext } from "@/lib/agent-panel-context";
import { isLocalProvider, useMediaConfigurationStore } from "@/lib/media-configuration-store";
import {
  normalizeAsset,
  type Asset,
  type AssetKind,
  type Capability,
  type CapabilityVoiceGroup,
  type MediaJob,
  type Model as MediaModel,
  type ModelInputMode,
  type ModelParameter,
} from "./media-types";

export type ComposerModality = "image" | "video" | "audio" | "motion";

export type MediaCreateDraft = {
  id: string;
  modality: ComposerModality;
  modelID?: string;
  prompt?: string;
  referenceIDs?: string[];
  output?: Record<string, unknown>;
};

type ComposerReference = { id: string; kind?: AssetKind; name?: string };

const MODALITY_CAPABILITY: Partial<Record<ComposerModality, Capability>> = {
  image: "image.generate",
  video: "video.generate",
  audio: "speech.generate",
};
const MODALITIES: { id: ComposerModality; label: string; icon: typeof ImageIcon }[] = [
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "video", label: "视频", icon: Video },
  { id: "audio", label: "音频", icon: Music2 },
  { id: "motion", label: "动效", icon: Layers },
];
const MODALITY_LABEL: Record<ComposerModality, string> = { image: "图片", video: "视频", audio: "音频", motion: "动效" };
const PROMPT_PLACEHOLDER: Record<ComposerModality, string> = {
  image: "描述你想生成的图片，@ 可引用素材…",
  video: "描述你想生成的视频，@ 可引用素材…",
  audio: "输入需要朗读的文本，@ 可引用素材…",
  motion: "描述你想要的动效 / 图形，@ 可引用素材…",
};
const MOTION_FALLBACK_PROMPT = "帮我做一个 motion graphic：请先问我想要的用途、时长、画幅与风格，再给出分镜与实现方案。";
const REFERENCE_LABEL: Record<Exclude<AssetKind, "transcript" | "component">, string> = { image: "图片", video: "视频", audio: "音频", document: "资料" };
const CHIP = "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

function isReferenceKind(mode: ModelInputMode): mode is Exclude<AssetKind, "transcript" | "component"> {
  return mode === "image" || mode === "video" || mode === "audio";
}

// 核心参数（留在底栏）：分辨率 / 尺寸 / 画幅。其余收进「高级设置」。用「分词 + 词表」判定避免子串误命中。
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

function refsFromValue(value: RichComposerValue): ComposerReference[] {
  const out: ComposerReference[] = [];
  for (const ref of value.refs) {
    if (ref.type === "reference" && ref.attrs.id) {
      out.push({ id: ref.attrs.id, ...(ref.attrs.kind ? { kind: ref.attrs.kind as AssetKind } : {}), ...(ref.attrs.label ? { name: ref.attrs.label } : {}) });
    } else if (ref.type === "media" && ref.attrs.assetid) {
      out.push({ id: ref.attrs.assetid, ...(ref.attrs.type ? { kind: ref.attrs.type as AssetKind } : {}), ...(ref.attrs.name ? { name: ref.attrs.name } : {}) });
    }
  }
  return out;
}

function mergeRefs(existing: ComposerReference[], mentioned: ComposerReference[]): ComposerReference[] {
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

export function MediaCreateComposer({
  apiBase,
  assets,
  draft,
  onAssetImported,
  onNotice,
  onOpenProviderSettings,
  onProposed,
  onSubmitted,
}: {
  apiBase: string;
  assets: Asset[];
  draft: MediaCreateDraft | null;
  onAssetImported: (asset: Asset) => void;
  onNotice: (message: string) => void;
  onOpenProviderSettings: () => void;
  onProposed: (asset: Asset) => void;
  onSubmitted: (job: MediaJob) => void;
}) {
  const configuration = useMediaConfigurationStore();
  const registry = useMemo(() => contextProtocolRegistry(), []);
  const [modality, setModality] = useState<ComposerModality>("image");
  const [modelID, setModelID] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptValue, setPromptValue] = useState<RichComposerValue>(() => normalizeValue("", registry));
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [voiceGroups, setVoiceGroups] = useState<CapabilityVoiceGroup[]>([]);
  const [voiceID, setVoiceID] = useState("");
  const [references, setReferences] = useState<ComposerReference[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);

  useEffect(() => {
    void configuration.load(apiBase);
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 音频：能力级声音分组（本地 provider 一组 + 云端每凭据一组），同时提供 TTS 模型清单。
  useEffect(() => {
    if (modality !== "audio") return;
    let active = true;
    void (async () => {
      const response = await fetch(`${apiBase}/v1/media/capabilities/speech.generate/voices`, { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      setVoiceGroups((await response.json()) as CapabilityVoiceGroup[]);
    })();
    return () => { active = false; };
  }, [apiBase, modality]);

  // 再次生成 / Remix：调用方按 draft.id 传入配方，原位回填并切到对应模态。
  useEffect(() => {
    if (!draft) return;
    setModality(draft.modality);
    setModelID(draft.modelID ?? "");
    const text = draft.prompt ?? "";
    setPrompt(text);
    setPromptValue(normalizeValue(text, registry));
    setParams(draft.output ? { ...draft.output } : {});
    const draftVoice = typeof draft.output?.voiceId === "string" ? draft.output.voiceId : "";
    setVoiceID(draftVoice);
    setReferences(
      (draft.referenceIDs ?? []).map((id) => {
        const asset = assets.find((item) => item.id === id);
        return { id, ...(asset?.kind ? { kind: asset.kind } : {}), ...(asset?.name ? { name: asset.name } : {}) };
      }),
    );
    setError("");
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const capability = MODALITY_CAPABILITY[modality] ?? null;
  const isSpeech = modality === "audio";
  const models: MediaModel[] = !capability
    ? []
    : isSpeech
      ? Array.from(new Map(voiceGroups.flatMap((group) => group.models).map((model) => [model.id, model])).values())
      : configuration.providers.flatMap((provider) => provider.models).filter((model) => model.capability === capability && model.available);
  const routeModelId = capability ? configuration.routes.find((route) => route.capability === capability && route.enabled)?.modelId ?? "" : "";
  const selectedModel = models.find((model) => model.id === (modelID || routeModelId)) ?? models[0];
  const voiceGroup = isSpeech ? voiceGroups.find((group) => group.models.some((model) => model.id === selectedModel?.id)) : undefined;
  const voices = (voiceGroup?.voices ?? []).filter((voice) => !voice.modelId || voice.modelId === selectedModel?.id);
  const voiceKey = voices.map((voice) => voice.id).join(",");
  const credential = configuration.credentials.find((item) => item.provider === selectedModel?.provider);
  const keyless = isLocalProvider(selectedModel?.provider, configuration.providers);
  const parameters: ModelParameter[] = selectedModel?.parameters ?? [];
  const coreParameters = parameters.filter(isCoreParameter);
  const advancedParameters = parameters.filter((parameter) => !isCoreParameter(parameter));
  const referenceKinds: Exclude<AssetKind, "transcript" | "component">[] = selectedModel ? selectedModel.inputModes.filter(isReferenceKind) : [];
  const referenceKindKey = referenceKinds.join(",");
  const referenceLabel = referenceKinds.map((item) => REFERENCE_LABEL[item]).join("、");

  // 音色缺省：无有效选择时取当前模型可选的第一条。
  useEffect(() => {
    setVoiceID((current) => (current && voices.some((voice) => voice.id === current) ? current : voices[0]?.id ?? ""));
  }, [voiceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 换模型后剔除当前模型不接受的参考类型。
  useEffect(() => {
    setReferences((items) => {
      const next = items.filter((item) => (item.kind ? referenceKinds.includes(item.kind as Exclude<AssetKind, "transcript" | "component">) : true));
      return next.length === items.length ? items : next;
    });
  }, [referenceKindKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit =
    modality === "motion"
      ? !submitting
      : Boolean(selectedModel && prompt.trim() && (keyless || credential)) && !submitting;
  const buttonLabel = submitting
    ? "提交中…"
    : modality === "motion"
      ? "交给 AI"
      : modality === "video"
        ? "生成提案"
        : "生成";

  const handlePromptChange = (value: RichComposerValue) => {
    setPromptValue(value);
    setPrompt(value.text);
    setReferences((items) => mergeRefs(items, refsFromValue(value)));
  };

  const openReferencePreview = async (item: ComposerReference) => {
    const cached = assets.find((asset) => asset.id === item.id);
    if (cached) {
      setPreviewAsset(toPreviewAsset(cached));
      return;
    }
    const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(item.id)}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    setPreviewAsset(toPreviewAsset(normalizeAsset((await response.json()) as Asset)));
  };

  async function importReference(file: File) {
    if (referenceKinds.length && !referenceKinds.some((kind) => file.type.startsWith(`${kind}/`))) {
      setError(`当前模型只支持${referenceLabel || "兼容的"}参考素材。`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${apiBase}/v1/media/assets`, { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "参考素材导入失败，请重试。");
      return;
    }
    const asset = normalizeAsset((await response.json()) as Asset);
    onAssetImported(asset);
    setReferences((items) => (items.some((item) => item.id === asset.id) ? items : [...items, { id: asset.id, kind: asset.kind, name: asset.name }]));
  }

  function openMotionChat() {
    const text = prompt.trim() ? `帮我做一个 motion graphic：${prompt.trim()}` : MOTION_FALLBACK_PROMPT;
    useAgentPanelContext.getState().setDraft({ id: `media-motion-${Date.now()}`, text });
    onNotice("已把动效需求填进左侧对话，确认后发送给 Agent。");
    setPrompt("");
    setPromptValue(normalizeValue("", registry));
  }

  async function submit() {
    if (!canSubmit) return;
    if (modality === "motion") {
      openMotionChat();
      return;
    }
    if (!capability || !selectedModel) return;
    const proposes = capability === "video.generate";
    const output: Record<string, unknown> = { ...params };
    if (isSpeech && voiceID) output.voiceId = voiceID;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}${proposes ? "/v1/media/proposals" : "/v1/media/jobs"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability,
          modelId: selectedModel.id,
          credentialId: credential?.id,
          prompt: prompt.trim(),
          referenceIds: references.map((item) => item.id),
          output: Object.keys(output).length ? output : undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "创建任务失败，请检查 Provider 配置。");
        return;
      }
      if (proposes) {
        onProposed((await response.json()) as Asset);
        onNotice("视频提案已创建，请点击素材卡上的“确认生成”。");
      } else {
        onSubmitted((await response.json()) as MediaJob);
        onNotice(`${MODALITY_LABEL[modality]}任务已提交，素材卡会显示实时用时。`);
      }
      setPrompt("");
      setPromptValue(normalizeValue("", registry));
      setReferences([]);
    } finally {
      setSubmitting(false);
    }
  }

  const pinnedOptions = useMemo<ContextOption[]>(
    () =>
      references.map((item) => {
        const kind = item.kind === "video" ? "video" : item.kind === "audio" ? "audio" : "image";
        const assetEvent: MediaEventAsset = { id: item.id, kind, mimeType: "", name: item.name ?? item.id, origin: "参考素材", status: "completed", createdAt: "", updatedAt: "", metadata: {} };
        return {
          key: `media:${item.id}`,
          sourceType: "media",
          group: "media",
          subKind: kind,
          title: item.name ?? item.id,
          subtitle: kind,
          badges: [{ key: "ref", label: "参考", tone: "muted" }],
          data: assetEvent,
          context: mediaContextPayload(item.id),
          score: 0,
        } as ContextOption;
      }),
    [references],
  );

  const changeModality = (next: ComposerModality) => {
    setModality(next);
    setModelID("");
    setParams({});
    setError("");
  };

  const renderReferences = () => (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {references.map((item) => (
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
            onClick={() => setReferences((items) => items.filter((ref) => ref.id !== item.id))}
            type="button"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
      <button className="inline-flex h-9 items-center gap-1 rounded-md border border-dashed px-2 text-[11px] text-muted-foreground hover:bg-muted" onClick={() => setPickerOpen(true)} title="从素材库选择参考（可上传）" type="button">
        <ImageIcon className="size-3.5" /> 参考
      </button>
    </div>
  );

  const renderPrompt = (expanded: boolean) => (
    <div className={`rounded-lg border bg-background p-2 transition-colors focus-within:border-primary ${expanded ? "flex min-h-0 flex-1 flex-col" : "min-h-[120px]"}`}>
      <RichComposer
        apiBase={apiBase}
        className={expanded ? "h-full" : undefined}
        maxRows={expanded ? 40 : 10}
        minRows={expanded ? 12 : 4}
        mode="referencing"
        onChange={handlePromptChange}
        onPasteFiles={(files) => {
          void (async () => {
            for (const file of files) await importReference(file);
          })();
        }}
        onSubmit={() => void submit()}
        pinnedOptions={pinnedOptions}
        placeholder={PROMPT_PLACEHOLDER[modality]}
        value={promptValue}
        variant="field"
      />
    </div>
  );

  const renderModality = () => {
    const current = MODALITIES.find((item) => item.id === modality) ?? MODALITIES[0];
    const CurrentIcon = current.icon;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className={CHIP} title="生成类型" type="button">
            <CurrentIcon className="size-3.5 opacity-80" />
            {current.label}
            <ChevronDown className="size-3 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-36 p-1">
          {MODALITIES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`flex h-8 w-full items-center gap-2 rounded-xs px-2 text-left text-xs hover:bg-muted ${item.id === modality ? "bg-accent" : ""}`}
                key={item.id}
                onClick={() => changeModality(item.id)}
                type="button"
              >
                <Icon className="size-3.5" />
                {item.label}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    );
  };

  const renderBar = () => (
    <div className="mt-2 flex items-center gap-1.5 overflow-x-auto [&_button]:h-8 [&_button]:min-h-0">
      {renderModality()}
      {modality === "motion" ? (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="size-3" />
          动效由左侧 Agent 探索生成
        </span>
      ) : models.length && selectedModel ? (
        <div className="w-[150px] shrink-0 [&_button>span>span:last-child]:hidden">
          <ModelPicker
            credentialConnected={(providerID) => isLocalProvider(providerID, configuration.providers) || configuration.credentials.some((item) => item.provider === providerID)}
            id="media-create-composer-model"
            models={models}
            onChange={setModelID}
            providerName={(providerID) => configuration.providers.find((item) => item.id === providerID)?.name ?? providerID}
            value={selectedModel.id}
          />
        </div>
      ) : (
        <button className={CHIP} onClick={onOpenProviderSettings} type="button">
          <Sparkles className="size-3 opacity-70" /> 添加 Provider
        </button>
      )}
      {isSpeech && voices.length > 0 && (
        <div className="w-[150px] shrink-0">
          <CustomSelect
            id="media-create-composer-voice"
            onChange={setVoiceID}
            options={voices.map((voice) => ({ value: voice.id, label: voice.name }))}
            value={voiceID}
          />
        </div>
      )}
      {modality !== "audio" && modality !== "motion" && (
        <CompactParameters onChange={(name, value) => setParams((values) => ({ ...values, [name]: value }))} parameters={coreParameters} values={params} />
      )}
      {modality !== "audio" && modality !== "motion" && advancedParameters.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className={CHIP} title="高级设置（模型全部参数）" type="button">
              <SlidersHorizontal className="size-3 opacity-70" /> 高级
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3">
            <RecipeParameters onChange={(name, value) => setParams((values) => ({ ...values, [name]: value }))} parameters={advancedParameters} values={params} />
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
        {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
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
            setReferences((items) => {
              const known = new Set(items.map((item) => item.id));
              return [...items, ...picked.filter((item) => !known.has(item.id)).map((item) => ({ id: item.id, name: item.name, kind: item.kind }))];
            });
            setPickerOpen(false);
          }}
          open
          projectID={null}
          selectedIDs={references.map((item) => item.id)}
          title="选择参考素材"
        />
      )}
    </>
  );

  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[85] grid place-items-center bg-foreground/40 p-6 backdrop-blur-[1px]" data-media-composer-fullscreen onMouseDown={() => setFullscreen(false)}>
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
            {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
          </div>
        </section>
        {overlays}
      </div>,
      document.body,
    );
  }

  return (
    <div className="pointer-events-auto relative w-full rounded-xl border bg-card p-2.5 shadow-2xl">
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
      {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
      {overlays}
    </div>
  );
}
