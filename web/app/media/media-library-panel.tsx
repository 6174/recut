/*
 * [INPUT]: 依赖 service endpoint、Media Platform 的资产 SSE、media-configuration-store 的 Provider/Credential 快照与生成任务 API，以及系统项目 Agent Session
 * [OUTPUT]: 对外提供随滚动自动加载的素材网格、完成视频的 iframe 视频封面卡片、统一 More 重命名/确认删除、运行中实时计时与终态持久化耗时、按 assetId 合并导入/生成结果、主动上传图片/视频/音频、生成详情中的提示词与参考素材展示、底部常驻直接生成 composer（图片/视频/音频/动作图形，动作图形预填左侧全局对话）、上传参考素材的工作区级素材库
 * [POS]: web/app/media 的原生 React 内容组件；由根工作台与 /media 路由共享，标题与筛选经统一 WorkspacePageHeader/FilterTabs 与项目页对齐、整页随工作台内容区滚动（网格不再自持滚动容器），Asset 是异步生命周期唯一真相，页面通过一条 Recut SSE 消费状态，配置从统一缓存读取而不轮询；创建入口为内容区底部 sticky 的 MediaCreateComposer，不再用右上角下拉+模态弹框
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";
import {
  Captions,
  ImageIcon,
  Layers,
  Music2,
  Upload,
  Video,
} from "lucide-react";
import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FilterTabs, WorkspacePageHeader } from "@/components/workspace-page";
import { MediaAssetEventsProvider, useMediaAssetEvents } from "@/components/use-media-asset-events";
import { useServiceStore } from "@/lib/service-store";
import { AssetGrid } from "./asset-grid";
import { AssetPreview } from "./asset-preview";
import { MediaCreateComposer, type ComposerModality, type MediaCreateDraft } from "./media-create-composer";
import { normalizeAsset } from "./media-types";
import type {
  Asset,
  Capability,
  Filter,
  MediaJob,
} from "./media-types";
const filters: { id: Filter; label: string; icon: typeof ImageIcon }[] = [
  { id: "all", label: "全部", icon: ImageIcon },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "video", label: "视频", icon: Video },
  { id: "audio", label: "音频", icon: Music2 },
  { id: "transcript", label: "转写", icon: Captions },
  { id: "component", label: "组件", icon: Layers },
];
// 素材类型 → 生成能力（用于按筛选聚合在途任务）；all/transcript/component 无对应生成能力。
const kindCapability: Partial<Record<Filter, Capability>> = {
  image: "image.generate",
  video: "video.generate",
  audio: "speech.generate",
};

// capability → composer 模态；无法直生的素材（component/transcript）返回 null。
function modalityForCapability(capability: string): ComposerModality | null {
  if (capability === "image.generate") return "image";
  if (capability === "video.generate") return "video";
  if (capability === "speech.generate") return "audio";
  return null;
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? "操作失败，请重试。";
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
  const [preview, setPreview] = useState<Asset | null>(null);
  const [composerDraft, setComposerDraft] = useState<MediaCreateDraft | null>(null);
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
  const visibleJobs = jobs.filter(
    (job) =>
      !job.assetIds.some((assetID) => Boolean(assetByID[assetID])) &&
      (filter === "all" || job.capability === kindCapability[filter]),
  );
  function openRegeneration(asset: Asset) {
    const capability =
      typeof asset.metadata.capability === "string"
        ? asset.metadata.capability
        : asset.kind === "audio"
          ? "speech.generate"
          : `${asset.kind}.generate`;
    const modality = modalityForCapability(capability);
    if (!modality || !asset.metadata.prompt) {
      setNotice("该素材没有可复用的生成参数。");
      return;
    }
    setPreview(null);
    setComposerDraft({
      id: `regen-${asset.id}-${Date.now()}`,
      modality,
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
    <div className="flex min-h-[60vh] flex-col">
      <WorkspacePageHeader
        action={
          <>
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
          </>
        }
        description="描述即可生成素材，复杂创作交给左侧 Agent。"
        title="媒体资产"
      />
      {notice && <p className="mb-4 text-xs text-muted-foreground">{notice}</p>}
      <FilterTabs<Filter>
        items={filters.map((item) => ({ icon: item.icon, id: item.id, label: item.label }))}
        onChange={setFilter}
        value={filter}
      />
      <AssetGrid
        apiBase={apiBase}
        assets={visibleAssets}
        jobs={visibleJobs}
        onDelete={deleteAsset}
        onPreview={setPreview}
        onRename={renameAsset}
      />
      <div className="sticky bottom-0 z-20 mt-auto pt-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-t from-background to-transparent" />
        <div className="pointer-events-auto relative mx-auto w-full max-w-3xl pb-1">
          <MediaCreateComposer
            apiBase={apiBase}
            assets={assets}
            draft={composerDraft}
            onAssetImported={upsertAsset}
            onNotice={setNotice}
            onOpenProviderSettings={onOpenProviderSettings}
            onProposed={(asset) => {
              upsertAsset(asset);
            }}
            onSubmitted={(job) => {
              setJobs((items) => [job, ...items]);
              void hydrateSubmittedAssets(job);
            }}
          />
        </div>
      </div>
      {preview && (
        <AssetPreview
          asset={preview}
          assets={assets}
          onClose={() => setPreview(null)}
          onRegenerate={openRegeneration}
        />
      )}
    </div>
  );
}
