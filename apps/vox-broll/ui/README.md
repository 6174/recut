# ui/

> L2 | 父级: /apps/vox-broll/README.md

成员清单
package.json: Vite、React、Tailwind、Radix Dialog / Dropdown Menu 与 shadcn 风格组件的独立构建配置。
vite.config.ts: Vite 构建配置；工作台版本由宿主 Header 统一展示，UI 包不重复注入版本号。
src/: 资源浏览、预览与新建弹窗的 React 源码；成员细节见 `src/README.md`。
index.html: Vite 的 React 挂载入口。
dist/: 由构建命令生成、由 manifest 提供给宿主的静态资源。

依赖关系
`main.tsx` 经 `recut-sdk.ts` 查询 App API，并消费父宿主从项目事件总线转发的能力完成事件；卡片与弹窗都不直接访问服务端。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
