/*
 * [INPUT]: 依赖 Zustand 与 Recut service 的 Provider、Credential、Route HTTP API
 * [OUTPUT]: 对外提供按 endpoint 去重的 Provider、脱敏 Credential、用途 Route 配置快照与显式刷新动作
 * [POS]: web/lib 的媒体配置唯一缓存；Settings、素材创建和 iframe App 宿主共享，API Key 输入草稿绝不进入此处
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";

import type { Credential, Provider } from "@/app/media/media-types";

export type MediaProvider = Provider & { defaultApiBase: string };
export type MediaCredential = Credential & { secretSet?: boolean };
export type MediaRoute = {
  id: string;
  capability: string;
  modelId: string;
  credentialId: string;
  enabled: boolean;
};
export type MediaConfigurationState = "idle" | "loading" | "ready" | "failed";

type MediaConfigurationStore = {
  endpoint: string | null;
  providers: MediaProvider[];
  credentials: MediaCredential[];
  routes: MediaRoute[];
  state: MediaConfigurationState;
  error: string;
  load: (endpoint: string, force?: boolean) => Promise<void>;
};

const requests = new Map<string, Promise<void>>();

function emptyConfiguration(endpoint: string) {
  return {
    endpoint,
    providers: [],
    credentials: [],
    routes: [],
    state: "idle" as const,
    error: "",
  };
}

export const useMediaConfigurationStore = create<MediaConfigurationStore>((set, get) => ({
  endpoint: null,
  providers: [],
  credentials: [],
  routes: [],
  state: "idle",
  error: "",
  load: async (endpoint, force = false) => {
    if (get().endpoint !== endpoint) set(emptyConfiguration(endpoint));
    if (!force && get().state === "ready") return;
    const current = requests.get(endpoint);
    if (current) return current;
    const pending = (async () => {
      set({ state: "loading", error: "" });
      try {
        const [providerResponse, credentialResponse, routeResponse] = await Promise.all([
          fetch(`${endpoint}/v1/media/providers`),
          fetch(`${endpoint}/v1/media/credentials`),
          fetch(`${endpoint}/v1/media/routes`),
        ]);
        if (!providerResponse.ok || !credentialResponse.ok || !routeResponse.ok) {
          throw new Error("媒体配置读取失败");
        }
        const [providers, credentials, routes] = await Promise.all([
          providerResponse.json() as Promise<MediaProvider[]>,
          credentialResponse.json() as Promise<MediaCredential[]>,
          routeResponse.json() as Promise<MediaRoute[]>,
        ]);
        if (get().endpoint === endpoint) {
          set({ providers, credentials, routes, state: "ready", error: "" });
        }
      } catch {
        if (get().endpoint === endpoint) {
          set({ state: "failed", error: "无法读取 AI 服务配置，请检查 service 连接。" });
        }
      } finally {
        requests.delete(endpoint);
      }
    })();
    requests.set(endpoint, pending);
    return pending;
  },
}));
