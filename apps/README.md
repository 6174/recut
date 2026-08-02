# apps/

> L2 | 父级: /README.md

成员清单
vox-broll/: `git@github.com:6174/recut-vox-broll.git` 的 Git submodule（跟踪 main）；B-roll 项目型 App 的源码与领域文档独立演进，主仓库只固定 commit。
cover-studio/: `https://github.com/6174/recut-cover-studio` 的独立 Git App 包；以渠道尺寸、提示词模板和素材库参考图生成封面，历史只保存 Asset 引用与生成元数据，不创建用户项目。
depth-anything/: `https://github.com/6174/recut-depth-anything-v2` 的独立本地深度图 App；以官方 Depth Anything V2 将素材库图片或视频转换成 App 私有 PNG/MP4 预览，只有用户确认后才导入素材库；manifest 声明的平台 venv 位于 `~/.recut/python/envs/`，模型位于 `~/.recut/models/depth-anything-v2/`。

此目录保存本地 App 包和固定的外部 App 源码。clone 主仓库后先执行 `git submodule update --init --recursive`；运行时仍只从 `~/.recut/apps` 发现 App。执行 `make app-link` 会按包创建链接，开发源码与运行中 App 因而是同一份文件；项目内 `.recut/app` 再链接到该包供 Agent 读取和迭代。

App 包不包含平台配置碎片。`manifest.json` 是唯一运行时配置，必须声明 `author` 和简短的 `description`；可选 `onboarding` 以显式 `id`、`title`、`description` 和 `prompt` 定义新对话引导，平台不会从展示文字推导 prompt；Git App 可声明规范 HTTPS `repository`。`background.js` 与 `ui/` 是 App 自己的实现。素材库是 web 内置 React 能力，不属于此目录。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
