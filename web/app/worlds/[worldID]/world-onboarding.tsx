/*
 * [INPUT]: 依赖 recut-worlds-client 的 readiness 投影、agent-panel-context 的 composer 草稿与 i18n 字典
 * [OUTPUT]: 对外提供 World 详情页引导卡：就绪度进度、最值得先做的缺失项、可展开的完整清单与
 * 「让 AI 帮我完善」预填草稿（绝不自动发送、绝不自动写入）
 * [POS]: worlds/[worldID] 的 Onboarding 引导面；仅 local 世界渲染；AI 提案经 Agent 会话确认后由既有写工具落 Canon
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createRecutWorldsClient,
  type WorldDetail,
  type WorldMissingItem,
  type WorldReadiness,
  type WorldScenario,
} from "@/lib/recut-worlds-client";
import { useAgentPanelContext } from "@/lib/agent-panel-context";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";

export function WorldOnboardingCard({
  apiBase,
  world,
  scenario,
}: {
  apiBase: string;
  world: WorldDetail;
  scenario?: WorldScenario | null;
}) {
  const { t } = useI18n();
  const setDraft = useAgentPanelContext((state) => state.setDraft);
  const [readiness, setReadiness] = useState<WorldReadiness | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void createRecutWorldsClient(apiBase)
      .readiness({ worldId: world.id, scenario: scenario ?? undefined })
      .then((value) => {
        if (active) setReadiness(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [apiBase, scenario, world.id, world.revision.id]);

  if (failed || !readiness || readiness.level === "ready") return null;
  const next = readiness.missing.filter((item) => item.kind !== "identity")[0] ?? readiness.missing[0];

  function askAI() {
    if (!next) return;
    const lines = [
      interpolate(t("worlds.onboard.prompt.intro"), { name: world.name }),
      interpolate(t("worlds.onboard.prompt.next"), { title: next.title }),
      t("worlds.onboard.prompt.steps"),
      t("worlds.onboard.prompt.boundary"),
    ];
    setDraft({ id: `world-onboard-${world.id}`, text: lines.join("\n") });
  }

  return (
    <section aria-label={t("worlds.onboard.card.title")} className="mb-6 w-full rounded-md border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold">{t("worlds.onboard.card.title")}</h2>
        <Badge className="border-primary/25 bg-accent text-accent-foreground">{t(`worlds.onboard.level.${readiness.level}`)}</Badge>
        <div aria-hidden className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-background">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${readiness.score}%` }} />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{readiness.score}%</span>
      </div>
      {readiness.level === "skeleton" ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("worlds.onboard.skeleton.desc")}</p>
      ) : next ? (
        <div className="mt-2 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">{t("worlds.onboard.next.label")}</span>
          {" "}
          {next.title}
          {next.reason ? ` — ${next.reason}` : ""}
        </div>
      ) : null}
      {expanded && readiness.missing.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {readiness.missing.map((item) => (
            <MissingRow item={item} key={item.id} />
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button className="h-7 text-xs" onClick={askAI} type="button">
          <Sparkles aria-hidden className="size-3.5" />
          {t("worlds.onboard.action.ai")}
        </Button>
        {readiness.missing.length > 1 && (
          <Button className="h-7 text-xs" onClick={() => setExpanded((value) => !value)} type="button" variant="outline">
            {expanded ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
            {expanded ? t("worlds.onboard.action.hide") : interpolate(t("worlds.onboard.action.all"), { count: readiness.missing.length })}
          </Button>
        )}
        <span className="text-[10px] text-muted-foreground">{t("worlds.onboard.hint.confirm")}</span>
      </div>
    </section>
  );
}

function MissingRow({ item }: { item: WorldMissingItem }) {
  const { t } = useI18n();
  return (
    <li className="rounded-sm border bg-card px-3 py-2">
      <p className="text-xs font-medium">
        <span className="mr-2 rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t(`worlds.onboard.kind.${item.kind}`)}</span>
        {item.title}
      </p>
      {(item.reason || item.suggestion) && (
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {item.reason}
          {item.reason && item.suggestion ? " · " : ""}
          {item.suggestion}
        </p>
      )}
    </li>
  );
}
