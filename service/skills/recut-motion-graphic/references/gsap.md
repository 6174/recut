<!--
  [INPUT]: 依赖 @recut/runtime 的 GSAP 导出面（gsap/useGSAP/useTimeline/useFrameContext/plugins）
           与 greensock/gsap-skills 官方全量技能（gsap-core / gsap-timeline / gsap-react / gsap-utils /
           gsap-plugins / gsap-performance，MIT，Webflow 收购后含 SplitText/MorphSVG 在内全部插件免费）。
  [OUTPUT]: 组件动画的 GSAP 完整参考（Recut 确定性裁剪版）：core/timeline/react/utils/plugins/performance
           的官方要点全量纳入，标注 Recut 禁用项；useTimeline/useGSAP 模式、白名单插件、常见动效模板。
  [POS]: recut-editor 的组件动画参考；与作者契约内嵌卡片同源。子 Agent 不读外部技能，本文件是自包含快照。
  [PROTOCOL]: 变更时更新此头部，然后检查 README.md
  -->

# 组件动画：GSAP（确定性裁剪版）

GSAP 是 react/r3f 承载面**首选**的动画引擎（html 承载面无 DOM ref，继续用 `ctx.anim.*`）。核心心智：**Timeline 构造一次（确定性），运行时把当前帧 t 逐帧 seek 进去**——动画状态 = 时间轴的纯函数，Preview 与 Export 逐帧一致。

```ts
import { gsap, useGSAP, useTimeline, useFrameContext, plugins } from "@recut/runtime";
```

> 本文是 greensock/gsap-skills（MIT）的完整裁剪快照（同步 2026-08-20）。官方技能更新不自动回流；需要时人工核对后再合并。Recut 裁剪的唯一原则：**动画必须能被 seek 驱动且确定性**——凡是"自动播放时序 / 滚动 / 指针交互 / 随机"的能力一律禁用。

## 一、五条铁律（违反 = 构建期拒绝或画面不可信）

| # | 规则 | 为什么 |
|---|---|---|
| 1 | Timeline 必须 `paused: true`，只经 `progress()` / `seek()` 驱动 | 自动播放走 rAF 时钟 → 墙钟违规，预览与导出错帧 |
| 2 | 被动画的属性**不进 JSX props**，经 ref 由 GSAP 命令式持有 | 每帧 React/R3F reconcile 会用 props 覆盖 GSAP 的写入 |
| 3 | 禁交互/滚动/随机类能力：ScrollTrigger、ScrollSmoother、ScrollToPlugin、Draggable、Inertia、Observer、`gsap.utils.random`（含字符串 `"random(...)"` 形式） | 位置/指针/随机都非确定性 |
| 4 | 禁 `.play()` / `.restart()` / `.resume()`（构建扫描拒绝） | 时序驱动破坏 seek 语义 |
| 5 | 结构（DOM 树 / R3F 树）稳定，不随帧重建（无依赖 key 的重挂载） | 重建会让 GSAP 目标失效 |

## 二、core：单 tween

**tween 方法**（全部属性用 camelCase，如 `backgroundColor`/`rotationX`/`scaleY`）：

- `gsap.to(targets, vars)` — 从当前状态到 `vars`（最常用）
- `gsap.from(targets, vars)` — 从 `vars` 到当前状态（入场）——会立即应用起始态（`immediateRender: true` 默认）
- `gsap.fromTo(targets, fromVars, toVars)` — 显式起止，不读当前值（**推荐**：反向 seek 时落定态可还原）
- `gsap.set(targets, vars)` — 立即应用（duration 0）

**常用 vars**：`duration`（默认 0.5s）、`delay`、`ease`、`stagger`、`repeat`/`yoyo`、`onComplete/onStart/onUpdate`、`immediateRender`、`overwrite`。多个 `from/fromTo` 打同一属性时，后者设 `immediateRender: false`，否则首帧会互相覆盖。

**transform 别名（比原始 transform 字符串更优：顺序一致、更性能、跨浏览器稳定）**：

| GSAP 属性 | 对应 | 说明 |
|---|---|---|
| `x` `y` `z` | translateX/Y/Z | 默认单位 px |
| `xPercent` `yPercent` | translateX/Y 百分比 | 百分比移动，SVG 也适用 |
| `scale` `scaleX` `scaleY` | scale | `scale` 同时设 X/Y |
| `rotation` `rotationX` `rotationY` | rotate（默认 deg，可 `"1.25rad"`） | rotationZ = rotation |
| `skewX` `skewY` | skew | deg 或 rad 字符串 |
| `transformOrigin` | transform-origin | 如 `"left top"`、`"50% 50%"` |
| `autoAlpha` | opacity + visibility | **fade 用 autoAlpha 而非 opacity**：0 时同时 `visibility:hidden`（不可见且不挡指针） |
| `svgOrigin` | SVG 全局坐标系原点 | 多个 SVG 元素绕公共点旋转/缩放时用 |
| `clearProps` | 完成后清除 inline style | 如 `"visibility"`、`"all"`；清任何 transform 属性会清整条 transform |

相对值：`x: "+=20"`、`rotation: "-=30"`、`"*=2"`、`"/=2"`。方向性旋转：`rotation: "-170_short"`（最短路径）、`rotationX: "+=30_cw"`。CSS 变量可动画：`"--hue": 180`。SVG 上 `svgOrigin` 与 `transformOrigin` 二选一。

**缓动表（推荐字符串 ease）**：

```
"none"                       线性
"power1" "power1.in" "power1.out" "power1.inOut"  越渐进
"power2" "power2.in" "power2.out" "power2.inOut"
"power3" "power3.in" "power3.out" "power3.inOut"
"power4" "power4.in" "power4.out" "power4.inOut"  越陡
"back"   "back.in" "back.out" "back.inOut"        回弹过冲（back.out(1.7)）
"bounce" "bounce.in" "bounce.out" "bounce.inOut"
"circ"   "circ.in" "circ.out" "circ.inOut"
"elastic" "elastic.in" "elastic.out" "elastic.inOut" 如 elastic.out(1, 0.3)
"expo"   "expo.in" "expo.out" "expo.inOut"
"sine"   "sine.in" "sine.out" "sine.inOut"
```

默认 ease 是 `"power1.out"`（`useTimeline` 内部默认 `power2.out`）。自定义缓动用白名单里的 `CustomEase.create("name", ".17,.67,.83,.67")` 或 SVG path 形式 `"M0,0 C0.1,0.8 0.2,1 1,1"`。

**函数值 / stagger**：vars 里的值可以是函数，每个 target 调用一次（`(i, target, targetsArray) => ...`）。stagger 支持数字（`stagger: 0.1`）或对象（`{ amount: 0.3, from: "center" }`、`{ each: 0.08, from: "start" }`）。

## 三、timeline：编排（Recut 的主要表达）

```ts
const tl = gsap.timeline({ paused: true, defaults: { duration: 0.5, ease: "power2.out" } });
tl.to(a, { x: 100 })                       // 默认追加（顺序）
  .to(b, { y: 50 }, "+=0.2")               // 上一段结束后 0.2s
  .to(c, { opacity: 0 }, "-=0.1")          // 上一段结束前 0.1s（重叠）
  .to(d, { x: 40 }, "<")                   // 与上一段同时开始
  .to(e, { scale: 1.2 }, "<0.2")           // 上一段开始后 0.2s
  .to(f, { x: 10 }, 1);                    // 绝对时间 1s
```

- **position 参数**（第三个参数）：绝对秒数 `1`、相对 `"+=0.5"`/`"-=0.2"`、标签 `"labelName"`/`"labelName+=0.3"`、占位 `<`（同上一个开始）/`>`（同上一个结束，默认）。
- **defaults**：timeline 构造时传，子 tween 全继承（duration/ease）。
- **labels**：`tl.addLabel("intro", 0)`、`tl.addLabel("outro", "+=0.5")`、`tl.to(x, vars, "intro")`——可读、可维护的编排。
- **嵌套**：`master.add(childTimeline, 0)`，子 timeline 可独立编排。
- **驱动**：Recut 只允许 `tl.progress(p)` / `tl.seek(t)`（见 useTimeline）；timeline 的 duration 由子 tween 决定，不是构造参数。
- **不要用 `delay` 串动画**——用 timeline 的 position 参数。

**useTimeline（Recut 首选）**：

```ts
useTimeline((tl) => {
  if (!root.current) return;
  tl.fromTo(root.current, { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out" })
    .fromTo(badge.current, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.35, ease: "back.out(2)" }, "-=0.2");
}, []);   // deps 变化 → kill 重建（参数/输入变化时动画跟随）

useTimeline(factory, deps, { mode: "time" });      // 默认：tl.seek(localTime)，时间轴秒数即片段时长，短于片段末端 hold
useTimeline(factory, deps, { mode: "progress" });  // tl.progress(progress)，动画整体压缩/拉伸到 clip 时长
useTimeline(factory, deps, { mode: "loop" });      // tl.seek(localTime % duration)，循环动效（仅氛围元素）
```

- 只能在 react/r3f 承载面的**函数组件形态**（`export default function`）或内部组件里调用（hook 需要 React 组件上下文）。定义对象形态的 `render(ctx)` 要 hook 就包一个内部组件。
- 每帧 seek 由 hook 自动完成（内部读 `FrameTimeContext`），顺序保证在纹理捕获 / R3F 绘制之前。

## 四、react：useGSAP 与 refs

首选 `useTimeline`；需要 scope/context 时用官方 `useGSAP`（已注册）：

```tsx
import { useGSAP, gsap } from "@recut/runtime";

const container = useRef<HTMLDivElement>(null);
useGSAP(() => {
  gsap.to(boxRef.current, { x: 100, duration: 0.6, ease: "power2" });
  gsap.from(".item", { autoAlpha: 0, y: 20, stagger: 0.1 });  // scope 限制选择器范围
}, { scope: container });
```

- **target 用 ref，不用裸选择器**：选择器无 scope 可能匹配到组件外的元素；有 scope 时才可用类选择器。
- **useGSAP 自动清理**（unmount / deps 变化 revert）；回调里返回 cleanup 函数可追加清理。
- 配置对象：`{ dependencies, scope, revertOnUpdate }`；`revertOnUpdate: true` 时 deps 变化会 revert 再重跑。
- **Recut 强制**：useGSAP 里创建的 timeline 必须 `paused: true`，并用 `useFrameContext()` + layout effect 手动 seek（`useTimeline` 已封装这一步）。
- 不要在 render 时调用 GSAP（会报错/泄漏）；setup 只在 mount/deps 变化时跑。

## 五、utils：确定性工具（不含 random）

`gsap.utils.*` 纯函数、无需注册。**省略最后一个参数返回可复用函数**（除 random）。`random` 在 Recut 禁用。

| 工具 | 用途 | 示例 |
|---|---|---|
| `clamp(min, max, v?)` | 约束范围 | `clamp(0, 100, 150) // 100` |
| `mapRange(inMin, inMax, outMin, outMax, v?)` | 区间映射（progress→角度等） | `mapRange(0, 1, 0, 360, 0.5) // 180` |
| `normalize(min, max, v?)` | 归一到 0..1 | `normalize(0, 100, 50) // 0.5` |
| `interpolate(a, b, p?)` | 数字/颜色/对象插值 | `interpolate("#f00", "#00f", 0.5)` |
| `snap(step_or_array, v?)` | 吸附到网格/允许值 | `snap(10, 23) // 20`；tween 内 `snap: { x: 20 }` |
| `pipe(...fns)` | 函数组合 | 归一 → 吸附链式处理 |
| `wrap(min, max, v?)` | 循环包裹 | `wrap(0, 360, 370) // 10` |
| `wrapYoyo(min, max, v?)` | 往返包裹 | `wrapYoyo(0, 100, 150) // 50` |
| `selector(scope)` | 限定作用域的选择器 | 组件内 `".box"` 只匹配子树 |
| `toArray(value, scope?)` | 转真数组 | 选择器/NodeList/单元素 |
| `distribute(config)` | 按位置分布值（stagger 底层） | 从中心扩散 scale/opacity |
| `splitColor(color, hsl?)` | 颜色拆 RGB/HSL | 构建渐变/颜色分量动画 |
| `getUnit(v)` / `unitize(v, unit)` | 单位解析/附加 | `getUnit("100px") // "px"` |

**tween 内的函数值**：`gsap.to(".x", { x: (i) => i * 50, stagger: 0.1 })`。

## 六、plugins：白名单与禁用清单

所有插件免费（含 SplitText/MorphSVG，Webflow 收购后无需 Club/密钥），`npm install gsap` 即含全部。宿主已注册白名单插件；组件内直接用 `plugins` 或 `SplitText` 等命名导出。

**白名单（确定性视觉插件，`plugins` 导出，宿主已注册）**：

- **CustomEase** — 自定义缓动：`CustomEase.create("my", ".17,.67,.83,.67")` 或 SVG path 数据。
- **SplitText** — 拆字逐单位动画（标题/引语最爱）：`SplitText.create(".heading", { type: "words, chars" })` → `gsap.from(split.chars, { opacity: 0, y: 20, stagger: 0.03 })`。只用被动画的单位（如 `"words, chars"`）；自定义字体加载后或 `autoSplit` 再拆；`mask` 做逐字遮罩。结束记得 `split.revert()`（useTimeline 的 deps 变化/kill 会随 context 清理）。
- **MorphSVGPlugin** — 形状形变：`gsap.to("#diamond", { morphSVG: "#lightning", ease: "power2.inOut" })`；原始图形先 `MorphSVGPlugin.convertToPath("circle, rect, ...")`；扭曲用 `shapeIndex`。
- **MotionPathPlugin** — 沿路径运动：`gsap.to(".dot", { motionPath: { path: "#path", align: "#path", alignOrigin: [0.5, 0.5] } })`；`autoRotate` 沿切线转向。路径数据字符串可作为 path（确定性）。
- **ScrambleTextPlugin** — 文字乱码/解密切换：`gsap.to(".text", { scrambleText: { text: "New message", chars: "01", revealDelay: 0.5 } })`（chars 固定字符集 → 确定性）。
- **Flip** — 布局状态切换（FLIP）：`Flip.getState(".item")` → 改 DOM/类 → `Flip.from(state, { duration: 0.5 })`。只在结构/参数变化（deps）时用，不在每帧。
- **DrawSVGPlugin** — 描边绘制（确定性，SVG 线条动画）：`gsap.fromTo("#path", { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 1 })`；需要 `stroke` + `stroke-width` 可见。

**禁用（构建扫描拒绝 import，宿主也不导出）**：ScrollTrigger、ScrollSmoother、ScrollToPlugin、Draggable、InertiaPlugin、Observer、Physics2D、PhysicsProps、Pixi、GSDevTools（开发工具不可入片）、EasePack 的 RoughEase/随机类。`random` 及字符串 `"random(...)"` 一律禁止（确定性随机用固定种子从 `object.id` 推导或纯算术）。

## 七、performance：只动 transform/opacity

- 只动 `x/y/scale/rotation/opacity`（合成器处理）；**不动** `width/height/top/left/margin/padding`（触发 layout）。移动用 `x/y` 而非 `left/top`。
- 列表用 **stagger**，不要逐条手动 delay；不要每帧新建 timeline（useTimeline 构造一次）。
- 需要 `will-change` 的元素才加 `will-change: transform`（别全加）。
- 大量同时动画时化整为序（timeline 编排）；离屏/未播放组件不做事后清理依赖（useTimeline 自动 kill）。
- 每帧高频更新（如跟随指针）用 `gsap.quickTo()`——但 Recut 组件无指针事件，主要不适用；若需跟随"参数关键帧"，用 deps 重建 timeline 而非 quickTo。

## 八、Recut 专属约束与常见动效模板

### 禁项速查（构建期静态扫描会拒绝）

`Math.random`、`Date.now`、`performance.now`、`new Date(`、`setTimeout(`、`setInterval(`、`requestAnimationFrame`、`crypto.random`、`.play(`、`.restart(`、`.resume(`、`paused: false`、`ScrollTrigger`、`ScrollSmoother`、`ScrollToPlugin`、`Draggable`、`InertiaPlugin`、`Observer`、`gsap.utils.random`、`"random(`、未 paused 的 `gsap.timeline(`、html surface 里的 `useTimeline/useGSAP/gsap.`。

### 常用模板

```ts
// 入场（fromTo，落定态可还原）
tl.fromTo(el, { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out" });

// 编排 + 重叠
tl.to(a, { x: 100, duration: 0.5 }).to(b, { y: 50 }, "+=0.2").to(c, { opacity: 0 }, "-=0.1");

// 呼吸（mode:"loop"）
tl.to(el, { scale: 1.06, duration: 0.5, ease: "sine.inOut" }).to(el, { scale: 1, duration: 0.5, ease: "sine.inOut" });

// 列表逐个进场
tl.fromTo(items, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.08, ease: "power2.out" });

// 数字滚动（纯算术，天然确定）
const n = Math.ceil((1 - progress) * 5);

// 文字拆字（SplitText）
const split = SplitText.create(titleRef.current, { type: "words, chars" });
tl.from(split.chars, { opacity: 0, y: 20, stagger: 0.03, duration: 0.4 }, 0.1);

// SVG 描边（DrawSVG）
tl.fromTo(pathRef.current, { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 1.2, ease: "power1.inOut" });

// 强调色/文字色：直接用 params（不需要 GSAP 插值颜色）
const color = str(params.textColor, "#0f172a");
```

### 数字/颜色/文本：优先 params 计算而非 GSAP 插值

被动画的**数值/文案/颜色**若依赖 `params`（可被时间线关键帧驱动），在 render 里用 `str()/num()/bool()` 直接算并写进 JSX（这些是"内容"，每次渲染都该是当前值）；GSAP 只负责**位移/透明度/缩放/旋转**这类纯视觉插值。若想动画颜色渐变，用 `gsap.utils.interpolate("#f00","#00f",p)` 或 `tl.to(el, { color: "#00f" })`（GSAP 原生插颜色，确定性）。

## 九、验证

harness 自动覆盖 GSAP 组件：smoke（`t ∈ {0,.25,.5,.75,.99}` 逐帧无 throw）+ determinism（同 t 渲染两次像素哈希相等）。渲染不出去（目标 ref 未挂载/动画空转）会被 smoke 或封面 harness 抓到。落轨后以 `preview.frame` 的 settled frame 判定，不把中间动画帧当破版。