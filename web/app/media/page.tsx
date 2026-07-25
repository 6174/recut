/*
 * [INPUT]: 依赖 Media Platform 的资产、Provider、Credential 与生成任务 API，以及系统项目 Agent Session
 * [OUTPUT]: 对外提供素材浏览、按资源类型直接创建、Provider 模型选择、参考图上传/粘贴和未连接 Provider 引导的工作区级素材库
 * [POS]: web/app/media 的系统应用入口；将素材创建收敛为独立弹框，右侧 Agent 仍用于复杂协作
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import {
  ArrowLeft,
  ChevronDown,
  ImageIcon,
  Music2,
  Plus,
  Upload,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  ChangeEvent,
  ClipboardEvent,
  CSSProperties,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { ProjectAgentPanel } from "@/components/project-agent-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { useResizableSidePanel } from "@/components/use-resizable-side-panel";

const apiBase =
  process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
type AssetKind = "image" | "video" | "audio";
type Capability = "image.generate" | "video.generate" | "speech.generate";
type Asset = {
  id: string;
  kind: AssetKind;
  name: string;
  origin: string;
  createdAt: string;
  metadata: { prompt?: string };
};
type Model = {
  id: string;
  provider: string;
  name: string;
  capability: Capability;
  available: boolean;
};
type Provider = { id: string; name: string; models: Model[] };
type Credential = { id: string; name: string; provider: string };
type Filter = "all" | AssetKind;
type CreateKind = {
  kind: AssetKind;
  capability: Capability;
  label: string;
  icon: typeof ImageIcon;
  prompt: string;
};
const filters: { id: Filter; label: string; icon: typeof ImageIcon }[] = [
  { id: "all", label: "全部", icon: ImageIcon },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "video", label: "视频", icon: Video },
  { id: "audio", label: "音频", icon: Music2 },
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

export default function MediaLibrary() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [online, setOnline] = useState(false);
  const [projectID, setProjectID] = useState<string | null>(null);
  const [preview, setPreview] = useState<Asset | null>(null);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerSettings, setProviderSettings] = useState(false);
  const [notice, setNotice] = useState("");
  const { handlePointerDown, layoutRef, panelWidth } = useResizableSidePanel({
    storageKey: "recut.media-agent-panel-width",
  });
  async function load() {
    try {
      const [health, project, assetResponse] = await Promise.all([
        fetch(`${apiBase}/health`),
        fetch(`${apiBase}/v1/media/system-project`),
        fetch(`${apiBase}/v1/media/assets`),
      ]);
      if (!health.ok || !project.ok || !assetResponse.ok) throw new Error();
      setProjectID((await project.json()).id);
      setAssets(await assetResponse.json());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(interval);
  }, []);
  const visibleAssets =
    filter === "all" ? assets : assets.filter((asset) => asset.kind === filter);
  function openProviderSettings() {
    setCreateKind(null);
    setProviderSettings(true);
    setSettingsOpen(true);
  }
  function changeSettingsOpen(open: boolean) {
    setSettingsOpen(open);
    if (!open) setProviderSettings(false);
  }
  return (
    <main className="flex h-screen min-w-[1024px] flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-5">
        <div className="flex items-center gap-3">
          <Link
            aria-label="返回项目工作区"
            className="grid size-8 place-items-center rounded-xs hover:bg-muted"
            href="/"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <ImageIcon className="size-4" />
          <strong className="text-sm">素材库</strong>
          <Badge>WORKSPACE</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-muted-foreground">
            {online ? "DAEMON CONNECTED" : "DAEMON OFFLINE"}
          </span>
          <SettingsPanel
            onOpenChange={changeSettingsOpen}
            open={settingsOpen}
            section={providerSettings ? "multimodal" : undefined}
          />
        </div>
      </header>
      <div
        className="relative grid min-h-0 flex-1 overflow-hidden [grid-template-columns:minmax(0,1fr)_var(--side-panel-width)]"
        ref={layoutRef}
        style={{ "--side-panel-width": `${panelWidth}px` } as CSSProperties}
      >
        <section className="min-h-0 overflow-y-auto p-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 flex items-end justify-between border-b pb-4">
              <div>
                <h1 className="text-2xl font-semibold">媒体资产</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  直接选择模型创建素材，复杂创作也可交给右侧 Agent。
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge>{visibleAssets.length} ASSETS</Badge>
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
            <AssetGrid assets={visibleAssets} onPreview={setPreview} />
          </div>
        </section>
        <button
          aria-label="拖动调整 Agent 面板宽度"
          className="group absolute inset-y-0 z-10 w-2 cursor-col-resize border-0 bg-transparent p-0 [left:calc(100%_-_var(--side-panel-width)_-_0.25rem)]"
          onPointerDown={handlePointerDown}
          type="button"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:w-0.5 group-hover:bg-foreground" />
        </button>
        <ProjectAgentPanel
          apiBase={apiBase}
          online={online}
          projectID={projectID}
        />
      </div>
      {preview && (
        <AssetPreview asset={preview} onClose={() => setPreview(null)} />
      )}
      {createKind && (
        <CreateAssetDialog
          assets={assets}
          kind={createKind}
          onAssetImported={(asset) => setAssets((items) => [asset, ...items])}
          onClose={() => setCreateKind(null)}
          onOpenProviderSettings={openProviderSettings}
          onSubmitted={(message) => {
            setNotice(message);
            void load();
          }}
        />
      )}
    </main>
  );
}

function CreateAssetDialog({
  assets,
  kind,
  onAssetImported,
  onClose,
  onOpenProviderSettings,
  onSubmitted,
}: {
  assets: Asset[];
  kind: CreateKind;
  onAssetImported: (asset: Asset) => void;
  onClose: () => void;
  onOpenProviderSettings: () => void;
  onSubmitted: (message: string) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [modelID, setModelID] = useState("");
  const [credentialID, setCredentialID] = useState("");
  const [prompt, setPrompt] = useState("");
  const [referenceIDs, setReferenceIDs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void (async () => {
      const [providerResponse, credentialResponse] = await Promise.all([
        fetch(`${apiBase}/v1/media/providers`),
        fetch(`${apiBase}/v1/media/credentials`),
      ]);
      if (providerResponse.ok) setProviders(await providerResponse.json());
      if (credentialResponse.ok)
        setCredentials(await credentialResponse.json());
    })();
  }, []);
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
  const referenceKinds: AssetKind[] =
    kind.kind === "image"
      ? ["image"]
      : kind.kind === "video"
        ? ["image", "audio"]
        : [];
  const referenceAssets = assets.filter((asset) =>
    referenceKinds.includes(asset.kind),
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedModel || !credentialID || !prompt.trim()) return;
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
      }),
    });
    setSubmitting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "创建任务失败，请检查 Provider 配置。");
      return;
    }
    onSubmitted(`${kind.label}任务已提交，完成后会自动出现在素材库。`);
    onClose();
  }
  async function importImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("参考素材只支持图片。");
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
      setError(body?.error ?? "图片导入失败，请重试。");
      return;
    }
    const asset = (await response.json()) as Asset;
    setReferenceIDs((ids) =>
      ids.includes(asset.id) ? ids : [...ids, asset.id],
    );
    onAssetImported(asset);
  }
  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const image = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );
    const file = image?.getAsFile();
    if (!file) return;
    event.preventDefault();
    void importImage(file);
  }
  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void importImage(file);
    event.target.value = "";
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
            <label className="text-xs font-medium">可用模型</label>
            {connected.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {connected.map((model) => (
                  <button
                    className={`rounded-xs border p-3 text-left ${model.id === modelID ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    key={model.id}
                    onClick={() => setModelID(model.id)}
                    type="button"
                  >
                    <p className="text-xs font-medium">{model.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {
                        providers.find(
                          (provider) => provider.id === model.provider,
                        )?.name
                      }
                    </p>
                  </button>
                ))}
              </div>
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
                  <p className="text-xs font-medium">更多模型</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    这些模型需要先添加对应的 Provider。
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
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {unavailable.map((model) => (
                  <button
                    className="rounded-xs border border-dashed p-3 text-left text-muted-foreground hover:bg-muted/50"
                    key={model.id}
                    onClick={onOpenProviderSettings}
                    type="button"
                  >
                    <p className="text-xs font-medium">{model.name}</p>
                    <p className="mt-1 font-mono text-[10px]">
                      {
                        providers.find(
                          (provider) => provider.id === model.provider,
                        )?.name
                      }{" "}
                      · 未连接
                    </p>
                  </button>
                ))}
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
              onPaste={pasteImage}
              placeholder={kind.prompt}
              value={prompt}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              可直接粘贴剪贴板中的图片作为参考图。
            </p>
          </section>
          {referenceKinds.length > 0 && (
            <section>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs font-medium">参考素材</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {kind.kind === "image"
                      ? "可添加已有图片作为创作上下文。"
                      : "可添加已有图片或音频作为视频创作上下文。"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    accept="image/*"
                    className="hidden"
                    onChange={chooseImage}
                    ref={fileInput}
                    type="file"
                  />
                  <button
                    className="flex h-7 items-center gap-1 rounded-xs border px-2 text-[11px] hover:bg-muted"
                    onClick={() => fileInput.current?.click()}
                    type="button"
                  >
                    <Upload className="size-3" />
                    上传图片
                  </button>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {referenceIDs.length} SELECTED
                  </span>
                </div>
              </div>
              {referenceAssets.length ? (
                <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2">
                  {referenceAssets.map((asset) => (
                    <button
                      className={`flex items-center gap-2 rounded-xs border p-2 text-left ${referenceIDs.includes(asset.id) ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                      key={asset.id}
                      onClick={() =>
                        setReferenceIDs((ids) =>
                          ids.includes(asset.id)
                            ? ids.filter((id) => id !== asset.id)
                            : [...ids, asset.id],
                        )
                      }
                      type="button"
                    >
                      {asset.kind === "image" ? (
                        <img
                          alt=""
                          className="size-10 rounded-xs object-cover"
                          src={`${apiBase}/v1/media/assets/${asset.id}/content`}
                        />
                      ) : (
                        <Music2 className="size-4 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">
                          {asset.name}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                          {asset.kind.toUpperCase()}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded-xs border border-dashed p-3 text-xs text-muted-foreground">
                  素材库中还没有可用的参考素材。
                </p>
              )}
            </section>
          )}
          {selectedModel &&
            credentials.filter(
              (credential) => credential.provider === selectedModel.provider,
            ).length > 1 && (
              <section>
                <label className="text-xs font-medium" htmlFor="credential">
                  使用凭据
                </label>
                <select
                  className="mt-2 h-9 w-full rounded-xs border bg-background px-2 text-xs"
                  id="credential"
                  onChange={(event) => setCredentialID(event.target.value)}
                  value={credentialID}
                >
                  {credentials
                    .filter(
                      (credential) =>
                        credential.provider === selectedModel.provider,
                    )
                    .map((credential) => (
                      <option key={credential.id} value={credential.id}>
                        {credential.name}
                      </option>
                    ))}
                </select>
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

function AssetGrid({
  assets,
  onPreview,
}: {
  assets: Asset[];
  onPreview: (asset: Asset) => void;
}) {
  if (!assets.length)
    return (
      <div className="grid min-h-72 place-items-center rounded-xs border border-dashed bg-card text-center">
        <div>
          <ImageIcon className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有素材</p>
          <p className="mt-1 text-xs text-muted-foreground">
            点击“创建”选择资源类型和模型，或让右侧 Agent 协作创作。
          </p>
        </div>
      </div>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {assets.map((asset) => (
        <button
          className="overflow-hidden rounded-xs border bg-card text-left transition-colors hover:border-foreground/40 hover:bg-muted/20"
          key={asset.id}
          onClick={() => onPreview(asset)}
          type="button"
        >
          {asset.kind === "image" ? (
            <div className="aspect-[4/3] bg-muted">
              <img
                alt={asset.name}
                className="h-full w-full object-cover"
                src={`${apiBase}/v1/media/assets/${asset.id}/content`}
              />
            </div>
          ) : (
            <div className="grid aspect-[4/3] place-items-center bg-muted">
              <span className="text-xs text-muted-foreground">
                {asset.kind.toUpperCase()}
              </span>
            </div>
          )}
          <div className="p-3">
            <p className="truncate text-xs font-medium">{asset.name}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {asset.metadata.prompt ?? "导入素材"}
            </p>
            <div className="mt-3 flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{asset.origin.toUpperCase()}</span>
              <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function AssetPreview({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-8 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
    >
      <section
        className="w-full max-w-4xl overflow-hidden rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-sm font-medium">{asset.name}</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {asset.kind.toUpperCase()} · {asset.origin.toUpperCase()}
            </p>
          </div>
          <button
            aria-label="关闭预览"
            className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="grid max-h-[78vh] overflow-y-auto md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid min-h-80 place-items-center bg-muted/30 p-5">
            {asset.kind === "image" ? (
              <img
                alt={asset.name}
                className="max-h-[65vh] max-w-full object-contain"
                src={`${apiBase}/v1/media/assets/${asset.id}/content`}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {asset.kind.toUpperCase()} 预览将在此显示。
              </p>
            )}
          </div>
          <aside className="border-l p-5">
            <p className="text-xs font-medium">生成信息</p>
            <dl className="mt-4 space-y-4 text-xs">
              <div>
                <dt className="text-muted-foreground">提示词</dt>
                <dd className="mt-1 leading-5">
                  {asset.metadata.prompt ?? "无"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">创建时间</dt>
                <dd className="mt-1">
                  {new Date(asset.createdAt).toLocaleString()}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </div>
  );
}
