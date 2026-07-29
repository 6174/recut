/*
 * [INPUT]: 依赖 @radix-ui/react-popover 的 Portal、焦点管理与碰撞处理能力，依赖 @/lib/utils 的样式组合能力
 * [OUTPUT]: 对外提供 Popover、PopoverTrigger 与经 Portal 渲染的 PopoverContent
 * [POS]: web/components/ui 的浮层原子；供 Header 和局部操作使用，避免受父级堆叠上下文或裁剪影响
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger {...props} />;
}

function PopoverContent({ className, sideOffset = 8, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return <PopoverPrimitive.Portal><PopoverPrimitive.Content className={cn("z-[100] rounded-sm border bg-card outline-none shadow-[var(--shadow-overlay)]", className)} sideOffset={sideOffset} {...props} /></PopoverPrimitive.Portal>;
}

export { Popover, PopoverContent, PopoverTrigger };
