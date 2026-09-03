<div align="center">

<img src="./assets/logo.jpg" alt="Recut logo" width="112" />

# 剪辑器 · Editor

**CapCut 风格时间线，把素材、文字、效果与声音编排成最终成片**

Recut 的核心剪辑工作台 — 也是 AI 短片、程序化视频与素材库汇聚的地方

[中文](./README.md) · [English](./README.en.md)

</div>

![Recut 视频剪辑时间线](./assets/home.jpg)

## 这是什么

剪辑器是 Recut 的**时间线剪辑 App**（`project` 类型）。它不做封闭的一键成片，而是给你一条可编辑、可撤销、可持续迭代的时间线：素材、文字、组件、字幕、音频和导出都回到同一个项目里。

- **从素材开始，也从想法开始**：拖入已有的视频/图片/音频，或让 Agent 先把选题整理成分镜和草稿，再落到时间线上继续细调。
- **人和 Agent 共用同一份事实**：界面负责看见状态、比较结果和做确认；Agent 通过 Skill 在同一条时间线上整理、规划和执行重复工作。
- **结果始终可编辑**：每个片段、每条轨道、每个参数都能继续改；导出只是当前版本的确定性落盘。

> 随 Recut 一起内置安装，无需额外下载。也是 `make dev` / `make service-build` 默认打包的内置 App 之一。

## 为什么用它

### 时间线是成片的唯一真相

轨道、片段、关键帧、转场与混音都在时间线里可见。Agent 的修改同样以 `timeline.command` 落入统一操作日志，支持撤销/重做，不会出现“聊完就丢”的黑盒结果。

### 组件与真实媒体共处

文字、图形组件（verified 组件素材）和真实媒体同为时间线的一等公民。组件可复用、可带参、可做动效；媒体素材来自全局素材库。两者在同一条渲染管线里合成预览与导出。

### 字幕是一条工作流，不是贴纸

从转写到字幕轨到可编辑文稿同源：本机 ASR 转写 → 字幕轨（共享样式 `captionStyle`）→ 绑定到说话元素的文稿。改字幕即改时间线，改文稿即改音频结构。

### 预览即导出

预览画布与导出走同一套渲染与混音逻辑（含 auto-duck 混音）。你在画布上看到的，就是导出的结果。

## 从想法到成片

1. **放上素材**：从素材库拖入视频/图片/音频，或导入 AI 短片交接包（`film.package.import`）。
2. **搭出结构**：用轨道组织画面与声音；需要时让 Agent 按文稿或分镜批量铺片段。
3. **做细效果**：调参数、打关键帧、加效果/转场；从内置目录（`library.browse`）先找现成效果与音乐。
4. **处理声音与字幕**：一键转写生成字幕轨，绑定文稿后做口癖清理与停顿压缩，设主/辅音频轨自动闪避。
5. **预览与交付**：在画布上逐帧预览（`preview.frame` / `preview.contact-sheet`），校验通过后 `export.start` 确定性导出。

## 核心能力

| 能力 | 你能做什么 | 关键操作 |
| --- | --- | --- |
| **多轨时间线** | 插入/删除/裁剪/分割/变速/调参/关键帧；场景与书签管理 | `timeline.command` · `timeline.read` · `timeline.validate` |
| **组件素材** | 用自然语言描述创建可复用组件，验证后上架素材库，再按需摆到时间线 | `component.create` → `timeline.placeComponents` · `component.revise` |
| **字幕与文稿** | 本机转写生成字幕、导入 SRT/ASS、统一字幕样式、文稿驱动剪辑 | `subtitle.generate` / `subtitle.import` · `script.read` / `script.apply` / `script.clean` |
| **音频混音** | 设主/辅轨角色自动闪避、边界柔化 | `track.role` · `audio.smooth` |
| **预览与导出** | 真实渲染帧预览、批量帧与拼图预览、确定性 MP4 导出与封面 | `preview.frame` · `export.start` · `cover.set-frame` / `cover.set-asset` |
| **项目协作** | 锁定编辑、增量同步、操作日志与撤销、素材引用登记 | `project.lock` · `timeline.delta` · `history.undo/redo` |

> 完整操作契约见 `manifest.json` 的 `operations` 列表；Agent 侧约束见 `skills/recut-editor/SKILL.md`。

## 快速开始

### 在 Recut 中打开

1. 安装并启动 Recut（见主仓库 [README](../../README.md#安装-recut)）。
2. 在工作台打开一个项目，进入 **剪辑器**。
3. 从右侧素材库拖入素材到时间线，或让 Agent 执行：`先读取 workflow.context 和 timeline.read，再按需求铺时间线`。

### 让 Agent 帮你剪

在 Claude Code / OpenCode / Codex Cli 中对项目说：

> “用剪辑器处理这个请求【把这段口播的废话和长停顿去掉，保留关键信息，加上双语字幕，最后导出 1080p】。先读 workflow.context 和 timeline.read，判断是新创作还是在现有时间线上改动，只改必要的部分，预览受影响的 settled 帧，通过校验后再导出。”

Agent 会自动选择文稿清理、字幕生成或时间线编辑路径，结果落回你眼前的时间线。

## 界面导览

- **预览画布**：所见即所得，支持逐帧定位与封面选帧。
- **时间线**：CapCut 风格多轨，支持场景折叠、轨道角色与关键帧编辑。
- **素材面板**：全局素材库与组件库，支持搜索与一键上轨。
- **检查器**：选中片段后调参、打关键帧、挂效果与遮罩。
- **导出面板**：选分辨率与帧率，一键导出；支持手动选帧或选素材作封面。

![剪辑器界面](./assets/home.jpg)
<sub>Agent 与素材库、预览和多轨时间线在同一工作区协作。</sub>

## 常见问题

**预览或导出黑屏？** 剪辑器依赖 Chromium 的 `CanvasDrawElement`（Chrome 149+）。在 `chrome://flags/#canvas-draw-element` 设为 Enabled，或用启动参数 `--enable-features=CanvasDrawElement`。Playwright 调试请复用 `ui/tests/e2e/helpers.ts` 的 `launchEditorBrowser()`。

**字幕生成按钮不可用？** 需先安装声音工坊（audio-studio）并准备 ASR 模型。剪辑器会通过 `subtitle.capabilities` 检查环境并引导安装。

**怎么替换素材但保留节奏？** 选中片段在检查器中替换 `assetId`，或让 Agent 执行素材替换路径；时间线结构与关键帧保持不变。

## 面向开发者

剪辑器同时是可扩展的 Recut App。UI 源码在 `ui/`（React + TypeScript + Vite），后台按 `manifest.json` 的 `backgroundModules` 顺序加载到同一 Goja 沙箱。

```sh
# 仅构建编辑器前端（内置打包前必做）
make editor-ui-build

# 本地联调（会同时构建内置 App 归档）
make dev

# 模型与渲染自检
make editor-model-test
make editor-frame-render-test
make editor-authoring-quality-test
```

- 运行时消费 `ui/dist/index.html`，`ui/dist/` 与 `node_modules/` 不入库。
- 架构与契约：`manifest.json` · `background/` · `skills/recut-editor/SKILL.md` · `skills/recut-editor/references/`。
- 平台通讯与操作边界以主仓库 `docs/app-contract.md` 为准。

[返回主 README](../../README.md) · [应用地图](../../README.md#应用地图)
