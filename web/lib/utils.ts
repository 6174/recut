/*
 * [INPUT]: 依赖 clsx 和 tailwind-merge 的类名处理能力
 * [OUTPUT]: 对外提供 cn，安全合并条件 Tailwind className
 * [POS]: web/lib 的基础样式工具，被所有 shadcn 原子组件复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
