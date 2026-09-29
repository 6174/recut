/*
 * [INPUT]: 依赖含 Service 状态/连接分类的 SettingsPanel 全局设置交互与工作台页面的可选上下文操作
 * [OUTPUT]: 对外提供工作台 Header 右侧的统一设置入口（service 状态由设置图标承载）与可选上下文操作容器
 * [POS]: web/components 的 Header 操作组合层；首页与项目详情共用，避免全局状态脱离页面 Header
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { ReactNode } from "react";

import { SettingsPanel } from "@/components/settings-panel";

type HeaderActionsProps = {
  children?: ReactNode;
  settingsOpen?: boolean;
  settingsSection?: "service" | "multimodal" | "skill" | "mcp";
  onSettingsOpenChange?: (open: boolean) => void;
};

export function HeaderActions({ children, onSettingsOpenChange, settingsOpen, settingsSection }: HeaderActionsProps) {
  return <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground">
    {children}
    <SettingsPanel onOpenChange={onSettingsOpenChange} open={settingsOpen} section={settingsSection} />
  </div>;
}
