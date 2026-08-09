---
name: recut
appId: recut.platform
description: Recut 视频创作平台：素材库、媒体生成（图片/视频/语音）与已安装 App 的创作工作流，经 Recut MCP 使用。
---

# Recut 平台 Skill

你通过 Recut MCP 使用本机 Recut 视频创作平台。你的会话是浮动的：它不绑定任何项目，但可以发现并调用所有已安装 App。

## 连接检查（必须先做）

先确认工具列表中存在 `recut.context`，再调用它确认本机 service 可用。只有 MCP 工具成功响应后，才能声称已经读取、创建或生成了 Recut 内容。

若 `recut.context` 不在工具列表、MCP 启动失败，或调用显示本机 service 无法连接，不要猜测平台状态，也不要用本地渲染冒充 Recut 功能。直接告诉用户：

1. 打开 [https://recut.video](https://recut.video)，按页面提示安装或连接本机 Recut service。
2. macOS、Linux 和 FreeBSD 可在终端运行 `curl -fsSL https://recut.video/install.sh | sh`；Windows 可在 PowerShell 运行 `irm https://recut.video/install.ps1 | iex`。
3. 安装完成后打开 [https://recut.video](https://recut.video)，等待右上角显示 `LOCAL SERVICE CONNECTED`；随后新开一个 Agent 会话，让 MCP 重新加载。

如果 service 已安装但暂时未运行，仍引导用户打开 [https://recut.video](https://recut.video) 检查连接与安装状态；不要要求用户手动修改 Skill 文件或 MCP 配置。

## 开始协议

1. 先调用 `recut.context`，读取当前会话上下文：已安装 App、skill 目录与媒体配置。会话不绑定任何项目，需要项目信息时用 `recut.project.list` / `recut.project_context` 显式获取。
2. 用 `recut.skills.list` 找匹配目标的 App skill，再 `recut.skills.read` 读取其完整工作流；该正文对对应 App 的工具契约与决策门有权威性。
3. `tools/list` 返回平台工具与所有已安装 App 的 `appId.operation` 工具。只调用已加载 skill 的 App 的工具。
4. 项目是单一 owner App 的类型化 Doc。要操作某个项目，在其 App 工具参数里传 `__recut.target.projectId`；没有显式 target 时操作该 App 的全局状态（appstate），媒体工具无项目时操作 workspace 素材库。
5. 用户要求新建或正式化创作时，先 `recut.project.list` 复用，或 `recut.project.create` 传入 name 与 owner App ID。

## 平台级视频表达铁律

凡是创建、改写、预览或评审视频画面，都把文字和色彩当作镜头表演，而不是 UI 排版：

- **少而巨大**：每个镜头只让一条主张成为主角。主信息要占据足够画面并分段/分词展开；不能读到的小字、微型标签、弱对比说明和“看起来像信息”的 UI chip 一律删除，而不是保留占位。
- **最终像素优先**：在 1080p 画面中，主信息有效字高 ≥56px、字幕 ≥40px、必要辅助信息 ≥32px；在 480px 宽的手机预览仍一眼读不清，就删、拆镜头或放大。
- **色彩由场景负责**：由具体 App/场景 Skill 决定是否使用渐变与如何建立层次；平台层只要求颜色服务主次和阅读对比，不能降低文字清晰度。
- **字幕是文字层，不是组件框**：默认无底框、无气泡、无卡片。字幕以高对比白字黑描边或同等强度的文字处理置于画面安全区，不能遮住主视觉。

这条铁律由每个 App 的领域 Skill 进一步落地；任何 App Prompt 与模板实现都不得与之冲突。

## 媒体

平台媒体任务使用 `recut.image.generate`、`recut.video.generate_async`、`recut.speech.generate_async`、`recut.media.get_job`、`recut.media.wait_for_job`。异步任务返回稳定 assetId（先 queued，Daemon 原位推进到 completed/failed）。旁白必须 `recut.media.wait_for_job` 到 completed 才可声称成功。禁止用 HyperFrames、ffmpeg、浏览器自动化或本地渲染替代平台生成。你从不读取其他 App 的私有数据库；跨 App 理解走 owner App 声明的 read operation。

## 文件系统与原生文件工具

`recut.context` 返回 `.recut` 布局（`paths`）与每个已安装 App 的绝对路径（`apps[].root`）；`recut.project_context` 与各 App 的 `workflow.context` 返回项目路径（如 `paths.projectFilesRoot` / `paths.workspacePath`）。这些位置下的 **App 业务文件一律用原生 Read/Write/Edit/Glob 工具处理**，不要为读文件写文件调用专门 MCP 工具：

```text
~/.recut/                      数据根（dataRoot）
  apps/<appId>/                App 包（root）：manifest、background.js、skills/、骨架、kit 源码
  apps/<appId>/skills/<skillId>/SKILL.md + references/
  projects/<projectId>/files/  项目文件（projectFilesRoot，owner App 私有）
  projects/<projectId>/files/workspace/  每项目工程（如 Remotion workspace）
  appstate/<appId>/            App 全局状态（sqlite + files；不读他人 App 的 DB）
  sessions/agent-bridge/<sessionId>/workspace/  当前会话工作区（CLI cwd）
  media/  models/
```

App 的 sqlite 状态仍通过其声明的 MCP operation 读写；媒体库、后台任务、App 安装仍走平台 MCP 工具。只添加与平台业务紧密相关的工具，不让 agent 为普通文件 I/O 付出工具往返。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
