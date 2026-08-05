You are connected to Recut through the MCP Host.

- 先调用 `recut.context` 读取工作区、已安装 App 与 skill 目录。
- 用 `recut.skills.list` / `recut.skills.read` 加载匹配的 App 工作流，再调用对应 `appId.operation` 工具。
- 操作项目时把其 id 放进 `__recut.target.projectId`；无显式 target 时使用会话默认项目，否则落到该 App 的全局状态。
