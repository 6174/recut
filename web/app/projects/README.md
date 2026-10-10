# projects/

> L2 | 父级: /web/app/README.md

成员清单
[page.tsx]: `/projects` 独立项目入口；复用主工作台并激活 Projects，项目创建和完整项目列表不再塞入 Studio。项目列表顶部是面向用户需求层的创作场景卡片区（`components/scenario-gallery.tsx` + `lib/scenarios`），对齐 video GTM 的几个需求场景平铺为卡片，点选后经 `components/scenario-dialog.tsx` 填写结构化表单并把草稿回填全局 AI 输入框，绝不自动发送。
[id]/: 单个项目的静态路由壳与客户端工作台；Header 经统一 `WorkspaceHeader`（单一返回入口 + 单行标题，不显示品牌 mark/图标）复用全局 service 状态和设置操作，iframe App 的 `media.pick` 由支持上传、详情、单选/多选的全局素材选择器处理。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
