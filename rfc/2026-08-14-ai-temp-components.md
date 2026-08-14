<!--
 * [INPUT]: 依赖 apps/editor runtime（ComponentDefinition / componentsRegistry / buildWorld / WorldScene / dom-text-surface HtmlInCanvas）、
 *          @recut/runtime 共享实例、esbuild 编译管线、Playwright/Chromium 验证基建（rfc/2026-08-14-editor-data-model-selection.md Phase G）
 * [OUTPUT]: 定义 AI 临时组件（Temp Components）机制：surface 作者分级、不可变版本数据模型、动态加载与共享实例、
 *           安全边界、验证闭环、MCP/API 契约与分阶段实施路线
 * [POS]: rfc 的架构设计蓝图；获批实现后作为 apps/editor AI 组件管线、加载器与验证 harness 的共同契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: AI 临时组件（Temp Components）—— 代码即临时素材

- 状态：提议
- 作者：Recut
- 日期：2026-08-14
- 决策范围：AI 组件数据模型、作者分级（surface）、动态加载与共享实例、安全边界、验证闭环、MCP/API 契约
- 关联：`rfc/2026-08-13-visual-runtime-component-system.md`（Phase 3/4 落地）、`rfc/2026-08-14-editor-data-model-selection.md`（验证基建复用）

## 1. 背景与目标

剪辑 AI 化的核心瓶颈是：**AI 无法创作新的"视觉素材"，只能摆布已有媒体**。要让 AI 创作，需要让"代码"成为可落时间线的素材。

本文档定义 **AI 临时组件（Temp Component）** 机制：AI 用代码（HTML / 单文件 React / R3F）定义一个组件，作为**项目内临时素材**落到时间线。它是 visual-runtime RFC Phase 3/4（UGC 动态加载 + AI 生成）的落地，但按产品决策收敛为**临时素材优先**：

- 用户视角：AI 组件就是时间线上的一个普通 clip，**没有素材库、没有版本管理**。
- 内部：项目作用域，逻辑组件 + 不可变版本；时间线钉逻辑 id，运行时解析到**最新已验证版本**。
- 作者难度拉开：`surface: "html" | "react" | "r3f"` 三级，大多数用前两级；平台提供 `anim` 工具把 `t` 转成动画。

## 2. 核心心智模型（已确认）

> **AI 组件 = 项目内的一段可验证代码素材。时间线钉逻辑 id，运行时解析到最新已验证 head。**
> 迭代产生不可变版本；验证失败永不渲染；head 语义让修复自动生效。

```text
用户时间线 clip (type:"component", componentId="ai-glass")
        ↓ resolve（运行时，head 跟随）
editor_components[ai-glass]             —— 逻辑组件（项目作用域）
  ├── surface: "html"
  ├── inputs: ParamDefinition[]         —— 参数面板即 inputs
  └── head → editor_component_versions[ai-glass@3]（最新 verified）
```

**决策记录：**

| # | 决策 |
|---|---|
| D1 | **head 跟随**：`componentId → 最新已验证版本`。AI 修复 → 新版本 → 重验证通过 → 自动成为 head，所有使用点立即生效；失败则 head 保持旧版本，坏代码永不渲染。项目内无外部用户引用旧版本，无需钉版本 |
| D2 | **临时性**：组件随项目存亡，删除项目即清理。将来做"持久复用"是把某 verified 版本**提升**为平台 asset，不改造本机制 |
| D3 | **同一版本共同持有 source + bundle + bundle_hash**：source 是 AI 可读可改的权威输入（`component.source` 喂给二次调整）；bundle 是 define 时一次性编译的产物（运行时直接 import，加载不需要编译器）；bundle_hash 内容寻址缓存。不变式：**bundle 永远是该版本 source 的编译产物，testReport 描述的就是这个 bundle**（验证的与被渲染的是同一物） |
| D4 | **作者分级 surface**：`html / react / r3f` 三级，同一契约（inputs / getBaseSize / dispose / 错误兜底 / 验证 harness），仅承载面不同 |
| D5 | **动画 = t 的纯函数，禁墙钟**：`ctx.anim.*` 确定性工具，CSS `@keyframes`/`transition` 只允许静态样式 |
| D6 | **单虚拟模块 `@recut/runtime`** 是组件唯一允许的外部 import，经 import map 解析到宿主共享实例，**永远单 React 实例** |
| D7 | **托管白名单 SDK + 服务端构建工具链**：`@recut/runtime` 是组件唯一外部依赖（§4.2 导出面）；编译 + 类型检查 + 墙钟扫描全在服务端 `component.define`/`component.verify` 完成，AI 不安装任何东西、不本地跑 build，只按 SDK 文档写源码 |

## 3. 数据模型

项目作用域（editor sqlite，与 `editor_projects` 同库）：

```sql
create table if not exists editor_components (
  component_id    text not null primary key,   -- "ai-glass"
  project_id      text not null,
  name            text not null,
  surface         text not null,               -- html | react | r3f
  keywords_json   text not null default '[]',
  head_version_id text,                        -- 最新 verified 版本指针（D1）
  created_at      text not null,
  updated_at      text not null
);

create table if not exists editor_component_versions (
  version_id      text not null primary key,   -- "ai-glass@3"
  component_id    text not null,
  version         integer not null,
  source          text not null,               -- 单文件 TS/TSX 源码（D3：AI 二次调整的权威输入）
  bundle_hash     text not null,               -- 内容寻址（D3）；同 hash 复用 blob
  bundle          text not null,               -- esbuild 产物（text/javascript）（D3）
  inputs_json     text not null,               -- ParamDefinition[]
  status          text not null default 'draft', -- draft | verified | failed
  test_report_json text,                       -- 验证报告（描述的就是本版本 bundle）
  created_at      text not null,
  verified_at     text
);
```

- `componentId` 由 background 生成（`ai-<slug>`），与内置组件 id（`glow-box` 等）不冲突。
- 时间线元素结构**不变**（`type:"component"` + `componentId`），无迁移。
- 版本迭代流程（D3）：`component.source` 读某版本 source → AI 修改 → `component.define` 提交新版本（重新编译 + 置 draft）→ `component.verify` → verified/failed → head 更新。

## 4. 作者分级：surface

模块契约为现有 `ComponentDefinition` + 新增 `surface` 字段：

```ts
type ComponentSurface = "html" | "react" | "r3f";

interface ComponentDefinition {
  id: string; name: string; keywords: string[];
  surface: ComponentSurface;              // 新增；缺省 "r3f"（兼容现有内置）
  category?: "effect" | "3d";
  selectable?: boolean; color?: string;
  inputs: ParamDefinition[];
  render: (ctx: ComponentRenderContext) => string | ReactNode;  // 按 surface 分发
  getBaseSize?: ({ params }) => { width; height };
  dispose?: (instance) => void;
}
```

| surface | AI 产出 | runtime 宿主 |
|---|---|---|
| **html** | 字符串模板（HTML + 内联 style，动画用 `${anim.*}` 算值） | `HtmlObject` 适配器 → 离屏 DOM → `captureElementImage` → HtmlTexture plane |
| **react** | JSX/DOM 元素树（hook 可用，用 `ctx.anim.*`） | 同上 HtmlObject 适配器 |
| **r3f** | R3F 元素树（3D/shader） | 现有 `WorldObjectView` 路径 |

- L1/L2 复用 `three/dom-text-surface.ts` 的 HtmlInCanvas capture 机制（泛化为 `HtmlObject`）；**依赖 `#canvas-draw-element`（Chrome 149+）**，不支持时显示占位 + 复用现有 `html-in-canvas-banner` 提示，v1 不做 canvas-2D 降级。
- 三个 surface **共享** `inputs` / `getBaseSize` / `dispose` / 错误兜底 / 验证 harness。
- 尺寸：plane 取 `getBaseSize`；缺省 512×512。选择框/命中测试复用渲染几何 bbox 路径（数据模型 RFC D5）。

### 4.1 平台工具：t → 动画（D5）

`render` 的 ctx 注入确定性动画工具（替代让 AI 写关键帧/计时）：

```ts
interface ComponentRenderContext {
  world: World;
  object: WorldObject;
  params: ParamValues;
  time: number;        // 全局时间（秒）
  localTime: number;   // localTime 秒
  progress: number;    // localTime / duration (0..1)
  anim: {
    lerp(a, b, u, { ease? }): number;              // ease: linear|easeOutCubic|…
    lerpColor(c1, c2, u): string;
    seq(keys: [number, number][], u): number;      // 关键帧取值（u 0..1）
    pulse(u, { speed?, phase? }): number;          // 0..1 周期
  };
}
```

**硬规则：动画必须是 t 的纯函数，禁止墙钟。** CSS `@keyframes`/`transition`（墙钟计时）只允许静态样式；动画一律走 `ctx.anim` 内联值。这是 Preview==Export 逐帧一致的前提（visual-runtime RFC §4.6/§9）。构建期静态扫描拒绝 `Math.random` / `Date.now` / `performance.now` / `setTimeout` / `requestAnimationFrame`。

### 4.2 SDK：`@recut/runtime` 导出面（D7）

`@recut/runtime` 是组件唯一可见的编程面，一份 d.ts + 一份文档（`apps/editor/sdk/`，经 skill references 提供给 AI）。v1 导出面：

```ts
// —— JSX 自动运行时（jsxImportSource 指向本模块，AI 无需 import React）
export { jsx, jsxs, Fragment }                 // 亦作为 /jsx-runtime 子路径导出
// —— React hooks（安全白名单，够写 L2/L3）
export { useState, useMemo, useRef, useCallback, useEffect }
// —— three（L3）
export * as THREE from "three"
// —— R3F 只读 hook（v1 禁 useFrame）
export { useThree }
// —— 程序化 canvas 纹理（复用宿主 runtime/texture.ts 的 useCanvasTexture）
export { useCanvasTexture }
// —— 参数读取
export { num, str, bool }
// —— 确定性动画（t→值；复用 animation/interpolation.ts + bezier.ts 插值底座）
export const anim: {
  lerp(a, b, u, { ease? }): number
  lerpColor(c1, c2, u): string
  seq(keys: [number, number][], u): number
  pulse(u, { speed?, phase? }): number
}
// —— 类型
export type { ComponentRenderContext, ParamValues, ParamDefinition }
```

- 底座直接复用现有代码：`anim.seq` 等价于把 `[u, value]` 关键帧喂给 `getScalarChannelValueAtTime`（linear/bezier/step 全支持）；ease 预设走 `bezier.ts`。
- **不做可安装的独立包**（react/r3f/animation 包）：分开装要么把副本打进 bundle（双 React），要么只是 re-export 空转；单 specifier 才能保证"宿主实例 + 单 import map 入口 + 单 d.ts"。远期如需子路径，import map 前缀映射即可支持 `@recut/runtime/anim`。

## 5. 动态加载与共享实例（D6）

**编译（服务端，AI 无本地工具链，D7）**：`component.define` 时 background 用 `ctx.shell.exec` 跑 `scripts/component-build.js`（node + esbuild）：

1. esbuild 单文件 TSX → ESM：`external: ["@recut/runtime"]`、`jsx: "automatic"`、`jsxImportSource: "@recut/runtime"`、target modern chrome。
2. **类型检查**：`tsc --noEmit` 对同一源码，`paths` 把 `@recut/runtime` / `@recut/runtime/jsx-runtime` 映射到 SDK d.ts——类型错误以精确行号回 `component.define` 的 `compileError`。
3. **确定性静态扫描**：token 级拒绝墙钟/随机源（§4.1）。
4. 产物 `{ bundle, bundleHash }` 写入 files sandbox。

**加载**：iframe 经 api 操作 `component.resolve` 批量取 head 的 `{ bundle, bundleHash, inputs, surface }` → 按 hash 缓存 → `URL.createObjectURL(new Blob([bundle], { type: "text/javascript" }))` → `import(blobUrl)` → 契约校验（§6.1）→ `componentsRegistry` 注册。

**共享实例（关键决策，防双 React）**：AI 组件唯一允许的外部 import 是虚拟模块 `@recut/runtime`（提供 React 自动 JSX runtime / R3F / THREE / `anim`）。宿主侧：

1. UI 构建新增独立入口 `runtime.ts`，export 共享的 react / R3F / three / `jsx-runtime` / `anim` / `useCanvasTexture` 实例，产出独立 chunk（该 chunk 同时充当 `@recut/runtime` 与 `@recut/runtime/jsx-runtime` 两处解析目标）。
2. 运行时 `import()` 该 chunk，注入 document **import map**：

   ```json
   { "imports": { "@recut/runtime": "<chunkUrl>", "@recut/runtime/jsx-runtime": "<chunkUrl>" } }
   ```

3. 组件 bundle 的裸 import 经 import map 解析到宿主实例 → **永远单 React 实例**。

限制外部 import 范围本身是安全措施的一部分（组件只能见到 `@recut/runtime`）。

## 6. 安全（已确认）

四层，任一失败都不影响宿主：

1. **契约校验**：模块 import 后 zod 校验导出 shape（render 是函数、surface 合法、inputs 的 default 可 JSON 化且 keyframable）；不合格 → `status: failed` + 占位。
2. **每实例 ErrorBoundary**：`WorldObjectView` 包一层（现有无边界，仅 demo 有）；捕获 render/生命周期/dispose 错误 → 渲染通用兜底 R3F 占位（色块 + 组件名 + 错误信息），**只影响该组件**；导出路径同边界，一帧坏不中断导出。
3. **只读上下文**：render 只拿 `ComponentRenderContext`，接触不到 Recut Host / DOM / 平台 API；v1 禁 `useFrame`/命令式 three 变更（省掉确定性、dispose、挂起三难题）。
4. **确定性 + 内容寻址**：构建期静态扫描墙钟源（见 §4.1）；bundle 按 hash 寻址，同版本行为恒定（D3）。

## 7. 验证闭环

**一个 harness 实现，两种宿主**（`component-harness` 模块）：iframe 内（用户在场时的快路径）与 Playwright/Chromium 页（无 iframe 时的深路径，复用数据模型 RFC Phase G 基建）。轻量档检查：

| check | 断言 |
|---|---|
| contract | 导出 shape 合法；inputs default 完整 |
| import | 编译/import 无异常，`@recut/runtime` 解析成功 |
| smoke | 默认参数，`t ∈ {0, .25, .5, .75, .99}` 逐帧挂载无 throw；组件区域非空（像素/几何 bbox） |
| determinism | 同 t 渲染两次 → 组件区域像素哈希相等（抓墙钟源） |

报告 `{ ok, checks: [{ name, pass, detail }], frames, error?, screenshot? }` 持久化到版本 `test_report_json`（D3：报告描述的就是该版本 bundle）。AI 经 MCP 读回结构化报告自主迭代，不依赖用户肉眼。

## 8. MCP / API 契约（manifest 新增 operations）

| operation | surfaces | 说明 |
|---|---|---|
| `component.define` | api+mcp | 新建临时组件或已有组件的新版本。输入 `{ componentId?, name, surface, keywords, inputs, source }`；输出 `{ componentId, versionId, status: "draft", compileError? }`。带 `componentId` = 迭代（AI 先 `component.source` 读旧源码）；不带 = 新建 |
| `component.verify` | api+mcp | 触发 harness 验证，写入 testReport；输出 `{ versionId, status, report }` |
| `component.list` | api+mcp | 项目内组件 + head 状态 + inputs（AI 建 clip 时据此构造 params 默认值） |
| `component.source` | api+mcp | 读某版本源码（二次调整输入，D3） |
| `component.resolve` | api | head bundle 批量解析（iframe loader 用，按 hash 返回） |

Agent 放置到时间线**不需要专用 op**：直接按现有 `project.save` 程序化构造 `type:"component"` 元素（`componentId` + 由 `component.list` 的 inputs 展开的默认 params），与既有 skill 流程一致。

## 9. 代码改造点

- `runtime/component-registry.ts`：扩展为**异步响应式**——`registerAsync(componentId, loader)`、`load(id)`（幂等缓存 Promise）、`isLoaded(id)`、`getState(id)`（loading/ready/failed/error）、`subscribe`。
- `runtime/types.ts`：`ComponentDefinition` 加 `surface`；`ComponentRenderContext` 加 `progress` / `anim`；`render` 返回类型按 surface 放宽。
- `runtime/world-scene.tsx`：`WorldObjectView` 加每实例 ErrorBoundary；按 `surface` 分发到 `HtmlObject` 或现有路径。
- 新增 `runtime/components/html-object.tsx`：L1/L2 宿主（离屏 DOM + HtmlTexture plane，泛化 `dom-text-surface` capture）。
- 同步消费点加守卫（未加载 → 占位，**绝不 `.get()` 同步取**）：`world-scene.tsx`、`component-stage.tsx`、`preview/element-bounds.ts`、`timeline-element.tsx`、`component-params-tab.tsx`、`properties/registry.tsx`、`element-utils.ts`。
- `timeline`：项目加载时扫描 `type:"component"` → `component.resolve` 批量加载缺失定义。
- 新增 `apps/editor/sdk/`：`@recut/runtime.d.ts` + `README.md`（SDK 导出面文档，经 skill references 提供 AI，D7）。
- UI 新增 `runtime.ts` 入口（共享实例 chunk，同时承担 `@recut/runtime` 与 `/jsx-runtime`）+ import map 注入。
- `scripts/component-build.js`：esbuild 编译 + `tsc --noEmit` 类型检查（映射 SDK d.ts）+ 静态墙钟源扫描 + bundle 哈希（D7）。
- `background.js`：两张表 + 上述 operations + manifest 声明。
- 验证 harness：`src/runtime/harness/`（共享逻辑）+ `component-harness.html`（Playwright 宿主页）。

## 10. 实施路线

| 阶段 | 内容 | 验证 |
|---|---|---|
| A | surface 字段 + `HtmlObject` 适配器 + ErrorBoundary；内置一个 L1、一个 L2 示例组件走通承载 | tsc + 预览渲染 |
| B | `@recut/runtime` 共享 chunk + SDK d.ts/文档 + import map + `component-build.js`（esbuild + tsc + 扫描）+ Blob import + hash 缓存 | tsc + dev 下动态加载示例跑通 build |
| C | 数据表 + `component.define/list/source/resolve/verify` + manifest | MCP 手测 + tsc |
| D | 验证 harness（iframe 内 + Playwright 宿主）+ 轻量档检查 + 报告持久化 | 已知好/坏组件各出一份报告 |
| E | 消费点守卫 + 项目加载惰性解析 + 占位渲染 + 墙钟源静态扫描 | 断链/坏组件不炸画布 |
| F | 更新 `rfc/README.md`、editor skill、`ARCHITECTURE.md`；tsc + build + e2e | 文档与代码一致 |

## 11. 边界与未决

- **v1 不含**：素材库/版本 UI、跨项目复用、组件嵌套、`useFrame`/交互式组件、canvas-2D 降级、深档像素级导出对比。
- **L1/L2 依赖 `#canvas-draw-element`**；不支持环境显示占位。
- **head 语义下导出可变**：用户重导出时若 AI 已修复，画面会变（临时素材被编辑，等同改视频调色，可接受）。
- **verify 的 iframe 在场性**：无 iframe 时走 Playwright 宿主，冷启动约数秒，需 MCP 层容忍。
- **bundle 冗余存储**：bundle 由 source 派生，存储上冗余，但换来"加载无需编译器 + AI 改权威 source + 验证与渲染同物"（D3），可接受；远期可只存 bundle_hash + 静态服务器。
