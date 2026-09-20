/*
 * [INPUT]: 依赖 react、canvas-store（apiBase/mediaSource 辅助/setMediaElementAsset/setAttrMediaAsset）、
 * pane./element-asset-history-store、media-types（Asset/normalizeAsset/MediaJob/Capability/
 * CapabilityVoiceGroup/Model/ModelParameter）、media-configuration-store、
 * components/asset-reference-picker、components/audio-waveform-player（统一音频预览）、
 * canvas-media、lucide-react
 * [OUTPUT]: 对外提供 MediaElementEditor：详情完全由全局 asset 状态驱动（proposal 是 asset 的一种状态）——
 * proposed + 配方路由到 GenerationProposalEditor（提案审批台：状态区 + 富文本提示词（@ 引用素材，写入
 * <reference> 锚点）+ 参考/模型/参数 + 提交前自检 + 确认生成；AI 写入的锚定 role 只读展示），
 * proposed + 无配方路由到 PlanElementPanel（计划中 + 复制计划给 AI），其余走 MediaAssetEditor
 * （B.8 媒体元素态，RFC 2026-09-10）：预览区（素材仍在生成时显示等待态并轮询到终态；图片单击打开
 * 素材详情弹框 AssetPreviewDialog；视频 controls；音频复用统一 AudioWaveformPlayer 波形预览）、来源区（AI 生成 / 素材库选择——浮层内可上传 /
 * 本地上传 / 清除）、生成配方区（RECIPE_CAPABILITY 决定生产链路：图片/音频直生，视频落全局提案资产
 * 等用户确认；参数控件由 catalog model.parameters 驱动；音频声音来自 capability voices——
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
import { AudioWaveformPlayer } from "@/components/audio-waveform-player";
import { ModelPicker } from "@/components/model-picker";
import { ProposalEditor, type ProposalModality } from "@/components/proposal-editor";
import { RecipeParameters } from "@/components/recipe-parameters";
import { useMediaConfigurationStore } from "@/lib/media-configuration-store";
import { buildGenerationRequest } from "@/lib/media/generation-request";
import { normalizeAsset, type Asset, type Capability, type CapabilityVoiceGroup, type MediaJob, type Model as MediaModel } from "@/app/media/media-types";
import { useWorldCanvasStore } from "../canvas-store";
import { isPlanAsset, isProposalGate, proposalFromAsset, readProposal, type GenerationProposal } from "../canvas-proposal";
import { ensureCanvasAssetStatus, useCanvasAssetStatusStore } from "../canvas-asset-status";
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

// 图片素材采纳后卡片自适应比例：统一走 canvas-media 的 fitElementToAsset（media-editor 采纳与
// AttrCreatorPanel 建卡共用同一适配规则）

// 媒体元素编辑器出口：带「待确认提案」的元素路由到提案审批台，其余走常规素材编辑器。
// 提案完成（done）后回落常规编辑器——配方已随 asset.metadata 继承。
type MediaEditorElement = { id: string; kind: string; props?: Record<string, unknown>; name?: string };

export function MediaElementEditor({ element, guided, identity }: { element: MediaEditorElement; guided?: ReactNode; identity?: ReactNode }) {
  // 提案真源是全局资产：已绑定 assetId 时从资产读 proposal（订阅资产缓存，状态变化即重建）；
  // 旧画布（无 assetId）回退元素 props.proposal。
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const assetId = String(element.props?.assetId ?? "");
  const asset = useCanvasAssetStatusStore((state) => (assetId ? state.assets[assetId] : undefined));
  // 详情完全由全局 asset 状态驱动（proposal 只是 asset 的一种状态）：
  // proposed + 配方 → 提案审批台（确认生成）；proposed + 无配方 → 计划态（复制计划给 AI）；其余走常规编辑器。
  useEffect(() => {
    if (assetId) ensureCanvasAssetStatus(apiBase, assetId);
  }, [apiBase, assetId]);
  const proposal = (asset ? proposalFromAsset(asset) : null) ?? readProposal(element.props);
  if (proposal && isProposalGate(proposal.status)) {
    return <GenerationProposalEditor element={element} proposal={proposal} />;
  }
  if (assetId && asset && isPlanAsset(asset)) {
    return <PlanElementPanel asset={asset} guided={guided} identity={identity} />;
  }
  return <MediaAssetEditor element={element} guided={guided} identity={identity} />;
}

// 计划态面板（proposed 但无生成配方，content-first 占位素材）：只读展示 + 把计划交给 AI 去生成。
// 不提供「再生成 / 存为提案」——提案是 asset 的状态，等 AI 补配方后本面板自动切到确认生成。
function PlanElementPanel({ asset, guided, identity }: { asset: Asset; guided?: ReactNode; identity?: ReactNode }) {
  const toast = useWorldCanvasStore((state) => state.toast);
  const content = typeof asset.metadata?.content === "string" ? asset.metadata.content : "";
  const copyPlan = async () => {
    const text = [asset.name, content].filter((line) => line && line.trim()).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("计划已复制，可粘贴给 AI 生成", "success");
    } catch {
      toast("复制失败，请手动选择文本", "error");
    }
  };
  return (
    <div>
      <PanelSection first title="状态">
        <div className="space-y-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-2.5">
          <p className="text-[11px] font-medium text-sky-600">生成计划 · 计划中</p>
          <p className="text-[11px] leading-4 text-muted-foreground">这是一条生成计划（只有说明与属性，还没有生成配方）；复制计划交给 AI 生成。</p>
          {content && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-foreground">{content}</p>}
          <button className="h-8 w-full rounded-md border text-xs hover:bg-muted" onClick={() => void copyPlan()} type="button">
            复制计划给 AI
          </button>
        </div>
      </PanelSection>
      {identity && <PanelSection title="名称">{identity}</PanelSection>}
      {guided}
    </div>
  );
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
  // AI 先落 assetId（素材仍在生成）时轮询到终态：预览区先显示等待态，就绪后自动切到真实图
  useEffect(() => {
    if (!assetId) {
      setFetched(null);
      return;
    }
    let active = true;
    void (async () => {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}`, { cache: "no-store" }).catch(() => null);
        if (!active) return;
        const asset = response?.ok ? normalizeAsset((await response.json()) as Asset) : null;
        if (!active) return;
        setFetched(asset);
        if (!asset || asset.status === "completed" || asset.status === "failed") return;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (!active) return;
      }
    })();
    return () => { active = false; };
  }, [apiBase, assetId]);
  // 素材生成态：queued/running = 生成中，failed = 失败，其余（含未知/无 asset）按就绪渲染
  const assetState: "generating" | "ready" | "failed" =
    !assetId ? "ready" : fetched?.status === "failed" ? "failed" : fetched?.status === "running" || fetched?.status === "queued" ? "generating" : "ready";
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
  // 音频统一走 AudioWaveformPlayer：有源（url 或 assetId）且已就绪时就地播放，不再渲染成图片
  const audioSrc = modality === "audio" ? url || (assetId ? mediaContentURL(apiBase, assetId) : "") : "";
  const showAudioPlayer = assetState === "ready" && Boolean(audioSrc);
  return (
    <div>
      {/* 预览 + 素材来源合并为一组：图片单击 = 素材详情弹框，下面是「选 / 传 / 清」换素材 */}
      <PanelSection first title="预览">
        <div className={showAudioPlayer ? "rounded-md" : "overflow-hidden rounded-md border bg-muted/30"}>
          {assetState === "generating" ? (
            <div className="grid h-28 place-items-center gap-1 text-xs text-muted-foreground">
              <RefreshCcw className="size-4 animate-spin" />
              <span>生成中…完成后自动显示</span>
            </div>
          ) : assetState === "failed" ? (
            <div className="grid h-28 place-items-center px-3 text-center text-xs text-destructive">生成失败{fetched?.error ? `：${fetched.error}` : "，可在下方重新生成"}</div>
          ) : showAudioPlayer ? (
            // 音频：与素材详情弹框同一「统一音频预览」（AudioWaveformPlayer 波形 + 播放控制）
            <AudioWaveformPlayer name={assetName || fetched?.name || "音频素材"} src={audioSrc} />
          ) : url ? (
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
        {assetId && modality === "image" && <p className="text-[10px] text-muted-foreground">点击图片查看素材详情</p>}
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

// 生成提案审批台（视频等高价媒体）：与素材详情弹框同构，复用共享 ProposalEditor；
// 画布侧把 onChange/onConfirm 接到元素 store（写回元素/绑定的全局资产提案）。提案状态不可取消。
function GenerationProposalEditor({ element, proposal }: { element: MediaEditorElement; proposal: GenerationProposal }) {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const updateProposal = useWorldCanvasStore((state) => state.updateProposal);
  const confirmProposal = useWorldCanvasStore((state) => state.confirmProposal);
  const modality = ((element.props?.media ?? element.props?.modality ?? "video") as ProposalModality);
  return (
    <ProposalEditor
      apiBase={apiBase}
      editorKey={element.id}
      modality={modality}
      onChange={(patch) => updateProposal(element.id, patch)}
      onConfirm={() => confirmProposal(element.id)}
      proposal={proposal}
      readOnly={readOnly}
    />
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
  // editedRef 区分「用户真的改了」与 metadata 程序化回填：用户编辑后不再被回填覆盖。
  const editedRef = useRef(false);

  useEffect(() => {
    void configuration.load(apiBase);
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const voices = (voiceGroup?.voices ?? []).filter((voice) => !voice.modelId || voice.modelId === selectedModel?.id);
  const voiceKey = voices.map((voice) => voice.id).join(",");
  useEffect(() => {
    setVoiceId((prev) => (prev && voices.some((voice) => voice.id === prev) ? prev : voices[0]?.id ?? ""));
  }, [voiceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 换图即继承：当前 asset 的完整详情（含 recipe metadata）到位后回填 prompt/模型/参数/参考；
  // 依赖 current 而非 id——id 变更时 metadata 还在异步拉取，等详情到达再回填
  useEffect(() => {
    const metadata = current?.metadata;
    // 用户已经开始编辑配方后，metadata 回填不再覆盖其输入
    if (!metadata || editedRef.current) return;
    if (typeof metadata.prompt === "string" && metadata.prompt) setPrompt(metadata.prompt);
    if (typeof metadata.modelId === "string" && metadata.modelId) setModelId(metadata.modelId);
    const output = metadata.output;
    if (output && typeof output === "object") {
      if (isSpeech) {
        if (typeof (output as Record<string, unknown>).voiceId === "string") setVoiceId((output as Record<string, unknown>).voiceId as string);
      } else {
        setParams((prev) => ({ ...prev, ...(output as Record<string, unknown>) }));
      }
    }
    // AI 生成素材：把它用过的参考素材一并显示出来（当前图作为底图另有开关，不重复入列）
    if (Array.isArray(metadata.referenceIds)) {
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
    // 视频（高价）：先落全局提案资产（status=proposed），面板据 asset 状态切到「确认生成」。
    // proposal 是 asset 的一种状态，画布不再有私有的「存为提案」通道。
    if (capability === "video.generate") {
      await useWorldCanvasStore.getState().createProposal(elementId, {
        status: "pending",
        prompt: prompt.trim(),
        references: [
          ...(current && withCurrentRef ? [{ id: current.id, kind: current.kind, name: current.name, label: current.name }] : []),
          ...references.filter((item) => item.id !== current?.id).map((item) => ({ id: item.id, kind: item.kind, name: item.name, label: item.name })),
        ],
        modelId: selectedModel?.id,
        credentialId: credential?.id,
        params: { ...params },
        proposedBy: "user",
      });
      return;
    }
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
          {/* 视频高价：提交即落全局提案资产，面板随后切到「确认生成」；图片/音频直生 */}
          {jobRunning ? "生成中…" : capability === "video.generate" ? (current ? "再生成提案" : "生成视频提案") : current ? "再生成" : "生成"}
        </button>
      </div>
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
