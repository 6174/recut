<!--
 * [INPUT]: 依赖 2026-09-14-rich-context-composer-protocol（inline XML 协议、ContextSource 注册表、L0 parse/serialize）、
 *   2026-09-14-unified-context-mention-panel（@ 面板目录组、media 组）、2026-08-24-skymind-token-api-provider（provider 参考素材经公网分享）、
 *   2026-08-22-editor-captions-audio-studio-asr（能力桥）、现有实现
 *   （web/lib/media/generation-request.ts、web/app/worlds/[worldID]/canvas/panel/media-editor.tsx、apps/cover-studio、apps/ai-short-film、
 *   service/media/model_providers/**）
 * [OUTPUT]: 定义「生成提示词内的参考引用协议」产品与技术方案：统一 `<reference>` 标签（id/kind/role/label）、
 *   role 受控词表、三消费者（创作 Agent / @ 面板 / 生成模型）三种形态、resolver（token→编号别名→referenceIds→校验→sidecar）、
 *   与既有 rich-context-composer-protocol 的合并关系、迁移与里程碑
 * [POS]: rfc 的「生成提示词引用」决策；复用 09-14 两 RFC 的同一份 ContextSource 注册表与 XML 内核，
 *   只新增面向生成链路的 role 语义与模型侧别名导出；不改 Agent chat 既有双轨协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# 生成提示词参考引用协议（Generation Reference Protocol）

- 状态：设计草案（待评审）
- 日期：2026-09-15
- 关联：[富文本上下文输入协议](./2026-09-14-rich-context-composer-protocol.md)、[统一上下文引入面板](./2026-09-14-unified-context-mention-panel.md)、[Skymind Provider](./2026-08-24-skymind-token-api-provider.md)、[字幕 / capability bridge](./2026-08-22-editor-captions-audio-studio-asr.md)

## 0. 摘要

图片/视频生成提示词里的「参考图锚定」（现有工作流写成 `{{Mixed 1}}…{{Mixed 8}}`）目前**没有协议**：`media-editor.tsx` 把 `prompt` 与 `referenceIds[]` 当成两个互不相关的字段提交（`web/lib/media/generation-request.ts:25`），提示词正文没有任何锚点，`referenceIds` 只有顺序、没有角色语义。结果是创作 Agent 无法在正文里说「1 号作视角、8 号作色卡」，人回看也看不懂哪张图干嘛，模型侧只能靠猜。

本 RFC 给出一个协议：

- **一个统一标签** `<reference id kind role label />`，取代 09-14 协议里 per-type 的 `<media assetid>` / `<creation_entity>` 等**作为序列化出口**（内部仍保留 per-type descriptor）。
- **一条 resolver**：正文 token → 按首次出现编号 → 导出模型侧别名（`参考图N` / `音频N`，可配 `{{Mixed N}}`）→ 生成同序 `referenceIds[]` → 校验 → 保留 sidecar。
- **三种形态**：同一个引用在「创作 Agent / @ 面板 / 生成模型」眼里分别是 ID、chip、别名，互不混用。

核心判据（本 RFC 的第一原则）：**`id` 的职责是绑定，别名的职责是指称。** 生成模型不是 Agent，不会调 MCP，提交串里出现裸 `assetId` 只会稀释权重；平台/Agent 又必须拿到稳定 ID 才能校验。因此同一份引用必须分形态渲染，不能用一个字符串同时满足。

## 1. 问题

### 1.1 提示词与参考分离

`GenerationRequestInput`（`web/lib/media/generation-request.ts:11`）的 `prompt: string` 与 `referenceIds?: string[]` 是并列字段。`media-editor.tsx` 用两个独立控件维护：一个 prompt textarea，一个参考素材芯片行（`AssetReferenceDialog`）。两者之间没有锚点，无法表达「这一段用的是第几张图」。

### 1.2 只有顺序，没有角色

`referenceIds` 是扁平数组。模型收到 N 张图 + 一段文字，但文字里没有「第 1 张负责什么」的稳定声明。现有各 Mode 指南只有一种角色声明——人物参考（`参考图N为X的人物参考图`，见 `recut-directing-director/references/modes/animated-explainer/video-prompt-guide.md:80`）。而真实工作流里需要的是**多类型角色**：视角锚定 / 整段色卡 / 环境 / 人物 / 音色锚定。

### 1.3 存储即提交，无法回溯

`asset.metadata.prompt` 存的是最终提交串，`referenceIds` 存的是数组，二者靠调用时刻的隐式顺序对齐。一旦需要重生成/复制配方（`media-editor.tsx:365` 的配方继承），只能按同一个 `prompt` 重新提交，无法回答「这张图当时是哪个角色」。

## 2. 目标与非目标

### 目标

- 定义统一、稳定、人和 AI 都可读的**提示词内联引用语法**。
- 定义 **role 受控词表**，让「视角/色卡/环境/人物/音色」等锚定语义可被机器校验。
- 定义**确定性 resolver**：编号规则、别名导出、`referenceIds` 顺序、校验与失败策略。
- 让同一份引用在 **Agent（ID）/ @ 面板（chip）/ 生成模型（别名）** 三种形态下无损流转，并可由 sidecar 回溯。
- **复用** 09-14 两 RFC 的同一份 `ContextSource` 注册表与 XML 内核，不另造一套 @ 体系。

### 非目标

- 不改 Agent chat 既有的 `contexts` 双轨协议与去重权威（正文 XML 为主锚点，见 09-14 RFC §7.4）。
- 不定义 provider 方言（Seedance/Nano Banana/Atlas 的控制面参数、负面词字段、`modeType`）——那属于各 App 适配层；本协议只负责「引用如何表达与绑定」。
- 不引入向量检索或自动配图；引用由用户或 Agent 显式给出。
- 不解决模型对参考图的「理解力」问题，只解决「指称与绑定」问题。

## 3. 统一标签 `<reference>`

### 3.1 语法

行内自闭合、小写、属性 XML 转义（沿用 09-14 RFC §6.2/§6.3）：

```xml
<reference id="asset_a1"  kind="image" role="pov"        label="执明视角" />
<reference id="asset_a8"  kind="image" role="color-card" label="整段色卡" />
<reference id="asset_a3"  kind="image" role="character"  label="丹朱" />
<reference id="asset_a6"  kind="audio" role="voice"      label="执明音色" />
```

### 3.2 属性

| 属性 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 稳定身份（media assetId；非 media 对象为其主键，如 entityId）。**仅平台/Agent/面板可见，不进入模型提交串。** |
| `kind` | 是 | 对象/模态：`image / video / audio / transcript / entity / world / project / app / skill / tool`。生成链路主要用前三者。 |
| `role` | 生成链路必填 | 受控角色词，见 §4。纯 Agent chat 引用可省略。 |
| `label` | 是 | 人类可读别名，供 chip 显示与模型侧alias 兜底；不是身份（身份以 `id` 为准）。 |
| 其余 | 否 | 非 media 对象按 09-14 RFC §5.3 追加其身份字段（如 `worldid`），仍用同一标签。 |

### 3.3 与 09-14 协议的关系

09-14 RFC 用 per-type 标签（`<media assetid>`、`<creation_entity worldid entityid>`…）。本 RFC 把**序列化出口统一为 `<reference>`**，`kind` 承担 per-type 的区分：

- 注册表 `ContextSource`（09-14 RFC §5.1）**保留**，每个 descriptor 仍持有 `identity/icon/label/toContext`；其 emit 函数统一产出 `<reference kind="...">`。
- 解析器（`web/lib/rich-composer/protocol/parse.ts`）**同时**接受旧 per-type 标签（前向兼容），序列化只输出 `<reference>`。
- 这是**协议收敛**，不是新增第二套；`rich-context-composer-protocol` §5.3 类型表与 §6 示例需按本 RFC 回填 `kind` 列。

## 4. role 受控词表

| role | 适用 kind | 语义 | 模型侧声明模板（中文） |
| --- | --- | --- | --- |
| `pov` | image/video | 视角/机位锚定 | `参考图{n} 作为{主体}视角锚定` |
| `color-card` | image | 整段色卡/调色锚定 | `参考图{n} 作为整段画面色卡锚定，所有色彩严格按色卡执行` |
| `environment` | image/video | 环境/场景锚定 | `参考图{n} 作为环境视角锚定` |
| `character` | image | 人物视觉锚定 | `参考图{n} 作为{人物}视觉锚定` |
| `prop` | image | 关键道具/物件锚定 | `参考图{n} 作为{道具}外观锚定` |
| `style-ref` | image | 风格参考（低频校准） | `参考图{n} 仅作风格校准，不进入默认生成路径` |
| `motion-ref` | video | 运动/表演参考 | `参考视频{n} 作为运动与调度参考` |
| `voice` | audio | 音色锚定 | `音频{n} 仅用于参考{说话人}的音色特征` |
| `sfx` | audio | 音效参考 | `音频{n} 作为{效果}音效参考` |
| `music` | audio | 音乐参考 | `音频{n} 作为背景音乐参考` |

规则：

- role 与 kind 必须匹配（`voice/sfx/music` 只能 audio，`color-card` 只能 image）；不匹配即校验失败。
- 同一 role 可出现多次（多人物、多音色），以 `label` 区分。
- 模型侧声明模板是**默认话术**，App 适配层可按 provider 方言覆盖，但「role 语义 + 编号」不变。

## 5. resolver：从存储到提交

resolver 是**纯函数**，放 `web/lib/media/generation-reference.ts`（可单测），或复用于 `rich-composer` 的 `getPayload()`。

```
正文(含 <reference>) ──► 1. 扫描 ──► 2. 编号 ──► 3. 改写别名 ──► 提交串
                          │                                    + referenceIds[]
                          └─► 4. 校验 role↔kind / 未绑定 fail closed
                          └─► 5. 产出 sidecar referenceBindings
```

### 5.1 编号规则

- 按 token 在正文中**首次出现顺序**编号，**一次绑定、多处可用**。
- 按 kind 分组独立编号：`image/video` → `参考图1..N`；`audio` → `音频1..N`（与各 Mode 指南的「音频1」一致）。
- 同 id 重复出现不重复编号（引用去重按 `id`，与 09-14 RFC §7.4 的 identity 去重一致）。

### 5.2 别名导出

- 默认：`参考图{n}` / `参考视频{n}` / `音频{n}`。
- 可配置模板：把 `参考图{n}` 切换为 `{{Mixed n}}` 等 provider/团队习惯写法（`providerAliasTemplate`）。**展示层可换，绑定层不变。**
- 导出时在别名后按 role 表拼接声明；是否保留 `（{role 中文名}）` 由模板决定。

### 5.3 `referenceIds` 顺序

- `image/video` 组与 `audio` 组分别按编号顺序拼接为最终 `referenceIds`；顺序**严格等于**提交串里的编号顺序。这是唯一可检验的绑定证据。
- 具体哪组先、是否交错，由 provider 契约决定；resolver 输出两段，服务端按 provider 组装。

### 5.4 校验与失败策略

- role↔kind 不匹配 → 拒绝提交。
- token 引用了未绑定/不存在的 id → **fail closed**，返回明确错误（不静默丢弃）。
- 无 role 的生成类引用 → 警告并要求补 role（生成链路 role 必填）。
- `label` 缺失 → 回退到素材名；仍缺则用 `{kind}{n}`。

### 5.5 sidecar

`asset.metadata.referenceBindings = [{ id, kind, role, label, order }]` 随素材保存。重生成/复制配方（`media-editor.tsx:365`）与 `copyRecipe()`（`media-editor.tsx:469`）据此无损回填，**不反解 provider 文本**。

## 6. 三消费者形态（本 RFC 的第一原则）

| 消费者 | 形态 | 示例 |
| --- | --- | --- |
| 创作 Agent（写 prompt 的） | 正文内 `<reference id …>` + sidecar | `<reference id="asset_a1" kind="image" role="pov" label="执明视角"/>` → 可 `recut.media.list_assets({ids})` 校验 |
| @ 面板 / 编辑器 | chip（缩略图 + label + role badge） | `[🖼 执明视角 · 视角]` |
| 生成模型 | 别名提交串 + 同序媒体输入 | `参考图1 作为执明视角锚定` + `referenceIds=[asset_a1,…]` |

- **别让模型看见 id**：模型侧提交串必须只含别名与声明。
- **别让 Agent 只看别名**：同名会漂移，Agent 必须能拿到 id 去校验存在性、kind、role。
- @ 面板插入 chip 即写 `<reference>`；chip 与存储同源（正文为唯一权威）。

## 7. 数据契约

```ts
export type GenerationRefKind = "image" | "video" | "audio" | "transcript" | "entity" | "world" | "project" | "app" | "skill" | "tool";

export type GenerationRefRole =
  | "pov" | "color-card" | "environment" | "character" | "prop" | "style-ref"
  | "motion-ref" | "voice" | "sfx" | "music";

export type ReferenceBinding = {
  id: string;
  kind: GenerationRefKind;
  role: GenerationRefRole;
  label: string;
  /** 1-based，按 kind 组内编号 */
  order: number;
};

export type ResolvedGenerationPrompt = {
  /** 已把 <reference> 改写为别名的模型提交串 */
  prompt: string;
  /** 组内编号顺序，服务端据此组装 provider 输入 */
  referenceIds: string[];
  bindings: ReferenceBinding[];
  /** 未绑定 id / role-kind 冲突等 */
  errors: { code: string; id?: string; detail: string }[];
};

export function resolveGenerationPrompt(
  text: string,
  opts?: { providerAliasTemplate?: (kind: GenerationRefKind, n: number) => string },
): ResolvedGenerationPrompt;
```

## 8. 与既有技能的关系

- `recut-directing-shot`：只写「镜头意图」（模型中性）；把「生成 prompt 的形状/角色锚定」**移交**给新技能 `recut-directing-generation-prompt`（该技能边界表原有的「各 App 适配层」一栏细化为「生成提示词技能 + App 模型方言」）。
- `recut-directing-generation-prompt`（本 RFC 配套新增的全局技能）：定义 STYLE LOCK、参考锚点表、多镜连续段、声画与负面的**提示词骨架**，并强制使用本 RFC 的 `<reference>` + role。
- `ai-short-film` / `cover-studio` / `media-editor`：改为消费 resolver，不再各自维护「prompt + referenceIds 双源」。

### 8.1 World（world.md）与 World Canvas 的结合

World 与生成链路目前是**断开**的，需要在这里对齐。

**现状盘点**

| 对象 | AI 面向的技能 | 位置 | 覆盖 |
| --- | --- | --- | --- |
| World 内容/生产 | `world.md`（世界技能） | `worlds/<slug>/world.md` → `recut.worlds.brief.skill` 全文内联 | 每世界一套生产工作流；xiaohei 已含「生图提示词模板」「资源口径」 |
| World 读取 | platform `recut` skill §Creation Worlds（`service/skills/recut/SKILL.md`） | brief/get/list/entities.list/get/resolve | 只读入口 |
| World 写/Onboarding | `recut-worlds`（画布接口） | `recut.worlds.entity` / `relation` / `entityType`（内容）+ `worlds.update`（world.md） | 方案 A：内容写入统一经画布接口；语义 CRUD 已下线 |
| World Canvas 操作 | **`recut-worlds`**（2026-09-15 新增） | `service/skills/recut-worlds/SKILL.md` | 属性模型、显示三层、边即关联、提升语义 |
| 画布媒体生成 | **生成提案 gate 已实现** | `web/app/worlds/[worldID]/canvas/canvas-proposal.ts` + `recut-worlds` skill | 结构化 `proposal.references[]` + role 自检；视频强制提案 |

**结合方案**

1. **`world.md` 即「世界级 generation-prompt 实例」**：`recut-directing-generation-prompt` 定义通用形状，world.md 做具体化——风格 DNA → STYLE LOCK；角色/风格/示例图 → typed 锚定表（`role="character"/"style-ref"/"color-card"`）；「资源口径」→ 证据使用约束（示例图 `style-ref` 低频校准，不进入默认生成路径）。
2. **`recut.worlds.brief` 已加 `references[]` binding 表（2026-09-15 实施）**：从实体 media 属性（及兼容的 evidence 行）派生可引用项 `{ id, label, kind, role, roleInferred, source, assetId|url, entityId, entityName, purpose, segment }`。`role` 是生成链路建议值（按 label / 实体类型 / evidence purpose 推断，声明式 role 优先），`id` 是绑定身份（assetId 或 url）。这正是生成提示词能「引用具体某张图」的前提——AI 一次 brief 就拿到可锚定清单与建议角色，不必自己翻属性找图。实现见 `service/worlds_platform.go` 的 `briefReferencesFromEntity` / `briefReferenceFromEvidence` / `inferMediaAttrRole`。
3. **World Canvas 是一等公民 App，拥有自己的操作技能 `recut-worlds`**：World、World Canvas、Editor、Remotion Studio 一样是平台第一公民（没有独立安装包，但有界面、工具面与元数据）。因此「怎么操作 World 工具」不是特例文档，而是一个标准 App 式 Skill（`service/skills/recut-worlds/SKILL.md`），回答属性模型（attrs / media 属性 / 类型级 vs 实例级）、属性显示三层（实体卡 / 面板 / 属性卡）、属性关联（边即关联、单一数据源、提升语义），以及「何时调用 `canvas.*` / `entities.*` / `relations.*` / `entityTypes.*` / `promote`」。它与 `world.md`（某个世界的内容）分层：内容归世界，操作归 `recut-worlds`。
4. **画布生成以「结构化提案」实现本协议**：画布不采用正文内联 `<reference>` 作为提交权威，而是把参考写进媒体节点的 `props.proposal.references[]`（`{id, kind, role, label}`），由 `proposalIssues` 做 role↔kind 自检、`proposalReferenceIds` 按出现顺序导出提交顺序；视频强制提案、用户确认后才真正生成（`canvas-proposal.ts`）。这与本 RFC 的区分一致：**正文内联 XML 是「人与 AI 的共享真相」，结构化数组是「生成提交的绑定记录」**；二者可一一对应，但权威各在所属链路。

**边界**：world.md 是被 `brief` 内联的**内容**，不是可软链的 skill 目录；因此生成提示词 global skill 只能在自己的 references 路由里指向「按 `recut.worlds.brief` 读取 world.md」，不能直接 load 它。

## 9. 迁移与兼容

1. **解析器前向兼容**：`parse.ts` 同时接受 `<media assetid>` 与 `<reference kind="image" …>`；序列化统一输出 `<reference>`。
2. **存量 prompt**：无 token 的旧 `prompt` 视作普通文本；旧 `referenceIds` 按顺序补 role 缺失（默认 `style-ref`，仅作回填，不阻断旧数据）。
3. **旧提交串**：`{{Mixed N}}` 若出现在存量文本里，resolver 不做解析（它不是 XML），仅作为普通文本透传，避免误伤。
4. **回滚**：resolver 与 role 校验可用 feature flag 关闭；关闭后行为等价现状（prompt + referenceIds 直传）。
5. **provider 兼容**：别名模板按 provider 配置；无模板时用默认中文别名。

## 10. 里程碑

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| M0 | 本 RFC + resolver 纯函数 + 单测 | token→编号→别名→referenceIds 顺序稳定；未绑定/role 冲突 fail closed |
| M1 | `<reference>` 纳入 `ContextSource` 序列化出口；`media` descriptor 增 `role`；parse 兼容旧标签 | 往返幂等；旧 per-type 标签可读 |
| M2 | `media-editor` / `cover-studio` / `ai-short-film` prompt 字段接 `RichComposer` + @ 面板 + role chip | prompt 正文可 @ 图片、显示缩略图，提交顺序与 token 一致 |
| M3 | sidecar `referenceBindings` 落素材元数据；配方继承/复制走 sidecar | 重生成与复制配方无损 |
| M4 | 铺到 editor / 其余生成入口 | 各处仅改 mode/allowedRefTypes/template，内核零改动 |

## 11. 可测试点

- **单测（resolver）**：编号顺序与去重、image/audio 分组、别名模板切换、role↔kind 校验、未绑定 fail closed、sidecar 顺序。
- **单测（parse）**：`<reference>` ↔ 内部类型往返幂等；旧 `<media assetid>` / `<creation_entity>` 仍可解析；未知标签原样保留。
- **组件测试**：@ 面板选图 → 插入 chip → 改 role → 正文与 `referenceIds` 同步。
- **端到端**：给定含 8 张参考图的案例（含 POV/色卡/环境/人物 + 3 条音色），断言提交串为 `参考图1..N` + `音频1..N`，`referenceIds` 与声明一一对应，sidecar 完整。

## 12. 未决问题

1. **numbering 是否跨 kind 连续**：当前按组独立（图 1..N、音 1..N）。若某 provider 用统一编号，需要 `globalNumbering` 开关。
2. **role 是否可组合**（一张图同时作环境 + 色卡）：倾向一图一 role，组合靠 label；避免 provider 语义冲突。
3. **同 id 多次引用时模型侧是否重复声明**：倾向只在首次出现处声明一次，后续以「同参考图{n}」提及，省 token。
4. **非 media 引用是否进入生成提交串**：倾向否（entity/world 由 Agent 转写为文字后只提交文字），避免模型解析语义对象。
5. **别名本地化**：模型侧别名是中文 `参考图` 还是英文 `Reference image`，需按 provider 训练分布实测后定。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
