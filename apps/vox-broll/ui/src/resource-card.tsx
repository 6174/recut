/**
 * [INPUT]: 依赖 Resource 类型、lucide 图标与 shadcn 风格 Card/Badge
 * [OUTPUT]: 对外提供可点击的资源摘要卡片
 * [POS]: vox-broll 的资源浏览单元；点击后由根视图打开预览弹窗
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { ArrowUpRight, Layers3 } from "lucide-react";
import type { Resource } from "./main";
import { Badge, Card, CardContent, CardFooter, CardHeader } from "./ui";

function summary(content: unknown) {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "暂无内容摘要";
  const record = content as Record<string, unknown>;
  return [record.topic, record.premise, record.direction].find((value) => typeof value === "string") as string | undefined ?? "结构化创作资源";
}

export function ResourceCard({ onClick, resource }: { onClick: () => void; resource: Resource }) {
  return <button aria-label={`预览 ${resource.title}`} className="group text-left" onClick={onClick} type="button"><Card className="h-full transition duration-150 group-hover:-translate-y-0.5 group-hover:border-primary/45 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring">
    <CardHeader><div className="flex items-start justify-between gap-3"><Badge>{resource.kind}</Badge><ArrowUpRight className="size-4 text-muted-foreground transition group-hover:text-foreground" /></div><h3 className="mt-4 line-clamp-2 text-base font-semibold leading-6">{resource.title}</h3></CardHeader>
    <CardContent><p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{summary(resource.content)}</p></CardContent>
    <CardFooter><Layers3 className="mr-1.5 size-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">{resource.dependencies.length ? `引用 ${resource.dependencies.length} 个资源` : "独立创建"}</span></CardFooter>
  </Card></button>;
}
