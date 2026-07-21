/*
 * [INPUT]: 依赖 React 输入类型和 @/lib/utils 的样式组合能力
 * [OUTPUT]: 对外提供 Input 单行表单组件
 * [POS]: web/components/ui 的 shadcn 表单原子，被项目创建流程消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input className={cn("h-8 w-full min-w-0 rounded-xs border border-input bg-background px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50", className)} data-slot="input" type={type} {...props} />;
}

export { Input };
