/*
 * [INPUT]: 依赖 React 生命周期、lucide-react 状态图标和媒体内容 URL
 * [OUTPUT]: 对外提供 VideoFrame，在卡片与详情中解码并展示视频首帧，统一处理加载与失败状态
 * [POS]: components 的媒体画面原子；被素材库、Agent 消息和素材详情复用，不承载业务状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { LoaderCircle, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type VideoFrameProps = {
  alt: string;
  className?: string;
  controls?: boolean;
  src: string;
  videoClassName?: string;
};

type VideoState = "loading" | "ready" | "error";

/**
 * ---------- Video frame ----------
 * 请求首个可解码画面而非只取 metadata，保证素材卡片展示真实视频内容。
 */
export function VideoFrame({
  alt,
  className,
  controls = false,
  src,
  videoClassName,
}: VideoFrameProps) {
  const [state, setState] = useState<VideoState>("loading");
  const previewSeeked = useRef(false);

  useEffect(() => {
    previewSeeked.current = false;
    setState("loading");
  }, [src]);

  function requestPreviewFrame(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (previewSeeked.current || !Number.isFinite(video.duration) || video.duration <= 0) return;
    previewSeeked.current = true;
    try {
      video.currentTime = Math.min(0.1, video.duration / 2);
    } catch {
      // 浏览器仍可用已解码的第 0 帧；无需将可播放视频降级为错误。
    }
  }

  return (
    <div className={cn("relative isolate overflow-hidden bg-muted", className)}>
      <video
        aria-label={alt}
        className={cn("block h-full w-full object-cover", videoClassName)}
        controls={controls}
        muted={!controls}
        onError={() => setState("error")}
        onLoadedData={() => setState("ready")}
        onLoadedMetadata={requestPreviewFrame}
        playsInline
        preload="metadata"
        src={src}
        tabIndex={controls ? undefined : -1}
      >
        你的浏览器不支持视频播放。
      </video>
      {state === "loading" && (
        <div
          aria-label="正在加载视频首帧"
          className="pointer-events-none absolute inset-0 grid place-items-center bg-muted/45 text-muted-foreground"
        >
          <LoaderCircle className="size-5 animate-spin" />
        </div>
      )}
      {state === "error" && (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center bg-muted px-3 text-center text-muted-foreground"
          role="status"
        >
          <span className="grid gap-1.5 justify-items-center text-[11px]">
            <VideoOff className="size-5" />
            视频预览不可用
          </span>
        </div>
      )}
    </div>
  );
}
