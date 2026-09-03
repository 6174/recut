/**
 * [INPUT]: shader-effects registry、host 与 effect definitions。
 * [OUTPUT]: 元素 Shader Motion 公共 API。
 * [POS]: runtime 对外聚合层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export * from "./types";
export * from "./registry";
export * from "./host";
