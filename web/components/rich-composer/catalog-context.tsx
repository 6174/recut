/*
 * [INPUT]: 依赖 react context 与 context-catalog/types
 * [OUTPUT]: 对外提供 ContextCatalogProvider / useContextCatalogValue：把 runtime、apiBase 与 sourceFor 注入引用 chip，供 hover 预览解析 descriptor.preview
 * [POS]: web/components/rich-composer 的目录上下文；由 RichComposer 注入，ReferenceChip 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { createContext, useContext } from "react";
import type { ContextRuntime, ContextSource } from "@/lib/context-catalog/types";

type ContextCatalogValue = {
  runtime: ContextRuntime | null;
  apiBase: string;
  sourceFor: (type: string) => ContextSource | undefined;
};

const ContextCatalogContext = createContext<ContextCatalogValue>({ runtime: null, apiBase: "", sourceFor: () => undefined });

export const ContextCatalogProvider = ContextCatalogContext.Provider;

export function useContextCatalogValue(): ContextCatalogValue {
  return useContext(ContextCatalogContext);
}
