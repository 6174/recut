/*
 * [INPUT]: 依赖同目录的客户端 Worlds 详情容器与 Next.js 静态路由约定
 * [OUTPUT]: 对外提供可用于静态导出的世界详情路由壳与唯一的占位路径参数
 * [POS]: worlds/[worldID] 的服务端路由边界；将交互与浏览器 API 隔离在 world-detail-client.tsx
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import WorldDetailClient from "./world-detail-client";

// 静态站只需要一个壳；Worker 在边缘内部把任意 /worlds/<id> 映射到它，
// 但浏览器地址保留真实 id。开发态仍可直接服务任意动态 id。
export function generateStaticParams() { return [{ worldID: "app" }]; }

export default function WorldDetailPage() { return <WorldDetailClient />; }
