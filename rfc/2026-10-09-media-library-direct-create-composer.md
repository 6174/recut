# 素材库直接生成输入框（Media Library Direct-create Composer）

> 状态：实施中
> 日期：2026-10-09
> 影响面：`web/app/media/*`（前端单页），零 service / 服务端契约改动

## 1. 背景与问题

素材库（`/media` 与主工作台 `assets` Tab）当前的「新建」是两个入口：

- 右上角 `上传素材` 按钮（`media-library-panel.tsx:256`）；
- 右上角 `＋ 创建 ▾` 下拉（`Popover` + `createKinds`），选择「创建图片 / 创建视频 / 创建音频」后弹出一个**居中模态 `CreateAssetDialog`**（`media-library-panel.tsx:350`）。

问题：

1. **入口远离内容**：创建是素材库最高频动作，却藏在右上角二级菜单里；用户要「看图 → 想生成 → 跑去找菜单 → 开模态 → 关模态」，动线被打断。
2. **与 World 画布割裂**：World 画布已把生成收口到「节点下方内联生成输入框」（RFC `2026-10-07-world-canvas-node-generation-overlay.md`），同样的能力在素材库却退回模态弹框，两套交互、两处维护。
3. **模态遮住素材**：生成时想参考网格里已有的图，模态把素材盖住了。
4. **缺 Motion Graphic 入口**：素材库能筛选 `component`，但没有任何「创建组件 / 动效」入口；MG 属于「必须交给 Agent 探索」的复杂创作，不该套进「选模型 → 填 prompt → 直生」的表单。

目标：把创建入口从右上角搬到**内容区中间底部**，做成随页面滚动的内联输入框（对齐 World 画布 composer 的形态），直接在素材网格上创作。

## 2. 决策

### D1 · 入口迁移：右上角「创建」下拉删除，改为底部内联 composer

删除 `WorkspacePageHeader` 里的 `＋ 创建 ▾` `Popover`。新增 `MediaCreateComposer`，**停靠在素材库内容区的底部中央**（`position: sticky; bottom: 0`），随 `[data-workspace-scroll]` 滚动容器常驻可见。`上传素材` 保留在 Header（同属「导入已有字节」，与「生成新素材」语义不同，不合并）。

### D2 · 四模态：图片 / 视频 / 音频 / 动作图形

composer 底栏左侧为「生成类型」**下拉**（不再用纵向 rail/tab），四个模态：

| 模态 | capability | 提交语义 |
| --- | --- | --- |
| 图片 | `image.generate` | `POST /v1/media/jobs`（直生） |
| 视频 | `video.generate` | `POST /v1/media/proposals`（落待确认提案，用户在卡片确认后才花钱） |
| 音频 | `speech.generate` | `POST /v1/media/jobs`（直生） |
| 动作图形（MG） | 无 | **不提交生成**；点击按钮把引导 prompt 填进左侧全局 chat（`setDraft`，不自动发送） |

前三个模态完全复用既有生成语义与门禁（模型 / 凭据 / 参考 / 提案），**不改服务端契约**。

### D3 · MG 走左侧全局 chat，不进生成表单

MG 没有「一次性生成」的配方（平台 MG 是 `motion-graphic.create` 的受限作者子 Agent 流程，需要探索 / 多镜 / 视觉迭代）。素材库的 MG 入口只负责**把用户意图接到左侧全局 chat**：

- 点击 rail 的「动作图形」后，composer 隐藏模型 / 参数 chips，只留 prompt；
- 点击生成 → `useAgentPanelContext.getState().setDraft({ id, text })` 填入一段引导 prompt（沿用 World 画布 `GuidedAiAction` / `world-onboarding` 的既有模式：**预填不自动发送**，用户可在 chat 里补充后再发）；
- prompt 为空时填入默认引导（"帮我做一个 motion graphic：…"）；
- 给出一次性提示，说明已交给左侧 Agent。

这与「生成必先导演」的约束一致：MG 属于复杂创作，交由全局 chat 的 Director 链路，而非素材库的单点表单。

### D4 · 复用 World 画布 composer 的原子，不重复造轮子

prompt 用 `RichComposer`（`mode="referencing"`，支持 `@` 引用素材）；底栏用 `ModelPicker` + `CompactParameters`（核心参数）+ `RecipeParameters`（高级）+ `AssetReferenceDialog`（参考素材，可上传）。这些正是 `overlays/composer.tsx` 用的原子，素材库 composer 与画布 composer 同源，降低长期维护成本。

### D5 · 生成参数与「再次生成」回填

`asset-preview` 的「再次生成 / Remix」不再打开模态：调用方把配方（modality / modelID / prompt / referenceIds / output）组装成 `MediaCreateDraft` 传给 composer，composer 按 `draft.id` 载入并高亮。素材详情关掉、composer 就绪，用户改完直接提交。

## 3. 交互规格

```
┌─ 素材网格（内容区，随 [data-workspace-scroll] 滚动）────────────────┐
│ …                                                                  │
│                                                                    │
│        ┌─────────────────────────────────────────────┐  ← sticky  │
│        │ [参考缩略图 …] [+ 参考]              [⤢ 全屏] │   bottom   │
│        │ ┌─────────────────────────────────────────┐  │     0      │
│        │ │ 描述你想生成的图片… @                    │  │            │
│        │ │ （更高的输入区）                          │  │            │
│        │ └─────────────────────────────────────────┘  │            │
│        │ [生成类型▾][模型▾][参数][高级]      [生成]    │            │
│        └─────────────────────────────────────────────┘            │
└────────────────────────────────────────────────────────────────┘
```

- **参考行在输入框上方**（对齐 World 画布 composer）：缩略图（`size-9`）+「参考」按钮（`AssetReferenceDialog`，`allowUpload`）；支持 `onPasteFiles` 粘贴图片；缩略图点击用 `AssetPreviewDialog` 放大。
- **prompt**：`RichComposer` `variant="field"`、默认 `minRows=4` / `min-h-[120px]`（比原 `minRows=2` 更高），`@` 打开统一上下文面板引用素材。
- **底栏**：生成类型下拉 → 模型（`ModelPicker`，按当前 capability 过滤）→ 音色（仅音频，`CustomSelect`）→ 核心参数（`CompactParameters`）→ 高级（`Popover` + `RecipeParameters`）→ 占位 → 生成按钮（`bg-primary`）。
- **全屏编辑**：右上角 `Maximize2`，`createPortal` 打开全屏输入（`minRows=12`、`maxRows=40`，更大的输入与参数区），与 World 画布 composer 同构。
- **提交态**：`busy` 时按钮转 `Loader2`；错误就地显示 `text-destructive`。
- **音频**：复用能力级声音分组 `GET /v1/media/capabilities/speech.generate/voices`，音色下拉随提交写入 `output.voiceId`；本机免凭据可省略走默认音，与画布一致。
- **空模型**：显示「没有可用模型」并保留「添加 Provider」入口（复用 `onOpenProviderSettings`）。
- **提交后**：清空 prompt 与参考，保留模型 / 参数；成功 notice 走既有 `setNotice`：「图片任务已提交…」 / 「视频提案已创建，请在卡片上确认生成」。

## 4. 改动面

| 文件 | 变更 |
| --- | --- |
| `web/app/media/media-create-composer.tsx` | **新增**。模态 rail + prompt + 参考 + 底栏 + 提交；导出 `MediaCreateComposer` 与 `MediaCreateDraft`（含 `ComposerModality`）。 |
| `web/app/media/media-library-panel.tsx` | 删除 Header 的 `创建 ▾` Popover 与模态 `CreateAssetDialog`；新增 `composerDraft` 状态与 `MediaCreateComposer` 挂载；`openRegeneration` 改为组装 `MediaCreateDraft`；`onSubmitted` / `onProposed` / `upsertAsset` 接线保持。 |
| `web/app/media/reference-assets-field.tsx` | **删除**。仅旧 `CreateAssetDialog` 使用，随模态移除后成为死代码；参考素材改由 composer 的缩略图行 + `AssetReferenceDialog` 承担。 |
| `web/app/media/README.md` | 更新 `media-library-panel.tsx` 描述，新增 `media-create-composer.tsx` 条目。 |
| `rfc/README.md` | 追加本 RFC 摘要。 |

不改：`/v1/media/*` 服务端契约、`media-types.ts`、`asset-grid.tsx`、`asset-preview.tsx`、全局 chat / Agent 面板、生成路由与提案门禁。

数据流：

- composer 从 `media-configuration-store` 读 `providers/credentials/routes`，`load` 一次；
- 提交后回调用 panel 的 `upsertAsset` / `setJobs` / `hydrateSubmittedAssets`，状态仍由单条 SSE 兜底；
- MG 分支只调 `useAgentPanelContext.setDraft`，不碰素材状态。

## 5. 验收

1. 素材库底部常驻 composer，滚动时 sticky 在内容区底部中央，不遮住最后一行（正常滚动到底可见）。
2. 生成类型为**底栏下拉**（非 tab/rail），四模态可切换；切换视频时按钮语义为「落提案」，切换图片 / 音频为直生。
3. 参考按钮与缩略图位于**输入框上方**；参考素材可多选 / 上传 / 粘贴；缩略图可点开放大。
4. 输入框默认高度高于原模态弹框（`minRows=4`）；右上角 `Maximize2` 可打开**全屏编辑**，退出正常。
5. 模型按 capability 过滤，核心 / 高级参数生效；音频按能力声音分组选择音色并提交 `voiceId`；无凭据本地 provider 可提交（keyless）。
6. 视频提交后素材网格出现「待确认生成」提案卡；图片 / 音频提交后出现运行中卡片并实时计时。
7. 素材详情「再次生成 / Remix」把配方回填到 composer（含 modality），无需打开模态。
8. MG 模态点击生成后，左侧全局 chat 输入框被预填引导 prompt，且**不自动发送**。
9. `pnpm -C web lint` 与 `pnpm -C web exec tsc --noEmit` 通过。

## 6. 非目标

- 不改服务端端点、表、提案 / 路由门禁；
- 不引入成本预估（Image 2 的 `✦ 2.75`）——平台模型 `meta.pricing` 是自由文本，无可信数字；
- 不把 MG 的受限作者子 Agent 搬进素材库表单；
- 不做拖拽排序、批量生成、composer 尺寸拖拽；
- 不改 World 画布 composer（只共享原子组件）。

## 7. 风险与未决

- **RichComposer 依赖上下文目录**：素材库不注册 World/实体，`@` 面板只应出现 media 选项；`pinnedOptions` 置顶当前参考。若 `@` 在无 World 语境下出现空分组，退化为 `mode="plain"` + 仅「参考」按钮。
- **sticky 与虚拟网格**：`asset-grid` 用 `[data-workspace-scroll]` 外借滚动容器，sticky composer 作为 `content` 最后一个流内元素，滚动到底时在网格下方占位，不会永久盖住内容；需给网格底部留出视觉呼吸空间。
- **音频音色**：云端 provider 的音色需显式 `output.voiceId`。composer 复用画布媒体编辑器的做法——音频模态下从 `GET /v1/media/capabilities/speech.generate/voices` 拉能力级声音分组（本地 provider 一组 + 云端每凭据一组），模型清单也来自该分组；选中音色随提交写入 `output.voiceId`，本机（免凭据）可省略走默认音。
