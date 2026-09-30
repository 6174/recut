/*
 * [INPUT]: 依赖 radix-ui 的 DropdownMenu 原语（Portal/焦点管理/碰撞处理）与 @/lib/utils 的样式组合能力
 * [OUTPUT]: 对外提供 DropdownMenu、DropdownMenuTrigger、经 Portal 渲染的 DropdownMenuContent，
 * 以及 DropdownMenuItem / DropdownMenuLabel / DropdownMenuSeparator；条目统一为「图标在左、文案在右」的单行结构（[&>svg] 统一 16px）。
 * [POS]: web/components/ui 的浮层菜单原子；供工具栏等「一枚入口 + 选项集合」的场景复用，
 * 避免每个调用方各写一枚手搓菜单（开合、键盘导航、外点关闭、边界碰撞都由原语承担）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root {...props} />;
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger {...props} />;
}

function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          "z-[100] min-w-36 overflow-hidden rounded-sm border bg-popover p-1 text-sm text-popover-foreground outline-none shadow-[var(--shadow-overlay)]",
          className,
        )}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-xs px-2 py-1.5 text-sm text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-muted [&>svg]:size-4 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn("px-2 py-1 text-[11px] font-medium text-muted-foreground", className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
