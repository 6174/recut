/*
 * [INPUT]: 依赖 marketing-site 的完整官网 Landing 编排
 * [OUTPUT]: 对外提供 recut.video 根路径的 Hero、核心应用、创作底座、团队主张、文章与 CTA Landing 页面
 * [POS]: web/app/marketing 的官网首页；仅经 Cloudflare Worker 的 Host 路由对外暴露为 `/`
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { MarketingLanding, MarketingShell } from "@/components/marketing-site";

export default function MarketingHomePage() {
  return <MarketingShell><MarketingLanding /></MarketingShell>;
}
