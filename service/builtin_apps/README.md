# builtin_apps/

> L2 | 父级: /service/README.md

apps.json: 内置 App 的**单一真相**——列出每个随二进制分发的 App（`package`、`source`、`appId`、`include`、`exclude`、可选 `prep`）。新增/调整内置 App 只改这一个文件；`scripts/package-builtin-app.mjs` 与 `service/builtin_apps.go` 都从它读取，不再各自硬编码。
`<package>.tar.gz`: 发布构建（`make builtin-apps`）按 apps.json 规则为每个内置 App 生成的归档，由 `service/builtin_apps.go` 经 `//go:embed builtin_apps` 编进二进制；`.gitignore` 忽略，不提交。
README.md: 本说明。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
