/*
 * [INPUT]: 依赖 react context 与 protocol/types 注册表
 * [OUTPUT]: 对外提供 ReferenceRegistryProvider / useReferenceRegistry：把 ContextSource 注册表注入引用 chip 与菜单
 * [POS]: web/components/rich-composer 的注册表上下文；让 NodeView 与菜单无需全局单例即可解析 descriptor
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { createContext, useContext } from "react";
import type { RefProtocolRegistry } from "@/lib/rich-composer/protocol/types";

const ReferenceRegistryContext = createContext<RefProtocolRegistry>([]);

export const ReferenceRegistryProvider = ReferenceRegistryContext.Provider;

export function useReferenceRegistry(): RefProtocolRegistry {
  return useContext(ReferenceRegistryContext);
}
