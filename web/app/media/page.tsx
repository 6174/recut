/*
 * [INPUT]: 依赖主工作台的共享路由容器
 * [OUTPUT]: 对外提供 /media 素材库深链
 * [POS]: web/app/media 的路由壳；复用工作台 Header、Agent 面板和素材库内容组件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Workspace } from "../page";

export default function MediaLibraryPage() {
  return <Workspace initialTab="assets" />;
}
