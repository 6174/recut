/*
 * [INPUT]: 依赖 Zustand persist、service endpoint 默认值与 Daemon 的 health/system status HTTP API
 * [OUTPUT]: 对外提供跨刷新持久化的 endpoint、全局共享的 service 连接状态、版本、进程启动时间、能力、连接错误与去重刷新动作
 * [POS]: web/lib 的服务状态唯一真相；所有 HTTP、SSE 与 WebSocket 调用订阅 endpoint，根级 ServiceControl 负责初始化
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultServiceEndpoint } from "@/lib/service-endpoint";

export type ServiceState = { phase: "checking" | "online" | "offline"; version: string; startedAt?: string; selfUpdate: boolean; selfRestart: boolean; error?: string };
type ServiceStore = { endpoint: string; service: ServiceState; refreshing: boolean; setEndpoint: (endpoint: string) => void; resetEndpoint: () => void; refresh: () => Promise<void> };

const checkingService: ServiceState = { phase: "checking", version: "—", selfUpdate: false, selfRestart: false, error: undefined };

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
      const [health, status] = await Promise.all([fetch(`${endpoint}/health`, { cache: "no-store" }), fetch(`${endpoint}/v1/system/status`, { cache: "no-store" })]);
      if (!health.ok) throw new Error();
      const healthBody = await health.json() as { version?: string; startedAt?: string };
      const statusBody = status.ok ? await status.json() as { selfUpdate?: boolean; selfRestart?: boolean } : {};
      if (get().endpoint === endpoint) set({ service: { phase: "online", version: healthBody.version ?? "unknown", startedAt: healthBody.startedAt, selfUpdate: Boolean(statusBody.selfUpdate), selfRestart: Boolean(statusBody.selfRestart), error: undefined } });
    } catch {
      if (get().endpoint === endpoint) set({ service: { phase: "offline", version: "—", selfUpdate: false, selfRestart: false, error: `无法连接 ${endpoint}/health；请检查 service 是否启动，并查看安装命令输出的日志。` } });
    } finally { if (get().endpoint === endpoint) set({ refreshing: false }); }
  },
}), { name: "recut-service", partialize: (state) => ({ endpoint: state.endpoint }) }));
