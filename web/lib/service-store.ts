/*
 * [INPUT]: 依赖 Zustand、service endpoint 配置与 Daemon 的 health/system status HTTP API
 * [OUTPUT]: 对外提供全局共享的 service 连接状态、版本、能力与去重刷新动作
 * [POS]: web/lib 的服务状态唯一真相；根级 ServiceControl 负责初始化，业务页面只消费结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { getServiceEndpoint } from "@/lib/service-endpoint";

export type ServiceState = { phase: "checking" | "online" | "offline"; version: string; selfUpdate: boolean; selfRestart: boolean };
type ServiceStore = { service: ServiceState; refreshing: boolean; refresh: () => Promise<void> };

export const useServiceStore = create<ServiceStore>((set, get) => ({
  service: { phase: "checking", version: "—", selfUpdate: false, selfRestart: false },
  refreshing: false,
  async refresh() {
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      const apiBase = getServiceEndpoint();
      const [health, status] = await Promise.all([fetch(`${apiBase}/health`, { cache: "no-store" }), fetch(`${apiBase}/v1/system/status`, { cache: "no-store" })]);
      if (!health.ok) throw new Error();
      const healthBody = await health.json() as { version?: string };
      const statusBody = status.ok ? await status.json() as { selfUpdate?: boolean; selfRestart?: boolean } : {};
      set({ service: { phase: "online", version: healthBody.version ?? "unknown", selfUpdate: Boolean(statusBody.selfUpdate), selfRestart: Boolean(statusBody.selfRestart) } });
    } catch { set({ service: { phase: "offline", version: "—", selfUpdate: false, selfRestart: false } }); } finally { set({ refreshing: false }); }
  },
}));
