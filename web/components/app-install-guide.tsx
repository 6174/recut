/*
 * [INPUT]: 依赖 AppInstallGuideStore（全局安装引导状态）、Service 端点的 App 安装 HTTP API、
 *          workspace-store 的安装刷新与应用商店 i18n 字典；请求经 fetchRecutJSON 附加 Accept-Language。
 * [OUTPUT]: 对外提供全局统一的 App 安装引导弹窗：任何宿主页面调用 openInstallGuide 即可拉起，
 *           iframe App 经 apps.request-install 桥接触发；安装中/失败状态由同一 store 收敛。
 * [POS]: web/components 的全局 App 分发引导层；根布局挂载一次，替代各页面自造的安装 UI。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { LoaderCircle, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppInstallGuideStore } from "@/lib/app-install-guide-store";
import { useI18n } from "@/lib/i18n/index";
import { fetchRecutJSON } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore } from "@/lib/workspace-store";

export function AppInstallGuide() {
  const { t } = useI18n();
  const apiBase = useServiceStore((state) => state.endpoint);
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const request = useAppInstallGuideStore((state) => state.request);
  const installing = useAppInstallGuideStore((state) => state.installing);
  const error = useAppInstallGuideStore((state) => state.error);
  const openInstallGuide = useAppInstallGuideStore((state) => state.openInstallGuide);
  const closeInstallGuide = useAppInstallGuideStore((state) => state.closeInstallGuide);
  const setInstalling = useAppInstallGuideStore((state) => state.setInstalling);
  const setError = useAppInstallGuideStore((state) => state.setError);

  useEffect(() => {
    if (!request) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !installing) closeInstallGuide();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [installing, request, closeInstallGuide]);

  if (!request) return null;
  const title = request.name && request.appId ? `${request.name}（${request.appId}）` : request.appId ?? t("git.title");

  async function install(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const repository = request?.repository ?? "";
    if (!request || !repository.trim() || installing) return;
    setInstalling(true);
    setError("");
    try {
      await fetchRecutJSON(apiBase, "/v1/apps/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: repository.trim() }) });
      if (apiBase) await loadWorkspace(apiBase, true);
      closeInstallGuide();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("git.failed");
      setError(message);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-[1px]" role="dialog" aria-labelledby="app-install-guide-title" onMouseDown={() => { if (!installing) closeInstallGuide(); }}>
      <section className="w-full max-w-md rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">RECUT APP — INSTALL GUIDE</p>
            <h2 className="mt-1 text-base font-semibold" id="app-install-guide-title">{t("git.title")}</h2>
            <p className="mt-1 text-xs leading-5 text-foreground/80">{request.name && request.appId ? <>{request.name} {t("git.needForCaptions")}</> : t("git.desc")}</p>
          </div>
          <button aria-label={t("git.close")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted disabled:cursor-not-allowed" disabled={installing} onClick={closeInstallGuide} type="button"><X className="size-4" /></button>
        </header>
        <form className="p-5" onSubmit={install}>
          <label className="mb-2 block text-xs font-medium" htmlFor="app-install-guide-app">{title}</label>
          <Input autoFocus disabled={installing} id="app-install-guide-app" onChange={(event) => { if (request?.repository === undefined) openInstallGuide({ ...request, repository: event.target.value }); }} placeholder={t("git.placeholder")} readOnly={Boolean(request?.repository)} value={request?.repository ?? ""} />
          {!request?.repository && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{t("git.hint")}</p>}
          {error && <p className="mt-3 text-xs leading-5 text-destructive" role="alert">{error}</p>}
          <footer className="mt-5 flex justify-end gap-2">
            <Button disabled={installing} onClick={closeInstallGuide} type="button" variant="ghost">{t("git.cancel")}</Button>
            <Button disabled={!request?.repository?.trim() || installing} type="submit">{installing && <LoaderCircle className="size-4 animate-spin" />}{installing ? t("git.installing") : t("git.submit")}</Button>
          </footer>
        </form>
      </section>
    </div>
  );
}