# effects/

> L2 | 父级: ../README.md

成员清单

index.ts: 已验证的全局 Effect Component catalog，负责产品注册与参数面板元数据。
glitch-effect.tsx: Glitch 全局 Effect 组件，消费共享 Texture pass，不再独立维护 GLSL。
ripple-effect.tsx: Ripple 全局 Effect 组件，负责场景纹理输入与参数更新。
shared/: 无 React 生命周期的通用纹理、材质与捕获工具；不存放具体 Effect GLSL。

架构原则：组件只负责输入纹理、生命周期和参数绑定；具体 Shader pass 与 EffectDefinition 统一位于 ../shader-effects，组件通过 registry 复用，避免全局 Effect 与元素动画出现两份视觉算法。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
