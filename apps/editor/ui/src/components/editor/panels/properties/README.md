# properties/

> L2 | 父级: components/editor/panels/

成员清单

index.tsx: 属性面板根组件，以固定宽度、带激活态的无图标真正 Tab 切换“画面”和“动画”两个大板块；内容内部不重复渲染板块标题。
registry.tsx: 元素类型到属性分组的纯映射；不调用 React Hook，避免选择状态改变时破坏 Hook 顺序。
empty-view.tsx: 未选中元素时的空状态视图。
components/: 各属性分组的表单与参数字段。
stores/: 属性面板局部交互状态。

法则: 渲染期状态只在组件或自定义 Hook 中读取；注册表只接收显式参数并返回配置。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
