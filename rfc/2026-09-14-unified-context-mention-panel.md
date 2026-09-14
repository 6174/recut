<!--
 * [INPUT]: 依赖 2026-09-14-rich-context-composer-protocol（唯一注册表 ContextSource 的协议组、内联 XML 协议、L1/L2 分层）、2026-08-16-agent-work-surface-context（Work Surface/Focus 分层）、
 *   2026-09-09-unified-entity-model（Entity = type/name/intro/detail/attrs + media attr，是首批复用输入位置）、2026-08-28-pgc-platform-worlds（World Catalog/origin/只读）、
 *   2026-08-22-editor-captions-audio-studio-asr（capability bridge），以及现有实现逐文件核查
 *   （web/components/agent-composer.tsx、asset-reference-picker.tsx、world-picker.tsx、world-entity-picker.tsx、model-picker.tsx、
 *   project-agent-panel.tsx、agent-panel-types.ts、lib/agent-panel-context.ts、lib/worlds-store.ts、lib/workspace-store.ts、
 *   lib/recut-worlds-client.ts、components/recut-skill-settings.tsx、components/recut-mcp-settings.tsx、components/world-entity/entity-editor.tsx、service/agent.go）
 * [OUTPUT]: 定义「统一上下文引入面板（选择面）」产品与方案：把 @ 从单一素材下拉升级为可 Group / 可搜索 / 可按类型过滤的上下文目录，
 *   左侧虚拟列表 + 右侧预览（对齐全局模型设置 ModelPicker 交互）；统一 skills / mcp / 项目 / 应用 / Worlds 及其实体与 evidence / 当前 selection / 当前 page 等来源；
 *   定义 ContextSource 目录组、ContextOption/ContextPreview 契约、搜索合并与排序规则、范围（scope）二级导航、插入模式（inline/attach）、allowedRefTypes 裁剪、
 *   后端 materializer 扩展（含 world_evidence）、响应式与降级；交付 M0b 目录内核/M1 面板 UI/M4 来源，里程碑与协议 RFC 合并为单一序列
 * [POS]: rfc 的 Agent 上下文引入决策；是 09-14 内联引用协议 RFC 的**选择面（picker/目录）**配套，二者共享**同一份**注册表 ContextSource，
 *   一个负责「怎么找、怎么预览、怎么分组过滤」，另一个负责「怎么内联、怎么序列化、怎么被 AI 读取」。面板可被 allowedRefTypes 裁剪，
 *   且不假设只在 Chat——Entity 简介/正文等复用位置只用协议 RFC 的 L1 轻菜单，不加载本面板。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# 统一上下文引入面板（Unified Context Mention Panel）

- 状态：设计草案（待评审）
- 日期：2026-09-14
- 关联：[富文本上下文输入协议](./2026-09-14-rich-context-composer-protocol.md)、[Agent Work Surface Context](./2026-08-16-agent-work-surface-context.md)、[统一 Entity 模型](./2026-09-09-unified-entity-model.md)、[PGC 平台 World](./2026-08-28-pgc-platform-worlds.md)、[字幕 / capability bridge](./2026-08-22-editor-captions-audio-studio-asr.md)

## 1. 摘要

`@` 是全局 Chat 把「外部世界」引进对话的唯一入口，应该是整个产品的上下文引入核心能力。目前它退化成一个只能搜素材的假 mention 菜单。本 RFC 把它重构为一个**统一上下文目录面板**：

- 一个 `@` 面板能引入十类上下文：**当前 page（Work Surface）、当前 selection（Work Focus）、World、World Entity、World evidence、项目、应用、素材、Skill、MCP 工具**。
- 面板**分 Group**（当前 / Worlds / 工作台 / 素材 / 能力），支持**搜索**与**按类型过滤**。
- 布局对齐全局模型设置 `ModelPicker`：**左侧虚拟列表（分组 + sticky 标题），右侧上下文预览区**。
- 一份注册表同时驱动「搜索 / 预览 / 插入 / contexts payload / 内联 XML」；**注册表的唯一权威定义在 `rich-context-composer-protocol` §5**（本 RFC 不再另立 `ContextSource`，只消费它并拥有其中的「目录组」字段）。

> **与内联协议 RFC 的关系**：两个 RFC 是**同一能力的两面**。协议 RFC 拥有注册表的**协议组**（`type/attrs/identity/icon/label/toContext/navigate/inlineInsertable` + XML 序列化/解析）；本 RFC 拥有**目录组**（`group/titleKey/insertMode/filters/scope/search/preview/rank`）。`group` 取值、类型目录、XML 属性命名均以协议 RFC §5/§6 为唯一权威。合并决议与单一里程碑见协议 RFC §0/§13。

## 2. 问题与现状盘点

### 2.1 `@` 是假的

`agent-composer.tsx:131` 用正则 `content.match(/@([^\s@]*)$/)` 匹配，只弹 `AssetReferenceMenu`（素材 + 一个「选择世界观」跳转）。选中后把 `@xxx` 从正文删掉、改成输入框上方的芯片行（`pickAsset`/`pickWorld`，`agent-composer.tsx:132-139`）。后果：

- 只能引素材或 World，不能引项目 / 应用 / Entity / Skill / MCP / 当前选择。
- `@` 不能出现在句中，没有图标 chip，不能内联排序。
- 没有分组、没有类型过滤、没有预览，只能盲选。

### 2.2 来源散落、交互各写一遍

| 来源 | 现状入口 | 问题 |
| --- | --- | --- |
| 素材 | `AssetReferenceMenu`（@ 内联候选，5 条）+ `AssetReferenceDialog`（弹框浏览） | 两套 UI、两套过滤；@ 内联候选只给 5 条 |
| World | `WorldPicker`（独立弹框，搜索 + kind 过滤） | 与 `@` 无关联，靠菜单里一个文字链跳转 |
| World Entity | `WorldEntityPicker`（先选 World 再选 Entity） | 与 `@` 完全无关；仅被其他 App 调用 |
| 项目 / 应用 | 无引用入口 | 只能靠 Work Surface 自动带 |
| Skill / MCP | 仅设置页只读展示（`recut-skill-settings.tsx` / `recut-mcp-settings.tsx`） | 无法在对话里指定「用哪个 skill / 工具」 |
| 当前 page / selection | `agent-panel-context.ts` 自动上报 | 用户无法看见、无法在 @ 里重新附带 |

### 2.3 传输层各自旁路

引用最终都塞进 `MessageContext[]`（`project-agent-panel.tsx:464`），后端 `contextMaterializers`（`service/agent.go:1416`）按 type 拼 prompt。后端目前只认 `media / page / work_surface / work_focus / creation_world / creation_entity`——**项目、应用、Skill、MCP 四类根本没有 context type**。

### 2.4 目标交互参照

`ModelPicker`（`web/components/model-picker.tsx`）已经验证了「左侧搜索 + 按 Provider 分组列表，右侧悬停/聚焦预览详情」的双栏结构。本 RFC 复用它的交互骨架，把数据源从「模型」换成「各类上下文来源」。

## 3. 目标与非目标

### 目标

- 一个 `@`（以及 AtSign 按钮）打开**统一上下文面板**，十类来源统一进入、统一预览、统一插入。
- **可 Group、可搜索、可按类型过滤**：全量模式下按来源域分组；选中域后按子类型二级过滤（素材 kind / Entity kind / 应用 kind / 能力种类）。
- **左列表右预览**：左侧虚拟滚动列表；右侧展示当前高亮项的完整上下文（媒体大图、世界统计、实体属性、Skill 说明、MCP schema、页面路由、选区 refs）。
- **范围（scope）导航**：Entity 这类必须归属 World 的来源，用面包屑式 scope 选择（World → Entity）而不强迫离开面板。
- 一份 `ContextSource` 注册表驱动搜索、预览、插入、`toContext`、内联 XML；新增来源只加一条 descriptor。
- 与内联协议 RFC 的注册表统一为同一份（见 §11），避免两套。
- 用户发送前**看得见自己引了什么**；已引用项在面板里去重并标记。
- **支持「轻引用」场景**：面板不是唯一形态。通过 `allowedRefTypes` 可裁剪来源集合，且内联协议 RFC 的 L1 `reference-menu` 能在**不加载本面板（L2）**时提供轻量候选——例如 World Entity 简介/正文只 @ 实体。面板与轻菜单消费同一注册表。

### 非目标

- 不重写富文本输入内核（由内联协议 RFC 负责 Tiptap）。
- 不引入向量检索 / 语义搜索；v1 为标题/简介/标签的模糊匹配 + 领域后端查询。
- 不做跨 World 的 Entity 全库检索（需要新端点，列为未决 §21）。
- 不做任意 OS 文件 / URL 引用。
- 不在本 RFC 内实现 App iframe 的独立面板（仅保证 descriptor 可被复用）。

### 复用边界（与内联协议 RFC 的共识）

「全站富文本输入」由两部分组成：**输入内核**（L0/L1，协议 RFC 拥有）负责在任何位置渲染可编辑的富文本+引用；**选择面**（L2，本 RFC 拥有）负责重面板。大多数复用位置（Entity 简介/正文、长文本 attr）只需 L0/L1 + 轻菜单，**不加载 L2**；只有 Agent Chat（和未来的 App iframe）需要 L2 双栏面板。因此本 RFC 的面板必须能通过 `allowedRefTypes` 与宿主传入的 runtime 被裁剪，且**不得假设自己总在 Chat 里**（不硬编码 projectID/工作台语义）。

## 4. 核心模型

引入三个概念，全部住在 `web/lib/context-catalog/`：

1. **Context Catalog**：把各来源的原始数据（media assets、worlds、entities、projects、apps、skills、mcp tools、work surface/focus）归一为 `ContextOption[]` 的目录层。
2. **`ContextSource` 描述符**：一类来源的元数据与行为。**唯一权威定义在协议 RFC §5.1**；本 RFC 只实现与消费其中的目录组字段（`group/titleKey/insertMode/filters/scope/search/preview/rank`），协议组字段（`type/attrs/identity/icon/label/toContext/navigate/inlineInsertable`）由输入内核消费。注册表 = `ContextSource[]`。
3. **ContextPreview**：预览区的渲染数据（媒体、事实行、正文、跳转），由 descriptor 的 `preview()` 产出，支持懒加载详情。

```
@ 触发
  └─ ContextMentionPanel（双栏）
       ├─ 左：搜索 + Group/类型过滤 + scope 面包屑 + 虚拟列表
       │     └─ useContextCatalog().search(runtime, query, filter) → ContextOption[]
       └─ 右：ContextPreview（descriptor.preview(option)）
                   ↓ 选择
            composer adapter
              ├─ inline：RichComposer 插入 chip（XML，见内联协议 RFC）
              └─ attach：芯片行 / turn 开关（work_surface、work_focus）
```

## 5. 来源清单与分组

> 类型目录与 `group` 取值的**唯一权威是协议 RFC §5.3**；本表是它的产品视角展开，新增/调整类型必须回填协议 RFC §5.3。合并时相对旧版补齐了 `world_evidence`（旧版漏列）。

分组是**产品语义域**，不是数据结构。一级分组固定 5 个；子类型为二级过滤。

| 一级 Group | key | 来源 type | insertMode | 子类型过滤 | scope | 后端 materializer |
| --- | --- | --- | --- | --- | --- | --- |
| 当前 | `current` | `work_surface` | attach | 无 | — | ✅ 已有 |
| 当前 | `current` | `work_focus` | attach | 无 | — | ✅ 已有 |
| Worlds | `world` | `creation_world` | inline | World kind（character_ip/creator_brand/brand/fiction_world/custom） | — | ✅ 已有 |
| Worlds | `world` | `creation_entity` | inline | Entity type（character/location/object/story/style/rule + 自定义） | **worldId** | ✅ 已有 |
| Worlds | `world` | `world_evidence` | inline | evidence 类型（image/video/audio/text） | **worldId** | ⛔ 新增 |
| 工作台 | `workspace` | `project` | inline | 无 | — | ⛔ 新增 |
| 工作台 | `workspace` | `app` | inline | 应用 kind（project/standalone） | — | ⛔ 新增 |
| 素材 | `media` | `media` | inline | image/video/audio/transcript/reference | 可选 project/library | ✅ 已有 |
| 能力 | `capability` | `skill` | inline | 平台 / App | — | ⛔ 新增 |
| 能力 | `capability` | `mcp_tool` | inline | 平台 / App | — | ⛔ 新增 |

补充规则：

- **当前 selection 展开为具体引用**：`work_focus.selection.refs` 里 `world_entity` 展开成一条 `creation_entity` 选项、`asset` 展开成 `media` 选项，带「当前选中」badge，以 `group: "current"` 呈现。这样「@ 我此刻选中的那个实体」直接可用，且复用既有 materializer。
- **未支持的 selection ref kind**（`timeline_element / timeline_track / component / world_canvas_element / world_relation`）在「当前」组内以 `disabled` 呈现并标注「即将支持」（依赖 editor surface，见未决 §21）。
- **当前 page** 即 `work_surface`，宿主签发，只允许 toggle（附带/移除），绝不内联进正文（遵循 Work Surface RFC 的原则 P2）。
- **跨 World 只读**：`origin !== "local"` 的 World/Entity 可引用，预览标注只读；要求修改时引导 Fork（沿用 World 只读策略）。

## 6. 面板产品设计

### 6.1 布局（对齐 ModelPicker，两栏）

```
┌─────────────────────────────── 720 × min(520, vh-10rem) ───────────────────────────────┐
│  搜索：@ 后继续输入，模糊匹配所有来源…                                      [Esc 关闭]   │
├───────────────────────────────┬─────────────────────────────────────────────────────────┤
│ [全部][当前][Worlds][工作台]  │  预览区                                                 │
│ [素材][能力]                  │  ┌──────────────────────────────────────────────────┐   │
│ ─────────────────────────────  │  │  （媒体大图 / World 封面 / App 图标）            │   │
│ ▸ 当前（2）                   │  └──────────────────────────────────────────────────┘   │
│   • 当前页面 · 项目 8-16      │   标题 + 类型 badge                                     │
│   • 当前选择 · 小黄牛          │   事实行：App / 更新时间 / 数量 / 状态 …                │
│ ▸ Worlds（共 12）             │   简介正文                                              │
│   • 雪山世界                  │   [打开对象]  [插入引用 ⏎]                              │
│   • 小黄牛（角色）            │                                                         │
│ ▸ 工作台 / 素材 / 能力 …      │                                                         │
└───────────────────────────────┴─────────────────────────────────────────────────────────┘
```

- **左栏宽 280–320px**（`grid-cols-[300px_minmax(0,1fr)]`），右栏自适应。
- 搜索框在左上，**打开即聚焦**；继续输入即实时过滤（debounce 120ms）。
- 一级过滤为分段 chip 行；选中非「全部」时，左栏只显示该组，且该组有子类型时在下方再出一行子类型 chip。
- 当来源需要 scope（Entity）时，搜索框下方出现面包屑：`Worlds / 雪山世界 ▾`（点击切换 World，或「返回全部 World」）。
- 列表项：图标/缩略图 + 标题 + 副标题 + 右侧 badge（类型、状态、只读、已引用 ✓）。

### 6.2 分组与虚拟列表

- 左栏把所有分组**扁平化为虚拟行**：`{ kind: "header", group } | { kind: "option", option }`，用 `@tanstack/react-virtual` 的 `useVirtualizer` 渲染。
- 分组标题在滚动时 sticky（header 行内容用 `position: sticky; top: 0`）。
- 「全部」模式显示所有分组；过滤到某组时不显示 header（或显示该组子类型 header）。
- 每个来源在「全部浏览」模式下最多贡献 8 条，输入查询或选中分组时最多 12 条（防止单来源刷屏）。
- 每个分组标题右侧显示命中数；loading 时显示骨架行，失败时该组出现「读取失败 · 重试」行，**不影响其他组**。

### 6.3 交互与键盘

| 操作 | 行为 |
| --- | --- |
| `@` | 在光标处打开面板，记录锚点；继续输入即查询 |
| `↑` / `↓` | 在扁平行间移动高亮（跳过 header），联动滚动 + 更新预览 |
| `Home` / `End` / `PgUp` / `PgDn` | 列表首尾 / 翻页 |
| `←` / `→` 或 `Tab` / `Shift+Tab` | 切换一级过滤组 |
| 鼠标悬停 / 聚焦 | 更新右侧预览 |
| `Enter` | 插入高亮项（inline 插 chip / attach 切开关），关闭面板 |
| `⌘/Ctrl + Enter` | 插入并**保持面板打开**（连续引用） |
| `Backspace`（查询为空） | Entity scope 下退回 World 级 |
| `Esc` | 关闭面板，**保留**已输入的 `@query` 文本供继续编辑 |
| 单击列表项 | 同 `Enter` |

### 6.4 状态与空态

- **正在读取**：分组骨架行。
- **无结果**：显示「没有匹配的上下文」，并给出上下文相关的行动按钮（上传素材 / 新建 World / 浏览素材库）。
- **服务离线**：媒体/World 等远程来源不可用，面板仍展示本地可达的「当前页面 / 当前选择」并给出服务重连提示。
- **已引用**：命中项右侧显示 ✓，可重复插入（正文允许多次引用同一对象，`contexts` 侧按 identity 去重——见内联协议 RFC §14）。

## 7. 搜索 / 分组 / 类型过滤 / 排序

### 7.1 查询生命周期

1. `@` 打开，query = `@` 后已输入内容。
2. 120ms debounce；每次新查询 `AbortController` 取消上一次来源请求。
3. `Promise.allSettled` 并发所有（或过滤后的）来源的 `search()`，单来源 **4s 超时**，失败降级为该组错误行。
4. 归一化为 `ContextOption[]`，按 §7.3 排序，分组切分，注入 `selected`（对照本条消息已引用集合）与 `pinned`（当前页面/选择、平台置顶）。
5. 返回渲染。

### 7.2 匹配与过滤

- 匹配字段：`title`、`subtitle`、来源自定义 keyword（World description、Entity intro、Skill description、MCP tool name/description）。
- 查询为空 = 浏览：按分组返回**最近使用 + 平台置顶 + 最近更新**的稳定切片。
- 一级过滤 = 只看某 Group；二级过滤 = 该 Group 下的子类型（如素材 `image`、Entity `character`）。
- scope（Entity 的 `worldId`）注入来源查询；无 scope 时 Entity 组显示「先选一个 World」，点击进入 scope 选择。

### 7.3 排序（合并后统一）

优先级从高到低：

1. `pinned`（当前页面 / 当前选择 / 平台目录置顶）`+1000`
2. 最近使用（按 recency index 递减）`+300 … +0`
3. 标题精确命中 `+200`，前缀命中 `+120`，词边界命中 `+80`，子序列模糊 `+40`
4. 来源域权重（current > world > workspace > media > capability）小权重
5. 稳定 tie-break：按标题字典序，避免刷新抖动

排序在目录层纯函数实现（可单测），`ContextSource.rank` 只做来源内修正。

## 8. 预览区设计

预览由 `ContextSource.preview(option)` 产出，**懒加载详情**（Entity 属性、World 统计等按需从 store/api 取，带缓存）。

| 来源 type | 预览内容 |
| --- | --- |
| `media` | 真实大图 / 视频首帧 / 音频波形入口；kind、mime、origin、创建时间、生成提示词、时长、所属项目 |
| `creation_world` | 封面、World kind、origin（平台/发布/本地，含只读标记）、简介、当前 revision 摘要、实体/关系数量、`recut.worlds.brief` 提示 |
| `creation_entity` | 类型、intro、detail 摘要、attrs 列表（前 N 条）、关系数、所属 World；「打开画布定位」 |
| `project` | 封面、App（名称/kind/图标）、版本、创建时间；「打开项目」 |
| `app` | 图标身份、kind、描述、agentSurface（领域/默认意图/requiredSkill） |
| `skill` | 名称、版本、描述、来源路径、已链接 target 状态；「在设置中查看」 |
| `mcp_tool` | 工具名、描述、完整 inputSchema（只读） |
| `work_surface` | surface 类型、标题、路由、target（projectId/worldId/appId）、默认意图、requiredSkill；附带开关说明 |
| `work_focus` | view、summary、selection refs 列表（每个 ref 的 kind + id）、cursor |

- 预览底部主操作：「插入引用 ⏎」（inline）或「附带 / 移除」（attach），以及可选的「打开对象」（descriptor.navigate）。
- 预览区对键盘高亮做 `aria-live="polite"` 更新。
- 数据加载中/失败在预览区局部呈现，不阻塞列表。

## 9. 分层架构与文件清单

```
web/lib/context-catalog/
  types.ts             # ContextSource / ContextOption / ContextPreview / ContextRuntime
  registry.ts          # 默认 ContextSource[] 注册与 lookup
  search.ts            # fan-out、超时、合并、排序、去重（纯函数，可单测）
  runtime.ts           # useContextCatalog(runtime)：把各 store 快照与 apiBase 注入
  recent.ts            # 最近使用持久化（localStorage，按 workspace 隔离）
  sources/
    current.ts         # work_surface / work_focus（含 selection refs 展开）
    worlds.ts          # creation_world
    entities.ts        # creation_entity（scope=worldId）
    media.ts           # media（可选 project/library scope）
    workspace.ts       # project / app
    capability.ts      # skill / mcp_tool

web/components/context-panel/
  context-mention-panel.tsx   # 双栏容器 + Portal 定位 + 响应式 + allowedRefTypes 裁剪
  context-search-field.tsx    # 搜索 + debounce + 过滤 chip 行 + scope 面包屑
  context-list.tsx            # 虚拟分组列表（含 header/option 行）
  context-option-row.tsx      # 单行（图标/标题/副标题/badge/✓）
  context-preview.tsx         # 预览容器（按 preview 数据渲染）
  preview-templates.tsx       # 各来源预览模板

web/lib/context-catalog/registry.ts       # 同时导出「轻菜单查询」给 L1 reference-menu（见下）
web/components/agent-composer.tsx         # 退役 @ 正则 + AssetReferenceMenu，接入面板
web/components/project-agent-panel.tsx    # 组装 picked refs → contexts（沿用）
web/components/world-entity/entity-editor.tsx  # 简介/正文接入 RichComposer（L1 轻菜单，不加载本面板）
web/components/world-entity/field-row.tsx      # 长文本 attr 同上
service/agent.go                          # 新增 world_evidence/project/app/skill/mcp_tool materializer
```

依赖：新增 `@tanstack/react-virtual`（headless、React 19 兼容）；`RichComposer` 与 `reference-menu` 依赖内联协议 RFC 引入的 Tiptap，registry 同时服务重面板与轻菜单。

## 10. 数据契约

```ts
export type ContextGroupID = "current" | "world" | "workspace" | "media" | "capability";

export type ContextBadge = { key: string; label?: string; tone?: "default" | "primary" | "muted" | "warning" };

export type ContextOption = {
  /** 稳定唯一键 `${sourceType}:${identity}`；用于选择态、去重、最近使用 */
  key: string;
  /** XML 标签名 = 后端 context.type */
  sourceType: string;
  group: ContextGroupID;
  /** 二级过滤值：图片/视频/角色/场景/… */
  subKind?: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  badges?: ContextBadge[];
  disabled?: boolean;
  disabledReasonKey?: string;
  /** 原始记录，供 preview/toContext 使用；不参与序列化 */
  data: unknown;
  score: number;
  pinned?: boolean;
  selected?: boolean;
};

export type ContextPreview = {
  title: string;
  subtitle?: string;
  media?: { kind: "image" | "video" | "audio"; url: string; posterUrl?: string };
  body?: string;
  facts: { key: string; label: string; value: React.ReactNode }[];
  badges?: ContextBadge[];
  open?: { labelKey: string; href?: string; onClick?: () => void };
};

export type ContextSearchContext = {
  apiBase: string;
  query: string;               // 已 trim；空串=浏览
  group: ContextGroupID | "all";
  subKind?: string;
  scope?: { worldId?: string; projectId?: string; mediaScope?: "project" | "library" };
  runtime: ContextRuntime;     // 各 store 快照与访问器
  /** 宿主裁剪：只允许这些 sourceType（空=全部）；与 RichComposer.allowedRefTypes 同源 */
  allowedRefTypes?: string[];
  signal: AbortSignal;
  limit: number;
};

export type ContextRuntime = {
  apiBase: string;
  projectID: string | null;
  workSurface: WorkSurfaceContext | null;
  workFocus: WorkFocusContext | null;
  mediaAssets: MediaEventAsset[];
  worlds: WorldSummary[];
  entitiesFor: (worldId: string) => WorldEntitySummary[];
  worldDetailFor: (worldId: string) => WorldDetail | undefined;
  entityFor: (worldId: string, entityId: string) => WorldEntity | undefined;
  projects: WorkspaceProject[];
  apps: WorkspaceApp[];
  installations: WorkspaceInstallation[];
  skills: SkillLink[];
  mcpTools: MCPTool[];
  recentKeys: string[];
};
```

> `ContextSource` 的完整定义在**协议 RFC §5.1**。本 RFC 只声明「目录组」字段（`group/titleKey/insertMode/filters/scope/search/preview/rank`）；「协议组」字段（`type/attrs/identity/icon/label/toContext/navigate/inlineInsertable`）由输入内核消费。旧版本 RFC 里的 `toInlineAttrs` 已删除——XML 属性由 `identity` + `attrs` 白名单在协议层序列化，不再由目录层提供。

## 11. 与「富文本上下文输入协议」RFC 的关系

两 RFC 已合并为**同一份注册表 `ContextSource`**（不再是「本 RFC 是超集」的模糊表述）。合并决议见协议 RFC §0，字段归属见 §5.1。要点：

- **唯一注册表**位于 `web/lib/context-catalog/registry.ts`，输入内核与面板都从这里 import；`RefDescriptor` 作为概念已废止。
- **字段归属**：协议组归协议 RFC，目录组归本 RFC；`search()` 采用本 RFC §7 的完整签名，协议 RFC 只引用其必需字段。
- **实现顺序**：M0a 内核协议 + M0b 目录内核可并行；面板先以 attach 承载 inline 类型（M1），Tiptap 就绪后接 chip（M2）；详细单一里程碑见协议 RFC §13。

## 12. 后端 materializer 扩展

`service/agent.go:1416` 的 `contextMaterializers` 增加五类（`world_evidence` 为两 RFC 合并后补入）；`contextPrompt()` 分组文案沿用既有的「素材」与「其他上下文」两段（或按 kind 细分）。协议侧另需 §7 的统一 **inline 归并**（扫描正文标签补齐漏传项），它不属于任一具体 type。

| 新增 type | payload | 校验 | prompt 指引 |
| --- | --- | --- | --- |
| `world_evidence` | `{ worldId, evidenceId }` | evidence 属于该 World | 用 `recut.worlds.evidence.list` 读取；不复制 Canon |
| `project` | `{ projectId }` | `store.Get(projectId)` 存在 | 目标 projectId + appId；用 `recut.project_context` / `recut.project.get` 读取真相，不要凭标题猜 |
| `app` | `{ appId }` | 已安装 App | App 身份 + kind + agentSurface（领域/默认意图/requiredSkill），提示加载对应 App Skill |
| `skill` | `{ appId, skillId }` | skill 存在且可链接 | 「本回合用户指定遵循 skill appId/skillId 的工作流」 |
| `mcp_tool` | `{ toolName, appId? }` | 工具在 `/v1/mcp/tools` 快照中 | 「优先使用工具 toolName 完成相关步骤」 |

内联 XML 标签（属性命名遵循**协议 RFC §6.3** 的小写规范；回复侧 `agent-message-content.tsx` 已能解析 `<project>`/`<app>`，其余新增解析）：

```xml
<world_evidence worldid="w_123" evidenceid="ev_7" name="概念图" />
<project projectid="proj_1" name="8-16" />
<app appid="recut.editor" name="Recut Editor" />
<skill appid="recut.editor" skillid="editor" name="编辑器工作流" />
<mcp_tool name="recut.timeline.command" appid="recut.editor" />
```

边界：Skill / MCP 引用是**提示性**还是**强制性**属于产品语义，暂定「强提示、非硬约束」（见未决 §21）。

## 13. 数据流全景

```
用户输入 "@小黄"（光标在词尾）
  │
  ├─ ContextMentionPanel.search(runtime, "小黄", group="all")
  │     ├─ sources.current.search   → 当前页面/选择（pinned）
  │     ├─ sources.worlds.search    → 雪山世界 / 小黄牛(角色)
  │     ├─ sources.entities.search  → 需 scope，无 scope 显示“先选 World”
  │     ├─ sources.workspace.search → 项目/应用（标题命中）
  │     ├─ sources.media.search     → 素材（名称命中）
  │     └─ sources.capability.search→ skill / mcp tool
  │
  ├─ merge + rank + dedupe → ContextOption[] → 虚拟分组列表
  ├─ 高亮项 → descriptor.preview() → 右栏预览
  │
  └─ Enter
       ├─ inline：RichComposer 插入 chip（XML 属性由协议层按 `identity`+`attrs` 序列化）
       └─ attach：composer 芯片行 / turn 开关
             │
             ▼
   send(): contexts = picked.map(toContext) + host contexts
             │
             ▼
   POST /v1/agent-sessions/:id/turns { content, contexts }
             │
        service: contextMaterials + contextPrompt
             │
        Codex/Claude/Opencode CLI（AI 按 ID 调 MCP 取真相）
```

## 14. 性能、缓存与虚拟列表

- **数据来源复用现有缓存**：`useMediaAssetEvents`（素材，WS 增量）、`worlds-store`（World/Entity，按 key 去重）、`workspace-store`（项目/应用/安装，`load()` 一次）、`recut-skill-settings` 的 `/v1/skills`、`recut-mcp-settings` 的 `/v1/mcp/tools`。面板**不新增轮询**。
- `/v1/skills` 与 `/v1/mcp/tools` 首次打开面板时懒加载并缓存（设置页已有实现，抽成共享 loader）。
- Entity 列表按 `{worldId}` 懒加载，仅在 scope 激活时查询；`worlds-store.loadEntities` 已带 `text` 参数，可直接作为服务端模糊搜索。
- 标题模糊匹配在客户端完成；大列表（素材/Entity）以「先本地缓存过滤，不足再服务端查询」为策略。
- 虚拟列表：`@tanstack/react-virtual`，`getItemKey` 用行 key（header 用 `header:${group}`），`overscan: 8`；列表高度固定，避免布局抖动。
- 排序/合并为纯函数，便于缓存与单测；来源结果按 `(runtime 版本, query, filter)` 做短期 memo。

## 15. 边界、错误与降级

| 场景 | 处理 |
| --- | --- |
| 某来源失败 | 该分组渲染错误行 + 重试；其余来源照常 |
| 服务离线 | 仅保留本地「当前页面 / 当前选择」，其余组显示服务不可用 |
| 来源超时（>4s） | 视为失败，错误行提示「读取超时」 |
| 已引用的对象 | 右侧 ✓；允许重复插入（contexts 按 identity 去重） |
| 只读 World/Entity | badge 标只读；引用照常（只读不阻止读取） |
| 不支持的 selection ref | `disabled` + 「即将支持」 |
| 无 scope 的 Entity | 「先选一个 World」入口，点击进入 scope 选择 |
| 面板超出侧栏 | 走 Portal + 视口自适应（§16） |
| 恶意/超长名称 | 列表单行截断，预览按字符截断，UI 不注入 HTML |

## 16. 响应式与窄侧栏

Agent 侧栏可拖动变窄（`use-resizable-side-panel`，宽度存 `--side-panel-width`），而本面板目标宽度 `720px`。因此：

- 面板用 `createPortal` 渲染到 `document.body`，锚定到 composer 上方（与 `AssetReferenceDialog`/`WorldPicker` 一样脱离侧栏堆叠上下文）。
- 宽度取 `min(720px, calc(100vw - 2rem))`；高度取 `min(520px, calc(100vh - 10rem))`。
- 宽度 `< 640px` 时：右栏收为可切换的「预览抽屉」（选中行下方展开，或按 `→`/`空格` 展开），保证左列表可用。
- 移动/触屏：点击行 = 更新预览，再次点击或点「插入」按钮 = 确认插入。

## 17. i18n 与可访问性

- 所有文案进 `workspace-agent-dict.ts`，命名空间 `agent.context.*`（如 `agent.context.group.current`、`agent.context.search.placeholder`、`agent.context.empty`、`agent.context.preview.insert`）。
- 列表：`role="listbox"` + 每行 `role="option"` + `aria-selected`；容器 `aria-activedescendant` 指向高亮行；分组标题 `role="group"` + `aria-label`。
- 预览区：`aria-live="polite"`；媒体 `alt` 用素材名。
- 搜索框 `<label>` + `aria-label`；过滤 chip 用 `role="tab"` 或带 `aria-pressed` 的按钮。
- 焦点管理：打开时聚焦搜索框；`Esc` 关闭后把焦点还给 composer。

## 18. 迁移与兼容

1. **旧入口退役**：`agent-composer.tsx` 的正则 mention、`pickAsset`/`pickWorld`、`AssetReferenceMenu` 内联候选由本面板取代；`WorldPicker` / `WorldEntityPicker` 保留为其他 App 的独立入口（可后续改为复用同一来源 descriptor）。
2. **剪贴板**：`<media assetid>` 粘贴解析保持（迁移进内联协议 RFC 的 `parse.ts`）。
3. **旧 `contexts`**：已持久化历史仍走旁路渲染；新 turn 加入 `project/app/skill/mcp_tool` 类型，未知 type 的前端渲染降级为纯文本标签。
4. **后端前向兼容**：`contextMaterializers` 对未注册 type 返回错误（现状），因此**前端只能发送已注册类型**；新增类型必须先落后端（M2/M3 同批）。
5. **回滚**：feature flag 切回 `AssetReferenceMenu`；`content/contexts` 契约不变，后端无需回滚。

## 19. 里程碑

**两个 RFC 的里程碑已合并为协议 RFC §13 的单一序列表**（M0a 内核协议 / M0b 目录内核 / M1 面板 UI / M2 输入内核 / M3 双轨对齐 / M4 工作台·能力来源 / M5 回复复用 / M6 通用化 PoC）。本 RFC 负责 M0b/M1/M4，协议 RFC 负责 M0a/M2/M3/M5/M6。本节不再重复排期，避免两份文档漂移。

## 20. 可测试点

- **单测（目录层）**：多来源合并、来源内/全局排序权重、identity 去重、已引用标记、组内上限。
- **单测（来源）**：各 `search()` 的归一化与过滤（含 scope 注入、失败降级）；`preview()` 的数据映射。
- **组件测试**：`@` 打开/关闭、键盘上下与过滤切换、scope 面包屑、空态/错误态、Portal 定位与窄宽降级、已引用去重。
- **后端 Go httptest**：`world_evidence/project/app/skill/mcp_tool` materializer 的校验与 prompt 文案；未注册 type 报错；`work_focus` 无 `work_surface` 时报错（既有不变式）。
- **端到端（Playwright）**：`@` → 选实体 → 发送 → 断言 `contexts` 含 `creation_entity` 且正文/回复渲染正确；@ 项目 / 应用 / skill 各一条。

## 21. 未决问题

**已在两 RFC 合并中关闭**（不再开放）：去重权威（正文 XML 为唯一权威，协议 RFC §7.4）、`work_surface` 内联（否）、XML 属性命名（小写规范，协议 RFC §6.3）；这三项原为本节 1–7 中的若干条，现已在协议 RFC 定稿。

仍开放（本 RFC 侧）：

1. **Skill / MCP 引用的约束力**：是「强提示」还是「本回合必须使用」？倾向强提示，硬约束留给 Skill 自身规则。
2. **跨 World 的 Entity 检索**：`worlds-store` 仅支持按 World 查询；全局实体搜索需要新 HTTP 端点或经 MCP 桥。v1 先做 scope 两级，v2 再评估。
3. **最近使用的作用域**：按 workspace 全局，还是按当前 project/world 隔离？倾向 workspace 全局 + 当前页对象置顶（已由 `pinned` 覆盖）。
4. **是否支持多选连续插入**：v1 用 `⌘/Ctrl+Enter` 保持打开；是否需要一次插入多条（如多选实体）待定。
5. **预览大图的体积**：素材预览是否内联真实大图，还是仅缩略图 + 点开详情（复用 `AssetPreviewDialog`）。倾向后者以降内存。
6. **world_evidence 的 scope 与预览**：evidence 归属 World，需确认 scope 交互是否与 Entity 共用面包屑，以及预览是否显示媒体内容（P4 前可先只给名称+类型）。

仍开放（两 RFC 共同）：

7. **selection 中 timeline/component ref 的 context type**：依赖 editor surface，需与 Work Surface RFC 对齐后补 `timeline_element`/`component` descriptor + materializer。

## 22. 影响文件清单

**新增**
- `web/lib/context-catalog/**`（§9；registry 同时服务重面板与 L1 轻菜单）
- `web/components/context-panel/**`（§9）
- `web/lib/i18n/workspace-agent-dict.ts`：`agent.context.*` 文案

**修改**
- `web/components/agent-composer.tsx`：退役 @ 正则 / `AssetReferenceMenu`，接入 `ContextMentionPanel`
- `web/components/project-agent-panel.tsx`：`send()` 组装 picked refs → `contexts`（含新类型）
- `web/components/agent-message-content.tsx`：回复侧解析新增标签（`project`/`app` 已有；`world_evidence/skill/mcp_tool` 新增）
- `web/components/use-media-asset-events.tsx`、`web/lib/worlds-store.ts`、`web/lib/workspace-store.ts`：暴露面板需要的快照访问器
- `service/agent.go`：`contextMaterializers` 新增 `world_evidence/project/app/skill/mcp_tool`

**复用位置（内核由协议 RFC 提供，本 RFC 只需保证来源可被裁剪）**
- `web/components/world-entity/entity-editor.tsx`、`field-row.tsx`：简介/正文/长文本 attr 使用 `allowedRefTypes` 限定的轻引用（不加载本面板）

**依赖（前置）**
- 唯一注册表 `ContextSource` 定义在 `2026-09-14-rich-context-composer-protocol.md` §5；本 RFC 消费其目录组。Tiptap 就绪后才启用 `insertMode: "inline"`（M2）。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
