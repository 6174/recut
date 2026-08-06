/*
 * [INPUT]: 依赖 Zustand 与 Recut service 的 App、项目、已安装 App HTTP API
 * [OUTPUT]: 对外提供含可选媒体封面的当前 service 项目/App/安装目录、按 ID 项目详情、独立 App scope 快照、请求去重与显式失效刷新
 * [POS]: web/lib 的工作台目录缓存；写操作成功后刷新，绝不使用页面级定时轮询维持一致性
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";

export type WorkspaceApp = { manifest: { id: string; name: string; author: string; description: string; repository?: string; version: string; type: "project" | "standalone"; ui?: { projectView?: string; standaloneView?: string } } };
export type WorkspaceProjectCover = { assetId: string; kind: "image" | "video" };
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
  projectDetailsByID: Record<string, WorkspaceProjectDetail>;
  workspaceScopesByAppID: Record<string, WorkspaceScope>;
  state: WorkspaceLoadState;
  error: string;
  load: (endpoint: string, force?: boolean) => Promise<void>;
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
    projectDetailsByID: {},
    workspaceScopesByAppID: {},
    state: "loading" as const,
    error: "",
  };
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  endpoint: null,
  apps: [],
  projects: [],
  installations: [],
  projectDetailsByID: {},
  workspaceScopesByAppID: {},
  state: "loading",
  error: "",
  load: async (endpoint, force = false) => {
    if (get().endpoint !== endpoint) set(emptyWorkspace(endpoint));
    if (!force && get().state === "ready") return;
    const current = requests.get(endpoint);
    if (current) return current;
    const pending = (async () => {
      set({ state: "loading", error: "" });
      try {
        const [appResponse, projectResponse, installationResponse] = await Promise.all([fetch(`${endpoint}/v1/apps`), fetch(`${endpoint}/v1/projects`), fetch(`${endpoint}/v1/apps/installed`)]);
        if (!appResponse.ok || !projectResponse.ok || !installationResponse.ok) throw new Error("本地 service 返回了无效响应");
        const [apps, projects, installations] = await Promise.all([appResponse.json() as Promise<WorkspaceApp[]>, projectResponse.json() as Promise<WorkspaceProject[]>, installationResponse.json() as Promise<WorkspaceInstallation[]>]);
        if (get().endpoint === endpoint) set({ apps, projects, installations, state: "ready", error: "" });
      } catch {
        if (get().endpoint === endpoint) set({ state: "failed", error: "无法读取已安装 App，请稍后重试。" });
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
      const response = await fetch(`${endpoint}/v1/projects/${encodeURIComponent(projectID)}`);
      if (!response.ok) throw new Error("无法读取项目");
      const project = await response.json() as WorkspaceProjectDetail;
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
      const response = await fetch(`${endpoint}/v1/apps/${encodeURIComponent(appID)}/workspace`);
      if (!response.ok) throw new Error("无法读取 App 工作区");
      const scope = await response.json() as WorkspaceScope;
      if (get().endpoint === endpoint) {
        set((state) => ({ workspaceScopesByAppID: { ...state.workspaceScopesByAppID, [appID]: scope } }));
      }
      return scope;
    })().finally(() => scopeRequests.delete(key));
    scopeRequests.set(key, pending);
    return pending;
  },
}));
