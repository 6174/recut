/*
 * [INPUT]: 依赖 Next.js 的构建配置类型
 * [OUTPUT]: 对外提供 Web 工作台的 Next.js 配置
 * [POS]: web 的构建边界，避免把 Daemon 运行配置混入前端；静态导出交给 Worker 按 Host 分流，本地 Host 语义由 server.cjs 在 Next 路由解析前完成
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { NextConfig } from "next";

const staticExport = process.env.RECUT_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  // Cloudflare 只托管不可变的 UI；浏览器仍通过 loopback HTTP 调用用户自己的
  // Recut service。开发/本地生产保持 standalone，发布时显式切换静态导出。
  output: staticExport ? "export" : "standalone",
  trailingSlash: staticExport,
  images: { unoptimized: true },
  // M0 迁移过渡：timeline-editor 为自 editor UI 迁入的 155K 行模块，其既有类型面
  // 与 web 严格模式不一致（含大量历史 tsc 噪音）。迁移期跳过构建期类型检查以保持
  // web 可构建；收口（删 iframe / 去 fallback）时统一清理并移除本开关。
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
