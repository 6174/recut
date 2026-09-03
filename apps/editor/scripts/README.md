# scripts/

> L2 | 父级: [/apps/editor/README.md](/Users/chenxuejia/ws/recut/apps/editor/README.md)

成员清单

- `test-model-api.js`: L0 时间线模型、op 日志、undo/redo、冲突与校验测试。
- `test-frame-render.js`: L0 preview/export UI presence、异步 handle 与 finalize 测试。
- `test-authoring-quality.js`: L0 生产 prompt、route/treatment 与 Markdown 工作稿质量门。
- `authoring-fixtures/`: 新片与二次编辑的普通 Markdown 工作稿样例；不是结构化 Plan。
- `test-mock.js`: L0 测试用内存 SQLite mock。
- `component-build.js`: 组件源码构建与静态契约辅助。
- `e2e-component-chain.test.js`: 组件创建、验证、解析与落轨链路测试。
- `build-effects-catalog.mjs`: 从内置 effect runtime 生成可浏览的效果目录。
- `decode-base64.js`: 将导出中间 base64 文件解码为二进制成片文件。

脚本只提供低成本回归和构建辅助；真实像素、导出与浏览器通信分别由 UI E2E 和平台测试负责。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
