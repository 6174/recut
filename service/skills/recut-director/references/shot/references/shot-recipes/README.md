> 来源: recut/apps/remotion-studio/skills/remotion-studio/references/shot-recipes/（自有存量，去介质化，原文语言保留）

# shot-recipes/

> L2 | 父级: /apps/remotion-studio/skills/remotion-studio/references/README.md

成员清单
camera/: Shot Language v3 的 camera、surface、attention 配方；所有 Three/镜头任务先读 `camera/README.md`，再按需读取具体配方。
data/: 数据、图表与数字信息的动态配方。
effects/: 光效、构图反馈与图形强调配方。
interaction/: 输入、光标、筛选与界面状态的帧驱动配方。
opening/: 片头钩子与品牌建立配方。
outro/: 收束、品牌落版与结尾配方。
rhythm/: 卡点、批量运动与节奏中断配方。
transition/: 镜头之间的转场配方。
typography/: 标题、文字与排版动效配方。
ui-entrance/: 页面、卡片和界面元素的入场配方。

依赖边界
每张卡只描述动作语法、时值、构图约束和已知风险；实现时读取对应场景的 `primitives.tsx`、`@recut/remotion-kit/components` 或 `catalog.json` 中的现有能力，不把配方当作第二套组件库。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
