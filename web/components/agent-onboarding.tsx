/*
 * [INPUT]: 依赖按项目或全局解析的 Agent onboarding HTTP API、/v1/agents 运行时状态与共享的 AgentInstallGuide 安装入口；React 状态
 * [OUTPUT]: 对外提供项目或通用新对话的可点击引导卡；点击时仅回填显式 prompt；在 runtimeStatus 报告无任何可用 runtime 时在引导卡上方追加 1–3 张本地 Agent 安装卡，点击打开共享安装对话框
 * [POS]: components 的新会话空态内容；App、全局与平台兜底配置都经同一后端契约进入此处；本地 Agent 未就绪时主动引导用户安装
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowUpRight, Sparkles, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";

import { RUNTIME_ORDER, runtimeAgentName, syntheticAgent, type AgentRuntimeStatus } from "@/components/agent-install-guide";

type Guide = { id: string; title: string; description: string; prompt: string };
const fallback: Guide[] = [
  { id: "platform-start", title: "告诉我你的目标", description: "从想做什么开始，我会把下一步拆清楚。", prompt: "我想开始一个新项目，但还不确定第一步。请先问我最关键的几个问题，再给出清晰、可执行的下一步。" },
  { id: "platform-plan", title: "一起规划", description: "把一个模糊想法变成有顺序的行动。", prompt: "请帮我把这个想法拆成最小可执行步骤。先确认目标、素材和交付物，再一次只引导我完成下一步。" },
];

export function AgentOnboarding({ apiBase, onChoose, onInstall, projectID, runtimeStatus }: { apiBase: string; onChoose: (prompt: string) => void; onInstall: (agent: AgentRuntimeStatus) => void; projectID: string | null; runtimeStatus: AgentRuntimeStatus[] }) {
  const [guides, setGuides] = useState<Guide[]>(fallback);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const query = projectID ? `?projectId=${encodeURIComponent(projectID)}` : "";
        const response = await fetch(`${apiBase}/v1/agent-onboarding${query}`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { items?: Guide[] };
        if (payload.items?.length) setGuides(payload.items);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setGuides(fallback);
      }
    })();
    return () => controller.abort();
  }, [apiBase, projectID]);

  // Build the install-card list from RUNTIME_ORDER so every supported runtime gets a card
  // even if the backend has not yet reported its status. Anything not in the runtimeStatus
  // payload is treated as "missing" and shown to the user.
  const missingAgents: AgentRuntimeStatus[] = RUNTIME_ORDER
    .map((id) => runtimeStatus.find((agent) => agent.id === id) ?? syntheticAgent(id))
    .filter((agent) => !agent.available);
  const showInstallCards = missingAgents.length > 0;

  return <section className="mx-auto grid w-full max-w-xl place-items-center py-10 text-center">
    <div className="w-full">
      {showInstallCards && (
        <div className="mb-7 border-b pb-6 text-left">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">本地 Agent CLI 未就绪</p>
          <p className="mt-1 text-xs text-muted-foreground">先在运行 Recut service 的设备上安装并登录下面任一 CLI，再点击「重新检查」。</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {missingAgents.map((agent) => <button className="group flex min-h-24 flex-col rounded-md border bg-card p-3 text-left transition hover:border-primary/45 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" key={agent.id} onClick={() => onInstall(agent)} type="button">
              <span className="flex items-center justify-between gap-3 text-xs font-medium"><span className="flex items-center gap-1.5"><TerminalSquare className="size-3.5 text-muted-foreground transition-colors group-hover:text-primary" />{runtimeAgentName(agent.id)}</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" /></span>
              <span className="mt-1.5 text-[11px] leading-4 text-muted-foreground">未安装 · 点击查看安装指引</span>
            </button>)}
          </div>
        </div>
      )}
      <span className="mx-auto grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"><Sparkles className="size-4" /></span>
      <h2 className="mt-4 text-sm font-semibold">今天想做什么？</h2>
      <p className="mt-1 text-xs text-muted-foreground">从一个引导开始，或直接在下方描述你的想法。</p>
      <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">{guides.map((guide) => <button className="group flex min-h-24 flex-col rounded-md border bg-card p-3 text-left transition hover:border-primary/45 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" key={guide.id} onClick={() => onChoose(guide.prompt)} type="button"><span className="flex items-center justify-between gap-3 text-xs font-medium">{guide.title}<ArrowUpRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" /></span>{guide.description && <span className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{guide.description}</span>}</button>)}</div>
    </div>
  </section>;
}
