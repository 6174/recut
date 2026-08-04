/*
 * [INPUT]: 依赖 Zustand 与 Recut service 的 App、项目、已安装 App HTTP API
 * [OUTPUT]: 对外提供当前 service endpoint 的工作台目录单一快照、请求去重与显式失效刷新
 * [POS]: web/lib 的项目/App 目录缓存；写操作成功后刷新，绝不使用页面级定时轮询维持一致性
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";

export type WorkspaceApp = { manifest: { id: string; name: string; author: string; description: string; repository?: string; version: string; type: "project" | "standalone" } };
export type WorkspaceProject = { id: string; name: string; appId: string };
export type WorkspaceInstallation = { package: string; manifest: WorkspaceApp["manifest"]; repository?: string; revision?: string; dirty: boolean; updateAvailable: boolean; manageable: boolean; status?: string };
export type WorkspaceLoadState = "loading" | "ready" | "failed";

type WorkspaceStore = {
  endpoint: string | null;
  apps: WorkspaceApp[];
  projects: WorkspaceProject[];
  installations: WorkspaceInstallation[];
  state: WorkspaceLoadState;
  error: string;
  load: (endpoint: string, force?: boolean) => Promise<void>;
};

const requests = new Map<string, Promise<void>>();

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  endpoint: null,
  apps: [],
  projects: [],
  installations: [],
  state: "loading",
  error: "",
  load: async (endpoint, force = false) => {
    if (get().endpoint !== endpoint) set({ endpoint, apps: [], projects: [], installations: [], state: "loading", error: "" });
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
}));
