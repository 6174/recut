/*
 * [INPUT]: 依赖 react、canvas-store（toasts 队列与 dismissToast）
 * [OUTPUT]: 对外提供 CanvasToasts：底部 toast 队列（B.4 反馈分级，详情面板停靠对侧）——结构性语义操作轻反馈，
 * 3s 自消；错误态可带 [重试] 动作按钮
 * [POS]: worlds/[worldID]/canvas 的反馈层（T10 核心，T5 关系体验先行复用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useWorldCanvasStore } from "./canvas-store";

export function CanvasToasts() {
  const toasts = useWorldCanvasStore((state) => state.toasts);
  const panelSide = useWorldCanvasStore((state) => state.panelSide);
  if (!toasts.length) return null;
  return (
    <div className={`pointer-events-none absolute bottom-4 z-40 flex flex-col gap-2 ${panelSide === "left" ? "right-4" : "left-4"}`}>
      {toasts.map((item) => (
        <div
          className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2 text-xs shadow-lg ${
            item.kind === "error"
              ? "border-destructive/40 bg-card text-destructive"
              : item.kind === "success"
                ? "border-border bg-card text-foreground"
                : "border-border bg-card text-foreground"
          }`}
          key={item.id}
        >
          <span className="max-w-72">{item.text}</span>
          {item.action && (
            <button
              className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted"
              onClick={() => {
                item.action?.run();
                useWorldCanvasStore.getState().dismissToast(item.id);
              }}
              type="button"
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
