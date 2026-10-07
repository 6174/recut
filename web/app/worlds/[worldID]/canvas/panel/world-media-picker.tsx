/*
 * [INPUT]: 依赖 react/createPortal、components/asset-preview-dialog（mediaContentURL/AssetPreviewDialog/PreviewAsset）、
 *   canvas-store（entities/elements/apiBase/worldId）、canvas-asset-status（assets 状态/kind/name）、
 *   entity-attrs（entityMediaAttrs/attrMediaValueOf）、recut-worlds-client（createRecutWorldsClient 拉整库实体）、lucide-react
 * [OUTPUT]: 对外提供 collectWorldMedia（实体 media 属性 + 画布媒体元素 → WorldMediaItem[]）与 WorldMediaPicker：
 *   两个范围 Tab（当前画布 / 当前 World）× 可多选参考，**排除 proposed 提案（无字节）**，缩略图可悬停放大预览
 * [POS]: worlds/[worldID]/canvas/panel 的生成配方参考素材「从当前画布 / 当前 World 选择」入口（RFC 2026-10-07）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, Maximize2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AssetPreviewDialog, mediaContentURL, type PreviewAsset } from "@/components/asset-preview-dialog";
import { createRecutWorldsClient, type WorldEntity } from "@/lib/recut-worlds-client";
import { attrMediaValueOf, entityMediaAttrs } from "../entity-attrs";
import { useCanvasAssetStatusStore } from "../canvas-asset-status";
import { useWorldCanvasStore } from "../canvas-store";
import type { WorldCanvasElement } from "@/lib/recut-worlds-client";

export type WorldMediaItem = { id: string; name: string; kind: string; status?: string; origin?: string };

// 汇总一组实体/画布元素里已引用的媒体素材（按 assetId 去重，只留有 assetId 的、可作为 referenceIds 提交的）。
export function collectWorldMedia(entities: WorldEntity[], elements: WorldCanvasElement[]): WorldMediaItem[] {
  const items = new Map<string, WorldMediaItem>();
  for (const entity of entities) {
    for (const attr of entityMediaAttrs(entity)) {
      const value = attrMediaValueOf(entity, attr.key);
      if (!value?.assetId || items.has(value.assetId)) continue;
      items.set(value.assetId, { id: value.assetId, name: value.name || attr.label || entity.name, kind: value.kind || "image" });
    }
  }
  for (const element of elements) {
    const isMediaElement = element.kind === "media";
    const isMediaAttr = element.kind === "attr" && String(element.props?.media ?? "text") !== "text";
    if (!isMediaElement && !isMediaAttr) continue;
    const assetId = String(element.props?.assetId ?? "");
    if (!assetId || items.has(assetId)) continue;
    items.set(assetId, {
      id: assetId,
      name: String(element.props?.name ?? element.props?.label ?? element.name ?? "素材"),
      kind: String(element.props?.modality ?? element.props?.media ?? "image"),
    });
  }
  return [...items.values()];
}

// 用全局资产状态补全 kind/name/status 并剔除提案（proposed 无字节，缩略图会 404，也不该作为参考）。
function decorate(items: WorldMediaItem[], assets: Record<string, { kind?: string; name?: string; status?: string; origin?: string } | undefined>): WorldMediaItem[] {
  return items
    .map((item) => {
      const asset = assets[item.id];
      return {
        ...item,
        ...(asset?.kind ? { kind: asset.kind } : {}),
        ...(asset?.name ? { name: asset.name } : {}),
        ...(asset?.status ? { status: asset.status } : {}),
        ...(asset?.origin ? { origin: asset.origin } : {}),
      };
    })
    .filter((item) => item.status !== "proposed" && item.status !== "queued" && item.status !== "running");
}

function toPreview(item: WorldMediaItem, asset?: { origin?: string; status?: string; jobId?: string; createdAt?: string; updatedAt?: string; metadata?: Record<string, unknown> }): PreviewAsset {
  return {
    id: item.id,
    kind: item.kind as PreviewAsset["kind"],
    name: item.name,
    origin: asset?.origin ?? "",
    status: (asset?.status as PreviewAsset["status"]) ?? "completed",
    ...(asset?.jobId ? { jobId: asset.jobId } : {}),
    createdAt: asset?.createdAt ?? "",
    updatedAt: asset?.updatedAt ?? "",
    metadata: (asset?.metadata as PreviewAsset["metadata"]) ?? {},
  };
}

type Scope = "canvas" | "world";

export function WorldMediaPicker({ open, onClose, onPick, selectedIds, modality }: {
  open: boolean;
  onClose: () => void;
  onPick: (items: WorldMediaItem[]) => void;
  selectedIds: string[];
  modality?: string;
}) {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const entities = useWorldCanvasStore((state) => state.entities);
  const elements = useWorldCanvasStore((state) => state.elements);
  const assets = useCanvasAssetStatusStore((state) => state.assets);
  const [scope, setScope] = useState<Scope>("canvas");
  const [worldEntities, setWorldEntities] = useState<WorldEntity[] | null>(null);
  const [loadingWorld, setLoadingWorld] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [preview, setPreview] = useState<WorldMediaItem | null>(null);

  useEffect(() => {
    if (open) {
      setChosen([]);
      setScope("canvas");
    }
  }, [open]);

  // 当前 World Tab：拉整库实体（跨所有层级）汇总实体 media 属性；懒加载 + 缓存到本次打开。
  useEffect(() => {
    if (!open || scope !== "world" || worldEntities || !worldId || loadingWorld) return;
    setLoadingWorld(true);
    void (async () => {
      try {
        const client = createRecutWorldsClient(apiBase);
        const list = await client.entities.list({ worldId, limit: 500, includeProvisional: true });
        const full = await Promise.all(list.items.map((summary) => client.entities.get({ worldId, entityId: summary.id }).catch(() => null)));
        setWorldEntities(full.filter((entity): entity is WorldEntity => entity !== null));
      } finally {
        setLoadingWorld(false);
      }
    })();
  }, [open, scope, worldEntities, worldId, apiBase, loadingWorld]);

  const canvasItems = useMemo(() => decorate(collectWorldMedia(entities, elements), assets), [entities, elements, assets]);
  const worldItems = useMemo(() => (worldEntities ? decorate(collectWorldMedia(worldEntities, []), assets) : []), [worldEntities, assets]);
  const scoped = scope === "world" ? worldItems : canvasItems;
  const visible = modality ? scoped.filter((item) => item.kind === modality) : scoped;

  if (!open) return null;
  const toggle = (id: string) => setChosen((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  const assetOf = (id: string) => assets[id];

  return createPortal(
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog">
      <section className="flex max-h-[min(640px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-sm font-medium">选择参考素材</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">从当前画布或整个 World 里已引用的媒体素材中选择（不含生成提案）。</p>
          </div>
          <button aria-label="关闭素材选择" className="grid size-8 place-items-center rounded-xs hover:bg-muted" onClick={onClose} type="button">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex items-center gap-1 border-b px-5 py-2">
          {([["canvas", "当前画布"], ["world", "当前 World"]] as const).map(([key, label]) => (
            <button
              className={`rounded-sm px-2.5 py-1 text-xs ${scope === key ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-muted"}`}
              key={key}
              onClick={() => setScope(key)}
              type="button"
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">{scope === "world" && loadingWorld ? "读取整个 World…" : `${visible.length} 个素材`}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {visible.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {visible.map((item) => {
                const active = chosen.includes(item.id);
                return (
                  <div className={`group relative overflow-hidden rounded-md border ${active ? "border-primary ring-1 ring-primary" : ""}`} key={item.id}>
                    <button className="block w-full text-left" onClick={() => toggle(item.id)} title={`${item.name}${selectedIds.includes(item.id) ? " · 已在参考中" : ""}`} type="button">
                      {item.kind === "video" ? (
                        <video className="aspect-square w-full bg-muted/40 object-cover" muted src={mediaContentURL(apiBase, item.id)} />
                      ) : item.kind === "audio" ? (
                        <span className="grid aspect-square w-full place-items-center bg-muted/40 text-lg">♪</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={item.name}
                          className="aspect-square w-full bg-muted/40 object-cover"
                          onError={(event) => { (event.currentTarget.parentElement?.parentElement as HTMLElement | null)?.style.setProperty("display", "none"); }}
                          src={mediaContentURL(apiBase, item.id)}
                        />
                      )}
                      <span className="block truncate px-1.5 py-1 text-[10px]">{item.name}</span>
                    </button>
                    <button
                      aria-label={`预览 ${item.name}`}
                      className="absolute left-1 top-1 grid size-5 place-items-center rounded bg-card/85 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                      onClick={(event) => { event.stopPropagation(); setPreview(item); }}
                      title="放大预览"
                      type="button"
                    >
                      <Maximize2 className="size-3" />
                    </button>
                    {active && (
                      <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-10 text-center text-xs text-muted-foreground">
              {scope === "world" ? (loadingWorld ? "正在读取整个 World…" : "整个 World 还没有已引用的媒体素材。") : "当前画布还没有已引用的媒体素材。"}
            </p>
          )}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-[11px] text-muted-foreground">已选 {chosen.length} 项</span>
          <div className="flex items-center gap-2">
            <button className="h-8 rounded-md border px-3 text-xs hover:bg-muted" onClick={onClose} type="button">取消</button>
            <button
              className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={!chosen.length}
              onClick={() => { onPick(visible.filter((item) => chosen.includes(item.id))); onClose(); }}
              type="button"
            >
              添加参考
            </button>
          </div>
        </footer>
      </section>
      {preview && (
        <div onMouseDown={(event) => event.stopPropagation()}>
          <AssetPreviewDialog apiBase={apiBase} asset={toPreview(preview, assetOf(preview.id))} onClose={() => setPreview(null)} />
        </div>
      )}
    </div>,
    document.body,
  );
}
