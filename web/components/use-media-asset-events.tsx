/*
 * [INPUT]: 依赖实时通道单例与 Recut `/v1/media/assets` REST 快照；增量经全局 WS 的 media channel
 * [OUTPUT]: 对外提供 MediaAssetEventsProvider、useMediaAssetEvents 与 MediaEventAsset；维护唯一的前端 Asset 缓存（含 ASR 转写 bundle 类型）并即时移除已删除项目；首屏 REST + 断线重连补快照
 * [POS]: components 的媒体生命周期边界；素材库、Agent、预览和引用选择器共享同一条实时通道，不轮询 Provider 或单个 Asset
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
  useRef,
  useState,
} from "react";
import { getRealtimeChannel } from "@/lib/realtime-channel";

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
  removeAsset: (assetID: string) => void;
  upsertAsset: (asset: unknown) => void;
};

const emptyAssetEvents: MediaAssetEvents = {
  assets: [],
  assetByID: {},
  ready: false,
  removeAsset: () => {},
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

function MediaAssetEventsConnection({ apiBase, children }: { apiBase: string; children: ReactNode }) {
  const [store, setStore] = useState<MediaAssetStore>({ assetByID: {}, order: [], ready: false });
  const readyRef = useRef(false);
  const upsertAsset = useCallback((value: unknown) => {
    const asset = normalizeMediaEventAsset(value);
    if (!asset) return;
    readyRef.current = true;
    setStore((current) => upsert({ ...current, ready: true }, asset));
  }, []);
  const removeAsset = useCallback((assetID: string) => {
    setStore((current) => {
      if (!current.assetByID[assetID]) return current;
      const { [assetID]: _, ...assetByID } = current.assetByID;
      return { ...current, assetByID, order: current.order.filter((id) => id !== assetID) };
    });
  }, []);

  const loadSnapshot = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`${apiBase}/v1/media/assets`, { cache: "no-store" });
      if (!response.ok) return;
      const assets = ((await response.json()) as unknown[])
        .map(normalizeMediaEventAsset)
        .filter((asset): asset is MediaEventAsset => Boolean(asset));
      readyRef.current = true;
      setStore({
        assetByID: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
        order: assets.map((asset) => asset.id),
        ready: true,
      });
    } catch {
      // 保留 ready 终态可达性：下一次重连或增量事件会推进。
    }
  }, [apiBase]);

  useEffect(() => {
    readyRef.current = false;
    const channel = getRealtimeChannel(apiBase);
    // 首屏走 REST；增量经全局 WS 的 media channel。
    void loadSnapshot();
    const unsubscribe = channel.subscribe("media", "", (frame) => {
      const data =
        frame.data && typeof frame.data === "object"
          ? (frame.data as Record<string, unknown>)
          : {};
      if (data.event === "asset.deleted" && typeof data.assetId === "string") removeAsset(data.assetId);
      const asset = normalizeMediaEventAsset(data.asset);
      if (asset) upsertAsset(asset);
    });
    // 断线重连后补一次 REST 快照，保证缓存完整。
    const offStatus = channel.onStatusChange((connected) => {
      if (connected) void loadSnapshot();
    });
    return () => {
      unsubscribe();
      offStatus();
    };
  }, [apiBase, loadSnapshot, removeAsset, upsertAsset]);

  const value = useMemo<MediaAssetEvents>(() => ({
    assets: store.order.map((id) => store.assetByID[id]).filter((asset): asset is MediaEventAsset => Boolean(asset)),
    assetByID: store.assetByID,
    ready: store.ready,
    removeAsset,
    upsertAsset,
  }), [removeAsset, store, upsertAsset]);
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
