/*
 * [INPUT]: 依赖 lucide-react 的应用语义图标
 * [OUTPUT]: 对外提供按 App ID 解析的 appIcon 与统一浅绿应用图标徽标 AppIdentityIcon
 * [POS]: web/components 的 App 身份视觉原子；首页、应用中心、详情、工作区头部和 Agent 引用卡都通过它展示同一 App 身份
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { AppWindow, Box, Clapperboard, ImageIcon, Music2, Video, type LucideIcon } from "lucide-react";

export function appIcon(appID: string): LucideIcon {
  if (appID === "recut.vox-broll") return Clapperboard;
  if (appID === "recut.remotion-studio") return Video;
  if (appID === "recut.audio-studio") return Music2;
  if (appID === "recut.cover-studio") return ImageIcon;
  if (appID === "recut.depth-anything") return Box;
  return AppWindow;
}

export function AppIdentityIcon({ appID, className = "", iconClassName = "" }: { appID: string; className?: string; iconClassName?: string }) {
  const Icon = appIcon(appID);
  return <span className={`grid size-11 shrink-0 place-items-center rounded-xl border border-primary/10 bg-primary/10 text-primary ${className}`}><Icon aria-hidden="true" className={`size-5 ${iconClassName}`} strokeWidth={1.8} /></span>;
}
