/*
 * [INPUT]: 依赖 React 局部状态与 lucide-react 的操作图标
 * [OUTPUT]: 对外提供 CardMoreMenu，在卡片上统一显示 More 菜单、重命名弹框与删除确认
 * [POS]: web/components 的实体卡片操作原子；项目与素材卡共享，不持有任何领域请求或缓存
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Ellipsis, Pencil, Trash2, X } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

type CardMoreMenuProps = {
  itemName: string;
  itemType: string;
  onDelete: () => Promise<void>;
  onRename: (name: string) => Promise<void>;
};

export function CardMoreMenu({ itemName, itemType, onDelete, onRename }: CardMoreMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(itemName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const stop = (event: MouseEvent) => event.stopPropagation();
  async function rename() {
    if (!name.trim() || saving) return;
    setSaving(true); setError("");
    try { await onRename(name.trim()); setEditing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `无法重命名${itemType}`); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (saving) return;
    setSaving(true); setError("");
    try { await onDelete(); setDeleting(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `无法删除${itemType}`); }
    finally { setSaving(false); }
  }
  return <><div className="relative" onClick={stop} onMouseDown={stop}><button aria-expanded={menuOpen} aria-haspopup="menu" aria-label={`${itemName} 的更多操作`} className="grid size-7 place-items-center rounded-xs bg-card/90 text-muted-foreground shadow-sm ring-1 ring-border/80 hover:bg-muted hover:text-foreground" onClick={() => setMenuOpen((value) => !value)} type="button"><Ellipsis className="size-4" /></button>{menuOpen && <div className="absolute right-0 top-8 z-30 w-28 rounded-xs border bg-card p-1 shadow-lg" role="menu"><button className="flex h-8 w-full items-center gap-2 rounded-xs px-2 text-left text-xs hover:bg-muted" onClick={() => { setName(itemName); setMenuOpen(false); setEditing(true); }} role="menuitem" type="button"><Pencil className="size-3.5" />重命名</button><button className="flex h-8 w-full items-center gap-2 rounded-xs px-2 text-left text-xs text-destructive hover:bg-destructive/10" onClick={() => { setMenuOpen(false); setDeleting(true); }} role="menuitem" type="button"><Trash2 className="size-3.5" />删除</button></div>}</div>{editing && <ActionDialog error={error} itemName={itemName} itemType={itemType} onClose={() => setEditing(false)} onSubmit={rename} saving={saving} title={`重命名${itemType}`}><label className="block text-xs font-medium" htmlFor="card-item-name">名称</label><input autoFocus className="mt-2 h-9 w-full rounded-xs border bg-background px-2 text-sm outline-none focus:border-primary" id="card-item-name" onChange={(event) => setName(event.target.value)} value={name} /></ActionDialog>}{deleting && <ActionDialog danger error={error} itemName={itemName} itemType={itemType} onClose={() => setDeleting(false)} onSubmit={remove} saving={saving} title={`删除${itemType}`}><p className="text-sm leading-6 text-muted-foreground">确定要删除「{itemName}」吗？此操作无法撤销。</p></ActionDialog>}</>;
}

function ActionDialog({ children, danger = false, error, itemName, itemType, onClose, onSubmit, saving, title }: { children: ReactNode; danger?: boolean; error: string; itemName: string; itemType: string; onClose: () => void; onSubmit: () => Promise<void>; saving: boolean; title: string }) {
  return <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-label={`${title}：${itemName}`}><section className="w-full max-w-sm rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{itemName}</p></div><button aria-label="关闭" className="grid size-7 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button></header><div className="p-4">{children}{error && <p className="mt-3 text-xs text-destructive">{error}</p>}</div><footer className="flex justify-end gap-2 border-t px-4 py-3"><button className="h-8 rounded-xs border px-3 text-xs hover:bg-muted" disabled={saving} onClick={onClose} type="button">取消</button><button className={`h-8 rounded-xs px-3 text-xs text-primary-foreground disabled:opacity-60 ${danger ? "bg-destructive hover:bg-destructive/85" : "bg-primary hover:bg-primary/85"}`} disabled={saving} onClick={() => void onSubmit()} type="button">{saving ? "处理中…" : danger ? "确认删除" : "保存"}</button></footer></section></div>;
}
