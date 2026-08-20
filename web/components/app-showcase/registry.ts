/*
 * [INPUT]: 依赖各 App 的 showcase 定义；仅做 appId → showcase 的静态映射
 * [OUTPUT]: 对外提供 appShowcaseRegistry，把已注册 App 的「小官网」特性清单集中到这里；新增一个 App 的模块展示只需在此登记一行
 * [POS]: web/components/app-showcase 的注册表；AppShowcaseView 据此选择渲染，未注册的 App 回退 blog/文档模式
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { AppShowcase } from "./types";
import { editorShowcase } from "./editor-showcase";

export const appShowcaseRegistry: Record<string, AppShowcase> = {
  "recut.editor": editorShowcase,
};
