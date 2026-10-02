/*
 * [INPUT]: 依赖 react、lucide-react 的 MoreHorizontal
 * [OUTPUT]: 对外提供 FieldManageMenu（字段标题右侧的管理 icon + popover）：重命名 / 重置内容 / 删除字段；
 * 能力由宿主（EntityEditor）注入——类型级操作带作用范围提示，locked 预设字段仅可重置内容
 * [POS]: web/components/world-entity 的字段行管理控件（画布字段区与设定视图共用）；只做投影与回调，不持数据面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

export type FieldManage = {
  /** 可重命名（locked 预设字段 / 宿主未接类型级能力时为 false） */
  canRename: boolean;
  /** 可删除字段（同上） */
  canRemove: boolean;
  /** 类型级操作的作用范围提示（如「作用于所有「视频脚本」设定」） */
  scopeHint?: string;
  /** 删除确认时的补充说明（如「已填内容保留为动态属性」） */
  removeHint?: string;
  onRename: (label: string) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  onReset: () => Promise<void> | void;
};

const MENU_WIDTH = 192;

export function FieldManageMenu({ label, manage }: { label: string; manage: FieldManage }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setAnchor(null);
    setRenaming(false);
    setConfirmRemove(false);
  };
  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await action();
      close();
    } finally {
      setBusy(false);
    }
  };

  // popover 走 fixed 定位（面板滚动容器会裁剪 absolute 弹层），锚点取管理 icon 右下角并夹进视口
  const left = anchor ? Math.max(8, Math.min(anchor.x - MENU_WIDTH, (typeof window !== "undefined" ? window.innerWidth : 1200) - MENU_WIDTH - 8)) : 0;
  const top = anchor ? Math.min(anchor.y + 4, (typeof window !== "undefined" ? window.innerHeight : 800) - 180) : 0;

  return (
    <>
      <button
        aria-label={`管理字段「${label}」`}
        className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setDraft(label);
          setAnchor((current) => (current ? null : { x: rect.right, y: rect.bottom }));
        }}
        title="管理字段"
        type="button"
      >
        <MoreHorizontal className="size-3" />
      </button>
      {anchor && (
        <div className="fixed inset-0 z-[70]" onPointerDown={close}>
          <div
            className="absolute w-48 rounded-lg border border-border bg-card p-1 text-xs shadow-2xl"
            onPointerDown={(event) => event.stopPropagation()}
            style={{ left, top }}
          >
            {manage.scopeHint && <p className="px-2 py-1 text-[10px] leading-4 text-muted-foreground">{manage.scopeHint}</p>}
            {manage.canRename &&
              (renaming ? (
                <div className="flex gap-1 p-1">
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && draft.trim()) void run(() => manage.onRename(draft.trim()));
                      if (event.key === "Escape") setRenaming(false);
                    }}
                    placeholder="字段名"
                    value={draft}
                  />
                  <button
                    className="rounded bg-primary px-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                    disabled={busy || !draft.trim()}
                    onClick={() => void run(() => manage.onRename(draft.trim()))}
                    type="button"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40" disabled={busy} onClick={() => setRenaming(true)} type="button">
                  重命名
                </button>
              ))}
            <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40" disabled={busy} onClick={() => void run(() => manage.onReset())} type="button">
              重置内容
            </button>
            {manage.canRemove &&
              (confirmRemove ? (
                <>
                  {manage.removeHint && <p className="px-2 pb-1 text-[10px] leading-4 text-muted-foreground">{manage.removeHint}</p>}
                  <button
                    className="block w-full rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => void run(() => manage.onRemove())}
                    type="button"
                  >
                    确认删除此字段？
                  </button>
                </>
              ) : (
                <button
                  className="block w-full rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => setConfirmRemove(true)}
                  type="button"
                >
                  删除字段
                </button>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
