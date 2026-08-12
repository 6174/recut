# scripts/

> L2 | 父级: /README.md

成员清单
install-service.sh: 将已构建的 Recut service 安装为当前用户的 launchd 或 systemd 常驻服务，保留数据在 `~/.recut`；未显式传入 `--address` 时 service 默认监听局域网的 `:17373`。
package-builtin-app.mjs: 读取 App `manifest.json` 的 `distribution.builtin.include` / `exclude` 发布规则，调用系统 tar 生成可嵌入 Go binary 的 App 归档；默认拒绝依赖目录、缓存与 macOS 元数据。

依赖边界

该目录处理操作系统服务注册和发布期打包；二进制构建与发布版本由根目录 Makefile 决定。内置 App 的内容真相位于 App 自己的 manifest，不由 Makefile 维护路径规则。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
