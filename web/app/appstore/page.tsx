/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /appstore 到 Apps 的兼容深链
 * [POS]: web/app/appstore 的兼容目录路由壳；应用详情页 /apps/[appID] 的上级入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function AppstorePage() {
  return <Workspace initialTab="apps" />;
}
