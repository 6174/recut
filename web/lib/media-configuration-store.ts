/*
 * [INPUT]: 依赖 Zustand 与 Recut service 的 Provider、Credential、Route HTTP API；经 fetchRecutJSON 统一附加 Accept-Language
 * [OUTPUT]: 对外提供按 endpoint 去重的 Provider、脱敏 Credential、用途 Route 配置快照与显式刷新动作
 * [POS]: web/lib 的媒体配置唯一缓存；Settings、素材创建和 iframe App 宿主共享，API Key 输入草稿绝不进入此处
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";

import type { Credential, Provider } from "@/app/media/media-types";
import { useLocaleStore } from "./i18n/locale-store";
import { t } from "./i18n/index";
import { fetchRecutJSON } from "./service-endpoint";

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
        const [providers, credentials, routes] = await Promise.all([
          fetchRecutJSON<MediaProvider[]>(endpoint, "/v1/media/providers"),
          fetchRecutJSON<MediaCredential[]>(endpoint, "/v1/media/credentials"),
          fetchRecutJSON<MediaRoute[]>(endpoint, "/v1/media/routes"),
        ]);
        if (get().endpoint === endpoint) {
          set({ providers, credentials, routes, state: "ready", error: "" });
        }
      } catch {
        if (get().endpoint === endpoint) {
          set({ state: "failed", error: t("workspace", useLocaleStore.getState().locale, "store.media.unreadable") });
        }
      } finally {
        requests.delete(endpoint);
      }
    })();
    requests.set(endpoint, pending);
    return pending;
  },
}));
