/*
 * [INPUT]: 依赖 worlds-store 缓存、recut-worlds-client、素材库列表 API 与 WorldCard/EntityPicker
 * [OUTPUT]: 对外提供 World 详情：Overview/Characters/Stories/Styles/Rules/References 五个核心区域、
 * 实体创建/编辑、语义 Asset reference 附加、resolve 预览与从 Story 发起 Remotion 项目的垂直切片
 * [POS]: web/app/worlds/[worldID] 的内容组件；worldID 来自路径，所有读取要求显式 worldId，
 * 实体只属于该世界，写操作后显式失效刷新
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft, ArrowRight, Check, Clapperboard, Globe2, Link2, Pencil, Plus, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createRecutWorldsClient, entityKindLabels, isReferenceRole, referenceRoleLabels, worldKindLabels, type CreationContext, type EntityKind, type WorldDetail, type WorldEntity } from "@/lib/recut-worlds-client";
import { useServiceStore } from "@/lib/service-store";
import { useWorldsStore } from "@/lib/worlds-store";

type WorldAsset = { id: string; name: string; kind: string; status: string };

const KIND_SECTIONS: { kind: EntityKind; title: string; description: string }[] = [
  { kind: "character", title: "Characters", description: "角色的身份、性格、外观与声音。不可变事实的中心。" },
  { kind: "story", title: "Stories", description: "可生产的叙事意图，从这里发起视频创作。" },
  { kind: "style", title: "Styles", description: "视觉、文字、声音、运动的风格规范。" },
  { kind: "rule", title: "Rules", description: "Always / Never / Prefer 约束，resolve 时进入 Constraints。" },
  { kind: "location", title: "Locations", description: "故事发生的地点与环境。" },
];

export default function WorldDetailClient() {
  const apiBase = useServiceStore((state) => state.endpoint);
  const loadDetail = useWorldsStore((state) => state.loadDetail);
  const loadEntities = useWorldsStore((state) => state.loadEntities);
  const loadEntity = useWorldsStore((state) => state.loadEntity);
  const invalidate = useWorldsStore((state) => state.invalidate);
  const [worldID, setWorldID] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorldDetail | null>(null);
  const [error, setError] = useState("");
  const [entitiesByKind, setEntitiesByKind] = useState<Record<string, WorldEntity[]>>({});
  const [activeKind, setActiveKind] = useState<EntityKind>("character");
  const [editing, setEditing] = useState<WorldEntity | null>(null);
  const [creating, setCreating] = useState(false);
  const [context, setContext] = useState<CreationContext | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const app = params.get("id");
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/worlds/")) {
      const segments = window.location.pathname.split("/").filter(Boolean);
      setWorldID(segments[1] ?? app ?? null);
    } else {
      setWorldID(app ?? null);
    }
  }, []);

  useEffect(() => {
    if (!apiBase || !worldID) return;
    let active = true;
    void loadDetail(apiBase, worldID).then((value) => { if (active) setDetail(value); }).catch(() => { if (active) setError("无法读取世界"); });
    return () => { active = false; };
  }, [apiBase, loadDetail, worldID]);

  useEffect(() => {
    if (!apiBase || !worldID) return;
    let active = true;
    void loadEntities(apiBase, worldID, { limit: 100 }).then((items) => {
      if (!active) return;
      const grouped: Record<string, WorldEntity[]> = {};
      for (const summary of items) {
        (grouped[summary.kind] ??= []).push({ ...summary, content: {}, relations: [], references: [] });
      }
      void Promise.all(items.map((summary) => loadEntity(apiBase, worldID, summary.id).catch(() => null))).then((full) => {
        for (const entity of full) {
          if (entity && grouped[entity.kind]) {
            const index = grouped[entity.kind].findIndex((candidate) => candidate.id === entity.id);
            if (index >= 0) grouped[entity.kind][index] = entity;
          }
        }
        if (active) setEntitiesByKind(grouped);
      });
    });
    return () => { active = false; };
  }, [apiBase, loadEntities, loadEntity, worldID]);

  const activeEntities = useMemo(() => entitiesByKind[activeKind] ?? [], [activeKind, entitiesByKind]);

  if (!worldID) return <p className="py-10 text-center text-sm text-muted-foreground">没有指定 World。</p>;
  if (error && !detail) return <p className="py-10 text-center text-sm text-warning">{error}</p>;
  if (!detail) return <div className="space-y-4 py-6"><div className="h-8 w-64 animate-pulse rounded-sm bg-muted" /><div className="h-48 animate-pulse rounded-lg bg-muted" /></div>;
  const worldId = worldID;
  const worldDetail = detail;

  async function refresh() {
    invalidate(worldId);
    const next = await loadDetail(apiBase, worldId, true);
    setDetail(next);
    const items = await loadEntities(apiBase, worldId, { limit: 100 }, true);
    setEntitiesByKind({});
    void loadEntities(apiBase, worldId, { limit: 100 }, true).then(async () => {
      const grouped: Record<string, WorldEntity[]> = {};
      for (const summary of items) (grouped[summary.kind] ??= []).push({ ...summary, content: {}, relations: [], references: [] });
      const full = await Promise.all(items.map((summary) => loadEntity(apiBase, worldId, summary.id, true).catch(() => null)));
      for (const entity of full) {
        if (entity && grouped[entity.kind]) {
          const index = grouped[entity.kind].findIndex((candidate) => candidate.id === entity.id);
          if (index >= 0) grouped[entity.kind][index] = entity;
        }
      }
      setEntitiesByKind(grouped);
    });
  }

  async function resolvePreview() {
    setNotice("");
    try {
      const result = await createRecutWorldsClient(apiBase).resolve({ worldId, selection: { purpose: "video", entityIds: activeEntities.map((entity) => entity.id) } });
      setContext(result);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "resolve 失败"); }
  }

  async function createVideoFromStory(storyID: string) {
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/v1/apps`, { cache: "no-store" });
      const apps = await response.json() as Array<{ id: string; name: string; kind: string }>;
      const remotion = apps.find((app) => app.id === "recut.remotion-studio");
      if (!remotion) {
        setNotice("未安装 Remotion Studio，无法从这里发起视频项目。");
        return;
      }
      const projectResponse = await fetch(`${apiBase}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${worldDetail.name} · 视频`, appId: "recut.remotion-studio" }) });
      if (!projectResponse.ok) throw new Error(await projectErrorMessage(projectResponse));
      const project = await projectResponse.json() as { id: string };
      await createRecutWorldsClient(apiBase).project.put(project.id, { worldId, selection: { storyId: storyID, purpose: "video" } });
      window.location.assign(`/projects/${project.id}`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "创建视频项目失败"); }
  }

  return <><header className="mb-7 flex items-start justify-between gap-5"><div className="flex min-w-0 items-start gap-4"><Link aria-label="返回 Worlds" className="mt-1 grid size-8 shrink-0 place-items-center rounded-xs text-muted-foreground hover:bg-muted hover:text-foreground" href="/worlds"><ArrowLeft className="size-4" /></Link><div className="min-w-0"><div className="flex items-center gap-2"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><Globe2 className="size-5" /></span><div className="min-w-0"><p className="truncate text-2xl font-semibold tracking-tight">{detail.name}</p><p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{detail.id}</p></div></div>{detail.description ? <p className="mt-3 max-w-xl text-sm text-muted-foreground">{detail.description}</p> : null}<div className="mt-3 flex flex-wrap items-center gap-1.5"><Badge className="border-primary/20 bg-accent/60 text-accent-foreground">{worldKindLabels[detail.type]}</Badge><span className="rounded-xs border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">revision {detail.revision.id.slice(0, 8)}</span>{detail.revision.canonicalHash ? <span className="truncate font-mono text-[10px] text-muted-foreground" title={detail.revision.canonicalHash}>{detail.revision.canonicalHash.slice(0, 20)}</span> : null}</div></div></div><div className="flex shrink-0 items-center gap-2"><Button onClick={() => void refresh()} type="button" variant="outline"><RefreshCw className="size-3.5" />刷新</Button></div></header>
    <section className="mb-7 grid gap-3 sm:grid-cols-3"><StatCard label="实体" value={Object.values(detail.entityCounts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0)} /><StatCard label="最近更新" value={new Date(detail.updatedAt).toLocaleString("zh-CN")} /><StatCard label="可用类型" value={detail.availableEntityKinds?.map((kind) => entityKindLabels[kind]).join("、") ?? ""} /></section>
    <nav aria-label="世界区域" className="mb-6 flex flex-wrap items-center gap-1.5">{KIND_SECTIONS.map((section) => <button aria-pressed={activeKind === section.kind} className={activeKind === section.kind ? "rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground" : "rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"} key={section.kind} onClick={() => setActiveKind(section.kind)} type="button">{section.title}</button>)}<button aria-pressed={activeKind === "reference"} className={activeKind === "reference" ? "rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground" : "rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"} onClick={() => setActiveKind("reference")} type="button">References</button></nav>
    {activeKind === "reference" ? <ReferencesSection apiBase={apiBase} entities={Object.values(entitiesByKind).flat()} worldID={worldId} onChanged={() => void refresh()} /> : <section className="flex flex-col items-start gap-6"><div className="flex w-full items-end justify-between gap-4"><div><h2 className="text-base font-semibold">{KIND_SECTIONS.find((section) => section.kind === activeKind)?.title}</h2><p className="mt-1 text-xs text-muted-foreground">{KIND_SECTIONS.find((section) => section.kind === activeKind)?.description}</p></div><Button className="h-8 shrink-0" onClick={() => setCreating(true)} type="button"><Plus className="size-3.5" />新增{entityKindLabels[activeKind]}</Button></div>
      {activeEntities.length ? <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">{activeEntities.map((entity) => <EntityCard apiBase={apiBase} entity={entity} key={entity.id} onCreateVideo={activeKind === "story" ? () => void createVideoFromStory(entity.id) : undefined} onEdit={() => setEditing(entity)} />)}</div> : <Card className="w-full"><div className="flex min-h-28 items-center justify-center gap-3 p-5 text-center"><div><p className="text-sm font-medium">还没有{entityKindLabels[activeKind]}</p><p className="mt-1 text-xs text-muted-foreground">添加一个{entityKindLabels[activeKind]}设定，它会进入世界的 Canon。</p></div></div></Card>}
      <div className="flex w-full items-center gap-3 border-t pt-4"><Button onClick={() => void resolvePreview()} type="button" variant="outline">解析当前选区（resolve）</Button>{context && <ResolveSummary context={context} />}{notice && <span className="text-xs text-warning">{notice}</span>}</div></section>}
    {(creating || editing) && <EntityDialog apiBase={apiBase} entity={editing} kind={activeKind} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); void refresh(); }} worldID={worldId} />}
  </>;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return <Card className="p-4"><p className="text-[10px] font-medium text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></Card>;
}

function EntityCard({ apiBase, entity, onCreateVideo, onEdit }: { apiBase: string; entity: WorldEntity; onCreateVideo?: () => void; onEdit: () => void }) {
  const contentSummary = useMemo(() => {
    const entries = Object.entries(entity.content ?? {}).filter(([, value]) => value !== "" && value !== null && value !== undefined).slice(0, 3);
    return entries.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ");
  }, [entity.content]);
  return <Card className="flex min-h-52 flex-col p-4"><div className="flex items-start justify-between gap-3"><p className="min-w-0 truncate text-sm font-semibold">{entity.title}</p><span className="rounded-xs border bg-accent/60 px-1.5 py-0.5 text-[10px] text-accent-foreground">{entityKindLabels[entity.kind]}</span></div>{entity.summary ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{entity.summary}</p> : null}{contentSummary ? <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-muted-foreground">{contentSummary}</p> : null}<div className="mt-3 flex flex-wrap gap-1">{entity.references?.map((reference) => <span className="inline-flex max-w-40 items-center gap-1 truncate rounded-sm border px-1.5 py-0.5 text-[10px] text-muted-foreground" key={reference.id ?? reference.assetId} title={reference.assetId}><Link2 className="size-2.5 shrink-0" />{referenceRoleLabels[reference.role] ?? reference.role}</span>) || null}</div><div className="mt-auto flex items-center gap-2 pt-3">{onCreateVideo && <Button className="h-7" onClick={onCreateVideo} type="button"><Clapperboard className="size-3" />Create video</Button>}<Button className="h-7" onClick={onEdit} type="button" variant="outline"><Pencil className="size-3" />编辑</Button></div></Card>;
}

function ReferencesSection({ apiBase, entities, worldID, onChanged }: { apiBase: string; entities: WorldEntity[]; worldID: string; onChanged: () => void }) {
  const [assets, setAssets] = useState<WorldAsset[]>([]);
  const [target, setTarget] = useState<{ entityId: string; assetId: string; role: string; label: string } | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { void fetch(`${apiBase}/v1/media/assets`, { cache: "no-store" }).then(async (response) => { if (response.ok) setAssets(await response.json() as WorldAsset[]); }).catch(() => {}); }, [apiBase]);
  async function attach() {
    if (!target) return;
    setNotice("");
    try {
      await createRecutWorldsClient(apiBase).references.attach({ worldId: worldID, entityId: target.entityId || undefined, assetId: target.assetId, role: target.role, label: target.label });
      setTarget(null);
      onChanged();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "附加参考失败"); }
  }
  const allReferences = entities.flatMap((entity) => (entity.references ?? []).map((reference) => ({ ...reference, entityTitle: entity.title })));
  return <section className="w-full space-y-5"><div className="flex flex-col gap-4 rounded-lg border bg-card p-4"><h2 className="text-sm font-semibold">附加语义 Reference</h2><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs"><span className="mb-1 block font-medium">实体</span><select className="h-8 w-full rounded-sm border bg-background px-2 text-xs" onChange={(event) => setTarget((current) => ({ ...current, entityId: event.target.value, assetId: current?.assetId ?? "", role: current?.role ?? "character_reference", label: current?.label ?? "" }))} value={target?.entityId ?? ""}><option value="">仅附加到世界</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.title}</option>)}</select></label><label className="text-xs"><span className="mb-1 block font-medium">角色</span><select className="h-8 w-full rounded-sm border bg-background px-2 text-xs" onChange={(event) => setTarget((current) => ({ ...current, role: event.target.value, entityId: current?.entityId ?? "", assetId: current?.assetId ?? "", label: current?.label ?? "" }))} value={target?.role ?? "character_reference"}>{Object.keys(referenceRoleLabels).filter(isReferenceRole).map((role) => <option key={role} value={role}>{referenceRoleLabels[role]}</option>)}</select></label></div><label className="text-xs"><span className="mb-1 block font-medium">素材</span><select className="h-8 w-full rounded-sm border bg-background px-2 text-xs" onChange={(event) => setTarget((current) => ({ ...current, assetId: event.target.value, entityId: current?.entityId ?? "", role: current?.role ?? "character_reference", label: current?.label ?? "" }))} value={target?.assetId ?? ""}><option value="">选择一个已完成的素材</option>{assets.filter((asset) => asset.status === "completed").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><label className="text-xs"><span className="mb-1 block font-medium">标签</span><Input className="h-8 bg-background text-xs" onChange={(event) => setTarget((current) => ({ ...current, label: event.target.value, entityId: current?.entityId ?? "", assetId: current?.assetId ?? "", role: current?.role ?? "character_reference" }))} placeholder="例如：正面角色设定图" value={target?.label ?? ""} /></label><div className="flex items-center gap-3"><Button className="h-8" disabled={!target?.assetId} onClick={() => void attach()} type="button"><Link2 className="size-3.5" />附加 Reference</Button>{notice && <span className="text-xs text-warning">{notice}</span>}</div></div><div><h3 className="mb-3 text-sm font-semibold">已登记的参考</h3>{allReferences.length ? <div className="divide-y rounded-lg border bg-card">{allReferences.map((reference) => <div className="flex items-center gap-3 px-4 py-3" key={reference.id ?? reference.assetId}><span className="min-w-0 flex-1"><p className="truncate font-mono text-xs">{reference.assetId}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{ (reference.label || referenceRoleLabels[reference.role]) ?? reference.role }{reference.entityTitle ? ` · ${reference.entityTitle}` : ""}</p></span><span className="rounded-xs border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{referenceRoleLabels[reference.role] ?? reference.role}</span></div>)}</div> : <p className="text-xs text-muted-foreground">还没有 Reference；Reference 只保存 assetId 与语义，不复制二进制。</p>}</div></section>;
}

function ResolveSummary({ context }: { context: CreationContext }) {
  return <span className="inline-flex items-center gap-1.5 rounded-sm border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary"><Check className="size-3" />已解析 revision {context.world.revisionId.slice(0, 8)} · {context.constraints.always?.length ?? 0} always / {context.constraints.never?.length ?? 0} never</span>;
}

function EntityDialog({ apiBase, entity, kind, worldID, onClose, onSaved }: { apiBase: string; entity: WorldEntity | null; worldID: string; kind: EntityKind; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(entity?.title ?? "");
  const [summary, setSummary] = useState(entity?.summary ?? "");
  const [content, setContent] = useState(entity ? JSON.stringify(entity.content ?? {}, null, 2) : "{}");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true); setError("");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(content || "{}"); } catch { setError("内容必须是合法 JSON 对象"); setSaving(false); return; }
    try {
      await createRecutWorldsClient(apiBase).entities.upsert({ worldId: worldID, entityId: entity?.id, kind, title: title.trim(), summary: summary.trim(), content: parsed });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); setSaving(false); }
  }
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="entity-dialog-title"><section className="flex max-h-[min(680px,calc(100vh-3rem))] w-full max-w-lg flex-col overflow-hidden rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">{entity ? "EDIT" : "NEW"} ENTITY</p><h2 className="mt-1 text-base font-semibold" id="entity-dialog-title">{entity ? `编辑${entityKindLabels[kind]}` : `新增${entityKindLabels[kind]}`}</h2><p className="mt-1 text-xs text-muted-foreground">保存后写入世界 Canon 并产生新的 revision。</p></div><button aria-label="关闭" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><div className="grid flex-1 gap-4 overflow-y-auto p-5"><label className="text-xs"><span className="mb-1 block font-medium">标题</span><Input autoFocus className="h-9 bg-background text-xs" onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="text-xs"><span className="mb-1 block font-medium">摘要</span><Input className="h-9 bg-background text-xs" onChange={(event) => setSummary(event.target.value)} value={summary} /></label><label className="text-xs"><span className="mb-1 block font-medium">内容 JSON</span><textarea className="min-h-48 w-full rounded-sm border bg-background px-2.5 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring/30" onChange={(event) => setContent(event.target.value)} spellCheck={false} value={content} /></label>{error && <p className="text-xs text-warning">{error}</p>}</div><footer className="flex items-center justify-end gap-2 border-t px-5 py-3"><Button onClick={onClose} type="button" variant="ghost">取消</Button><Button disabled={!title.trim() || saving} onClick={() => void submit()} type="button">{saving ? "正在保存…" : "保存"}</Button></footer></section></div>;
}

async function projectErrorMessage(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `创建项目失败（${response.status}）`;
}
