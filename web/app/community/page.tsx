/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /community 社区首页入口（可扩展分区总览）
 * [POS]: web/app/community 的社区首页壳；复用工作台 Header、Agent 面板与 Community 容器，分区注册表见 lib/community-sections
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function CommunityPage() {
  return <Workspace initialTab="community" />;
}
