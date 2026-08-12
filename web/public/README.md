# public/

> L2 | 父级: /web/README.md

成员清单
install.sh: 不依赖源码目录的 Unix 安装/升级器；以实时阶段日志下载并校验当前 CPU 的 service 包，预置受管 Python 3.11、默认 venv 与 FFmpeg，再在 macOS 注册 launchd、在 Linux 注册 systemd user service，等待 `/health` 后报告成功，失败时输出启动日志，FreeBSD 保留进程管理器启动命令。
install.ps1: 不依赖源码目录的 Windows 安装/升级器；以实时阶段日志校验 ZIP 包，预置受管 Python 3.11、默认 venv 与 FFmpeg 后注册并启动当前用户的登录任务。
app-standard.md: 公开的 Recut App 创建契约；供新建应用 Prompt 中的 AI 读取，说明产品架构、App 边界、核心 Recut API（含 App 自主设置项目 image/video `cover`）、包结构、manifest、operation、UI 和验证步骤。
releases/latest/: `make service-release` 生成的 macOS、Linux、FreeBSD 和 Windows 静态发布包及 `manifest.json`；后者给 macOS daemon 校验版本、文件名与 SHA-256 后 self-update，不提交到 Git。

依赖边界

此目录只包含可公开下载的安装器和发布物。安装器不读取项目数据、不会向 Worker 上传用户内容；Unix 将 service 放到 `~/.recut/bin`，并把平台工具链放到 `~/.recut/tools` 与 `~/.recut/python/platform`；Windows 将 service 放到 `%USERPROFILE%\\.recut\\bin`，两者都保持既有数据目录不变。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
