/*
 * [INPUT]: 依赖 worlds-store 的 Entity 列表缓存与 WorldEntitySummary 类型
 * [OUTPUT]: 对外提供 Entity picker 弹框：先选 World、再按 kind/搜索过滤选 Entity，选择只发出结构化
 * { type: "creation_entity", worldId, entityId }；供 Chat 引用与生产 App 的设定选择使用
 * [POS]: components 的 Worlds 实体引用交互层；entityId 永远与 worldId 一起验证，绝不跨 World 复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Search, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useWorldsStore } from "@/lib/worlds-store";
import { useI18n } from "@/lib/i18n/index";
import { type EntityKind, type WorldEntitySummary } from "@/lib/recut-worlds-client";

export type WorldEntityPick = { type: "creation_entity"; worldId: string; entityId: string };

export function WorldEntityPicker({ apiBase, open, worldId, onClose, onPick, kinds }: { apiBase: string; open: boolean; worldId: string; onClose: () => void; onPick: (pick: WorldEntityPick) => void; kinds?: EntityKind[] }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const loadEntities = useWorldsStore((state) => state.loadEntities);
  const entities = useWorldsStore((state) => state.entitiesByKey[`${apiBase}:${worldId}:${kinds?.[0] ?? ""}|||50`]);
  const state = useWorldsStore((state) => state.pageState);
  useEffect(() => { if (open && worldId) { void loadEntities(apiBase, worldId, { limit: 50, ...(kinds?.length ? { kind: kinds[0] } : {}) }); } }, [apiBase, kinds, loadEntities, open, worldId]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (entities ?? []).filter((entity) => (!kinds?.length || kinds.includes(entity.kind)) && (!normalized || `${entity.title} ${entity.summary}`.toLowerCase().includes(normalized)));
  }, [entities, kinds, query]);
  if (!open) return null;
  const choose = (entity: WorldEntitySummary) => { onPick({ type: "creation_entity", worldId, entityId: entity.id }); onClose(); };
  return createPortal(<div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="world-entity-picker-title"><section className="flex max-h-[min(560px,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">WORLD ENTITY</p><h2 className="mt-1 text-base font-semibold" id="world-entity-picker-title">{t("worlds.entity.picker.title")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("worlds.entity.picker.desc")}</p></div><button aria-label={t("worlds.entity.picker.close.aria")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><div className="flex items-center gap-3 border-b px-5 py-3"><label className="relative block flex-1"><span className="sr-only">{t("worlds.entity.picker.search.aria")}</span><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input className="h-8 w-full rounded-sm border bg-background pl-8 pr-3 text-xs focus-visible:ring-2 focus-visible:ring-ring/30" onChange={(event) => setQuery(event.target.value)} placeholder={t("worlds.entity.picker.search.placeholder")} type="search" value={query} /></label></div><div className="min-h-0 flex-1 overflow-y-auto p-2">{!worldId ? <p className="px-3 py-8 text-center text-xs text-muted-foreground">{t("worlds.entity.picker.noWorld")}</p> : state === "loading" ? <p className="px-3 py-8 text-center text-xs text-muted-foreground">{t("worlds.entity.picker.loading")}</p> : visible.length ? visible.map((entity) => <button className="flex w-full items-center gap-3 rounded-sm px-3 py-3 text-left hover:bg-muted" key={entity.id} onClick={() => choose(entity)} type="button"><span className="grid size-9 shrink-0 place-items-center rounded-sm bg-accent text-accent-foreground"><UserRound className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entity.title}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{t(`worlds.entity.${entity.kind}`)} · {entity.summary || t("worlds.entity.picker.noSummary")}</span></span><span className="text-xs font-medium text-primary">{t("worlds.entity.picker.choose")}</span></button>) : <p className="px-3 py-8 text-center text-xs text-muted-foreground">{t("worlds.entity.picker.empty")}</p>}</div></section></div>, document.body);
}
