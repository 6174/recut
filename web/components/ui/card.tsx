/*
 * [INPUT]: 依赖 React DOM 类型和 @/lib/utils 的样式组合能力
 * [OUTPUT]: 对外提供 Card、CardHeader、CardTitle、CardDescription、CardContent、CardFooter
 * [POS]: web/components/ui 的 shadcn 容器原子，承载工作台的结构化信息区
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as React from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-xs border border-border bg-card text-card-foreground", className)} data-slot="card" {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("space-y-1 border-b border-border px-4 py-3", className)} data-slot="card-header" {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-sm font-medium tracking-tight", className)} data-slot="card-title" {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} data-slot="card-description" {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-4 py-3", className)} data-slot="card-content" {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center border-t border-border px-4 py-3", className)} data-slot="card-footer" {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
