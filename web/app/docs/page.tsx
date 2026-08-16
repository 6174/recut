/*
 * [INPUT]: 依赖 marketing-site 的官网外壳与文档导航内容
 * [OUTPUT]: 对外提供 recut.video/docs 与 localhost:3000/docs 的静态 Docs 页面
 * [POS]: web/app/docs 的公开文档入口；不读取工作台 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { DocsContent, MarketingShell } from "@/components/marketing-site";

export default function DocsPage() {
  return <MarketingShell><DocsContent /></MarketingShell>;
}
