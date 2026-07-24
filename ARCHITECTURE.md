# Recut Extension Architecture

> L1 | 父级: /README.md

```text
App package (GitHub release / local directory)
├── manifest.json       唯一运行时配置
├── background.js       App 业务、API 与 MCP handler
└── ui/                 App 自己定义的界面
        │
        ▼
Recut Daemon / Capability Host
├── SQLite namespace    ctx.sqlite
├── file sandbox        ctx.files
├── Artifact registry   ctx.artifacts.publish
├── App API broker      recut.apps（下一步）
└── MCP Host            manifest.mcp → background.js
        │
        ▼
Agent Session Host
├── workspace.sqlite    本机用户的会话、消息、事件与 native session 指针
├── Codex JSONL adapter  将 runtime 事件归一为 Chat UI 协议
└── TerminalManager     PTY 兼容与诊断，不作为对话状态真相
```

`manifest.json` 只声明身份、`type`、`background`、UI 入口、权限、`apis` 和 `mcp.tools`。它不声明数据表、项目文件、迁移或业务 workflow；这些都是 App JavaScript 的内部实现。

项目型 App 获得自己的 `storage.sqlite`；平台项目另有 `project.sqlite` 管理 Artifact、事件和跨 App 引用。大媒体写入 content-addressed `files/`，SQLite 永远先保存资源记录、哈希和 `fileId`，而不是让业务状态散落成 JSON 文件。路径只是平台实现细节，JS 不获得裸路径或 SQLite 连接串。

MCP 由平台而非 App 监听。Agent session 只看到当前 App manifest 声明的 `app-id.tool`；调用经 Host 权限校验后进入 `background.js` 注册的 `recut.mcp.register(tool, handler)`。同一业务函数可由 `recut.api.register(name, handler)` 供其他 App 调用，避免两套逻辑。

## Agent App Assets

App 还可以拥有三类 Agent 资产，但平台不把它们混为自由文件系统权限：

```text
App package
├── AGENTS.md       App 的领域工作流、审批门与 MCP 使用规则；每个 turn 注入 Codex guide
├── references/     可版本化的参考资料；未来以声明式索引、只读引用按需提供给 Agent
└── scripts/        可复现的转换/生成脚本；未来必须由 manifest 声明显式输入输出，并暴露为受控 MCP tool
```

`AGENTS.md` 是当前已实现的自动注入层。`references/` 与 `scripts/` 的目标是支持类似 vox-director 的复杂制作 App：参考材料有可追溯 ID，脚本有参数 schema、产物和执行记录；Agent 不获得“随便运行包内脚本”的模糊权限。

## B-roll 案例

`apps/vox-broll/manifest.json` 申请 `sqlite`、`files`、`artifacts.publish`，声明 `brief.create` API 和 `generate_brief` MCP 工具。`background.js` 自行创建 `briefs` 表、保存 brief 文件并发布 `recut.vox.brief@1` Artifact；平台没有任何 B-roll 专用数据结构或 workflow 代码。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
