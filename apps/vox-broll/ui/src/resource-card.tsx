/**
 * [INPUT]: 依赖 React 状态、Resource 类型、真实资源缩略文本与基础按钮
 * [OUTPUT]: 对外提供素材库式缩略图项目、真实内容预览、悬停操作与更多菜单
 * [POS]: vox-broll 的资源浏览单元；图片用图片、文本用真实缩略文本，详情交由模态框承载
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Trash2 } from "lucide-react";
import type { Resource } from "./main";
import { isLegacyLook, ResourcePresentation, resourceImageURLs, resourcePreviewLines } from "./resource-view";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui";

function TextPreview({ resource }: { resource: Resource }) {
  const lines = resourcePreviewLines(resource);
  return <div className="grid h-full content-center gap-1.5 bg-primary/[0.035] p-3">{lines.length ? lines.map((line, index) => <p className={`line-clamp-2 text-xs leading-4 ${index === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`} key={line}>{line}</p>) : <p className="text-xs text-muted-foreground">尚未填写可展示内容</p>}</div>;
}

function Preview({ resource }: { resource: Resource }) {
  const image = resourceImageURLs(resource)[0];
  if (image) return <img alt={`${resource.title} 缩略图`} className="size-full object-cover" src={image} />;
  if (resource.kind.toLowerCase() === "look") return <div className="h-full overflow-hidden"><ResourcePresentation compact resource={resource} /></div>;
  return <TextPreview resource={resource} />;
}

export function ResourceCard({ onClick, onDelete, onRetire, resource }: { onClick: () => void; onDelete: (resource: Resource) => void; onRetire?: () => void; resource: Resource }) {
  const legacy = isLegacyLook(resource);
  return <article className="group relative w-[156px] shrink-0 transition-transform duration-150 ease-out hover:z-10 hover:scale-[1.035]"><button aria-haspopup="dialog" aria-label={`查看 ${resource.title}`} className="block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClick} type="button"><div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-border/80 bg-card shadow-[0_1px_2px_rgb(15_23_42/0.03)] transition-all duration-150 group-hover:border-primary/70 group-hover:shadow-[0_8px_20px_rgb(15_23_42/0.12)]"><Preview resource={resource} /></div><h3 className="mt-1.5 truncate text-xs font-medium leading-5 text-foreground/90">{resource.title}</h3></button><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={`更多操作：${resource.title}`} className="absolute right-1.5 top-1.5 size-6 rounded-md border-border/70 bg-background/90 p-0 text-base font-bold leading-none text-foreground opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100" type="button" variant="outline"><span aria-hidden="true" className="-mt-1 tracking-[-0.1em]">•••</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" aria-label={`${resource.title} 的更多操作`}><DropdownMenuItem onSelect={onClick}>查看详情</DropdownMenuItem>{legacy && onRetire && <DropdownMenuItem onSelect={onRetire}>移出方案</DropdownMenuItem>}<DropdownMenuItem className="text-red-600 hover:!bg-red-50 focus:!bg-red-50" onSelect={() => onDelete(resource)}><Trash2 className="size-3.5" />删除资源</DropdownMenuItem></DropdownMenuContent></DropdownMenu></article>;
}
