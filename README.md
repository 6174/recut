<div align="center">

<img src="./assets/logo.jpg" alt="Recut logo" width="112" />

# Recut

<a href="https://github.com/6174/recut/stargazers"><img src="https://img.shields.io/github/stars/6174/recut?style=flat-square" alt="GitHub stars" /></a>
<a href="https://github.com/6174/recut/network/members"><img src="https://img.shields.io/github/forks/6174/recut?style=flat-square" alt="GitHub forks" /></a>
<a href="https://recut.video"><img src="https://img.shields.io/badge/Website-recut.video-2f9e63?style=flat-square" alt="Website" /></a>
<a href="https://app.recut.video"><img src="https://img.shields.io/badge/Workspace-open-2f9e63?style=flat-square" alt="Open workspace" /></a>

**本地优先、开源、可扩展的 AI 视频创作工作台**

在你的电脑上，Recut 与 **Claude Code、Open Code、Codex Cli** 协作，打造专属于你的创作平台；每一次迭代，都让它更适合你的创作。

[打开工作台](https://app.recut.video) · [浏览应用](#应用地图) · [开发 App](#为-recut-开发-app)

**中文** · [English](./README.en.md)

</div>

![Recut workspace](./assets/home2.jpg)

## Recut 是什么

Recut 是一个**本地优先、开源、可扩展的 AI 视频创作工作台**。它不是把所有能力塞进一个封闭软件，而是提供一条可以持续生长的创作底座：素材库、项目、时间线、媒体任务和 Agent 会话由平台管理，具体的创作能力由独立 App 组成。

你可以从一个选题、一个声音或一段素材开始；Agent 帮你整理、规划和推进工作流，Recut 把结果落到真实的项目、素材和时间线上。每个结果都可以继续编辑、替换和迭代，创作者始终决定什么进入最终作品。

## 为什么是 Recut

### Agent 是协作者，不是黑盒按钮

向 Claude Code、Open Code 或 Codex Cli 描述创作意图，Agent 可以帮你整理素材、规划镜头、生成字幕、搭建节奏或准备下一步任务。它的结果会回到可见的工作区，而不是停留在一段不可解释的聊天回复里。

Recut 的原则很简单：**让 Agent 推进工作，让人决定作品。** 你可以审阅、修改、撤销，或者沿着自己的判断继续迭代。

### 本地优先，控制权留在创作者一侧

项目、素材、组件和创作过程由你的设备或你控制的 service 管理。模型和生成服务可以按你的需要选择与替换，工作流不被某一家云端产品锁死；需要联网的模型由你明确接入，不把本地数据默认交给平台。

本地优先不是拒绝所有云端能力，而是让数据边界、模型选择和作品文件都回到你能理解、迁移和长期掌控的位置。

### App 让平台持续生长

Recut 只提供稳定的基础能力，社区通过独立 App 扩展创作场景。一个 App 可以拥有自己的 UI、数据、后台任务、Agent Skill 和操作契约，也可以通过公开 API 与其他 App 协作。

安装一个 App 就像增加一条新的创作工作流；写一个 App，就像为自己的团队造一台专属工具。平台负责边界与基础设施，创作者决定能力长成什么样。

### UI 与 Skill 同时存在

同一个能力既可以在界面里操作，也可以被 Agent 通过 Skill 和 MCP 调用。界面负责看见状态、比较结果和做确认；Agent 负责理解意图、组织步骤和执行重复工作。两者共享同一份项目与素材事实，不再是两个互相割裂的世界。

## 从想法到成片

1. **说清楚目标**：告诉 Agent 你想做什么，或直接在 App 中选择素材、模板与参数。
2. **形成工作方案**：Agent 整理素材、研究结构、规划镜头和节奏；昂贵或不可逆的步骤会停在确认点等待你的选择。
3. **落到真实工作区**：字幕、声音、画面、组件和代码进入项目、素材库或时间线，结果可见、可编辑、可继续制作。
4. **持续迭代并交付**：替换素材、调整节奏、修改文案、重新生成局部结果，最后由本机任务确定性导出成片。

## 应用地图

官方应用不是互相孤立的功能演示，而是围绕同一套素材、项目和 Agent 工作流组成的创作链路。

| App | 适合做什么 | 形态 | 仓库 |
| --- | --- | --- | --- |
| **视频剪辑** | 用 Agent 整理素材、规划镜头并操作可编辑时间线；组件、字幕、音频和导出都回到同一个项目。 | `project` | [视频剪辑 App 页面](https://recut.video/zh/apps/recut.editor/) |
| **AI 短片** | 从一个选题开始，梳理叙事结构与分镜，生成可审阅的解说文案和 B-roll，再在本地时间线继续制作。 | `project` | [recut-ai-short-film](https://github.com/6174/recut-ai-short-film) |
| **声音工坊** | 在本机把音视频转成带时间戳的字幕与文稿，用已授权声音角色完成旁白、补录和配音。 | `standalone` | [recut-audio-studio](https://github.com/6174/recut-audio-studio) |
| **封面生成** | 按发布渠道和画幅，从真实场景与参考封面出发生成候选图，并把确认后的封面沉淀为可复用 Asset。 | `standalone` | [recut-cover-studio](https://github.com/6174/recut-cover-studio) |
| **深度图** | 在本机将图片或视频转换为可预览的深度图，支持不同模型、伪彩与灰度输出，按需接回后续生成或合成。 | `standalone` | [recut-depth-anything-v2](https://github.com/6174/recut-depth-anything-v2) |
| **Remotion 视频** | 从 Brief、模板和组件开始，把选题、文案与素材编排成可实时预览、可确定性导出的程序化视频。 | `standalone` | [recut-remotion-studio](https://github.com/6174/recut-remotion-studio) |

更多应用正在创作中。官方总库只维护经审阅的入口、用途和支持状态，不复制或托管各 App 的源码。

### 工作区与应用预览

这些画面来自 Recut 的真实工作区：同一个 Agent 会话可以从 Studio 进入项目、素材库和不同 App，结果再回到可继续编辑的创作流程。

<table>
  <tr>
    <td width="50%"><img src="./assets/home.jpg" alt="Recut 视频剪辑时间线" /><br /><sub>视频剪辑：Agent 与素材库、预览和多轨时间线协作。</sub></td>
    <td width="50%"><img src="./assets/audio-studio.jpg" alt="Recut Audio Studio 声音工坊" /><br /><sub>声音工坊：转写、声音角色和配音在同一条声音工作流中完成。</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./assets/cover-maker.jpg" alt="Recut Cover Studio 封面生成" /><br /><sub>封面生成：按渠道尺寸组织参考图、参考封面和生成结果。</sub></td>
    <td width="50%"><img src="./assets/depth.jpg" alt="Recut Depth Map 深度图" /><br /><sub>深度图：本机生成可预览的图片或视频深度结果，确认后再保存。</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./assets/remotion.jpg" alt="Recut Remotion Video 程序化视频" /><br /><sub>Remotion 视频：从模板和 Brief 开始，把代码、素材与预览连接起来。</sub></td>
  </tr>
</table>

## 开始使用

### 安装 Recut

macOS、Linux、FreeBSD：

```sh
curl -fsSL https://recut.video/install.sh | sh
```

Windows PowerShell：

```powershell
irm https://recut.video/install.ps1 | iex
```

安装完成后打开 [工作台](https://app.recut.video)，在 **Apps** 中安装需要的应用。首次使用某些本地模型时，Recut 会在受管目录准备依赖和模型；任务状态、日志与取消入口都会保留在工作区内。

### 第一个创作任务

可以从最短路径开始：

1. 安装并打开 **视频剪辑** 或 **AI 短片**。
2. 导入一段视频、图片或音频，或者从一个选题开始。
3. 让 Agent 先整理方案，再在工作区中审阅结果。
4. 保留需要的部分，继续修改，最后导出成片。

不需要先学会复杂的剪辑软件，也不需要先写代码；代码和 Skill 是进阶入口，不是使用门槛。

## 为 Recut 开发 App

一个 App 是一个独立 Git 仓库中的创作工作流。它可以有自己的 UI、后台逻辑、SQLite 状态、Python 环境、Skill 和 Agent operation，但必须遵守平台的能力与数据边界。

最小结构：

```text
manifest.json  运行时身份、入口、权限、onboarding 与 operation 契约
AGENTS.md      面向 Agent 的领域规则与工作流边界
README.md      面向人的用途、安装、最短使用路径与开发方式
<entrypoint>   manifest 指向的 background 或 UI 入口
```

开发前先阅读 [App 契约](./docs/app-contract.md)，并参考现有 App 的实现。核心规则如下：

- 每个 App 独立发布，仓库根目录必须有 `manifest.json`，用户通过仓库 URL 安装。
- App 只读写自己的数据；跨 App 协作使用公开 API 和不可变 Artifact 引用。
- 媒体、任务、存储和 Agent 调用走 Recut capability，不绕过平台持久化与权限控制。
- 默认拒绝权限；每项权限都必须对应一条明确的用户价值。
- 每一步都说明输入、输出、确认点和昂贵操作的成本；未确认的创意不能直接当成成片。
- UI 控件必须有可见 label；业务文件维护 INPUT / OUTPUT / POS 契约，目录自身维护 README 地图。

新的应用或能力可以通过 [Issue](https://github.com/6174/recut/issues/new) 讨论，也欢迎提交 Pull Request。提交前请说明：它解决的创作问题、最短使用路径、所需权限、数据边界和本地运行前提。

## 当前状态

Recut 仍在快速迭代中，尚未达到稳定版本。平台契约、App operation 和 Agent 工作流可能继续演进；生产使用前请固定版本并保留项目备份。遇到问题请提交 Issue，并附上系统版本、Recut 版本、App 名称、任务日志和可复现步骤，不要上传真实素材或凭据。

这是一个开放的创作底座，不是一张封闭的功能清单。欢迎把你反复遇到的创作问题，变成一个可以被自己和社区长期使用的 App。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
