/*
 * [INPUT]: 依赖同目录的客户端 App 详情容器与 Next.js 静态路由约定
 * [OUTPUT]: 对外提供可用于静态导出的 App 详情路由壳与唯一的占位路径参数
 * [POS]: apps/[appID] 的服务端路由边界；将浏览器 API 与交互隔离在 app-detail-client.tsx
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import AppDetailClient from "./app-detail-client";

export function generateStaticParams() { return [{ appID: "app" }]; }

export default function AppDetailPage() { return <AppDetailClient />; }
