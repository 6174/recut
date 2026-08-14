/*
 * [INPUT]: 依赖 service endpoint、Media Platform 的资产 SSE、media-configuration-store 的 Provider/Credential 快照与生成任务 API，以及系统项目 Agent Session
 * [OUTPUT]: 对外提供首屏限为 12 张的素材浏览、完成视频的 iframe 视频封面卡片、统一 More 重命名/确认删除、运行中实时计时与终态持久化耗时、按 assetId 合并导入/生成结果、主动上传图片/视频/音频、生成详情中的提示词与参考素材展示、生成参数回填再次创建、紧凑 Provider 模型选择及按模型输入契约筛选、上传参考素材的工作区级素材库
 * [POS]: web/app/media 的原生 React 内容组件；由根工作台与 /media 路由共享，在固定工作台高度内独占纵向滚动，Asset 是异步生命周期唯一真相，页面通过一条 Recut SSE 消费状态，配置从统一缓存读取而不轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";
import {
  Captions,
  ChevronDown,
  ImageIcon,
  Music2,
  Plus,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  ClipboardEvent,
  ChangeEvent,
  FormEvent,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { CustomSelect } from "@/components/ui/select-field";
import { MediaAssetEventsProvider, useMediaAssetEvents } from "@/components/use-media-asset-events";
import { useMediaConfigurationStore } from "@/lib/media-configuration-store";
import { useServiceStore } from "@/lib/service-store";
import { AssetGrid } from "./asset-grid";
import { AssetPreview } from "./asset-preview";
import { ReferenceAssetsField } from "./reference-assets-field";
import { normalizeAsset } from "./media-types";
import type {
  Asset,
  AssetKind,
  Capability,
  Credential,
  Filter,
  MediaJob,
  Model,
  ModelInputMode,
  Provider,
  Voice,
} from "./media-types";
type CreateKind = {
  kind: AssetKind;
  capability: Capability;
  label: string;
  icon: typeof ImageIcon;
  prompt: string;
};
type CreateDraft = {
  modelID?: string;
  prompt: string;
  referenceIDs: string[];
  output?: Record<string, unknown>;
};
const filters: { id: Filter; label: string; icon: typeof ImageIcon }[] = [
  { id: "all", label: "全部", icon: ImageIcon },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "video", label: "视频", icon: Video },
  { id: "audio", label: "音频", icon: Music2 },
  { id: "transcript", label: "转写", icon: Captions },
];
const createKinds: CreateKind[] = [
  {
    kind: "image",
    capability: "image.generate",
    label: "创建图片",
    icon: ImageIcon,
    prompt: "描述你想生成的图片…",
  },
  {
    kind: "video",
    capability: "video.generate",
    label: "创建视频",
    icon: Video,
    prompt: "描述你想生成的视频…",
  },
  {
    kind: "audio",
    capability: "speech.generate",
    label: "创建音频",
    icon: Music2,
    prompt: "输入需要生成的语音内容或音频描述…",
  },
];
const referenceLabels: Record<Exclude<AssetKind, "transcript">, string> = { image: "图片", video: "视频", audio: "音频", reference: "资料" };
const initialAssetCount = 12;

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? "操作失败，请重试。";
}

function isReferenceKind(mode: ModelInputMode): mode is Exclude<AssetKind, "transcript"> {
  return mode === "image" || mode === "video" || mode === "audio";
}

type MediaLibraryPanelProps = {
  initialAssetID?: string;
  onOpenProviderSettings: () => void;
  onProjectIDChange: (projectID: string | null) => void;
};

export function MediaLibraryPanel(props: MediaLibraryPanelProps) {
  const apiBase = useServiceStore((state) => state.endpoint);
  return <MediaAssetEventsProvider apiBase={apiBase}><MediaLibraryContent {...props} /></MediaAssetEventsProvider>;
}

function MediaLibraryContent({ initialAssetID, onOpenProviderSettings, onProjectIDChange }: MediaLibraryPanelProps) {
  const apiBase = useServiceStore((state) => state.endpoint);
  const { assetByID, assets: eventAssets, removeAsset, upsertAsset } = useMediaAssetEvents();
  const assets = useMemo(() => eventAssets.map((asset) => normalizeAsset(asset as Asset)), [eventAssets]);
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [assetLimit, setAssetLimit] = useState(initialAssetCount);
  const [preview, setPreview] = useState<Asset | null>(null);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  async function initialize() {
    try {
      const project = await fetch(`${apiBase}/v1/media/system-project`);
      if (!project.ok) throw new Error();
      onProjectIDChange((await project.json()).id);
    } catch {
      onProjectIDChange(null);
    }
  }
  useEffect(() => {
    void initialize();
  }, [apiBase]);
  const deepLinkAsset = initialAssetID ? assetByID[initialAssetID] : null;
  useEffect(() => {
    if (initialAssetID && deepLinkAsset) setPreview(normalizeAsset(deepLinkAsset as Asset));
  }, [initialAssetID, deepLinkAsset]);
  useEffect(() => {
    if (!initialAssetID) return;
    let active = true;
    void fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(initialAssetID)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || !active) return;
        setPreview(normalizeAsset((await response.json()) as Asset));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [apiBase, initialAssetID]);
  const visibleAssets =
    filter === "all" ? assets : assets.filter((asset) => asset.kind === filter);
  const renderedAssets = visibleAssets.slice(0, assetLimit);
  const visibleJobs = jobs.filter(
    (job) =>
      !job.assetIds.some((assetID) => Boolean(assetByID[assetID])) &&
      (filter === "all" ||
        job.capability ===
          createKinds.find((item) => item.kind === filter)?.capability),
  );
  useEffect(() => {
    setAssetLimit(initialAssetCount);
  }, [filter]);
  function openProviderSettings() {
    setCreateKind(null);
    onOpenProviderSettings();
  }
  function openRegeneration(asset: Asset) {
    const capability =
      typeof asset.metadata.capability === "string"
        ? asset.metadata.capability
        : asset.kind === "audio"
          ? "speech.generate"
          : `${asset.kind}.generate`;
    const kind = createKinds.find((item) => item.capability === capability);
    if (!kind || !asset.metadata.prompt) {
      setNotice("该素材没有可复用的生成参数。");
      return;
    }
    setPreview(null);
    setCreateDraft({
      modelID:
        typeof asset.metadata.modelId === "string"
          ? asset.metadata.modelId
          : undefined,
      prompt: asset.metadata.prompt,
      referenceIDs: Array.isArray(asset.metadata.referenceIds)
        ? asset.metadata.referenceIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      output: asset.metadata.output,
    });
    setCreateKind(kind);
  }
  async function hydrateSubmittedAssets(job: MediaJob) {
    await Promise.all(job.assetIds.map(async (assetID) => {
      const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}`, { cache: "no-store" });
      if (response.ok) upsertAsset(await response.json());
    }));
  }
  async function renameAsset(asset: Asset, name: string) {
    const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    upsertAsset(await response.json());
  }
  async function deleteAsset(asset: Asset) {
    const response = await fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await responseMessage(response));
    removeAsset(asset.id);
    if (preview?.id === asset.id) setPreview(null);
  }
  async function uploadAssets(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setNotice("");
    const imported: Asset[] = [];
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`${apiBase}/v1/media/assets`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? `“${file.name}”上传失败，请重试。`);
        }
        imported.push(normalizeAsset((await response.json()) as Asset));
      }
      imported.forEach(upsertAsset);
      setNotice(`已上传 ${imported.length} 个素材。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "素材上传失败，请重试。");
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
        <section className="h-full min-h-0 overflow-y-auto bg-muted/30 p-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 flex items-end justify-between border-b pb-4">
              <div>
                <h1 className="text-2xl font-semibold">媒体资产</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  直接选择模型创建素材，复杂创作也可交给左侧 Agent。
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge>
                  {visibleAssets.length + visibleJobs.length} ASSETS
                </Badge>
                <input
                  accept="image/*,video/*,audio/*"
                  className="hidden"
                  multiple
                  onChange={uploadAssets}
                  ref={uploadInput}
                  type="file"
                />
                <button
                  className="flex h-8 items-center gap-1.5 rounded-xs border px-2.5 text-xs font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                  disabled={uploading}
                  onClick={() => uploadInput.current?.click()}
                  type="button"
                >
                  <Upload className="size-3.5" />
                  {uploading ? "上传中…" : "上传素材"}
                </button>
                <div className="relative">
                  <button
                    aria-expanded={createMenuOpen}
                    aria-haspopup="menu"
                    className="flex h-8 items-center gap-1.5 rounded-xs bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/85"
                    onClick={() => setCreateMenuOpen((value) => !value)}
                    type="button"
                  >
                    <Plus className="size-3.5" />
                    创建
                    <ChevronDown className="size-3" />
                  </button>
                  {createMenuOpen && (
                    <div
                      className="absolute right-0 z-20 mt-1 w-36 rounded-xs border bg-card p-1 shadow-lg"
                      role="menu"
                    >
                      {createKinds.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            className="flex h-8 w-full items-center gap-2 rounded-xs px-2 text-left text-xs hover:bg-muted"
                            key={item.kind}
                            onClick={() => {
                              setCreateMenuOpen(false);
                              setCreateKind(item);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            <Icon className="size-3.5" />
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {notice && (
              <p className="mb-4 text-xs text-muted-foreground">{notice}</p>
            )}
            <nav className="mb-5 flex gap-2">
              {filters.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={`flex h-8 items-center gap-1.5 rounded-xs border px-2.5 text-xs ${filter === item.id ? "bg-secondary font-medium" : "bg-card text-muted-foreground hover:bg-muted"}`}
                    key={item.id}
                    onClick={() => setFilter(item.id)}
                    type="button"
                  >
                    <Icon className="size-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <AssetGrid
              apiBase={apiBase}
              assets={renderedAssets}
              jobs={visibleJobs}
              onDelete={deleteAsset}
              onPreview={setPreview}
              onRename={renameAsset}
            />
            {renderedAssets.length < visibleAssets.length && (
              <div className="mt-5 flex justify-center">
                <button
                  className="h-9 rounded-xs border bg-card px-3 text-xs font-medium hover:bg-muted"
                  onClick={() => setAssetLimit((limit) => limit + initialAssetCount)}
                  type="button"
                >
                  显示更多素材（剩余 {visibleAssets.length - renderedAssets.length}）
                </button>
              </div>
            )}
          </div>
        </section>
      {preview && (
        <AssetPreview
          asset={preview}
          assets={assets}
          onClose={() => setPreview(null)}
          onRegenerate={openRegeneration}
        />
      )}
      {createKind && (
        <CreateAssetDialog
          assets={assets}
          draft={createDraft ?? undefined}
          kind={createKind}
          onAssetImported={upsertAsset}
          onClose={() => {
            setCreateKind(null);
            setCreateDraft(null);
          }}
          onOpenProviderSettings={openProviderSettings}
          onSubmitted={(job) => {
            setJobs((items) => [job, ...items]);
            void hydrateSubmittedAssets(job);
            setNotice(`${createKind.label}任务已提交，素材卡会显示实时用时。`);
          }}
        />
      )}
    </>
  );
}

function CreateAssetDialog({
  assets,
  draft,
  kind,
  onAssetImported,
  onClose,
  onOpenProviderSettings,
  onSubmitted,
}: {
  assets: Asset[];
  draft?: CreateDraft;
  kind: CreateKind;
  onAssetImported: (asset: Asset) => void;
  onClose: () => void;
  onOpenProviderSettings: () => void;
  onSubmitted: (job: MediaJob) => void;
}) {
  const apiBase = useServiceStore((state) => state.endpoint);
  const providers = useMediaConfigurationStore((state) => state.providers);
  const credentials = useMediaConfigurationStore((state) => state.credentials);
  const loadConfiguration = useMediaConfigurationStore((state) => state.load);
  const [modelID, setModelID] = useState(draft?.modelID ?? "");
  const [credentialID, setCredentialID] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceID, setVoiceID] = useState("");
  const [prompt, setPrompt] = useState(draft?.prompt ?? "");
  const [generateAudio, setGenerateAudio] = useState(
    draft?.output?.generateAudio !== false,
  );
  const [referenceIDs, setReferenceIDs] = useState<string[]>(
    draft?.referenceIDs ?? [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void loadConfiguration(apiBase); }, [apiBase, loadConfiguration]);
  const models = providers
    .flatMap((provider) => provider.models)
    .filter((model) => model.capability === kind.capability);
  const selectedModel = models.find((model) => model.id === modelID);
  const connected = models.filter(
    (model) =>
      credentials.some(
        (credential) => credential.provider === model.provider,
      ) && model.available,
  );
  const unavailable = models.filter(
    (model) =>
      !credentials.some((credential) => credential.provider === model.provider),
  );
  const referenceKinds: Exclude<AssetKind, "transcript">[] = selectedModel
    ? selectedModel.inputModes.filter(isReferenceKind)
    : [];
  const supportsGeneratedAudio =
    kind.kind === "video" &&
    Boolean(selectedModel?.outputModes?.includes("generateAudio"));
  const referenceKindKey = referenceKinds.join(",");
  const referenceLabel = referenceKinds.map((item) => referenceLabels[item]).join("、");
  const referenceAssets = assets.filter((asset) =>
    asset.status === "completed" && (referenceKinds as AssetKind[]).includes(asset.kind),
  );
  const selectedReferenceAssets = assets.filter((asset) =>
    referenceIDs.includes(asset.id),
  );
  useEffect(() => {
    if (!modelID && connected[0]) setModelID(connected[0].id);
  }, [modelID, connected]);
  useEffect(() => {
    const credential = credentials.find(
      (item) => item.provider === selectedModel?.provider,
    );
    setCredentialID(credential?.id ?? "");
  }, [selectedModel?.provider, credentials]);
  useEffect(() => {
    if (kind.kind !== "audio" || !credentialID) {
      setVoices([]);
      setVoiceID("");
      return;
    }
    void (async () => {
      setVoices([]);
      setVoiceID("");
      const response = await fetch(`${apiBase}/v1/media/credentials/${credentialID}/voices`);
      if (!response.ok) {
        setError("无法读取该 Provider 的可用音色。");
        return;
      }
      const next = (await response.json()) as Voice[];
      setVoices(next);
      setVoiceID(next[0]?.id ?? "");
    })();
  }, [apiBase, kind.kind, credentialID]);
  useEffect(() => {
    if (!selectedModel) return;
    setReferenceIDs((ids) => {
      const next = ids.filter((id) => {
        const asset = assets.find((item) => item.id === id);
        return asset ? (referenceKinds as AssetKind[]).includes(asset.kind) : false;
      });
      return next.length === ids.length ? ids : next;
    });
  }, [assets, referenceKindKey]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedModel || !credentialID || !prompt.trim() || (kind.kind === "audio" && !voiceID)) return;
    if (selectedReferenceAssets.some((asset) => !(referenceKinds as AssetKind[]).includes(asset.kind))) {
      setError("当前模型不支持已选的参考素材类型，请移除后重试。");
      return;
    }
    const output = { ...draft?.output };
    if (kind.kind === "audio") output.voiceId = voiceID;
    if (supportsGeneratedAudio) output.generateAudio = generateAudio;
    setSubmitting(true);
    setError("");
    const response = await fetch(`${apiBase}/v1/media/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability: kind.capability,
        modelId: selectedModel.id,
        credentialId: credentialID,
        prompt: prompt.trim(),
        referenceIds: referenceIDs,
        output: Object.keys(output).length ? output : undefined,
      }),
    });
    setSubmitting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "创建任务失败，请检查 Provider 配置。");
      return;
    }
    onSubmitted((await response.json()) as MediaJob);
    onClose();
  }
  async function importReference(file: File) {
    if (!referenceKinds.some((item) => file.type.startsWith(`${item}/`))) {
      setError(`当前模型只支持${referenceLabel || "兼容的"}参考素材。`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${apiBase}/v1/media/assets`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "参考素材导入失败，请重试。");
      return;
    }
    const asset = (await response.json()) as Asset;
    setReferenceIDs((ids) =>
      ids.includes(asset.id) ? ids : [...ids, asset.id],
    );
    onAssetImported(asset);
  }
  function pasteReferenceImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!referenceKinds.includes("image")) return;
    const image = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );
    const file = image?.getAsFile();
    if (!file) return;
    event.preventDefault();
    void importReference(file);
  }
  function importReferences(files: File[]) {
    void (async () => {
      for (const file of files) await importReference(file);
    })();
  }
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
    >
      <form
        className="w-full max-w-2xl overflow-hidden rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <p className="text-sm font-semibold">{kind.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              选择已连接 Provider 的模型，输入描述后立即创建。
            </p>
          </div>
          <button
            aria-label="关闭创建弹框"
            className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
          <section>
            {connected.length ? (
              <CustomSelect id="model" label="模型" onChange={setModelID} options={connected.map((model) => ({ value: model.id, label: `${providers.find((provider) => provider.id === model.provider)?.name ?? model.provider} · ${model.name}` }))} value={modelID} />
            ) : (
              <div className="mt-2 rounded-xs border border-dashed p-4 text-xs text-muted-foreground">
                还没有可直接使用的模型。连接一个 Provider 后即可创建。
              </div>
            )}
          </section>
          {unavailable.length > 0 && (
            <section>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">还可连接更多模型</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    添加对应的 Provider 后，它们会出现在上方下拉框。
                  </p>
                </div>
                <button
                  className="h-8 rounded-xs border px-2.5 text-xs hover:bg-muted"
                  onClick={onOpenProviderSettings}
                  type="button"
                >
                  添加 Provider
                </button>
              </div>
            </section>
          )}
          <section>
            <label className="text-xs font-medium" htmlFor="asset-prompt">
              创作描述
            </label>
            <textarea
              className="mt-2 min-h-28 w-full resize-y rounded-xs border bg-background p-3 text-sm outline-none focus:border-primary"
              id="asset-prompt"
              onChange={(event) => setPrompt(event.target.value)}
              onPaste={referenceKinds.includes("image") ? pasteReferenceImage : undefined}
              placeholder={kind.prompt}
              value={prompt}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {referenceKinds.includes("image") ? "可直接粘贴剪贴板中的图片作为参考素材。" : "当前模型不支持图片参考素材。"}
            </p>
          </section>
          {supportsGeneratedAudio && (
            <section className="flex items-center justify-between gap-4 rounded-xs border bg-muted/30 px-3 py-2.5">
              <div>
                <label className="text-xs font-medium" htmlFor="generate-audio">
                  生成同步音频
                </label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Seedance 会根据画面和提示词一并生成声音；默认开启。
                </p>
              </div>
              <input
                checked={generateAudio}
                className="size-4 shrink-0 accent-primary"
                id="generate-audio"
                onChange={(event) => setGenerateAudio(event.target.checked)}
                type="checkbox"
              />
            </section>
          )}
          {referenceKinds.length > 0 && (
            <ReferenceAssetsField
              apiBase={apiBase}
              availableAssets={referenceAssets}
              onReferenceIDsChange={setReferenceIDs}
              onUpload={importReferences}
              referenceIDs={referenceIDs}
              referenceKinds={referenceKinds}
              referenceLabel={referenceLabel}
              selectedAssets={selectedReferenceAssets}
            />
          )}
          {selectedModel &&
            credentials.filter(
              (credential) => credential.provider === selectedModel.provider,
            ).length > 1 && (
              <section><CustomSelect id="credential" label="使用凭据" onChange={setCredentialID} options={credentials.filter((credential) => credential.provider === selectedModel.provider).map((credential) => ({ value: credential.id, label: credential.name }))} value={credentialID} /></section>
            )}
          {kind.kind === "audio" && selectedModel && (
            <section>
              {voices.length ? (
                <CustomSelect id="voice" label="音色" onChange={setVoiceID} options={voices.map((voice) => ({ value: voice.id, label: `${voice.name} · ${voice.category ?? "voice"}` }))} value={voiceID} />
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">正在读取该凭据可用的音色…</p>
              )}
              {voices.find((voice) => voice.id === voiceID)?.description && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">{voices.find((voice) => voice.id === voiceID)?.description}</p>
              )}
            </section>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t px-5 py-4">
          <button
            className="h-8 rounded-xs border px-3 text-xs hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="h-8 rounded-xs bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
            disabled={
              !selectedModel || !credentialID || !prompt.trim() || submitting
            }
            type="submit"
          >
            {submitting ? "提交中…" : "创建资源"}
          </button>
        </footer>
      </form>
    </div>
  );
}
