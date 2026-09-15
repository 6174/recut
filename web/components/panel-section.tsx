/*
 * [INPUT]: 依赖 react、lucide-react 的 ChevronDown
 * [OUTPUT]: 对外提供 PanelSection：Figma 风格的分组容器——整宽分隔线（不留 padding）、统一分组标题、
 *   可折叠（默认展开）、右侧 action 槽；accent 用于「AI」这类需要强调的分组
 * [POS]: web/components 的通用属性面板排版原语；媒体/实体详情面板共用，让信息多但分组清晰
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useState, type ReactNode } from "react";

export function PanelSection({
  title,
  action,
  first = false,
  accent = false,
  collapsible = true,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  /** 面板最顶部的一组：不画上分隔线 */
  first?: boolean;
  /** 强调分组（如「用 AI 完善」）：标题用主色 */
  accent?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const titleClass = `min-w-0 truncate text-xs font-semibold ${accent ? "text-primary" : "text-foreground"}`;
  return (
    // -mx-4：分隔线整宽（贴面板左右边缘）并与内容区的 p-4 对齐；first 再用 -mt-4 抵消容器顶部 padding
    <section className={`-mx-4 ${first ? "-mt-4" : "border-t border-border/70"}`}>
      <div className="flex items-center justify-between gap-2 px-4 pb-1.5 pt-3">
        {collapsible ? (
          <button className={`${titleClass} text-left hover:opacity-80`} onClick={() => setOpen((value) => !value)} type="button">
            {title}
          </button>
        ) : (
          <h4 className={titleClass}>{title}</h4>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {collapsible && (
            // 折叠开关放最右，标题左对齐内容，排版更整齐
            <button
              aria-expanded={open}
              aria-label={open ? "收起分组" : "展开分组"}
              className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              <span className="text-sm leading-none">{open ? "−" : "+"}</span>
            </button>
          )}
        </div>
      </div>
      {open && <div className="space-y-2 px-4 pb-3 pt-2">{children}</div>}
    </section>
  );
}
