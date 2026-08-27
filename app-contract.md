# App 契约

> 状态：当前 runtime 约束的整理；新能力须在此标为提议，不能提前假定可用。

## 一个 App 是什么

App 是一个独立 Git 仓库根目录中的创作工作流。它拥有自己的界面、业务规则和项目内状态；Recut 提供受控 capability，而不是替它规定视频生产流程。

最小结构如下：

```text
manifest.json  运行时身份、入口、权限、onboarding 与 operation 契约
AGENTS.md      面向 Agent 的领域规则和工作流边界
README.md      面向人的用途、安装、最短使用路径与开发方式
<entrypoint>   manifest 指向的 background 或 UI 入口
```

`manifest.json` 是唯一运行时配置。它应声明稳定的 `id`、名称、版本、`type`、入口、最小权限，以及可选 onboarding 与 operations。`type: project` 绑定项目；`type: standalone` 绑定工作区。不要把运行时事实散落在 README、脚本或隐式约定中。

## 数据与权限边界

- App 数据属于 App；跨 App 协作只能使用公开 API 和不可变 Artifact 引用。
- 不能读取、修改或猜测其他 App 的数据库、文件目录、私有 Artifact 或用户会话。
- 媒体、存储、任务和 Agent 调用必须通过 Recut capability；不直接绕过平台持久化与权限控制。
- 默认拒绝权限。每一项权限都要能对应到 README 中的一条用户价值。
- 不把密钥、用户素材、数据库快照、依赖缓存或构建产物提交进仓库。

## 交互与可维护性

- App 的每一步都应说明输入、输出、确认点与昂贵媒体操作的成本；未确认的创意不能被当作成片提交。
- UI 控件必须有可见 label；placeholder 仅作示例，不能承担字段名称。
- Agent 指南要限制它何时读状态、何时生成媒体、何时做局部更新，避免用聊天记忆覆盖持久化的项目事实。
- App 目录自身应有 README 地图；业务文件应维护 INPUT / OUTPUT / POS 头部契约，并在职责变更时同步更新。

## 发布约束

当前安装器只识别根目录存在 `manifest.json` 的 Git App。每个 App 必须独立发布，用户以该仓库 URL 安装；官方总库只在 `apps.md` 维护经审阅的名录，不镜像 App 源码。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
