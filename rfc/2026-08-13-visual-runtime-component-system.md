<!--
 * [INPUT]: 依赖 apps/editor 现有渲染管线（scene-builder / resolve / render-model / three compositor）、
 *          params/ParamDefinition 参数系统、graphics/effects/masks 注册表模式，以及 R3F/Three 场景渲染能力
 * [OUTPUT]: 定义 Recut Visual Runtime 与 Component System 的架构决策、数据模型、渲染模型与分阶段实施路线
 * [POS]: rfc 的架构设计蓝图；在获批实现后作为 apps/editor 渲染层重构、组件注册表与 Preview/Export 的共同契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: Recut Visual Runtime 与 Component System

- 状态：提议
- 依赖：现有 `apps/editor` 渲染管线（`scene-builder` / `resolve` / `render-model` / `three/compositor`）
- 日期：2026-08-13
- 目标版本：Phase 1（垂直切片）

## 1. 背景与目标

Recut 不是传统视频编辑器，而是面向 AI 时代的 Visual Runtime。它的内容类型不只限于：

```text
Video / Image / Audio / Text
```

还需要原生表达：

```text
3D Object / Shader Effect / Interactive Visual / Motion Graphic /
HTML UI / Particle / Generative Animation / Visual Effect
```

这些内容不能被硬编码进 Runtime。因此需要一套**可扩展的 Visual Component 系统**，并让底层渲染体系从"时间线图层合成"演进为"世界（场景图）渲染"。

本文档定义这一套架构的**已确认决策**、**数据模型**与**实施路线**，作为后续实现的契约。

## 2. 核心心智模型（已确认）

> **Recut 的 Document 就是一个"世界"（场景图），时间线是这个世界的创作表面。**

```text
世界 (Scene)
  ├── 对象们 (scene graph)
  │     每个对象：spawn 时间窗 + 参数 + 动画
  ├── 相机（也是对象）
  ├── 光（也是对象）
  ├── 环境：背景 / 雾 / 全局后处理
  └── 时长
```

时间线轨道只是**创作便利**：渲染器不关心轨道，只关心对象图 + 时间。

**统一原则：一切都是对象/组件。**
- `video` = 内置组件：一个带视频纹理的 plane
- `text` = 内置组件：一个带 HtmlTexture 的 plane
- `camera` / `light` = 也是对象
- 3D 组件 = 真实 mesh / material / shader 对象
- 时间线元素 = 世界对象实例

这条原则让"时间线定义的就是提交给 R3F 的内容"字面成立：**最终渲染完全交给 R3F（fiber）**。

## 3. 渲染模型（已确认）

```text
时间线元素
  → buildWorld(): 世界对象图（对象带 spawn 窗口 + 参数 + 动画）
  → 每帧 evaluate(time):
      · 对象是否在场（startTime ≤ t < startTime + duration）
      · 参数动画求值（关键帧作用于 params.* 路径）
  → 挂进 R3F 场景（持久对象，逐帧 mutate，绝不 rebuild）
  → R3F 相机渲染整个场景（材质混合 / 深度排序由引擎处理）
  → 可选全局后处理 pass
  → Frame
```

三个不变量：

1. **Graph build 不进 Frame Loop。** 世界对象图只在结构变化时重建；每帧只做 `evaluate(time)` 与对象挂载的 mutate。
2. **R3F 拥有整个场景。** 组件是真实场景对象（geometry / material / shader / lights / camera 全可用），不是纹理限制。
3. **Preview 与 Export 共享同一 Runtime。** 组件不知道自己是在预览还是导出，相同时间 + 参数 ⇒ 相同视觉结果。

### 3.1 组件渲染的落点

组件内部可以是任意 R3F 元素树。它参与世界渲染的方式由其自身的场景位置决定：

- **世界内对象（默认）**：直接作为场景对象，参与深度/光照/排序。
- **隔离层（仅当需要）**：渲染进离屏 RenderTarget 后作为一张图参与最终合成——仅为需要 PS 混合或逐层 mask/effect 的对象保留，不是通用路径。

RT 边界是"渲染结果落在哪个缓冲"，**不是几何能力限制**。

## 4. 关键决策（已确认）

### 4.1 组件 = 代码，对外暴露参数

组件本质是一个 **React/R3F 组件函数**，接收时间与参数，渲染 R3F 元素。它自己决定：

```text
我是什么 / 我怎么渲染 / 我作用在哪里 / 我有哪些参数 / 默认值是什么 / 内部配置是什么
```

用户不选择 Local / Track / Global Effect——**组件自己决定自己的渲染行为**。

### 4.2 混合模式 = 每对象材质属性

- 混合是每个对象的 `material.blending`，GPU 将对象与其身后的累积场景内容混合。
- 关键洞察：在 z=0 平面栈上，对象按轨道顺序从下往上绘制，画到第 N 个平面时帧缓冲已累积其下所有内容。因此"对象与身后场景做材质混合" **数学上等价于** 传统扁平合成器的"本层与累积 backdrop 混合"。
- v1 支持 `normal / additive / multiply / subtractive`（R3F 材质原生）。
- 17 种 Photoshop 超集模式（overlay / soft-light / color-dodge / hue / saturation…）需要每像素采样 backdrop 的着色器，无法用标准 blend 函数表达——**v1 砍掉**，远期作为"该对象隔离渲染 + 最终后处理 pass"补充。
- 对整张世界图像的全局效果（film grain / vignette / 调色）走最终后处理 pass，这就是"顶层 material"的唯一位置。

### 4.3 2D 排序规则（AE 3D layer 规则）

- **z=0 平面**：按时间线轨道顺序定序（底层轨道在前），`renderOrder = 轨道序`，符合用户"上下层"心智。
- **显式 z**：用户将对象放入 3D 空间（位置/朝向），按真实 3D 逻辑——透视、深度遮挡、光照。
- 混排：2D 平面恒在 z=0 面；3D 对象用真实深度；相遇时按实际深度/画序裁决。

### 4.4 不建 ExecutionGraph 编译器

数据流执行图（依赖分析 / dirty 求值 / 子图缓存）**不需要**。世界对象图本身就是图；"Visual Fiber" 就是 R3F 场景对象本身；每对象材质混合 + 引擎深度排序已经提供合成语义。dirty 求值的收益由"对象级按时间窗跳过 + 静态组件 memo"覆盖。

### 4.5 每帧执行与静态/动态分离

- 每帧只重渲**依赖时间**的对象（组件子树）；不依赖时间的静态对象用 `React.memo` 跳过。
- 组件数量 v1 有界（内置组件 < 50），声明式逐帧 React 重渲可行——与现有 `three-renderer.tsx` 每帧 `root.render()` 成本同量级。
- 重活部件内部可退到 `useFrame` 指令式修改 material/position。

### 4.6 确定性契约

`evaluate(time)` 路径必须是确定性的：禁止 `Math.random` / `Date.now` 等非确定源。这是 Preview 与 Export 逐帧一致的前提。

## 5. 数据模型

### 5.1 世界与对象

```ts
interface World {
  id: string
  width: number
  height: number
  fps: number
  duration: number
  environment: {
    background: string                       // 纯色 / 渐变 / 图片（plane 或 clear color）
    fog?: unknown
  }
  camera: WorldCameraConfig                  // 默认 2.5D 正交相机，可被对象覆盖
  objects: WorldObject[]
}

interface WorldObject {
  id: string
  type: string                               // "component" | "video" | "image" | "text" | "graphic" | "camera" | "light" | "group"
  assetId?: string                           // component / media 的资产引用
  parent?: string                            // 分组（v1 之后）
  startTime: number                          // ticks，spawn 窗口
  duration: number                           // ticks
  params: Record<string, ParamValue>         // 对象参数（复用 ParamValues）
  animations?: ElementAnimations             // 关键帧（params.* 路径）
  transform?: { position, scale, rotation }  // 世界变换（z 缺省为 0）
}
```

### 5.2 Component

```ts
interface ComponentDefinition {
  id: string
  name: string
  keywords: string[]
  inputs: ParamDefinition[]                  // 复用现有 params 系统
  render: (props: ParamValues, localTime: number) => React.ReactNode   // R3F 元素树
  dispose?: (instance: unknown) => void      // GPU 资源释放
}

interface ComponentAsset {
  id: string
  type: "component"
  name: string
  version: string
  bundle?: string                            // UGC：.rcut 内容 URL（远期）
  preview?: string
  metadata?: { inputs: ParamDefinition[] }
}
```

组件在时间线上的实例就是 `WorldObject { type: "component", assetId, params, startTime, duration, animations }`——时间线只保存"何时出现、持续多久、用什么参数"。

### 5.3 时间

```ts
interface TimeContext {
  current: number      // 全局时间
  frame: number
  fps: number
  duration: number
}
```

组件用 `localTime = current - instance.startTime` 渲染。组件不自行 `requestAnimationFrame`；时间由 Runtime 驱动。

## 6. 组件系统

### 6.1 内置组件（Built-in）

系统内置组件直接存在于源码中，随 Recut 编译，本质是 Runtime 的原生 Visual Primitive：

```text
src/components/
  ├── Text/      （HtmlTexture plane）
  ├── Shape/     （mesh + geometry）
  ├── Image/     （texture plane）
  ├── Video/     （video texture plane）
  ├── Light/     （directional / point / ambient）
  ├── Camera/    （默认世界相机，可动画）
  ├── HtmlInCanvas/
  └── Shader/    （shaderMaterial 封装）
```

注册在 `componentsRegistry`（复用现有 `DefinitionRegistry` / `graphicsRegistry` 模式）。现有的 `graphics/effects/masks` 三套注册表最终统一到组件注册表。

### 6.2 UGC 组件（远期）

UGC 组件不进入 Recut 源码，是 Project Asset：

```text
project/assets/components/
  ├── glass-card.rcut
  └── kinetic-title.rcut
```

生产态通过 `recut component build` 把多文件源码（TSX / TS / GLSL / assets）编译为 `.rcut`（Vite 产物 + manifest），Runtime 经 Component Loader 动态 `import(url)` 加载。开发态走 Vite dev server + React Fast Refresh + HMR。

**v1 不做 UGC 动态加载**；内置组件与 UGC 共享同一 `ComponentDefinition` 契约，UGC 只是把"注册表里的组件"换成"import 加载的组件"。

### 6.3 AI 生成

AI 是组件的重要生产者：`LLM → 组件源码 → (编译) → 组件定义 → 注册/加载`。AI 不需要理解整个编辑器，只需要理解如何创建一个 Recut Component。v1 阶段 AI 面向内置组件注册表与参数化实例。

### 6.4 参数系统复用

- `ComponentDefinition.inputs` = 现有 `ParamDefinition`；实例 `params` = 现有 `ParamValues`。
- 关键帧动画系统已支持任意 `params.*` 路径 → 组件 props 天然可打关键帧。
- Inspector、参数 UI、clip 编辑全部复用现有能力。

### 6.5 默认值

组件必须"拖进去就能用"：`implementation + default configuration + user parameters`。默认值是组件定义的一部分。

### 6.6 不嵌套（v1）

v1 禁止时间线级 `ComponentInstance` 引用另一个组件资产（避免依赖图 / HMR 图 / 加载顺序问题）。组件内部使用内置 primitive 组合（Group / Mesh / Text…）是允许的。

## 7. 与现有 apps/editor 代码的映射

| 现有模块 | 职责 | 迁移后 |
|---|---|---|
| `services/renderer/scene-builder.ts` | Timeline → 扁平 RootNode 树 | **buildWorld**：构建世界对象图 |
| `services/renderer/resolve.ts` | 每帧全量解析节点 | **保留为 evaluate(time)**，对象级求值 |
| `three/render-model.ts` | 扁平 ResolvedLayer[] | 淘汰，对象直接进 R3F |
| `three/compositor.tsx` | flat GPU 合成 | 降级为全局后处理（阶段过渡期保留） |
| `three/three-renderer.tsx` / `editor-canvas.tsx` | R3F 宿主（frameloop=never） | 世界场景宿主 |
| `graphics/` `effects/` `masks/` registry | 参数化定义注册表 | 统一为 `componentsRegistry` |
| `three/dom-text-surface.ts` | HTMLInCanvas primitive | 保留，作为 Text 组件内部实现 |
| `services/video-cache/service.ts` | 视频解码 | 保留，Video 组件内部实现（sourceVersion 机制继续用） |

## 8. 渲染与合成细节

### 8.1 世界渲染

```
R3F <Canvas frameloop="never">  ← Runtime 驱动
  <Camera/>（默认正交，z=0 平面适配；可被 Camera 对象替换）
  <Lights/>
  {objects.map(o => <ObjectView key={o.id} obj={o} time={t}/>)}
  <PostProcess/>（可选全局效果）
```

对象挂载为**持久对象**：`ObjectView` 按 `o.id` 稳定挂载，`time` 变化时 mutate，不卸载重建。

### 8.2 2D 内容在 3D 世界里

- video / image / text / graphic 都是 z=0 的纹理 plane，`renderOrder = 轨道序`。
- 蒙版 = plane 材质上的 alpha/着色器（feather 沿用现有 buildMaskTexture 思路）。
- 逐对象效果（blur 等）v1 阶段作为材质/后处理属性，或该对象隔离渲染。

### 8.3 全局效果（Film Grain / Vignette / Grade）

作为世界级后处理 pass，对整张世界图像生效；实现为组件（capability 声明为全局后处理），不改核心模型。

## 9. Preview / Export 统一

```text
              World (对象图)
                    ↓
           Visual Runtime.evaluate(time)
              /              \
          Preview           Export
             ↓                ↓
        R3F (on-screen)   R3F (逐帧 offscreen)
             ↓                ↓
            GPU              GPU
```

Export 循环：`for frame in 0..N: runtime.evaluate(t); renderer.render(); encoder.encode(frame)`。Graph build 只在任务开始时一次。

## 10. 性能原则

- 静态对象（不依赖时间）不进入每帧重渲：`React.memo` / 对象级跳过。
- 组件按 `id` 稳定挂载，避免每帧卸载/重建。
- 视频纹理按 `sourceVersion` 只更新内容变化的帧（现有机制）。
- RenderTarget、material、geometry 按对象复用，不每帧分配。
- v1 目标：50+ 内置对象 60fps 交互；不追求千级对象，但架构不允许出现"每帧全量重建"。

## 11. v1 范围与边界

```text
✅ 内置组件（Video/Image/Text/Shape/Shader/Camera/Light）
✅ ComponentDefinition + componentsRegistry
✅ 时间线元素 = 世界对象实例（spawn 窗口 + 参数 + 关键帧）
✅ 每对象材质混合（normal/additive/multiply/subtractive）
✅ z=0 按轨道序 / 显式 z 走 3D
✅ 全局后处理（grain/vignette/grade）
✅ Preview / Export 共享 Runtime + 确定性
✅ HTMLInCanvas（已有 dom-text-surface）
✅ 组件 props 可打关键帧
✅ 默认值 / 拖进去就能用
✅ AI 面向组件定义生成

❌ UGC .rcut 动态加载
❌ 时间线级组件嵌套 / 分组（Group 对象）
❌ 17 种 PS 混合超集模式
❌ Component Marketplace
❌ ExecutionGraph / 数据流编译器
❌ 跨图层 z-depth 合成（需要时用隔离层 + 后处理补）
```

## 12. 分阶段实施路线

### Phase 1：垂直切片（MVP）

1. `ComponentDefinition` + `componentsRegistry`（复用 `DefinitionRegistry`）。
2. `buildWorld()`：时间线元素 → 世界对象图（替代扁平 scene-builder）。
3. R3F 世界场景宿主：video / text 先以 plane 组件化，`renderOrder = 轨道序`。
4. 一个真 3D 内置组件（mesh + material + 点光源），验证 geometry/material 在组件内可用。
5. 保留现有 compositor 作为全局后处理，过渡期保底。
6. Preview / Export 同一 Runtime 跑通，逐帧一致。

### Phase 2

- Camera / Light 作为可动画对象；z 语义完整落地。
- 逐对象效果与 mask 迁移到材质/着色器。
- 现有 `render-model` / flat compositor 退役。

### Phase 3

- Group 对象（世界内分组，非组件嵌套）。
- UGC `.rcut` 与 Component Loader、`recut component build`。

### Phase 4

- 每对象隔离渲染 + 最终后处理补 PS 混合超集模式。
- 交互式组件（编辑器内指针事件）。
- AI 组件生成工作流（LLM → 组件定义 → 注册/加载）。

## 13. 风险与未决问题

- **2D 平面与 3D 对象共存排序**：z=0 平面用 renderOrder，3D 对象用深度；共面重叠时的裁决需在 Phase 1 验证。
- **HTMLInCanvas 逐帧重绘成本**：文本变化才重绘（dom-text-surface 已有 key 机制），需在 Phase 1 基准测试。
- **每帧 React 成本上限**：内置对象数量与重渲范围需设定监控指标。
- **确定性**：导出与预览必须逐帧一致，需为组件代码建立契约与测试。
- **视频纹理**：组件内使用视频时需接入 videoCache + sourceVersion 更新机制。
- **过渡期**：flat compositor 与新世界渲染并存期间，需保证两种路径输出一致，避免"预览一套、导出另一套"。

## 14. 结论

Recut 的渲染层最终形态是：

> **时间线 → 世界对象图 → R3F 场景（组件即对象，材质混合/深度排序由引擎处理）→ 可选全局后处理 → Frame。**

组件 = 可执行、可复用、可传播的 Visual Asset，由系统内置、开发者创建或 AI 生成。v1 从"内置组件 + 世界渲染"垂直切片开始，逐步退役扁平合成器，最终让 Preview、Export、未来的 Headless 共享同一 Visual Runtime。
