# properties/

> L2 | 父级: components/editor/panels/

成员清单

index.tsx: 属性面板根组件；未选中元素时展示 ProjectSettingsPanel（项目全局设置），单选中时以固定宽度、带激活态的无图标真正 Tab 切换“画面”和“动画”两个大板块；内容内部不重复渲染板块标题。
project-settings.tsx: 未选中元素时的项目全局设置视图；Header 区（h-11）左侧标题、右侧紧凑 ExportButton 导出入口，下方单列滚动承载名称（宿主项目名）、帧率、画面比例与背景，不设 Tab 分栏。
background.tsx: 项目背景设置视图（由左侧素材面板设置迁入）；模糊强度与颜色/图案/渐变背景库。
registry.tsx: 元素类型到属性分组的纯映射；不调用 React Hook，避免选择状态改变时破坏 Hook 顺序。
components/: 各属性分组的表单与参数字段。
stores/: 属性面板局部交互状态。

法则: 渲染期状态只在组件或自定义 Hook 中读取；注册表只接收显式参数并返回配置。左侧素材面板不再承载设置入口，项目级配置一律归右侧未选中态。项目名称以宿主项目名为唯一真相源（recut/use-host-project.ts 读取/写回），内部文档名漂移时自动采纳宿主名，保证导出文件名与顶栏一致。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
