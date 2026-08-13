# builtin_apps/

> L2 | 父级: /service/README.md

remotion-studio.tar.gz: 发布构建从 `apps/remotion-studio/manifest.json` 的 `distribution.builtin` 规则生成的内置 App 包；新增源码默认进入归档，声明的生成物及 `.git`、`node_modules`、构建缓存不会进入。

editor.tar.gz: 发布构建先从 `apps/editor/ui/` 构建前端 bundle，再按 `apps/editor/manifest.json` 的 `distribution.builtin` 规则打包的内置剪辑器 App 包；`ui/src` 与依赖清单不进入归档，`ui/dist` 随包分发。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
