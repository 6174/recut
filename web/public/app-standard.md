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

## 产品架构：你的 App 在哪里

```text
用户
  │
  ▼
Recut Workspace（Project / Apps / 素材库 / Agent）
  │ 创建项目、承载 App iframe、转发 UI 请求与项目事件
  ▼
Recut service / Capability Host
  ├── Catalog：从 ~/.recut/apps 读取 manifest 并加载 App 包
  ├── AppHost：执行 background.js 的 operation
  ├── 项目隔离：每个项目、每个 App 各自的 SQLite 与文件沙箱
  ├── Artifact / Media Platform：跨能力的稳定引用与异步媒体任务
  └── MCP Host：把当前 App 的 mcp operation 与 recut.* 平台工具提供给 Agent
  │
  ▼
App package（你创建的目录）
  ├── manifest.json：声明身份、入口、权限和唯一的公开契约
  ├── background.js：业务逻辑与状态变更的唯一位置
  └── ui/：运行在项目 iframe 内的用户界面
```

关键边界：

- **UI 不直接访问 service HTTP、SQLite、文件系统、凭据或其他 App。** 它只用下方的 iframe SDK 向宿主请求已声明的 operation。
- **background.js 不启动 server，也不持有裸系统权限。** 它只通过 manifest 明示权限获得 `ctx` 中的能力。
- **Agent 不直接执行 App 的私有函数。** Agent 只能调用 manifest 中声明 `mcp` surface 的 operation，以及 Recut 提供的 `recut.*` 平台 MCP 工具。
- **数据和业务属于 App；平台提供通用能力。** App 自己决定表、工作流和页面；平台不理解你的业务模型。

## 核心 Recut 接口

### 1. background.js：注册 operation

`background.js` 在每次 operation 调用时由受限 JavaScript runtime 执行。它必须注册 manifest 声明的 operation：

```js
recut.operation.register("plan.create", (input, ctx) => {
  ctx.sqlite.execute(
    "create table if not exists plans (topic text not null)",
  );
  ctx.sqlite.execute(
    "insert into plans (topic) values (?)",
    [input.topic],
  );
  return { topic: input.topic };
});
```

`input` 是 UI 或 Agent 按 `inputSchema` 提供的 JSON 对象；返回值必须是可序列化 JSON。operation 名称、输入 schema 与可用 surface 只在 `manifest.json` 定义一次。

### 2. ctx：按权限注入的 App 能力

只有 manifest 声明权限后，`ctx` 才包含对应对象：

| 权限 | 接口 | 用途 |
| --- | --- | --- |
| `sqlite` | `ctx.sqlite.execute(sql, params?)`、`ctx.sqlite.query(sql, params?)` | App 在**当前项目**的隔离 SQLite 中读写。`query` 返回对象数组，`execute` 返回 `{ rowsAffected }`。 |
| `files` | `ctx.files.readText(path)`、`writeText(path, text)`、`list(path?)`、`url(path)` | App 在**当前项目/当前 App**的文件沙箱中操作文本文件；`url` 只为已存在的私有预览文件生成当前 App scope URL。路径不能越界。 |
| `artifacts.publish` | `ctx.artifacts.publish({ type, value })` | 发布不可变 Artifact，供项目事件与受控跨能力引用使用。 |
| `media.compose` | `ctx.media.compose(input)` | 确定性组合已存在的媒体 Asset；不能拿它替代 AI 生成。 |
| `media.read` | `ctx.media.materialize(assetId)` | 将已完成素材复制进当前 App 的私有 `inputs/` 并返回相对路径；不创建新 Asset。 |
| `media.write` | `ctx.media.importFile({ path, name, mimeType })` | 仅在用户明确选择后，将 App 私有文件导入素材库并返回 Asset。 |
| `shell` | `ctx.shell.run({ command, args, timeoutSeconds })` | 在 App 包根执行受限 Python；没有 shell 字符串与裸路径，环境变量提供 App 私有文件与 `~/.recut/models` 根。 |

没有对应权限时不得访问该对象。不要申请或伪造未列出的 `ctx` 能力。

### 3. UI：宿主注入的 recut SDK

项目 UI 在 iframe 中运行。实现一个与下列形状等价的轻量 SDK，等待宿主发送 `recut.ui.connect` 的 `MessagePort` 后再调用：

```ts
recut.state.query(operationName)
recut.background.call(operationName, input)
recut.agent.send({ prompt })
recut.events.subscribe((event) => unsubscribe)
```

- `state.query(name)` 与 `background.call(name, input)` 都只会调用当前 App 的、带 `api` surface 的 operation；前者传空对象，后者传 input。
- `agent.send({ prompt })` 把任务交给当前项目的 Agent Session；它不直接返回 Agent 最终回答。
- `events.subscribe` 接收宿主转发的项目事件。operation 成功后会有 `app.capability.completed`，其中包含 `appId`、`kind: "operation"` 与 `name`；UI 可据此刷新自身状态。
- UI 收到失败时必须向用户展示错误；不要绕过 SDK 直接调用 `/v1/*` HTTP 路由，因为那会跳过项目与 App scope。

### 4. Agent 与 MCP

manifest operation 的 `surfaces` 决定谁可调用它：

| surface | 调用方 | 行为 |
| --- | --- | --- |
| `api` | App UI 经 iframe SDK | `recut.background.call(name, input)` 进入同一个 background handler。 |
| `mcp` | 当前项目的 Agent | 暴露为 `app-id.operation-name`，同样进入同一个 background handler。 |

Agent 还可使用平台 MCP：`recut.project_context`、`recut.image.generate`、`recut.video.generate_async`、`recut.speech.generate_async`、`recut.media.list_voices`、`recut.media.get_job`、`recut.media.list_assets`、`recut.media.import_image` 与 `recut.media.attach`。平台生成直接返回稳定 `assetId`；若当前图片 route 是 Codex 原生生成，Agent 必须先将最终图片写入当前 Recut 项目目录，再用 `recut.media.import_image` 归档并取得真实 `assetId`，不能只交付对话预览。视频和语音是异步任务，应保存该 id 并等待同一 Asset 被 service 原位更新，而不是重复提交。

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

- 每个 manifest operation 只注册一次：`recut.operation.register("operation.name", handler)`；名称必须与 manifest 完全一致。
- UI 使用 `api` surface；Agent 使用 `mcp` surface；两者都进入同一个 handler，不重复实现业务规则。
- App 的状态属于其隔离 SQLite、文件沙箱和 Artifact；跨 App 协作只使用公开 API 或不可变 Artifact 引用。
- 输入先校验，错误要指出具体原因；不要吞掉异常或假装成功。
- 不要在 App 中启动 server、直接访问宿主文件路径、读取平台凭据或调用未声明的外部能力。

## UI

- UI 只通过宿主注入的 `recut.state/background/agent/events` SDK 调用 manifest 中声明的 `api` operation。
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
