/*
 * [INPUT]: 依赖 Next.js 的构建配置类型
 * [OUTPUT]: 对外提供 Web 工作台的 Next.js 配置，以及开发时 localhost 官网到 /marketing 的服务端重写
 * [POS]: web 的构建边界，避免把 Daemon 运行配置混入前端；静态导出交给 Worker 按 Host 分流，开发服务器负责同一套 Host 语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { NextConfig } from "next";

const staticExport = process.env.RECUT_STATIC_EXPORT === "1";
const localHostRewrite: Pick<NextConfig, "rewrites"> = staticExport
  ? {}
  : {
    async rewrites() {
      return [{ source: "/", has: [{ type: "host", value: "localhost(?::\\d+)?" }], destination: "/marketing" }];
    },
  };

const nextConfig: NextConfig = {
  // Cloudflare 只托管不可变的 UI；浏览器仍通过 loopback HTTP 调用用户自己的
  // Recut service。开发/本地生产保持 standalone，发布时显式切换静态导出。
  output: staticExport ? "export" : "standalone",
  trailingSlash: staticExport,
  images: { unoptimized: true },
  ...localHostRewrite,
};

export default nextConfig;
