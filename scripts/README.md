# scripts/

> L2 | 父级: /README.md

成员清单
install-service.sh: 将已构建的 Recut service 安装为当前用户的 launchd 或 systemd 常驻服务，保留数据在 `~/.recut`；未显式传入 `--address` 时 service 默认监听局域网的 `:17373`。

依赖边界

该目录只处理操作系统服务注册；二进制构建与发布版本由根目录 Makefile 决定，脚本不访问项目数据也不管理 App 包。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
