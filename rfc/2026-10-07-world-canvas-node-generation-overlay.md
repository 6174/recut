<!--
 * [INPUT]: 以 rfc/2026-09-16-media-generation-proposal.md（proposed 全局资产生命周期、确认复用同一 assetId）、
 *   rfc/2026-09-15-generation-reference-protocol.md（references[{id,kind,role,label}] + referenceIds 顺序）、
 *   rfc/2026-10-02-world-canvas-production-layer.md（产物挂节点 media 属性、状态派生）、
 *   rfc/2026-09-15-world-entity-guided-ai-actions.md（guided 动作注册表）为基线；
 *   对照 web/app/worlds/[worldID]/canvas/canvas-pomelo.tsx 宿主根（:1207-1256，邻接 CanvasInlineEditor :1248 /
 *   CanvasTextFullscreenEntry :1249）、canvas-text-fullscreen-entry.tsx（屏幕空间锚定的 overlay 范式）、
 *   canvas-pomelo-plugin.ts（hitTest/updateHover/selectBlock 命中与 hover）、canvas-store.ts（selection/selectedIds/
 *   hoveredBlockId/draggingBlockId/readOnly、canvasRectOf、canvasElementIdOfBlock、createProposal/updateProposal/
 *   confirmProposal、setMediaElementAsset/setAttrMediaAsset）、panel/media-editor.tsx（MediaElementEditor/
 *   MediaAssetEditor/GenerationRecipe/GenerationProposalEditor、RECIPE_CAPABILITY）、panel/element-recipe-draft-store.ts、
 *   components/proposal-editor.tsx、lib/media/proposal.ts、canvas-asset-status.ts、app/media/media-types.ts（Asset.origin/metadata）
 * [OUTPUT]: 定义「World 画布上 AI 生成媒体（图/音/视频）的生成交互从隐蔽的右侧属性面板搬到节点自身」的决策：
 *   在节点上叠加两个独立可插拔的 overlay——节点工具栏（上）+ 节点生成输入框（下），由 NodeOverlay 注册表按 subject
 *   解析与过滤；输入框仅在「空内容」或「已是 AI 生成内容」时显示；工具栏按节点类型给出基础常用操作、无适用项则隐藏；
 *   生成提交/确认/轮询统一收敛到 store 动作，右侧面板降级为素材来源/历史/高级参数。含契约、改动面、验收与不做
 * [POS]: rfc 的画布节点生成 overlay 决策；不改提案生命周期（确认权仍只在用户）、不改右侧面板数据源、不新增服务端端点/表
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# RFC: World 画布节点生成 overlay（Node Toolbar & Generation Composer）

- 状态：M0–M2 已实施（2026-10-07；M3 打磨与面板提交收口待续）
- 作者：Recut
- 日期：2026-10-07
- 关联：[媒体生成提案](./2026-09-16-media-generation-proposal.md)、[生成参考引用协议](./2026-09-15-generation-reference-protocol.md)、[画布生产层](./2026-10-02-world-canvas-production-layer.md)、[世界实体引导动作](./2026-09-15-world-entity-guided-ai-actions.md)、[画布分组容器与交互插件模块化](./2026-10-05-world-canvas-group-containers.md)

## 摘要

World 画布上 AI 生成的图片/音频/视频节点，目前唯一完整的生成入口压在**右侧属性面板**的「手动生成」区（`panel/media-editor.tsx` 的 `GenerationRecipe` / `GenerationProposalEditor`，经 `ElementPanel` 路由）。问题：

1. **不直接**：生成与节点脱节——用户看着画布上的节点，却要到右侧栏底部一段折叠区里找 prompt/参考/模型与提交按钮；demo（视频节点）里的「工具栏 + 底部输入框」式交互无法表达。
2. **不可发现**：空内容的媒体节点没有任何「在这里生成」的入口；新用户不知道要点右侧栏。
3. **浏览时无法就地生成**：节点被拖到视野中央时，右侧面板与节点在视觉上分离，参考图/提示词与目标画面不能同屏对照。

本 RFC 的决策：

> **节点即生成入口。** 在画布节点上叠加两个**独立、可插拔**的 overlay 插件：
> - **节点工具栏（Node Toolbar）**：节点上方/右上浮出的基础常用操作条；按节点类型与素材状态给出适用操作，**无适用项则不显示**。
> - **节点生成输入框（Generation Composer）**：节点下方浮出的生成输入框（prompt + 参考 + 模型/参数 + 提交/确认）。
>
> 输入框的显示条件是**内容驱动**的：**空内容**（未选择素材）或**已是 AI 生成内容**（`origin=generated` / `proposed` / 带生成配方）时显示；手动上传内容默认不显示。
> 生成提交/提案确认/轮询**统一收敛到 store 动作**（新增 `runMediaJob` / `submitNodeGeneration`），右侧面板降级为**素材来源 / 素材历史 / 高级参数**，不再承担主提交动作。

一句话：**把生成从「侧面板底部的一段表单」变成「贴在节点上的工具栏 + 输入框」**，并保持提案门（视频）与确认权（只在用户）不变。

## 1. 现状（读码结论，非推断）

| # | 事实 | 位置 |
|---|---|---|
| 1 | 画布宿主根是一个 `relative` 容器，`CanvasInlineEditor`（z-30）与 `CanvasTextFullscreenEntry`（z-20）以**屏幕空间绝对定位**叠在其上 | `canvas-pomelo.tsx:1207-1256`（:1248/:1249） |
| 2 | 已有「世界坐标 rect → 屏幕坐标」的成熟范式：读适配器 `transform`，`screen = world*scale + t`，订阅 `onTransformEvent` 重排 | `canvas-inline-editor.tsx:75-86`、`canvas-text-fullscreen-entry.tsx:81-93` |
| 3 | 已有 hover/命中：`hoveredBlockId` 由插件写入；`selection`/`selectedIds` 由 `select`/`selectMany` 维护 | `canvas-pomelo-plugin.ts`（`updateHover`/`selectBlock`）、`canvas-store.ts:1271-1305` |
| 4 | 单元素有效 rect 有统一函数（`entityCardRect` / `audioBlockRect` / 元素几何），命中/选区/锚点同源 | `canvas-pomelo-plugin.ts:71-81`、`canvas-store.ts:255-270` |
| 5 | 生成 UI 的主场是右侧 320px dock 的属性面板，「手动生成」区在这里 | `canvas-detail-panel.tsx:119`、`panel/media-editor.tsx:221-223` |
| 6 | 图片/音频**直生**：`GenerationRecipe.submit()` 内联 `POST /v1/media/jobs` + 轮询 + 采用（逻辑写在组件里，无 store 动作） | `panel/media-editor.tsx:590-665` |
| 7 | 视频**走提案门**：`createProposal` 落 proposed 资产，面板据 asset 状态切到确认台 | `panel/media-editor.tsx:595-608`、`canvas-store.ts:4044-4205` |
| 8 | 配方草稿按元素持久化（切换/卸载后恢复），并做 AI 素材 metadata 回填 | `panel/element-recipe-draft-store.ts`、`panel/media-editor.tsx:475-566` |
| 9 | 已有 guided 动作注册表（九类/四产出/subject entity·media/priority/requires），但只把提示词交给**全局 AI 输入框**（`setDraft`），不是节点级执行 | `lib/world-entity/guided/{types,registry,media-actions,entity-actions}.ts` |
| 10 | 共享生成组件齐备：`RichComposer`（@ 引用）、`ModelPicker`、`RecipeParameters`、`AssetReferenceDialog`、`WorldMediaPicker`、`ProposalEditor` | `components/*`、`panel/world-media-picker.tsx` |
| 11 | 素材状态机 `proposed/generating/ready/failed` 与轮询/实时通道已就绪 | `canvas-asset-status.ts` |
| 12 | 素材 provenance：`origin` ∈ `generated`/`user-upload`/`motion-graphic`，`metadata` 带 `proposal`/`modelId`/`referenceIds` | `service/media/assets.go:913/1400/1686`、`app/media/media-types.ts:16-57` |
| 13 | 目前**没有**通用「节点浮层工具栏」；每节点浮层只有文本全屏按钮、视频悬停播放、`+` 连线手柄、resize 手柄 | `canvas-text-fullscreen-entry.tsx`、`plugins/video-preview-plugin.ts`、`canvas-pomelo-plugin.ts:191-214` |

结论：底座（锚定 math、hover/selection、rect 真源、状态机、共享表单组件、guided 动作表）全部具备；缺的是**一个把工具栏与输入框作为可插拔 overlay 挂到节点上的宿主 + 统一的提交动作**。

## 2. 决策

### 2.1 两个独立插件

工具栏与输入框是**两个独立的 overlay 插件**，各自由 `match(ctx)` 决定是否出现、由 `render(ctx)` 渲染，互不依赖：

- `kind: "toolbar"`：节点工具栏（top）。无适用操作 → 不渲染（用户要求：没有也可以先不显示）。
- `kind: "composer"`：节点生成输入框（bottom）。仅在 subject 可生成且**内容条件命中**时渲染。

两者注册进同一个 `NodeOverlayRegistry`，宿主 `CanvasNodeOverlays` 统一解析并挂载（见 §3.1）。平台/App 也可注册自己的 overlay 插件（如把某工作流作为一节工具项），沿用同契约。

### 2.2 宿主与定位

新增 `CanvasNodeOverlays`，渲染在 `canvas-pomelo.tsx` 宿主根内、与 `CanvasInlineEditor` 同层（`canvas-pomelo.tsx:1248` 附近）。定位复用既有屏幕空间范式：

```
const t = editor.renderAdapter.transform;            // {x,y,scale}
const rect = effectiveRectOf(blockId);                // 世界坐标有效矩形
toolbar: { top: rect.y*t.scale + t.y - TB_H - GAP, left: centerX - TB_W/2 }
composer:{ top: (rect.y+rect.height)*t.scale + t.y + GAP, left: centerX - CMP_W/2 }
```

- 订阅 `adapter.onTransformEvent` + `store.selection/selectedIds/hoveredBlockId/dataVersion/draggingBlockId` 触发重排。
- 视口边缘：左右 clamp 到宿主内边距；下方空间不足则**翻转到节点上方**（工具栏同理翻到下方）。
- 层级：工具栏 `z-20`、输入框 `z-30`；低于对话框/右键菜单（`z-[70]+`）。
- 指针：`onMouseDown`/`onPointerDown` 一律 `stopPropagation`，避免触发画布 pan/select（同 `canvas-text-fullscreen-entry.tsx:104-108`）。

### 2.3 工具栏：按节点类型的基础常用操作

工具栏渲染「适用动作」的**前 N 项**（N≈6，超出收进「更多」下拉）。动作来源两类：

1. **`GuidedAiAction` 适配**（prompt 型）：把现有 guided 动作表按 subject 过滤/排序后，取前几项；点击 = 把生成提示词**种进该节点输入框**（而非全局 AI）。沿用 `actionsFor` / `rankActions` 的过滤与排序。
2. **直接操作**（direct 型）：不生成、立即执行——下载、全屏/预览、删除、换素材、首尾帧拆分、音视频分离等，落到既有能力或对话框。

**无适用操作 → 不渲染工具栏。** 剪贴板/缩放等全局能力不在此列（归全局 Header）。

各类节点的基础常用操作候选（详见 §5）——先做**能稳定复用现有能力**的子集，其余标为后续：
- 图片节点：高清/放大、变体、局部重绘、全局重绘、主体分离/抠图、扩图、生成三视图/设定卡、以图为参考、下载、全屏、换素材、删除。
- 视频节点（demo）：高清、片段重拍、逐帧拉片、智能去字幕、音视频分离、主体消除、创意片头、首尾帧拆分、下载、全屏、删除。
- 音频节点：转写/字幕、换声线、降噪、人声/伴奏分离、试听、下载、删除。
- 实体卡：生成角色卡/场景卡/道具卡、生成三视图、补全设定、一致性检查、重命名、进入容器、删除。

### 2.4 输入框：内容驱动的显示条件

**显示当且仅当** `subject` 可生成媒体**且**满足：

| 条件 | 判定 | 行为 |
|---|---|---|
| **空内容** | 媒体元素无 `props.assetId` 且无 `props.url`（空白媒体卡） | 显示输入框，capability 由模态推断；提交 = 首次生成并采用 |
| **已是 AI 生成内容** | 绑定资产 `origin === "generated"`/`"motion-graphic"`，或 `status === "proposed"`，或 `metadata.proposal`/`metadata.modelId` 存在 | 显示输入框，从资产 metadata 回填配方；`generated` = 再生成；**`proposed` = 输入框直接改该提案配方（原位）+ 确认提交** |
| **手动上传内容** | 绑定资产 `origin === "user-upload"` 且无生成配方 | **默认不显示**（不打扰、不误触发再生成）；需要时走右侧面板「高级」 |
| 无内容且无选中 | —— | 不显示（工具条 hover 时可给一个「＋生成」入口，见 §4） |

"已经是 AI 生成的内容"直接落到既有事实：`Asset.origin`（`generated`/`motion-graphic`）与 `metadata.proposal`/`metadata.modelId`；`proposed` 资产一律视为 AI 内容（含视频待确认提案）。

### 2.5 可见性总规则

在 §2.4 基础上叠加：

- 仅对**单选** subject 显示（`selectedIds.length <= 1`）；多选一律隐藏。
- `readOnly` world 隐藏；`aiLocked`（AI 编辑中）隐藏；拖拽/resize（`draggingBlockId` 非空）隐藏。
- 视口缩放 `<= LOW_DETAIL_SCALE` 隐藏（与文本全屏入口一致）；节点完全移出视口隐藏。
- 就地编辑进行中（`inlineEdit` 非空）隐藏工具栏（避免与编辑器抢焦点）；媒体 subject 与文本就地编辑天然不冲突。
- 切换节点时输入框按 `editorKey = elementId` 重置本地编辑态（与 `ProposalEditor` 同规则）。

### 2.6 与右侧面板的关系（降级不重复）

- **输入框成为唯一主提交面**：prompt、参考、模型/参数、提交/确认都在节点输入框完成。
- **右侧面板保留**：预览、素材来源（素材库/本地上传/清除）、名称、素材历史，以及**「高级参数」折叠区**（模型/参数/声音，仍读写同一 `element-recipe-draft-store`，但**不再有提交按钮**）。
- 若节点不在视野，面板提供「定位到节点」按钮（`centerContent` / `fitSelection`）后由输入框提交。
- **不重复提交路径**：直生与提案提交统一收敛为 store 动作（§2.7），面板的高级区与节点输入框共用。

### 2.7 提交路径统一（消除组件内联逻辑）

现状图片/音频的 `POST /v1/media/jobs` + 轮询 + 采用写在 `GenerationRecipe` 组件里（`media-editor.tsx:590-665`）。收口为 store 动作：

- `runMediaJob(elementId, request)`：图片/音频直生——`buildGenerationRequest` → `POST /v1/media/jobs` → 挂载预建 pending 素材（`onAdopt`）→ 轮询 → 终态采用并 `record` 历史。
- `submitNodeGeneration(elementId, recipe)`：按 capability 分流——video 走 `createProposal`；其余走 `runMediaJob`。
- `updateNodeProposal(elementId, patch)`：**提案态输入框改配方**——`PATCH /v1/media/assets/:id/proposal` 原位更新（复用同一 `assetId`，去抖落盘）；计划态（proposed 无配方）填入配方即成为可确认提案。
- `confirmNodeProposal(elementId)`：包装既有 `confirmProposal`（视频唯一花钱动作；失败态沿用「复制成新提案再确认」）。

节点输入框与右侧面板高级区都调用这些动作；`GenerationRecipe` 组件内的内联提交/轮询退役或改为薄封装。**提案态（proposed）下输入框可改配方并直接确认提交——这是必要且合理的主路径**，不是被排除的能力。

## 3. 契约

### 3.1 NodeOverlay 注册表

新增目录 `web/app/worlds/[worldID]/canvas/overlays/`：

```ts
// overlays/types.ts
export type NodeOverlayKind = "toolbar" | "composer";

export type NodeOverlayContext = {
  blockId: string;                 // entity:<id> | 元素 id
  subject: GenerationSubject;      // §3.4
  presence: "selected" | "hovered";
  worldId: string;
  contextId: string;
  readOnly: boolean;
  aiLocked: boolean;
  scale: number;
};

export type NodeOverlayPlugin = {
  id: string;
  kind: NodeOverlayKind;
  /** 是否对该 subject 出现；缺省 false */
  match: (ctx: NodeOverlayContext) => boolean;
  /** 排序（大者靠前/靠上）；缺省 0 */
  priority?: number;
  render: (ctx: NodeOverlayContext) => ReactNode;
};

// overlays/registry.ts
export function registerNodeOverlay(plugin: NodeOverlayPlugin): () => void;
export function nodeOverlaysFor(ctx: NodeOverlayContext): { toolbar: NodeOverlayPlugin[]; composer: NodeOverlayPlugin[] };
```

内置两个插件：`guidedToolbarPlugin`（§3.2）、`generationComposerPlugin`（§3.3）。注册表纯函数可单测；React 宿主 `NodeOverlays` 负责解析 + 定位 + 挂载。

### 3.2 节点动作（工具栏）契约

```ts
// overlays/actions.ts
export type NodeActionKind = "prompt" | "direct" | "menu";

export type NodeAction = {
  id: string;
  subject: "media" | "entity";
  kind: NodeActionKind;
  icon: string;
  label: string;
  labelEn?: string;
  desc?: string;
  /** 适用模态；缺省全部 */
  modalities?: MediaModality[];
  /** 适用实体类型；缺省全部 */
  typeIds?: EntityKind[];
  /** 可执行性门禁（如未就绪素材禁「高清」） */
  enabled?: (ctx: NodeOverlayContext) => { ok: boolean; reason?: string };
  /** prompt：种进节点输入框；direct：立即执行；menu：打开既有对话框 */
  run: (ctx: NodeOverlayContext) => void | Promise<void>;
};
```

现有 `GuidedAiAction` 经 `guidedToNodeAction()` 适配为 `kind:"prompt"`（`run` = `store.openNodeComposer(elementId, { prompt, references })`）。直生操作如「下载」「全屏」实现为 `kind:"direct"` 的新动作。

### 3.3 生成输入框插件契约

```ts
// overlays/composer.tsx
export const generationComposerPlugin: NodeOverlayPlugin = {
  id: "generation-composer",
  kind: "composer",
  match: (ctx) => ctx.subject.kind === "media-element" && composerEligible(ctx.subject) /* §2.4 */,
  render: (ctx) => <NodeGenerationComposer ctx={ctx} />,
};
```

`NodeGenerationComposer` 布局（自上而下）：
1. **参考行**：`参考` 按钮（素材库）+ `World` 按钮（`WorldMediaPicker`）+ 参考缩略图（role 标签，来自 `references`）。
2. **提示词**：`RichComposer`（`mode="referencing"`，@ 引用素材/世界实体，自动并入 references）。
3. **底栏**：能力/模态（由 subject 推断，只读展示）· `ModelPicker` · `RecipeParameters`（紧凑）· 声音选择（音频）· 提交按钮（`生成` / `再生成` / `确认生成` / `生成视频提案`）· 全屏展开（进右侧面板高级区）。
4. 状态区：`proposed`（有配方）→ 输入框编辑配方原位生效 + 「确认生成」；`proposed`（无配方 / 计划态）→ 输入框填入配方后变为可确认提案；`generating` → 生成中；`failed` → 失败 + 重试（复制成新提案）。

复用（不新造表单）：`components/proposal-editor.tsx`、`components/rich-composer`、`components/model-picker.tsx`、`components/recipe-parameters.tsx`、`components/asset-reference-picker.tsx`、`panel/world-media-picker.tsx`；草稿走 `element-recipe-draft-store`。

### 3.4 GenerationSubject 解析（纯函数）

```ts
// overlays/subject.ts
export type GenerationSubject =
  | {
      kind: "media-element";
      elementId: string;
      modality: MediaModality;            // image | video | audio
      assetId?: string;
      url?: string;
      asset?: Asset;                      // 来自 canvas-asset-status store（有 assetId 时）
      empty: boolean;                     // 无 assetId 且无 url
      aiGenerated: boolean;               // §2.4
      color?: ...;                        // 既有
      owningEntity?: WorldEntity;         // attr 媒体卡所属实体
      attrLabel?: string;                 // attr 媒体卡属性名
    }
  | { kind: "entity"; entityId: string; entity: WorldEntity; mediaRefs: MediaRef[] };

/** 由 blockId + store 快照解析；无法解析返回 null */
export function generationSubjectOf(state, blockId): GenerationSubject | null;
/** 输入框资格：空内容 || 已是 AI 生成内容 */
export function composerEligible(subject: GenerationSubject): boolean;
/** AI 生成判定：origin generated/motion-graphic || proposed || proposal/modelId */
export function isAiGeneratedAsset(asset: Asset): boolean;
```

subject 覆盖三类主体：独立媒体元素（`kind=media`）、属性媒体卡（`kind=attr` + `props.media` ∈ image/video/audio）；实体卡只出工具栏，不出输入框（v1）。

### 3.5 store 新增/收敛动作

```ts
// canvas-store.ts
openNodeComposer(elementId: string, seed?: Partial<RecipeDraft>): void; // 种提示词 + 聚焦输入框
runMediaJob(elementId: string, request: GenerationRequestInput): Promise<void>;
submitNodeGeneration(elementId: string, recipe: GenerationRecipeInput): Promise<void>;
updateNodeProposal(elementId: string, patch: Partial<GenerationProposal>): Promise<void>; // 提案态改配方（原位）
confirmNodeProposal(elementId: string): Promise<void>;
```

`openNodeComposer` 只写 `element-recipe-draft-store` 并选中元素（不新建持久状态）；输入框随选中自然出现。

## 4. UI / 交互细节

```
        ┌───────────────────────────────────────────────┐
        │  [+] [高清] [重拍] [拉片] …            [更多 ▾] │  toolbar (top, hover/selected)
        └───────────────────────────────────────────────┘
                         ┌───────────────────┐
                         │   节点（image / video / audio）   │
                         └───────────────────┘
        ┌───────────────────────────────────────────────┐
        │ [参考][World]  ○○○○○                           │
        │ ┌───────────────────────────────────────────┐ │  composer (bottom, selected)
        │ │ prompt（RichComposer, @ 引用）             │ │
        │ └───────────────────────────────────────────┘ │
        │ 图片 · 模型 ▾ · 参数 ▾ ·        2.5  ◉  [生成] │
        └───────────────────────────────────────────────┘
```

- **工具栏触发**：hover 或单选选中即出现；指针移入工具栏加宽限（复用 `canvas-text-fullscreen-entry.tsx` 的 pin/hoverGrace 机制），避免从节点移向按钮时闪退。
- **输入框触发**：仅单选选中出现（不用 hover，避免悬停即弹大面板）；空内容节点 hover 时给一枚轻量「＋生成」入口，点击 = 选中并聚焦输入框。
- **翻转/clamp**：下方空间不足翻到节点上；左右越界 clamp。
- **低缩放**：`<= LOW_DETAIL_SCALE` 全隐。
- **键盘**：输入框内 `⌘↵` 提交、`Esc` 收起（退化为不选中？保持选中但失焦）；不影响画布既有快捷键（输入框聚焦时 `canvas-pomelo-plugin.ts` 的 `onKeyDown` 需让路，同 `RichComposer` 惯例）。
- **多选/拖拽/只读/AI 锁**：一律隐藏。
- **响应式**：composer 宽度 `min(520, 视口宽-32)`，窄屏纵向堆叠；demo（移动端比例）友好。

## 5. 工具栏基础操作目录（候选，按节点类型）

图例：`P`=prompt（种进输入框）、`D`=direct（立即执行）、`M`=menu（既有对话框）。

| 节点 | 操作 | 类型 | 复用/备注 |
|---|---|---|---|
| 图片 | 高清 / 放大 | M | guided `transform`；后续接 upscale 能力 |
| 图片 | 生成变体 | P | guided `media.siblings`/`variation` |
| 图片 | 局部重绘 | P | 需蒙版，后续 |
| 图片 | 主体分离 / 抠图 | M | 后续接 remove-background |
| 图片 | 扩图 | P | guided |
| 图片 | 生成三视图 / 设定卡 | P | guided `media.card.*` |
| 图片 | 以图为参考 | P | 选中为参考 → 种进输入框 references |
| 图片 | 全屏 / 下载 / 换素材 / 删除 | D | 既有预览弹框 / `AssetPreviewDialog` |
| 视频 | 高清 | M | 后续 |
| 视频 | 片段重拍 | P | 需片段范围，后续 |
| 视频 | 逐帧拉片 | P/M | 复用 `recut.media.contactSheet` / `frames` 能力（后续） |
| 视频 | 智能去字幕 | M | 后续 |
| 视频 | 音视频分离 | M | 后续 |
| 视频 | 主体消除 | M | 后续 |
| 视频 | 创意片头 | P | guided |
| 视频 | 首尾帧拆分 / 续接 | P | `gridSlice`/首尾帧协议 |
| 视频 | 全屏 / 下载 / 删除 | D | 既有 |
| 音频 | 转写 / 字幕 | M | 复用 audio-studio transcript 链路 |
| 音频 | 换声线 / 变声 | P | speech.generate + voice |
| 音频 | 降噪 / 人声伴奏分离 | M | 后续 |
| 音频 | 试听 | D | `AudioWaveformPlayer` |
| 音频 | 下载 / 删除 | D | 既有 |
| 实体卡 | 生成角色卡/场景卡/道具卡 | P | guided `entity.*` |
| 实体卡 | 补全设定 / 一致性检查 | P | guided `text`/`qc` |
| 实体卡 | 重命名 / 进入容器 / 删除 | D | 既有 |

**v1 落地子集**：只上线「能稳定复用现有能力」的项——所有 `D`（全屏/下载/试听/换素材/删除/重命名/进入容器）+ guided 适配的 `P`（设定卡/补全设定/以图为参考）。其余 `M` 标注「后续」；无适用项则工具栏整体不显示（满足用户要求）。

## 6. 改动面

| 文件 | 变更 |
|---|---|
| `web/app/worlds/[worldID]/canvas/overlays/types.ts` | 新增：`NodeOverlayKind` / `NodeOverlayContext` / `NodeOverlayPlugin` 等契约 |
| `.../canvas/overlays/registry.ts` | 新增：`registerNodeOverlay` / `nodeOverlaysFor`（纯函数，配 `node:test`） |
| `.../canvas/overlays/subject.ts` | 新增：`generationSubjectOf` / `composerEligible` / `isAiGeneratedAsset`（纯函数，配单测） |
| `.../canvas/overlays/actions.ts` | 新增：`NodeAction` 目录 + `guidedToNodeAction` 适配 |
| `.../canvas/overlays/toolbar.tsx` | 新增：内置工具栏插件（含 `/` 更多下拉、pin/hoverGrace） |
| `.../canvas/overlays/composer.tsx` | 新增：内置输入框插件 `NodeGenerationComposer` |
| `.../canvas/overlays/node-overlays.tsx` | 新增：宿主 `CanvasNodeOverlays`（解析 + 屏幕空间定位 + 翻转/clamp） |
| `.../canvas/canvas-pomelo.tsx` | 在宿主根挂 `<CanvasNodeOverlays/>`（邻接 `CanvasInlineEditor`），订阅 transform/dataVersion/selection |
| `.../canvas/canvas-store.ts` | 新增 `openNodeComposer` / `runMediaJob` / `submitNodeGeneration` / `confirmNodeProposal`（收敛组件内联提交/轮询） |
| `.../canvas/panel/media-editor.tsx` | `GenerationRecipe` 提交改调 store 动作；「手动生成」区降级为「高级参数」（无提交按钮）+「定位到节点」；图片/音频轮询逻辑移出组件 |
| `.../canvas/panel/element-recipe-draft-store.ts` | 复用（若需支持 token 级 references 种入，小幅扩展） |
| `.../canvas/README.md` | 新增 overlays/ 成员与可见性规则说明 |

多数改动为前端新增；**零服务端端点/表改动**（生成、提案、素材均为既有能力）。

## 7. 不做（明确划线）

- **不改提案生命周期本身**：`proposed → queued → running → completed`、确认复用同一 `assetId`、Agent 不得代确认（rfc 2026-09-16 不变）。**但提案态输入框必须能改配方并确认提交**（§2.7，这是必要主路径）：`proposed` 下编辑走 `PATCH …/proposal` 原位更新，确认走 `POST …/confirm`，二者都由用户在节点输入框发起。
- **不新增服务端端点/表**：不引入节点级生成表；产物仍是节点上的 media 属性/媒体元素，配方仍在 `asset.metadata.proposal`。
- **不做节点流程图/执行引擎**：overlay 只是入口，不建依赖图执行。
- **不自动生成**：一切提交由用户触发；工具栏 `P` 只种提示词，不自动发送。
- **不动全局 AI 输入框**：节点输入框是节点级作用域；guided 动作的全局 `setDraft` 路径保留（面板内）。
- **不重做右侧面板**：只降级生成区为高级参数，其余（来源/历史/属性）保留。
- **v1 不覆盖实体卡的输入框**：实体卡只出工具栏（`P` 种入全局或后续节点输入框），多属性生成留后续。
- **不做移动端专项适配**：仅保证窄屏可用（响应式），不重做触控范式。

## 8. 验收

- **空内容图片节点**：选中 → 节点下方出现输入框（capability=image）→ 填 prompt + 参考 → 生成 → 元素挂上 pending 素材并显示「生成中」→ 就绪后原位切真实图；输入框转为 AI 内容态（可再生成）。
- **手动上传图片节点**：选中 → **不出现**输入框；右侧面板高级区仍可访问。
- **视频节点（提案态改配方 + 确认）**：选中 → 输入框提交 → 落 `proposed` 提案 → 输入框**直接编辑该提案**（prompt/参考/模型/参数，原位 `PATCH`）→ 点「确认生成」→ 转 `generating` → `ready`；确认权只在用户（Agent 不能代替确认）。计划态（proposed 无配方）在输入框填入配方后变为可确认提案。
- **重新生成**：AI 生成节点选中 → 输入框按 `asset.metadata` 回填 prompt/模型/参数/参考；改后提交 = 新一笔（视频先提案）。
- **工具栏**：图/音/视频/实体卡分别出现对应基础操作；无适用项（如纯文本元素、关系边、world 节点）→ **工具栏不显示**；`P` 点击把提示词种进输入框（不自动发送）。
- **定位与稳定性**：平移/缩放时工具栏与输入框始终贴住节点；下方空间不足自动翻转到上方；点击工具栏/输入框不触发画布 pan/select；多选/拖拽/只读/AI 锁/低缩放一律隐藏；切换节点时输入框内容正确重置。
- **回归**：右侧面板预览/来源/历史/高级参数可用；`make web-build` 通过；新增纯函数单测（subject/eligibility/registry）通过；`go test ./service/...` 不受影响。

## 9. 以后可选

- **实体卡输入框**：对实体卡开放多属性/多产物生成（一次生成回写多个 media 属性）。
- **App/平台 overlay 插件**：把 ComfyUI/Modal 工作流作为工具栏一节（沿用 `NodeAction`/registry）。
- **批量生成**：多选同类节点后统一提交（输入框移到选择集锚点）。
- **Agent 预填**：AI 在画布上主动种提示词并高亮「建议生成」入口（仍由用户提交）。
- **工具栏动作目录外置**：把 §5 目录做成可按世界/类型配置的数据（类似 `ai_actions_json`）。
- **更丰富的直接操作**：把「首尾帧拆分 / 逐帧拉片 / 音视频分离」等接上平台媒体工具（`media.clip`/`frames`/`gridSlice`）。

## 10. 实施分期

- **M0（地基）**：`overlays/` 契约 + registry + subject + 宿主 `CanvasNodeOverlays` + 定位/翻转/可见性门；仅渲染空壳。
- **M1（输入框）**：`NodeGenerationComposer`（复用 ProposalEditor/GenerationRecipe 组件）+ store `runMediaJob/submitNodeGeneration/confirmNodeProposal`；图片/音频直生 + 视频提案贯通；右侧面板生成区降级为高级参数。
- **M2（工具栏）**：`NodeAction` 目录 + `guidedToNodeAction` + v1 direct 子集（全屏/下载/试听/换素材/删除/重命名/进入容器）；`P` 种入输入框；无适用项隐藏。
- **M3（打磨）**：翻转/clamp/pin/hoverGrace、快捷键、窄屏响应式、单测与验收。

## 11. 实施记录

分支 `feat/world-canvas-node-generation-overlay`（2026-10-07）。已实施 M0–M2：

- **M0 地基（`web/app/worlds/[worldID]/canvas/overlays/`）**
  - `types.ts`：`NodeOverlayKind`/`NodeOverlayContext`/`NodeOverlayPlugin`/`OverlaySubject` 契约。
  - `subject.ts`：`isAiGeneratedAsset`（`origin=generated/motion-graphic` || `status=proposed` || `metadata.generation/modelId`）、`mediaModalityOfElement`、`generationSubjectOf`、`composerEligible`（纯函数）。
  - `registry.ts`：`registerNodeOverlay`/`nodeOverlaysFor`/`resetNodeOverlays`（纯函数）。
  - `node-overlays.tsx`：宿主 `CanvasNodeOverlays`——单选/hover 解析 block → subject，屏幕空间锚定（`transform` 重排、上下翻转 + 左右 clamp、`LOW_DETAIL_SCALE`/只读/AI 锁/拖拽/多选隐藏、hover 宽限）；挂进 `canvas-pomelo.tsx` 根（`<CanvasNodeOverlays/>`，邻接 `CanvasInlineEditor`）。
- **M1 输入框**
  - `composer.tsx`：`generationComposerPlugin` + `NodeGenerationComposer`——参考（素材库/当前 World）+ 提示词 + `ModelPicker`/`RecipeParameters` + 提交/确认；复用 `element-recipe-draft-store` 与 metadata 回填。提案态：编辑走 `updateProposal`（PATCH 原位），「确认生成」走 `confirmProposal`；图片/音频直生走 `runMediaJob`，视频走 `createProposal`。
  - `canvas-store.ts`：新增 `runMediaJob`（+ 模块级 `pollMediaJob`）与 `openNodeComposer`（种提示词 + 选中）。
  - `panel/media-editor.tsx`：「手动生成」改为「生成（高级）」+「在节点上生成」（选择节点即挂出输入框）；面板内联提交暂留作兜底（收口为薄封装留待 M3）。
- **M2 工具栏**
  - `actions.ts`：`NodeAction` 目录 + `nodeActionsFor`（媒体：预览/下载/换素材/删除；实体：进入/重命名/删除）。
  - `toolbar.tsx`：`nodeToolbarPlugin`（节点上方图标条，无适用项不显示）。
- **M3 输入框参数重构（2026-10-07）**：新增 `web/components/compact-parameters.tsx`（`CompactParameters`）——把 `ModelParameter` 渲染成底栏里的一排紧凑 chip（枚举=下拉菜单、布尔=开关 chip、数值/文本=小气泡输入，失焦/回车提交 + 夹 min/max），不再用整行「生成参数」表单；composer 底栏 = 模型 chip + 参数 chip + 提交，核心输入框保持整洁。`OverlaySurface` 增 `data-node-overlay`/`data-overlay-block` 测试钩子。
- **验证**：`web` 侧 `npx tsc --noEmit` 在新增/改动文件零错误（`timeline-editor/` 的 40 条为既有历史错误）；`npm test` 115/115 通过（新增 `overlays/subject.test.ts`、`overlays/registry.test.ts` 9 条）；`package.json` test glob 增 `app/worlds/**/*.test.ts`；`canvas/README.md` 增 overlays 成员说明。**浏览器 E2E（Playwright + Chrome/WebGPU，对一次性世界）PASS**：① 空图片媒体节点选中 → 输入框 + 工具栏（预览/下载/换素材/删除）出现，输入框在节点下方；② 取消选中 → overlay 全隐；③ 手动 URL 素材（非 AI、非空）→ 输入框不显示、工具栏仍在；④ 底栏渲染模型 chip + 紧凑参数 chip（aspectRatio/1k/medium/png）。**未动服务端**（生成/提案/素材均为既有能力）。

后续（M3）：面板 `GenerationRecipe` 提交收口为薄封装；键盘快捷键；真正上位图的 `RichComposer` @ 引用；hover-only 工具栏体验打磨；`make web-build` 全量构建验收。

### 11.1 迭代补丁（2026-10-07，按反馈）

- **@ 面板定位修复**：宿主 overlay 原用 CSS `transform` + `backdrop-blur` 定位，成为富文本 @ 面板 `position: fixed` anchor 的 containing block，导致 @ 面板飞到画布右下角。改为**量尺寸 + left/top 定位**（`OverlaySurface` 去 transform）并去掉 composer 卡的 `backdrop-blur`。
- **输入框**：核心提示词改 `RichComposer`（`mode=referencing`，@ 引用素材/世界实体）；右上角**全屏编辑**入口（大尺寸稳定输入/选表单）；底栏单行 = 模型 chip · **核心参数（分辨率/尺寸/画幅）chip** · 高级设置（其余 schema 参数用 `RecipeParameters` 在弹层内）· 生成；参数 chip 用**图标替代长属性名**（`compact-parameters.tsx`）；核心判定改**分词+词表**（修 `durationSeconds` 误命中 `ratio`）。
- **生成语义**：**点击即直接生成**（`runMediaJob`，图片/视频/音频同一路径），**不再落提案**；提案态按钮显示「生成」而非「再生成」；属性面板**删除「生成（高级）」区**（与节点输入框重复）。
- **参考**：composer 参考缩略图点击 → 按 id 拉完整素材进 `AssetPreviewDialog` 放大（修「图片被当视频、显示错素材」）；`WorldMediaPicker` 加**当前画布 / 当前 World 两个 Tab**（World 拉整库实体 media 属性）、**剔除 proposed 提案**、封面按资产 kind/name 校正、悬停放大预览。
- **实体/媒体工具栏**：新增「**AI**」二级菜单（用 AI 完善的动作下拉，点击预填全局输入框，实体/媒体共用）；实体新增「**设置封面**」（素材库选择写回 `saveEntityField` 的 cover）；属性面板**移除**「用 AI 完善」区（实体 panel 去 `guided`、元素 panel 去 `GuidedAiSection`）与元素「删除」按钮。
- **@ 面板预览**：预览 effect 只依赖 `highlightedKey`（`optionRows/sourceFor` 走 ref），修 hover 时请求被反复取消导致右侧详情空白。
- **E2E（Playwright + Chrome/WebGPU，一次性世界）**：空图片节点 → 输入框 + 工具栏 + 全屏按钮；`@` 面板贴近输入框（top≈177，非右下角）；全屏弹层可编辑；属性面板无「生成（高级）」；实体工具栏 = AI/设置封面/进入/重命名/删除；媒体工具栏 = AI/预览/下载/换素材/删除，AI 菜单 14 项；两面板均无「用 AI 完善」；无 pageerror。`tsc` 40 条既有错误不变；`npm test` 115/115。
