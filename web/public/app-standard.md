# Recut 应用标准

> 给 AI 的创建契约。请完整遵守；不确定时先提问，不要猜测或扩展平台边界。

## 目标目录

创建用户 App 时只写入：

```text
~/.recut/apps/<package-name>/
```

- `<package-name>` 使用 kebab-case，例如 `shot-planner`。
- 不修改 Recut 平台源码、其他 App、已有项目数据、service 配置或用户凭据。
- 一个 App 包只承载一个清晰的产品能力。避免在没有真实需求时新增抽象层或功能开关。

## 最小结构

项目型 App 必须至少拥有：

```text
<package-name>/
├── manifest.json       # 唯一运行时配置
├── background.js       # operation 的唯一业务实现
└── ui/
    └── index.html      # 项目工作台入口
```

如需更多 UI 文件，可放在 `ui/` 下。不要在 App 中读取或写入其他 App 的目录。

## manifest.json

所有字段都必须可验证、真实且简短：

```json
{
  "manifestVersion": 1,
  "id": "example.shot-planner",
  "name": "镜头计划",
  "author": "Your name",
  "description": "把创作意图整理为可执行的镜头计划。",
  "version": "0.1.0",
  "type": "project",
  "background": "background.js",
  "ui": { "projectView": "ui/index.html" },
  "permissions": ["sqlite", "artifacts.publish"],
  "operations": [
    {
      "name": "plan.create",
      "description": "根据创作目标创建镜头计划。",
      "surfaces": ["api", "mcp"],
      "inputSchema": { "type": "object", "required": ["topic"], "properties": { "topic": { "type": "string", "minLength": 1 } } }
    }
  ]
}
```

规则：

- `id` 全局唯一，推荐 `<author-or-domain>.<app-name>`。
- `type` 只能是 `project` 或 `standalone`。`project` 使用 `ui.projectView`；`standalone` 改用 `ui.standaloneView`。
- `background` 和 UI 入口是相对于 App 根目录的安全路径，不能以 `/` 开头或包含 `..`。
- `operations` 是 UI 与 Agent 共用的唯一公开契约：名称不重复，每个 operation 有非空描述、`inputSchema` 和一个或多个 `surfaces`（`api`、`mcp`）。
- 权限只声明实际需要的最小集合。不要因“可能会用”而申请权限。

## background.js

- 每个 manifest operation 只注册一次：`recut.operation.register("operation.name", handler)`。
- UI 使用 `api` surface；Agent 使用 `mcp` surface；两者都进入同一个 handler，不重复实现业务规则。
- App 的状态属于其隔离 SQLite、文件沙箱和 Artifact；跨 App 协作只使用公开 API 或不可变 Artifact 引用。
- 输入先校验，错误要指出具体原因；不要吞掉异常或假装成功。
- 不要在 App 中启动 server、直接访问宿主文件路径、读取平台凭据或调用未声明的外部能力。

## UI

- UI 只通过平台提供的 App API 调用 manifest 中声明的 `api` operation。
- 每个表单控件必须有可见标签；placeholder 只能表达示例。
- 先实现一个可完成真实任务的最小工作流，再考虑扩展。避免三层以上嵌套和为假想需求增加分支。

## 完成与验证

1. 检查 `manifest.json` 为有效 JSON，字段、类型、入口路径和 operation 契约完整。
2. 检查 `background.js` 中每个注册名称都在 manifest `operations` 中，反之亦然。
3. 检查 UI 入口文件存在，并能调用公开 API。
4. 重启 Recut service（Catalog 在启动时从 `~/.recut/apps` 加载 App）。
5. 打开 Apps，确认 App 显示；创建一个测试项目，验证 UI 和最小 operation。
6. 报告创建目录、App id、权限、operations、验证结果和未解决的问题。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
