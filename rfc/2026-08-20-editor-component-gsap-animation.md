<!--
 * [INPUT]: 依赖 apps/editor runtime 现有组件契约（@recut/runtime 共享实例、surface html/react/r3f、
 *          ComponentRenderContext（time/localTime/progress/anim）、HtmlObject 的每帧 flushSync 捕获、
 *          WorldScene 的 demand frameloop + FrameInvalidator）、component-build.js 的确定性静态扫描与
 *          --loose 作者路径、background/components.js 的 COMPONENT_AUTHOR_HEADER / 脚手架生成器、
 *          skills/recut-editor/references 的 component-authoring.md / components.md / motion-graphics.md，
 *          以及 greensock/gsap-skills 官方技能（gsap-core / gsap-timeline / gsap-react / gsap-utils / gsap-plugins，
 *          MIT，Webflow 收购后含 SplitText/MorphSVG 在内全部插件免费）。
 * [OUTPUT]: 定义 GSAP 动画进 AI 组件定义：以「GSAP Timeline + 运行时逐帧 seek(t)」作为 react/r3f 承载面的
 *          主要动画模型（html 保持 anim.*），并把 gsap-skills 融合进组件创作 reference 与作者契约。
 * [POS]: rfc 的架构设计蓝图；获批后作为 SDK 导出面、useTimeline/FrameTimeContext 运行时、构建确定性扫描、
 *        作者契约与组件动画 reference 的共同契约。与 2026-08-19 架构修复一致：平台拥有框架、模型只拥有内容，
 *        确定性从「每帧渲染纯函数」演进为「构造确定性 + 驱动靠 seek」。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

# RFC: 组件动画升级——GSAP Timeline + 运行时 seek(t)

- 状态：Proposal
- 作者：Recut
- 日期：2026-08-20
- 决策范围：`@recut/runtime` SDK 导出面（gsap/useGSAP/useTimeline/useFrameContext/插件白名单）、运行时逐帧驱动（FrameTimeContext + timeline 注册/seek 时序）、构建期确定性扫描扩展、作者契约（COMPONENT_AUTHOR_HEADER + 脚手架 + 新 reference）、surface 边界（react/r3f 得 GSAP，html 保持 anim.*）、gsap-skills 融合方式
- 关联：[AI 临时组件（Temp Components）](./2026-08-14-ai-temp-components.md)（D4 作者分级 / D5 动画=t 的纯函数 / D6 单虚拟模块 / D7 托管 SDK）、[Visual Runtime 与 Component System](./2026-08-13-visual-runtime-component-system.md)（§4.6 确定性契约）、[组件创建链的架构修复](./2026-08-19-editor-component-create-resilience-and-compositing.md)（P3 平台拥有框架模型只拥有内容、P4 证据驱动）、[greensock/gsap-skills](https://github.com/greensock/gsap-skills)

## 1. 摘要

Motion-Graphic 组件是 AI 产出密度最高的内容，而当前动画能力只有 `anim.*` 四个纯函数助手（`lerp` / `lerpColor` / `seq` / `pulse`）。它们保证确定性，但表达力远不足以支撑真实的动效设计：时间线编排、stagger、back/elastic 缓动、SVG 形变、文字拆分、路径运动都要靠 AI 手写数学。结果就是"AI 动画难写、写完不生动、迭代轮次多"。

本 RFC 引入 **GSAP**（MIT，官方 AI 技能 greensock/gsap-skills 免费且成熟）作为 react/r3f 承载面的**主要动画模型**：

> **组件用 GSAP Timeline 声明动画；运行时把当前帧的 `t`（`localTime` / `progress`）逐帧 seek 进去。动画状态 = 时间轴的纯函数，确定性不变。**

关键结论：

| # | 结论 |
|---|---|
| K1 | **确定性是增强而非削弱**：Timeline 构造一次（确定性）、驱动只走 `progress()`/`seek()`（纯函数），Preview==Export 逐帧一致的不变量继续成立；构建期扫描与 harness 的"同 t 同像素"校验仍然兜底 |
| K2 | **r3f 与 react 复用同一套 `useTimeline`/`useGSAP` 模式**：目标从 DOM ref 换成 `Object3D` ref 即可（`.position`/`.rotation`/`.scale` 都是普通数值对象，GSAP 原生可动画）；用户示例的 R3F 写法无需改造即可进入契约 |
| K3 | **html 承载面不引入 GSAP**：字符串模板每帧 `innerHTML` 重写、无 ref，GSAP 无从挂载；需要 GSAP 时把 `surface` 改成 `"react"` 即可（一行改动） |
| K4 | **gsap-skills 融合进组件 reference 与作者契约**：官方技能按 Recut 确定性约束裁剪后落成 `references/gsap.md`，并浓缩成作者契约内嵌卡片；受限子 Agent 不读外部技能，知识必须内嵌 |
| K5 | **`anim.*` 保留**：作为 html 承载面与简单场景的轻量助手，与 GSAP 并存，零迁移 |

## 2. 现状：`anim.*` 的边界

当前 `ComponentRenderContext` 注入 `anim`（`runtime/anim.ts`，与 SDK 同名导出同实现）：

```ts
interface AnimApi {
  lerp(a, b, u, opts?): number;         // 数字插值，ease 白名单 5 个
  lerpColor(c1, c2, u): string;         // hex → hex
  seq(keys: [number, number][], u): number;  // 关键帧取值（线性）
  pulse(u, opts?): number;              // 三角波 0..1
}
```

局限：

1. **表达力**：没有时间线编排（顺序/重叠/标签）、没有 stagger、没有丰富缓动（power/back/elastic/rough）、没有属性组（`transform: {x, y, rotation}`）、没有 text split / SVG morph / 路径动画。
2. **AI 写出率低**：`easeOutBack` 手写 `1 + c1*(u-1)^3 + c2*(u-1)^2` 这类公式模型容易错；"看起来对"的动画要靠大量迭代碰出来。
3. **代码噪音**：一个入场+呼吸+落定动效就要 5–10 行内联数学，且值计算与渲染耦合在每帧 render 里。

`anim.*` 的设计初衷（D5：动画 = t 的纯函数，禁墙钟）是对的，问题只在"表达能力"与"作者难度"。GSAP 在**保持同一确定性契约**的前提下同时解决这两点。

## 3. 提案：GSAP Timeline + 运行时 seek(t)

### 3.1 核心模型

```text
组件渲染（一次/参数变化时）          每帧（时间变化时）
┌────────────────────────┐        ┌────────────────────────┐
│ <div ref={root}>        │  ──►   │  runtime: tl.seek(t)    │
│   …静态结构…            │  seek  │   （t = localTime/       │
└────────────────────────┘        │      progress/loop）     │
        ▲                         └────────────────────────┘
        │ 声明式（工厂函数）
┌────────────────────────┐
│ useTimeline((tl) => {  │
│   tl.fromTo(".box", …) │
│     .to(…, "-=0.2")    │
│ })                     │
└────────────────────────┘
```

- 动画用 GSAP 的**声明式 Timeline DSL** 描述（GSAP 官方技能里的 canonical pattern），比手写数学简单得多。
- Timeline 必须 `paused: true`，唯一驱动方式是 `tl.progress(p)` / `tl.seek(t)`。
- 结构（DOM 树 / R3F 树）**不随帧重排**；被动画的属性**不进 JSX props**，由 GSAP 经 ref 命令式持有——这是与现有"每帧重渲 + 内联算值"模型的根本差异（§4）。

### 3.2 确定性论证（K1）

不变量（D5 / visual-runtime §4.6）：**Preview 与 Export 逐帧一致，禁止墙钟源**。

GSAP 下如何保持：

1. **构造确定性**：Timeline 在 mount/参数变化时构建一次。只要工厂函数内没有墙钟（`Math.random` / `Date.now` / `performance.now`）、没有 ScrollTrigger/Draggable 等位置/交互驱动，同一组参数 + 同一源码 → 同一 Timeline（相同的 tween 目标、duration、ease、相对位置）。
2. **驱动确定性**：`tl.progress(p)` / `tl.seek(t)` 对"已构造的 Timeline"是 `t → 状态` 的**纯函数**（GSAP 内部用 timeline 相对时间插值，scrub 语义，不走 rAF 时钟）。相同 t 必然得到相同插值结果。
3. **端到端校验不变**：harness 的 `determinism` 检查（同 t 渲染两次 → 像素哈希相等）与 smoke 检查（`t ∈ {0,.25,.5,.75,.99}`）原样覆盖 GSAP 组件，墙钟违规会被像素差抓住。

**契约表述从「渲染即纯函数」升级为「构造确定性 + 驱动靠 seek」**，静态扫描与运行时校验随之更新（§7）。对平台而言，"动画 = t 的纯函数"这条成片一致性铁律依然成立，只是实现载体从"每帧手算"换成"seek 时间轴"。

### 3.3 为什么对 AI 更友好

- Timeline DSL 是模型熟知的标准写法（gsap-skills 提供 canonical pattern），产出正确率远高于手写缓动公式。
- "动画"与"结构"分离：结构一次性声明，动画集中在 `useTimeline` 工厂里，二次修订（改节奏/改缓动/加段落）是局部修改，符合"局部问题精修"的反馈纪律。
- 官方技能教会模型正确用法（scope、context 清理、`.fromTo` 而非 `.to` 兜底、transform 别名 `x/y/rotation` 而非 layout 属性），显著减少"API 幻觉"。

## 4. 执行模型：声明式树 + 命令式 seek

GSAP 是命令式变异（改 DOM 内联 style / 改 `Object3D`），与现有"每帧重渲并注入算好的值"冲突。必须让**被动画的树结构稳定、被动画的属性不进 JSX**。

### 4.1 不变量

| 不变量 | 说明 | 违反后果 |
|---|---|---|
| I1 | 被 GSAP 动画的元素必须有**稳定 ref**，React/R3F 不得重建（无依赖 key 的重挂载） | GSAP 目标失效，动画空转 |
| I2 | 被 GSAP 动画的属性**不得同时以时变 JSX props 出现**（`style={{opacity: …}}`、`position={[…,progress,…]}`） | 每帧 reconcile 覆盖 GSAP 的写入，动画被"钉死"在首帧 |
| I3 | Timeline 必须 `paused: true`，只经 `progress()`/`seek()` 驱动 | 自动播放走 rAF 时钟 → 墙钟违规、预览与导出错帧 |
| I4 | seek 必须发生在**本帧纹理捕获 / R3F 绘制之前** | 导出读到上一帧旧状态 → 成片闪动 |

I4 的时序由 React effect 顺序天然保证：`ReactContent` 在 `useLayoutEffect` 里 `flushSync` 提交内层 root（组件树的 layout effect，含 seek）→ 然后外层 `HtmlObject` 自己的 `requestUpdate` layout effect 才执行（子 effect 先于父 effect）。因此 **seek 先于捕获**，无需运行时加钩子（Phase 2 做优化时才需要显式时序）。r3f 同理：组件 layout effect 里的 seek 在本帧 R3F 绘制前完成（demand frameloop 的 invalidate 在提交后触发）。

### 4.2 html 承载面（K3）：不引入 GSAP

`html` surface 是字符串模板，`HtmlStringContent` 每帧 `host.innerHTML = html`，DOM 每帧重建、无 ref 可挂。GSAP 无法稳定持有目标。**保持 `anim.*`**；需要 GSAP 时作者把 `surface: "html"` 改为 `"react"`（渲染输出几乎相同，JSX 自动 runtime 已可用）。作者契约与组件动画 reference 明示这一点。

### 4.3 react 承载面

```tsx
import { useRef } from "@recut/runtime";
import { gsap, useTimeline } from "@recut/runtime";

function Hero({ title }: { title?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useTimeline((tl) => {
    tl.fromTo(root.current,
      { y: 60, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.6, ease: "power2.out" })
      .to(root.current, { scale: 1.06, duration: 0.3 }, "+=0.1")
      .to(root.current, { scale: 1, duration: 0.4, ease: "back.out(2)" });
  }, []);
  return (
    <div ref={root} style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
      <h1>{title ?? "Recut"}</h1>
    </div>
  );
}
```

- 被动画的属性（`y`/`autoAlpha`/`scale`）不在 JSX 里，只有静态布局 props——满足 I2。
- 结构只在参数/输入变化时重建；时间变化只 seek，不重渲树（Phase 2 把"时间变化不重渲"做成运行时保证）。

### 4.4 r3f 承载面（K2：复用同一模式）

用户示例正是正确形态，可直接进入契约：

```tsx
import { useRef } from "@recut/runtime";
import { gsap, useTimeline } from "@recut/runtime";
import type { Mesh } from "@recut/runtime";

function Box() {
  const ref = useRef<Mesh>(null);
  useTimeline((tl) => {
    if (!ref.current) return;
    tl.to(ref.current.position, { x: 3, duration: 1, ease: "power2.out" })
      .to(ref.current.rotation, { y: Math.PI * 2, duration: 2, ease: "none" }, "<");
  }, []);
  return (
    <mesh ref={ref}>
      <boxGeometry />
      <meshStandardMaterial />
    </mesh>
  );
}
```

要点（写进 reference）：

- **目标换成 `Object3D` ref**：`.position`/`.rotation`/`.scale` 是普通对象，GSAP 原生 tween 数值属性；R3F 只读 `Object3D` 的当前值渲染，GSAP 的写入天然可见。
- **被动画属性不进 JSX props**：R3F 只 diff 变化的 props，静态 props 不会重放——但若把 `position={[x, y, z]}` 写成 `progress` 的时变值，每帧 reconcile 会覆盖 GSAP，违反 I2。
- **rotation 用 Euler**：`gsap.to(mesh.rotation, { y: … })` 直接可用；四元数需 proxy 包装，v1 不建议（绝大多数动效 Euler 足够）。
- **`useFrame` 仍禁**：驱动只走 seek；若需要逐帧 read（如受 `localTime` 影响的 shader uniform），用 `useFrameContext()` 读时间（§5.3），仍不碰 `useFrame`。

**结论：react 与 r3f 共享同一 `useTimeline`/`useGSAP` 心智，唯一差异是目标类型。** 这大幅简化了 SDK 与技能面。

## 5. API 设计

### 5.1 `@recut/runtime` 新增导出面

```ts
// —— GSAP（单实例：runtime-host 模块级注册一次；组件 import 走 import map 到宿主共享）
export { gsap, useGSAP, useTimeline, useFrameContext };
// —— 插件白名单（允许列表，全部走 gsap.registerPlugin 由宿主预注册）
export const plugins: {
  CustomEase: typeof CustomEasePlugin;
  MorphSVG: typeof MorphSVGPlugin;
  SplitText: typeof SplitTextPlugin;
  MotionPath: typeof MotionPathPlugin;
  ScrambleText: typeof ScrambleTextPlugin;
  Flip: typeof FlipPlugin;
  DrawSVG: typeof DrawSVGPlugin;         // 描边绘制（纯确定性）
  EasePack?: true; // core 自带
};
// —— 类型（typed facade，见 §5.4）
export type { Timeline, Tween, gsap as GsapNamespace };
```

- `useTimeline` 是 Recut 对 GSAP + 确定性约束的**首选 hook**（§5.2）。
- `useGSAP`（@gsap/react 官方 hook）原样导出，供需要 context/scope 的高级场景；契约要求其内部 timeline 必须 `paused` 且由 `useFrameContext()` + layout effect seek（§5.3）。
- **插件白名单只含纯确定性的视觉插件**；交互/滚动/随机类（ScrollTrigger、ScrollSmoother、Draggable、Inertia、Observer）一律**不导出**，并在静态扫描中拒绝（§7）。
- 按 D6/D7：`gsap` 与 `@gsap/react` 进入 `runtime-host.ts` 与 prelude（`component-loader.ts` 的 `PRELUDE_SOURCE`），组件 bundle 只出现 `@recut/runtime` 一个裸 import，bundle 不携带 gsap 本体；宿主 chunk 只付一次体积。

### 5.2 `useTimeline(factory, deps?)`

```ts
function useTimeline(
  factory: (tl: gsap.core.Timeline) => void,
  deps?: ReadonlyArray<unknown>,
): gsap.core.Timeline;
```

语义：

1. **构造一次**：挂载/`deps` 变化时 `gsap.timeline({ paused: true, defaults: { ease: "power2.out" } })` → 跑 `factory(tl)` → 注册进实例级 timeline 注册表；`deps` 变化时 `kill()` 旧 Timeline 重建（参数/输入变化 → 动画跟随）。
2. **每帧 seek**：内部 `useLayoutEffect` 读 `FrameTimeContext`，按 `seekMode` 驱动（默认 `time`）：
   - `time`（默认）：`tl.seek(clamp(localTime, 0, tl.duration()))`——时间轴秒数即片段时间轴，短于片段则在末端 hold（符合"落定 hold ≥0.5s"的动效纪律）；
   - `progress`：`tl.progress(progress)`——动画被 clip 的时长整体压缩/拉伸；
   - `loop`：`tl.seek(localTime % tl.duration())`——循环动效。
   - 由 hook 的第三个可选参数或工厂返回对象指定：`useTimeline(factory, deps, { mode: "loop" })`。
3. **清理**：unmount / `deps` 变化时 `tl.kill()`（GSAP 自动还原 inline style），并在销毁时从注册表摘除。
4. **构造纯净校验**：构建期静态扫描保证工厂体内无墙钟/禁插件/非 paused（§7）。

实现要点：`useTimeline` 内部用 `useGSAP`（已 `registerPlugin`）承载生命周期 + `gsap.context()` 的 scope 与 revert；注册表按 world object 实例隔离（同一组件多实例互不干扰），key 由运行时注入。

### 5.3 `useFrameContext()` 与 FrameTimeContext

```ts
interface FrameTime {
  time: number;        // 全局时间（秒）
  localTime: number;   // 片段内时间（秒）——GSAP seek 默认基
  progress: number;    // localTime / duration ∈ [0,1]
}
function useFrameContext(): FrameTime;
```

运行时（`HtmlObject` 的 ReactContent 与 `WorldScene` 的 r3f `<Render/>`）用 `FrameTimeContext.Provider` 包裹组件，值来自当前 `ctx`。收益：

- `useTimeline` 的 seek 不需要作者把 `progress` 传进 hook（无 props 线程）；raw `useGSAP` 场景也可用 `useFrameContext()` 自己写 seek。
- shader uniform / 数字滚动等"想读时间"的内容统一走此 hook，替代散落的 props 解构。

### 5.4 SDK d.ts（typed facade，非全量 gsap 类型）

作者路径构建闸是 `--loose`（不跑 strict tsc，见 2026-08-19 §5），类型是契约不是闸。但 d.ts 仍要自包含、可点按：**手写一份最小 GSAP 类型 facade**（`gsap.to/from/fromTo/timeline/core.Timeline/core.Tween/ease 字符串联合/插件 registerPlugin 签名/useGSAP/useTimeline/useFrameContext`），镜像运行时导出面。不 `export * from "gsap"`（避免引入 node_modules 解析与双版本漂移）。组件源码里 `import type { Timeline } from "@recut/runtime"` 可用。

## 6. 运行时改造点（apps/editor/ui/src/runtime）

| 文件 | 改动 |
|---|---|
| `runtime-host.ts` | 新增 `export { gsap, useGSAP, useTimeline, useFrameContext, plugins }`；模块初始化 `gsap.registerPlugin(useGSAP, ...白名单)` |
| `component-loader.ts`（`PRELUDE_SOURCE`） | 补 `gsap`/`useGSAP`/`useTimeline`/`useFrameContext`/`plugins` 的转发 |
| 新增 `timeline.ts` | `FrameTimeContext`、`useFrameContext`、`useTimeline`（含注册表 + seek 时序） |
| `world-scene.tsx`（`WorldObjectView`） | r3f 分支用 `<FrameTimeContext.Provider value={ctx}>` 包 `<Render {...ctx}/>`；传 `ctx.object.id` 给 provider 供注册表隔离 |
| `components/html-object.tsx`（`ReactContent`） | 用 `<FrameTimeContext.Provider value={ctx}>` 包内层 root 渲染，使 react surface 可用 `useTimeline`/`useFrameContext` |
| `anim.ts` | 保留不动（K5） |
| `package.json`（ui） | 新增依赖 `gsap`、`@gsap/react`（宿主 chunk 一次性打进来；组件 bundle 经 `@recut/runtime` 外部引用） |

Phase 2 优化（§11）：运行时探测组件是否使用了 `useTimeline`（注册表非空），是则把该实例的"时间变化"从 React 重渲降级为"仅 seek"（tree 只随 params 重建）——I2 由运行时兜底，不再依赖作者纪律。

## 7. 构建闸与确定性扫描（apps/editor/scripts/component-build.js）

现状 `staticScan`：拒绝墙钟 token 列表 + 仅允许 `@recut/runtime` import。扩展为（--loose 作者路径同样生效，因为它是"运行安全"闸）：

1. **保留**现有墙钟 token 列表。
2. **新增拒绝 token**（确定性/交互违约）：
   - 自动播放/时钟驱动：`.play(`, `.restart(`, `.resume(`、`paused: false`、`repeat:` + 未暂停、`timeline(` 无 `paused` 字样（策略化：扫描 `gsap.timeline(` 后同表达式无 `paused: true` 即拒绝）；
   - 禁插件：`ScrollTrigger`、`ScrollSmoother`、`Draggable`、`Inertia`、`Observer`；
   - 非种子随机：`gsap.utils.random(` 不带第 4 参数（种子）即拒绝（`Math.random` 已拒绝）。
3. **import 白名单不变**：gsap 只经 `@recut/runtime` 进入，bundle 层面无从绕过。
4. 形状校验：`useTimeline` 的 factory 必须是函数（TS AST 检查）；`surface` 校验不变。
5. harness 不变：smoke（`t ∈ {0,.25,.5,.75,.99}`）+ determinism（同 t 两次像素哈希）原样覆盖 GSAP 组件，作为最终兜底。

> 注：`delay:` 与 `stagger:` 是**确定性的**（只是时间轴内偏移/编排），放行；`repeat` 在 seek 驱动下也确定，放行，但建议优先用 Timeline 段落表达。

## 8. Skill 融合（gsap-skills → 组件创作体系）

gsap-skills 提供 8 个技能；Recut 子 Agent 是"General mode、不看外部技能"的受限会话，**GSAP 知识必须内嵌**。融合分三层：

### 8.1 新 reference：`apps/editor/skills/recut-editor/references/gsap.md`

从 gsap-skills 裁剪 + 增加 Recut 约束的完整参考，章节对齐官方技能：

| 官方技能 | 融合进 gsap.md 的要点 |
|---|---|
| gsap-core | `gsap.to/from/fromTo`、`x/y/rotation/scale/autoAlpha` transform 别名、duration/ease 预设表、`stagger` |
| gsap-timeline | 顺序/`position` 参数（`"+=0.2"`/`"-=0.1"`/`"<"`）、labels、嵌套、**paused + seek 驱动**（Recut 唯一允许的播放方式） |
| gsap-react | `useGSAP`、scope、context 清理；**Recut 偏好 `useTimeline`**；`useFrameContext` seek |
| gsap-utils | `clamp/mapRange/normalize/interpolate/snap/random(带种子)`；确定性筛选 |
| gsap-plugins | 白名单内的 `CustomEase/MorphSVG/SplitText/MotionPath/ScrambleText/Flip/DrawSVG` 用法；明确列出**禁止**清单（ScrollTrigger/ScrollSmoother/ScrollToPlugin/Draggable/Inertia/Observer/Physics 等） |
| gsap-performance | transform 优先、`will-change`、不动 layout 属性 |

头部加硬规则框：**Timeline 必须 paused、只经 seek 驱动；禁 ScrollTrigger/Draggable/Inertia/Observer；禁未种子 random；被动画属性不进 JSX props（I2）；html surface 无 GSAP，改用 react。** 更新 `component-authoring.md` §五（动画章节改为"GSAP 优先 / anim.* 兼容"）与 `motion-graphics.md` §组件实现约束（动画统一走 GSAP Timeline，落定 hold 纪律不变）。

### 8.2 作者契约（background/components.js）

- `COMPONENT_AUTHOR_HEADER` 增加一段浓缩 GSAP 卡片：`import { useTimeline, gsap } from "@recut/runtime"` + 最小 canonical 示例 + 五条铁律（paused、seek-only、无禁插件、被动画属性不入 JSX、html 用 anim.*）。
- `featureFullscreenSkeleton` / `FEATURE_CHIP_SKELETON` 各增一个 GSAP 变体骨架（react surface），作为"想上 GSAP 直接改 skeleton"的起点；脚手架生成器按 brief 关键词（"动画/动效/timeline"）自动选 GSAP 变体。

### 8.3 外部技能（可选）

用户环境（Claude/opencode）可另行安装官方 `greensock/gsap-skills`，帮助**主 Agent** 与用户对话时更懂动画；但**子 Agent 的产出正确性不依赖它**（依赖内嵌 reference）。两者解耦。

## 9. Surface 边界总结

| surface | 动画模型 | 说明 |
|---|---|---|
| `html` | `anim.*`（不变） | 字符串模板无 ref；保持简单。要 GSAP 改 `surface:"react"` |
| `react` | **GSAP `useTimeline`/`useGSAP`（首选）+ `anim.*` 兼容** | ref 目标 = DOM 节点 |
| `r3f` | **GSAP `useTimeline`/`useGSAP`（首选，复用同一模式）** | ref 目标 = `Object3D`；`useFrame` 仍禁 |

三个 surface 共享 `inputs`/`getBaseSize`/`getContentBounds`/错误兜底/验证 harness 不变（D4）。

## 10. 迁移与兼容

- **零强制迁移**：现有组件用 `anim.*` 全部继续可用（`anim` 导出保留）；GSAP 是新增能力。
- 新增能力均为 additive：`gsap`/`useGSAP`/`useTimeline`/`useFrameContext`/`plugins` 加入 `@recut/runtime` 导出面与 prelude。
- 已入库组件无需重新验证；新组件构建走同一管道。
- `ctx.anim` 文档降级为"简单场景/兼容"，reference 的示例逐步以 GSAP 为主。

## 11. 实施路线

| 阶段 | 内容 | 验证 |
|---|---|---|
| P0 依赖与宿主 | ui 加 `gsap`/`@gsap/react` 依赖；`runtime-host.ts` + prelude 导出；`FrameTimeContext`/`useFrameContext`/`useTimeline` 落地；builtin GSAP 示例（react + r3f 各一） | tsc + dev 下预览可拖拽、可 seek、无双实例 |
| P1 契约与知识 | `references/gsap.md` 新文件；`component-authoring.md`/`motion-graphics.md` 更新；`COMPONENT_AUTHOR_HEADER` + 脚手架 GSAP 变体；SDK d.ts typed facade；静态扫描扩展 | 已知好/坏组件各过一遍 harness（smoke + determinism 覆盖 GSAP） |
| P2 优化与收敛 | 运行时"GSAP 组件时间变化不重渲树"（注册表探测）；`seekMode` 全面支持；插件白名单定稿；内置 GSAP 组件进 catalog（motion-graphics route 的 representative 组件先验证） | e2e：AI 创建 GSAP 组件 → verified → 落轨 → preview.frame 与导出逐帧一致 |
| P3 文档同步 | `rfc/README.md`、editor skill 更新、`ARCHITECTURE.md` | tsc + build + e2e |

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| **React/R3F reconcile 覆盖 GSAP 写入**（I2） | 作者规则 + reference 强调 + harness determinism 兜底；Phase 2 运行时让时间变化不重渲树，从机制上消除 |
| **自动播放/时钟驱动破坏确定性**（I3） | 静态扫描拒绝 `.play/.restart/.resume/非 paused timeline`；`useTimeline` 强制 paused |
| **插件面蔓延到交互/随机** | 白名单导出 + 扫描拒绝；ScrollTrigger/Draggable/Inertia/Observer 显式列入禁止 |
| **html 承载面误用 GSAP** | 契约明示 + 构建期 shape 校验（html surface 出现 `useTimeline` 即提示改用 react） |
| **bundle/内存** | gsap 只在宿主 chunk 打一次；Timeline 按实例注册表清理（kill/revert）；destroy 摘除 |
| **seek 时序错帧**（I4） | 依赖 React"子 effect 先于父 effect"顺序（§4.1）；Phase 2 在注册表驱动下显式保证 seek 先于 invalidate/capture |
| **官方技能漂移** | gsap.md 标注来源版本与同步日期；融合内容是自包含快照，不随外部仓库实时变化 |

## 13. 验收标准

1. AI 用 `useTimeline` 写出含"入场 + 呼吸/循环 + 落定 hold"的 react 组件与 r3f 组件，构建一次通过（零类型闸挫败），harness smoke 5 帧全绿。
2. 同 `t` 两次渲染像素哈希相等；Preview 拖动播放头与 Export 逐帧输出一致（含 GSAP 组件叠于视频上）。
3. 含 `.play(`/`ScrollTrigger`/未种子 `random` 的源码在 build 期被确定性扫描拒绝。
4. 子 Agent 仅凭内嵌契约 + gsap.md 产出正确 GSAP 组件（不依赖外部技能安装）。
5. 已入库 `anim.*` 组件行为不变（回归）；`surface:"html"` 组件无 GSAP 能力但可一键改 `"react"` 获得。
6. 同一 GSAP 组件多个时间线实例互不串扰（注册表按实例隔离）。

## 14. 不采纳边界

- **不引入自动播放式动画**：GSAP 一律 `paused` + seek 驱动；不开放 `.play()` 时序（会破坏逐帧一致性）。
- **不开放交互/滚动类插件**（ScrollTrigger/Draggable/Inertia/Observer/ScrollSmoother）：编辑环境无滚动语义、确定性要求禁止。
- **不把 html surface 升级为"隐式 React"**：保持字符串模板 + `anim.*`，要 GSAP 就显式选 `react`。
- **不引入完整 gsap 类型进 SDK**：typed facade 足够作者路径（--loose）与文档；受信内置库路径才有完整 strict 类型。
- **不改变**验证信任阶梯、op 日志、素材库/落轨流程（本文只谈组件动画能力）。