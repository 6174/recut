# ui/

> L2 | 父级: /service/README.md

成员清单
assets/: `make web-build-embedded` 生成的本地工作台静态导出；仅随 Go binary 嵌入 UI，不复制 Cloudflare 的 `releases/` service 安装包。

依赖边界

`web/out/ -> ui/assets/ -> go:embed -> recut-service`。这是单向发布路径：Cloudflare 仍从 `web/out/` 发布工作台和 service 安装包；嵌入同步直接排除 `releases/`，因此不会把 binary 再嵌入自身。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
