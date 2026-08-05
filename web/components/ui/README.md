# web/components/ui/

> L2 | 父级: /web/components/README.md

成员清单
badge.tsx: 紧凑状态与版本标签。
button.tsx: 支持 default、outline、ghost 变体的操作按钮；品牌绿只用于明确命令，次级操作保持白底描边。
card.tsx: 带 Header、Content、Footer 插槽的低圆角内容容器；仅用于独立条目、对话框和工具面板，页面分区不得套卡片。
input.tsx: 统一焦点环和无障碍状态的单行输入框。
popover.tsx: 基于 Radix Portal 的可访问浮层原子；负责锚点定位、边界碰撞处理和脱离父级堆叠上下文渲染。

设计规范
- 色彩：内容使用语义 token；`primary` 仅表示可执行的主命令，`accent` 用于当前导航和弱强调，状态色不能充当品牌色。
- 排版：Inter/PingFang SC；页面标题 30px，分区标题 16px，正文 14px，辅助信息 12px，标签 10px 等宽字。
- 尺寸：以 4px 为步长；常规控件高 32px，图标按钮使用固定正方形；圆角仅为 6px、8px、10px、12px 四档。
- 布局：Studio 和工具页使用完整内容带，不把页面段落嵌套进卡片；可重复的数据项目可用 Card，右侧 Agent 是固定工作面。
- 交互：hover 只改变颜色或轻微阴影；所有键盘焦点都有绿色 focus ring；二值选择使用 switch/checkbox，选项集合使用菜单或 tabs。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
