/*
 * [INPUT]: 依赖 React 状态能力、lucide 图标与 AgentInstallGuide 的三步安装正文
 * [OUTPUT]: 对外提供 AgentInstallDialog 共享模态对话框，接收当前要引导安装的 Agent 与 recheck 回调，经 document.body Portal 渲染安装三步并在 recheck 期间禁用关闭，recheck 是否成功的语义由父级通过返回值自行决定
 * [POS]: web/components 的本地 Agent CLI 主动安装入口；由空态安装卡、RuntimePicker 未就绪项与未来 settings 本地 Agent 分类复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AgentInstallGuide, type AgentRuntimeStatus } from "@/components/agent-install-guide";

export function AgentInstallDialog({ agent, open, onClose, onRecheck }: { agent: AgentRuntimeStatus | null; open: boolean; onClose: () => void; onRecheck: () => Promise<AgentRuntimeStatus[] | null> }) {
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !checking) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, checking, onClose]);

  // Reset transient recheck state when the dialog closes or switches to a different agent,
  // so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setChecking(false);
      setCheckFailed(false);
    }
  }, [open, agent?.id]);

  if (!open || !agent) return null;

  async function recheck() {
    if (checking) return;
    setChecking(true);
    setCheckFailed(false);
    try {
      await onRecheck();
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }

  function close() { if (!checking) onClose(); }

  return createPortal(<div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={close} role="dialog" aria-labelledby="agent-install-title">
    <section className="flex w-full max-w-md flex-col overflow-hidden rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">INSTALL AGENT</p>
          <h2 className="mt-1 text-base font-semibold" id="agent-install-title">安装 {agent.name} CLI</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">在运行 Recut service 的设备上完成下列步骤，完成后点击重新检查。</p>
        </div>
        <button aria-label={`关闭 ${agent.name} 安装引导`} className="grid size-8 shrink-0 place-items-center rounded-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed" disabled={checking} onClick={close} type="button">
          <X className="size-4" />
        </button>
      </header>
      <div className="p-5">
        <AgentInstallGuide agent={agent} checkFailed={checkFailed} checking={checking} onRecheck={recheck} />
      </div>
    </section>
  </div>, document.body);
}
