/**
 * [INPUT]: 依赖 Vite 与 React 插件
 * [OUTPUT]: 对外提供以相对资源地址交付给 Recut App Host 的构建配置
 * [POS]: ui 的静态构建边界；不包含业务或宿主通信
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ base: "./", plugins: [react()] });
