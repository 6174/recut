# apps/

> L2 | 父级: /README.md

成员清单
vox-broll/: `git@github.com:6174/recut-vox-broll.git` 的 Git submodule（跟踪 main）；AI 短片项目型应用，冻结导演风格模板后依次完成全局资料研究、用户确认、创作方案选定、剧本与场景方案、媒体生成与可供 Remotion 消费的短片交接包，主仓库只固定 commit。
cover-studio/: `git@github.com:6174/recut-cover-studio.git` 的 Git submodule（跟踪 main）；以渠道尺寸、提示词模板和素材库参考图生成封面，历史只保存 Asset 引用与生成元数据，不创建用户项目。
depth-anything/: `git@github.com:6174/recut-depth-anything-v2.git` 的 Git submodule（跟踪 main）；本地深度图 App 以官方 Depth Anything V2 将素材库图片或视频转换成私有 PNG/MP4 预览，只有用户确认后才导入素材库；manifest 声明的平台 venv 位于 `~/.recut/python/envs/`，模型位于 `~/.recut/models/depth-anything-v2/`。
audio-studio/: `git@github.com:6174/recut-audio-studio.git` 的 Git submodule（跟踪 main）；非项目型声音智能层 App，用 faster-whisper 把素材库音视频转成可编辑文稿与 SRT，用参考人声创建可复用声音角色（参考音 + 自动生成的提示词），再用 CosyVoice2 零样本/情绪指令合成角色配音；模型位于 `~/.recut/models/audio-studio/`，CosyVoice 官方代码与 Matcha-TTS 子模块由 bootstrap 浅克隆到同一模型根。
editor/: `git@github.com:6174/recut-editor.git` 的 Git submodule（跟踪 main）；项目型时间线剪辑 App，负责将素材库、AI 短片和程序化视频编排为最终成片，并以 GPU 合成、3D 特效和画布文字提供编辑与导出能力。
recut-remotion-studio/: `git@github.com:6174/recut-remotion-studio.git` 的 Git submodule（跟踪 main）；Remotion 程序化视频 App，每个项目有独立 Remotion 工程（`remotion-skeleton` 骨架副本），AI 直接改写 composition 代码，Vite dev server 热更新预览，本地渲染导出；复用 remotion-templates、remotion-captions-themes 与 video-shotcraft。

此目录保存本地 App 包和固定的外部 App submodule。clone 主仓库后先执行 `git submodule update --init --recursive`；运行时仍只从 `~/.recut/apps` 发现 App。执行 `make app-link` 会按包创建链接，开发源码与运行中 App 因而是同一份文件；项目内 `.recut/app` 再链接到该包供 Agent 读取和迭代。

App 包不包含平台配置碎片。`manifest.json` 是唯一运行时配置，必须声明 `author` 和简短的 `description`；可选 `onboarding` 以显式 `id`、`title`、`description` 和 `prompt` 定义新对话引导，平台不会从展示文字推导 prompt；Git App 可声明规范 HTTPS `repository`。`background.js` 与 `ui/` 是 App 自己的实现。素材库是 web 内置 React 能力，不属于此目录。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
