# timeline/

> L2 | 父级: /apps/editor/README.md

成员清单

group-move/: 多选元素拖动的组构建、目标轨道解析、吸附与回归测试；同轨元素保持单轨，跨轨元素保留垂直结构。
placement/: 新元素落轨与时间区间冲突判断；只在真实冲突时创建新轨道。
components/: 时间线轨道、拖放目标与可见轨道布局。
controllers/: 鼠标拖动、缩放、调整大小等交互控制器。
types.ts: 时间线元素、轨道、场景与引用的领域类型；视觉元素通过 motion/textMotion 保存预设绑定，运行时再编译为 MotionProgram。

法则: 时间是整数 tick；轨道选择先验证兼容性与区间，再提交不可变移动计划。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
