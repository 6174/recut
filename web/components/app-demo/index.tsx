/*
 * [INPUT]: 依赖 appDemoRegistry、通用 AppDemoSkeleton、AppDemoMode/AppDemoLayout 类型与 Locale
 * [OUTPUT]: 对外提供 AppDemo——按 appId 选择专属演示 module，按 mode 渲染整体 UI（full）、局部 UI（panel）或集合用的 skeleton；未注册 App 一律按 kind 推断 layout 走通用骨架
 * [POS]: web/components/app-demo 的统一入口；homepage hero、App Store 列表、App 详情与营销页都通过它展示 App 的 UI，未来新增 App 只改 registry
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n";
import { appDemoRegistry } from "./registry";
import { AppDemoSchematic } from "./app-demo-skeleton";
import type { AppDemoLayout, AppDemoMode } from "./types";

export function AppDemo({
  appId,
  mode,
  locale,
  kind,
  animated = false,
  className,
}: {
  appId: string;
  mode: AppDemoMode;
  locale: Locale;
  kind?: "project" | "standalone";
  animated?: boolean;
  className?: string;
}) {
  const module = appDemoRegistry[appId];
  const layout: AppDemoLayout = kind === "standalone" ? "canvas" : "timeline";

  if (mode === "skeleton") {
    const Skeleton = module?.Skeleton ?? AppDemoSchematic;
    return <Skeleton layout={layout} className={className} />;
  }

  if (mode === "panel") {
    if (module?.Panel) return <module.Panel locale={locale} className={className} />;
    return <AppDemoSchematic layout={layout} className={className} />;
  }

  if (module?.Full) return <module.Full locale={locale} animated={animated} className={className} />;
  return <AppDemoSchematic layout={layout} className={className} />;
}
