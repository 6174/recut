<!--
 [INPUT]: 依赖 component.create/revise/update 的组件 job、@recut/runtime surface 与 design system brief。
 [OUTPUT]: React/R3F/HTML 组件的图形化创作、参数、确定性动画和验证约束。
 [POS]: motion-graphics 与 hybrid 解释层的实现指南；不决定时间线 placement。
 [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# 自定义组件创作指南（recut.editor）

> 代码即素材。**本文件是"怎么写出好组件"的创作指南**；工具/SDK 契约见 `components.md`。
> 组件 = 项目内的一段可验证代码素材：由 `component.create` 启动同模型受限子 Agent job，子 Agent 以 skeleton 为起点，用唯一 `component.commit` 工具提交源码 → 构建 → 轻量"能跑通"验证 → verified 成为 head，进入素材库。创建本身不产生时间线使用点。

## 一、什么时候用组件，而不是时间线 op

| 需求 | 用 |
|---|---|
| 摆布已有素材（裁剪/位移/变速/淡入） | 时间线 op（`insert`/`trim`/`param`/`keyframe-upsert`） |
| 逐元素独立动画、蒙版、9 种图形 | 时间线 op + 内置 graphic |
| 数据驱动的动态视觉（倒计时、数字滚动、进度条、词条强调） | **组件**（html/react） |
| 3D 对象、shader、粒子、光线感、程序化几何 | **组件**（r3f） |
| 需要随内容重复复用、参数面板驱动的视觉 | **组件** |

规则：**内置能力够用就不写组件**；组件用于时间线 op 表达不了的"代码视觉"。全片最多 1–2 个组件主角，多了读作拼盘。

## 二、选 surface

| surface | 写起来像 | 适合 | 注意 |
|---|---|---|---|
| `html` | 字符串模板 + 内联 style | 纯视觉层、无需交互状态 | 唯一入参是 render 返回的字符串；动画用 `${anim.*}` 内联值（无 DOM ref，禁 GSAP） |
| `react` | JSX 元素树（函数组件形态） | 结构化的卡片/列表/分层视觉 | hook 可用（useState/useMemo/useRef/useTimeline），动画首选 GSAP；**禁墙钟源** |
| `r3f` | R3F 元素树（函数组件形态） | 3D 对象、shader、粒子、光 | v1 禁 `useFrame`；动画首选 GSAP（目标为 Object3D ref）；用 `useFrameContext()` 读时间 |

三个 surface 共享同一契约：`inputs` / `render(ctx)` / `getBaseSize` / `getContentBounds` / `dispose` / 错误兜底 / 验证 harness。先写意图再选 surface，不从 API 反推。

### 图形化实现提示

组件承载的是视频画面，不是编辑器 UI。先确定 concept 的视觉语法，再选择实现：二维字形/关系可以探索 SVG，空间轮廓/2.5D 可以探索 `THREE.Shape` 与 Path，自然文本流或明确的产品界面可以使用 HTML。实现提示服务于 graphics-first，不应反过来成为新的模板约束。

下面的 Card/Cube 示例是验证 API 形状的最小 smoke test，不是视频视觉的推荐风格；实际 brief 仍需交代 viewer job、视觉隐喻和 primitive plan。

## 三、模块形状（default export）

两种形态都被平台接受，选哪种都行（构建期都会做形状校验）：

**形态 A：定义对象**（三个 surface 通用，最规范）

```ts
import { str, num } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default {
  surface: "html",                       // "html" | "react" | "r3f"
  name: "Countdown",
  keywords: ["countdown", "倒计时"],      // 组件库搜索
  inputs: [                              // 参数面板即 inputs
    { key: "color", type: "color", default: "#0ea5e9", label: "主色" },
  ],
  getBaseSize: ({ params }) => ({ width: 512, height: 512 }),  // 可选；缺省 512×512
  // html/react：选择和命中使用此稳定 box；坐标相对上面的 512×512 内容区。
  getContentBounds: () => ({ x: 96, y: 196, width: 320, height: 120 }),
  render(ctx: ComponentRenderContext) {
    const { params, progress, localTime, anim } = ctx;
    // ... 返回 html 字符串 / JSX / R3F 元素树
  },
  dispose(instance) { /* GPU 资源释放（r3f） */ },
};
```

**形态 B：纯函数组件**（react surface 的轻量写法，等价于形态 A）

```tsx
// export default 是一个函数组件；平台自动把它包成定义对象。
// props = ctx 字段（progress/localTime/time/params/anim…）+ 你的 inputs 展开成顶层 props。
function Countdown({ progress, color }: { progress?: number; color?: string }) {
  const n = Math.ceil((1 - (progress ?? 0)) * 5);
  return <div style={{ color: color ?? "#0ea5e9", fontSize: 120, fontWeight: 800 }}>{n}</div>;
}
Countdown.inputs = [{ key: "color", type: "color", default: "#0ea5e9", label: "主色" }];
Countdown.getBaseSize = () => ({ width: 512, height: 512 });
Countdown.getContentBounds = () => ({ x: 0, y: 0, width: 512, height: 512 });
export default Countdown;
```

要点：`inputs` / `getBaseSize` / `getContentBounds` 挂成函数静态属性；`progress`、`localTime`、`params`、`anim` 会作为 props 直接可用，你的 `inputs` 参数名也会作为顶层 props 展开（如上面的 `color`）。不要从 `react` 裸 import（JSX 由内置运行时注入）。

`ComponentRenderContext`：`params`（inputs 传入 + 时间线可覆盖）、`time`（全局秒）、`localTime`（片段内秒）、`progress`（0..1）、`anim`（确定性动画）。

### 组件自己定义交互 box（html/react）

`getContentBounds(ctx)` 返回 `{ x, y, width, height }`，坐标以 `getBaseSize()` 内容区的左上角为 `(0, 0)`，不包含 `capturePadding`。它是内容的单一真相：运行时用它截取纹理，并只叠加时间线 transform 求选择和命中；不再从 alpha 像素或 R3F mesh 反推。逐字动画、移动入场和正倒向 seek 因而得到同一个确定性画面。

优先写覆盖整个动效的**稳定最大范围**：例如卡片入场向上移动 10px，应返回入场和落定状态的并集，而不是跟着 `progress` 每帧缩放。只有确实需要时才依据 `ctx.params` 返回不同尺寸。没有 `getContentBounds` 的历史组件会兼容地使用 alpha 像素扫描，但这是兜底，不是新组件的推荐写法。

## 四、参数设计（inputs = 组件的"可调旋钮"）

好的组件把**会变的**都暴露成参数，把**不变的**写死在源码：

```ts
inputs: [
  { key: "text",    type: "text",    default: "核心数字",   label: "文案" },
  { key: "color",   type: "color",   default: "#0ea5e9",   label: "主色" },
  { key: "size",    type: "number",  default: 120, min: 24, max: 360, step: 4, label: "字号" },
  { key: "accent",  type: "boolean", default: true, label: "强调模式" },
]
```

- 读取用 SDK 的 `num()`/`str()`/`bool()`（带 fallback，容忍时间线缺参）。
- `type` 合法值：`number`/`string`/`boolean`/`color`/`text`/`select`（select 带 `options`）。
- 参数名与时间线 `params` 一一对应，可打关键帧：`keyframe-upsert {ref, path:"params.<key>", atSec, value}`。
- 建 clip 时用 `component.list` 返回的 `inputs[].default` 展开成元素 params。

## 五、动画：GSAP 优先（react/r3f），anim.* 兼容（html）

动画 = 时间轴纯函数，**禁墙钟**（`Math.random`/`Date.now`/`performance.now`/`setTimeout`/`requestAnimationFrame`；CSS `@keyframes`/`transition` 只允许静态样式）。构建期静态扫描拒绝墙钟源。

**react / r3f 用 GSAP（首选）**：`useTimeline` 构造 paused Timeline 一次，运行时把当前帧 t 逐帧 seek 进去（`mode:"time"` 默认）。五条铁律：paused + 只走 seek/progress；被动画属性不进 JSX（经 ref 命令式持有）；禁 ScrollTrigger/Draggable/Inertia/Observer/`gsap.utils.random`；禁 `.play()/.restart()/.resume()`；结构稳定不随帧重建。详细用法见 `gsap.md`。

**html 承载面继续用 `ctx.anim.*`**（无 DOM ref、每帧 innerHTML 重写，GSAP 无从挂载）：要 GSAP 时把 `surface: "html"` 改成 `"react"` 即可。

| anim API | 用途 | 示例 |
|---|---|---|
| `anim.lerp(a, b, u, {ease})` | 数值插值 | `opacity = anim.lerp(0, 1, progress)` |
| `anim.lerpColor(c1, c2, u)` | 颜色过渡 | `anim.lerpColor("#000", color, progress)` |
| `anim.seq([[t,v],...], u)` | 关键帧取值（u 0..1） | 分段的数字/位移 |
| `anim.pulse(u, {speed, phase})` | 0..1 周期脉冲 | 呼吸 scale、闪烁 |

常用动画模式：
- **入场**：`opacity = anim.lerp(0, 1, easeIn(progress))`（`ease` 预设见 SDK）；
- **呼吸**：`scale = 1 + anim.pulse(progress, {speed: 2}) * 0.06`；
- **数字滚动/倒计时**：`Math.ceil((1 - progress) * N)`（纯算术，天然确定）；
- **关键帧分段**：`anim.seq([[0, 0], [0.5, 1], [1, 0]], progress)`。

## 六、设计准则（组件不是 UI 截图）

- **画布感知**：plane 缺省 512×512。放到 1920×1080 画布通常会被放大显示——先按 `getBaseSize` 与目标画面推算有效字高；**1080p 主信息有效字高 ≥56px、辅助 ≥32px**，缩到 480px 宽仍可读才过。
- **一镜一个动作**：组件只做一个主要动效，落定后必须 hold ≥0.5s。
- **字幕无底框**：组件不做气泡/卡片包住叙事字幕；干净高对比文字。
- 组件是"视觉素材"，不是 App UI：不做微型 tag/chip/状态栏堆信息密度。
- 配色由场景决定，不用通用渐变堆砌；保持足够对比度，不替代信息层级。

### 六b. 合成上下文（叠在片子上，不是贴纸）

全屏组件会**叠在已有视频/图像素材之上**，创建时 platforms 已从当前时间线推导 `overMedia` 并注入创建 prompt。规则：

- **背景默认透明**——不要整幅填不透明背景，除非 brief 明确要求。
- **文字/图形对比底片**：无亮度采样时默认深色文字（`#0f172a`）加轻阴影；brief 说底片暗则用浅色文字。
- **视觉旋钮做成 inputs**：`background`（transparent/light/dark）、`textColor`、`accent` 暴露为参数，用户不动源码即可调色。

### 六c. 类型强制（作者路径构建 = 运行安全，但类型是硬契约）

AI 作者路径的构建闸是 **esbuild 可编译 + 形状校验 + 确定性扫描**，strict tsc 不再拦作者源码。正因为模型不再被迫写类型，平台用**脚手架 + 契约**把类型正确性装进起点：创建 prompt 固定注入类型完整骨架（全屏/feature-chip）。作者仍必须遵守：

- `render(ctx)` **必须带类型注解**：`render(ctx: any)` 或 `render(ctx: ComponentRenderContext)`（从 `@recut/runtime` 导入类型）。
- 每个内联箭头/map/for 回调参数**必须显式标注**：`(i: number) => ...`、`(item: string) => ...`。
- 未标注会被平台判定为契约违反（发布路径仍会报类型错误）；受信内置库路径不受 `--loose` 影响，始终 strict。

## 七、三个 surface 的完整示例（可跑）

**html —— 倒计时（纯视觉，无状态）**
```ts
import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";
export default {
  surface: "html", name: "Countdown", keywords: ["countdown", "倒计时"],
  inputs: [{ key: "color", type: "color", default: "#0ea5e9", label: "主色" }],
  render(ctx: ComponentRenderContext) {
    const { params, progress, anim } = ctx;
    const color = str(params.color, "#0ea5e9");
    const n = Math.ceil((1 - progress) * 5);
    const scale = 1 + anim.pulse(progress, { speed: 2 }) * 0.1;
    return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:${color};font-weight:800;font-size:120px;transform:scale(${scale.toFixed(3)});">${n}</div>`;
  },
};
```

**react —— GSAP 入场卡片（函数组件形态，hook 可用；动画用 useTimeline）**
```tsx
import { useRef, useTimeline } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";

export default function Card({ title, color }: { title?: string; color?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  useTimeline((tl) => {
    if (!root.current || !badgeRef.current) return;
    tl.fromTo(root.current, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "power3.out" })
      .fromTo(badgeRef.current, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.35, ease: "back.out(2)" }, "-=0.2");
  }, []);
  return (
    <div ref={root} style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
      <span ref={badgeRef} style={{ background: color ?? "#0ea5e9", color: "#fff", fontWeight: 700, fontSize: 32, padding: "16px 28px", borderRadius: 16 }}>{title ?? "Recut"}</span>
    </div>
  );
}
Card.inputs = [
  { key: "title", type: "text", default: "Recut", label: "文案" },
  { key: "color", type: "color", default: "#0ea5e9", label: "主色" },
];
Card.getBaseSize = () => ({ width: 420, height: 180 });
Card.getContentBounds = () => ({ x: 0, y: 0, width: 420, height: 180 });
```

**r3f —— GSAP 旋转立方体（函数组件形态，目标为 Object3D ref）**
```tsx
import { useRef, useTimeline, THREE } from "@recut/runtime";

export default function Cube({ color }: { color?: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  useTimeline((tl) => {
    if (!mesh.current) return;
    tl.to(mesh.current.rotation, { y: Math.PI * 2, duration: 2, ease: "none" })
      .fromTo(mesh.current.position, { y: -40 }, { y: 0, duration: 0.8, ease: "bounce.out" }, "<")
      .fromTo(mesh.current.scale, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1, duration: 0.5, ease: "back.out(2)" }, 0.1);
  }, []);
  return (
    <mesh ref={mesh} position={[0, 0, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color ?? "#ff2244"} />
    </mesh>
  );
}
Cube.inputs = [{ key: "color", type: "color", default: "#ff2244", label: "主色" }];
Cube.getBaseSize = () => ({ width: 200, height: 200 });
```

**r3f —— 脉冲立方体（3D mesh，禁 useFrame）**
```ts
import { str } from "@recut/runtime";
import type { ComponentRenderContext } from "@recut/runtime";
export default {
  surface: "r3f", name: "Pulse Cube", keywords: ["3d", "cube", "立方体"],
  inputs: [{ key: "color", type: "color", default: "#ff2244", label: "主色" }],
  getBaseSize: () => ({ width: 200, height: 200 }),
  render(ctx: ComponentRenderContext) {
    const { params, anim, progress } = ctx;
    const color = str(params.color, "#ff2244");
    const s = 100 + anim.pulse(progress, { speed: 2 }) * 40;
    return <mesh rotation={[0.5 * progress, 0.5 * progress, 0]} scale={[s, s, s]} position={[0, 0, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>;
  },
};
```

## 八、验证闭环与迭代

```text
component.create / component.revise → job.status:"queued"|"running"|"completed"|"interrupted"|"failed"|"cancelled"
→ 轻量 component.verify(versionId, report.mode:"headless-code")
   ok → verified → head 更新，进入素材库（media）
   坏 → failed → head 保持旧版本 → 读 component.source 修复 → 重新 create/revise
```

- 构建失败读 `buildError`（shape/determinism 拒绝清单；作者路径已放开 strict tsc，若仍报类型错=违反类型契约）修源码，**不要整段重写**。
- 每次只改目标组件的一个问题；改完重新 create/revise，直到报告全绿。
- 项目删则组件清理；素材库可归档组件，已有时间线引用保持可解析；head 语义让修复自动生效。
- **job 观察**：`recut.job.status/wait/cancel/logs` 统一控制 sub-agent/shell/media job。`wait` 是短窗口轮询（单次 ≤15s），超时返回当前状态继续轮；`cancel` 会传播到子 CLI，已提交的部分结果仍会被 finalize 并以 `interrupted` 终态 + 部分结果返回。
- **业务错误是结果不是崩溃**：作者创建/修订期的可预期失败（如无 verified head 可改）由后台走结构化信封，MCP 消费方看到 `{ok:false, kind, code, message, hint}` 而不是 JSON-RPC 错误；按 `code`/`hint` 修，别当工具崩溃重试。

## 九、常见坑

- **双 React**：只 `import ... from "@recut/runtime"`；绝不裸 `import React` / `from "react"` / `from "three"`（会解析到不同实例）。`jsx` 由 `jsxImportSource` 自动注入。
- **GSAP 目标失效**：结构不能随帧重建（无依赖 key 的重挂载）；被动画属性不进 JSX（否则 reconcile 覆盖写入）；`useTimeline` 只在函数组件形态里调用（定义对象形态的 render 需包内部组件）。
- **墙钟源**：`Math.random`/`Date.now`/`setTimeout`/`requestAnimationFrame`/`gsap.utils.random` 会被构建期扫描拒绝；随机需要固定种子（从 `object.id`/`componentId` 派生）。
- **texture/尺寸**：不设 `getBaseSize` 时承载面为 512×512，字号/布局按此推算；html/react 应用稳定 `getContentBounds` 截取纹理，绝不依赖某一帧的 alpha 裁切画面。选择/命中使用同一 box 加画布 transform。`useCanvasTexture` 的 draw 必须是纯绘制（依赖 `params`，不依赖墙钟）。
- **交互边界**：html/react 应声明 `getContentBounds`。它用内容区设计坐标定义稳定选择框，不能靠某一帧 alpha 像素决定画面或交互；未声明时才使用旧的像素扫描兜底。
- **perf**：组件每帧重渲（Phase 2 将把 GSAP 组件的树重渲降级为仅 seek）；避免每帧新建大对象/纹理，重活走 `useMemo`/`useCanvasTexture`。
- **类型**：`render` 返回按 surface 放宽；`inputs.default` 必须可 JSON 且可打关键帧（number/string/boolean）。`useRef<THREE.Mesh>(null)` 这类泛型注解在 strict 路径下必须给出（作者路径是 --loose 不拦）。

## 十、与时间线的配合

```text
timeline.command {
  type: "insert",
  payload: { element: {
    type: "component", componentId: "<component.list 的 id>",
    startSec, durationSec,
    params: { <component.list 的 inputs default 展开> }
  } }
}
# 组件参数可打关键帧：keyframe-upsert { ref, path:"params.<key>", atSec, value }
# 验证：timeline.validate 的 component-def 校验 componentId 已 define
```
