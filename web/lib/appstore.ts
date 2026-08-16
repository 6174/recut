/*
 * [INPUT]: 依赖构建时的云端市场基址（NEXT_PUBLIC_RECUT_SITE_URL，默认 https://recut.video）与 locales.ts 的 Locale
 * [OUTPUT]: 应用市场（可添加 App）的唯一云端数据源：从 <site>/api/appstore.json 拉取双语言目录，按当前语言取 name/description/requirements；离线或拉取失败返回空目录
 * [POS]: web/lib 的应用市场云端边界；工作台 Apps 市场与 App 详情页消费，取代静态 app-catalog；service 的嵌入式 appstore 仅服务 MCP recut.apps.store 发现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { type Locale, defaultLocale } from "@/lib/i18n/locales";

export const marketplaceBase = process.env.NEXT_PUBLIC_RECUT_SITE_URL ?? "https://recut.video";

export type MarketplaceRequirements = { title: string; items: string[]; note?: string };

export type MarketplaceApp = {
  appId: string;
  author: string;
  kind: "project" | "standalone";
  repository: string;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  requirements?: Record<Locale, MarketplaceRequirements>;
};

export function marketplaceName(app: MarketplaceApp, locale: Locale): string {
  return app.name[locale] ?? app.name[defaultLocale] ?? app.name.zh;
}

export function marketplaceDescription(app: MarketplaceApp, locale: Locale): string {
  return app.description[locale] ?? app.description[defaultLocale] ?? app.description.zh;
}

export function marketplaceRequirements(app: MarketplaceApp, locale: Locale): MarketplaceRequirements | undefined {
  const requirements = app.requirements?.[locale] ?? app.requirements?.zh;
  return requirements && (requirements.title !== "" || requirements.items.length > 0) ? requirements : undefined;
}

export async function loadMarketplace(): Promise<MarketplaceApp[]> {
  try {
    const response = await fetch(`${marketplaceBase}/api/appstore.json`, { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as { apps?: MarketplaceApp[] };
    return data.apps ?? [];
  } catch {
    return [];
  }
}
