/*
 * [INPUT]: 依赖 @tiptap/react NodeView、@radix-ui/react-popover、useReferenceRegistry/useContextCatalogValue、resolveContextOption、ContextPreviewPane 与 lucide 图标
 * [OUTPUT]: 对外提供 ReferenceChip：内联引用 chip（descriptor.icon + label；hover 用 Popover 预览内容，点击 label 跳转）
 * [POS]: web/components/rich-composer 的引用节点视图（协议 RFC §4/§9）；预览复用 descriptor.preview，定位交给 Popover（自动翻转/夹取，不被截断）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ContextPreviewPane } from "@/components/context-panel/context-preview";
import { contextSourceForType } from "@/lib/context-catalog/registry";
import { resolveContextOption } from "@/lib/context-catalog/resolve";
import type { ContextPreview } from "@/lib/context-catalog/types";
import { REFERENCE_TYPE_ATTR } from "@/lib/rich-composer/protocol/serialize";
import { useContextCatalogValue } from "./catalog-context";
import { useReferenceRegistry } from "./registry-context";

export function ReferenceChip({ node, deleteNode, editor }: Pick<NodeViewProps, "node" | "deleteNode" | "editor">) {
  const registry = useReferenceRegistry();
  const { runtime, apiBase } = useContextCatalogValue();
  const [hovered, setHovered] = useState(false);
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const hideTimer = useRef<number | null>(null);

  const attrs = (node.attrs ?? {}) as Record<string, string>;
  const refType = String(attrs[REFERENCE_TYPE_ATTR] ?? "");
  const source = registry.find((item) => item.type === refType);
  const catalogSource = contextSourceForType(refType);
  const label = catalogSource?.label(attrs) ?? String(attrs.name ?? attrs.title ?? refType);
  const icon = catalogSource?.icon(attrs, { apiBase }) ?? null;
  const navigate = catalogSource?.navigate;

  const show = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    setHovered(true);
    // 先给一个可立即渲染的兜底预览，再异步补详情，避免 hover 无反馈。
    setPreview((current) => current ?? { title: label, subtitle: refType, facts: [] });
    const option = runtime ? resolveContextOption(refType, attrs, runtime) : null;
    if (!option || !catalogSource || !runtime) return;
    const ctx = { apiBase, query: "", group: "all" as const, runtime, signal: new AbortController().signal, limit: 1 };
    void Promise.resolve(catalogSource.preview(option, ctx))
      .then((value) => setPreview(value))
      .catch(() => {});
  }, [apiBase, attrs, catalogSource, label, refType, runtime]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(false), 140);
  }, []);

  return (
    <NodeViewWrapper as="span" className="inline">
      <PopoverPrimitive.Root onOpenChange={() => {}} open={hovered && preview !== null}>
        <PopoverPrimitive.Anchor asChild>
          <span
            className="mx-0.5 inline-flex max-w-56 items-center gap-1 rounded-sm border border-primary/30 bg-primary/10 py-0.5 pl-1 pr-1.5 align-baseline text-[10px] leading-5 text-primary"
            contentEditable={false}
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
            title={`${source?.type ?? refType} · ${label}`}
          >
            <span className="grid size-3.5 shrink-0 place-items-center">{icon}</span>
            <button
              className="min-w-0 truncate disabled:cursor-default"
              disabled={!navigate}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => navigate?.(attrs, { apiBase })}
              type="button"
            >
              {label}
            </button>
            {editor.isEditable && hovered && (
              <button
                aria-label="移除引用"
                className="ml-0.5 grid size-3.5 shrink-0 place-items-center rounded-full hover:bg-background"
                onMouseDown={(event) => event.preventDefault()}
                onClick={deleteNode}
                type="button"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
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
            // 浮层挂在 body 上：按下不抢焦点，否则宿主的 blur 提交会退出编辑态。
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
            onOpenAutoFocus={(event) => event.preventDefault()}
            side="bottom"
            sideOffset={6}
          >
            {preview && <ContextPreviewPane insertMode="inline" preview={preview} />}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </NodeViewWrapper>
  );
}
