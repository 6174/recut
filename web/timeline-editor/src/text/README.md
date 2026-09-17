# text/

> L2 | 父级: /apps/editor/README.md

成员清单
background.ts: 文本背景参数边界与默认值。
layout.ts: 文本块、背景与装饰线的画布布局计算。
measure-element.ts: 时间线文本元素的测量与可视边界求值。
primitives.ts: 字体、换行、字距和背景的低层绘制原语。
typography.ts: 文本字号与颜色的全局常量。
components/: 文本资源面板视图；成员见 `components/README.md`。

依赖单向流：`typography/background -> primitives/layout -> measure-element -> renderer/properties`；资源面板只创建默认文本元素，不参与测量与绘制。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
