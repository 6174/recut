# public/

> L2 | 父级: /web/README.md

成员清单
install.sh: 不依赖源码目录的 Unix 安装/升级器；以实时阶段日志下载并校验当前 CPU 的 service 包，预置受管 Python 3.11、默认 venv 与 FFmpeg，再在 macOS 注册 launchd、在 Linux 注册 systemd user service，等待 `/health` 后报告成功，失败时输出启动日志，FreeBSD 保留进程管理器启动命令。
install.ps1: 不依赖源码目录的 Windows 安装/升级器；以实时阶段日志校验 ZIP 包，预置受管 Python 3.11、默认 venv 与 FFmpeg 后注册并启动当前用户的登录任务。
app-standard.md: 公开的 Recut App 创建契约；供新建应用 Prompt 中的 AI 读取，说明产品架构、App 边界、核心 Recut API（含 App 自主设置项目 image/video `cover`）、包结构、manifest、operation、UI 和验证步骤。
releases/latest/: 该目录已不再生成于 `web/public`。`make service-release` 现在把 macOS、Linux、FreeBSD 和 Windows 静态发布包及 `manifest.json` 暂存到 `cdn/buckets/releases/latest`，经 `make cd-upload` 上传 Cloudflare R2，从 `https://cdn.recut.video/releases/latest/` 分发（发布包约 38 MiB，超过 Workers Assets 单文件 25 MiB 上限，不能随 Worker Assets 发布）；`manifest.json` 给安装器与 macOS daemon 校验版本、文件名与 SHA-256 后 self-update。
icon.png / apple-touch-icon.png / favicon.ico: 从 `logo.jpg` 生成的品牌图标产物（512×512、180×180 与 32×32 ICO），供根布局 `icons` 元数据、PWA manifest 与浏览器/移动端书签使用，同时作为首期 `og:image` 分享图的占位来源。

依赖边界

此目录只包含可公开下载的安装器和发布物。安装器不读取项目数据、不会向 Worker 上传用户内容；Unix 将 service 放到 `~/.recut/bin`，并把平台工具链放到 `~/.recut/tools` 与 `~/.recut/python/platform`；Windows 将 service 放到 `%USERPROFILE%\\.recut\\bin`，两者都保持既有数据目录不变。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
