/*
 * [INPUT]: 依赖 Next.js 的构建配置类型
 * [OUTPUT]: 对外提供 Web 工作台的 Next.js 配置
 * [POS]: web 的构建边界，避免把 Daemon 运行配置混入前端
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
