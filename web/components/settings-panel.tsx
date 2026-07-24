/*
 * [INPUT]: 依赖 React 状态/键盘事件能力、lucide-react 图标和 Badge 信息原子
 * [OUTPUT]: 对外提供 SettingsPanel，在 Header 中打开带分类导航的本地设置面板
 * [POS]: web/components 的工作台级设置入口；集中承载应用、CLI、Agent 与多模态配置的后续扩展
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, Bot, Image, Settings, TerminalSquare, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";

type SettingSection = "apps" | "cli" | "agents" | "multimodal";

const sections: { id: SettingSection; label: string; icon: typeof AppWindow }[] = [
  { id: "apps", label: "应用管理", icon: AppWindow },
  { id: "cli", label: "本地 CLI", icon: TerminalSquare },
  { id: "agents", label: "本地 Agent", icon: Bot },
  { id: "multimodal", label: "多模态配置", icon: Image },
];

const details: Record<SettingSection, { title: string; description: string; items: { label: string; value: string; state?: string }[] }> = {
  apps: {
    title: "应用管理",
    description: "管理安装到本地工作台的创作应用。",
    items: [
      { label: "已安装应用", value: "将在这里查看、启用和管理本地 App" },
      { label: "应用来源", value: "本地 App 目录" },
    ],
  },
  cli: {
    title: "本地 CLI 程序",
    description: "查看本机命令行工具版本；升级能力将在后续版本开放。",
    items: [
      { label: "Recut CLI", value: "版本检测将在后续版本接入", state: "即将推出" },
      { label: "升级", value: "将支持检查与安装最新版本", state: "即将推出" },
    ],
  },
  agents: {
    title: "本地 Agent 配置",
    description: "集中查看可用 Agent 的连接和运行状态。",
    items: [
      { label: "Codex", value: "状态检测将在后续版本接入", state: "待检测" },
      { label: "Claude Code", value: "状态检测将在后续版本接入", state: "待检测" },
      { label: "Gemini", value: "状态检测将在后续版本接入", state: "待检测" },
    ],
  },
  multimodal: {
    title: "多模态配置",
    description: "为图像生成、音频和图片处理预留统一的设置入口。",
    items: [
      { label: "图像生成", value: "模型、尺寸和质量设置", state: "即将推出" },
      { label: "音频", value: "配音、音乐和音效设置", state: "即将推出" },
      { label: "图片", value: "导入与处理偏好设置", state: "即将推出" },
    ],
  },
};

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingSection>("apps");
  const detail = details[activeSection];

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return <>
    <button aria-expanded={open} aria-haspopup="dialog" aria-label="打开设置" className="grid size-8 place-items-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => setOpen(true)} title="设置" type="button"><Settings className="size-4" /></button>
    {open && <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/20 p-6 backdrop-blur-[1px]" onMouseDown={() => setOpen(false)} role="dialog">
      <section aria-labelledby="settings-title" className="grid h-[min(620px,calc(100vh-3rem))] w-full max-w-4xl overflow-hidden rounded-sm border bg-card shadow-2xl [grid-template-columns:216px_minmax(0,1fr)]" onMouseDown={(event) => event.stopPropagation()}>
        <nav aria-label="设置分类" className="border-r bg-muted/40 p-4">
          <div className="mb-7 px-2 pt-1"><p className="font-mono text-[10px] tracking-wide text-muted-foreground">RECUT</p><p className="mt-1.5 text-sm font-semibold">设置</p></div>
          <div className="space-y-1">{sections.map((section) => {
            const Icon = section.icon;
            return <button className={`flex h-9 w-full items-center gap-2.5 rounded-xs px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${activeSection === section.id ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} key={section.id} onClick={() => setActiveSection(section.id)} type="button"><Icon className="size-3.5" />{section.label}</button>;
          })}</div>
        </nav>
        <div className="min-w-0 overflow-y-auto p-8">
          <div className="flex items-start justify-between gap-4 border-b pb-6"><div><h2 className="text-lg font-semibold" id="settings-title">{detail.title}</h2><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{detail.description}</p></div><button aria-label="关闭设置" className="-mr-2 -mt-2 grid size-8 place-items-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => setOpen(false)} type="button"><X className="size-4" /></button></div>
          <div className="divide-y">{detail.items.map((item) => <div className="flex min-h-20 items-center justify-between gap-5 py-5" key={item.label}><div><p className="text-sm font-medium">{item.label}</p><p className="mt-1.5 text-xs text-muted-foreground">{item.value}</p></div>{item.state && <Badge className="shrink-0">{item.state}</Badge>}</div>)}</div>
        </div>
      </section>
    </div>}
  </>;
}
