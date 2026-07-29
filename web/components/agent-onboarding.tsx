/*
 * [INPUT]: 依赖按项目解析的 Agent onboarding HTTP API 与 React 状态
 * [OUTPUT]: 对外提供新对话的可点击引导卡；点击时仅回填显式 prompt
 * [POS]: components 的新会话空态内容；App、全局与平台兜底配置都经同一后端契约进入此处
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowUpRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

type Guide = { id: string; title: string; description: string; prompt: string };
const fallback: Guide[] = [
  { id: "platform-start", title: "告诉我你的目标", description: "从想做什么开始，我会把下一步拆清楚。", prompt: "我想开始一个新项目，但还不确定第一步。请先问我最关键的几个问题，再给出清晰、可执行的下一步。" },
  { id: "platform-plan", title: "一起规划", description: "把一个模糊想法变成有顺序的行动。", prompt: "请帮我把这个想法拆成最小可执行步骤。先确认目标、素材和交付物，再一次只引导我完成下一步。" },
];

export function AgentOnboarding({ apiBase, onChoose, projectID }: { apiBase: string; onChoose: (prompt: string) => void; projectID: string | null }) {
  const [guides, setGuides] = useState<Guide[]>(fallback);

  useEffect(() => {
    if (!projectID) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/v1/agent-onboarding?projectId=${encodeURIComponent(projectID)}`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { items?: Guide[] };
        if (payload.items?.length) setGuides(payload.items);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setGuides(fallback);
      }
    })();
    return () => controller.abort();
  }, [apiBase, projectID]);

  return <section className="mx-auto grid w-full max-w-xl place-items-center py-10 text-center">
    <div>
      <span className="mx-auto grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"><Sparkles className="size-4" /></span>
      <h2 className="mt-4 text-sm font-semibold">今天想做什么？</h2>
      <p className="mt-1 text-xs text-muted-foreground">从一个引导开始，或直接在下方描述你的想法。</p>
      <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">{guides.map((guide) => <button className="group flex min-h-24 flex-col rounded-md border bg-card p-3 text-left transition hover:border-primary/45 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" key={guide.id} onClick={() => onChoose(guide.prompt)} type="button"><span className="flex items-center justify-between gap-3 text-xs font-medium">{guide.title}<ArrowUpRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" /></span>{guide.description && <span className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{guide.description}</span>}</button>)}</div>
    </div>
  </section>;
}
