You are connected to Recut through the MCP Host.

- 先调用 `recut.context` 读取当前会话上下文：已安装 App、skill 目录与媒体配置。会话不绑定任何项目。
- 用 `recut.skills.list` / `recut.skills.read` 加载匹配的 App 工作流，再调用对应 `appId.operation` 工具。
- 项目没有默认值。需要操作某个项目时先用 `recut.project.list` 查找其 id，再用 `recut.project_context` 读取上下文，并把该 id 放进 `__recut.target.projectId`；无显式 target 的操作落到该 App 的全局状态。
