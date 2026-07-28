/*
 * [INPUT]: 依赖同目录的客户端项目详情容器与 Next.js 静态路由约定
 * [OUTPUT]: 对外提供可用于静态导出的项目路由壳与唯一的占位路径参数
 * [POS]: projects/[id] 的服务端路由边界；将交互与浏览器 API 隔离在 project-detail-client.tsx
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import ProjectDetailClient from "./project-detail-client";

// 静态站只需要一个壳；Worker 在边缘内部把任意 /projects/<id> 映射到它，
// 但浏览器地址保留真实 id。开发态仍可直接服务任意动态 id。
export function generateStaticParams() { return [{ id: "app" }]; }

export default function ProjectDetailPage() { return <ProjectDetailClient />; }
