# runtime/

> L2 | 父级: /apps/editor/README.md

成员清单
types.ts: World、组件 surface、ComponentDefinition 与 origin 契约，明确内置组件和项目 asset 的来源边界。
component-loader.ts: 受校验的动态 bundle 加载、Host resolver 与项目 asset 来源元数据注入。
component-registry.ts: 已注册和异步组件定义的加载状态、缓存与订阅。
components/: 内置组件、HTML surface 与媒体对象实现。
runtime-host.ts: 动态组件可安全引用的受控运行时导出。
world-runtime.ts, world-renderer.tsx, world-scene.tsx: World 到 WebGL/HTML-in-Canvas 预览的运行时与渲染器；WorldScene 仅在明确提供外部 canvas 时复用它，否则始终使用 R3F 自己挂载的画布。
build-world.ts, anim.ts, texture.ts, utils.ts: World 构造、确定性动画、纹理与共享计算。
timeline.ts: GSAP 动画执行面（rfc/2026-08-20）——FrameTimeContext/MotionProgramContext/useFrameContext/useTimeline/useMotionProgram（paused Timeline + 逐帧 seek(t)）+ 活跃实例注册表与插件白名单；react/r3f 组件动画首选，html 承载面继续用 anim.ts。
motion-runtime.ts: 引擎中立 Motion Program 的 GSAP 编译器、DOM/Three/Shader adapter 与目标注册表；所有数据驱动预设共享 paused timeline + seek(t)，并由 adapter 阻止布局写入或 uniform 容器替换。
motion-presets.ts: 声明式预设 catalog；Shader 预设只写 `effects.<id>.<parameter>` 语义路径，不包含 GLSL 或具体组件判断。
shader-effects/: 元素 Shader Motion 公共协议、EffectDefinition 多实现解析、可组合 EffectGraph、已验证 Shader passes 与 Host；所有 Shader source 只归属此模块，Global Effect 和 Motion 共用。
text-motion.tsx: Unicode 安全的 whole/line/word/grapheme 分段与 useMotionTextSegments；文本 DOM 只在内容/模式变化时重建，时间变化只 seek 稳定 refs。
text-segmentation.ts: 无 React/GSAP/DOM 依赖的纯分段函数，供单测、编辑器预览和文本 hook 共享。

依赖单向流：`asset.list/时间线引用 -> recut/components.ts -> component-loader.ts -> component-registry.ts -> World renderer`。动态组件统一标记 `origin=asset`；组件 Tab 只展示内置定义，项目组件只能经素材库 asset 引用出现。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
