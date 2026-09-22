/*
 * [INPUT]: 依赖 timeline-editor 模块内的 EditorShell（自 apps/editor/ui 迁移，React 19 + R3F 9）与宿主注入的 RecutHostAdapter。
 * [OUTPUT]: web 统一前端的 timeline-editor 模块入口；供 projects/[id] 原生挂载（无 iframe），并暴露传送带配置。
 * [POS]: M0 迁移的模块边界；模块内代码仍沿用 @timeline/* 别名，不反向依赖 web 业务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export { EditorShell } from "./src/editor/editor-shell";
export { ComponentPreview } from "./src/components/editor/panels/assets/views/component-preview";
export { configureRecutHost } from "./src/recut/host";
export type { RecutHostAdapter } from "./src/recut/host";

