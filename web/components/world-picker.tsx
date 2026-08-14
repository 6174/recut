/*
 * [INPUT]: 依赖 worlds-store 的 World 列表缓存与 WorldSummary 类型
 * [OUTPUT]: 对外提供 World picker 弹框：搜索、类型筛选与最近 World 列表，选择只发出结构化 worldId；
 * 供 Chat attachment 引用与生产 App 的 World 选择使用，绝不把 Canon 复制进消息
 * [POS]: components 的 Worlds 引用交互层；UI 只保存 { type: "creation_world", worldId } 引用，
 * 发送时由 Agent 经 MCP 读取实时内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Globe2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CustomSelect } from "@/components/ui/select-field";
import { useWorldsStore } from "@/lib/worlds-store";
import { worldKindLabels, worldTypes, type WorldKind, type WorldSummary } from "@/lib/recut-worlds-client";

export type WorldPick = { type: "creation_world"; worldId: string; name: string };

export function WorldPicker({ apiBase, open, onClose, onPick }: { apiBase: string; open: boolean; onClose: () => void; onPick: (pick: WorldPick) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorldKind | "">("");
  const loadPage = useWorldsStore((state) => state.loadPage);
  const page = useWorldsStore((state) => state.page);
  const state = useWorldsStore((state) => state.pageState);
  const error = useWorldsStore((state) => state.pageError);
  useEffect(() => { if (open) { void loadPage(apiBase, { limit: 50 }); } }, [apiBase, loadPage, open]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return page.filter((world) => (!filter || world.type === filter) && (!normalized || `${world.name} ${world.description}`.toLowerCase().includes(normalized)));
  }, [filter, page, query]);
  if (!open) return null;
  const choose = (world: WorldSummary) => { onPick({ type: "creation_world", worldId: world.id, name: world.name }); onClose(); };
  return createPortal(<div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="world-picker-title"><section className="flex max-h-[min(560px,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">CREATION WORLD</p><h2 className="mt-1 text-base font-semibold" id="world-picker-title">引用一个世界</h2><p className="mt-1 text-xs text-muted-foreground">只保存结构化 worldId；发送时由 Agent 读取实时内容。</p></div><button aria-label="关闭世界选择" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><div className="flex items-end gap-3 border-b px-5 py-3"><label className="relative block flex-1"><span className="sr-only">搜索世界</span><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input className="h-8 w-full rounded-sm border bg-background pl-8 pr-3 text-xs focus-visible:ring-2 focus-visible:ring-ring/30" onChange={(event) => setQuery(event.target.value)} placeholder="搜索世界名称或描述" type="search" value={query} /></label><div className="w-32"><CustomSelect id="world-picker-filter" label="类型筛选" onChange={(value) => setFilter(value as WorldKind | "")} options={[{ label: "全部类型", value: "" }, ...worldTypes().map((kind) => ({ label: worldKindLabels[kind], value: kind }))]} value={filter} /></div></div><div className="min-h-0 flex-1 overflow-y-auto p-2">{state === "loading" ? <p className="px-3 py-8 text-center text-xs text-muted-foreground">正在读取世界…</p> : state === "failed" ? <p className="px-3 py-8 text-center text-xs text-warning">{error}</p> : visible.length ? visible.map((world) => <button className="flex w-full items-center gap-3 rounded-sm px-3 py-3 text-left hover:bg-muted" key={world.id} onClick={() => choose(world)} type="button"><span className="grid size-9 shrink-0 place-items-center rounded-sm bg-accent text-accent-foreground"><Globe2 className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{world.name}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{worldKindLabels[world.type]} · {world.description || "暂无描述"}</span></span><span className="text-xs font-medium text-primary">选择</span></button>) : <p className="px-3 py-8 text-center text-xs text-muted-foreground">没有匹配的世界</p>}</div></section></div>, document.body);
}
