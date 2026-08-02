# src/

> L2 | 父级: /apps/depth-anything/ui/README.md

成员清单
main.tsx: 工作台编排层；先锁住未就绪环境，再管理模型下载、素材选择、推理、私有预览和用户确认保存。
recut-sdk.ts: Host MessageChannel 的 operation 与 Agent 通信边界。
types.ts: App operation 与素材库返回值的领域类型。
style.css: 紧凑的应用工作台视觉样式和响应式布局。

依赖关系

`main.tsx` 只通过 `recut-sdk.ts` 调用 App operation；`depth.generate` 返回私有 `previewURL`，`depth.save` 是唯一可以产生素材库 Asset 的 UI 动作。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
