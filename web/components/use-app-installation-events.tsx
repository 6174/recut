/*
 * [INPUT]: 依赖实时通道单例与 workspace-store 的显式目录刷新
 * [OUTPUT]: 对外提供 useAppInstallationEvents，在后台 Git 检查完成后刷新已安装 App 快照
 * [POS]: web/components 的 App 目录事件桥；根工作台壳唯一订阅，不轮询也不携带重复安装数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect } from "react";

import { getRealtimeChannel } from "@/lib/realtime-channel";
import { useWorkspaceStore } from "@/lib/workspace-store";

export function useAppInstallationEvents(apiBase: string, enabled: boolean) {
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  useEffect(() => {
    if (!enabled) return;
    const channel = getRealtimeChannel(apiBase);
    const unsubscribe = channel.subscribe("app", "", () => {
      void loadWorkspace(apiBase, true);
    });
    return unsubscribe;
  }, [apiBase, enabled, loadWorkspace]);
}
