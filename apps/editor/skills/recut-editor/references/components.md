# AI 临时组件（Temp Components）

> 代码即项目内临时素材。时间线 clip `type:"component"` + `componentId`；运行时解析到**最新 verified head**。失败永不渲染，head 保持旧版本。项目作用域，删项目即清理。

## 作者分级 surface

| surface | 承载 | 典型用法 |
|---|---|---|
| `html` | 离屏 DOM → HtmlTexture plane | 模板字符串 + 内联 style |
| `react` | JSX 元素树 | hook 可用，用 `ctx.anim.*` 动画 |
| `r3f` | R3F 元素树（3D/shader） | mesh/material/light |

三个 surface 共享同一契约：`inputs`（参数面板即 inputs）、`render(ctx)`、`getBaseSize`、`getContentBounds`、`dispose`、错误兜底、验证 harness。

对于 `html` / `react`，`getBaseSize` 定义离屏内容区的设计尺寸（未声明时为 512×512）。已声明 `getContentBounds` 时，画面纹理截取、选择和命中**都只使用这个稳定 box**；绝不以某一帧的 alpha 像素裁切 UV——逐字出现、位移入场和倒放因此完全一致。未声明边界的旧组件才保留完整透明纹理与 alpha 扫描兼容路径。

作者应声明 `getContentBounds(ctx)` 作为稳定内容 box；坐标原点为 `getBaseSize()` 内容区左上角，返回 `{ x, y, width, height }`，**不包含** `capturePadding`。运行时先用此 box 截取纹理，再只叠加同一份时间线 transform 计算选择框。box 应覆盖整个动画周期的最大 footprint，宁可略大也不要随字符或脉冲每帧跳动。未声明的旧组件才回退到 alpha 像素扫描。

```ts
getBaseSize: () => ({ width: 720, height: 720 }),
// 中央卡片的稳定选择区；阴影/入场可由 capturePadding 留出画面空间。
getContentBounds: () => ({ x: 10, y: 90, width: 700, height: 540 }),
```

## SDK：`@recut/runtime`

组件**唯一允许的外部 import**（经 import map 解析到宿主共享实例，永远单 React）。导出面：

```ts
// JSX 自动运行时（jsxImportSource 指向本模块，无需 import React）
export { jsx, jsxs, Fragment }                 // 亦为 /jsx-runtime 子路径
export { useState, useMemo, useRef, useCallback, useEffect }
export * as THREE from "three"
export { useThree }                            // R3F 只读 hook（v1 禁 useFrame）
export { useCanvasTexture }
export { num, str, bool }                      // 参数读取
export const anim: {                           // 确定性动画 t→值
  lerp(a, b, u, { ease? }): number
  lerpColor(c1, c2, u): string
  seq(keys: [number, number][], u): number
  pulse(u, { speed?, phase? }): number
}
export type { ComponentRenderContext, ContentBounds, ParamValues, ParamDefinition }
```

**硬规则：动画是 `t` 的纯函数，禁止墙钟。** CSS `@keyframes`/`transition` 只允许静态样式；一律用 `ctx.anim.*` 内联值。构建期静态扫描拒绝 `Math.random` / `Date.now` / `performance.now` / `setTimeout` / `requestAnimationFrame`。

```ts
interface ComponentRenderContext {
  world; object; params; time; localTime; progress; anim;
}
```

## 工具

| op | 说明 |
|---|---|
| `component.create` | **创建组件素材的唯一入口（异步 job）。** 输入 `{items:[{nameHint,brief,mode?,role?,template?}], references?, design?}`；构建 + 轻量验证后发布为 verified 素材，并自动创建 `type:"component"` asset 引用。job 完成结果返回 `assetIds[]` 和 `components[]`，每项含 `{assetId,componentId,versionId,status,mode}`；AI 将 `assetId` 传给 `timeline.placeComponents`，`componentId` 只用于修订/读源码。 |
| `component.revise` | 已有组件的调整/Bug 修复入口。输入 `{componentId,instruction}`；平台固定当前 verified head，启动同模型受限子 Agent 生成新版本，构建 + 轻量验证后成为新 head。失败保留旧 head，绝不写时间线。 |
| `component.list` | 项目内组件数据 + head 状态 + `inputs` + `mode` + `assetId`；素材发现优先 `asset.list`。 |
| `component.source` | 读组件源码（当前 verified head 或指定版本）。主 Agent 可读，作为审查/修改的输入。 |
| `component.update` | 主 Agent 直接提交组件源码新版本（绕过受限子 Agent）。传入 `componentId` + 完整 `source`；基于当前 verified head 开新版本，构建 + 轻量验证后成为新 verified head，进素材库；不落轨。 |
| `component.archive` | 从素材库隐藏组件但保留版本和已有时间线引用；不删除时间线元素。 |

通过 `component.create`/`component.revise` 创建或修改组件，再用 `recut.job.*` 获取进度、错误和取消状态；读源码用 `component.source`，需要明确修订时用 `component.update`。组件完成验证后才能落到时间线。

## 组件形态（mode）

- `mode: "fullscreen"`：**铺满整张画布**的组件（如全屏背景、全屏标题动画）。平台向受限子 Agent 注入当前画布宽高（缺省 1920×1080），要求 `getBaseSize` 对齐画布并铺满 edge-to-edge。适合需要按成片尺寸设计的视觉。
- `mode: "local"`（缺省）：**画布局部装饰件**（chip/badge/pill/角标），按自身设计尺寸，可移动/缩放在画布任意位置。
- 创建时由主 Agent 判断用户意图：全屏背景/整屏动画用 `fullscreen`；局部提示/装饰用 `local`（或省略）。

## 创建语义（模板 = skeleton，不是直发成品）

- 所有组件创建都走 `component.create`，一律由受限子 Agent 完成；**不再有“简单用 create / 复杂用 author”的二分**。
- `template` / `role` 只用于**选 skeleton**：子 Agent 拿到一个高质量骨架源码作为起点（如 `feature-chip`、全屏 `feature-title` 骨架），
  基于它改写/扩展成目标组件，再通过唯一的 `component.commit` 工具交付。模板不是拿来直接发布的成品。
- 验证是**轻量“能构建、能跑”**检查（作者路径构建闸 = esbuild 可编译 + 形状校验 + 确定性扫描，strict tsc 放开为类型契约）；视觉质量由人来判断。封面可选。
- 错误是结构化信封：可预期失败返回 `{ok:false, kind, code, message, hint}`，按 `code` 处理，不当作工具崩溃重试。

## 放置到时间线

创建组件默认只进入**素材库**（media tab，与图片/视频/音频同列），绝不因此调用时间线工具。只有用户明确说“放到视频中 / 第 N 秒放置”才调用一次 `timeline.placeComponents`：

```text
timeline.placeComponents {
  baseVersion,
  items: [
    { assetId: "<component.create job result.components[0].assetId>", startSec, durationSec, params: { <inputs defaults 展开> } }
  ]
}
```

它原子写入整组元素：同一时间段的 graphic 组件自动放到不同轨，非重叠元素复用轨。禁止为一组组件逐条调用 `timeline.command insert`。

## 验证闭环

`component.create` 异步 job 完成验证后成为素材库中的 verified 组件。组件创建不会自动改变时间线；确定入片时，再用 `timeline.placeComponents` 放置。

## 常用 inputs 约定

```ts
type ParamDefinition = { key: string; label?: string; type?: "number"|"string"|"boolean"|"color"; default: number|string|boolean; min?; max?; step? };
```
