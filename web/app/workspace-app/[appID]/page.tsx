/*
 * [INPUT]: 依赖同目录的独立 App 客户端容器与 Next.js 静态路由约定
 * [OUTPUT]: 对外提供工作区型 App 的静态导出路由壳
 * [POS]: workspace-app/[appID] 的服务端路由边界；不使用浏览器 API
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import StandaloneAppClient from "./standalone-app-client";

export function generateStaticParams() { return [{ appID: "app" }]; }

export default function WorkspaceAppPage() { return <StandaloneAppClient />; }
