# Recut Element Effect Graph：已验证 Effect 复用与可组合动画

状态：Draft / P0 架构基线

## 目标

将全局 `components/effects` 中已经通过真实画布验证的特效，迁移为元素级 Motion 可复用的唯一视觉实现。`MotionPreset`、手工 Effect 与未来的组合动画都编译为同一份 EffectGraph；Motion 只负责时间和参数，Effect 负责渲染。

## 核心模型

```text
PresetMotion / Effect UI
        ↓
EffectGraph { ordered nodes, semantic params }
        ↓
EffectDefinition { one logical effect }
        ↓
Implementation Resolver
  └─ texture pass（2D source texture）
```

`EffectDefinition` 是唯一 Shader 入口。它拥有稳定的 `id/parameters`，当前动画 Effect 只声明 canonical Texture implementation；没有 source texture 的 3D 材质不伪造 material fallback。

## 复用规则

`runtime/shader-effects` 是视觉 Shader 的唯一来源。全局 Effect 和 Element Motion 只能复用同一份 pass、uniform schema 和参数语义，`components/effects` 只保留 React/R3F 的输入纹理、生命周期和 uniform 绑定。

以 Glitch 为例：

```text
SceneCapture → verified Glitch Texture Pass → global canvas
ElementCapture → verified Glitch Texture Pass → element composite
```

Element Animation 与全局 Effect 必须使用同一 EffectDefinition；2D 元素使用同一 Texture pass，纯 Three 几何体在未具备高保真 Capture 前不展示 Shader 动画。

## EffectGraph 契约

```ts
interface EffectGraph {
  schemaVersion: 1;
  nodes: Array<{
    effectId: string;
    order: number;
    enabled?: boolean;
    params?: Record<string, number | string | boolean>;
  }>;
}
```

节点按 `order` 稳定执行。Preset 可以生成一个节点，也可以组合多个节点；Effect 面板直接编辑同一 Graph。冲突参数由 Graph 层定义合并策略，不由组件自行判断。

## 生命周期

1. `VisualRuntime` 根据元素的 Motion binding 生成确定性时间和语义参数。
2. `EffectRuntime` 按 element identity 缓存 graph/instances，逐帧 seek 并更新 canonical Texture uniforms。
3. `ElementCapture` 为 HTML-in-Canvas、Image/Video、Three 子树提供统一 source texture。
4. Texture pass 链在局部 RenderTarget 中执行，再回到元素的 transform/opacity/composite 层。
5. source texture 不可用时，Resolver 返回不支持；UI 隐藏该 Shader 预设，Host 保持原材质。

## 组合语义

入场、出场、循环只是时间槽；它们可以同时引用多个 Effect 节点。Transform、DOM text、Texture Effect、Material Effect 仍由同一个 paused GSAP timeline seek，EffectGraph 只描述渲染链，不重复创建时间系统。

## 验证

- 单测：Resolver 按能力和优先级选择实现；Graph 节点去重、排序和禁用；全局/元素 Glitch 使用同一 pass source。
- E2E：GlowBox、Canvas Text、Image/Video 各自挂载同一 Loop Glitch，验证 active/peak/clear 三帧；确认不残留、不持续污染。
- 视觉回归：对比 `components/effects` 已验证截图，不能只断言 uniform 数值变化。
- 性能：同一 element identity 不重复创建 RenderTarget、EffectInstance 或材质 program。

## 分阶段迁移

- P0：EffectDefinition 多实现、EffectGraph、Glitch/Ripple pass 抽取与复用。
- P1：ElementCapture + EffectHost，统一承载 Texture implementation；现有 CRT/VHS/Displacement/Reveal 已进入同一 registry，元素动画与全局 Effect 复用同一 canonical Definition。
- P2：Geometry/Composite implementation，继续把 Bend、Dissolve、Mask、粒子类剪映预设接入同一 EffectGraph。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
