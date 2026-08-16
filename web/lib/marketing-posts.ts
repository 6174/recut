/*
 * [INPUT]: 不依赖浏览器、服务端或 UI 状态
 * [OUTPUT]: 对外提供官网 Blog 的静态文章目录与稳定 slug
 * [POS]: web/lib 的公开内容数据源；被静态路由生成与 Marketing UI 共同消费，避免客户端组件承担构建期数据职责
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const marketingPosts = [
  { date: "2026-08-16", description: "为什么创作工具应该让项目、素材和模型选择回到创作者手中。", slug: "local-first-creative-workspace", title: "为什么 AI 视频创作应该本地优先" },
  { date: "2026-08-12", description: "将视频编辑、世界观和声音工作流放进同一个可扩展的创作环境。", slug: "a-workspace-for-ai-video", title: "一个为 AI 视频而生的工作台" },
  { date: "2026-08-08", description: "让 App，而不是封闭的功能清单，成为 Recut 能力持续生长的方式。", slug: "creative-tools-should-be-extensible", title: "创作工具应当可以被扩展" },
] as const;
