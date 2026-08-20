/*
 * [INPUT]: 依赖 React 节点与 Locale 类型；仅描述 App 演示组件的契约
 * [OUTPUT]: 对外提供 AppDemo 的模式与布局类型；mode 决定展示整体 UI（full）、局部 UI（panel）或集合用的 skeleton；layout 供通用 skeleton 推断 App 区域结构
 * [POS]: web/components/app-demo 的契约层；被 registry 与各 App 演示模块实现，不直接渲染
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n";

export type AppDemoMode = "full" | "panel" | "skeleton";

// 通用骨架按 App 形态区分区域结构：timeline = 左栏 + 预览 + 时间线；canvas = 主画布 + 侧栏
export type AppDemoLayout = "timeline" | "canvas";

export type AppDemoModule = {
  Full?: React.ComponentType<{ locale: Locale; animated: boolean; className?: string }>;
  Panel?: React.ComponentType<{ locale: Locale; className?: string }>;
  Skeleton?: React.ComponentType<{ layout: AppDemoLayout; className?: string }>;
};
