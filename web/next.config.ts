/*
 * [INPUT]: 依赖 Next.js 的构建配置类型
 * [OUTPUT]: 对外提供 Web 工作台的 Next.js 配置
 * [POS]: web 的构建边界，避免把 Daemon 运行配置混入前端
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare 只托管不可变的 UI；浏览器仍通过 loopback HTTP 调用用户自己的
  // Recut service。开发/本地生产保持 standalone，发布时显式切换静态导出。
  output: process.env.RECUT_STATIC_EXPORT === "1" ? "export" : "standalone",
  trailingSlash: process.env.RECUT_STATIC_EXPORT === "1",
  images: { unoptimized: true },
};

export default nextConfig;
