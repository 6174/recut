/*
 * [INPUT]: 依赖 Zustand persist、工作台模式下的 service endpoint 默认值与 Daemon 的 health/system status HTTP API
 * [OUTPUT]: 对外提供 cloud 模式跨刷新持久化、local/LAN 模式固定默认地址的 endpoint，以及全局共享的 service 连接状态、版本、进程启动时间、能力、连接错误与去重刷新动作
 * [POS]: web/lib 的服务状态唯一真相；所有 HTTP、SSE 与 WebSocket 调用订阅 endpoint，根级 ServiceControl 负责初始化；开发与内嵌工作台绝不复用 cloud 的旧远程地址
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useLocaleStore } from "./i18n/locale-store";
import { t } from "./i18n/index";
import { interpolate } from "./i18n/workspace-dict";
import { defaultServiceEndpoint, isLANWorkspace, isLocalWorkspace, recutHeaders } from "@/lib/service-endpoint";

export type ServiceState = { phase: "checking" | "online" | "offline"; version: string; startedAt?: string; selfUpdate: boolean; selfRestart: boolean; error?: string };
type ServiceStore = { endpoint: string; service: ServiceState; refreshing: boolean; setEndpoint: (endpoint: string) => void; resetEndpoint: () => void; refresh: () => Promise<void> };

const checkingService: ServiceState = { phase: "checking", version: "—", selfUpdate: false, selfRestart: false, error: undefined };
const persistEndpoint = !isLocalWorkspace && !isLANWorkspace;

export const useServiceStore = create<ServiceStore>()(persist((set, get) => ({
  endpoint: defaultServiceEndpoint,
  service: checkingService,
  refreshing: false,
  setEndpoint(endpoint) { set({ endpoint, refreshing: false, service: checkingService }); },
  resetEndpoint() { set({ endpoint: defaultServiceEndpoint, refreshing: false, service: checkingService }); },
  async refresh() {
    if (get().refreshing) return;
    const endpoint = get().endpoint;
    set({ refreshing: true });
    try {
      const [health, status] = await Promise.all([fetch(`${endpoint}/health`, { cache: "no-store", headers: recutHeaders() }), fetch(`${endpoint}/v1/system/status`, { cache: "no-store", headers: recutHeaders() })]);
      if (!health.ok) throw new Error();
      const healthBody = await health.json() as { version?: string; startedAt?: string };
      const statusBody = status.ok ? await status.json() as { selfUpdate?: boolean; selfRestart?: boolean } : {};
      if (get().endpoint === endpoint) set({ service: { phase: "online", version: healthBody.version ?? "unknown", startedAt: healthBody.startedAt, selfUpdate: Boolean(statusBody.selfUpdate), selfRestart: Boolean(statusBody.selfRestart), error: undefined } });
    } catch {
      if (get().endpoint === endpoint) set({ service: { phase: "offline", version: "—", selfUpdate: false, selfRestart: false, error: interpolate(t("workspace", useLocaleStore.getState().locale, "store.health.failed"), { endpoint }) } });
    } finally { if (get().endpoint === endpoint) set({ refreshing: false }); }
  },
}), {
  name: "recut-service",
  skipHydration: !persistEndpoint,
  partialize: (state) => persistEndpoint ? { endpoint: state.endpoint } : {},
}));
