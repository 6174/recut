/*
 * [INPUT]: 依赖 React 状态能力、lucide 图标、通用 Button/Input、本地 service 的 App 安装 HTTP API 与工作台 i18n 字典；请求经 fetchRecutJSON 附加 Accept-Language
 * [OUTPUT]: 对外提供 InstallGitAppDialog 组件，接收 GitHub 仓库地址并安装标准 Recut App
 * [POS]: web/components 的 App 分发入口；由应用目录挂载，成功后交还父级刷新已安装 App
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { GitBranch, LoaderCircle, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocaleStore } from "@/lib/i18n/locale-store";
import { t, useI18n } from "@/lib/i18n/index";
import { fetchRecutJSON } from "@/lib/service-endpoint";

export function InstallGitAppDialog({ apiBase, disabled, onInstalled }: { apiBase: string; disabled?: boolean; onInstalled: () => Promise<void> }) {
  const { t: text } = useI18n();
  const [open, setOpen] = useState(false);
  const [repository, setRepository] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !installing) setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [installing, open]);

  function close() {
    if (installing) return;
    setOpen(false);
    setError("");
  }

  async function install(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository.trim()) return;
    setInstalling(true);
    setError("");
    try {
      await fetchRecutJSON(apiBase, "/v1/apps/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: repository.trim() }) });
      await onInstalled();
      setRepository("");
      setOpen(false);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setInstalling(false);
    }
  }

  return <><Button disabled={disabled} onClick={() => setOpen(true)} type="button" variant="outline"><GitBranch className="size-4" />{text("git.button")}</Button>{open && <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={close} role="dialog" aria-labelledby="install-git-app-title"><section className="w-full max-w-md rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">INSTALL FROM GIT</p><h2 className="mt-1 text-base font-semibold" id="install-git-app-title">{text("git.title")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{text("git.desc")}</p></div><button aria-label={text("git.close")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted disabled:cursor-not-allowed" disabled={installing} onClick={close} type="button"><X className="size-4" /></button></header><form className="p-5" onSubmit={install}><label className="mb-2 block text-xs font-medium" htmlFor="git-app-repository">{text("git.label")}</label><Input autoFocus id="git-app-repository" onChange={(event) => setRepository(event.target.value)} placeholder={text("git.placeholder")} value={repository} /><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{text("git.hint")}</p>{error && <p className="mt-3 text-xs leading-5 text-destructive" role="alert">{error}</p>}<footer className="mt-5 flex justify-end gap-2"><Button disabled={installing} onClick={close} type="button" variant="ghost">{text("git.cancel")}</Button><Button disabled={!repository.trim() || installing} type="submit">{installing && <LoaderCircle className="size-4 animate-spin" />}{installing ? text("git.installing") : text("git.submit")}</Button></footer></form></section></div>}</>;
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : t("workspace", useLocaleStore.getState().locale, "git.failed");
}
