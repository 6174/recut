# src/

> L2 | 父级: /apps/depth-anything/ui/README.md

成员清单
main.tsx: 工作台编排层；先锁住未就绪环境，再管理应用内模型选择组件、平台素材选择与所选素材预览、推理、私有预览、可点击的全量历史预览、实时计时/执行日志和用户确认保存；头部不放无独立设置页的重复检查按钮。
recut-sdk.ts: Host MessageChannel 的 operation、平台素材选择与 Agent 通信边界。
types.ts: App operation 与素材库返回值的领域类型。
style.css: 紧凑的应用工作台视觉样式、应用内选择组件、历史预览弹框、实时计时/执行日志底部标签和响应式布局。

依赖关系

`main.tsx` 只通过 `recut-sdk.ts` 调用 App operation 与宿主 `media.pick`；平台在父页面展示带缩略图的完成态全局素材库，App 只接收稳定 `assetId` 并在自身工作台预览所选图片或视频。模型选择使用 App 内部 listbox 组件，不调用原生下拉菜单；启动页不展示 Python、依赖、日志等内部实现，真实失败才把诊断交给右侧 Codex；状态优先刷新，历史读取失败不能阻塞进入模型选择；历史和本次预览共享同一完整输出集合，每张历史卡可打开图片或视频预览弹框；底部默认展示历史，准备环境、下载模型、生成深度图时自动切换到执行日志，并显示任务计时；`depth.generate` 返回可观察 Job，收到逐行 `shell.job.log` 时实时刷新日志，收到 `shell.job.completed` 后通过 `depth.complete` 取得私有 `previewURL`；`depth.save` 是唯一可以产生素材库 Asset 的 UI 动作。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
