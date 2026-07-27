/**
 * [INPUT]: 依赖 React 状态、Resource 类型、阶段摘要与基础按钮
 * [OUTPUT]: 对外提供素材库式缩略图项目、悬停操作与更多菜单
 * [POS]: vox-broll 的资源浏览单元；所有阶段均以小型可扫读缩略图呈现，详情交由模态框承载
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Trash2 } from "lucide-react";
import type { Resource } from "./main";
import { isLegacyLook, ResourcePresentation, resourceSummary } from "./resource-view";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui";

function TextPreview({ resource }: { resource: Resource }) {
  const kind = resource.kind.toLowerCase();
  const summary = resourceSummary(resource);
  if (kind === "beats") return <div className="grid h-full grid-cols-[auto_1fr] gap-x-2 p-3"><span className="font-mono text-lg text-primary">01</span><div className="grid content-center gap-1"><span className="h-1.5 w-4/5 rounded-full bg-foreground/70" /><span className="h-1.5 w-3/5 rounded-full bg-muted-foreground/30" /><span className="h-1.5 w-2/5 rounded-full bg-muted-foreground/20" /></div></div>;
  if (kind === "keyframes") return <div className="grid h-full grid-cols-2 gap-1.5 p-2.5">{[0, 1, 2, 3].map((item) => <span className={`rounded-sm border ${item === 0 ? "border-primary/50 bg-primary/10" : "border-border bg-muted/40"}`} key={item} />)}</div>;
  if (kind === "scenes") return <div className="grid h-full place-items-center bg-muted/30"><span className="font-mono text-2xl text-primary">▶</span></div>;
  if (kind === "audio") return <div className="flex h-full items-center justify-center gap-1 bg-muted/30">{[4, 8, 14, 20, 12, 18, 7, 11].map((height, index) => <span className="w-1 rounded-full bg-primary/70" key={index} style={{ height }} />)}</div>;
  if (kind === "delivery") return <div className="grid h-full content-center gap-2 p-3">{["画幅", "格式", "检查"].map((label) => <span className="flex items-center gap-2 text-[10px] text-muted-foreground" key={label}><i className="size-1.5 rounded-full bg-primary" />{label}</span>)}</div>;
  return <div className="grid h-full content-center gap-2 bg-primary/[0.035] p-3"><p className="line-clamp-2 text-xs font-medium leading-5 text-foreground">{summary}</p><span className="h-1.5 w-2/3 rounded-full bg-primary/25" /></div>;
}

function Preview({ resource }: { resource: Resource }) {
  if (resource.kind.toLowerCase() === "look") return <div className="h-full overflow-hidden"><ResourcePresentation compact resource={resource} /></div>;
  return <TextPreview resource={resource} />;
}

export function ResourceCard({ onClick, onDelete, onRetire, resource }: { onClick: () => void; onDelete: (resource: Resource) => void; onRetire?: () => void; resource: Resource }) {
  const legacy = isLegacyLook(resource);
  return <article className="group relative w-[156px] shrink-0 transition-transform duration-150 ease-out hover:z-10 hover:scale-[1.035]"><button aria-haspopup="dialog" aria-label={`查看 ${resource.title}`} className="block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClick} type="button"><div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-border/80 bg-card shadow-[0_1px_2px_rgb(15_23_42/0.03)] transition-all duration-150 group-hover:border-primary/70 group-hover:shadow-[0_8px_20px_rgb(15_23_42/0.12)]"><Preview resource={resource} /></div><h3 className="mt-1.5 truncate text-xs font-medium leading-5 text-foreground/90">{resource.title}</h3></button><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={`更多操作：${resource.title}`} className="absolute right-1.5 top-1.5 size-6 rounded-md border-border/70 bg-background/90 p-0 text-base font-bold leading-none text-foreground opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100" type="button" variant="outline"><span aria-hidden="true" className="-mt-1 tracking-[-0.1em]">•••</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" aria-label={`${resource.title} 的更多操作`}><DropdownMenuItem onSelect={onClick}>查看详情</DropdownMenuItem>{legacy && onRetire && <DropdownMenuItem onSelect={onRetire}>移出方案</DropdownMenuItem>}<DropdownMenuItem className="text-red-600 hover:!bg-red-50 focus:!bg-red-50" onSelect={() => onDelete(resource)}><Trash2 className="size-3.5" />删除资源</DropdownMenuItem></DropdownMenuContent></DropdownMenu></article>;
}
