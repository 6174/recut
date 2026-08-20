# app-demo/

> L2 | 父级: /web/components/README.md

成员清单

types.ts: App 演示的 full/panel/skeleton 契约，统一 Locale、布局与展示模式。
registry.ts: appId 到专属演示模块的静态分发注册表。
app-demo-editor.tsx: Editor 的完整工作台、AI 导演面板与循环播放演示，复用在首页 Hero 和 App Showcase。
editor-features.tsx: Editor 的素材库、组件、字体与 AI 导演局部功能演示，使用 GSAP/SVG 表达工作流过程。
index.tsx: App 演示入口，根据 appId 与 mode 选择专属模块或通用骨架。

依赖边界

本目录只表达产品 UI，不连接 service、不读取用户项目；动画以 DOM 生命周期清理，并尊重 `prefers-reduced-motion`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
