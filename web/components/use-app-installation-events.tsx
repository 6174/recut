/*
 * [INPUT]: 依赖浏览器 EventSource、service endpoint 事件流地址与 workspace-store 的显式目录刷新
 * [OUTPUT]: 对外提供 useAppInstallationEvents，在后台 Git 检查完成后刷新已安装 App 快照
 * [POS]: web/components 的 App 目录事件桥；根工作台壳唯一订阅，不轮询也不携带重复安装数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect } from "react";

import { streamServiceEndpoint } from "@/lib/service-endpoint";
import { useWorkspaceStore } from "@/lib/workspace-store";

export function useAppInstallationEvents(apiBase: string, enabled: boolean) {
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  useEffect(() => {
    if (!enabled) return;
    const stream = new EventSource(`${streamServiceEndpoint(apiBase)}/v1/apps/events`);
    stream.addEventListener("app.installations.updated", () => void loadWorkspace(apiBase, true));
    return () => stream.close();
  }, [apiBase, enabled, loadWorkspace]);
}
