/**
 * [INPUT]: 依赖 React portal 与 lucide 图标
 * [OUTPUT]: 对外提供全局全屏图片预览组件 ImageLightbox（Portal 到 body，点击遮罩/Esc 关闭、可缩放）与 iframe 桥用的 PlatformImagePreview
 * [POS]: 平台级图片 lightbox；素材详情与 iframe App（经宿主 image.preview 请求）共用同一预览面，App 只传地址与名称
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type PlatformImagePreviewRequest = { url: string; name?: string };

// 全屏图片预览：图片按视口等比铺满，遮罩点击与 Esc 关闭，支持 25%–600% 缩放。
export function ImageLightbox({ src, alt, caption, onClose }: { src: string; alt?: string; caption?: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => { setZoom(1); }, [src]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(6, value + 0.25));
      else if (event.key === "-") setZoom((value) => Math.max(0.25, value - 0.25));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  const zoomed = zoom !== 1;
  return createPortal(
    <div aria-modal="true" className="fixed inset-0 z-[120] flex flex-col bg-black/85 backdrop-blur-sm" onMouseDown={onClose} role="dialog">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5 text-white/80" onMouseDown={(event) => event.stopPropagation()}>
        <p className="min-w-0 truncate text-xs">{caption || alt || "图片预览"}</p>
        <div className="flex shrink-0 items-center gap-1">
          <button aria-label="缩小" className="grid size-8 place-items-center rounded-full hover:bg-white/10 disabled:opacity-40" disabled={zoom <= 0.25} onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))} type="button"><Minus className="size-4" /></button>
          <span className="w-12 text-center font-mono text-[11px]">{Math.round(zoom * 100)}%</span>
          <button aria-label="放大" className="grid size-8 place-items-center rounded-full hover:bg-white/10 disabled:opacity-40" disabled={zoom >= 6} onClick={() => setZoom((value) => Math.min(6, value + 0.25))} type="button"><Plus className="size-4" /></button>
          <button aria-label="关闭预览" className="grid size-8 place-items-center rounded-full hover:bg-white/10" onClick={onClose} type="button"><X className="size-4" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onMouseDown={onClose}>
        <div className="flex min-h-full min-w-full items-center justify-center p-6" onMouseDown={(event) => event.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={alt || "preview"}
            className="rounded-sm object-contain"
            src={src}
            style={zoomed ? { width: `${zoom * 100}%`, maxWidth: "none", height: "auto" } : { maxHeight: "100%", maxWidth: "100%" }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// iframe 宿主侧桥接：把 image.preview 请求渲染为全局 lightbox。
export function PlatformImagePreview({ request, onClose }: { request: PlatformImagePreviewRequest | null; onClose: () => void }) {
  if (!request) return null;
  return <ImageLightbox alt={request.name} caption={request.name} onClose={onClose} src={request.url} />;
}
