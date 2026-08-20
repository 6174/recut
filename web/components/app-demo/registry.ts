/*
 * [INPUT]: 依赖各 App 的演示 module；仅做 appId → module 的静态映射
 * [OUTPUT]: 对外提供 appDemoRegistry，把已注册 App 的演示实现集中到这里；新增一个 App 的专属演示只需在此登记一行
 * [POS]: web/components/app-demo 的注册表；AppDemo 分发器据此选择渲染，未注册的 App 回退通用骨架
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { AppDemoModule } from "./types";
import { editorAppDemoModule } from "./app-demo-editor";

export const appDemoRegistry: Record<string, AppDemoModule> = {
  "recut.editor": editorAppDemoModule,
};
