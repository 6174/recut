/*
 * [INPUT]: 依赖按项目或全局 scope 缓存的 Agent onboarding 快照、/v1/agents 运行时状态与共享的 AgentInstallGuide 安装入口
 * [OUTPUT]: 对外提供项目或通用新对话的可点击引导卡；点击时仅回填显式 prompt；仅在 runtimeStatus 报告无任何可用 runtime 时显示 1–3 张本地 Agent 安装卡，已有可用 runtime 时不展示额外 CLI 安装引导
 * [POS]: components 的新会话空态内容；App、全局与平台兜底配置由 lib/agent-store 共享，全部本地 Agent 未就绪时只保留安装路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowUpRight, Sparkles, TerminalSquare } from "lucide-react";
import { useEffect } from "react";

import { RUNTIME_ORDER, runtimeAgentName, syntheticAgent, type AgentRuntimeStatus } from "@/components/agent-install-guide";
import { agentScopeKey, useAgentStore, type AgentGuide } from "@/lib/agent-store";
import { useI18n } from "@/lib/i18n/index";

// 本地兜底引导卡（fallback 为空态时才展示）：title/description/prompt 均来自字典，按当前 locale 取值。
// TODO: 服务端下发的 onboardingByScope 引导卡（lib/agent-store 缓存）仍是服务端数据，后续需服务端侧按 locale 下发再本地化。
function fallbackGuides(t: (key: string) => string): AgentGuide[] {
  return [
    { id: "platform-start", title: t("agent.onboard.guide1.title"), description: t("agent.onboard.guide1.desc"), prompt: t("agent.onboard.guide1.prompt") },
    { id: "platform-plan", title: t("agent.onboard.guide2.title"), description: t("agent.onboard.guide2.desc"), prompt: t("agent.onboard.guide2.prompt") },
  ];
}

export function AgentOnboarding({ apiBase, onChoose, onInstall, projectID, runtimeStatus }: { apiBase: string; onChoose: (prompt: string) => void; onInstall: (agent: AgentRuntimeStatus) => void; projectID: string | null; runtimeStatus: AgentRuntimeStatus[] }) {
  const { t } = useI18n();
  const scope = agentScopeKey(projectID);
  const guides = useAgentStore((state) => state.onboardingByScope[scope]) ?? fallbackGuides(t);
  const loadOnboarding = useAgentStore((state) => state.loadOnboarding);

  useEffect(() => {
    void loadOnboarding(apiBase, scope);
  }, [apiBase, loadOnboarding, scope]);

  // Build the install-card list from RUNTIME_ORDER so every supported runtime gets a card
  // even if the backend has not yet reported its status. Anything not in the runtimeStatus
  // payload is treated as "missing" and shown to the user.
  const missingAgents: AgentRuntimeStatus[] = RUNTIME_ORDER
    .map((id) => runtimeStatus.find((agent) => agent.id === id) ?? syntheticAgent(id))
    .filter((agent) => !agent.available);
  const noRuntimeReady = !runtimeStatus.some((agent) => agent.available);

  return <section className="mx-auto grid w-full max-w-xl place-items-center py-10 text-center">
    <div className="w-full">
      {noRuntimeReady && (
        <div className="mb-7 border-b pb-6 text-left">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t("agent.onboard.installTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("agent.onboard.installDesc")}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {missingAgents.map((agent) => <button className="group flex min-h-24 flex-col rounded-md border bg-card p-3 text-left transition hover:border-primary/45 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" key={agent.id} onClick={() => onInstall(agent)} type="button">
              <span className="flex items-center justify-between gap-3 text-xs font-medium"><span className="flex items-center gap-1.5"><TerminalSquare className="size-3.5 text-muted-foreground transition-colors group-hover:text-primary" />{runtimeAgentName(agent.id)}</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" /></span>
              <span className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{t("agent.onboard.installHint")}</span>
            </button>)}
          </div>
        </div>
      )}
      {!noRuntimeReady && <><span className="mx-auto grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"><Sparkles className="size-4" /></span>
        <h2 className="mt-4 text-sm font-semibold">{t("agent.onboard.welcomeTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("agent.onboard.welcomeDesc")}</p>
        <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">{guides.map((guide) => <button className="group flex min-h-24 flex-col rounded-md border bg-card p-3 text-left transition hover:border-primary/45 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" key={guide.id} onClick={() => onChoose(guide.prompt)} type="button"><span className="flex items-center justify-between gap-3 text-xs font-medium">{guide.title}<ArrowUpRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" /></span>{guide.description && <span className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{guide.description}</span>}</button>)}</div>
      </>}
    </div>
  </section>;
}
