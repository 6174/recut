/*
 * [INPUT]: 依赖 react、canvas-store（apiBase/mediaSource 辅助/setMediaElementAsset/setAttrMediaAsset）、
 * pane./element-asset-history-store、media-types（Asset/normalizeAsset/MediaJob）、
 * media-configuration-store、components/asset-reference-picker、canvas-media、lucide-react
 * [OUTPUT]: 对外提供 MediaElementEditor（B.8 媒体元素态，RFC 2026-09-10）：预览区（图片/视频/音频 +
 * 大图预览）、来源区（AI 生成 / 素材库选择——浮层内可上传 / 本地上传 / 清除）、生成配方区
 * （prompt+模型+参考底图回填，改后可再生成 / 复制配方，job 轮询自适应采用）、素材历史区
 * （历史即素材：元素上下文 指针历史（换图即记指针），删除资产 + 删除资产 + 重生成）。
 * 适配两类载体：独立媒体元素（kind=media）与 attr 属性元素（kind=attr 且 props.media≠text）
 * [POS]: worlds/[worldID]/canvas/panel 的媒体元素编辑器
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronDown, Image as ImageIcon, RefreshCcw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AssetPreviewDialog, mediaContentURL, type PreviewAsset } from "@/components/asset-preview-dialog";
import { AssetReferenceDialog, type MediaPickerKind } from "@/components/asset-reference-picker";
import { ModelPicker } from "@/components/model-picker";
import { useMediaConfigurationStore } from "@/lib/media-configuration-store";
import { normalizeAsset, type Asset, type MediaJob } from "@/app/media/media-types";
import { useWorldCanvasStore } from "../canvas-store";
import { fitElementToAsset } from "../canvas-media";
import { useElementAssetHistoryStore } from "./element-asset-history-store";

type MediaModality = "image" | "video" | "audio";
// 选择器缺省值共享同一引用：state.histories[elementId] 缺席时 ?? [] 会造新数组，getSnapshot 永不相等 → 无限循环
const EMPTY_HISTORY: string[] = [];
const CONTRIBUTED_LABELS: Record<MediaModality, string> = { image: "图片", video: "视频", audio: "音频" };

// 图片素材采纳后卡片自适应比例：统一走 canvas-media 的 fitElementToAsset（media-editor 采纳与
// AttrCreatorPanel 建卡共用同一适配规则）

export function MediaElementEditor({ element }: { element: { id: string; kind: string; props?: Record<string, unknown>; name?: string } }) {
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
  // 「AI 生成」按钮：配方区常驻，按钮只负责把焦点带回配方输入（不再用显隐切换）
  const [recipeFocus, setRecipeFocus] = useState(0);
  return (
    <div className="space-y-4">
      {/* A. 预览区 */}
      <div className="overflow-hidden rounded-md border bg-muted/30">
        {url ? (
          modality === "video" ? <video className="max-h-56 w-full" controls src={url} /> : <img className="max-h-56 w-full bg-muted/40 object-contain" src={url} />
        ) : assetId ? (
          modality === "video" ? <video className="max-h-56 w-full" controls src={mediaContentURL(apiBase, assetId)} /> : (
            <img className="max-h-56 w-full bg-muted/40 object-contain" src={mediaContentURL(apiBase, assetId)} alt={assetName || "素材"} />
          )
        ) : (
          <div className="grid h-28 place-items-center text-xs text-muted-foreground">尚未选择素材</div>
        )}
      </div>
      {/* B. 来源区 */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">更换素材</p>
        <div className="grid grid-cols-2 gap-1.5">
          <SourceButton icon={<Sparkles className="size-3.5" />} label="AI 生成" onClick={() => setRecipeFocus((n) => n + 1)} />
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
      </div>
      {/* C. 生成配方区（常驻；AI 生成的素材自动回填 prompt/模型/参考）+ D. 素材历史区 */}
      <GenerationHistory apiBase={apiBase} elementId={element.id} modality={modality} currentId={assetId} onAdopt={adopt} />
      <GenerationRecipe apiBase={apiBase} capability={modality === "video" ? "video.generate" : "image.generate"} elementId={element.id} current={current} modality={modality} onAdopt={adopt} focusSignal={recipeFocus} />
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
      {/* 当前 asset 大图预览（配方详情同源复用，复用全局素材弹框） */}
      {current && (
        <CurrentAssetPreview apiBase={apiBase} asset={fetched ? toPreviewAsset(fetched) : null} id={assetId} fallbackName={assetName || "素材"} />
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
// 删除历史项 = 删除该 asset（素材库同源）
function GenerationHistory({ apiBase, elementId, modality, currentId, onAdopt }: { apiBase: string; elementId: string; modality: MediaModality; currentId: string; onAdopt: (asset: { id: string; name?: string }) => void }) {
  const ids = useElementAssetHistoryStore((state) => state.histories[elementId] ?? EMPTY_HISTORY);
  const removeHistory = useElementAssetHistoryStore((state) => state.remove);
  const [items, setItems] = useState<Record<string, Asset>>({});
  const [open, setOpen] = useState(false);
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
    <div>
      <button className="flex w-full items-center justify-between px-1 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} type="button">
        <span>素材历史（{ids.length}）</span>
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid grid-cols-3 gap-1.5 pt-1">
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
                  aria-label={`删除历史素材 ${asset?.name ?? id}`}
                  className="absolute right-1 top-1 hidden rounded bg-card/90 p-0.5 text-muted-foreground hover:text-destructive group-hover/hist:block"
                  onClick={() => {
                    void fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
                    removeHistory(elementId, id);
                  }}
                  type="button"
                >
                  <Trash2 className="size-3" />
                </button>
                {asset?.metadata?.prompt && <p className="mt-0.5 line-clamp-1 px-0.5 text-[9px] text-muted-foreground">{String(asset.metadata.prompt).slice(0, 40)}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function apiBaseAssetURL(apiBase: string, id: string): string {
  return mediaContentURL(apiBase, id);
}

// 生成配方表单：模型（按 capability，取已连接 provider 的凭据）+ prompt + 参考素材
// （当前图可作底图，另可加图片/视频/音频参考）；提交 /v1/media/jobs → 轮询 → 自适应采用
// 首个完成的产出；复制配方（复制 recipe）。配方区常驻，AI 生成素材的 prompt/模型/参考自动回填。
type RecipeReference = { id: string; name?: string; kind?: string };

function GenerationRecipe({ apiBase, capability, elementId, current, modality, onAdopt, focusSignal = 0 }: {
  apiBase: string;
  capability: "image.generate" | "video.generate";
  elementId: string;
  current?: PreviewAsset | null;
  modality: MediaModality;
  onAdopt: (asset: { id: string; name?: string }) => void;
  focusSignal?: number;
}) {
  const configuration = useMediaConfigurationStore();
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [withCurrentRef, setWithCurrentRef] = useState(true);
  const [references, setReferences] = useState<RecipeReference[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void configuration.load(apiBase);
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps
  // 外部「AI 生成」按钮：配方常驻，只把焦点带回 prompt 输入
  useEffect(() => {
    if (focusSignal > 0) textareaRef.current?.focus();
  }, [focusSignal]);
  const models = configuration.providers.flatMap((provider) => provider.models).filter((model) => model.capability === capability && model.available);
  const selectedModel = models.find((model) => model.id === modelId) ?? models[0];
  const credential = configuration.credentials.find((item) => item.provider === selectedModel?.provider);
  useEffect(() => {
    if (!modelId && models[0]) setModelId(models[0].id);
  }, [modelId, models]);
  // 换图即继承：当前 asset 的完整详情（含 recipe metadata）到位后回填 prompt/模型/参考；
  // 依赖 current 而非 id——id 变更时 metadata 还在异步拉取，等详情到达再回填
  useEffect(() => {
    const metadata = current?.metadata;
    if (!metadata) return;
    if (typeof metadata.prompt === "string" && metadata.prompt) setPrompt(metadata.prompt);
    if (typeof metadata.modelId === "string" && metadata.modelId) setModelId(metadata.modelId);
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
    ...(current && withCurrentRef ? [current.id] : []),
    ...references.filter((item) => item.id !== current?.id).map((item) => item.id),
  ]));
  const canSubmit = Boolean(selectedModel && credential && prompt.trim());
  const jobRunning = Boolean(job && job.status !== "completed" && job.status !== "failed");
  const submit = async () => {
    if (!canSubmit || jobRunning) return;
    setError("");
    const response = await fetch(`${apiBase}/v1/media/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability,
        modelId: selectedModel!.id,
        credentialId: credential!.id,
        prompt: prompt.trim(),
        ...(referenceIds.length ? { referenceIds } : {}),
      }),
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
      referenceIds.length ? `referenceIds: [${referenceIds.join(", ")}]` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">生成配方</p>
        {current?.metadata?.prompt && <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => void copyRecipe()} type="button">{copied ? "已复制" : "复制配方"}</button>}
      </div>
      {models.length && selectedModel ? (
        <ModelPicker
          credentialConnected={(providerID) => configuration.credentials.some((item) => item.provider === providerID)}
          id={`canvas-recipe-${elementId}`}
          models={models}
          onChange={setModelId}
          providerName={(providerID) => configuration.providers.find((item) => item.id === providerID)?.name ?? providerID}
          value={selectedModel.id}
        />
      ) : (
        <p className="rounded-md bg-muted/50 px-2 py-2 text-[11px] text-muted-foreground">还没有可用的生成模型，请先在设置中连接 Provider。</p>
      )}
      <textarea
        className="h-24 w-full resize-none rounded-md border bg-background p-2 text-xs leading-5 outline-none focus:border-primary"
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={modality === "video" ? "输入视频提示词…" : "输入画面描述，支持以当前图为底图改写…"}
        ref={textareaRef}
        value={prompt}
      />
      {current && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input checked={withCurrentRef} onChange={(event) => setWithCurrentRef(event.target.checked)} type="checkbox" />
          以当前图为参考底图
        </label>
      )}
      {/* 参考素材：图片 / 视频 / 音频；可素材库选择或本地上传，随配方一起提交 */}
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
                onClick={() => setReferences((prev) => prev.filter((ref) => ref.id !== item.id))}
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
      {jobRunning && (
        <p className="flex items-center gap-1 text-[10px] text-primary">
          <RefreshCcw className="size-3 animate-spin" /> 生成中，完成后自动设为当前…
        </p>
      )}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

function toPreviewAsset(asset: Asset): PreviewAsset {
  return { ...asset, kind: asset.kind as PreviewAsset["kind"] } as PreviewAsset;
}

function CurrentAssetPreview({ apiBase, asset, id, fallbackName }: { apiBase: string; asset: Asset | null; id: string; fallbackName: string }) {
  const [open, setOpen] = useState(false);
  const preview: PreviewAsset = asset
    ? toPreviewAsset(asset)
    : {
        id,
        kind: "image",
        name: fallbackName,
        origin: "",
        status: "completed",
        createdAt: "",
        updatedAt: "",
        metadata: {},
      };
  return (
    <>
      <button className="text-left text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setOpen(true)} type="button">
        查看大图与生成信息
      </button>
      {open && (
        <AssetPreviewDialog apiBase={apiBase} asset={preview} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
