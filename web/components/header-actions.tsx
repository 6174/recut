/*
 * [INPUT]: 依赖 ServiceControl 的 service 状态与操作，依赖 SettingsPanel 的全局设置交互
 * [OUTPUT]: 对外提供工作台 Header 右侧的统一 service 状态、全局设置和可选上下文操作容器
 * [POS]: web/components 的 Header 操作组合层；首页与项目详情共用，避免全局状态脱离页面 Header
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { ReactNode } from "react";

import { ServiceControl } from "@/components/service-control";
import { SettingsPanel } from "@/components/settings-panel";

type HeaderActionsProps = {
  children?: ReactNode;
  settingsOpen?: boolean;
  settingsSection?: "service" | "apps" | "cli" | "agents" | "onboarding" | "multimodal";
  onSettingsOpenChange?: (open: boolean) => void;
};

export function HeaderActions({ children, onSettingsOpenChange, settingsOpen, settingsSection }: HeaderActionsProps) {
  return <div className="ml-4 flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground">
    {children}
    <ServiceControl />
    <SettingsPanel onOpenChange={onSettingsOpenChange} open={settingsOpen} section={settingsSection} />
  </div>;
}
