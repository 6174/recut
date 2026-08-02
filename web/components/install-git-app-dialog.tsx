/*
 * [INPUT]: 依赖 React 状态能力、lucide 图标、通用 Button/Input，以及本地 service 的 App 安装 HTTP API
 * [OUTPUT]: 对外提供 InstallGitAppDialog 组件，接收 GitHub 仓库地址并安装标准 Recut App
 * [POS]: web/components 的 App 分发入口；由应用目录挂载，成功后交还父级刷新已安装 App
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { GitBranch, LoaderCircle, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InstallGitAppDialog({ apiBase, disabled, onInstalled }: { apiBase: string; disabled?: boolean; onInstalled: () => Promise<void> }) {
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
      const response = await fetch(`${apiBase}/v1/apps/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: repository.trim() }) });
      if (!response.ok) throw new Error(await responseMessage(response));
      await onInstalled();
      setRepository("");
      setOpen(false);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setInstalling(false);
    }
  }

  return <><Button disabled={disabled} onClick={() => setOpen(true)} type="button" variant="outline"><GitBranch className="size-4" />从 Git 安装</Button>{open && <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={close} role="dialog" aria-labelledby="install-git-app-title"><section className="w-full max-w-md rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">INSTALL FROM GIT</p><h2 className="mt-1 text-base font-semibold" id="install-git-app-title">从 Git 安装应用</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">粘贴 GitHub 仓库地址，Recut 会验证其中的 App manifest 后安装。</p></div><button aria-label="关闭 Git 安装" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted disabled:cursor-not-allowed" disabled={installing} onClick={close} type="button"><X className="size-4" /></button></header><form className="p-5" onSubmit={install}><label className="mb-2 block text-xs font-medium" htmlFor="git-app-repository">GitHub 仓库地址</label><Input autoFocus id="git-app-repository" onChange={(event) => setRepository(event.target.value)} placeholder="https://github.com/owner/recut-app.git" value={repository} /><p className="mt-2 text-[11px] leading-4 text-muted-foreground">仅支持公开的 HTTPS GitHub 仓库。</p>{error && <p className="mt-3 text-xs leading-5 text-destructive" role="alert">{error}</p>}<footer className="mt-5 flex justify-end gap-2"><Button disabled={installing} onClick={close} type="button" variant="ghost">取消</Button><Button disabled={!repository.trim() || installing} type="submit">{installing && <LoaderCircle className="size-4 animate-spin" />}{installing ? "正在安装…" : "安装应用"}</Button></footer></form></section></div>}</>;
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `请求失败（${response.status}）`;
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "安装失败，请检查仓库地址后重试";
}
