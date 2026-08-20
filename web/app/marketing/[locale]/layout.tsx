/*
 * [INPUT]: 依赖 lib/i18n 语言枚举与 marketing-site 的 MarketingLocaleProvider
 * [OUTPUT]: [locale] 路由的动态段 layout：generateStaticParams 枚举 ["zh", "en"]，经 client 的 MarketingLocaleProvider 注入 locale 并设置 document.documentElement.lang；本地/内嵌模式（WORKSPACE_MODE=local）不导出任何 marketing 路由，营销站点只由 Cloudflare Worker 提供
 * [POS]: web/app/marketing/[locale] 的逐语言外壳；各页面仍需显式导出 generateMetadata 与 robots/canonical/hreflang
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { locales, type Locale } from "@/lib/i18n";
import { MarketingLocaleProvider } from "@/components/marketing-site";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function MarketingLocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <MarketingLocaleProvider locale={locale as Locale}>{children}</MarketingLocaleProvider>;
}
