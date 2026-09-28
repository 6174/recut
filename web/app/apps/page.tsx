/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /apps 到社区应用分区的兼容深链
 * [POS]: web/app/apps 的兼容路由壳；Apps 已并入社区，App 详情页 /apps/[appID] 仍保持原路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function AppsPage() {
  return <Workspace communitySection="apps" initialTab="community" />;
}
