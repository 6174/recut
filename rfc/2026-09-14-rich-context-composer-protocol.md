# 富文本上下文输入协议（Rich Context Composer Protocol）

> 日期：2026-09-14
> 状态：设计草案（待评审）
> 关联：`2026-09-14-unified-context-mention-panel.md`（选择面配套，二者共享同一份注册表）、`2026-08-16-agent-work-surface-context.md`、`2026-09-13-world-content-format-v2.md`、`2026-09-09-unified-entity-model.md`、`docs/platform-comms-contract.md`
>
> **两 RFC 的分工（先读这里）**：本 RFC 是**协议内核 owner**——负责「怎么内联、怎么序列化、怎么被 AI 读取」；`unified-context-mention-panel` 是**选择面 owner**——负责「怎么找、怎么预览、怎么分组过滤」。二者**只有一份注册表 `ContextSource`**（定义见 §5.1），本 RFC 拥有 `type/attrs/identity/serialize/parse` 等协议字段，选择面 RFC 拥有 `search/preview/filters/scope/rank` 等目录字段。类型目录、`group` 取值、XML 属性命名也以本 RFC §5 为**唯一权威**，选择面不得另立。

## 0. 与选择面 RFC 的合并决议（Conventions）

两份 09-14 RFC 曾各自定义 `RefDescriptor` 与 `ContextSource`。合并结论：

| 维度 | 唯一权威 | 说明 |
| --- | --- | --- |
| 注册表名 | `ContextSource` | `RefDescriptor` 作为子集合并进来，不再单独存在 |
| 注册表位置 | `web/lib/context-catalog/registry.ts` | 输入内核与面板都从这里 import |
| `group` 取值 | `current / world / workspace / media / capability` | 本 RFC §5.2 定义；选择面 RFC 的旧 4 值作废 |
| 类型目录 | 本 RFC §5.3 | 含 `world_evidence`；选择面新增 4 类须回填本表 |
| XML 属性命名 | 全小写、无下划线、无驼峰 | 本 RFC §6.3；选择面 §12 示例须对齐 |
| 去重权威 | 内联 XML 为**主锚点**，`contexts` 为**校验/物化通道** | 见本 RFC §7.4；选择面 §21 Q7 关闭 |
| `search()` 签名 | 选择面 §7 的完整签名 | 本 RFC §5.1 只保留协议必需字段，其余可选 |

落地顺序（合并后单一序列见 §13）：先内核协议（本 RFC M0）+ 目录内核（选择面 M0），再面板 UI，最后内联对齐。

## 1. 问题

Recut 目前的 Agent 对话输入是一个**纯 textarea + 独立附件芯片行**（`web/components/agent-composer.tsx`）。这带来三个体验缺口：

1. **引用与正文分离**：素材、World、Work Surface 只显示在输入框上方的芯片行，用户在正文里无法说“把 `@小黄牛` 放到这张图里”，因为引用不落在文本流中。
2. **@ 是假的**：`agent-composer.tsx:131` 用正则 `@([^\s@]*)$` 匹配，只弹一个素材候选菜单，选中后把 `@xxx` 删掉、改成芯片，无法在句中出现、不能引用 World 实体、没有图标 chip、不能内联排序。
3. **语义靠 contexts 数组旁路**：引用实体后，前端把结构化上下文塞进 `contexts: MessageContext[]`（`project-agent-panel.tsx:464`），后端 `contextMaterializers`（`service/agent.go:1416`）按 type 拼 prompt。文本里没有锚点，Agent 只能读到“本条消息附带”的附加段，无法知道用户在哪一句、哪个位置引用了什么。

**更根本的问题：输入框本身到处各写一遍。** 同一个产品里，需要输入富文本/引用实体的地方至少有：

- Agent Chat 输入框（`agent-composer.tsx`，textarea）
- World Entity 的「简介」「正文」与长文本 attr（`world-entity/entity-editor.tsx:137-138`、`field-row.tsx` 的 textarea/input）
- 画布便签/文本元素（`worlds/[worldID]/canvas/**`）
- Caption / 字幕编辑、App iframe 输入框、设置中的描述字段……

它们现在都是裸 `<textarea>`/`<input>` 或各自实现的 contentEditable，**没有一处能 @ 引用实体，也没有统一的序列化协议**。若只为 Chat 做一个组件，这些地方将来会各造一套。

用户诉求有两层：

- **能力层**：像 `[Image 1]`、`@小黄牛` 那样，在富文本输入里内联引入实体上下文，AI 能直接识别、按引用找到实体。底层是 markdown + XML 协议，AI 不依赖私有 JSON。
- **复用层**：这必须是一个**可在全站任何输入位置复用的基础组件**（含 `@`），不是 Chat 专属。World Entity 的简介/正文/属性是明确的首批复用目标。

搬运来源：brainloop 的 `apps/mudflat/components/editors/`（Tiptap + 原子 mention 节点 + XML 序列化 + PM↔markdown 双向协议）。本 RFC 定义如何把这套能力**通用化**地引入 Recut，首个落地场景是 Agent Chat，但内核从第一天就按「全站复用」设计（见 §4.5）。

## 2. 目标与非目标

### 目标

- 提供一个**业务无关的富文本输入内核** `RichComposer`，一个内核覆盖全站所有输入位置（Agent Chat、World Entity 简介/正文/attr、画布文本、Caption、App iframe、设置描述）。
- **两种部署模式**（同一内核）：`plain`（纯富文本，无 @）与 `referencing`（启用 @ 引用上下文）。不需要引用的地方就用 plain，避免无谓拉取来源数据。
- 输入框内**内联展示**实体引用 chip（图标 + 名称），可插入、删除、点击跳转。
- 序列化为 **markdown + XML 内联标签**，人与 AI 都可读；AI 能据此定位实体并调用既有 MCP 工具读取真相；无引用的纯文本则退化为普通 markdown。
- 定义一个**受控的值契约**（`value`/`onChange`/`readOnly`/`placeholder`/`minRows`/`maxRows`/`variant`），使内核能替换任意现有 textarea，且可被包装成受控表单字段。
- 定义**可扩展的引用类型注册表**：新增一类可引用对象（素材 / World / Entity / Evidence / Timeline element …）只需注册 descriptor，不用改编辑器内核。
- 沿用并强化 Recut 现有的 `contexts` 旁路协议，二者通过**稳定 ID** 对齐（XML 标签携带 id，contexts 携带 payload）。无 AI 消费方的场景（如 Entity 正文）可只存 markdown+XML，不走 contexts。

### 非目标

- 不做任意 HTML 粘贴 / 富文本排版（仅 paragraph / hardBreak / 少量 markdown marks）；不做表格/图片嵌入等块级排版。
- 不重写后端 `contextMaterializers`：本 RFC 只补一个统一的 `inline_ref` 归并层（见 §7）。
- 不引入协同编辑（yjs 已有但输入框不需要）。
- 不在本 RFC 内实现 App iframe 输入框，只保证内核通用性与契约稳定（reuse PoC 见 §4.5）。

## 3. 参考实现盘点（brainloop）

| 能力 | brainloop 位置 | 可搬运性 |
| --- | --- | --- |
| 原子 mention 节点 | `common/extensions/source-mention.ts` | 直接搬运，泛化为 `reference` 节点 |
| `@` 触发解析 + 菜单坐标 | `common/extensions/mention-trigger.ts` | 直接搬运 |
| PM → markdown + atomHandlers | `common/utils/pm-to-markdown.ts` | 直接搬运 |
| 字符串 → PM（含 XML 标签还原） | `common/utils/prompt-string-to-doc.ts` | 直接搬运，扩展 `<media>`/`<entity>` |
| 结构化引用 `<context-quote>` | `lib/context-quote.ts` | 搬运 parse/serialize |
| 编辑器组装 + 键盘导航 + 粘贴 | `chat-input/chat-input-editor.tsx` | 参考结构，重写为 descriptor 驱动 |
| 序列化/提取 hook | `chat-input/hooks/use-chat-input.ts` | 泛化：按 descriptor 提取 refs |

**关键差异**：brainloop 的实现把 `source/skill/connection/tool` 四类硬编码进节点 attrs、序列化函数和提取函数。Recut 需要引用 `media_asset / creation_world / creation_entity / world_evidence / work_surface` 等更多类型，因此必须**把类型从内核中抽离成注册表**，否则每次新增类型都要改 5 个文件。

**第二个关键差异（复用）**：brainloop 的编辑器只服务 Chat，DOM 与业务耦合。Recut 要全站复用，所以内核必须**分层**：headless 的「值 + 协议 + 扩展」与「UI（菜单/chip/面板）」分离，plain 模式不依赖任何业务 store（§4.5）。

## 4. 分层架构

内核分三层，复用性由分层保证：

```
web/lib/rich-composer/                 ← L0 无 UI、无 React 依赖（可被任何渲染层用）
  protocol/
    serialize.ts               # PM ↔ markdown + XML（泛化 atomHandlers）
    parse.ts                   # 字符串 → PM，按 descriptor 还原标签
    xml.ts                     # 转义/属性序列化/解析（搬运）
    doc.ts                     # 纯文本 <-> PM doc 的便捷转换（textarea 迁移用）
  extensions/
    reference.ts               # 原子 inline 节点 reference（attrs 由 descriptor 决定）
    reference-trigger.ts       # @ 触发与替换（搬运自 mention-trigger）
    context-quote.ts           # 引用块节点（搬运自 context-quote extension）
  value.ts                     # RichComposerValue 类型与 normalize（见 §4.2）

web/components/rich-composer/          ← L1 React 内核（可配置开关）
  rich-composer.tsx            # 组件：Tiptap 组装、菜单、键盘、粘贴、空态、受控 value
  use-rich-composer.ts         # serialize / clear / isEmpty / getPayload / focus
  modes.ts                     # plain / referencing 两种模式装配（§4.5）
  components/
    reference-chip.tsx         # 内联 chip NodeView（图标 + 名称 + 删除/跳转）
    reference-menu.tsx         # 轻量候选菜单（窄场景，如 Entity 简介单行）
    context-quote-card.tsx     # 引用块视图

web/lib/context-catalog/               ← L2 目录 + 面板（仅 referencing 模式加载）
  registry.ts / search.ts / runtime.ts / sources/**
web/components/context-panel/          ← L2 双栏面板（见选择面 RFC）
```

- **L0 不 import React / 任何 store**：序列化可在 Node、Worker、测试里跑；Entity 正文等纯文本+引用场景可只用 L0。
- **L1 是唯一 UI 内核**：plain 模式只装 StarterKit + Placeholder（无 reference 节点、无 @ trigger、无菜单），产物体积与心智都最小；referencing 模式追加 `reference` 节点、`@` trigger、候选菜单，**按需**加载 L2。
- **L2 独立成目录**（选择面 RFC）：只有需要重面板的地方加载，Entity 简介这类轻场景可只用 L1 的 `reference-menu`，不拉 L2。

依赖（L1/L2）：`@tiptap/core`、`@tiptap/react`、`@tiptap/starter-kit`、`@tiptap/extension-placeholder`；L2 面板另需 `@tanstack/react-virtual`（Recut `web/package.json` 目前没有，需新增）。

### 4.1 组件公开契约（受控 value，可替换任意 textarea）

```ts
export type RichComposerProps = {
  value: RichComposerValue;                    // 受控；见 §4.2
  onChange: (value: RichComposerValue) => void;
  mode?: "plain" | "referencing";              // 默认 plain
  variant?: "composer" | "field" | "inline";   // 视觉/尺寸预设，见 §4.4
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  minRows?: number;                            // 取代写死像素高度
  maxRows?: number;                            // 超出滚动
  allowedRefTypes?: string[];                  // referencing 模式下限制可引用类型
  onKeyDown?: (event: KeyboardEvent, ctx: RichComposerKeyContext) => void;  // 宿主接管 Enter 等
  onPasteFiles?: (files: File[]) => void;
  onSubmit?: () => void;                       // 仅 composer variant 使用
  className?: string;
  "aria-label"?: string;
};
```

- 纯文本宿主可只关心字符串：`RichComposerValue.text` 即 markdown（含 XML），`RichComposerValue.refs` 在 plain 模式下恒为空。
- 宿主不需要引用时**不必**传 registry；`mode="plain"` 时就地降级。

### 4.2 值类型 `RichComposerValue`

```ts
export type RichComposerValue = {
  /** 序列化后的 markdown + XML 文本（持久化真相） */
  text: string;
  /** 结构化引用列表（referencing 模式；由 text 派生，按 identity 去重） */
  refs: ContextRef[];
  /** 编辑态 doc（可选，仅供同一会话内无损回填；不持久化） */
  doc?: unknown;
  /** 是否为空（只有空白或只有引用块时视为空） */
  isEmpty: boolean;
};
```

- 持久化只存 `text`（markdown+XML）。`doc` 仅用于**同一会话内**避免「text→doc→text」往返损耗；跨会话回填走 `parse(text) → doc`。
- `refs` 是派生值：`extractRefs(parse(text))`，宿主可选择忽略。

### 4.3 引用类型从简到繁的注册粒度

不同场景对 @ 的需求不同，注册表支持三种粒度，避免「一处用不上全部来源」：

| 粒度 | 用法 | 例子 |
| --- | --- | --- |
| 无引用 | `mode="plain"` | 普通备注、设置描述 |
| 限定类型 | `mode="referencing"` + `allowedRefTypes={["creation_entity"]}` | World Entity 简介/正文：只 @ 实体 |
| 全类型 | `mode="referencing"`，不限制 | Agent Chat：十类来源 |

`allowedRefTypes` 过滤在 registry 层生效（search 只 fan-out 允许的 sources，菜单只显示允许的组）。

### 4.4 变体（variant）——同一内核适配不同位置的视觉

| variant | 形态 | 首用位置 |
| --- | --- | --- |
| `composer` | 多行、自动增高、底部工具条、全屏宽 | Agent Chat |
| `field` | 单/多行、贴合表单行高、`minRows=1`、无工具条 | Entity 简介（1 行）、正文（多行）、长文本 attr |
| `inline` | 单行、宽度自适应内容、无换行 | 画布元素内联编辑、Caption 行 |

变体只改样式与默认 props，**不改协议与内核行为**。

### 4.5 部署模式与复用清单（首期目标）

| 场景 | 现状 | 目标模式/variant | 是否需要 L2 面板 | 持久化 |
| --- | --- | --- | --- | --- |
| Agent Chat | textarea | referencing / composer | 是（全类型） | `content` 含 XML + `contexts` |
| World Entity 简介 | `entity-editor.tsx:137` textarea | referencing / field（1 行，`allowedRefTypes` 实体） | 否（轻菜单） | entity.intro 存 markdown+XML |
| World Entity 正文 | `entity-editor.tsx:138` textarea | referencing / field | 否（轻菜单） | entity.detail 存 markdown+XML |
| 长文本 attr | `field-row.tsx:250` textarea | referencing / field | 否 | attr 值存 markdown+XML |
| 画布文本/便签 | canvas 自有 edit | plain 或 referencing / inline | 否 | canvas doc |
| Caption 字幕 | 现有字幕元素 | plain / inline | 否 | 字幕文本 |
| App iframe 输入 | 无 | referencing / composer | 复用 L2 | 由 App 自定 |

**Entity 简介/正文是首期验证复用性的关键场景**：它证明内核可在**无 Chat、无 contexts、无后端 materializer** 的情况下独立工作——只把 `text`（markdown+XML）存回 `entity.intro`/`entity.detail`，AI 读 World 时天然看到 `<creation_entity>` 锚点。

### 4.6 非 Chat 场景的 AI 可读性

Entity 正文里的 `<creation_entity worldid entityid />` 不需要走 Chat 的 contexts 旁路——它本身就是**存进 World 内容的数据**，AI 通过 `recut.worlds.brief` / `entities.get` 读取时直接看到锚点。因此：

- `toContext`/`inline_ref` 归并（§7）**只在 Agent Chat 发送链路**生效；非 Chat 场景不产生 contexts。
- 非 Chat 场景的 XML 是**内容的一部分**，读取方（含 AI 工具）负责解释；这也要求解析器对未知标签前向兼容（§9）。
- 这样「同一个 XML 协议」在 Chat 是「回合输入锚点」，在 World 是「内容内引用」，语义一致、实现不重复。

## 5. 引用类型注册表（内核通用性的关键）

### 5.1 唯一注册表 `ContextSource`

合并后只有一份描述符 `ContextSource`，住在 `web/lib/context-catalog/`。字段分两组：**协议组**（本 RFC 拥有，输入内核消费）与**目录组**（选择面 RFC 拥有，面板消费）。选择面 RFC 不再定义第二个类型。

```ts
export type ContextSource = {
  // ── 协议组（本 RFC 权威）────────────────────────────
  /** XML 标签名，也是 PM 节点 attrs.type 值。小写、稳定。 */
  type: string;
  /** 序列化/解析时允许出现在 XML 上的属性白名单 */
  attrs: readonly string[];
  /** 稳定身份字段（提取 refs 与 contexts 对齐）；即 ContextOption.key 的后半段 */
  identity: (attrs: Record<string, unknown>) => string | null;
  /** chip 图标（NodeView 与回复卡片共用） */
  icon: (attrs: Record<string, unknown>, ctx: { apiBase: string }) => ReactNode;
  /** chip 文案 */
  label: (attrs: Record<string, unknown>) => string;
  /** 转换为宿主 contexts 项（§7）；返回 null 表示仅内联不旁路 */
  toContext?: (attrs: Record<string, unknown>) => MessageContext | null;
  /** 点击 chip 的行为（跳转/预览），可选 */
  navigate?: (attrs: Record<string, unknown>, ctx: { apiBase: string }) => void;
  /** 是否允许内联进正文；false = 只能 attach 到芯片行（如 work_surface） */
  inlineInsertable: boolean;

  // ── 目录组（选择面 RFC 权威）────────────────────────
  group: ContextGroupID;                 // 见 §5.2
  titleKey: string;                      // 来源级显示名（i18n key）
  insertMode: "inline" | "attach";
  filters?: (runtime: ContextRuntime) => { key: string; labelKey: string }[];
  scope?: "world" | "project" | null;
  search: (ctx: ContextSearchContext) => Promise<ContextOption[]>;
  preview: (option: ContextOption, ctx: ContextSearchContext) => Promise<ContextPreview> | ContextPreview;
  rank?: (option: ContextOption, query: string) => number;
};
```

- `ContextGroupID`、`ContextOption`、`ContextPreview`、`ContextSearchContext`、`ContextRuntime` 的完整定义见选择面 RFC §10。
- `identity(attrs)` 与 `ContextOption.key = `${type}:${identity}`` 是同一条身份的两种表达，实现上 `identity` 只写一次。

### 5.2 `group` 取值（唯一权威）

`current | world | workspace | media | capability`，语义见选择面 RFC §5。本 RFC 旧版示例里的 `surface/app` 作废。

### 5.3 类型目录（唯一权威，选择面新增类型须回填本表）

| type | group | insertMode | 身份（`identity`） | toContext type | 读取真相的 MCP 工具 | 后端 materializer |
| --- | --- | --- | --- | --- | --- | --- |
| `media` | media | inline | `assetId` | `media` | `recut.media.*` | ✅ 已有 |
| `creation_world` | world | inline | `worldId` | `creation_world` | `recut.worlds.brief` | ✅ 已有 |
| `creation_entity` | world | inline | `worldId`+`entityId` | `creation_entity` | `recut.worlds.entities.get` | ✅ 已有 |
| `world_evidence` | world | inline | `worldId`+`evidenceId` | `creation_evidence` | `recut.worlds.evidence.list` | ⛔ 新增 |
| `work_surface` | current | **attach** | `surface`+`targetId` | `work_surface` | 无（宿主签发） | ✅ 已有 |
| `work_focus` | current | **attach** | `view`+selection hash | `work_focus` | 无（宿主签发） | ✅ 已有 |
| `project` | workspace | inline | `projectId` | `project` | `recut.project_context` | ⛔ 新增 |
| `app` | workspace | inline | `appId` | `app` | App Skill / manifest | ⛔ 新增 |
| `skill` | capability | inline | `appId`+`skillId` | `skill` | 加载对应 SKILL.md | ⛔ 新增 |
| `mcp_tool` | capability | inline | `name`(+`appId`) | `mcp_tool` | 直接调用该工具 | ⛔ 新增 |

规则：

- `inlineInsertable: false` 仅 `work_surface` / `work_focus`（宿主签发，遵循 Work Surface RFC）；二者 `insertMode: "attach"`。
- 新增类型 = `registry.ts` 追加一项（协议+目录字段）+ 后端 `contextMaterializers`（若需旁路）追加一项；输入内核与面板 UI **零改动**。
- `world_evidence` 是两 RFC 合并时补回的类型（旧选择面漏列）；`project/app/skill/mcp_tool` 是旧内联 RFC 漏列、由选择面补入——合并后统一以本表为准。

## 6. XML 协议（人与 AI 的共享真相）

### 6.1 语法

内联原子引用（自闭合，行内可任意位置）：

```xml
<media type="image" assetid="asset_abc" name="奔跑的黄牛" />
<creation_world worldid="w_123" name="雪山世界" revisionid="rev_9" />
<creation_entity worldid="w_123" entityid="e_45" kind="character" name="小黄牛" />
<world_evidence worldid="w_123" evidenceid="ev_7" name="概念图" />
<project projectid="proj_1" name="8-16 项目" />
<app appid="recut.editor" name="Recut Editor" />
<skill appid="recut.editor" skillid="editor" name="编辑器工作流" />
<mcp_tool name="recut.timeline.command" appid="recut.editor" />
```

引用块（用户从页面选中一段送入时，保留上下文与定位）：

```xml
<context-quote data-source-type="worlds" data-source-id="w_123"
  data-ref-type="world_entity" data-ref-id="e_45" data-title="小黄牛"
  data-position-hint='{"from":0,"to":12}'>被选中的原文</context-quote>
```

### 6.2 通用规则

- **行内**标签一律自闭合、小写、属性值 XML 转义。属性顺序稳定（`identity` 字段优先），便于 diff 与测试。
- **不应**放进 XML 的：长文本、prompt、媒体本地 path。这些由 ID 指向，AI 用工具现取（与 `materializeMediaContext` 的 path 单次使用纪律一致）。
- `name` 是**展示冗余**，不是身份；解析时以 id 为准，`name` 缺失可回退。
- 兼容旧格式：解析器同时接受 `snake_case` 属性与 brainloop 风格的 `<source|skill|connection>` 标签（迁移期，见 §11）。

### 6.3 属性命名规范（两 RFC 唯一权威）

- **全部小写、无下划线、无驼峰**：`assetid`（非 `assetId`）、`worldid`、`entityid`、`evidenceid`、`projectid`、`appid`、`skillid`、`revisionid`。
- 展示冗余字段统一为 `name`（人类可读），`kind`/`type` 仅在需要时出现。
- 顺序稳定：先身份字段（`identity` 必需字段），再 `name`，再其余；便于 diff 与快照测试。
- 解析器**大小写不敏感**（兼容 `assetId`），但**序列化永远输出规范小写**。选择面 RFC §12 的示例须与本规范对齐（其 `<project projectid>`、`<mcp_tool name appid>` 已合规）。
- `context-quote` 保留 `data-*` 前缀（搬运自 brainloop `context-quote.ts`），不参与上述规范化。

### 6.4 序列化示例

输入框内容：

```
小黄牛 <media type="image" assetid="asset_2" name="图片 2" /> 在陡峭雪坡 <media type="image" assetid="asset_1" name="图片 1" /> 上奋力攀爬。

<creation_entity worldid="w_123" entityid="e_45" kind="character" name="小黄牛" />：3D 动画风格，直立行走的牛……
```

发往 Agent 的 user message（`content`）即上述文本原样。AI 从中直接看到 `<media>`、`<creation_entity>`，并用 §7 的提示找到实体。

## 7. 与 backend contexts 的关系（仅 Agent Chat 的双轨对齐）

> **适用范围（重要）**：本条链路**只服务 Agent Chat**。非 Chat 复用位置（Entity 简介/正文、画布文本等）不产生 `contexts`，直接把 `text` 存为内容（§4.6）。因此 `toContext`/inline 归并是**可选能力**，内核本身不依赖它。

保留 Recut 现有 `contexts` 旁路，但让**内联标签成为主锚点**，`contexts` 成为**结构化校验与媒体物化**通道。

- 前端 `RichComposer.getPayload()` 返回 `RichComposerValue`（§4.2），其中 `text` 含 XML，`refs` 是按 descriptor `toContext()` 提取的去重 context 列表。
- 发送时沿用 `project-agent-panel.tsx` 的 `contexts` 字段（不破坏旧链路），额外把 `text` 里的 XML 一并作为 `content` 发出。
- 后端 `StartTurn` 在 `contextMaterials` 后做一次 **inline ref 归并**：扫描 `text` 中的引用标签，若某 id 未出现在 contexts 中，则按 type 生成补充 material（防止前端漏传）。

新增一个 materializer，type = `inline_ref`，或在 `contextPrompt` 末尾追加：

```
本条消息正文内联引用了以下上下文，请按 ID 用对应工具读取真相：
<inline-refs>
  <creation_entity worldid="w_123" entityid="e_45" /> → recut.worlds.entities.get({ worldId, entityId })
  <media assetid="asset_2" /> → 已在全局素材库，媒体工具用 assetId 引用
</inline-refs>
```

**为什么双轨**：内联标签保证 AI 能读到“用户在哪句引用了谁”；`contexts` 保证媒体二进制被物化为 CLI `--image` 参数、World 被校验存在、Work Surface 被宿主签发。二者 ID 必须一致，由 descriptor 的 `identity` 保证。

### 7.4 去重权威（关闭旧未决项）

两 RFC 曾各自把「正文 XML 主锚点 vs `contexts` 为准」列为未决。**决议：正文内联 XML 是唯一权威锚点；`contexts` 是它的投影。**

- **同一对象在正文出现多次**：`getPayload()` 按 `identity` **去重生成一条 `contexts` 项**，正文保留多处 XML（用户在哪句引用就写在哪句）。
- **出现歧义时以正文为准**：若 `contexts` 含某 id 而正文没有对应标签（例如宿主自动装配的 `work_surface`/`work_focus`，它们 `inlineInsertable: false`，本就无正文锚点），视为**宿主上下文**，保留；若正文有标签而 `contexts` 缺（前端漏传或历史消息），后端 §7 的 inline 归并**补齐**。
- **媒体特殊**：媒体靠 `contexts` 物化 `--image`，但身份仍取正文标签里的 `assetid`；正文无 `media` 标签而 `contexts` 有（旧历史）时，按旧旁路处理，不回填正文。
- 前端持久化 turn 的 `content` 即含 XML 的原始文本；`contexts` 可随时由 `content` + 宿主签名上下文**重建**（这保证了权威单向性）。

## 8. 接入形态

### 8.1 Agent Chat（首用，referencing / composer）

改造 `agent-composer.tsx`：

- 用 `<RichComposer mode="referencing" variant="composer">` 替换 `<textarea>`；**保留**下方/上方的芯片行用于 `work_surface`（宿主签发、非用户内联）与已上传附件。
- 原来 `@([^\s@]*)$` 的正则与 `AssetReferenceMenu` 退役，由 `RichComposer` 的 trigger + registry search 取代（菜单里同时出现素材库、World、Entity 分组）。
- `pasteMedia` 的 `<media assetid>` 剪贴板解析迁移进 `parse.ts`，粘贴即还原为 chip。
- 提交时 `onSend` 从 `content: string` 改为 `payload: RichComposerValue`；`project-agent-panel.tsx:483` 的 JSON 组装相应更新（`content: value.text`，`contexts` 由 `value.refs` + 宿主签名上下文合成）。
- 空态判断：只有白空格或只有 `context-quote` 视为空（沿用 brainloop `isUserAuthoredChatInputDocEmpty`）。

保留的既有能力：Work Surface chip、Work Focus chip、Codex/Opencode 配置 popover、上传按钮、stop。它们与内联引用正交，不动。

### 8.2 World Entity 简介/正文（复用验证，referencing / field）

改造 `web/components/world-entity/entity-editor.tsx:137-138` 与 `field-row.tsx`：

- 「简介」「正文」「长文本 attr」的 textarea → `<RichComposer mode="referencing" variant="field" allowedRefTypes={["creation_entity","creation_world","media"]} minRows={1|4} maxRows={...}>`。
- 保存：`onChange` 直接把 `value.text` 存回 `entity.intro`/`entity.detail`/attr 值（**不产生 contexts，不走后端**）。
- 空态与校验：`value.isEmpty` 决定占位与必填；`readOnly` 映射现有权限。
- 轻量菜单：这里**不加载 L2 双栏面板**，用 L1 的 `reference-menu` 即可。
- 这一场景同时验证 §4.6：正文里的实体引用作为 World 内容被 AI 读取。

### 8.3 其他位置（后续，按 §4.5 清单推进）

画布文本/便签（inline）、Caption（plain/inline）、App iframe（referencing/composer，复用 L2）按里程碑 M6 逐个迁移。每个位置只需选 `mode/variant/allowedRefTypes`，无需改内核。

## 9. 回复侧渲染

`agent-message-content.tsx` 已能解析 `<media>/<project>/<app>`。扩展为复用同一份 `registry.ts` + `parse.ts`：

- 新增 `reference` 段类型：任何注册 type 的标签都渲染成对应卡片（媒体→`MediaPreview`，World/Entity→新卡片，复用 `agent-reference-card.tsx` 模式）。
- 未注册标签保持原文，不报错（前向兼容）。
- 卡片点击行为由 descriptor `navigate` 决定（Entity → 打开 World 画布定位；World → 打开 World 页）。

同一份 `parse.ts` 也服务非 Chat 场景的**只读展示**（如画布卡片预览渲染 Entity 正文）：输入侧写入的 XML，输出侧用同一解析器渲染 chip/卡片，读写成环。

## 10. 数据流全景

```
用户输入 ── Tiptap doc
   │
   ├─ serialize (pm → markdown + XML) ─────────────────┐
   │                                                    ▼
   │                                          content: "...<media .../>..."
   │                                                    │
   └─ extractRefs (registry.identity + toContext) ──► contexts: MessageContext[]
                                                        │
                                                        ▼
                        POST /v1/agent-sessions/:id/turns { content, contexts }
                                                        │
                                    service: contextMaterials + inline 归并
                                                        │
                                          runtimePrompt() + contextPrompt()
                                                        │
                                              Codex/Claude/Opencode CLI
                                                        │
                                           AI 读 XML → 调 MCP 工具取真相
```

## 11. 迁移与兼容

1. **安装依赖**：`pnpm --filter web add @tiptap/core @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder`。
2. **textarea 迁移路径**：现有 `entity.intro`/`entity.detail`/attr 等是**纯文本**，迁移时用 `parse()` 把历史纯文本当作一个段落读入（无标签→无 chip）；保存后 `text` 即 markdown+XML。首存后旧字段语义从「纯文本」升级为「markdown+XML」，读取方需容忍两者（旧值无标签，等价于 plain）。
3. **兼容旧 `<source|skill|connection>`**：`parse.ts` 保留 brainloop 遗留标签解析（Recut 现无此类历史数据，仅为搬运期复用其测试用例）。
4. **剪贴板兼容**：`<media assetid="...">` 持续支持（`asset-reference-picker.tsx:36` 的 `mediaTag` 迁入内核）；从 RichComposer 复制出的 markdown+XML 粘贴回 RichComposer 应无损还原 chip。
5. **旧 turn 历史**：已持久化的多条 `agent_turn_contexts` 仍走旁路渲染；新 turn 才有内联标签。回复渲染对两种都兼容。
6. **未知标签前向兼容**：非 Chat 内容（World 正文）可能含未来新增标签；解析器不认识的标签**原样保留为文本**，绝不清除用户内容。
7. **回滚**：Chat 用 feature flag 切换回 textarea；`content`/`contexts` 契约不变，后端无需回滚。各复用位置可独立决定是否迁移，互不阻塞。

## 12. 可测试点

- **协议单测（L0）**（搬运 brainloop `extract-mentions.test.ts`、`prompt-string-to-doc.test.ts`）：
  - PM → markdown 的 XML 属性顺序与转义稳定。
  - XML → PM → XML 往返幂等（含嵌套段落、换行、特殊字符）。
  - 未知标签原样保留；纯文本往返无损耗。
- **registry 单测**：新增 descriptor 不改内核即可被搜索/序列化/提取；`allowedRefTypes` 正确裁剪 sources。
- **组件测试**：三种 variant 的尺寸/换行；`@` 触发、键盘上下选择、Enter 插入 chip、Backspace 删除、粘贴还原；`readOnly`/`disabled`。
- **复用回归（关键）**：Entity 简介/正文用 `field` variant 独立工作——不传 contexts、不依赖任何 store、只存回 `text`；含 `<creation_entity>` 的正文经 `parse` 再渲染出 chip。
- **端到端（Chat）**：输入 `@` 选中小黄牛 → 发送 → 断言 `content` 含 `<creation_entity>` 且 `contexts` 含 `creation_entity` → 后端 Go httptest 断言 prompt 含 inline 提示。
- **回复渲染**：`<creation_entity/>` 渲染为卡片并可点击。

## 13. 里程碑（与选择面 RFC 合并后的单一序列）

两个 RFC 的里程碑合并为一条，避免重复排期。每一项标注 owner（P=协议/本 RFC，U=选择面 RFC）。

| 阶段 | owner | 交付 | 验收 |
| --- | --- | --- | --- |
| M0a 内核协议 | P | L0 `lib/rich-composer/**` + `registry.ts`（`ContextSource` 协议组）+ 往返单测 | 往返幂等全绿；与 brainloop 用例等价 |
| M0b 目录内核 | U | `context-catalog/{types,registry,search,runtime,recent}` + `ContextSource` 目录组 + 合并/排序/去重单测 | 纯函数用例全绿；workspace 来源可搜索 |
| M1 面板 UI | U | 双栏面板、虚拟列表、分组/过滤、预览、键盘、Portal 响应式；inline 类型先以 attach 芯片行承载 | 可用 @ 搜索并预览「当前/Worlds/素材」并插入 |
| M2 输入内核 | P | L1 `RichComposer`（plain/referencing、三种 variant）+ chip + trigger + 粘贴还原，接入 Chat 与 Entity 简介/正文 | **两处**都能内联引用；Entity 场景无 contexts 独立工作 |
| M3 双轨对齐 | P | `getPayload{content,refs}` + 后端 inline 归并 + 提示段 | 端到端 prompt 含正确 ID 与工具指引 |
| M4 工作台/能力来源 | U | `project/app/skill/mcp_tool` 来源 + 4 个后端 materializer + 对应 XML（回填 §5.3） | 端到端 @ 项目/应用/实体/skill/工具 → prompt 正确 |
| M5 回复复用 | P | `agent-message-content` 复用同一 registry（含非 Chat 只读展示） | 任一注册 type 的回复/内容卡片可渲染可跳转 |
| M6 全站复用铺开 | P | 画布文本/Caption/App iframe 按 §4.5 清单迁移 | 各位置仅改 mode/variant/allowedRefTypes，内核零改动 |

> 排序理由：先建**共享注册表**（M0a/M0b 可并行），面板先能用（M1，含降级），再让内联落正文（M2 依赖 Tiptap），双轨对齐在两者之后（M3）；新增来源（M4）只加 descriptor 与 materializer；M6 验证「通用组件」这一根本目标。

## 14. 未决问题

已在合并中关闭的（不再开放）：

- ~~`work_surface` 是否允许内联~~ → **否**，`inlineInsertable: false`（§5.1/§5.3）。
- ~~属性命名 `assetid` vs `assetId`~~ → **序列化统一小写 `assetid`**，解析大小写不敏感（§6.3）。
- ~~多段引用是否去重~~ → **正文保留多处，`contexts` 按 identity 去重**（§7.4）。
- ~~去重权威（正文 vs contexts）~~ → **正文 XML 为唯一权威**（§7.4）。

仍开放：

1. **内联标签是否进 Chat 持久化 `content`**：倾向进入（AI 需要）。需确认 turn 列表预览文案是否剥离标签（建议剥离，只留 `name`）。
2. **Tiptap 版本与 React 19 兼容性**：接入前需验证（Recut 用 React 19.2 / Next 16）。
3. **非 Chat 内容的 `doc` 回填策略**：Entity 正文是否也持久化 `doc`（换取无损回填），还是每次从 `text` 重解析（省体积、有往返损耗）。倾向后者，仅 Chat 会话内缓存 `doc`。
4. **同一 World 内的实体引用是否需要 scope 校验**：Entity 正文里 @ 另一 Entity 时，是否限制只能引用同 World（避免跨世界误引）；倾向允许跨 World 但 UI 默认过滤当前 World（§4.5）。
5. **selection 内 timeline/component ref 的 context type**：依赖 editor surface，需与 Work Surface RFC 对齐后补 `timeline_element`/`component` descriptor（两 RFC 共同未决）。

## 15. 影响文件清单

**新增**
- `web/lib/rich-composer/**`（L0：protocol/extensions/value）
- `web/components/rich-composer/**`（L1：组件/use-rich-composer/modes/chip/menu）
- `service/agent.go`：`materializeInlineRefContext` + `contextPrompt` 追加段（仅 Chat 链路）

**修改（Chat）**
- `web/components/agent-composer.tsx`：textarea → RichComposer（referencing/composer）
- `web/components/project-agent-panel.tsx`：`send()` 的 `RichComposerValue` 组装
- `web/components/agent-message-content.tsx`：复用 registry 渲染
- `web/package.json`：Tiptap 依赖
- `service/agent.go`：`contextMaterializers` / `contextPrompt`

**修改（首批复用，验证通用性）**
- `web/components/world-entity/entity-editor.tsx`：简介/正文 textarea → RichComposer（referencing/field）
- `web/components/world-entity/field-row.tsx`：长文本 attr textarea → RichComposer（referencing/field）

**后续（M6，按 §4.5 清单）**
- 画布文本/便签、Caption、App iframe 输入框

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
