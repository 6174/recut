/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /community/apps 社区应用分区深链
 * [POS]: web/app/community 的应用分区壳；复用工作台的 Apps 管理/市场能力，详情页 /apps/[appID] 保持原路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../../page";

export default function CommunityAppsPage() {
  return <Workspace communitySection="apps" initialTab="community" />;
}
