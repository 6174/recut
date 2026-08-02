# ui/

> L2 | 父级: /apps/depth-anything/README.md

成员清单
package.json: React/Vite 独立构建配置与开发脚本。
vite.config.ts: 以相对资源地址构建，供 Recut App Host 托管。
index.html: React 挂载入口。
src/: 环境安装门、模型管理、素材输入、私有预览与用户确认入库界面；成员细节见 `src/README.md`。
dist/: `npm run build` 生成的运行时静态文件；manifest 指向该目录。

依赖关系

`main.tsx -> recut-sdk.ts -> Host MessageChannel -> background.js` 负责状态、安装、推理与保存；输入素材列表和上传仍通过 Recut 的素材库 HTTP API 获得，不访问本地文件系统。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
