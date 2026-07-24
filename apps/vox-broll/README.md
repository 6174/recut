# vox-broll/

> L2 | 父级: /apps/README.md

成员清单
manifest.json: 声明 Vox B-roll Explainer App 身份与项目布局入口。
project-layout.json: 定义从 Brief 到 Delivery 的七个可编辑 source state。
schemas/: 约束 Brief、Beat map、视觉、关键帧、动态、音频和交付方案。

服务边界
此 App 只覆盖 B-roll：主题到 Vox 风格纸质拼贴解说片。每一步由 Agent 通过 Bridge 提案写入其 source state，UI 提供当前步骤的可复制 prompt；媒体生成、渲染和导出随后接入 Job service。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
