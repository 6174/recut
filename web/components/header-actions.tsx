/*
 * [INPUT]: 依赖 lucide-react 的 Github 图标、ServiceControl 的 service 状态与操作、含 Recut Skill Tab 的 SettingsPanel 全局设置交互
 * [OUTPUT]: 对外提供工作台 Header 右侧的项目 GitHub 外链、统一 service 状态、可定向 Recut Skill Tab 的全局设置和可选上下文操作容器
 * [POS]: web/components 的 Header 操作组合层；首页与项目详情共用，避免全局状态脱离页面 Header
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { ReactNode } from "react";
import { Github } from "lucide-react";

import { ServiceControl } from "@/components/service-control";
import { SettingsPanel } from "@/components/settings-panel";

type HeaderActionsProps = {
  children?: ReactNode;
  settingsOpen?: boolean;
  settingsSection?: "service" | "apps" | "multimodal" | "skill";
  onSettingsOpenChange?: (open: boolean) => void;
};

export function HeaderActions({ children, onSettingsOpenChange, settingsOpen, settingsSection }: HeaderActionsProps) {
  return <div className="ml-4 flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground">
    {children}
    <ServiceControl />
    <SettingsPanel onOpenChange={onSettingsOpenChange} open={settingsOpen} section={settingsSection} />
    <span aria-hidden="true" className="h-5 w-px bg-border" />
    <a aria-label="在 GitHub 查看 Recut 项目" className="grid size-8 place-items-center rounded-sm transition-colors hover:bg-muted hover:text-foreground" href="https://github.com/6174/recut" rel="noreferrer" target="_blank" title="在 GitHub 查看 Recut 项目">
      <Github aria-hidden="true" className="size-4" />
    </a>
  </div>;
}
