# public/

> L2 | 父级: /web/README.md

成员清单
install.sh: 不依赖源码目录的 macOS 用户级 service 安装/升级器；从 release manifest 读取版本和 SHA-256，校验当前 CPU 包后注册 launchd。
releases/latest/: `make service-release` 生成的 Cloudflare 静态发布包及 `manifest.json`；后者给 daemon 校验版本、文件名与 SHA-256 后 self-update，不提交到 Git。

依赖边界

此目录只包含可公开下载的安装器和发布物。安装器不读取项目数据、不会向 Worker 上传用户内容；它只将 service 放到 `~/.recut/bin` 并保持既有 `~/.recut` 数据目录不变。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
