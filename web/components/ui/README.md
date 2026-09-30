# web/components/ui/

> L2 | 父级: /web/components/README.md

成员清单
badge.tsx: 紧凑状态与版本标签。
button.tsx: 支持 default、outline、ghost 变体的操作按钮；品牌绿只用于明确命令，次级操作保持白底描边。
card.tsx: 带 Header、Content、Footer 插槽的低圆角内容容器；仅用于独立条目、对话框和工具面板，页面分区不得套卡片。
dropdown-menu.tsx: 基于 Radix DropdownMenu 的下拉菜单原子；一枚入口展开一组选项（Portal 渲染、键盘导航、外点/Esc 关闭、边界碰撞由原语承担），条目统一「图标在左、文案在右」。
hover-card.tsx: 基于 Radix HoverCard 的悬停浮层原子；悬停或聚焦锚点即展开、经 Portal 脱离父级堆叠上下文渲染，供 Header 返回入口等「悬停即预览」场景复用；浮层内容必须自带内边距（原子只给容器）。
input.tsx: 统一焦点环和无障碍状态的单行输入框。
popover.tsx: 基于 Radix Portal 的可访问浮层原子；负责锚点定位、边界碰撞处理和脱离父级堆叠上下文渲染。
select-field.tsx: 固定枚举的自定义选择原子；经 Popover 呈现可达选项列表，禁止页面直接使用原生 `<select>`。

设计规范
- 色彩：内容使用语义 token；`primary` 仅表示可执行的主命令，`accent` 用于当前导航和弱强调，状态色不能充当品牌色。
- 排版：Inter/PingFang SC；页面标题 30px，分区标题 16px，正文 14px，辅助信息 12px，标签 10px 等宽字。
- 尺寸：以 4px 为步长；常规控件高 32px，图标按钮使用固定正方形；圆角仅为 6px、8px、10px、12px 四档。
- 布局：Studio 和工具页使用完整内容带，不把页面段落嵌套进卡片；可重复的数据项目可用 Card，左侧 Agent 是固定工作面。
- 交互：hover 只改变颜色或轻微阴影；所有键盘焦点都有绿色 focus ring；二值选择使用 switch/checkbox，选项集合使用菜单或 tabs。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
