/*
 * [INPUT]: 依赖 WorldSummary 类型、Card 原子组件与 lucide 图标
 * [OUTPUT]: 对外提供 Worlds 列表与 Studio 区域的 World 卡片：名称、定位、最近更新时间、实体计数摘要与可选封面；
 * 点击整卡进入 /worlds/{id}
 * [POS]: components 的 Worlds 展示层；卡片只消费摘要，不请求实体正文
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowRight, Globe2 } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { type WorldSummary } from "@/lib/recut-worlds-client";

export function WorldCard({ apiBase, world }: { apiBase: string; world: WorldSummary }) {
  const { t, locale } = useI18n();
  const counts = Object.entries(world.entityCounts ?? {}).filter(([, count]) => count > 0).slice(0, 3);
  const cover = world.coverAssetId;
  return <Link className="group min-w-0" href={`/worlds/${encodeURIComponent(world.id)}`}><Card className="flex h-full min-h-56 min-w-0 flex-col overflow-hidden border-transparent bg-card p-0 shadow-sm transition-all group-hover:-translate-y-1 group-hover:border-primary/35 group-hover:shadow-[var(--shadow-overlay)]">{cover ? <img alt={interpolate(t("worlds.card.cover.alt"), { name: world.name })} className="h-24 w-full border-b object-cover" src={`${apiBase}/v1/media/assets/${encodeURIComponent(cover)}/content`} /> : <div className="grid h-24 w-full place-items-center border-b bg-muted text-muted-foreground"><Globe2 className="size-6" /></div>}<div className="flex min-w-0 flex-1 flex-col p-4"><div className="flex items-start justify-between gap-3"><p className="truncate text-base font-semibold">{world.name}</p><span className="rounded-xs border border-primary/20 bg-accent/60 px-1.5 py-0.5 text-[10px] text-accent-foreground">{t(`worlds.kind.${world.type}`)}</span></div>{world.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{world.description}</p> : <p className="mt-1 text-xs text-muted-foreground">{t("worlds.card.noDescription")}</p>}<div className="mt-auto pt-3"><div className="flex flex-wrap items-center gap-1.5">{counts.length ? counts.map(([kind, count]) => <span className="rounded-sm border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" key={kind}>{t(`worlds.entity.${kind}`)} {count}</span>) : <span className="text-[10px] text-muted-foreground">{t("worlds.card.noEntities")}</span>}</div><div className="mt-3 flex items-center justify-between"><span className="text-[10px] text-muted-foreground">{world.updatedAt ? new Date(world.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") : ""}</span><span className="inline-flex items-center gap-1 text-xs font-medium text-primary">{t("worlds.card.enter")}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span></div></div></div></Card></Link>;
}
