/*
 * [INPUT]: 依赖 @radix-ui/react-popover（Portal + Anchor + 碰撞翻转 + outside/Esc 关闭）与 ContextMentionPanel
 * [OUTPUT]: 对外提供 ContextMentionPopover：把面板挂到全局 Portal，按锚点/光标定位，自带上下翻转与视口夹取；可透传受控 query / autoFocusSearch / selectedKeys / selectedOptions
 * [POS]: web/components/context-panel 的浮层宿主；参考 antd Popover 的做法（独立 DOM 插到 body，相对锚点定位）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import type { WorkFocusContext, WorkSurfaceContext } from "@/components/agent-panel-types";
import type { ContextOption } from "@/lib/context-catalog/types";
import { ContextMentionPanel } from "./context-mention-panel";

export function ContextMentionPopover({
  open,
  anchor,
  anchorRect,
  apiBase,
  projectID,
  workSurface,
  workFocus,
  initialQuery,
  query,
  onQuery,
  autoFocusSearch,
  selectedKeys,
  selectedOptions,
  allowedRefTypes,
  onPick,
  onCancel,
  onDismiss,
}: {
  open: boolean;
  /** 锚点元素（如 composer 容器）；与 anchorRect 二选一 */
  anchor?: HTMLElement | null;
  /** 光标锚点（编辑器 @ 触发，视口坐标） */
  anchorRect?: { top: number; left: number } | null;
  apiBase: string;
  projectID: string | null;
  workSurface: WorkSurfaceContext | null;
  workFocus: WorkFocusContext | null;
  initialQuery?: string;
  /** 受控查询（编辑器驱动模式） */
  query?: string;
  onQuery?: (value: string) => void;
  /** 打开时是否聚焦面板搜索框；编辑器驱动模式传 false */
  autoFocusSearch?: boolean;
  selectedKeys: Set<string>;
  /** 已引用条目（置顶为「当前引用」分组） */
  selectedOptions?: ContextOption[];
  allowedRefTypes?: string[];
  onPick: (option: ContextOption, keepOpen: boolean) => void;
  /** 主动取消（Esc / 关闭按钮 / 选择后收起）：清理触发文本 */
  onCancel: () => void;
  /** 失焦/外部点击：只收起，不改正文 */
  onDismiss: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function place() {
      const box = anchorRect ?? anchor?.getBoundingClientRect() ?? null;
      setPos(box ? { top: box.top, left: box.left } : null);
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, anchorRect, open]);

  if (!open || !pos) return null;
  return (
    <PopoverPrimitive.Root open onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <PopoverPrimitive.Anchor asChild>
        <span aria-hidden style={{ position: "fixed", left: pos.left, top: pos.top, width: 1, height: 1, pointerEvents: "none" }} />
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          className="z-[200] h-[min(520px,calc(100vh-6rem))] w-[min(720px,calc(100vw-2rem))] bg-popover p-0 text-popover-foreground outline-none"
          collisionPadding={8}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => { event.preventDefault(); onCancel(); }}
          onInteractOutside={(event) => { event.preventDefault(); onDismiss(); }}
          // 浮层挂在 body 上：按下不抢焦点，否则宿主的 blur 提交会退出编辑态。
          onMouseDown={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="bottom"
          sideOffset={8}
        >
          <ContextMentionPanel
            allowedRefTypes={allowedRefTypes}
            apiBase={apiBase}
            autoFocusSearch={autoFocusSearch}
            initialQuery={initialQuery}
            onClose={onCancel}
            onPick={onPick}
            onQuery={onQuery}
            projectID={projectID}
            query={query}
            selectedKeys={selectedKeys}
            selectedOptions={selectedOptions}
            workFocus={workFocus}
            workSurface={workSurface}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
