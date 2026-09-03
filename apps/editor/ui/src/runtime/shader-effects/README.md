# shader-effects/

> L2 | 父级: ../README.md

成员清单

types.ts: 逻辑 Effect、实现变体、能力上下文与实例契约；一个 Effect 可拥有 texture/material/geometry/composite 多种实现。
registry.ts: effect 注册、实例创建、能力解析、可组合 EffectGraph 与 effects.* Motion adapter。
host.tsx: 公共元素材质 Host；只安装支持 source texture 的 canonical Texture pass；不支持的材质保持原样。
passes/: 全部已验证的 Texture/Geometry/ambient pass；Glitch、CRT、VHS、玻璃、粒子、复古等视觉源只在这里定义，`index.ts` 负责稳定导出。
effects/legacy.ts: 将原 components/effects 的已验证 pass 包装成 EffectDefinition，统一暴露给全局 Effect 与 Element Animation。
effects/: EffectDefinition 语义注册；当前动画 Effect 只声明 canonical texture implementation，Motion 不携带动画专用 GLSL。
index.ts: 对外聚合入口。
shader-effects.test.ts: 注册表、能力解析、graph 组合和实例 adapter 的纯逻辑回归。

架构原则：EffectDefinition 表示逻辑特效，canonical Texture implementation 承载真实视觉算法；Preset/Effect 都编译为可排序的 EffectGraph；Motion 只驱动语义参数。没有 source texture 的 Shape/Spline 等材质不展示 Shader 动画，也不创建近似 fallback。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
