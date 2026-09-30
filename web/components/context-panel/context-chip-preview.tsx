/*
 * [INPUT]: 依赖 @radix-ui/react-popover（Portal + 虚拟锚点 + 碰撞翻转）、ContextPreviewPane、context-catalog 的 registry/types/runtime
 * [OUTPUT]: 对外提供 ChipPreviewPopover：把任意 chip 包成「hover 即预览」的锚点，按 option 的 descriptor.preview 懒加载内容，缺省时退化为 fallback 静态预览
 * [POS]: web/components/context-panel 的芯片预览层；由 agent-composer 的上下文芯片行消费，与内联 ReferenceChip 的 hover 预览共用同一份 preview 契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { contextSourceForType } from "@/lib/context-catalog/registry";
import type { ContextOption, ContextPreview, ContextRuntime } from "@/lib/context-catalog/types";
import { ContextPreviewPane } from "./context-preview";

type FallbackPreview = { title: string; subtitle?: string; facts?: ContextPreview["facts"] };

export function ChipPreviewPopover({
  apiBase,
  runtime,
  option,
  fallback,
  children,
}: {
  apiBase: string;
  /** 目录运行时快照；缺省时只能渲染 fallback（如尚未进入素材/Worlds 快照的引用） */
  runtime: ContextRuntime | null;
  /** 芯片对应的目录选项；descriptor.preview 据此产出丰富预览 */
  option?: ContextOption | null;
  /** 无法反查 option 时的静态兜底预览 */
  fallback?: FallbackPreview;
  children: ReactNode;
}) {
  const source = option ? contextSourceForType(option.sourceType) : undefined;
  const rich = Boolean(option && source && runtime);
  // 锚点必须复刻芯片的整块矩形（尤其是高度）：composer 贴在视口底部，浮层基本都会翻到上方，
  // 若锚点只有芯片底边一个零高点，翻上去就会正好盖住芯片本身，芯片上的 × 再也点不到。
  const [anchor, setAnchor] = useState<{ top: number; left: number; height: number } | null>(null);
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<number | null>(null);

  const show = useCallback(() => {
    if (!rich && !fallback) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    setAnchor({ top: rect.top, left: rect.left, height: rect.height });
    // 先给一个可立即渲染的兜底预览，再异步补详情，避免 hover 无反馈。
    setPreview((current) =>
      current ?? (fallback ? { ...fallback, facts: fallback.facts ?? [] } : { title: option?.title ?? "", subtitle: option?.subtitle, facts: [] }),
    );
    if (!option || !source || !runtime) return;
    const ctx = { apiBase, query: "", group: "all" as const, runtime, signal: new AbortController().signal };
    void Promise.resolve(source.preview(option, ctx))
      .then((value) => setPreview(value))
      .catch(() => {});
  }, [apiBase, fallback, option, rich, runtime, source]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setPreview(null);
      setAnchor(null);
    }, 140);
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  return (
    <span className="inline-flex shrink-0" onMouseEnter={show} onMouseLeave={scheduleHide} ref={wrapperRef}>
      {children}
      {anchor && preview && (
        <PopoverPrimitive.Root onOpenChange={() => {}} open>
          <PopoverPrimitive.Anchor asChild>
            {/* 虚拟锚点：复刻芯片整块矩形（含高度），让浮层按 side 贴在芯片外侧而不是压住芯片。 */}
            <span aria-hidden style={{ position: "fixed", left: anchor.left, top: anchor.top, width: 1, height: anchor.height, pointerEvents: "none" }} />
          </PopoverPrimitive.Anchor>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              align="start"
              avoidCollisions
              className="z-[210] max-h-[min(420px,calc(100vh-2rem))] w-72 overflow-y-auto rounded-md border bg-popover p-0 text-popover-foreground shadow-[var(--shadow-overlay)] outline-none"
              collisionPadding={8}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onEscapeKeyDown={(event) => event.preventDefault()}
              onInteractOutside={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={show}
              onMouseLeave={scheduleHide}
              onOpenAutoFocus={(event) => event.preventDefault()}
              side="top"
              sideOffset={6}
            >
              <ContextPreviewPane insertMode="attach" preview={preview} />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      )}
    </span>
  );
}
