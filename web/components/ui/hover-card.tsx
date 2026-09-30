/*
 * [INPUT]: 依赖 radix-ui 的 HoverCard 原语、Portal 能力与 @/lib/utils 的样式组合能力
 * [OUTPUT]: 对外提供 HoverCard、HoverCardTrigger 与经 Portal 渲染的 HoverCardContent
 * [POS]: web/components/ui 的悬停浮层原子；供 Header 返回入口等「悬停即展开」的场景复用，悬停与聚焦均可打开，且不受父级堆叠上下文影响
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function HoverCard(props: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root {...props} />;
}

function HoverCardTrigger(props: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger {...props} />;
}

function HoverCardContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        className={cn("z-[100] w-64 rounded-sm border bg-card text-foreground outline-none shadow-[var(--shadow-overlay)]", className)}
        sideOffset={sideOffset}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
