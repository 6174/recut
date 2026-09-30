/*
 * [INPUT]: 依赖 next/link 客户端路由、lucide-react 的单一返回图标、顶层导航入口共用的悬停快捷浮层 WorkspaceNavHover 与可选左侧/居中/右侧插槽内容
 * [OUTPUT]: 对外提供 WorkspaceHeader，统一工作台所有页面顶栏为单行结构：一个返回入口（悬停展开快捷导航）+ 标题区（左侧）、可选居中区、可选右侧操作区
 * [POS]: web/components 的 Header 壳层；项目详情、独立 App 页与世界画布顶层 Header 共用同一份返回 + 单行标题版式，不再各自内联拼装
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavHover } from "@/components/workspace-back-menu";

const BACK_CLASS =
  "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground";

type WorkspaceHeaderProps = {
  actions?: ReactNode;
  back?: { href?: string; label: string; onClick?: () => void } | null;
  center?: ReactNode;
  children?: ReactNode;
};

export function WorkspaceHeader({ actions, back, center, children }: WorkspaceHeaderProps) {
  return (
    <header className="grid h-13 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b bg-card px-5">
      <div className="flex min-w-0 items-center gap-3">
        {back && (
          <WorkspaceNavHover>
            {back.onClick ? (
              <button aria-label={back.label} className={BACK_CLASS} onClick={back.onClick} type="button">
                <ArrowLeft className="size-4" />
              </button>
            ) : (
              <Link aria-label={back.label} className={BACK_CLASS} href={back.href ?? "/"}>
                <ArrowLeft className="size-4" />
              </Link>
            )}
          </WorkspaceNavHover>
        )}
        {back ? <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" /> : null}
        {children ? <div className="flex min-w-0 items-center gap-2">{children}</div> : null}
      </div>
      <div className="flex min-w-0 items-center justify-center">{center}</div>
      <div className="flex min-w-0 items-center justify-end gap-2">{actions}</div>
    </header>
  );
}
