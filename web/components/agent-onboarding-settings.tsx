/*
 * [INPUT]: 依赖用户级 onboarding HTTP API、React 状态与基础表单 UI 原子组件
 * [OUTPUT]: 对外提供全局新对话引导的新增、编辑、删除与保存设置界面
 * [POS]: components/settings-panel 的 Agent 引导配置内容；不编辑 App manifest，只维护本机全局补充项
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Guide = { id: string; title: string; description: string; prompt: string };
function newGuide(): Guide { return { id: `guide-${crypto.randomUUID()}`, title: "", description: "", prompt: "" }; }

export function AgentOnboardingSettings({ apiBase }: { apiBase: string }) {
  const [items, setItems] = useState<Guide[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void (async () => { const response = await fetch(`${apiBase}/v1/agent-onboarding`); if (!response.ok) return; const payload = await response.json() as { items?: Guide[] }; setItems(payload.items ?? []); })(); }, [apiBase]);
  function update(index: number, patch: Partial<Guide>) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  async function save() {
    if (items.some((item) => !item.title.trim() || !item.prompt.trim())) { setMessage("每个引导都需要标题和点击后写入的提示词。"); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/agent-onboarding`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      if (!response.ok) throw new Error("保存失败");
      setMessage("已保存。它会作为没有 App 引导时的全局补充项出现。");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "保存失败"); } finally { setSaving(false); }
  }

  return <section className="max-w-2xl pt-6"><div className="flex items-start justify-between gap-5"><div><p className="text-sm font-medium">全局新对话引导</p><p className="mt-1 text-xs leading-5 text-muted-foreground">它会排在当前 App 的 manifest 引导之后。若两者都未配置，平台仍会显示内置的非空兜底。</p></div><Button onClick={() => setItems((current) => [...current, newGuide()])} type="button" variant="outline"><Plus className="size-3.5" />新增引导</Button></div><div className="mt-5 space-y-3">{items.length === 0 ? <div className="border border-dashed p-5 text-xs leading-5 text-muted-foreground">还没有全局引导。你可以新增常用的创作起点；不配置时，平台默认引导仍会出现。</div> : items.map((item, index) => <article className="border bg-muted/15 p-4" key={item.id}><div className="flex items-start justify-between gap-4"><p className="text-xs font-medium">引导 {index + 1}</p><Button aria-label={`删除引导 ${index + 1}`} className="size-7 p-0" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button" variant="ghost"><Trash2 className="size-3.5" /></Button></div><div className="mt-3 grid gap-3"><div><label className="mb-1.5 block text-xs font-medium" htmlFor={`onboarding-title-${item.id}`}>标题</label><Input id={`onboarding-title-${item.id}`} onChange={(event) => update(index, { title: event.target.value })} placeholder="例如：规划一支品牌片" value={item.title} /></div><div><label className="mb-1.5 block text-xs font-medium" htmlFor={`onboarding-description-${item.id}`}>说明</label><Input id={`onboarding-description-${item.id}`} onChange={(event) => update(index, { description: event.target.value })} placeholder="用一句话说明用户会从哪里开始" value={item.description} /></div><div><label className="mb-1.5 block text-xs font-medium" htmlFor={`onboarding-prompt-${item.id}`}>点击后写入的提示词</label><textarea className="block min-h-24 w-full rounded-sm border bg-background px-3 py-2 text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" id={`onboarding-prompt-${item.id}`} onChange={(event) => update(index, { prompt: event.target.value })} placeholder="输入要写入对话框的完整提示词" value={item.prompt} /></div></div></article>)}</div><div className="mt-5 flex items-center gap-3"><Button disabled={saving} onClick={() => void save()} type="button">{saving ? "正在保存…" : "保存全局引导"}</Button>{message && <p className="text-xs text-muted-foreground">{message}</p>}</div></section>;
}
