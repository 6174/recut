/*
 * [INPUT]: 依赖项目详情 API、当前项目名称与重命名后的目录刷新回调
 * [OUTPUT]: 对外提供 EditableProjectName，在悬停提示后编辑并保存项目名称
 * [POS]: projects/[id] 顶栏的项目名称控件；由 project-detail-client 承载，统一服务所有项目型 App
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type EditableProjectNameProps = {
  apiBase: string;
  name: string;
  onRenamed: () => Promise<void>;
  projectID: string;
};

export function EditableProjectName({ apiBase, name, onRenamed, projectID }: EditableProjectNameProps) {
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);

  function startEditing() {
    setError("");
    setEditing(true);
    requestAnimationFrame(() => input.current?.select());
  }

  async function save() {
    if (saving) return;
    const nextName = draft.trim();
    if (!nextName || nextName === name) {
      setDraft(name);
      setEditing(false);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/v1/projects/${encodeURIComponent(projectID)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      if (!response.ok) throw new Error("项目名称保存失败");
      await onRenamed();
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目名称保存失败");
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(name);
    setError("");
    setEditing(false);
  }

  if (editing) {
    return <div className="relative min-w-0"><input aria-label="项目名称" className="h-7 max-w-[22rem] rounded-xs border border-primary bg-background px-2 text-sm font-medium outline-none ring-2 ring-ring/30" disabled={saving} onBlur={() => void save()} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); input.current?.blur(); } if (event.key === "Escape") { event.preventDefault(); cancel(); } }} ref={input} value={draft} />{error && <p className="absolute left-0 top-full mt-1 whitespace-nowrap text-xs text-destructive" role="alert">{error}</p>}</div>;
  }

  return <button className="group flex max-w-[22rem] items-center rounded-xs px-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={startEditing} title="点击编辑项目名称" type="button"><span className="truncate text-sm font-medium">{name}</span><Pencil aria-hidden="true" className="ml-1.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /></button>;
}
