/**
 * [INPUT]: 依赖 @tailwindcss/postcss 的构建插件
 * [OUTPUT]: 对外提供 Next.js 编译 Tailwind v4 样式的 PostCSS 配置
 * [POS]: web 的样式构建边界，不包含任何产品运行时逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
