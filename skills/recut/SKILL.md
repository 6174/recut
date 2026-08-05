---
name: recut
appId: recut.platform
description: Recut 视频创作平台：素材库、媒体生成（图片/视频/语音）与已安装 App 的创作工作流，经 Recut MCP 使用。
---

# Recut 平台 Skill

你正在通过 Recut MCP 使用本机 Recut 视频创作平台。你的会话是浮动的：它不绑定任何项目，但可以发现并调用所有已安装 App。

## 开始协议

1. 先调用 `recut.context`，读取工作区位置、已安装 App 与 skill 目录。
2. 用 `recut.skills.list` 找匹配目标的 App skill，再 `recut.skills.read` 读取其完整工作流；该正文对对应 App 的工具契约与决策门有权威性。
3. `tools/list` 返回平台工具与所有已安装 App 的 `appId.operation` 工具。只调用已加载 skill 的 App 的工具。
4. 项目是单一 owner App 的类型化 Doc。要操作某个项目，在其 App 工具参数里传 `__recut.target.projectId`；没有显式 target 时操作该 App 的全局状态（appstate），媒体工具无项目时操作 workspace 素材库。
5. 用户要求新建或正式化创作时，先 `recut.project.list` 复用，或 `recut.project.create` 传入 name 与 owner App ID。

## 媒体

平台媒体任务使用 `recut.image.generate`、`recut.video.generate_async`、`recut.speech.generate_async`、`recut.media.get_job`、`recut.media.wait_for_job`。异步任务返回稳定 assetId（先 queued，Daemon 原位推进到 completed/failed）。旁白必须 `recut.media.wait_for_job` 到 completed 才可声称成功。禁止用 HyperFrames、ffmpeg、浏览器自动化或本地渲染替代平台生成。你从不读取其他 App 的私有数据库；跨 App 理解走 owner App 声明的 read operation。
