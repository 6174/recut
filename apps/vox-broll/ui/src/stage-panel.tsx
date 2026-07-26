/**
 * [INPUT]: 依赖 B-roll Resource、资源卡片与 UI 原子
 * [OUTPUT]: 对外提供工作台中的单层创作分区
 * [POS]: vox-broll 的工作台布局单元；分区只提供标题线、资源画布和创建入口，不再包裹第二层卡片
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Plus } from "lucide-react";
import type { Resource } from "./main";
import { ResourceCard } from "./resource-card";
import { Button } from "./ui";

export type Stage = { kind: string; eyebrow: string; label: string; summary: string; action: string; empty: string };

export function StagePanel({ onCreate, onDelete, onPreview, onRetire, resources, stage }: { onCreate: () => void; onDelete: (resource: Resource) => void; onPreview: (resource: Resource) => void; onRetire: (resource: Resource) => void; resources: Resource[]; stage: Stage }) {
  return <section className="border-t border-border/80 pt-4"><header className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">{stage.eyebrow}</p><span className="grid size-5 place-items-center rounded-full border bg-card font-mono text-[10px] font-medium text-muted-foreground">{resources.length}</span></div><h2 className="mt-1 text-[15px] font-semibold tracking-tight">{stage.label}</h2><p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{stage.summary}</p></div><Button className="h-8 shrink-0 rounded-full px-3 text-xs shadow-sm" onClick={onCreate}><Plus className="size-3.5" />{stage.action}</Button></header><div className="mt-3">{resources.length ? <div className="flex flex-wrap gap-x-3.5 gap-y-4">{resources.map((resource) => <ResourceCard key={resource.id} onClick={() => onPreview(resource)} onDelete={onDelete} onRetire={() => onRetire(resource)} resource={resource} />)}</div> : <button className="grid min-h-20 w-full place-items-center rounded-lg border border-dashed border-border bg-card/45 px-4 text-center text-sm text-muted-foreground transition hover:border-primary/45 hover:bg-primary/5 hover:text-foreground" onClick={onCreate} type="button">{stage.empty}</button>}</div></section>;
}
