# marketing/

> L2 | 父级: /web/app/README.md

成员清单
page.tsx: Recut 官网 Landing 路由；由 `recut.video` 与 `www.recut.video` 的根路径映射，按 Hero、核心应用、创作底座、团队主张、文章与最终 CTA 的信息节奏介绍本地优先 AI 视频创作并引导打开 App。
apps/: 公开应用市场；`page.tsx` 是 `/apps` 目录（Worker 从 Marketing Host 映射），`[appID]/page.tsx` 是每个 App 的 SEO 落地页，由 `lib/marketing-apps` 独立营销数据静态生成并挂载逐 App 元数据与 SoftwareApplication/Breadcrumb JSON-LD；与工作台 `lib/app-catalog` 解耦，仅 `id` 保持一致以打通深链。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
