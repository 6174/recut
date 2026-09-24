/*
 * [INPUT]: 依赖 react、createPortal、canvas-store（entities/elements/apiBase）、entity-attrs（entityMediaAttrs/
 * attrMediaValueOf）、asset-preview-dialog（mediaContentURL）、lucide-react
 * [OUTPUT]: 对外提供 WorldMediaPicker：从「当前 World」已引用的媒体素材中快速多选（实体 media 属性 +
 * 画布媒体元素/媒体属性卡），只列有 assetId 的素材（可直接作为生成参考提交）
 * [POS]: worlds/[worldID]/canvas/panel 的生成配方参考素材「从当前 World 选择」入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { mediaContentURL } from "@/components/asset-preview-dialog";
import { attrMediaValueOf, entityMediaAttrs } from "../entity-attrs";
import { useWorldCanvasStore } from "../canvas-store";
import type { WorldCanvasElement, WorldEntity } from "@/lib/recut-worlds-client";

export type WorldMediaItem = { id: string; name: string; kind: string };

// 汇总当前 World 已引用的媒体素材（按 assetId 去重）：实体 media 属性 + 画布媒体元素/媒体属性卡。
// 只保留 assetId 来源（url 素材无法作为 referenceIds 提交）。
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

export function WorldMediaPicker({ open, onClose, onPick, selectedIds, modality }: {
  open: boolean;
  onClose: () => void;
  onPick: (items: WorldMediaItem[]) => void;
  selectedIds: string[];
  modality?: string;
}) {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const entities = useWorldCanvasStore((state) => state.entities);
  const elements = useWorldCanvasStore((state) => state.elements);
  const [chosen, setChosen] = useState<string[]>([]);
  const all = useMemo(() => collectWorldMedia(entities, elements), [entities, elements]);
  const visible = modality ? all.filter((item) => item.kind === modality) : all;
  useEffect(() => {
    if (open) setChosen([]);
  }, [open]);
  if (!open) return null;
  const toggle = (id: string) => setChosen((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  return createPortal(
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog">
      <section className="flex max-h-[min(640px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-sm font-medium">从当前 World 选择素材</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">世界设定与画布上已引用的媒体素材，可多选作为生成参考。</p>
          </div>
          <button aria-label="关闭世界素材选择" className="grid size-8 place-items-center rounded-xs hover:bg-muted" onClick={onClose} type="button">
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {visible.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {visible.map((item) => {
                const active = chosen.includes(item.id);
                return (
                  <button
                    className={`group relative overflow-hidden rounded-md border text-left hover:border-primary/60 ${active ? "border-primary ring-1 ring-primary" : ""}`}
                    key={item.id}
                    onClick={() => toggle(item.id)}
                    title={`${item.name}${selectedIds.includes(item.id) ? " · 已在参考中" : ""}`}
                    type="button"
                  >
                    {item.kind === "video" ? (
                      <video className="aspect-square w-full bg-muted/40 object-cover" muted src={mediaContentURL(apiBase, item.id)} />
                    ) : item.kind === "audio" ? (
                      <span className="grid aspect-square w-full place-items-center bg-muted/40 text-lg">🎵</span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={item.name} className="aspect-square w-full bg-muted/40 object-cover" src={mediaContentURL(apiBase, item.id)} />
                    )}
                    <span className="block truncate px-1.5 py-1 text-[10px]">{item.name}</span>
                    {active && (
                      <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-10 text-center text-xs text-muted-foreground">当前 World 还没有已引用的媒体素材。</p>
          )}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-[11px] text-muted-foreground">已选 {chosen.length} 项</span>
          <div className="flex items-center gap-2">
            <button className="h-8 rounded-md border px-3 text-xs hover:bg-muted" onClick={onClose} type="button">取消</button>
            <button
              className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={!chosen.length}
              onClick={() => {
                onPick(visible.filter((item) => chosen.includes(item.id)));
                onClose();
              }}
              type="button"
            >
              添加参考
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
