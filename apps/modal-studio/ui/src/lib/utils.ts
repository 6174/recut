/**
 * [INPUT]: 依赖 clsx 与 tailwind-merge
 * [OUTPUT]: 对外提供 shadcn/ui 组件的类名合并工具 cn
 * [POS]: ui/src 的工具边界；组件通过 cn 组合语义类名
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
