/**
 * [INPUT]: 依赖 Resource 类型、recut UI SDK、lucide 图标与 shadcn 风格弹窗组件
 * [OUTPUT]: 对外提供资源预览弹窗与新建资源弹窗
 * [POS]: vox-broll 的短暂交互层；不承载资源列表或项目事件状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Resource } from "./main";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Textarea } from "./ui";

export function ResourcePreviewDialog({ onOpenChange, resource }: { onOpenChange: (open: boolean) => void; resource: Resource | null }) {
  return <Dialog onOpenChange={onOpenChange} open={Boolean(resource)}><DialogContent><DialogHeader><div className="flex items-center gap-2"><Badge>{resource?.kind}</Badge><span className="text-xs text-muted-foreground">资源预览</span></div><DialogTitle>{resource?.title}</DialogTitle><DialogDescription>{resource?.dependencies.length ? `引用了 ${resource.dependencies.length} 个已有资源。` : "这是一个独立创建的资源。"}</DialogDescription></DialogHeader><pre className="max-h-[52vh] overflow-auto rounded-md border bg-muted/50 p-4 font-mono text-xs leading-5 text-foreground">{JSON.stringify(resource?.content, null, 2)}</pre></DialogContent></Dialog>;
}

export function CreateResourceDialog({ examples, onCreate, onOpenChange, open, resources, stage }: { examples: string[]; onCreate: (instruction: string, dependencies: string[]) => Promise<void>; onOpenChange: (open: boolean) => void; open: boolean; resources: Resource[]; stage: string }) {
  const [instruction, setInstruction] = useState("");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (!open) { setInstruction(""); setDependencies([]); setError(""); } }, [open]);
  const toggle = (id: string) => setDependencies((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const submit = async () => { setSubmitting(true); setError(""); try { await onCreate(instruction, dependencies); onOpenChange(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法提交创作请求"); } finally { setSubmitting(false); } };
  return <Dialog onOpenChange={onOpenChange} open={open}><DialogContent><DialogHeader><DialogTitle>新建 {stage}</DialogTitle><DialogDescription>填写创作意图，选择需要引用的现有资源，然后交给右侧 Codex 完成创作。</DialogDescription></DialogHeader><div className="grid gap-5"><label className="grid gap-2 text-sm font-medium">创作要求<Textarea onChange={(event) => setInstruction(event.target.value)} placeholder={`描述这个 ${stage} 希望呈现的方向、语气或约束`} value={instruction} /></label>{examples.length > 0 && <div className="flex flex-wrap gap-2">{examples.map((example) => <button className="rounded-md border bg-background px-2.5 py-1.5 text-left text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground" key={example} onClick={() => setInstruction(example)} type="button">{example}</button>)}</div>}<fieldset><legend className="mb-2 text-sm font-medium">引用资源 <span className="font-normal text-muted-foreground">（可选）</span></legend><div className="max-h-40 space-y-1 overflow-auto rounded-md border p-1">{resources.length ? resources.map((resource) => <label className="flex cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 text-sm hover:bg-muted" key={resource.id}><input checked={dependencies.includes(resource.id)} className="size-4 accent-primary" onChange={() => toggle(resource.id)} type="checkbox" /><span className="min-w-0 flex-1 truncate">{resource.title}</span><Badge>{resource.kind}</Badge></label>) : <p className="px-2.5 py-3 text-sm text-muted-foreground">还没有可引用的资源。</p>}</div></fieldset>{error && <p className="text-sm text-red-600">{error}</p>}</div><DialogFooter><Button onClick={() => onOpenChange(false)} type="button" variant="outline">取消</Button><Button disabled={submitting} onClick={() => void submit()} type="button">{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}交给 Codex 创建</Button></DialogFooter></DialogContent></Dialog>;
}
