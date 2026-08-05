/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /appstore 应用市场深链
 * [POS]: web/app/appstore 的目录路由壳；应用详情页 /apps/[appID] 的上级入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function AppstorePage() {
  return <Workspace initialTab="appstore" />;
}
