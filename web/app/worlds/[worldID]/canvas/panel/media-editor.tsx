/*
 * [INPUT]: 依赖 react、canvas-store（apiBase/mediaSource 辅助/setMediaElementAsset/setAttrMediaAsset）、
 * pane./element-asset-history-store、media-types（Asset/normalizeAsset/MediaJob/Capability/
 * CapabilityVoiceGroup/Model/ModelParameter）、media-configuration-store、
 * components/asset-reference-picker、canvas-media、lucide-react
 * [OUTPUT]: 对外提供 MediaElementEditor：带「待确认提案」的元素路由到 GenerationProposalEditor（提案审批台：
 * 状态区 + 富文本提示词（@ 引用素材，写入 <reference> 锚点）+ 参考/模型/参数 + 提交前自检 + 确认生成/取消提案；
 * AI 写入的锚定 role 只读展示），其余走 MediaAssetEditor
 * （B.8 媒体元素态，RFC 2026-09-10）：预览区（图片单击打开
 * 素材详情弹框 AssetPreviewDialog；视频/音频 controls）、来源区（AI 生成 / 素材库选择——浮层内可上传 /
 * 本地上传 / 清除）、生成配方区（RECIPE_CAPABILITY 决定生产链路：图片/视频走 image/video.generate，
 * 参数控件由 catalog model.parameters 驱动；音频走 speech.generate，声音来自 capability voices——
 * 云端凭据 + 本机 Audio Studio 预设/角色）、素材历史区
 * （历史即素材：元素上下文 指针历史（换图即记指针），删除资产 + 删除资产 + 重生成）。
 * 适配两类载体：独立媒体元素（kind=media）与 attr 属性元素（kind=attr 且 props.media≠text）
 * [POS]: worlds/[worldID]/canvas/panel 的媒体元素编辑器
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Image as ImageIcon, RefreshCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssetPreviewDialog, mediaContentURL, type PreviewAsset } from "@/components/asset-preview-dialog";
import { AssetReferenceDialog, type MediaPickerKind } from "@/components/asset-reference-picker";
import { ModelPicker } from "@/components/model-picker";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import { normalizeValue, type RichComposerValue } from "@/lib/rich-composer/value";
import { useMediaConfigurationStore } from "@/lib/media-configuration-store";
import { buildGenerationRequest } from "@/lib/media/generation-request";
import { normalizeAsset, type Asset, type Capability, type CapabilityVoiceGroup, type MediaJob, type Model as MediaModel, type ModelParameter } from "@/app/media/media-types";
import { useWorldCanvasStore } from "../canvas-store";
import { isProposalGate, proposalIssues, proposalRoleLabel, readProposal, type GenerationProposal, type ProposalReference } from "../canvas-proposal";
import { fitElementToAsset } from "../canvas-media";
import { useElementAssetHistoryStore } from "./element-asset-history-store";
import { PanelSection } from "@/components/panel-section";

type MediaModality = "image" | "video" | "audio";
// 选择器缺省值共享同一引用：state.histories[elementId] 缺席时 ?? [] 会造新数组，getSnapshot 永不相等 → 无限循环
const EMPTY_HISTORY: string[] = [];
const CONTRIBUTED_LABELS: Record<MediaModality, string> = { image: "图片", video: "视频", audio: "音频" };
// 每种媒体节点对应的生产 capability：音频走平台 speech.generate（云端 provider 与
// 本机 Audio Studio 同一路由），不再误落到 image.generate。
const RECIPE_CAPABILITY: Record<MediaModality, Capability> = { image: "image.generate", video: "video.generate", audio: "speech.generate" };
// 提案提示词的 @ 可引用类型：素材库媒体 + 世界/实体（生成参考锚定）
const PROPOSAL_REF_TYPES = ["media", "creation_entity", "creation_world"];

// 图片素材采纳后卡片自适应比例：统一走 canvas-media 的 fitElementToAsset（media-editor 采纳与
// AttrCreatorPanel 建卡共用同一适配规则）

// 媒体元素编辑器出口：带「待确认提案」的元素路由到提案审批台，其余走常规素材编辑器。
// 提案完成（done）后回落常规编辑器——配方已随 asset.metadata 继承。
type MediaEditorElement = { id: string; kind: string; props?: Record<string, unknown>; name?: string };

export function MediaElementEditor({ element, guided, identity }: { element: MediaEditorElement; guided?: ReactNode; identity?: ReactNode }) {
  const proposal = readProposal(element.props);
  if (proposal && isProposalGate(proposal.status)) {
    return <GenerationProposalEditor element={element} proposal={proposal} />;
  }
  return <MediaAssetEditor element={element} guided={guided} identity={identity} />;
}

function MediaAssetEditor({ element, guided, identity }: { element: MediaEditorElement; guided?: ReactNode; identity?: ReactNode }) {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const setMediaElementAsset = useWorldCanvasStore((state) => state.setMediaElementAsset);
  const setAttrMediaAsset = useWorldCanvasStore((state) => state.setAttrMediaAsset);
  const isAttr = element.kind === "attr";
  const modality = ((isAttr ? element.props?.media : element.props?.modality) ?? "image") as MediaModality;
  const assetId = String(element.props?.assetId ?? "");
  const assetName = String((isAttr ? element.props?.assetName : element.props?.name) ?? "");
  const url = String(element.props?.url ?? "");
  const adopt = (asset: { id: string; name?: string }) => {
    void (isAttr ? setAttrMediaAsset(element.id, { assetId: asset.id, name: asset.name }) : setMediaElementAsset(element.id, { assetId: asset.id, name: asset.name }));
    useElementAssetHistoryStore.getState().record(element.id, asset.id);
    fitElementToAsset(element.id, apiBase, asset.id, modality);
  };

  const currentAssetId = assetId;
  // 当前 asset 的完整详情（含 recipe metadata）——配方继承与预览弹框共用
  const [fetched, setFetched] = useState<Asset | null>(null);
  useEffect(() => {
    if (!assetId) {
      setFetched(null);
      return;
    }
    let active = true;
    void (async () => {
      const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}`, { cache: "no-store" }).catch(() => null);
      if (!active) return;
      setFetched(response?.ok ? normalizeAsset((await response.json()) as Asset) : null);
    })();
    return () => { active = false; };
  }, [apiBase, assetId]);
  const current: PreviewAsset | null = assetId
    ? {
        id: assetId,
        kind: (fetched?.kind ?? modality) as PreviewAsset["kind"],
        name: fetched?.name || assetName || "素材",
        origin: fetched?.origin ?? "",
        status: fetched?.status ?? "completed",
        jobId: fetched?.jobId,
        error: fetched?.error,
        createdAt: fetched?.createdAt ?? "",
        updatedAt: fetched?.updatedAt ?? "",
        metadata: fetched?.metadata ?? {},
      }
    : null;
  const [sourceView, setSourceView] = useState<"none" | "library">("none");
  // 预览区图片单击 → 全局素材详情弹框（AssetPreviewDialog，与实体属性字段 AssetFieldRow 同源）
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <div>
      {/* 预览 + 素材来源合并为一组：图片单击 = 素材详情弹框，下面是「选 / 传 / 清」换素材 */}
      <PanelSection first title="预览">
        <div className="overflow-hidden rounded-md border bg-muted/30">
          {url ? (
            modality === "video" ? <video className="max-h-56 w-full" controls src={url} /> : <img className="max-h-56 w-full bg-muted/40 object-contain" src={url} />
          ) : assetId ? (
            modality === "video" ? (
              <video className="max-h-56 w-full" controls src={mediaContentURL(apiBase, assetId)} />
            ) : (
              <button className="block w-full cursor-zoom-in" onClick={() => setDetailOpen(true)} title="点击查看素材详情" type="button">
                <img className="max-h-56 w-full bg-muted/40 object-contain" src={mediaContentURL(apiBase, assetId)} alt={assetName || "素材"} />
              </button>
            )
          ) : (
            <div className="grid h-28 place-items-center text-xs text-muted-foreground">尚未选择素材</div>
          )}
        </div>
        {assetId && modality !== "video" && <p className="text-[10px] text-muted-foreground">点击图片查看素材详情</p>}
        <div className="grid grid-cols-2 gap-1.5">
          <SourceButton icon={<ImageIcon className="size-3.5" />} label="素材库" onClick={() => setSourceView("library")} />
          <UploadButton modality={modality} onAdopt={adopt} />
          <SourceButton
            icon={<Trash2 className="size-3.5" />}
            label="清除"
            onClick={() => {
              void (isAttr ? setAttrMediaAsset(element.id, null) : setMediaElementAsset(element.id, null));
            }}
          />
        </div>
      </PanelSection>
      {/* 名称：媒体元素只有「名称」是重要的身份信息，独立成组紧接预览 */}
      {identity && <PanelSection title="名称">{identity}</PanelSection>}
      {/* 用 AI 完善（引导动作）——由宿主注入的分组 */}
      {guided}
      {/* 素材历史（默认收起）+ 手动生成（低层逐张生成） */}
      <GenerationHistory apiBase={apiBase} elementId={element.id} modality={modality} currentId={assetId} onAdopt={adopt} />
      <PanelSection title="手动生成">
        <GenerationRecipe apiBase={apiBase} capability={RECIPE_CAPABILITY[modality]} elementId={element.id} current={current} modality={modality} onAdopt={adopt} />
      </PanelSection>
      {sourceView === "library" && (
        <AssetReferenceDialog
          apiBase={apiBase}
          description="选择后以稳定 assetId 引用；也可以在这里直接上传。"
          kinds={[modality] as MediaPickerKind[]}
          onClose={() => setSourceView("none")}
          onPick={(picked) => {
            adopt({ id: picked.id, name: picked.name });
            setSourceView("none");
          }}
          open
          projectID={null}
          selectedIDs={assetId ? [assetId] : []}
          title={`选择${CONTRIBUTED_LABELS[modality]}素材`}
        />
      )}
      {/* 当前 asset 素材详情弹框（预览区图片单击 / 与实体属性字段同一弹框） */}
      {detailOpen && current && <AssetPreviewDialog apiBase={apiBase} asset={current} onClose={() => setDetailOpen(false)} />}
    </div>
  );
}

// 生成提案审批台（视频等高价媒体）：AI/用户提交 proposal 后，用户在此核对富文本提示词（@ 引用素材）、
// 参考、模型与参数，过自检后点「确认生成」——这是唯一触发真实生成、花钱的动作。
function GenerationProposalEditor({ element, proposal }: { element: MediaEditorElement; proposal: GenerationProposal }) {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const updateProposal = useWorldCanvasStore((state) => state.updateProposal);
  const confirmProposal = useWorldCanvasStore((state) => state.confirmProposal);
  const rejectProposal = useWorldCanvasStore((state) => state.rejectProposal);
  const configuration = useMediaConfigurationStore();
  const modality = ((element.props?.media ?? element.props?.modality ?? "video") as MediaModality);
  const capability = RECIPE_CAPABILITY[modality];
  const registry = useMemo(() => contextProtocolRegistry(), []);
  const [promptValue, setPromptValue] = useState<RichComposerValue>(() => normalizeValue(proposal.prompt, registry));
  const [resolved, setResolved] = useState<Record<string, { kind?: string; name?: string }>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  // 富文本提示词的未提交改动：去抖落盘 + 卸载兜底 + 确认前 flush
  const promptDirtyRef = useRef(false);
  const promptValueRef = useRef(promptValue);
  promptValueRef.current = promptValue;

  // 切换所选元素时用最新提案重置编辑器（避免沿用上一个节点的输入）
  useEffect(() => {
    const stored = readProposal(useWorldCanvasStore.getState().elements.find((item) => item.id === element.id)?.props);
    setPromptValue(normalizeValue(stored?.prompt ?? "", registry));
    promptDirtyRef.current = false;
  }, [element.id, registry]);
  useEffect(() => {
    void configuration.load(apiBase);
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 提示词补丁：写回富文本正文，并把正文里 @ 引用的媒体并入 references（否则该图不会随请求发送）
  const promptPatch = (): Partial<GenerationProposal> => {
    const value = promptValueRef.current;
    const current = readProposal(useWorldCanvasStore.getState().elements.find((item) => item.id === element.id)?.props) ?? proposal;
    const known = new Set(current.references.map((reference) => reference.id));
    const mentioned = value.refs
      .filter((ref) => ref.type === "media" && ref.attrs.assetid && !known.has(ref.attrs.assetid))
      .map((ref) => ({ id: ref.attrs.assetid, ...(ref.attrs.type ? { kind: ref.attrs.type } : {}), ...(ref.attrs.name ? { name: ref.attrs.name, label: ref.attrs.name } : {}) }));
    return { prompt: value.text, ...(mentioned.length ? { references: [...current.references, ...mentioned] } : {}) };
  };
  const commitPrompt = async () => {
    if (!promptDirtyRef.current) return;
    promptDirtyRef.current = false;
    await updateProposal(element.id, promptPatch());
  };
  // 去抖落盘：停止输入 800ms 后写回提案
  useEffect(() => {
    if (!promptDirtyRef.current) return;
    const timer = setTimeout(() => { void commitPrompt(); }, 800);
    return () => clearTimeout(timer);
  }, [promptValue.text]); // eslint-disable-line react-hooks/exhaustive-deps
  // 卸载兜底：切换选中/关闭面板时 flush 最后一次编辑
  useEffect(() => {
    return () => {
      if (!promptDirtyRef.current) return;
      promptDirtyRef.current = false;
      void useWorldCanvasStore.getState().updateProposal(element.id, promptPatch());
    };
  }, [element.id]);

  const models = configuration.providers.flatMap((provider) => provider.models).filter((model) => model.capability === capability && model.available);
  const selectedModel = models.find((model) => model.id === proposal.modelId) ?? models[0];
  const credential = configuration.credentials.find((item) => item.provider === selectedModel?.provider);
  const keyless = selectedModel?.provider === "local-audio";
  const draft: GenerationProposal = { ...proposal, prompt: promptValue.text };
  const issues = proposalIssues(draft);
  const canConfirm = !readOnly && Boolean(selectedModel) && (keyless || Boolean(credential)) && !issues.some((issue) => issue.level === "error") && proposal.status !== "generating";

  // 模型缺省对齐：提案未带 modelId/credentialId 时按可用模型补全（不改用户已选项）
  useEffect(() => {
    if (!selectedModel) return;
    const expectedCredential = keyless ? undefined : credential?.id;
    if ((proposal.modelId ?? "") !== selectedModel.id || (proposal.credentialId ?? "") !== (expectedCredential ?? "")) {
      void updateProposal(element.id, { modelId: selectedModel.id, credentialId: expectedCredential });
    }
  }, [selectedModel?.id, credential?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 参考素材 kind 缺失（AI 可能只给了 assetId）：懒补 kind/name 仅用于渲染，不回写提案
  const missingRefIds = proposal.references.filter((reference) => !reference.kind && !resolved[reference.id]).map((reference) => reference.id).join(",");
  useEffect(() => {
    if (!missingRefIds) return;
    let active = true;
    for (const id of missingRefIds.split(",")) {
      void (async () => {
        const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
        if (!active || !response?.ok) return;
        const asset = normalizeAsset((await response.json()) as Asset);
        setResolved((prev) => ({ ...prev, [id]: { kind: asset.kind, name: asset.name } }));
      })();
    }
    return () => { active = false; };
  }, [apiBase, missingRefIds]);

  const referenceKind = (reference: ProposalReference) => reference.kind ?? resolved[reference.id]?.kind ?? "image";
  const removeReference = (id: string) =>
    void updateProposal(element.id, { references: proposal.references.filter((reference) => reference.id !== id) });

  return (
    <div className="space-y-4">
      {/* A. 状态区 */}
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-amber-500">生成提案 · {proposal.status === "generating" ? "生成中" : proposal.status === "failed" ? "生成失败" : "待确认"}</p>
          {proposal.proposedBy === "agent" && <span className="text-[10px] text-muted-foreground">来自 AI</span>}
        </div>
        {proposal.note && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{proposal.note}</p>}
        {proposal.status === "generating" && (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-primary"><RefreshCcw className="size-3 animate-spin" /> 已提交生成，完成后自动就绪…</p>
        )}
        {proposal.status === "failed" && proposal.error && <p className="mt-1 text-[10px] text-destructive">{proposal.error}</p>}
      </div>
      {/* B. 提示词（富文本：@ 引用具体素材，写入 <reference> 锚点） */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">提示词</p>
        <div className="rounded-md border bg-background p-2 focus-within:border-primary">
          <RichComposer
            apiBase={apiBase}
            allowedRefTypes={PROPOSAL_REF_TYPES}
            maxRows={10}
            minRows={4}
            mode="referencing"
            onChange={(value) => { promptDirtyRef.current = true; setPromptValue(value); }}
            placeholder="输入视频提示词，输入 @ 可引用具体素材…"
            readOnly={readOnly || proposal.status === "generating"}
            value={promptValue}
            variant="field"
          />
        </div>
        <p className="text-[10px] text-muted-foreground">@ 可引用素材库的图片 / 视频，或世界里的实体作为生成参考。</p>
      </div>
      {/* C. 参考素材（含 role） */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">参考素材{proposal.references.length ? `（${proposal.references.length}）` : ""}</p>
        <div className="space-y-1.5">
          {proposal.references.map((reference) => {
            const kind = referenceKind(reference);
            return (
              <div className="flex items-center gap-2 rounded-md border p-1.5" key={reference.id}>
                <div className="size-10 shrink-0 overflow-hidden rounded border bg-muted/40">
                  {kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={reference.name ?? reference.label ?? ""} className="size-full object-cover" src={mediaContentURL(apiBase, reference.id)} />
                  ) : kind === "video" ? (
                    <video className="size-full object-cover" muted src={mediaContentURL(apiBase, reference.id)} />
                  ) : (
                    <div className="grid size-full place-items-center text-sm">🎵</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px]">{reference.label || reference.name || resolved[reference.id]?.name || reference.id}</p>
                  {reference.role && <p className="mt-0.5 text-[10px] text-muted-foreground">锚定：{proposalRoleLabel(reference.role)}</p>}
                </div>
                {!readOnly && (
                  <button aria-label="移除参考" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => removeReference(reference.id)} type="button">
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {!proposal.references.length && <p className="text-[10px] text-muted-foreground">没有参考素材。可添加人物形象、场景、色卡等锚定。</p>}
        </div>
        {!readOnly && (
          <button className="grid h-8 w-full place-items-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted" onClick={() => setPickerOpen(true)} type="button">
            ＋ 添加参考素材
          </button>
        )}
      </div>
      {/* D. 模型与参数 */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">生成模型</p>
        {models.length && selectedModel ? (
          <ModelPicker
            credentialConnected={(providerID) => providerID === "local-audio" || configuration.credentials.some((item) => item.provider === providerID)}
            id={`canvas-proposal-${element.id}`}
            models={models}
            onChange={(modelId) => void updateProposal(element.id, { modelId })}
            providerName={(providerID) => configuration.providers.find((item) => item.id === providerID)?.name ?? providerID}
            value={selectedModel.id}
          />
        ) : (
          <p className="rounded-md bg-muted/50 px-2 py-2 text-[11px] text-muted-foreground">还没有可用的生成模型，请先在设置中连接 Provider。</p>
        )}
        {selectedModel && <RecipeParameters parameters={selectedModel.parameters ?? []} values={proposal.params ?? {}} onChange={(name, value) => void updateProposal(element.id, { params: { ...(proposal.params ?? {}), [name]: value } })} />}
      </div>
      {/* E. 提交前自检 */}
      {issues.length > 0 && (
        <ul className="space-y-0.5 rounded-md bg-muted/50 p-2 text-[10px]">
          {issues.map((issue, index) => (
            <li className={issue.level === "error" ? "text-destructive" : "text-muted-foreground"} key={index}>
              {issue.level === "error" ? "✕" : "·"} {issue.message}
            </li>
          ))}
        </ul>
      )}
      {/* F. 动作 */}
      {!readOnly && (
        <div className="flex gap-1.5">
          <button
            className="h-9 flex-1 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={!canConfirm}
            onClick={() => void (async () => { await commitPrompt(); await confirmProposal(element.id); })()}
            type="button"
          >
            {proposal.status === "generating" ? "生成中…" : proposal.status === "failed" ? "重新生成" : "确认生成"}
          </button>
          <button className="h-9 rounded-md border px-3 text-xs hover:bg-muted" onClick={() => void rejectProposal(element.id)} type="button">
            取消提案
          </button>
        </div>
      )}
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
            const existing = new Set(proposal.references.map((reference) => reference.id));
            void updateProposal(element.id, {
              references: [...proposal.references, ...picked.filter((asset) => !existing.has(asset.id)).map((asset) => ({ id: asset.id, kind: asset.kind, name: asset.name, label: asset.name }))],
            });
            setPickerOpen(false);
          }}
          open
          projectID={null}
          selectedIDs={proposal.references.map((reference) => reference.id)}
          title="选择参考素材"
        />
      )}
    </div>
  );
}

function SourceButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      className={`flex h-8 items-center justify-center gap-1.5 rounded-md border text-xs hover:bg-muted ${active ? "border-primary bg-primary/10 text-primary" : ""}`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

// 本地上传：POST /v1/media/assets multipart（沿用素材库上传校验），成功即采纳并进历史
function UploadButton({ modality, onAdopt }: { modality: MediaModality; onAdopt: (asset: { id: string; name?: string }) => void }) {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const toast = useWorldCanvasStore((state) => state.toast);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const upload = async (files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith(`${modality}/`)) {
        toast(`仅支持${CONTRIBUTED_LABELS[modality]}文件`, "error");
        continue;
      }
      setBusy(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`${apiBase}/v1/media/assets`, { method: "POST", body: form });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? "上传失败，请重试");
        }
        const asset = normalizeAsset((await response.json()) as Asset);
        onAdopt({ id: asset.id, name: asset.name });
      } catch (cause) {
        toast(cause instanceof Error ? cause.message : "上传失败，请重试", "error");
      } finally {
        setBusy(false);
      }
    }
  };
  return (
    <>
      <SourceButton icon={<Upload className="size-3.5" />} label={busy ? "上传中…" : "本地上传"} onClick={() => inputRef.current?.click()} />
      <input
        className="hidden"
        ref={inputRef}
        type="file"
        accept={`${modality}/*`}
        onChange={(event) => {
          event.target.value = "";
          void upload(Array.from(event.target.files ?? []));
        }}
      />
    </>
  );
}

// D. 素材历史（历史即素材）：展开时逐 id 拉取 asset 详情；点缩略图设为当前（指针写回 + 配方继承）；
// 移除历史项 = 仅解除本元素的引用指针，绝不删除底层 asset（素材库跨世界长期保活）
function GenerationHistory({ apiBase, elementId, modality, currentId, onAdopt }: { apiBase: string; elementId: string; modality: MediaModality; currentId: string; onAdopt: (asset: { id: string; name?: string }) => void }) {
  const ids = useElementAssetHistoryStore((state) => state.histories[elementId] ?? EMPTY_HISTORY);
  const removeHistory = useElementAssetHistoryStore((state) => state.remove);
  const [items, setItems] = useState<Record<string, Asset>>({});
  useEffect(() => {
    let active = true;
    for (const id of ids) {
      if (items[id]) continue;
      void (async () => {
        try {
          const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(id)}`, { cache: "no-store" });
          if (!active || !response.ok) return;
          const payload = (await response.json()) as Asset;
          if (!active) return;
          setItems((state) => ({ ...state, [id]: normalizeAsset(payload) }));
        } catch {
          /* 拉取失败的历史项只显示占位 */
        }
      })();
    }
    return () => { active = false; };
  }, [apiBase, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ids.length) return null;
  return (
    <PanelSection defaultOpen={false} title={`素材历史（${ids.length}）`}>
      <div className="grid grid-cols-3 gap-1.5">
        {ids.map((id) => {
            const asset = items[id];
            const kind = asset?.kind ?? modality;
            const ready = asset?.status === "completed";
            return (
              <div className="group/hist relative min-w-0" key={id}>
                <button
                  className={`block w-full overflow-hidden rounded-md border hover:border-primary/60 ${id === currentId ? "border-primary" : ""}`}
                  onClick={() => asset && onAdopt({ id: asset.id, name: asset.name })}
                  title={asset ? `${asset.name} · 设为当前` : "…"}
                  type="button"
                >
                  {ready && kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={asset?.name} className="aspect-square w-full bg-muted/40 object-cover" src={apiBaseAssetURL(apiBase, id)} />
                  ) : ready && kind === "video" ? (
                    <video className="aspect-square w-full bg-muted/40 object-cover" muted src={apiBaseAssetURL(apiBase, id)} />
                  ) : (
                    <div className="grid aspect-square place-items-center bg-muted/40 text-lg">{kind === "video" ? "🎬" : kind === "audio" ? "🎵" : "🖼️"}</div>
                  )}
                </button>
                <button
                  aria-label={`从历史移除 ${asset?.name ?? id}（不删除素材）`}
                  className="absolute right-1 top-1 hidden rounded bg-card/90 p-0.5 text-muted-foreground hover:text-destructive group-hover/hist:block"
                  onClick={() => removeHistory(elementId, id)}
                  title="从历史移除（素材库保留）"
                  type="button"
                >
                  <Trash2 className="size-3" />
                </button>
                {asset?.metadata?.prompt && <p className="mt-0.5 line-clamp-1 px-0.5 text-[9px] text-muted-foreground">{String(asset.metadata.prompt).slice(0, 40)}</p>}
              </div>
            );
          })}
      </div>
    </PanelSection>
  );
}

function apiBaseAssetURL(apiBase: string, id: string): string {
  return mediaContentURL(apiBase, id);
}

// 生成配方表单（RFC 2026-09-10 + schema 驱动）：
// - 图片/视频：模型参数由 catalog `model.parameters` 驱动（动态控件），提交 output；
// - 音频：走平台 speech.generate，声音来自 capability voices（云端凭据 + 本机 Audio Studio
//   预设/角色），提交 output.voiceId；
// 提交 /v1/media/jobs → 轮询 → 自适应采用首个完成的产出；配方常驻并自动回填。
type RecipeReference = { id: string; name?: string; kind?: string };

function GenerationRecipe({ apiBase, capability, elementId, current, modality, onAdopt, focusSignal = 0 }: {
  apiBase: string;
  capability: Capability;
  elementId: string;
  current?: PreviewAsset | null;
  modality: MediaModality;
  onAdopt: (asset: { id: string; name?: string }) => void;
  focusSignal?: number;
}) {
  const configuration = useMediaConfigurationStore();
  const isSpeech = capability === "speech.generate";
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [withCurrentRef, setWithCurrentRef] = useState(true);
  const [references, setReferences] = useState<RecipeReference[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [voiceId, setVoiceId] = useState("");
  const [voiceGroups, setVoiceGroups] = useState<CapabilityVoiceGroup[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const element = useWorldCanvasStore((state) => state.elements.find((item) => item.id === elementId));
  const hasDraft = readProposal(element?.props)?.status === "draft";
  // 配方草稿持久化：editedRef 区分「用户真的改了」与 metadata 程序化回填；draftRef 供卸载兜底 flush
  const editedRef = useRef(false);
  const draftRef = useRef<{ prompt: string; modelId: string; credentialId?: string; params: Record<string, unknown>; references: RecipeReference[] }>({ prompt: "", modelId: "", params: {}, references: [] });

  useEffect(() => {
    void configuration.load(apiBase);
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps
  // 恢复配方草稿（proposal.status="draft"）：关闭面板/刷新后不丢用户输入（视频等高价媒体）
  useEffect(() => {
    const stored = readProposal(useWorldCanvasStore.getState().elements.find((item) => item.id === elementId)?.props);
    if (!stored) return;
    if (stored.prompt) setPrompt(stored.prompt);
    if (stored.modelId) setModelId(stored.modelId);
    if (stored.params && Object.keys(stored.params).length) setParams(stored.params);
    if (stored.references.length) setReferences(stored.references.map((reference) => ({ id: reference.id, ...(reference.kind ? { kind: reference.kind } : {}), ...(reference.name || reference.label ? { name: reference.name ?? reference.label } : {}) })));
  }, [elementId]);
  // 视频：把正在编辑的配方自动落成草稿提案，关闭面板/刷新后不丢输入（进行中的提案不覆盖）
  const draftSignature = JSON.stringify([prompt, modelId, params, references.map((item) => item.id)]);
  useEffect(() => {
    if (capability !== "video.generate" || !editedRef.current) return;
    const timer = setTimeout(() => {
      void useWorldCanvasStore.getState().saveProposalDraft(elementId, {
        prompt: prompt.trim(),
        modelId: modelId || undefined,
        credentialId: credential?.id,
        params: { ...params },
        references: references.map((item) => ({ id: item.id, kind: item.kind, name: item.name, label: item.name })),
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [draftSignature, capability, elementId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 卸载兜底：去抖窗口内关闭面板会丢最后一次编辑，卸载时同步 flush
  useEffect(() => {
    return () => {
      if (capability !== "video.generate" || !editedRef.current) return;
      const payload = draftRef.current;
      void useWorldCanvasStore.getState().saveProposalDraft(elementId, {
        prompt: payload.prompt.trim(),
        modelId: payload.modelId || undefined,
        credentialId: payload.credentialId,
        params: { ...payload.params },
        references: payload.references.map((item) => ({ id: item.id, kind: item.kind, name: item.name, label: item.name })),
      });
    };
  }, [capability, elementId]);
  // 音频：能力级声音分组（本地 provider 一组 + 云端每凭据一组），同时提供 TTS 模型清单
  useEffect(() => {
    if (!isSpeech) return;
    let active = true;
    void (async () => {
      const response = await fetch(`${apiBase}/v1/media/capabilities/speech.generate/voices`, { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      setVoiceGroups((await response.json()) as CapabilityVoiceGroup[]);
    })();
    return () => { active = false; };
  }, [apiBase, isSpeech]);
  // 外部「AI 生成」按钮：配方常驻，只把焦点带回 prompt 输入
  useEffect(() => {
    if (focusSignal > 0) textareaRef.current?.focus();
  }, [focusSignal]);
  const models: MediaModel[] = isSpeech
    ? Array.from(new Map(voiceGroups.flatMap((group) => group.models).map((model) => [model.id, model])).values())
    : configuration.providers.flatMap((provider) => provider.models).filter((model) => model.capability === capability && model.available);
  const selectedModel = models.find((model) => model.id === modelId) ?? models[0];
  const voiceGroup = isSpeech ? voiceGroups.find((group) => group.models.some((model) => model.id === selectedModel?.id)) : undefined;
  const credential = configuration.credentials.find((item) => item.provider === selectedModel?.provider);
  // 本地 provider（Audio Studio）无需凭据：只给 modelId 直连即可
  const keyless = selectedModel?.provider === "local-audio";
  draftRef.current = { prompt, modelId, credentialId: credential?.id, params, references };
  useEffect(() => {
    if (!modelId && models[0]) setModelId(models[0].id);
  }, [modelId, models]);
  // 参数与模型对齐：换模型时丢弃不属于新模型的键，并按 catalog 默认值补全
  useEffect(() => {
    const parameters = selectedModel?.parameters ?? [];
    const allowed = new Set(parameters.map((parameter) => parameter.name));
    setParams((prev) => {
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(prev)) if (allowed.has(key)) next[key] = value;
      for (const parameter of parameters) if (!(parameter.name in next) && parameter.default !== undefined) next[parameter.name] = parameter.default;
      return next;
    });
  }, [selectedModel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const voices = voiceGroup?.voices ?? [];
  const voiceKey = voices.map((voice) => voice.id).join(",");
  useEffect(() => {
    setVoiceId((prev) => (prev && voices.some((voice) => voice.id === prev) ? prev : voices[0]?.id ?? ""));
  }, [voiceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 换图即继承：当前 asset 的完整详情（含 recipe metadata）到位后回填 prompt/模型/参数/参考；
  // 依赖 current 而非 id——id 变更时 metadata 还在异步拉取，等详情到达再回填
  useEffect(() => {
    const metadata = current?.metadata;
    if (!metadata) return;
    // 已存在配方草稿时 metadata 只补空缺，不覆盖用户正在编辑的输入
    const stored = readProposal(useWorldCanvasStore.getState().elements.find((item) => item.id === elementId)?.props);
    if (!stored?.prompt && typeof metadata.prompt === "string" && metadata.prompt) setPrompt(metadata.prompt);
    if (!stored?.modelId && typeof metadata.modelId === "string" && metadata.modelId) setModelId(metadata.modelId);
    const output = metadata.output;
    if (output && typeof output === "object") {
      if (isSpeech) {
        if (typeof (output as Record<string, unknown>).voiceId === "string") setVoiceId((output as Record<string, unknown>).voiceId as string);
      } else if (!stored?.params || !Object.keys(stored.params).length) {
        setParams((prev) => ({ ...prev, ...(output as Record<string, unknown>) }));
      }
    }
    // AI 生成素材：把它用过的参考素材一并显示出来（当前图作为底图另有开关，不重复入列）
    if (Array.isArray(metadata.referenceIds) && !stored?.references.length) {
      const ids = (metadata.referenceIds as unknown[]).filter((id): id is string => typeof id === "string" && id !== current?.id);
      setReferences((prev) => {
        const known = new Map(prev.map((item) => [item.id, item]));
        return ids.map((id) => known.get(id) ?? { id });
      });
    }
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  // 参考素材详情补全：继承来的 referenceIds 只有 id，拉到 kind/name 才能显示缩略图
  const missingRefIds = references.filter((item) => !item.kind).map((item) => item.id).join(",");
  useEffect(() => {
    if (!missingRefIds) return;
    let active = true;
    for (const id of missingRefIds.split(",")) {
      void (async () => {
        const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
        if (!response?.ok) return;
        const asset = normalizeAsset((await response.json()) as Asset);
        if (!active) return;
        setReferences((prev) => prev.map((item) => (item.id === id ? { id, name: asset.name, kind: asset.kind } : item)));
      })();
    }
    return () => { active = false; };
  }, [apiBase, missingRefIds]);
  const referenceIds = Array.from(new Set([
    ...(!isSpeech && current && withCurrentRef ? [current.id] : []),
    ...(isSpeech ? [] : references.filter((item) => item.id !== current?.id).map((item) => item.id)),
  ]));
  const canSubmit = Boolean(selectedModel && prompt.trim() && (keyless || credential));
  const jobRunning = Boolean(job && job.status !== "completed" && job.status !== "failed");
  const submit = async () => {
    if (!canSubmit || jobRunning) return;
    setError("");
    const output: Record<string, unknown> = isSpeech ? (voiceId ? { voiceId } : {}) : { ...params };
    const response = await fetch(`${apiBase}/v1/media/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildGenerationRequest({
        capability,
        modelId: selectedModel!.id,
        credentialId: credential?.id,
        prompt,
        referenceIds,
        output,
      })),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "创建任务失败，请检查 Provider 配置。");
      return;
    }
    const created = (await response.json()) as MediaJob;
    setJob(created);
    void poll(created);
  };
  const poll = async (created: MediaJob) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const response = await fetch(`${apiBase}/v1/media/jobs/${encodeURIComponent(created.id)}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) continue;
      const next = (await response.json()) as MediaJob;
      setJob(next);
      if (next.status === "failed") {
        setError(next.error ?? "生成失败，请重试。");
        return;
      }
      if (next.status === "completed") {
        // 多产出（一次生成多张）：先全部入历史，首个完成的自动设为当前
        let firstReady = false;
        for (const assetId of next.assetIds) {
          const assetResponse = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}`, { cache: "no-store" }).catch(() => null);
          const asset = assetResponse?.ok ? normalizeAsset((await assetResponse.json()) as Asset) : null;
          if (!asset || asset.status !== "completed") continue;
          useElementAssetHistoryStore.getState().record(elementId, asset.id);
          if (!firstReady) {
            onAdopt({ id: asset.id, name: asset.name });
            firstReady = true;
          }
        }
        if (!firstReady) setError("生成完成，但未返回可用素材。");
        return;
      }
    }
    setError("生成超时，请稍后在素材库或历史中查看结果。");
  };
  const copyRecipe = async () => {
    const lines = [
      `modelId: ${selectedModel?.id ?? ""}`,
      `prompt: ${prompt.trim()}`,
      isSpeech && voiceId ? `voiceId: ${voiceId}` : "",
      !isSpeech && Object.keys(params).length ? `output: ${JSON.stringify(params)}` : "",
      referenceIds.length ? `referenceIds: [${referenceIds.join(", ")}]` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">生成配方</p>
        {current?.metadata?.prompt && <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => void copyRecipe()} type="button">{copied ? "已复制" : "复制配方"}</button>}
      </div>
      {capability === "video.generate" && hasDraft && (
        <p className="text-[10px] text-muted-foreground">配方已自动保存为草稿，关闭面板后仍保留。</p>
      )}
      {models.length && selectedModel ? (
        <ModelPicker
          credentialConnected={(providerID) => providerID === "local-audio" || configuration.credentials.some((item) => item.provider === providerID)}
          id={`canvas-recipe-${elementId}`}
          models={models}
          onChange={(id) => { editedRef.current = true; setModelId(id); }}
          providerName={(providerID) => configuration.providers.find((item) => item.id === providerID)?.name ?? providerID}
          value={selectedModel.id}
        />
      ) : (
        <p className="rounded-md bg-muted/50 px-2 py-2 text-[11px] text-muted-foreground">还没有可用的生成模型，请先在设置中连接 Provider。</p>
      )}
      <textarea
        className="h-24 w-full resize-none rounded-md border bg-background p-2 text-xs leading-5 outline-none focus:border-primary"
        onChange={(event) => { editedRef.current = true; setPrompt(event.target.value); }}
        placeholder={isSpeech ? "输入需要朗读的文本…" : modality === "video" ? "输入视频提示词…" : "输入画面描述，支持以当前图为底图改写…"}
        ref={textareaRef}
        value={prompt}
      />
      {isSpeech && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">声音</p>
          {voices.length ? (
            <select
              className="w-full rounded-md border bg-background p-2 text-xs outline-none focus:border-primary"
              onChange={(event) => setVoiceId(event.target.value)}
              value={voiceId}
            >
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}{voice.category ? ` · ${voice.category}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[10px] text-muted-foreground">{voiceGroup?.error ? "该声音来源不可用，请检查 Provider 配置。" : "使用默认声音，或先在声音工坊创建角色/预设。"}</p>
          )}
        </div>
      )}
      {!isSpeech && <RecipeParameters parameters={selectedModel?.parameters ?? []} values={params} onChange={(name, value) => { editedRef.current = true; setParams((prev) => ({ ...prev, [name]: value })); }} />}
      {!isSpeech && current && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input checked={withCurrentRef} onChange={(event) => setWithCurrentRef(event.target.checked)} type="checkbox" />
          以当前图为参考底图
        </label>
      )}
      {/* 参考素材：图片 / 视频 / 音频；可素材库选择或本地上传，随配方一起提交（音频走文本，不用参考） */}
      {!isSpeech && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">参考素材{references.filter((item) => item.id !== current?.id).length ? `（${references.filter((item) => item.id !== current?.id).length}）` : ""}</p>
          <div className="flex flex-wrap gap-1.5">
            {references.filter((item) => item.id !== current?.id).map((item) => (
              <div className="group/ref relative size-12 overflow-hidden rounded-md border" key={item.id} title={item.name ?? item.id}>
                {item.kind === "video" ? (
                  <video className="size-full object-cover" muted src={mediaContentURL(apiBase, item.id)} />
                ) : item.kind === "audio" ? (
                  <div className="grid size-full place-items-center bg-muted/40 text-sm">🎵</div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={item.name ?? ""} className="size-full object-cover" src={mediaContentURL(apiBase, item.id)} />
                )}
                <button
                  aria-label={`移除参考 ${item.name ?? item.id}`}
                  className="absolute right-0 top-0 hidden rounded bg-card/90 p-0.5 text-muted-foreground hover:text-destructive group-hover/ref:block"
                  onClick={() => { editedRef.current = true; setReferences((prev) => prev.filter((ref) => ref.id !== item.id)); }}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <button
              className="grid size-12 place-items-center rounded-md border border-dashed text-muted-foreground hover:bg-muted"
              onClick={() => setPickerOpen(true)}
              title="添加参考素材（图片 / 视频 / 音频）"
              type="button"
            >
              ＋
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">支持图片 / 视频 / 音频参考，可素材库选择或本地上传。</p>
        </div>
      )}
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
            editedRef.current = true;
            setReferences((prev) => {
              const known = new Set(prev.map((item) => item.id));
              return [...prev, ...picked.filter((asset) => !known.has(asset.id)).map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind }))];
            });
            setPickerOpen(false);
          }}
          open
          projectID={null}
          selectedIDs={references.map((item) => item.id)}
          title="选择参考素材"
        />
      )}
      <div className="flex gap-1.5">
        <button
          className="h-8 flex-1 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          disabled={!canSubmit || jobRunning}
          onClick={() => void submit()}
          type="button"
        >
          {jobRunning ? "生成中…" : current ? "再生成" : "生成"}
        </button>
      </div>
      {/* 视频成本高：可先存为提案，待确认后再生成（提示词/参考/模型/参数随提案保存） */}
      {capability === "video.generate" && (
        <button
          className="h-8 w-full rounded-md border text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          disabled={!prompt.trim() || !selectedModel || jobRunning}
          onClick={() => {
            void useWorldCanvasStore.getState().createProposal(elementId, {
              status: "pending",
              prompt: prompt.trim(),
              references: [
                ...(withCurrentRef && current ? [{ id: current.id, kind: current.kind, name: current.name, label: current.name }] : []),
                ...references.filter((item) => item.id !== current?.id).map((item) => ({ id: item.id, kind: item.kind, name: item.name, label: item.name })),
              ],
              modelId: selectedModel?.id,
              credentialId: credential?.id,
              params: { ...params },
              proposedBy: "user",
            });
          }}
          type="button"
        >
          存为提案（待确认再生成）
        </button>
      )}
      {jobRunning && (
        <p className="flex items-center gap-1 text-[10px] text-primary">
          <RefreshCcw className="size-3 animate-spin" /> 生成中，完成后自动设为当前…
        </p>
      )}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

// 模型参数控件：由 catalog 的 per-model schema 驱动（bool 勾选 / enum 下拉 / 数值与文本输入），
// 提交时随 output 一起发送，服务端按同一 schema 校验。
function RecipeParameters({ parameters, values, onChange }: { parameters: ModelParameter[]; values: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  if (!parameters.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">生成参数</p>
      {parameters.map((parameter) => (
        <ParameterRow key={parameter.name} parameter={parameter} value={values[parameter.name]} onChange={(value) => onChange(parameter.name, value)} />
      ))}
    </div>
  );
}

function ParameterRow({ parameter, value, onChange }: { parameter: ModelParameter; value: unknown; onChange: (value: unknown) => void }) {
  const label = parameter.label || parameter.name.replace(/_/g, " ");
  const current = value ?? parameter.default;
  if (parameter.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground" title={parameter.description}>
        <span className="truncate">{label}</span>
        <input checked={Boolean(current)} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      </label>
    );
  }
  if (parameter.enum?.length) {
    return (
      <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground" title={parameter.description}>
        <span className="shrink-0 truncate">{label}</span>
        <select
          className="min-w-0 flex-1 rounded-md border bg-background p-1 text-[11px] outline-none focus:border-primary"
          onChange={(event) => onChange(event.target.value)}
          value={String(current ?? "")}
        >
          {parameter.enum.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  const numeric = parameter.type === "integer" || parameter.type === "number";
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground" title={parameter.description}>
      <span className="shrink-0 truncate">{label}</span>
      <input
        className="min-w-0 flex-1 rounded-md border bg-background p-1 text-[11px] outline-none focus:border-primary"
        max={parameter.maximum}
        min={parameter.minimum}
        onChange={(event) => onChange(numeric ? Number(event.target.value) : event.target.value)}
        step={parameter.type === "integer" ? 1 : "any"}
        type={numeric ? "number" : "text"}
        value={current === undefined || current === null ? "" : String(current)}
      />
    </label>
  );
}


