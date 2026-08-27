# MetalForge 内置组件库：WebGPU 效果接入 Editor Runtime

状态：Draft / 待评审

## 目标

把已导入的 64 个 MetalForge 效果（`apps/editor/ui/src/metalforge/`，含付费 WGSL/MSL 源码与参数 schema）变成 editor 真实内置组件库的一部分，分两类：

1. **全屏背景**（`mf.bg.*`）：适配任意画布尺寸（16:9 / 9:16 / 1:1），作为 `category: "effect"` 的环境层，铺满 world。
2. **卡片/元素**（`mf.card.*`）：固定设计尺寸的可选元素（progress bar、thinking-orbs、dots 等），可作为普通组件摆放、缩放、加动画。

组件库面板按 MetalForge 原有分组（Gradient / Atmosphere / Space / Solid / Motion / Orbs）浏览，每组展示真实渲染缩略图；选中后的属性面板复用现有 params 系统（滑杆 / select / color / boolean），与 metalforge.html 调参页一致。

## 核心问题：WebGPU ↔ WebGL 桥

runtime 世界渲染是 three.js（WebGL），MetalForge 效果是 WGSL（WebGPU）。移植 52 个 shader 到 GLSL 不可行（工作量大且和官方导出失配）。方案：

```text
ComponentRenderContext.localTime（确定性时间）
        ↓
WebGpuEffectSource（每组件一个）
  ├─ offscreen <canvas>（WebGPU context，尺寸=渲染像素）
  ├─ 共享 GPUDevice（页面级单例）
  └─ 每帧：pack uniforms(localTime) → render WGSL → 存活到 canvas
        ↓ drawImage(webgpuCanvas → 2D canvas)（Chrome 113+ / Safari 18+ 原生支持）
THREE.CanvasTexture（needsUpdate 每帧）
        ↓
fullscreen plane（mf.bg）或固定尺寸 plane（mf.card）
```

关键约束：

- **确定性**：WebGPU 帧时间一律取 `localTime`（timeline 时间），禁止 `performance.now()`，保证预览 == 导出（对齐 rfc/2026-08-22 animation-runtime 的确定性约定）。
- **帧序**：bridge 在 world render 前同步 pump（`onBeforeRender` 或 world frame 回调），`CanvasTexture.needsUpdate` 后 three 正常采样。
- **兜底**：`drawImage(webgpuCanvas)` 不可用时走 GPUBuffer readback（`engine/thumbnails.ts` 已有实现）；WebGPU 完全不可用时渲染静态首帧 PNG（复用缩略图缓存）。
- **性能**：共享一个 GPUDevice；每个挂载实例只有一个 offscreen canvas；缩略图是离散单帧渲染（不驻留）。时间线只渲染视口内实例。

## 目录与代码组织

```text
apps/editor/ui/src/metalforge/            # 已有：catalog schema + WGSL + imports + 引擎（metalforge.html 调参页继续可用）
apps/editor/ui/src/runtime/components/metalforge/
  index.ts                # METALFORGE_COMPONENTS: ComponentDefinition[]，注册进 registerBuiltinComponents
  schema-generated.ts     # 从 catalog/schema.json 生成（build 脚本），导出参数定义映射
  webgpu-bridge.ts        # WebGpuEffectSource：共享 device、uniform pack、CanvasTexture 泵
  fullscreen-effect.tsx   # mf.bg 渲染体：world.width×world.height 平面 + 桥
  card-effect.tsx         # mf.card 渲染体：getBaseSize 固定平面 + 桥
  progress-react.tsx      # mf.card.progress：直接复用官方导出 generated/ProgressBar.tsx（react surface，DOM capture 管线）
  thumbnails.ts           # 组件库面板缩略图（复用 metalforge/engine/thumbnails.ts）
scripts/generate-metalforge-registry.mjs   # schema.json → schema-generated.ts（含中文 label、groups、swatch、颜色映射）
```

生成脚本从 `catalog/schema.json` 产出每个效果的：

- `id`（`mf.bg.abyss` / `mf.card.progress`）、`name`（保留官方双语风格："Abyss 深渊"）、`keywords`（官方 description 分词 + gallery + 中文名）。
- `inputs`：`float→number(min/max/step)`、`toggle→boolean`、`color→color`、`select→select(options)`。`float2` 拆成两个 number（`.x/.y`）；`colors` 调色板 v1 暂缓（多数 metal 效果不用）；params > 24 的效果按 `groups` 截取主组（Style/Wallpaper/Motion/Colors），完整参数留在调参页。
- `color`（Timeline 识别色）：从 `swatch` CSS 渐变提取主色。

## 两类组件的渲染契约

### mf.bg.*（全屏背景，~55 个）

```ts
{
  id: "mf.bg.abyss",
  category: "effect",          // 全画布，不可选，不参与 hit-test
  selectable: false,
  surface: "r3f",
  inputs: [...],               // schema 映射
  render: FullscreenWebGpuEffect,   // planeGeometry(world.width, world.height)
}
```

- WGSL 的 `size` uniform 填画布实际像素（`renderer.domElement.width/height`），效果自身适配画布比例——这正是"适配画布尺寸"的实现点。
- `meshgradient`（abyss/mesh）走 mesh 双 pass（`engine/mesh.ts` 已移植）；`particle`（particle-field）走实例化管线（`engine/particle.ts`）；其余 metal 走 fullscreen wrapper。
- `sim/cloth/dust/fluid/graph/mesh3d/discs` 等 9 个无 WGSL 静态渲染器的，v1 不进组件库（组件库数量 55）。

### mf.card.*（卡片/元素，v1 先做 4 个）

| id | 来源 | 设计尺寸 | 说明 |
|---|---|---|---|
| `mf.card.progress` | 官方 react 导出（`generated/ProgressBar.tsx`） | 1040×289（aspect 3.6） | react surface，标题/副标题/百分比/10 style 全保真 |
| `mf.card.thinking-orbs` | WGSL discs 实例化 | 720×720 | 需要 dots CPU 表（bundle 内 sheet，移植 v2） |
| `mf.card.glass-orb` | WGSL metal | 720×720 | 常规 fullscreen wrapper，plane 裁剪 |
| `mf.card.dots` | WGSL metal | 720×405 | 同上 |

卡片类统一：`selectable: true`、`getBaseSize` 固定（由 schema `aspect`/`corner` 或效果画幅决定）、plane 材质 `transparent`（pill 形状用 alpha 圆角，`corner` 参数驱动 clip）。

## 组件库面板与 Preview

- 现有组件面板按 registry 列表渲染；新增「MetalForge」分区，数据源 `METALFORGE_COMPONENTS` 按 schema `gallery` 分六组。
- 缩略图：面板挂载时用 `metalforge/engine/thumbnails.ts` 离屏渲染单帧（默认参数、t=2.5s），PNG dataURL 内存缓存；失败回退 `swatch` 渐变。缩略图引擎与组件运行时共享同一份 WGSL 与 uniform 逻辑，所见即所得。
- hover 实时预览（P3 可选）：hover 时起一个小 WebGPU canvas 循环，移出即停。

## 属性面板

完全复用现有 params 渲染（number 滑杆带 min/max/step、select 分段、color 取色器、boolean 开关），无新 UI。两点增强（P2）：

- `group` 字段用 schema 的 `groups`（Style / Motion / Colors…），面板折叠分组。
- `select` 的 `dependencies`：MetalForge 的 select presets（切 style 连带重置一批 float）在 v1 用「写默认值到实例 params」实现——面板 onChange select 时 merge preset 值进元素 params（和 metalforge.html 调参页行为一致）。

## 导出与确定性

- bridge 帧泵由 world render 循环驱动（`localTime` 唯一时间源），导出读帧时纹理已就绪，无 async gap。
- readback 兜底路径是同步提交+异步 map，导出前用与 `waitForCapture` 相同的语义等待首帧完成（`activeContentSurfaces` 模式，bridge 暴露 `waitReady`）。
- 验收：同一 timeline 预览帧与导出帧像素 diff（现有导出测试管线加一个 mf.bg.abyss 用例）。

## 分期

- **P0（本 RFC 评审通过后）**：`webgpu-bridge` + `mf.bg` 6 个 hero（abyss / starfield / aurora / molten / plasma / fractal-clouds）+ 注册 + 面板分区与缩略图 + 1 条导出确定性测试。
- **P1**：生成脚本覆盖全部 52 个 metal + 2 meshgradient + particle；params group 折叠；select preset 联动。
- **P2**：`mf.card.progress`（react surface 官方组件）+ 3 个卡片组件；pill alpha 裁剪；`mf.bg` 的 blendMode 透传（现有组件 blendMode 字段）。
- **P3**：thinking-orbs CPU dots 表移植、hover 实时预览、i18n labelKey 批量接入、9 个 sim 类效果评估（cloth/fluid 需 CPU 模拟器，另行 RFC）。

## 风险与取舍

- **WebGPU 依赖**：编辑器主渲染是 WebGL，组件层引入 WebGPU 双设备共存。共享单 device、严格 dispose（元素删除即 destroy 资源）控制成本；不支持 WebGPU 的浏览器降级为静态首帧（缩略图缓存），不阻塞时间线。
- **drawImage(webgpuCanvas) 兼容性**：Chromium/Safari 18 均支持；Firefox 走 readback 兜底。
- **参数过载**：单效果最多 56 个参数，面板折叠 + 主组截取；完整参数留在 metalforge.html 调参页（两处共享同一 schema 生成物，不会漂移）。
- **视觉基准**：以 metalforge.html 为像素基准，bridge 与缩略图共享渲染路径，组件库缩略图应与调参页、时间线预览三者一致。
