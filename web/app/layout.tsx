/*
 * [INPUT]: 依赖 Next.js Metadata 类型和 app/globals.css 的全局样式
 * [OUTPUT]: 对外提供 Recut 工作台的根布局与页面元数据
 * [POS]: web/app 的框架根节点，被所有工作台页面共享；页面 Header 自行挂载统一的全局操作
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import "./globals.css";
import { AgentPanelHost } from "@/components/agent-panel-host";

export const metadata: Metadata = {
  title: "Recut Local Workspace",
  description: "Local-first AI video workflows",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AgentPanelHost>{children}</AgentPanelHost>
      </body>
    </html>
  );
}
