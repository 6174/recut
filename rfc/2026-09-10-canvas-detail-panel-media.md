# RFC: World Canvas 右侧详情 Panel — 媒体元素操作能力

- 日期：2026-09-10
- 状态：Draft
- 关联：`docs/world-canvas-prd-v2.md`、`rfc/2026-09-09-unified-entity-model.md`、`rfc/2026-09-09-world-canvas-document-storage.md`
- 范围：`web/app/worlds/[worldID]/canvas/` 下 `canvas-detail-panel.tsx` 及 `panel/*`（重点是 `element-panel.tsx` 的 attr 媒体态）；复用 `web/app/media/*` 的素材库与生成 API，不改 `/v1/media/*` 服务端契约（如需新增能力另行 RFC）。

## 1. 背景与问题

World Canvas 当前选中画布元素（文本框 / 图片 / 视频）后，右侧详情 Panel 几乎没有操作能力：

- attr 媒体元素只显示"元素类型: attr"+"删除"，图片无法预览、更换、生成；
- 图片/视频不能在面板内选择来源（AI 生成 / 素材库 / 本地上传），用户只能双击画布预览；
- AI 生成具有不确定性，往往需要多轮重试，但没有历史记录可回溯、可回调。

竞品参考：
- Recraft（图 2）：生成后右侧保留"生成配方"——完整 prompt（可编辑）、模型/风格、比例、参考图，支持"复用 / 复制"，直接改 prompt 再生成。
- LibLib（图 3）：画布内图下方浮层提供 prompt 输入框 + "本地上传 / 选择生成历史"。

我们的取舍：**不照搬画布内浮层**，把全部来源选择与再生成收敛到右侧详情 Panel（画布上保留双击预览与右键菜单等已有交互）。

## 2. 目标与非目标

### 目标

1. 选中任一媒体元素（独立媒体元素 / 属性边挂的 attr 媒体 / 媒体字段值）时，右侧 Panel 提供完整的"来源 + 内容 + 再生成"操作能力。
2. 图片元素支持三种来源：AI 生成、素材库选择（含选择过程中上传）、本地上传；视频同理（AI 视频生成依赖现有 capability，素材库/上传先支持）。
3. AI 生成走 Job 模式：可多次生成，历史可查看、可切换、可删除。
4. 生成后的 prompt / 模型 / 参数保存在资产上，再次生成时回填可编辑（Recraft 的"配方"思路）。

### 非目标

- 不做画布内生成浮层（LibLib 式），不改画布渲染。
- 不做图片裁剪、局部重绘、放大等图像编辑（后续迭代）。
- 不做多元素批量生成。
- 文本元素不做 AI 续写/改写（本期仅保留现有正文编辑能力并补齐展示，见 §4.1）。

## 3. 术语与数据模型

- **媒体元素**：`WorldCanvasElement` 中承载 media 的三类载体：
  1. 独立媒体元素（media-node-block）；
  2. 属性边挂的 attr 媒体（relation-edge → to 端 `kind==="attr"`，`AttrMedia`）；
  3. 实体媒体字段（`EntityAttr`，`AssetFieldRow` 已有能力，本文只做对齐，不重做）。
- **Asset**：`/v1/media/assets` 资产（image/video/audio 等），media 字段统一 `${assetId,name,kind}` 引用。
- **生成配方（Recipe）**：一次 AI 生成任务的完整入参快照：`provider + model + prompt + 参考素材 referenceIDs + 参数（比例/尺寸/张数等）`。存于 asset 的 metadata（沿用 media-library-panel 现有 job 参数回填机制），不新增画布存储字段。

### 3.1 现状与新增

现状：
- `canvas-store.ts` 已有 `attachMediaAttr / removeMediaAttr` 与文档粒度持久化；
- `AssetReferenceDialog` 已实现素材库选择 + 上传；
- media-library-panel 已实现 capability 派发（`image.generate` / `video.generate`）、job 轮询、参数回填。

新增（前端为主）：
1. `generate-media-dialog`（或内嵌面板组件）：统一"AI 生成"流程组件，输入 recipe → 提交 job → 轮询 → 回填 asset。可从素材库抽离复用。
2. attr 媒体元素需要从画布数据可逆推到"所属实体 + 属性"，用于历史上下文与写回（`canvas-store` 已有实体/属性边模型，补映射即可）。

### 3.2 核心抽象：历史即素材（History ⊆ Asset）

一个关键对齐决策：**不单独造"历史记录"这一层——生成历史就是素材列表的一个视图。**

- 底层统一为 Asset：无论是 AI 生成产出、还是用户本地上传，落库都是一枚 `/v1/media/assets` 资产；一次生成 = 一枚 asset（同一 job 的多张产出 = 多枚 asset）。
- 作为"生成产物"的 asset 携带完整血缘与配方（recipe）：
  - `lineage`：`rootJobId`（本次生成链的首次任务 id）+ `parentAssetId`（若以某 asset 为参考图/底图再生成，则指向它）+ `source: generated | uploaded | library`；
  - `metadata.recipe`：provider、model、prompt、参数、参考素材 ids、上下文备注（用户手动补充的"这张图应该怎么改"类说明，Recraft 式配方）。
- **当前引用与历史的分离**：画布元素/attr/字段只存"当前 assetId"（单一指针）；历史 = 按 lineage 检索出的 asset 集合，天然包含"被换下来的旧图"——换图只是改指针，旧 asset 不消灭，历史自然累积、无状态副本、跨设备一致。
- "生成历史"视图 = 素材库按 lineage（rootJobId 派生树）过滤，可往上/往下扩展：以 A 为参考图生成 B，B 也归入 A 的 lineage 树。

由此产生的行为含义：
- 历史"设为当前"= 把该 assetId 写回元素（指针切换，O(1)、可撤销）；
- 历史"删除"= 删除这一枚 asset（素材库同源操作，被引用时给保护提示，素材库现有删除逻辑对齐）；
- 素材库选择器里看到的历史图与 Panel 历史里看到的是同一份数据，避免双份真相。

## 4. 需求详述

### 4.1 文本元素（便签 / 文本 / attr 文本值）

现有：正文编辑、attr 名重命名、attr 文本值回写。
补齐：
- 显示字数统计；长文本一键全屏编辑（`FieldRow` 已有长文本全屏模式，对齐到元素面板）；
- "复制"正文按钮；
- 左侧画布就地编辑与面板编辑保持同源（现状保持）。

### 4.2 图片元素（核心）

选中图片后右侧 Panel 分三区：

**A. 预览区**
- 缩略图 + 大图预览（`asset-preview-dialog`）、宽高 / 文件大小 / 来源标签（AI 生成 / 素材库 / 本地上传）；
- 图片尚未就绪（生成中/加载失败）显示占位与重试。

**B. 来源区（"更换这张图"）**
按钮组（对标 LibLib，但放右侧面板）：
- **AI 生成**：点开内嵌生成视图（或复用 dialog），见 C；
- **素材库选择**：`AssetReferenceDialog`，浮层内提供上传入口（用户选择素材过程中可直接上传，现状已支持，保持）；
- **本地上传**：直接选文件上传 → 生成 asset → 写回元素；
- **清除**：remove 该媒体内容（元素保留为空媒体或按元素语义删除，attr 边走 `removeMediaAttr`）。

**C. 生成配方区**
对标 Recraft：
- **填充规则（关键）**：每次"当前图"被替换为某 asset（AI 生成采用 / 历史设为当前 / 素材库选择），其血缘与配方自动回填表单：prompt、模型、参数、参考素材（parentAssetId 指向的底图/主图）全部填入，用户在此基础上改一改即可再生成优化——即"选中任何一张图，就继承了它当初怎么生成的一切"。无 recipe 的上传素材则 prompt 留空、默认参数，并自动把该 asset 作为参考主图填入；
- **Prompt**：多行可编辑文本框，展示当前图的生成 prompt；
- **景别/风格/参数**：模型选择、比例（1:1 等自动/手动）、张数（1-4）等，按 provider capability 渲染（沿用 media-library-panel 的参数 schema）；
- **参考图**：可追加参考素材（`reference-assets-field`），支持"以当前图为主图进行编辑改写"模式（img2img）；
- **操作按钮**：`再生成`（改 prompt/参数后重新提交）、`复制`（复制 recipe 为文本，便于粘贴给他人/Agent）；
- 生成中状态：进度 + 可中断（job 已支持轮询，取消尽力而为）。

**D. 生成历史区（= lineage 素材视图）**
- 折叠列表（最近优先），每项即一枚 asset：缩略图 + 模型 + 时间 + prompt 摘要 + 来源标签（生成/上传）；
- 点击缩略图 → 大图预览；"设为当前" → 把该 assetId 写回元素指针（旧的当前 asset 自然留在历史中，不丢失）；
- 历史项也可直接"删除该素材"（DELETE /v1/media/assets，被引用时保护提示）；
- 上传成功的历史项同样带 recipe 缺省（prompt 为空、source=uploaded），在历史中可"以此为底图填 prompt 再生成"（parentAssetId 指向它，归入同一 lineage 树）；
- 入口二处：Panel 内历史列表本身；预览区上的 hover 菜单"选择生成历史"（对标 LibLib 的换图入口）。

### 4.3 视频元素

- A/B/D 同图片（来源为 video.generate capability / 素材库 video asset / 上传 mp4）；
- 预览区替换为可播放的内嵌播放器（封面帧 + 播放）；
- 配方区含时长、分辨率等视频参数；历史项显示视频封面。

### 4.4 属性边挂的 attr 媒体

- 与 4.2/4.3 同一套组件，但头部额外显示：属性名（可编辑，现有 `renameAttrLabel`）+ 所属实体名（链接，点击跳转选中实体卡）；
- "采用/清除"走 `attachMediaAttr / removeMediaAttr`，同步回实体 attrs 的统一模型。

### 4.5 生成历史与失败处理

- 每次生成产出独立 asset 进 lineage；失败的 job 不产出 asset，错误摘要与"重试"出现在配方区/生成中状态里（历史列表不混入失败占位项，保持纯素材视图）；
- 跨设备一致：历史即服务端 asset（按 lineage 检索），无本地副本；
- 同一元素多次"设为当前"不丢历史（换图只改指针）；同一个 asset 同时被多个元素/实体引用是合法状态（指针复制，非复制素材）。

## 5. 交互细节

1. 生成进行中，画布媒体元素显示占位动画（沿用 media cover 加载态）；关闭 Panel 不中断 job，完成时 toast + 画布自动更新。
2. AI 生成结果默认自动写回为"当前图"，并进历史；用户可回退到任一历史项。
3. 上传文件 > 限额或不受支持的格式：toast 提示（沿用素材库上传校验）。
4. 删除元素（面板"删除"按钮）行为不变：只解除画布引用，不动 asset；历史中的素材仍可在素材库找回。
5. 移动浏览端缩窄：Panel 逻辑不变，各区改为纵向堆叠（Panel 壳已有左右切换与响应式基础）。

## 6. 开放问题

1. lineage / recipe 字段落点：挂在 asset metadata 中，还是 Asset 实体新增一等字段（`source / lineage.rootJobId / lineage.parentAssetId`）？——倾向 metadata，服务端 `/v1/media/assets` 契约不动（如需一等字段另行 RFC）。
2. 无 lineage 的存量素材（历史上传/AI 生成）如何归入历史视图：按 provider job 反推 + 用户可见的"归并"操作，或仅在新资产起生效、存量无历史。——倾向前者可探索、后者为 P1 兜底。
3. 素材库删除一枚仍被画布引用的 asset 时的联动策略（元素显示 broken 占位 + "重新选择"入口？）。
4. attr 媒体"采用"是否需要触发实体 attrs 的结构升级/字段重命名联动（当前 Model 中 media attr 即 asset 引用，应无需）。
5. 是否给文本元素加 AI 改写（写世界观用的 LLM 配方），预计 P2。

## 7. 分期

- **P1**：图片元素全流程（来源三选 + 配方 + lineage 历史视图 + 采用/清除）、attr 媒体对齐、失败重试。
- **P1.5**：视频元素对齐（生成依赖现有 capability）。
- **P2**：存量素材 lineage 归并、图片编辑（裁剪/放大）、文本 AI 改写。
