# background/

> L2 | 父级: /apps/editor/README.md

成员清单
model-base.js: 时间轴、轨道、元素、关键帧与自动混音的纯模型，无持久化副作用。
subtitles.js: SRT/ASS 解析、字幕共享样式和导出。
script-model.js: speech-track 文稿的解析、排版与 op 生成。
op-engine.js: 统一时间线 mutation、校验与读模型。
project-store.js: SQLite schema、项目版本、命令日志与 undo/redo；保存 AI 独占锁的 owner/token 与工作单元 checkpoint。
project-operations.js: 项目、时间线、字幕、文稿、混音的 operation 注册；project.lock/unlock 以 owner+token 管理多步编辑，preview/export 绑定创建时的 timeline version，work.cancel 只回退归属当前 checkpoint 的命令。
assets.js: 项目素材引用索引；只保存 assetId/type/refId/refVersionId/status，不拥有组件源码，归档 component 引用时广播素材变更。
catalog-export.js: 内置目录、导出、封面和影片包的 operation 注册。
components.js: 组件版本、受信模板创建、代码/浏览器验证报告、组件数据生命周期和 runtime 查询；verified head 同步到 assets.js 的 component 引用。

模块按 `manifest.json` 的 `backgroundModules` 顺序在同一 Goja sandbox 加载。模块间通过全局函数协作，但依赖方向只能从模型 → 持久化 → operation 适配；新增领域不得回填到 `background.js`。所有可写时间线操作仍从 `timeline.command` 进入统一日志，锁、checkpoint、版本校验只是这条写入链的会话边界与异步安全护栏。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
