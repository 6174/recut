/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /apps 应用目录深链
 * [POS]: web/app/apps 的目录路由壳；详情页 [appID] 的上级入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function AppsPage() {
  return <Workspace initialTab="apps" />;
}
