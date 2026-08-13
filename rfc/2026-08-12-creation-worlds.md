<!--
 * [INPUT]: 依赖 Recut Extension Host 的 Project/App/Asset/Artifact/MCP 边界，以及现有 Studio、Projects、Assets、Apps 工作台结构
 * [OUTPUT]: 定义 Creation Worlds 顶级 Tab、Studio 入口区块、版本化 Canon、项目上下文绑定、公开 API/MCP 契约与 Remotion MVP
 * [POS]: rfc 的产品与平台设计真相；实现前的跨模块契约，获批后指导 service、web 与 Creation Worlds App 的迭代
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: Creation Worlds —— Recut 的持续创作上下文层

- 状态：提议
- 作者：Recut
- 日期：2026-08-12
- 决策范围：产品信息架构、平台上下文模型、跨 App 接口、Creation Worlds MVP

## 摘要

Creation World 是一个持续存在的创作对象：它可以是角色 IP、内容账号、品牌内容体系或虚构故事宇宙。**Worlds 是用户创建和管理多个 World 的全局列表；每一个 World 有自己独立的一组实体。**它保存“作品应该属于什么世界”的可信定义；Remotion、声音、图片、AI Video、封面等生产型 App 继续负责“把作品做出来”。

本 RFC 将 **Worlds** 定义为 Recut 顶级 Tab，同时在 **Studio** 首页提供一块独立的 Worlds 区域，作为创作的快捷起点。它不是 Project 的替代品，也不是普通素材文件夹，而是一个可被 Chat、项目、Agent 和生产 App 显式引用、可解析、可追溯的 Creative Context Layer。

产品主张：**让 AI 记住你正在创造什么。**

## 问题

现有 Recut 已解决“在同一工作台使用多种创作能力”的问题，但每个新动作仍缺少持久上下文。用户为同一个系列生成角色图、配音、视频和封面时，反复传递角色设定、参考素材、风格和禁止项；不同 App 也无法知道这些信息的语义关系。

素材库回答“我有什么文件”，Project 回答“这个 App 正在制作什么”，但两者都不能回答：

- 这个角色是谁、哪些特征不可改变？
- 这个故事发生在哪个世界、遵循什么规则？
- 这段声音或图片在创作上代表什么？
- 这次生成应继承哪一版风格与 Canon？

没有这层语义真相，跨 App 创作只能靠复制 Prompt，结果无法稳定、无法追溯，也无法形成真正的 Agent 工作流。

## 目标与非目标

### 目标

1. 提供一个可长期维护、可创建多个 World 的列表，覆盖 IP、个人创作者、品牌和虚构世界。
2. 让 Chat、任何生产型 App、Project 或 Agent 都能显式浏览、引用、绑定并解析 World Context。
3. 保证生成和导出可记录所用 World 的版本，允许事后还原“当时 AI 知道什么”。
4. 复用全局 Asset Library：World 仅保存 `assetId` 和创作语义，不复制二进制文件。
5. 以公开 operation、HTTP API 与 MCP 提供能力；任何消费者都不能读写 Creation Worlds 的私有 SQLite。
6. 首先打通 Creation World → Story → Remotion Project → 作品的闭环。

### 非目标

- 不做任务、排期、Issue、团队项目管理。
- 不在 MVP 做复杂地图、时间线编辑器、阵营关系图、集数管理或发布排程。
- 不要求一次性创作必须先创建 World；无 World 的 Project 和生成流程继续可用。
- 不让 World 直接拥有或渲染作品；Artifact 和生产 Project 的 owner 规则保持不变。
- 不在第一阶段让所有 App 共享一张可任意查询的业务表。

## 核心决策

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 产品入口 | Worlds 是顶级 Tab；Studio 同时展示独立 Worlds section | World 是高频长期入口，也要在默认创作页获得低摩擦入口。 |
| 运行时身份 | `recut.creation-worlds` 从 `standalone` App 起步，定位为系统内置 App | 复用现有 appstate、iframe、operation 与 MCP 架构，避免先重构 App Host。 |
| 数据归属 | World 的业务表归 Creation Worlds App；全局素材仍归媒体平台 | 保持单一事实源，避免平台耦合业务 schema。 |
| 全局引用 | Chat、App UI、App 后端和外部 Agent 都以 `worldId` 选择并引用 World；没有隐式当前 World | 多个 World 并存时，显式引用消除歧义与状态泄漏。 |
| 跨 App 协作 | 平台提供 Context Binding 和受控 resolve；消费者不读 World SQLite | 世界模型可独立演进，其他 App 只依赖稳定契约。 |
| 一致性 | 每次 Canon 改动产生不可变 revision；Project/Artifact 记录 revision | 结果可追溯，可复现，不被后续修改静默污染。 |
| 内容结构 | `entity.kind + content_json + relation`，而不是为每一类对象立即建硬表 | MVP 支持多种 World 类型，同时保留明确的类型和约束。 |

## 产品信息架构

顶级工作台由四个 Tab 扩展为五个：

```text
Studio | Worlds | Projects | Assets | Apps
```

### Worlds Tab

`/worlds` 是系统级 **World list** 桌面，不属于 Apps Catalog，也不显示为用户安装的第三方 App。列表是入口，World 是独立的持久实体；用户可以创建任意多个 World，并由 `worldId` 唯一引用。

- 顶部：搜索、按类型筛选、新建 World。
- 主区：World 卡片，显示名称、定位、最近 Story、角色数、引用数、最近创作时间；每张卡片进入 `/worlds/{worldId}`。
- World 详情：Overview、Characters、Stories、References、Canon 五个核心区域；所有 Entity 都有且只属于该 `worldId`。
- 主要行动：`New story`、`Create video`、`Generate voice`、`Generate image`。

World 的首页不做传统后台表格；它回答“这个世界现在是什么状态，下一步能创造什么”。

### Studio 的 Worlds section

Studio 继续是一次性或探索性创作的默认入口。在 Hero 与最近 Projects 之间增加 **Continue a world** section：

- 展示最近 3–6 个 World，含封面、名称、简述和最近 Story。
- `Create new world` 作为最后一张卡。
- 点击卡片打开 World；点击 `Create` 打开轻量 action menu，先选 Story，再选生产 App。
- Studio 不维护“全局 Active World”。用户每一次 action 明确选择 World/Story，或继续无 World 创作。

这保持两条路径共存：快速创作不被阻塞，长期创作获得默认入口。

## 领域模型

```text
Worlds (list)
└── CreationWorld (worldId)
├── Identity       世界的定位、受众、主题与关键词
├── Entity[]
│   ├── Character  角色身份、性格、外观、声音与表达方式
│   ├── Location   地点/环境
│   ├── Story      可生产的叙事意图
│   ├── Style      视觉、文字、声音、运动、色彩、版式
│   ├── Rule       Always / Never / Prefer 等约束
│   └── Reference  对 Asset 或 URL 参考的语义归类
├── Relation[]     角色关系、Story 参与者、Story 发生地等
├── Revision[]     每一版不可变 Canon
└── Binding[]      Project、生成请求或 Artifact 使用的 World revision
```

World 类型仅影响创建模板与默认字段，不改变底层模型：

- `character_ip`：角色、声音、视觉一致性优先。
- `creator_brand`：受众、栏目、编辑规范、表达风格优先。
- `brand`：品牌定位、视觉系统、平台规则优先。
- `fiction_world`：世界观、地点、Lore、角色、故事优先。
- `custom`：从通用 Identity、Style、Rules 开始。

### 最小持久化模型

Creation Worlds App 的 appstate SQLite 保存：

```sql
creation_worlds(
  id, name, type, description, cover_asset_id,
  current_revision_id, created_at, updated_at
)

world_entities(
  id, world_id, kind, title, summary, content_json,
  created_at, updated_at, archived_at
)

world_relations(
  id, world_id, from_entity_id, to_entity_id, relation_type, metadata_json
)

world_asset_refs(
  id, world_id, entity_id, asset_id, role, label, sort_order
)

world_revisions(
  id, world_id, canonical_json, canonical_hash, created_at, created_by
)
```

`content_json` 允许不同实体携带不同属性；`kind`、JSON schema 校验和 resolve 输出共同形成稳定契约。不要为 Character、Story、Style 过早复制出不同行、字段重复的表。

`world_entities.world_id` 是强制外键边界：Entity 不属于全局列表，也不允许跨 World 直接复用。若两个 World 需要相同设定，应显式复制为新的 Entity 或引用同一个全局 Asset；不能让隐含共享破坏 Canon 的独立性。

### Asset 的语义引用

全局 Asset 是二进制事实源，World 只记录解释：

```text
assetId: ast_123
role: character_reference
entityId: char_peppa
label: "正面角色设定图"
```

首版角色包括：`character_reference`、`voice_reference`、`location_reference`、`style_reference`、`story_reference`、`brand_reference`。一个 Asset 可以被多个 World 或 Entity 引用，不复制文件。

## Canon、Revision 与 Binding

### Canon

Canon 是从 Identity、Entities、Relations、Rules 与 References 计算出的规范化、可消费的快照。它不是一段拼接 Prompt，而是结构化事实和约束的唯一版本。

```text
User request + World revision + selected Story/entities + selected Assets
  → CreationContext
  → production App / Agent / generation request
```

每次会影响生成含义的写入都创建新 revision：新增/修改角色、Style、Rule、Story 关联或 Reference。纯 UI 排序等非语义修改不创建 revision。revision 永不修改，当前 revision 只是指针。

### Context Binding

平台 `workspace.sqlite` 新增与业务 schema 无关的绑定表：

```sql
creation_context_bindings(
  id, target_type, target_id,
  world_id, revision_id, selection_json,
  role, created_at
)
```

- `target_type`：首版为 `project`、`artifact`、`media_job`；未来可扩展 `agent_turn`。
- `selection_json`：包含 `storyId`、显式 `entityIds`、`assetRoles`、`purpose` 等选择范围。
- `role`：首版仅 `primary`；未来允许多个 World 以 `primary` / `reference` 共存。

绑定只保存 ID 和选择范围；Canonical 内容仍由 World owner App 解析。Artifact 在导出后记录 binding 的 revision，因此日后改世界不会改历史作品。

## 公开契约

### Creation Worlds App operations

Creation Worlds 自己拥有写模型，并以声明式 `operations` 公开：

| Operation | Surface | 用途 |
| --- | --- | --- |
| `world.list` | API, MCP | 获取全局 Worlds list 的摘要；支持 text/type/cursor/limit，不内联所有 Entity。 |
| `world.get` | API, MCP | 按必填 `worldId` 获取一个 World 的 identity、统计、当前 revision 摘要和可用 Entity kinds。 |
| `entity.list` | API, MCP | 按必填 `worldId` 获取该 World 的实体列表；可选 `kind`、text、cursor/limit。 |
| `entity.get` | API, MCP | 按 `worldId + entityId` 获取一个实体的完整内容、关系与语义 Asset references。 |
| `world.create` | API, MCP | 创建 World 与模板初始实体。 |
| `world.update` | API, MCP | 修改 World identity/metadata，并按需产出 revision。 |
| `entity.upsert` | API, MCP | 新增或修改 Character、Story、Style、Rule 等。 |
| `reference.attach` | API, MCP | 以语义 role 引用一个已完成 Asset。 |
| `canon.resolve` | API, MCP | 按 World、revision 与 selection 生成 `CreationContext`。 |

Creation Worlds App 的 operation 是 owner 实现细节；它不构成跨 App 的长期公共名称。平台提供全局 facade：HTTP/SDK 与 MCP 都使用 `recut.worlds.*`，由平台校验调用者、转发只读请求到 World owner，并处理平台 binding。这样以后 `recut.creation-worlds` 从 standalone App 升级为真正 system App 时，消费者不必迁移。

读取接口是首版必须优先稳定的公共 surface。`world.get` 是 World 元信息，不暗含无限量 Entity；消费者按需要调用 `entity.list` 与 `entity.get`，避免把大型世界观完整塞入每次 Chat 或 App 请求。

### Chat 与 App 的引用规则

```text
Chat / App UI / App Agent
  → world.list({ text? })          # 发现候选 World
  → world.get({ worldId })         # 确认世界身份
  → entity.list({ worldId, kind }) # 浏览该世界的角色、故事等
  → entity.get({ worldId, entityId }) 或 canon.resolve(...)
  → prompt attachment / Project binding / generation request
```

- **Chat**：输入框支持引用 World 与 Entity（例如 `@Future City`、`@Mina`）。UI 只保存结构化 attachment `{ type: "creation_world", worldId }` 或 `{ type: "creation_entity", worldId, entityId }`；发送时由 Agent 读取 MCP 获取实时内容。聊天文本不复制 Canon，也不依赖某个“当前 World”。
- **App UI**：任何 App 可调用上述 API 构建 World picker / Entity picker。选择后把 `worldId`、可选 `revisionId` 和 `selection` 传给自己公开 operation；App UI 不获得 SQLite 或不受控的 World 文件权限。
- **App 后端**：拥有 `creation.context.read` permission 的 App 可使用 `ctx.creationContext.resolve()`；已绑定 Project 可使用 `ctx.creationContext.get()`。App 只接收已解析的 Context，不自行猜测或读取 World 数据库。
- **MCP**：工具列表中始终提供只读 `recut.worlds.list`、`recut.worlds.get`、`recut.worlds.entities.list`、`recut.worlds.entities.get` 与 `recut.worlds.resolve`。写工具按 App 权限和用户动作提供；只读发现能力不能依赖用户是否正打开 Worlds Tab。

这套规则让“在其他地方引用 World”成为稳定 ID 引用，而不是 UI 单例状态或复制粘贴 Prompt。

## 全局 Recut Worlds API

Worlds 是系统级语义服务，使用平台命名空间 `recut.worlds`。公共 SDK 和 MCP 的 resource、输入与输出一一对应；SDK 返回对象，MCP 返回同一对象的 structured content。所有 ID 是不透明字符串，调用者不得从 ID 推断类型、时间或所有权。

### API 总览

| 目的 | SDK | MCP | 是否修改数据 |
| --- | --- | --- | --- |
| 发现 Worlds | `recut.worlds.list(input?)` | `recut.worlds.list` | 否 |
| 读取 World | `recut.worlds.get({ worldId })` | `recut.worlds.get` | 否 |
| 列出某 World 的实体 | `recut.worlds.entities.list(input)` | `recut.worlds.entities.list` | 否 |
| 读取一个实体 | `recut.worlds.entities.get(input)` | `recut.worlds.entities.get` | 否 |
| 解析可生产 Context | `recut.worlds.resolve(input)` | `recut.worlds.resolve` | 否 |
| 创建 World | `recut.worlds.create(input)` | `recut.worlds.create` | 是 |
| 修改 World / Entity | `recut.worlds.update(input)` / `recut.worlds.entities.upsert(input)` | `recut.worlds.update` / `recut.worlds.entities.upsert` | 是 |
| 附加 Asset reference | `recut.worlds.references.attach(input)` | `recut.worlds.references.attach` | 是 |
| 将 World 绑定至当前 Project | `ctx.creationContext.bindProject(input)` | `recut.worlds.bind_project` | 是 |

其中 `recut.worlds.*` 是 **全局 Recut SDK 和全局 MCP Host** 的稳定接口；`ctx.creationContext.*` 是 App `background.js` 在 manifest permission 授权后可用的受限 capability。前端 iframe 不直接拿 SDK；它通过宿主 API 调用本 App operation，由 App/平台再调用受控 Worlds API。

### SDK 类型契约

```ts
type WorldKind = "character_ip" | "creator_brand" | "brand" | "fiction_world" | "custom";
type EntityKind = "character" | "location" | "story" | "style" | "rule" | "reference";
type PageInput = { text?: string; cursor?: string; limit?: number };
type Page<T> = { items: T[]; nextCursor?: string };

type WorldSummary = {
  id: string;
  name: string;
  type: WorldKind;
  description: string;
  coverAssetId?: string;
  currentRevisionId: string;
  entityCounts: Partial<Record<EntityKind, number>>;
  updatedAt: string;
};

type WorldDetail = WorldSummary & {
  identity: Record<string, unknown>;
  revision: { id: string; canonicalHash: string; createdAt: string };
  availableEntityKinds: EntityKind[];
};

type WorldEntitySummary = {
  id: string;
  worldId: string;
  kind: EntityKind;
  title: string;
  summary: string;
  updatedAt: string;
};

type WorldEntity = WorldEntitySummary & {
  content: Record<string, unknown>;
  relations: Array<{ id: string; type: string; fromEntityId: string; toEntityId: string }>;
  references: Array<{ assetId: string; role: string; label?: string }>;
};

type WorldSelection = {
  storyId?: string;
  entityIds?: string[];
  assetRoles?: string[];
  purpose: "chat" | "video" | "voice" | "image" | "cover" | "agent";
};

interface RecutWorldsAPI {
  list(input?: PageInput & { type?: WorldKind }): Promise<Page<WorldSummary>>;
  get(input: { worldId: string }): Promise<WorldDetail>;
  entities: {
    list(input: { worldId: string; kind?: EntityKind } & PageInput): Promise<Page<WorldEntitySummary>>;
    get(input: { worldId: string; entityId: string }): Promise<WorldEntity>;
    upsert(input: { worldId: string; entityId?: string; kind: EntityKind; title: string; summary?: string; content: Record<string, unknown>; expectedRevisionId?: string }): Promise<WorldEntity>;
  };
  resolve(input: { worldId: string; revisionId?: string; selection: WorldSelection }): Promise<CreationContext>;
  create(input: { name: string; type: WorldKind; description?: string; identity?: Record<string, unknown> }): Promise<WorldDetail>;
  update(input: { worldId: string; name?: string; description?: string; identity?: Record<string, unknown>; expectedRevisionId?: string }): Promise<WorldDetail>;
  references: {
    attach(input: { worldId: string; entityId?: string; assetId: string; role: string; label?: string; expectedRevisionId?: string }): Promise<{ id: string; worldId: string; entityId?: string; assetId: string; role: string; revisionId: string }>;
  };
}

declare const recut: { worlds: RecutWorldsAPI };
```

`expectedRevisionId` 是写入的乐观并发门：缺省允许基于当前版本修改；提供后若已过期，平台返回 `WORLD_REVISION_CONFLICT` 和最新 revision 摘要，绝不静默覆盖。MVP 先允许 Entity 的 `content` 为结构化 JSON，但每种 `EntityKind` 必须有 versioned JSON schema。SDK 的 list 结果永远分页，默认最多 50 项。

### MCP tool 契约

所有只读 MCP tool 始终注册在全局 `recut` MCP Host，输入 schema 与 SDK input 同名。写工具也使用同一 schema，但只有用户明确要求创建或修改 World 时才调用。

```text
recut.worlds.list
  input: { text?, type?, cursor?, limit? }
  output: { items: WorldSummary[], nextCursor? }

recut.worlds.get
  input: { worldId }
  output: WorldDetail

recut.worlds.entities.list
  input: { worldId, kind?, text?, cursor?, limit? }
  output: { items: WorldEntitySummary[], nextCursor? }

recut.worlds.entities.get
  input: { worldId, entityId }
  output: WorldEntity

recut.worlds.resolve
  input: { worldId, revisionId?, selection: WorldSelection }
  output: CreationContext

recut.worlds.create
  input: { name, type, description?, identity? }
  output: WorldDetail

recut.worlds.update
  input: { worldId, name?, description?, identity?, expectedRevisionId? }
  output: WorldDetail

recut.worlds.entities.upsert
  input: { worldId, entityId?, kind, title, summary?, content, expectedRevisionId? }
  output: WorldEntity

recut.worlds.references.attach
  input: { worldId, entityId?, assetId, role, label?, expectedRevisionId? }
  output: { id, worldId, entityId?, assetId, role, revisionId }

recut.worlds.bind_project
  input: { projectId, worldId, revisionId?, selection: WorldSelection }
  output: { id, targetType: "project", targetId: projectId, worldId, revisionId, selection, role: "primary" }
```

`bind_project` 由平台执行，而非 World owner App；它校验 `projectId` 的 owner App、World 是否存在、selection 中的 Entity 是否都属于该 World，然后固化 revision。Project 已有 primary binding 时默认替换必须提供 `replace: true`，否则返回 `PROJECT_WORLD_ALREADY_BOUND`。

### 错误与权限

所有 SDK 调用和 MCP tool 使用相同的结构化错误：

```ts
type RecutWorldsError = {
  code:
    | "WORLD_NOT_FOUND"
    | "ENTITY_NOT_FOUND"
    | "ENTITY_WORLD_MISMATCH"
    | "WORLD_REVISION_NOT_FOUND"
    | "WORLD_REVISION_CONFLICT"
    | "WORLD_CONTEXT_INVALID"
    | "ASSET_NOT_FOUND"
    | "ASSET_NOT_READY"
    | "PROJECT_WORLD_ALREADY_BOUND"
    | "WORLD_ACCESS_DENIED";
  message: string;
  details?: Record<string, unknown>;
};
```

- `recut.worlds.list/get/entities.list/entities.get/resolve`：在本地单用户 MVP 中默认可读，未来按 World ACL 收敛。
- `create/update/entities.upsert/references.attach`：必须是用户明确发起的 UI/MCP 写操作；Chat Agent 不得因“推测有帮助”自动改 Canon。
- `bind_project`：只能由用户动作、当前 Project owner App 或获得用户确认的 Agent 调用；绑定是跨系统可观察的状态变化。
- 每个响应都包含 `worldId`，Context 与 binding 必须包含 `revisionId` 和 `canonicalHash`，以便日志、Artifact 与 Agent 结果可追溯。

### `canon.resolve` 的稳定输出

```json
{
  "world": {
    "id": "cw_future_city",
    "name": "Future City 2049",
    "revisionId": "cwr_42",
    "canonicalHash": "sha256:..."
  },
  "selection": { "storyId": "story_mina_arrives", "purpose": "video" },
  "identity": { "positioning": "...", "audience": ["..."] },
  "entities": {
    "characters": [{ "id": "mina", "name": "Mina", "appearance": "...", "voice": "..." }],
    "locations": [{ "id": "downtown", "description": "..." }],
    "story": { "id": "story_mina_arrives", "synopsis": "..." },
    "styles": [{ "kind": "visual", "guidance": "..." }]
  },
  "constraints": {
    "always": ["保持霓虹未来都市风格"],
    "never": ["不要修改 Mina 的年龄和外貌"]
  },
  "references": [{ "assetId": "ast_123", "role": "character_reference", "entityId": "mina" }]
}
```

消费者不得依赖 `canonical_json` 的内部存储格式；只依赖该 resolve 输出及其 version。第一版只输出适合人和 Agent 阅读的结构化上下文，不承诺模型厂商 Prompt 格式。

### 平台 capability

Creation World 的写模型属于 World App；Project、Artifact、媒体 Job 与 World 的关联属于平台。平台新增下列受控能力：

```ts
ctx.creationContext.get()
ctx.creationContext.resolve({ worldId, revisionId?, selection })
ctx.creationContext.bindProject({ worldId, revisionId?, selection })
ctx.creationContext.bindMediaJob({ worldId, revisionId?, selection })
```

`get()` 只读取当前 Project 的 primary binding；没有 binding 时返回 `null`，这不是错误。`bindProject()` 只能绑定当前 owner Project；平台固定 revision、写入 `creation_context_bindings` 后返回 binding。`resolve()` 用于预览或用户显式选择 World，调用公开的 `canon.resolve` operation。消费者没有 World SQLite、文件根或任意 Project 的读取权限。

媒体生成入口接受可选 `creationContextBindingId`；平台验证该 binding 与 target 匹配并在任务创建时固化 revision。`ctx.artifacts.publish()` 增加可选 `creationContextBindingId`，平台把已验证的 revision 记录到 Artifact。由此生成 Job、相关 Asset metadata 与最终 Artifact 都可追溯来源。

## Remotion MVP

MVP 只验证一条闭环：

```text
Create World
  → Character + reference image / voice + Style / Rules
  → Story
  → Create video in Remotion
  → Project binding at a fixed World revision
  → workflow.context exposes CreationContext
  → Agent edits composition using assetId + Canon
  → Export artifact retains World revision
```

### 发起流程

1. 用户在 Story 或 World Overview 选择 `Create video`。
2. 用户选择已安装的项目型 App；MVP 首先支持 Remotion Studio。
3. 平台创建 Remotion Project，并创建 `primary` binding：固定当前 `revisionId`、目标 `storyId` 和必要角色。
4. Remotion `workflow.context` 返回 `creationContext` 与 binding metadata。
5. Agent 读取 Context 后构建 `SCENE_PLAN.md` 与 composition；真实媒体仍通过 `assetId` 使用，并在 `composition.assets` 登记。
6. 导出时 Remotion 发布自己的视频 Artifact；平台同时记录 binding revision。

### 对 Remotion 的改动边界

- Brief 增加可选 `creationContextBindingId` 与 Context 摘要，不把完整 World JSON 副本写入 Brief。
- `workflow.context` 增加 `creationContext: CreationContext | null`。
- 默认 Agent prompt 在有 Context 时要求遵守 Rules、优先使用 Reference Asset，并声明未知内容不可擅自杜撰为 Canon。
- UI 只显示 World chip、Story chip、`Open world` 与 `Change context`；不在 Remotion 内重做 World 编辑器。
- 无 binding 的现有 Remotion Project 完全不受影响。

## Agent 行为

Agent 的输入顺序是：用户当前请求 > 绑定的 Story/selection > World Canon > App 自己的工作流规则。World 是长期上下文，不是越权指令。

Agent 必须：

- 在开始生产前读取 `workflow.context` 或 `ctx.creationContext.get()`。
- 明确引用 revision 与 Story，不能凭聊天记忆假定当前世界。
- 将 Canon 外的新增设定标记为“提议”，经用户确认后才写回 World。
- 将生成出的 Asset 作为候选 Reference，由用户或明确 Agent action 语义化附加；不得自动把所有生成结果变为 Canon。

## UX 与命名

对用户使用简洁名称 **Worlds**；详情页可用完整解释 “Creation World”。

```text
My Worlds
  Future City 2049
  Marc AI Video
  Little Red Fox
```

世界内 CTA 使用动词：`New story`、`Create video`、`Generate voice`、`Add reference`。不要在每个按钮上重复 “Creation World”。

首次创建使用模板，但所有模板保持同一底层模型：

```text
一个角色 IP | 一个内容账号 | 一个品牌 | 一个故事世界 | 自定义
```

## 权利、安全与治理

- World 的 Reference 必须展示来源、Asset origin 和可选权利/授权备注。
- 官方 Demo 使用原创角色和原创声音；不得用小猪佩奇等受版权保护角色作为可直接复用的官方生成样例。
- Voice Reference 明示权限确认；未来发布前可增加平台级 policy 检查，但 MVP 不阻断用户本地合法素材。
- Rule 不等同平台安全策略；平台安全政策优先于 World Canon。

## 分阶段交付

### Phase 0 — RFC 获批

- 确认本 RFC 的 ownership、binding、revision 和 `resolve` 输出。
- 确认 Worlds 是顶级 Tab，Studio 只做快捷 section，不引入全局 Active World。

### Phase 1 — Worlds Foundation

- 新增内置 `recut.creation-worlds` standalone App。
- 实现 World、Entity、Reference 与 revision。
- 新增 `/worlds` Tab 和 Studio Worlds section。
- 实现 `world.list/get/create`、`entity.upsert`、`reference.attach`、`canon.resolve`。

### Phase 2 — Context Binding

- 在 workspace SQLite 增加通用 binding 表及 platform read capability。
- 支持从 Story 创建 Remotion Project 并绑定固定 revision。
- `workflow.context` 返回 Context；Remotion UI 展示 Context chip。

### Phase 3 — Artifact 与媒体生成追溯

- Artifact/媒体 Job 写入 binding metadata。
- Worlds Overview 显示由该 World 创造的作品（只读聚合）。
- 接入 Audio Studio、Cover Studio、AI Video 等生产型 App。

### Phase 4 — 仅在证据充分后

- Story 批量生产、Publishing Profile、Timeline、关系图、多 World 混合与协作权限。

## 成功指标

- 从 World 到首个可预览 Remotion 项目的中位路径不超过 5 个用户决定。
- 被绑定 World 的生产任务中，`canon.resolve` 成功率达到 99% 以上。
- 用户在同一 World 内再次创作时，参考资料和规则的重复手工输入显著下降。
- 导出的 Artifact 100% 能报告 World、revision 和选中的 Story（若其来自 World）。
- 无 World 的现有项目创建、预览、导出路径零回归。

## 开放问题

1. `recut.creation-worlds` 是硬编码系统 App，还是由 manifest 扩展出 `type: system`？本 RFC 选择先以 standalone 内置 App 交付，Phase 2 再评估。
2. Canon revision 采用“每次语义写入立即创建”还是“显式发布 Canon”？MVP 选择立即创建，UI 提供 revision history；当协作出现再引入草稿/发布态。
3. 一个 Project 是否允许多个 World？数据模型允许，MVP UI 仅允许一个 `primary`，避免上下文冲突。
4. Agent 是否可通过对话直接创建/修改 World？可以，但所有写操作都必须使用公开 MCP operation，并让用户看到明确的写入结果。

## 验收标准

- Worlds 在顶级导航与 Studio section 同时出现，并且两处都可进入同一 World。
- `recut.worlds.list/get/entities.list/entities.get/resolve` 在 Chat、任何已安装 App 的 Agent 与外部 MCP 客户端中始终可发现和调用。
- 全局 SDK 与 MCP 对同一请求返回同构对象；World 或 Entity 的读取永远要求显式 `worldId`，不依赖 UI 当前页或 Active World。
- 用户能建立一个含 Character、Reference、Style、Rule、Story 的 World。
- 任一 Reference 指向全局 `assetId`，不复制二进制内容。
- 从 Story 可创建绑定 World revision 的 Remotion Project。
- Remotion `workflow.context` 能返回固定的 CreationContext；未绑定项目返回 `null`。
- 导出的 Artifact 能查询到其使用的 World revision 与 Story selection。
- 所有跨 App 读取均经 operation/capability；没有 App 直接读取 Creation Worlds SQLite。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
