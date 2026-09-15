/*
 * [INPUT]: 依赖 guided 目录内各模块
 * [OUTPUT]: 对外提供引导提示操作的全部公共入口（类型、推断、上下文装配、注册表与动作数据）
 * [POS]: web/lib/world-entity/guided 的统一出口；组件只从 "@/lib/world-entity/guided" 导入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export * from "./types";
export * from "./media-purpose";
export * from "./refs";
export * from "./cards";
export * from "./context";
export * from "./entity-actions";
export * from "./media-actions";
export * from "./registry";
