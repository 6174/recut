/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 Apps 独立工作台入口
 * [POS]: web/app/apps 的目录路由壳；App 管理独立于 Studio，详情页 [appID] 仍保持原路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function AppsPage() {
  return <Workspace initialTab="apps" />;
}
