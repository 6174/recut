/*
 * [INPUT]: 依赖 appShowcaseRegistry、AppDemo（整体 UI）与 ShowcaseFeature 契约、Locale 类型
 * [OUTPUT]: 对外提供 AppShowcaseView——按 appId 渲染「小官网」式展示：先直接呈现完整 App UI 作 Hero，再逐节呈现各功能模块（标题/描述 + 局部 UI 演示），左右交替排布；页面 Hero 由上层统一渲染，避免重复标题或无意义嵌套外框
 * [POS]: web/components/app-showcase 的统一视图；营销 App 详情与工作台 App 详情都通过它展示 App 的模块，未来新增 App 只改 registry
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n";
import { AppDemo } from "@/components/app-demo";
import { appShowcaseRegistry } from "./registry";
import type { ShowcaseFeature } from "./types";

export function AppShowcaseView({
  appId,
  kind,
  locale,
  fallback,
}: {
  appId: string;
  kind?: "project" | "standalone";
  locale: Locale;
  fallback: React.ReactNode;
}) {
  const showcase = appShowcaseRegistry[appId];
  if (!showcase) return <>{fallback}</>;
  const zh = locale === "zh";
  return (
    <div className="space-y-14">
      <AppDemo appId={appId} mode="full" kind={kind} locale={locale} animated />
      {showcase.features.map((feature: ShowcaseFeature, index: number) => {
        const Demo = feature.demo;
        const demo = <Demo locale={locale} />;
        const text = (
          <div className="flex flex-col justify-center">
            <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary">{String(index + 1).padStart(2, "0")} · {zh ? "模块" : "MODULE"}</p>
            <h3 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">{feature.title(locale)}</h3>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{feature.description(locale)}</p>
          </div>
        );
        return (
          <section className="grid items-center gap-6 lg:grid-cols-2 lg:gap-10" key={feature.id}>
            {index % 2 === 0 ? <>{text}{demo}</> : <>{demo}{text}</>}
          </section>
        );
      })}
    </div>
  );
}
