/**
 * [INPUT]: manifest.backgroundModules 声明的后台模块，由 Recut runtime 按顺序加载到同一隔离上下文。
 * [OUTPUT]: 编辑器后台的稳定入口；实际业务按模型、持久化、操作、组件与导出职责拆分。
 * [POS]: recut.editor 后端 bootstrap；禁止重新堆放业务逻辑。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
