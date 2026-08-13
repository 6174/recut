/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /worlds Worlds 桌面深链
 * [POS]: web/app/worlds 的路由壳；复用工作台 Header、Agent 面板和 Worlds 内容组件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function WorldsPage() {
  return <Workspace initialTab="worlds" />;
}
