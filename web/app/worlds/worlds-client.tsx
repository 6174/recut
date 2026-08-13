/*
 * [INPUT]: 依赖 worlds-store 的 World 列表缓存、recut-worlds-client 的创建方法与 WorldCard
 * [OUTPUT]: 对外提供 Worlds 桌面：搜索/类型筛选、World 卡片网格、新建 World 对话框与明确的读取/空/失败态；
 * 创建成功后显式刷新，绝不轮询
 * [POS]: web/app/worlds 的内容组件；系统 Worlds UI 是原生 React，经 /v1/worlds facade 读写，不进入 App Catalog 或 iframe
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Globe2, Plus, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { WorldCard } from "@/components/world-card";
import { createRecutWorldsClient, worldKindLabels, worldTypes, type WorldKind } from "@/lib/recut-worlds-client";
import { useServiceStore } from "@/lib/service-store";
import { useWorldsStore } from "@/lib/worlds-store";

export function WorldsClient() {
  const apiBase = useServiceStore((state) => state.endpoint);
  const loadPage = useWorldsStore((state) => state.loadPage);
  const invalidate = useWorldsStore((state) => state.invalidate);
  const page = useWorldsStore((state) => state.page);
  const state = useWorldsStore((state) => state.pageState);
  const error = useWorldsStore((state) => state.pageError);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorldKind | "">("");
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (apiBase) void loadPage(apiBase, { limit: 50 }); }, [apiBase, loadPage]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return page.filter((world) => (!filter || world.type === filter) && (!normalized || `${world.name} ${world.description}`.toLowerCase().includes(normalized)));
  }, [filter, page, query]);
  return <><div className="mb-7 flex items-end justify-between"><div><p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary"><span className="size-1.5 rounded-full bg-primary" />DESKTOP</p><h1 className="text-3xl font-semibold tracking-tight">My Worlds</h1><p className="mt-2 text-sm text-muted-foreground">持续存在的创作上下文：角色、故事、风格与规则。所有实体只属于它们的世界。</p></div><Badge className="border-primary/25 bg-accent text-accent-foreground">{state === "loading" ? "读取中…" : state === "failed" ? "读取失败" : `${page.length} 个世界`}</Badge></div>
    <div className="mb-5 flex items-center gap-3"><label className="relative block flex-1"><span className="sr-only">搜索世界</span><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-9 bg-background pl-8 text-xs" onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或描述…" type="search" value={query} /></label><label className="text-xs text-muted-foreground"><span className="sr-only">类型筛选</span><select className="h-9 rounded-sm border bg-background px-2 text-xs" onChange={(event) => setFilter(event.target.value as WorldKind | "")} value={filter}><option value="">全部类型</option>{worldTypes().map((kind) => <option key={kind} value={kind}>{worldKindLabels[kind]}</option>)}</select></label><Button className="h-9 shrink-0" onClick={() => setCreating(true)} type="button"><Plus className="size-3.5" />新建 World</Button></div>
    {state === "loading" ? <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">{Array.from({ length: 6 }, (_, index) => <div className="h-56 animate-pulse rounded-lg border bg-card" key={index} />)}</div>
      : state === "failed" ? <Card><div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center p-6"><Globe2 className="size-6 text-warning" /><p className="text-sm font-medium">未能读取 Worlds</p><p className="text-xs text-muted-foreground">{error}</p><Button onClick={() => void loadPage(apiBase, { limit: 50 }, true)} type="button" variant="outline">重新读取</Button></div></Card>
      : visible.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">{visible.map((world) => <WorldCard apiBase={apiBase} key={world.id} world={world} />)}</div>
        : <Card><div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center p-6"><Globe2 className="size-6 text-primary" /><p className="text-sm font-medium">还没有 World</p><p className="text-xs text-muted-foreground">为一个角色 IP、内容账号、品牌或故事世界建立一个持续上下文。</p><Button className="mt-1" onClick={() => setCreating(true)} type="button"><Plus className="size-3.5" />创建第一个 World</Button></div></Card>}
    {creating && <CreateWorldDialog apiBase={apiBase} onClose={() => setCreating(false)} onCreated={() => void loadPage(apiBase, { limit: 50 }, true)} />}
  </>;
}

function CreateWorldDialog({ apiBase, onClose, onCreated }: { apiBase: string; onClose: () => void; onCreated: () => void }) {
  const invalidate = useWorldsStore((state) => state.invalidate);
  const [name, setName] = useState("");
  const [type, setType] = useState<WorldKind>("character_ip");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true); setError("");
    try {
      const world = await createRecutWorldsClient(apiBase).create({ name: name.trim(), type, description: description.trim() });
      invalidate();
      onCreated();
      onClose();
      window.location.assign(`/worlds/${encodeURIComponent(world.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建 World 失败");
      setCreating(false);
    }
  }
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="create-world-title"><section className="w-full max-w-md rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">NEW WORLD</p><h2 className="mt-1 text-base font-semibold" id="create-world-title">创建新的 Creation World</h2><p className="mt-1 text-xs text-muted-foreground">模板只决定初始设定；你可以在世界里自由添加角色、故事、风格与规则。</p></div><button aria-label="关闭新建 World" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><form onSubmit={submit}><div className="grid gap-4 p-5"><div><label className="mb-1 block text-[11px] font-medium" htmlFor="create-world-name">名称</label><Input autoFocus className="h-9 bg-background text-xs" id="create-world-name" onChange={(event) => setName(event.target.value)} placeholder="例如：Future City 2049" value={name} /></div><div><label className="mb-1 block text-[11px] font-medium" htmlFor="create-world-type">类型</label><select className="h-9 w-full rounded-sm border bg-background px-2 text-xs" id="create-world-type" onChange={(event) => setType(event.target.value as WorldKind)} value={type}>{worldTypes().map((kind) => <option key={kind} value={kind}>{worldKindLabels[kind]}</option>)}</select></div><div><label className="mb-1 block text-[11px] font-medium" htmlFor="create-world-description">定位</label><textarea className="min-h-20 w-full rounded-sm border bg-background px-2.5 py-2 text-xs focus-visible:ring-2 focus-visible:ring-ring/30" id="create-world-description" onChange={(event) => setDescription(event.target.value)} placeholder="这个世界是谁、为什么存在…" value={description} /></div>{error && <p className="text-xs text-warning">{error}</p>}</div><footer className="flex items-center justify-end gap-2 border-t px-5 py-3"><Button onClick={onClose} type="button" variant="ghost">取消</Button><Button disabled={!name.trim() || creating} type="submit">{creating ? "正在创建…" : "创建并进入"}</Button></footer></form></section></div>;
}
