/*
 * [INPUT]: 依赖 Zustand 与 Recut service 的 App、项目、已安装 App HTTP API；经 fetchRecutJSON 统一附加 Accept-Language
 * [OUTPUT]: 对外提供含可选媒体封面的当前 service 项目/App/安装目录及各自独立的读取状态与具体失败原因、按 ID 项目详情、独立 App scope 快照、请求去重与显式失效刷新
 * [POS]: web/lib 的工作台目录缓存；写操作成功后刷新，绝不使用页面级定时轮询维持一致性
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { loadMarketplace as fetchMarketplace, type MarketplaceApp } from "@/lib/appstore";
import { useLocaleStore } from "./i18n/locale-store";
import { t } from "./i18n/index";
import { fetchRecutJSON } from "./service-endpoint";

export type WorkspaceApp = { manifest: { id: string; name: string; author: string; description: string; repository?: string; version: string; type: "project" | "standalone"; ui?: { projectView?: string; standaloneView?: string }; agentSurface?: { domain: string; defaultIntent: "browse" | "create" | "project_edit" | "world_review" | "media_manage"; requiredSkill?: string } } };
export type WorkspaceProjectCover = { source?: "asset" | "file"; assetId?: string; kind: "image" | "video"; filePath?: string; mimeType?: string };
export type WorkspaceProject = { id: string; name: string; appId: string; cover?: WorkspaceProjectCover };
export type WorkspaceProjectDetail = WorkspaceProject & { appVersion: string; createdAt: string };
export type WorkspaceScope = { id: string; name: string; appId: string; appVersion: string };
export type WorkspaceInstallation = { package: string; manifest: WorkspaceApp["manifest"]; repository?: string; revision?: string; dirty: boolean; updateAvailable: boolean; manageable: boolean; status?: string };
export type WorkspaceLoadState = "loading" | "ready" | "failed";

type WorkspaceStore = {
  endpoint: string | null;
  apps: WorkspaceApp[];
  projects: WorkspaceProject[];
  installations: WorkspaceInstallation[];
  marketplace: MarketplaceApp[];
  marketplaceState: WorkspaceLoadState;
  projectDetailsByID: Record<string, WorkspaceProjectDetail>;
  workspaceScopesByAppID: Record<string, WorkspaceScope>;
  state: WorkspaceLoadState;
  error: string;
  installationsState: WorkspaceLoadState;
  installationsError: string;
  load: (endpoint: string, force?: boolean) => Promise<void>;
  loadMarketplace: (force?: boolean) => Promise<void>;
  loadProject: (endpoint: string, projectID: string, force?: boolean) => Promise<WorkspaceProjectDetail>;
  loadWorkspaceScope: (endpoint: string, appID: string, force?: boolean) => Promise<WorkspaceScope>;
};

const requests = new Map<string, Promise<void>>();
const projectRequests = new Map<string, Promise<WorkspaceProjectDetail>>();
const scopeRequests = new Map<string, Promise<WorkspaceScope>>();

function emptyWorkspace(endpoint: string) {
  return {
    endpoint,
    apps: [],
    projects: [],
    installations: [],
    marketplace: [],
    marketplaceState: "loading" as const,
    projectDetailsByID: {},
    workspaceScopesByAppID: {},
    state: "loading" as const,
    error: "",
    installationsState: "loading" as const,
    installationsError: "",
  };
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  endpoint: null,
  apps: [],
  projects: [],
  installations: [],
  marketplace: [],
  marketplaceState: "loading",
  projectDetailsByID: {},
  workspaceScopesByAppID: {},
  state: "loading",
  error: "",
  installationsState: "loading",
  installationsError: "",
  loadMarketplace: async (force = false) => {
    if (!force && get().marketplaceState === "ready") return;
    set({ marketplaceState: "loading" });
    const apps = await fetchMarketplace();
    set({ marketplace: apps, marketplaceState: "ready" });
  },
  load: async (endpoint, force = false) => {
    if (get().endpoint !== endpoint) set(emptyWorkspace(endpoint));
    if (!force && get().state === "ready") return;
    const current = requests.get(endpoint);
    if (current) return current;
    const pending = (async () => {
      set({ state: "loading", error: "", installationsState: "loading", installationsError: "" });
      try {
        const [appsResult, projectsResult, installationsResult] = await Promise.allSettled([
          fetchRecutJSON<WorkspaceApp[]>(endpoint, "/v1/apps", undefined, { labelKey: "store.catalog" }),
          fetchRecutJSON<WorkspaceProject[]>(endpoint, "/v1/projects", undefined, { labelKey: "store.projects.list" }),
          fetchRecutJSON<WorkspaceInstallation[]>(endpoint, "/v1/apps/installed", undefined, { labelKey: "store.apps.installed" }),
        ]);
        if (get().endpoint !== endpoint) return;
        const failures = [appsResult, projectsResult, installationsResult].filter((result): result is PromiseRejectedResult => result.status === "rejected");
        set({
          apps: appsResult.status === "fulfilled" ? appsResult.value : [],
          projects: projectsResult.status === "fulfilled" ? projectsResult.value : [],
          installations: installationsResult.status === "fulfilled" ? installationsResult.value : [],
          state: failures.length ? "failed" : "ready",
          error: failures.map((result) => messageOf(result.reason)).join("；"),
          installationsState: installationsResult.status === "fulfilled" ? "ready" : "failed",
          installationsError: installationsResult.status === "rejected" ? messageOf(installationsResult.reason) : "",
        });
      } finally {
        requests.delete(endpoint);
      }
    })();
    requests.set(endpoint, pending);
    return pending;
  },
  loadProject: async (endpoint, projectID, force = false) => {
    if (get().endpoint !== endpoint) set(emptyWorkspace(endpoint));
    const cached = get().projectDetailsByID[projectID];
    if (!force && cached) return cached;
    const key = `${endpoint}:project:${projectID}`;
    const current = projectRequests.get(key);
    if (current) return current;
    const pending = (async () => {
      const project = await fetchRecutJSON<WorkspaceProjectDetail>(endpoint, `/v1/projects/${encodeURIComponent(projectID)}`, undefined, { messageKey: "store.unreadable.project" });
      if (get().endpoint === endpoint) {
        set((state) => ({ projectDetailsByID: { ...state.projectDetailsByID, [projectID]: project } }));
      }
      return project;
    })().finally(() => projectRequests.delete(key));
    projectRequests.set(key, pending);
    return pending;
  },
  loadWorkspaceScope: async (endpoint, appID, force = false) => {
    if (get().endpoint !== endpoint) set(emptyWorkspace(endpoint));
    const cached = get().workspaceScopesByAppID[appID];
    if (!force && cached) return cached;
    const key = `${endpoint}:workspace:${appID}`;
    const current = scopeRequests.get(key);
    if (current) return current;
    const pending = (async () => {
      const scope = await fetchRecutJSON<WorkspaceScope>(endpoint, `/v1/apps/${encodeURIComponent(appID)}/workspace`, undefined, { messageKey: "store.unreadable.workspace" });
      if (get().endpoint === endpoint) {
        set((state) => ({ workspaceScopesByAppID: { ...state.workspaceScopesByAppID, [appID]: scope } }));
      }
      return scope;
    })().finally(() => scopeRequests.delete(key));
    scopeRequests.set(key, pending);
    return pending;
  },
}));

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : t("workspace", useLocaleStore.getState().locale, "store.noReason");
}
