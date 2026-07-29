# apps/

> L2 | 父级: /README.md

成员清单
vox-broll/: `git@github.com:6174/recut-vox-broll.git` 的 Git submodule（跟踪 main）；B-roll 项目型 App 的源码与领域文档独立演进，主仓库只固定 commit。
media-library/: 内部系统 App；为工作区素材库复用标准 Agent/MCP 会话，不能被用户作为项目创建。

此目录保存本地 App 包和固定的外部 App 源码。clone 主仓库后先执行 `git submodule update --init --recursive`；运行时仍只从 `~/.recut/apps` 发现 App。执行 `make app-link` 会按包创建链接，开发源码与运行中 App 因而是同一份文件；项目内 `.recut/app` 再链接到该包供 Agent 读取和迭代。

App 包不包含平台配置碎片。`manifest.json` 是唯一运行时配置，必须声明 `author` 和简短的 `description`；可选 `onboarding` 以显式 `id`、`title`、`description` 和 `prompt` 定义新对话引导，平台不会从展示文字推导 prompt；Git App 可声明规范 HTTPS `repository`。`background.js` 与 `ui/` 是 App 自己的实现。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
