/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /worlds 到社区世界分区的兼容深链
 * [POS]: web/app/worlds 的兼容路由壳；独立 Worlds 桌面已并入社区，世界详情 /worlds/[worldID] 保持原路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function WorldsPage() {
  return <Workspace communitySection="worlds" initialTab="community" />;
}
