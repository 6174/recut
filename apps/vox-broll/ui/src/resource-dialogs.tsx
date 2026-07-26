/**
 * [INPUT]: 依赖 Resource 类型、recut UI SDK、lucide 图标与 shadcn 风格弹窗组件
 * [OUTPUT]: 对外提供 iframe 内受控资源详情模态框、删除确认入口与新建资源弹窗
 * [POS]: vox-broll 的短暂交互层；不承载资源列表或项目事件状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Resource } from "./main";
import { ResourcePresentation, resourceKindLabel } from "./resource-view";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Textarea } from "./ui";

export function ResourcePreviewDialog({ onDelete, onOpenChange, resource }: { onDelete: (resource: Resource) => void; onOpenChange: (open: boolean) => void; resource: Resource | null }) {
  return <Dialog onOpenChange={onOpenChange} open={Boolean(resource)}>{resource && <DialogContent><DialogHeader><div className="flex items-center gap-2"><Badge>{resourceKindLabel(resource.kind)}</Badge><span className="text-xs text-muted-foreground">资源详情</span></div><DialogTitle>{resource.title}</DialogTitle><DialogDescription className="sr-only">{resource.title} 的完整内容</DialogDescription></DialogHeader><ResourcePresentation resource={resource} /><DialogFooter><Button onClick={() => onDelete(resource)} type="button" variant="outline"><Trash2 className="size-4" />删除资源</Button></DialogFooter></DialogContent>}</Dialog>;
}

export function CreateResourceDialog({ examples, isLook, onCreate, onOpenChange, open, resources, stage }: { examples: string[]; isLook: boolean; onCreate: (instruction: string, dependencies: string[]) => Promise<void>; onOpenChange: (open: boolean) => void; open: boolean; resources: Resource[]; stage: string }) {
  const [instruction, setInstruction] = useState("");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (!open) { setInstruction(""); setDependencies([]); setError(""); } }, [open]);
  const toggle = (id: string) => setDependencies((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const submit = async () => { setSubmitting(true); setError(""); try { await onCreate(instruction, dependencies); onOpenChange(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法提交创作请求"); } finally { setSubmitting(false); } };
  return <Dialog onOpenChange={onOpenChange} open={open}><DialogContent><DialogHeader><DialogTitle>新建{stage}</DialogTitle><DialogDescription>{isLook ? "Codex 将为每个候选生成一张风格参考图，并把原始提示词与图片一起保存。" : "填写创作意图，选择需要引用的现有资源，然后交给右侧 Codex 完成创作。"}</DialogDescription></DialogHeader><div className="grid gap-5"><label className="grid gap-2 text-sm font-medium">创作要求<Textarea onChange={(event) => setInstruction(event.target.value)} placeholder={isLook ? "描述视频主题、受众及你希望探索的视觉方向；Codex 会生成候选风格图。" : `描述这个${stage}希望呈现的方向、语气或约束`} value={instruction} /></label>{examples.length > 0 && <div className="flex flex-wrap gap-2">{examples.map((example) => <button className="rounded-md border bg-background px-2.5 py-1.5 text-left text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground" key={example} onClick={() => setInstruction(example)} type="button">{example}</button>)}</div>}<fieldset><legend className="mb-2 text-sm font-medium">引用资源 <span className="font-normal text-muted-foreground">（可选）</span></legend><div className="max-h-40 space-y-1 overflow-auto rounded-md border p-1">{resources.length ? resources.map((resource) => <label className="flex cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 text-sm hover:bg-muted" key={resource.id}><input checked={dependencies.includes(resource.id)} className="size-4 accent-primary" onChange={() => toggle(resource.id)} type="checkbox" /><span className="min-w-0 flex-1 truncate">{resource.title}</span><Badge>{resource.kind}</Badge></label>) : <p className="px-2.5 py-3 text-sm text-muted-foreground">还没有可引用的资源。</p>}</div></fieldset>{error && <p className="text-sm text-red-600">{error}</p>}</div><DialogFooter><Button onClick={() => onOpenChange(false)} type="button" variant="outline">取消</Button><Button disabled={submitting} onClick={() => void submit()} type="button">{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}交给 Codex 创建</Button></DialogFooter></DialogContent></Dialog>;
}
