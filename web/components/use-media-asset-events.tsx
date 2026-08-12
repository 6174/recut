/*
 * [INPUT]: 依赖浏览器 EventSource、service-endpoint 的事件流地址与 Recut `/v1/media/events` 的资产快照/增量事件契约
 * [OUTPUT]: 对外提供 MediaAssetEventsProvider、useMediaAssetEvents 与 MediaEventAsset；维护唯一的前端 Asset 缓存（含 ASR 转写 bundle 类型）
 * [POS]: components 的媒体生命周期边界；素材库、Agent、预览和引用选择器共享同一条 Recut SSE，不轮询 Provider 或单个 Asset
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { streamServiceEndpoint } from "@/lib/service-endpoint";

export type MediaEventAsset = {
  id: string;
  kind: "image" | "video" | "audio" | "transcript" | "reference";
  mimeType: string;
  name: string;
  origin: string;
  status: "queued" | "running" | "completed" | "failed";
  jobId?: string;
  remoteId?: string;
  error?: string;
  projectIds: string[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

type MediaAssetStore = {
  assetByID: Record<string, MediaEventAsset>;
  order: string[];
  ready: boolean;
};

export type MediaAssetEvents = {
  assets: MediaEventAsset[];
  assetByID: Record<string, MediaEventAsset>;
  ready: boolean;
  upsertAsset: (asset: unknown) => void;
};

const emptyAssetEvents: MediaAssetEvents = {
  assets: [],
  assetByID: {},
  ready: false,
  upsertAsset: () => {},
};
const MediaAssetEventsContext = createContext<MediaAssetEvents | null>(null);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assetKind(value: unknown, mimeType: string): MediaEventAsset["kind"] {
  if (value === "image" || value === "video" || value === "audio" || value === "transcript" || value === "reference") return value;
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

function assetStatus(value: unknown, jobID: string | undefined): MediaEventAsset["status"] {
  const status = value === "queued" || value === "running" || value === "completed" || value === "failed"
    ? value
    : "completed";
  // 旧工作区里曾有被错误标记为运行中的同步导入素材。没有 durable jobId 的记录不能占用生成态。
  return (status === "queued" || status === "running") && !jobID ? "completed" : status;
}

export function normalizeMediaEventAsset(value: unknown): MediaEventAsset | null {
  const source = record(value);
  if (!source) return null;
  const id = typeof source.id === "string" ? source.id : "";
  if (!id) return null;
  const mimeType = typeof source.mimeType === "string" ? source.mimeType : "";
  const jobId = typeof source.jobId === "string" && source.jobId.trim() ? source.jobId : undefined;
  const metadata = record(source.metadata) ?? {};
  return {
    id,
    kind: assetKind(source.kind, mimeType),
    mimeType,
    name: typeof source.name === "string" && source.name.trim() ? source.name : "未命名素材",
    origin: typeof source.origin === "string" && source.origin ? source.origin : "素材库",
    status: assetStatus(source.status, jobId),
    jobId,
    remoteId: typeof source.remoteId === "string" ? source.remoteId : undefined,
    error: typeof source.error === "string" ? source.error : undefined,
    projectIds: Array.isArray(source.projectIds)
      ? source.projectIds.filter((projectID): projectID is string => typeof projectID === "string")
      : [],
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    metadata,
  };
}

function upsert(store: MediaAssetStore, asset: MediaEventAsset): MediaAssetStore {
  const known = Boolean(store.assetByID[asset.id]);
  return {
    ...store,
    assetByID: { ...store.assetByID, [asset.id]: asset },
    order: known ? store.order : [asset.id, ...store.order],
  };
}

function eventData(event: Event) {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as unknown;
  } catch {
    return null;
  }
}

function MediaAssetEventsConnection({ apiBase, children }: { apiBase: string; children: ReactNode }) {
  const [store, setStore] = useState<MediaAssetStore>({ assetByID: {}, order: [], ready: false });
  const upsertAsset = useCallback((value: unknown) => {
    const asset = normalizeMediaEventAsset(value);
    if (asset) setStore((current) => upsert(current, asset));
  }, []);

  useEffect(() => {
    const stream = new EventSource(`${streamServiceEndpoint(apiBase)}/v1/media/events`);
    stream.addEventListener("media.snapshot", (event) => {
      const payload = record(eventData(event));
      const assets = Array.isArray(payload?.assets)
        ? payload.assets.map(normalizeMediaEventAsset).filter((asset): asset is MediaEventAsset => Boolean(asset))
        : [];
      setStore({
        assetByID: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
        order: assets.map((asset) => asset.id),
        ready: true,
      });
    });
    stream.addEventListener("asset.updated", (event) => {
      const payload = record(eventData(event));
      const asset = normalizeMediaEventAsset(payload?.asset);
      if (asset) setStore((current) => upsert({ ...current, ready: true }, asset));
    });
    return () => stream.close();
  }, [apiBase]);

  const value = useMemo<MediaAssetEvents>(() => ({
    assets: store.order.map((id) => store.assetByID[id]).filter((asset): asset is MediaEventAsset => Boolean(asset)),
    assetByID: store.assetByID,
    ready: store.ready,
    upsertAsset,
  }), [store, upsertAsset]);
  return <MediaAssetEventsContext.Provider value={value}>{children}</MediaAssetEventsContext.Provider>;
}

export function MediaAssetEventsProvider({ apiBase, children }: { apiBase: string; children: ReactNode }) {
  const parent = useContext(MediaAssetEventsContext);
  // 页面与嵌入其中的 Agent 面板必须共享一条流；独立 Agent 页面则自然建立自己的连接。
  if (parent) return <>{children}</>;
  return <MediaAssetEventsConnection apiBase={apiBase}>{children}</MediaAssetEventsConnection>;
}

export function useMediaAssetEvents() {
  return useContext(MediaAssetEventsContext) ?? emptyAssetEvents;
}
