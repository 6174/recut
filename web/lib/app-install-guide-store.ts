/**
 * [INPUT]: 依赖 zustand 的全局状态与宿主项目/独立 App 容器里的 iframe Assets 桥。
 * [OUTPUT]: 对外提供 AppInstallGuideStore：任何宿主页面（项目/独立 App/工作台）都能通过
 *           openInstallGuide 拉起同一个全局 App 安装引导弹窗；iframe App 经 apps.request-install
 *           桥接调用它。安装中状态与错误文案统一收敛在此，避免各处自造一套安装 UI。
 * [POS]: web/lib 的全局 App 安装引导状态源；由 app-install-guide.tsx 消费，与
 *        workspace-store 的 installations 刷新协同。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { create } from "zustand";

export type AppInstallRequest = {
  appId?: string;
  name?: string;
  repository?: string;
};

type AppInstallGuideState = {
  request: AppInstallRequest | null;
  installing: boolean;
  error: string;
  openInstallGuide: (request: AppInstallRequest) => void;
  closeInstallGuide: () => void;
  setInstalling: (installing: boolean) => void;
  setError: (message: string) => void;
};

export const useAppInstallGuideStore = create<AppInstallGuideState>((set) => ({
  request: null,
  installing: false,
  error: "",
  openInstallGuide: (request) => set({ request, installing: false, error: "" }),
  closeInstallGuide: () => set({ request: null, installing: false, error: "" }),
  setInstalling: (installing) => set({ installing }),
  setError: (message) => set({ error: message }),
}));