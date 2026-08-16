/*
 * [INPUT]: 依赖 marketing-site 的官网外壳与文章目录
 * [OUTPUT]: 对外提供 recut.video/blog 与 localhost:3000/blog 的静态文章列表
 * [POS]: web/app/blog 的公开内容目录；不读取工作台 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { BlogContent, MarketingShell } from "@/components/marketing-site";

export default function BlogPage() {
  return <MarketingShell><BlogContent /></MarketingShell>;
}
