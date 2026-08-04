/*
 * [INPUT]: 依赖媒体内容 URL 与浏览器原生媒体元素/iframe 媒体文档
 * [OUTPUT]: 对外提供 VideoFrame，卡片以 srcDoc iframe 承载静音循环视频，详情嵌入原片 URL 的浏览器媒体文档
 * [POS]: components 的媒体画面原子；被素材库、Agent 消息和素材详情复用，卡片使用真实子文档而非 iframe fallback 内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { cn } from "@/lib/utils";

type VideoFrameProps = {
  alt: string;
  className?: string;
  controls?: boolean;
  src: string;
  videoClassName?: string;
};

/**
 * ---------- Video frame ----------
 * 封面必须写入 iframe 的 srcDoc。iframe 的 JSX 子节点只是“不支持 iframe”时的
 * fallback，不能作为子文档内容，因此会显示空白。
 * 素材库首屏限定为 12 张，避免上百条封面同时占用解码器和网络连接。
 */
export function VideoFrame({
  alt,
  className,
  controls = false,
  src,
  videoClassName,
}: VideoFrameProps) {
  if (!controls) {
    return (
      <div className={cn("relative isolate aspect-video w-full overflow-hidden bg-muted", className)}>
        <iframe
          allow="autoplay"
          className={cn("pointer-events-none block h-full w-full border-0", videoClassName)}
          srcDoc={videoDocument(src, alt)}
          tabIndex={-1}
          title={alt}
        />
      </div>
    );
  }

  return (
    <div className={cn("aspect-video isolate overflow-hidden bg-black", className)}>
      <iframe
        allow="autoplay; fullscreen; picture-in-picture"
        className={cn("block h-full w-full border-0", videoClassName)}
        src={src}
        title={alt}
      />
    </div>
  );
}

function videoDocument(src: string, alt: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>html,body,video{height:100%;width:100%;margin:0;background:#000}video{display:block;object-fit:cover}</style></head><body><video aria-label="${escapeAttribute(alt)}" autoplay loop muted playsinline preload="metadata" src="${escapeAttribute(src)}"></video></body></html>`;
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
