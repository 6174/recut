/*
 * [INPUT]: 依赖 Locale 类型与 React 组件类型
 * [OUTPUT]: 对外提供 AppShowcase 与 ShowcaseFeature 契约；feature 自带标题/描述（按语言取文案）与一个局部 UI 演示组件，AppShowcaseView 据此渲染「小官网」式的模块展示
 * [POS]: web/components/app-showcase 的契约层；每个 App 注册自己的 showcase，未注册的 App 在详情页回退 blog/文档模式
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n";

export type ShowcaseFeature = {
  id: string;
  title: (locale: Locale) => string;
  description: (locale: Locale) => string;
  demo: React.ComponentType<{ locale: Locale }>;
};

export type AppShowcase = {
  features: ShowcaseFeature[];
};
