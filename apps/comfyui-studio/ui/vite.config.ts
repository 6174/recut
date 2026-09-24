/**
 * [INPUT]: 依赖 Vite、React 插件与 Tailwind CSS v4 Vite 插件
 * [OUTPUT]: 对外提供以相对资源地址交付给 Recut App Host 的构建配置
 * [POS]: ui 的静态构建边界；不包含业务或宿主通信
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ base: "./", plugins: [tailwindcss(), react()] });
