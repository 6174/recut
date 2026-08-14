<!--
 * [INPUT]: 依赖 apps/editor 现有 timeline/scenes/selection managers、preview 交互控制器（use-preview-interaction / use-transform-handles / element-bounds / preview-snap）、
 *          runtime（buildWorld / WorldScene / component registry / component-stage）、animation 关键帧系统（resolveTransformAtTime / upsertPathKeyframe）、params 参数系统
 * [OUTPUT]: 定义编辑器数据模型（DocumentData + EditorState + Ephemeral Layer + NodeState）与选区/元素定位（实时渲染几何 bbox）架构，
 *          以及 Model API、渲染路径收缩与 Chromium 自测方案（Playwright）
 * [POS]: rfc 的架构设计蓝图；在获批实现后作为 apps/editor 状态/选区/交互重构与回归测试的共同契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: 编辑器数据模型与选区/元素定位架构

- 状态：提议
- 依赖：`apps/editor` 现有 `timeline/scenes/selection` managers、`preview` 交互（`use-preview-interaction` / `use-transform-handles` / `element-bounds` / `preview-snap`）、`runtime`（`buildWorld` / `WorldScene` / `component-stage` / `component-registry`）、`animation` 关键帧、`params` 参数系统
- 日期：2026-08-14
- 目标版本：Phase A–G

## 1. 背景与病灶

当前预览/选区/交互链路存在四处结构性缺陷，直接导致：拖拽时元素与选择框脱离、左右方向拖不动、选中要点两次、bbox 与对象不符、文本框不能移动。

1. **双份"当前 tracks"**：`TimelineManager.previewOverlay/previewTracks`（临时合并副本）与 `ScenesManager.active.tracks`（提交真相）并存。拖动期间数据不在 model 里，任何读错/读旧一份的消费方都拿到过期值。
2. **三个消费者各自独立订阅，更新时机不一致**：
   - 渲染：`RenderTreeController`(useEffect) → `buildWorld` → `setWorld`(第二个 store) → `PreviewCanvas` → rAF → `WorldRenderer.root.render` → R3F；
   - 选择框：`useTransformHandles` → 直接算 bounds → DOM；
   - 命中测试：pointerdown 时实时读 tracks → 算 bounds。
   元素比框慢 3~4 个 commit → 拖拽"脱离"、点两下才选中（命中测的是数据位置，用户点的是视觉位置）。
3. **渲染位置与 bbox 是两套独立计算**（`buildWorld` 的 `WorldObject.transform` vs `getElementBounds`），只靠"碰巧一致"。rotation 符号、组件 footprint、`getBaseSize` 全是在给这两套数法打补丁。
4. **bbox 没有"当前帧真相"**：`getElementBounds` 虽用 `resolveTransformAtTime`（关键帧可解析），但喂进来的 tracks 是乱的，且与渲染不同步。

## 2. 决策记录（已确认）

| # | 决策 |
|---|---|
| D1 | **关键帧提交**：属性已有关键帧 → 拖动/改动落关键帧（剪映式）；无关键帧 → 写基础值；缩放不再清关键帧 |
| D2 | **瞬时层通用化**：`NodeOverlay(transform/params/flags)` 按 source 分槽；现阶段 drag/hover，后续可扩 scrub / ai-preview 等 |
| D3 | **渲染归属**：`RenderTreeController` 并入 `PreviewCanvas`，`useLayoutEffect` 同步渲染 |
| D4 | **选区迁移**：elements/keyframes/maskPoints 选择状态迁入 `EditorState` |
| D5 | **bbox 统一读渲染几何**：所有元素（含 3D 组件）从已渲染 Object3D 实时取 bbox，不做缓存、不做 footprint 猜测 |
| D6 | **文本按内容定尺寸 plane**：`TextObject` 改为按测量内容定尺寸（绘制不变，texture offset/repeat 对齐文字区），几何 bbox 即文字范围 |

## 3. 数据模型架构

### 3.1 DocumentData（Model，唯一真相）

```text
project(scenes / settings) + environment
  └─ scenes[].tracks → elements: { id, params, animations(关键帧), startTime/duration, ... }
```

- 可持久化；所有写都走 Model API（command/undoable，一次 notify）。
- Selection manager 与未来 AI 都只面向 `DocumentData` 结构 + API。

### 3.2 Model API（唯一写入口）

```ts
interface DocumentModelApi {
  setElementTransform(id, transform, { atTime }): void   // D1 关键帧策略在内部
  setElementParam(id, key, value): void
  setKeyframe(id, path, time, value): void
  moveElement / insertElement / deleteElement / duplicateElement(...): void
  setEffectParams / setMask...(...): void
}
```

- 现有 `TimelineManager` 的写方法（`updateElements` / `upsertKeyframes` / `commitPreview` 等）收敛成这套 API；`ScenesManager.updateSceneTracks` 退化为内部实现。

### 3.3 EditorState + Ephemeral Layer（State，临时）

```ts
interface EditorState {
  selection: { elements: ElementRef[]; keyframes: SelectedKeyframeRef[]; maskPoints: ... };  // D4
  playhead: MediaTime;
  hover: ElementRef | null;
  ephemeral: EphemeralLayer;          // D2 通用瞬时层
  viewport?: { zoom; center };        // UI 局部，可留在 context
}

type NodeOverlay = {
  transform?: Transform;               // 位置/缩放/旋转覆盖
  params?: Partial<ParamValues>;      // 任意参数覆盖
  flags?: { hovered?: boolean; editing?: boolean; hiddenPreview?: boolean; ... };
};

class EphemeralLayer {
  slots: Map<SourceId, Map<ElementId, NodeOverlay>>;   // 'drag' | 'hover' | ...
  apply(sourceId, elementId, overlay): void;           // 只写该 source 的槽
  clearSource(sourceId): void;
  resolveNodeOverlay(elementId): NodeOverlay | null;   // 按优先级合并各槽
}
```

- 拖动 = 一个 `'drag'` 槽；hover 写 flags；未来 scrub / ai-preview 各占一槽，互不覆盖。
- 拖动期间**只写 State**（不建 command、不 notify 风暴），松手才落地 Model。

### 3.4 resolveScene / NodeState（每帧节点视图）

```ts
resolveNode(element, overlay, localTime): NodeState
  // resolvedTransform = resolveTransformAtTime({ base, animations, localTime }) ⊕ overlay.transform
  // resolvedParams    = resolveParamsAtTime(...) ⊕ overlay.params
  // flags             = overlay.flags ?? {}

resolveScene(data, state, time): Map<ElementId, NodeState>
```

- `NodeState` 不承载 bounds；bounds 是"对渲染场景的一次实时查询"（§4.2），消灭缓存一致性问题。
- 渲染 / 选择框 / 命中 / 高亮全部消费同一份 `NodeState`。

### 3.5 关键帧落点（D1）

`setElementTransform(id, t, { atTime })` 对每个被改属性 P：

- `hasKeyframesForPath(P)`：
  - 恰好有 `atTime` 处关键帧 → 更新其值；
  - 否则在 `atTime` 插入关键帧（沿用 `upsertPathKeyframe`，插值随当前段）；
- 否则 → 写 `params[P]` 基础值。

行为变更：现 `transform-handle-controller` 缩放时 `buildCornerScaleAnimationReset` **清空** scale 关键帧 —— 按 D1 改为"写关键帧"，不再清除。

## 4. 选区 Manager 与元素定位

### 4.1 SelectionManager（迁入 State，D4）

- 归入 `EditorState.selection`，保留 snapshot / restore / applyPatch 语义；只存引用，不存几何。
- 几何一律来自"渲染场景实时 bbox"（§4.2）。

### 4.2 实时几何 bbox（D5 / D6，核心）

```ts
// WorldScene 维护，随渲染由 ref 注册（复用 component-stage 的 group 注册模式）
nodeObjectRegistry: Map<ElementId, { root: Object3D; content: Object3D }>
//   root    = 元素 transform 组（position/scale/rotation）
//   content = 该节点实际渲染的组件/内容

getRenderedNodeBounds(registry.get(id), resolvedTransform): ElementBounds
  // content 局部 AABB（Box3.setFromObject → 逆变换到 root 局部系）→ footprint(w,h)
  // bounds = { center: worldPosition,
  //            width: footprint.w × scaleX,
  //            height: footprint.h × scaleY,
  //            rotation: resolvedTransform.rotate }
```

- 选择框 / 命中测试 / snap 需要时才调，计算前 `updateWorldMatrix` 保证拿到最新帧；成本极低，**不做每帧全量缓存**。
- 因为预览已渲染，three 中的元素本就带 bbox 数据 —— 选择框与"眼睛看到的东西"天然一致（含 3D 组件真实几何、旋转、缩放、关键帧插值）。
- `getBaseSize` 从 bounds 路径移除（保留为无渲染场景 headless 时的 fallback 或直接删）。
- **文本（D6）**：`TextObject` 改为按测量内容定尺寸的 plane → 几何 bbox 即文字范围，全类型统一，不再 special-case。

### 4.3 交互会话（拖动流程）

```
pointerdown → session.begin(id, nodeState.resolvedTransform)   // 起点含关键帧
pointermove → session.update(transform)  // 只写 ephemeral['drag'] 槽 → 同步 notify
            → resolveScene 变化 → 渲染/框/命中 同一 commit 更新
pointerup   → model.setElementTransform(id, transform, { atTime })  // D1
            → clearSource('drag')
```

文本编辑 / 关键帧 scrub / AI 预览都是同构 `InteractionSession`。

## 5. 渲染路径收缩（D3）

- 合并 `RenderTreeController` 进 `PreviewCanvas`：
  `const scene = useEditor(e => e.state.resolveScene())`
  → `useLayoutEffect`：`buildWorldFromResolvedScene(scene) → worldRenderer.render(world, waitForDraw:false)`。
- 不再经过 `setWorld`（第二 store）+ rAF 链 → 元素与框同步。
- 导出 / 缩略图保留 `SceneExporter` / `WorldRenderer` 的 awaited 渲染，ephemeral 为空。

## 6. 实施计划（Phase A–G）

| 阶段 | 内容 | 验证 |
|---|---|---|
| A | 新增 `EditorState`（selection 迁入 + `EphemeralLayer` + `resolveScene`/`resolveNode`/`NodeState`） | tsc 通过 |
| B | 用 ephemeral 替换 `previewOverlay/previewTracks`；`useTransformHandles`、`usePreviewInteraction` 改读 NodeState | 单击选中、空点取消、拖拽不脱离 |
| C | `RenderTreeController` 并入 `PreviewCanvas`（`useLayoutEffect` 同步渲染） | 跟手 |
| D | `nodeObjectRegistry` + `getRenderedNodeBounds`；文本按内容定尺寸 plane（D6）；移除 `getBaseSize` bounds 路径 | bbox 贴合所有类型实际几何 |
| E | Model API + D1 关键帧提交（替换 scale 清除逻辑）；selection manager 走 Model API | undo 正常、关键帧落点正确 |
| F | 写 RFC（本文档）+ 更新 `rfc/README.md`；tsc + build | 文档与代码一致 |
| G | Playwright/Chromium 自测基建 + 4 个 spec（见 §8） | 见 §8 各 spec |

## 7. 验收清单

- [ ] 画布单击一次选中；点空白一次取消
- [ ] 拖拽元素：元素、选择框、命中区同帧同步移动（含左右方向）
- [ ] bbox 贴合当前帧实际几何：3D 组件、旋转、缩放、关键帧插值、文本
- [ ] 已有关键帧的属性拖动 → 落关键帧；无关键帧 → 写基础值；缩放不再清关键帧
- [ ] 文本编辑 / hover 走同一 ephemeral 管线
- [ ] 导出路径不受影响；tsc / build 通过

## 8. Chromium 自测方案（Phase G）

### 8.1 工具与运行
- 新增 devDep `@playwright/test`（版本对齐本机已缓存的 `ms-playwright/chromium-1161`），复用系统浏览器缓存。
- `playwright.config.ts`：`webServer = vite preview`（服务 `dist`，端口 5183）或 dev server；`project: chromium`；headless；失败自动截图 + trace。
- 脚本：`test:e2e = playwright test`；`test:e2e:install = playwright install chromium`。
- headless WebGL：chromium headless_shell 内置 SwiftShader，R3F 可渲染；必要时 launch args `--use-gl=swiftshader`。

### 8.2 可测试性桥（`import.meta.env.DEV` 或 `?test=1` 门控）
暴露 `window.__recutTest`：
```ts
getResolvedTransform(elementId)   // NodeState 求值（含关键帧 + ephemeral）
getNodeBounds(elementId)          // 实时几何 bbox（渲染场景查询）
getObject3DBox(elementId)         // registry 里的 Box3（对照组）
getSelection()                    // selection refs
setTime(t) / advanceFrame()       // 精确控制 playhead + 等一帧（冻结时间动画）
canvasToOverlay(x, y) / getViewport()  // 框 DOM 坐标投影
```
- **确定性场景注入**：`/` 支持 `?testSeed=interaction` 加载固定项目（image + text + glow-box + spline，已知坐标/关键帧）；独立 `test.html` harness 页用于纯几何断言（无交互、时间可冻结）。
- 断言前固定精确时间并等一帧，消除 spline/glow 时间动画干扰。

### 8.3 测试套件
| spec | 断言 |
|---|---|
| `click-select.spec` | 单击一次 → selection 含该元素 + 框出现；点空白一次 → 清空；**左右/上下拖拽** → resolvedTransform 位移 == drag delta |
| `bounds-geometry.spec` | 对 image/text/glow-box/spline 各类型：`getNodeBounds(id)` ≈ `getObject3DBox(id)` 投影；**选择框 DOM rect ≈ nodeBounds 投影** |
| `drag-sync.spec`（回归项） | 拖拽中逐帧采样：框 DOM rect 与 nodeBounds 投影差值 ≤ 2px，捕捉"元素滞后/框脱离/左右不动" |
| `keyframe-drag.spec` | 属性已有关键帧：拖动 → 在拖动时刻落/更新关键帧；无关键帧：写基础值 |

### 8.4 稳定性说明
- bounds 断言只依赖 Object3D 几何（`Box3`），不依赖 GL 像素输出 —— headless 下 transmission/环境光渲染瑕疵不影响断言。
- 时间动画：断言前 `setTime` 冻结。
- 可选加强：canvas 区域截图与框区域像素比对，标记为可跳过（flaky 风险）。

## 9. 参考实现文件

- 数据：`src/core/managers/{timeline,scenes,selection}-manager.ts`
- 交互：`src/preview/controllers/{preview-interaction,transform-handle}-controller.ts`、`src/preview/hooks/{use-preview-interaction,use-transform-handles}.ts`
- 几何：`src/preview/element-bounds.ts`、`src/preview/hit-test.ts`、`src/preview/preview-snap.ts`
- 渲染：`src/preview/components/index.tsx`、`src/runtime/{build-world,world-runtime,world-scene,world-renderer}.ts(x)`、`src/runtime/components/{plane,text,glow-box,spline-scene,shape}.tsx`
- 关键帧：`src/rendering/animation-values.ts`、`src/animation/{resolve,keyframes}.ts`
