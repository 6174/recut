# views/

> L2 | 父级: /apps/editor/ui/src/components/editor/panels/assets/README.md

成员清单
assets.tsx: 素材资源视图，展示与管理可导入的媒体资产。
base-panel.tsx: 资源视图共享的面板骨架，统一标题、工具与内容区域。
component-library.tsx: 组件与特效图库；ComponentAssetLibraryView 通过 asset.list 发现 type=component 引用，asset.archive 隐藏引用，使用统一 16:9 缩略图与名称卡片；单击组件打开预览，项目组件才显示行号源码窗，并可复制包含几何、参数和源码的 Debug 上下文。
component-preview.tsx: 组件预览适配层；r3f 由 WorldScene 自持画布渲染，html/react 直接渲染 DOM（包 FrameTimeContext 提供逐帧时间，驱动 useTimeline seek），并按承载区缩放内容。特效（category=effect）预览世界额外挂载 effect-preview-base 的案例底图内容，否则后处理特效无底层可采样、预览接近空白。
effect-cover.tsx: 特效卡片静态封面；复用 motion presets 封面的视觉语言（识别色 135° 对角渐变 + 斜向高光 + 左下角 PREVIEW 标记），纯 CSS 离线生成，替代原先「深色底 + 发光圆点」占位。
effect-preview-base.ts: 特效预览底图；离屏 canvas 生成渐变底图 + 文字 + 形状的确定性案例内容（离线、无网络），作为采样底层场景纹理的后处理特效（玻璃/放大镜/CRT…）底下的预览场景。

组件库只暴露一个预览入口。`surface` 是渲染器的唯一选择依据，避免把内部实现细节变成用户要做的决定。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
