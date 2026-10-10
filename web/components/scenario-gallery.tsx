/*
 * [INPUT]: 依赖 lib/scenarios 的场景目录与 localizedLabel、ScenarioDialog（填写并组装草稿）、工作台 scenario i18n
 * [OUTPUT]: 对外提供 ScenarioGallery：面向「用户需求层」的创作场景卡片区（顶部独立区域），全部场景以卡片平铺，点选后填写表单并把草稿交 AI 输入框
 * [POS]: web/components 的需求场景入口；项目首页顶部消费，只回填草稿、绝不自动发送
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useState } from "react";

import { ScenarioDialog } from "@/components/scenario-dialog";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { localizedLabel, SCENARIOS, type Scenario } from "@/lib/scenarios";

export function ScenarioGallery({ apiBase, onCompose }: { apiBase: string; onCompose: (text: string) => void }) {
  const { locale, t } = useI18n();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  return (
    <>
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="text-3xl font-semibold tracking-tight">{t("scenario.section.title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("scenario.section.desc")}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {SCENARIOS.map((item) => {
            const Icon = item.icon;
            const title = localizedLabel(item.title, locale);
            return (
              <button
                aria-label={interpolate(t("scenario.card.aria"), { title })}
                className="group flex min-h-28 min-w-0 flex-col rounded-lg border border-border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[var(--shadow-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                key={item.id}
                onClick={() => setScenario(item)}
                type="button"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition group-hover:bg-secondary">
                  <Icon className="size-4" />
                </span>
                <span className="mt-3 block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground line-clamp-2">{localizedLabel(item.description, locale)}</span>
              </button>
            );
          })}
        </div>
      </section>
      {scenario && (
        <ScenarioDialog
          apiBase={apiBase}
          key={scenario.id}
          onClose={() => setScenario(null)}
          onSubmit={(text) => {
            onCompose(text);
            setScenario(null);
          }}
          scenario={scenario}
        />
      )}
    </>
  );
}
