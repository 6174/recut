# worlds/

> L2 | 父级: /web/app/README.md

成员清单
page.tsx: `/worlds` Worlds 桌面深链壳；复用主工作台以保持 Header、Agent 面板和激活 Tab 一致。
worlds-client.tsx: 工作区级原生 React Worlds 桌面内容；供 `/worlds` 与主工作台复用，顶部搜索/类型筛选与新建 World 对话框，主区为 World 卡片网格，显示名称、定位、最近更新时间与实体计数；创建成功后显式失效刷新并进入世界详情，绝不轮询。
[worldID]/page.tsx: 世界详情路由的服务端壳；只导出静态站需要的占位参数并挂载客户端容器，不能使用浏览器 API。
[worldID]/world-detail-client.tsx: 世界详情客户端容器；从真实路径读取 worldID，呈现 Overview、Characters、Stories、Styles、Rules 与 References 五个核心区域，支持实体创建/编辑（content 为结构化 JSON）、以语义 role 把已完成素材附加为 Reference、resolve 当前选区预览 CreationContext，以及从 Story 创建绑定固定 World revision 的 Remotion 项目。

依赖边界

本页面只调用 Daemon 的 `/v1/worlds*` 与 `/v1/projects/*/world-context` REST facade；世界业务表归平台 WorldStore 独占，原生页面不直接访问任何 App 的 SQLite 或文件。World 是系统级列表，不属于 App Catalog、安装管理或 iframe，`recut.creation-worlds` 不进入 `web/lib/app-catalog.ts`。所有读取都要求显式 `worldId`，没有隐式当前 World。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
