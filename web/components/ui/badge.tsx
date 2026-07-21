/*
 * [INPUT]: 依赖 React DOM 类型和 @/lib/utils 的样式组合能力
 * [OUTPUT]: 对外提供 Badge 状态标签组件
 * [POS]: web/components/ui 的 shadcn 信息原子，标识本地连接与 App 版本
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as React from "react";

import { cn } from "@/lib/utils";

function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("inline-flex h-5 items-center rounded-xs border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground", className)} data-slot="badge" {...props} />;
}

export { Badge };
