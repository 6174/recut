/*
 * [INPUT]: 依赖 media-types（Asset/normalizeAsset/Capability/ModelParameter）、lib/media/proposal（GenerationProposal/ProposalReference/proposalIssues/proposalRoleLabel）、
 *   media-configuration-store、model-picker、rich-composer、asset-reference-picker、recipe-parameters、lucide-react。
 * [OUTPUT]: 对外提供 ProposalEditor——生成提案审批台的唯一实现：状态区 + 富文本提示词（@ 引用素材，并入 references）+
 *   参考素材（缩略图/锚定 role/增删）+ 生成模型与参数 + 提交前自检 + 确认生成（提案状态不可取消）。
 * [POS]: web/components 的提案编辑同构层；World 画布媒体节点与素材详情弹框共用同一实现，差异只在宿主：宿主注入
 *   onChange/onConfirm（画布写元素 store，弹框写全局 asset 提案 HTTP）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { RefreshCcw, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AssetReferenceDialog, type MediaPickerKind } from "@/components/asset-reference-picker";
import { ModelPicker } from "@/components/model-picker";
import { RecipeParameters } from "@/components/recipe-parameters";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import { mediaContextPayload } from "@/components/agent-panel-types";
import type { MediaEventAsset } from "@/components/use-media-asset-events";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import type { ContextOption } from "@/lib/context-catalog/types";
import { useMediaConfigurationStore } from "@/lib/media-configuration-store";
import { normalizeValue, type RichComposerValue } from "@/lib/rich-composer/value";
import { proposalIssues, proposalRoleLabel, type GenerationProposal, type ProposalReference } from "@/lib/media/proposal";
import { normalizeAsset, type Asset, type Capability } from "@/app/media/media-types";

export type ProposalModality = "image" | "video" | "audio";

// 每种媒体节点对应的生产 capability：音频走平台 speech.generate，不再误落到 image.generate。
const RECIPE_CAPABILITY: Record<ProposalModality, Capability> = { image: "image.generate", video: "video.generate", audio: "speech.generate" };
// 提案提示词的 @ 引用面与全局一致：素材库媒体 + 世界/实体（生成参考锚定）。

function assetContentURL(apiBase: string, assetID: string) {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}/content`;
}

export function ProposalEditor({
  apiBase,
  modality,
  proposal,
  editorKey,
  readOnly = false,
  onChange,
  onConfirm,
}: {
  apiBase: string;
  modality: ProposalModality;
  proposal: GenerationProposal;
  /** 宿主内该提案的稳定标识（画布元素 id / 资产 id）；切换时重置本地编辑态。 */
  editorKey: string;
  readOnly?: boolean;
  onChange: (patch: Partial<GenerationProposal>) => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
}) {
  const configuration = useMediaConfigurationStore();
  const capability = RECIPE_CAPABILITY[modality];
  const registry = useMemo(() => contextProtocolRegistry(), []);
  const reactID = useId();
  const [promptValue, setPromptValue] = useState<RichComposerValue>(() => normalizeValue(proposal.prompt, registry));
  const [resolved, setResolved] = useState<Record<string, { kind?: string; name?: string }>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 富文本提示词的未提交改动：去抖落盘 + 卸载兜底 + 确认前 flush。
  const promptDirtyRef = useRef(false);
  const promptValueRef = useRef(promptValue);
  promptValueRef.current = promptValue;
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 切换提案时用最新内容重置编辑器（避免沿用上一个节点/资产的输入）。
  useEffect(() => {
    setPromptValue(normalizeValue(proposal.prompt ?? "", registry));
    promptDirtyRef.current = false;
  }, [editorKey, registry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void configuration.load(apiBase);
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 提示词补丁：写回富文本正文，并把正文里 @ 引用的媒体并入 references（否则该图不会随请求发送）。
  const promptPatch = (): Partial<GenerationProposal> => {
    const value = promptValueRef.current;
    const current = proposalRef.current;
    const known = new Set(current.references.map((reference) => reference.id));
    const mentioned = value.refs
      .filter((ref) => ref.type === "media" && ref.attrs.assetid && !known.has(ref.attrs.assetid))
      .map((ref) => ({ id: ref.attrs.assetid, ...(ref.attrs.type ? { kind: ref.attrs.type } : {}), ...(ref.attrs.name ? { name: ref.attrs.name, label: ref.attrs.name } : {}) }));
    return { prompt: value.text, ...(mentioned.length ? { references: [...current.references, ...mentioned] } : {}) };
  };
  const commitPrompt = async () => {
    if (!promptDirtyRef.current) return;
    promptDirtyRef.current = false;
    await onChangeRef.current(promptPatch());
  };
  // 去抖落盘：停止输入 800ms 后写回提案。
  useEffect(() => {
    if (!promptDirtyRef.current) return;
    const timer = setTimeout(() => { void commitPrompt(); }, 800);
    return () => clearTimeout(timer);
  }, [promptValue.text]); // eslint-disable-line react-hooks/exhaustive-deps
  // 卸载兜底：切换选中/关闭面板时 flush 最后一次编辑。
  useEffect(() => {
    return () => {
      if (!promptDirtyRef.current) return;
      promptDirtyRef.current = false;
      void onChangeRef.current(promptPatch());
    };
  }, [editorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const models = configuration.providers.flatMap((provider) => provider.models).filter((model) => model.capability === capability && model.available);
  const selectedModel = models.find((model) => model.id === proposal.modelId) ?? models[0];
  const credential = configuration.credentials.find((item) => item.provider === selectedModel?.provider);
  const keyless = selectedModel?.provider === "local-audio";
  const draft: GenerationProposal = { ...proposal, prompt: promptValue.text };
  const issues = proposalIssues(draft);
  const canConfirm = !readOnly && Boolean(selectedModel) && (keyless || Boolean(credential)) && !issues.some((issue) => issue.level === "error") && proposal.status !== "generating";

  // 模型缺省对齐：提案未带 modelId/credentialId 时按可用模型补全（不改用户已选项）。
  useEffect(() => {
    if (!selectedModel) return;
    const expectedCredential = keyless ? undefined : credential?.id;
    if ((proposal.modelId ?? "") !== selectedModel.id || (proposal.credentialId ?? "") !== (expectedCredential ?? "")) {
      void onChangeRef.current({ modelId: selectedModel.id, credentialId: expectedCredential });
    }
  }, [selectedModel?.id, credential?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 参考素材 kind 缺失（AI 可能只给了 assetId）：懒补 kind/name 仅用于渲染，不回写提案。
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
  // 已引用的参考素材置顶到 @ 面板「当前引用」组：生图/生视频时可直接再次 @。
  const pinnedOptions = useMemo<ContextOption[]>(
    () =>
      proposal.references.map((reference) => {
        const kind = referenceKind(reference);
        const name = reference.label || reference.name || resolved[reference.id]?.name || reference.id;
        const asset: MediaEventAsset = {
          id: reference.id,
          kind: (kind === "video" ? "video" : kind === "audio" ? "audio" : "image"),
          mimeType: "",
          name,
          origin: "参考素材",
          status: "completed",
          projectIds: [],
          createdAt: "",
          updatedAt: "",
          metadata: {},
        };
        return {
          key: `media:${reference.id}`,
          sourceType: "media",
          group: "media",
          subKind: asset.kind,
          title: name,
          subtitle: kind,
          badges: [{ key: "ref", label: "参考", tone: "muted" }],
          data: asset,
          context: mediaContextPayload(reference.id),
          score: 0,
        };
      }),
    [proposal.references, resolved], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const removeReference = (id: string) =>
    void onChange({ references: proposal.references.filter((reference) => reference.id !== id) });

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
            maxRows={10}
            minRows={4}
            mode="referencing"
            onChange={(value) => { promptDirtyRef.current = true; setPromptValue(value); }}
            pinnedOptions={pinnedOptions}
            placeholder="输入生成提示词，输入 @ 可引用具体素材…"
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
                    <img alt={reference.name ?? reference.label ?? ""} className="size-full object-cover" src={assetContentURL(apiBase, reference.id)} />
                  ) : kind === "video" ? (
                    <video className="size-full object-cover" muted src={assetContentURL(apiBase, reference.id)} />
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
            id={`proposal-${reactID}`}
            models={models}
            onChange={(modelId) => void onChange({ modelId })}
            providerName={(providerID) => configuration.providers.find((item) => item.id === providerID)?.name ?? providerID}
            value={selectedModel.id}
          />
        ) : (
          <p className="rounded-md bg-muted/50 px-2 py-2 text-[11px] text-muted-foreground">还没有可用的生成模型，请先在设置中连接 Provider。</p>
        )}
        {selectedModel && <RecipeParameters parameters={selectedModel.parameters ?? []} values={proposal.params ?? {}} onChange={(name, value) => void onChange({ params: { ...(proposal.params ?? {}), [name]: value } })} />}
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
            disabled={!canConfirm || submitting}
            onClick={() => void (async () => { setSubmitting(true); await commitPrompt(); await onConfirm(); setSubmitting(false); })()}
            type="button"
          >
            {proposal.status === "generating" ? "生成中…" : proposal.status === "failed" ? "重新生成" : "确认生成"}
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
            void onChange({
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
