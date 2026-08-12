/*
 * [INPUT]: 依赖工具执行结果 JSON、共享 Asset SSE 缓存、素材内容 HTTP API 与统一素材详情模态框
 * [OUTPUT]: 对外提供 ToolResultAssets 与 resultAssetIDs；从嵌套工具结果提取 assetIds，并直接渲染可点击的真实媒体预览
 * [POS]: components 的工具结果媒体适配层；由 Agent 工具调用详情消费，复用全局 Asset 真相而不解析 Provider 专有格式
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Captions, ImageIcon, Link2, LoaderCircle, Music2, Video } from "lucide-react";
import { useEffect, useState } from "react";

import {
  AssetPreviewDialog,
  mediaContentURL,
  type PreviewAsset,
} from "@/components/asset-preview-dialog";
import { VideoFrame } from "@/components/video-frame";
import { useMediaAssetEvents } from "@/components/use-media-asset-events";

type ResultAsset = PreviewAsset;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsed(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function resultAssetIDs(output?: string): string[] {
  if (!output) return [];
  const assetIDs = new Set<string>();
  function visit(value: unknown, depth: number) {
    if (depth > 4) return;
    if (typeof value === "string") {
      const decoded = parsed(value);
      if (decoded !== null) visit(decoded, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const object = record(value);
    if (!object) return;
    if (Array.isArray(object.assetIds)) {
      object.assetIds.forEach((assetID) => {
        if (typeof assetID === "string" && assetID.trim()) assetIDs.add(assetID);
      });
    }
    Object.values(object).forEach((item) => visit(item, depth + 1));
  }
  visit(parsed(output), 0);
  return [...assetIDs];
}

export function ToolResultAssets({
  apiBase,
  output,
}: {
  apiBase: string;
  output?: string;
}) {
  const assetIDs = resultAssetIDs(output);
  const { assetByID, assets } = useMediaAssetEvents();
  const [preview, setPreview] = useState<ResultAsset | null>(null);
  if (!assetIDs.length) return null;
  return (
    <section className="mt-3">
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">
        生成结果
      </p>
      <div className="flex flex-wrap gap-2">
        {assetIDs.map((assetID) => (
          <ToolResultAsset
            apiBase={apiBase}
            asset={assetByID[assetID] as ResultAsset | undefined}
            assetID={assetID}
            key={assetID}
            onOpen={setPreview}
          />
        ))}
      </div>
      {preview && (
        <AssetPreviewDialog
          apiBase={apiBase}
          asset={preview}
          assets={assets as ResultAsset[]}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}

function ToolResultAsset({
  apiBase,
  asset: cachedAsset,
  assetID,
  onOpen,
}: {
  apiBase: string;
  asset?: ResultAsset;
  assetID: string;
  onOpen: (asset: ResultAsset) => void;
}) {
  const [loadedAsset, setLoadedAsset] = useState<ResultAsset | null>(null);
  const asset = cachedAsset ?? loadedAsset;
  useEffect(() => {
    if (cachedAsset) return;
    let cancelled = false;
    void fetch(`${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: ResultAsset | null) => {
        if (!cancelled && value) setLoadedAsset(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiBase, assetID, cachedAsset]);
  const label = asset?.name || "生成的素材";
  const completed = asset?.status === "completed";
  const source = mediaContentURL(apiBase, assetID);
  const Icon = asset?.kind === "video" ? Video : asset?.kind === "audio" ? Music2 : asset?.kind === "transcript" ? Captions : asset?.kind === "reference" ? Link2 : ImageIcon;
  return (
    <button
      aria-label={`打开${label}`}
      className="group w-52 overflow-hidden rounded-sm border bg-card text-left shadow-sm transition hover:border-primary hover:shadow-md"
      disabled={!asset}
      onClick={() => asset && onOpen(asset)}
      type="button"
    >
      {completed && asset?.kind === "image" ? (
        <img alt={label} className="aspect-video w-full object-cover" src={source} />
      ) : completed && asset?.kind === "video" ? (
        <VideoFrame alt={label} className="aspect-video w-full" src={source} />
      ) : (
        <div className="grid aspect-video place-items-center bg-muted text-muted-foreground">
          {asset?.status === "failed" ? (
            <span className="text-[10px] text-destructive">生成失败</span>
          ) : (
            <LoaderCircle className="size-5 animate-spin text-primary" />
          )}
        </div>
      )}
      <span className="flex items-center gap-1.5 border-t px-2 py-1.5 text-[10px] text-muted-foreground group-hover:text-foreground">
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    </button>
  );
}
