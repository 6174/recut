# Recut Remotion Studio

> `type: project` App —— 把选题、文案、风格模板和素材编排成 Remotion 程序化合成视频。

## 能力

- **Brief 表单**：新建项目时选择风格模板、选题、细节、时长与素材，一键交给 AI 设计。
- **实时预览**：项目页内嵌 `@remotion/player`，任何设计保存后立即获得可逐帧拖动的实时预览；脚本、样式、字幕主题、背景特效、素材与音乐都可现场调整。
- **本地导出**：`render/` 是 Node 渲染工作区，使用 `@remotion/bundler` + `@remotion/renderer` 在本地 headless Chrome 中把 composition 渲染为 MP4，并归档为 Recut 媒体素材。

## 结构

```text
manifest.json   唯一运行时配置（operations、permissions、onboarding）
background.js   Goja 沙箱业务后端：Brief/design 保存与校验、目录、渲染任务编排
AGENTS.md       注入 Agent 的设计工作流与 composition 契约
render/         服务端渲染工作区
  src/          共享 Remotion composition（浏览器预览与渲染同一份代码）
    compositions/StoryVideo.tsx   核心合成：场景 + 图片 + 文字 + 全局字幕
    compositions/CaptionLayer.tsx 场景时间轴与逐词字幕生成
    effects/registry.tsx          背景特效（复用于 remotion-templates 组件）
    effects/text.tsx              文字特效（参数化自 remotion-templates）
    captions/vendor/              remotion-captions-themes 源码（MIT）
    templates-vendor/             reactvideoeditor.com 的 remotion-templates 组件
  render.js      程序化 bundle + renderMedia
  node-check.js  依赖自检（供 render.setup 判断是否需 npm install）
ui/             Vite React 项目页（@remotion/player 实时预览 + 创作台）
```

## 设计决策

- **预览不用 iframe 跑独立 Remotion Studio 服务**，而是把 composition 直接打进 App 自带的 Vite UI，用 `@remotion/player` 在项目页内渲染。这样无需为每个项目维护一个 Next.js/Remotion dev server，预览、编辑与导出共享同一份 `render/src` composition 代码。
- **导出由后台 shell 任务执行**：`render.export` 物化素材、写 props、`ctx.shell.start(node render/render.js …)`；进度写入 `exports/{renderId}/progress.json`，UI 轮询 `render.status`，完成后 `ctx.media.importFile` 归档为新 video Asset。
- **确定性渲染**：composition 与字幕时间轴全部由 frame 派生，无 `Math.random`/`Date.now`，预览与成片逐帧一致。

## 本地开发

```bash
cd render && npm install   # 首次；生产上由 render.setup 自动执行 npm ci
cd ui && npm install && npm run build   # 产出 ui/dist（提交到仓库，作为 projectView）
make app-link APP=apps/recut-remotion-studio   # 链接到 ~/.recut/apps
```

导出需要本机 `node`（18+）；首次导出会自动 `npm ci` 安装 Remotion 渲染依赖，并下载 headless Chrome（约 90MB），耗时取决于网络。

## 复用来源与授权

- **remotion-templates**（reactvideoeditor.com）：免费模板组件，背景特效直接复用，文字特效参数化改写；保留原作者头注释。
- **remotion-captions-themes**（vshukla7，MIT）：字幕主题源码整体 vendored 到 `render/src/captions/vendor/`，保持原结构。
- **video-shotcraft**（Vincentwei1021）：动效取舍、5 秒节拍、落定呼吸等导演语言写入 `AGENTS.md`，作为设计阶段的提示词模板参考。
