<!--
 * [INPUT]: 依赖 Creation Worlds 三份既有 RFC（2026-08-12 产品 / 2026-08-12 技术设计 / 2026-08-14 产品重构）的 WorldStore、revision、binding、Evidence 实现，以及 service 的 builtin_apps 种子、appstore 目录覆盖、CDN 分发与 layout version 门禁
 * [OUTPUT]: 定义平台 World 内容层：单一 World Catalog（kind=platform 自动同步 / kind=published 手动安装，均发布至平台 CDN）、World 源格式（world.md 核心技能 + 内聚资源目录）与发布格式（单文件 manifest）、origin 三元来源模型（local/platform/published）与只读+Fork 写策略、Evidence 的 assetId|url 双源、world.md 一等公民与 recut.worlds.brief v1 读取入口、发布管线与小黑（xiaohei）首个实例；冻结 UGC 发布/手动安装的架构扩展位
 * [POS]: rfc 的 Worlds 平台内容层决策；在 08-14 产品重构之上补充"内容从哪来、如何交付、核心技能如何表达"三个维度，获批后指导 service、web、官方仓库与发布脚本
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: PGC Platform Worlds——平台 World 内容层（内置自动同步 + Catalog 统一管理）

- 状态：提议
- 作者：Recut
- 日期：2026-08-28
- 关联：[Creation Worlds 初版 RFC](./2026-08-12-creation-worlds.md)、[技术设计](./2026-08-12-creation-worlds-technical-design.md)、[产品重构](./2026-08-14-creation-worlds-product-reframe.md)
- 决策范围：World 的来源与交付（平台内置 / 平台 Catalog 统一管理 / UGC 扩展位）、World 核心技能模型（world.md）、World Manifest 与目录契约、Evidence 资源源扩展、brief v1 读取入口、写策略（只读 + Fork）、发布管线
- 首个实例：`helloianneo/ian-xiaohei-illustrations`（小黑怪诞正文配图 Skill 仓库）转化为内置 World `pgc.xiaohei`

## 摘要

当前 Worlds 只有用户自建这一种来源，且 World 模型只表达"这个世界里有什么"（实体、约束、本地资产证据），不表达"在这个世界怎么生产"。这使平台无法提供"开箱即用"的垂直创作能力——例如小黑配图体系：角色 IP、风格 DNA、完整生产工作流、提示词模板、质检清单、示例图，用户 @ 一下就能产出一组风格一致的系列图。

本 RFC 引入 **平台 World 内容层**，核心立场：

1. **一个 World Catalog，统一管理所有平台分发的 World。** 目录条目分两类：`kind=platform`（平台内置，daemon 自动同步，用户零安装零更新）与 `kind=published`（用户/第三方发布，用户手动安装与更新）。两者都发布到平台 CDN，共用同一套目录、校验与物化机制——**"自动同步"与"安装/更新"是同一组原语（materialize / archive）的两种策略**。v1 实现 platform 自动策略；published 的契约（catalog kind、origin 值、install/update/uninstall 操作、uninstall=归档语义）本次冻结，实现列入 P4（World Store）。
2. **每个 World 本质是一个垂直 Skill，其核心技能是 `world.md`。** World 模型补齐"实践维度"：`world.md` 是世界的一等公民字段（独立 UI tab、内联进 brief、进入 revision），承载该世界的生产工作流、资源使用说明与交付口径；结构化事实仍是实体（可携带 `body` 长文 markdown）；资源是 Evidence（assetId 或 URL 双源）。v1 不引入 `guide` 实体类型——一个世界一个技能，多套工作流应拆成多个世界。
3. **源格式内聚、发布格式自包含。** 官方仓库中一个世界是一个目录：`world.json` + `world.md` + `references/` + `examples/`（参考文档与资源就地存放，git 可审阅）；发布构建把相对引用解析、资源镜像到 CDN，产出**单文件自包含 manifest** 上传。daemon 只拉这一个文件（SHA-256 校验），物化进本地 WorldStore。
4. **PGC World 在本地就是真实的 World 行。** 进同一张 `worlds` 表、同一套 revision/binding，读取、brief、@引用、MCP 全部走既有单一路径。差异只在三个维度：来源（origin）、写策略（只读 + Fork）、更新策略（目录驱动）。

产品主张：**平台的世界、发布的世界和我的世界，用起来是同一个 World；差异只是"从哪来、能不能改、怎么更新"。**

## 问题

1. **没有平台内容来源。** World 列表只可能来自用户手工创建；平台的 IP 风格、方法论类内容无法以一等公民出现在 Worlds 列表、Chat @ 引用与创作入口。
2. **Evidence 只能是本地 Asset。** `AttachReference` 强制 `assetId` 存在且 `completed`。以 URL 资源为真相的官方世界（示例图、风格参考）无处安放；预导入每个用户素材库既浪费又破坏"素材库是用户事实源"的语义。
3. **模型缺"实践维度"。** 现有实体 kinds 表达事实与约束，但垂直创作能力的价值主体是**怎么做**：工作流、提示词模板、质检清单、资源使用口径。xiaohei 仓库中 `SKILL.md` 工作流 + `prompt-template.md` + `qa-checklist.md` 是价值主体，现有模型没有承载位置。
4. **读取入口仍是低层 resolve。** 08-14 重构已决定 `worlds.brief` 为单一默认读取入口，尚未实施。"@"一下 → 一次拿到可生产上下文"依赖 brief 落地。
5. **无来源、更新与下架语义。** 平台内容必然迭代并可能下架；UGC 发布是确定方向。本地 store 没有"内容从哪来、如何可追溯地变更、如何下线、发布的世界如何安装/卸载"的定义——架构必须在 v1 就为这些维度留出位置，而不是事后打补丁。

## 核心决策

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 内容管理 | 单一 World Catalog：`kind=platform` 自动同步、`kind=published` 手动安装；全部发布到平台 CDN，一棵目录树 | 一个管理面覆盖内置与 UGC；"自动 vs 手动"只是物化原语的策略差异，不是两套系统 |
| 交付方式 | daemon 自动同步目录（启动 + 24h），嵌入二进制种子兜底首启/离线；用户零动作 | 无安装/更新过程；本地 store 是运行时唯一事实源，读取路径与用户 World 完全一致 |
| 运行时身份 | World 来源三元：`origin = local \| platform \| published`；平台/发布 World = `worlds` 表中对应 origin 的普通行 | 全部既有能力（list/get/brief/bind/@引用/MCP）零改造；不需要第二套 world 子系统 |
| 核心技能 | `world.md` 是世界一等公民字段（`worlds.skill_md`）：独立 UI tab、内联进 brief、进入 canonical/revision；辅助长文进实体 `body`；**不设 `guide` 实体类型** | "每个 world 是垂直 skill"——SKILL.md 的对应物是世界本身的技能文档，不是若干零散实体；一个世界一个技能，模型更简单 |
| 物化确定性 | 发布 manifest 自带稳定 ID（world 与 entity 的 slug），物化时直接用作本地 ID | 同一 manifest 永远产生同一 canonical 字节 → 同步/安装幂等、无虚假 revision、跨设备一致 |
| 更新语义 | manifest canonical hash 变化 → 恰好一个新不可变 revision；旧 Project binding 固定旧 revision 继续解析 | 复用既有 revision 机制；作品可追溯性不破坏 |
| 写策略 | `origin != local` 一律只读（`WORLD_READ_ONLY`，错误携带 fork 指引）；`recut.worlds.fork` 生成 `origin=local` 可编辑副本 | "不能改"是硬边界而非 UI 隐藏；Fork 是合法出口；binding 始终允许 |
| 资源承载 | Evidence 为 `assetId` **或** `url` 双源；源格式允许相对路径，发布构建镜像到 CDN 并改写为绝对 URL | URL 是世界自带的远程资源真相，不污染用户素材库；用户 World 同样受益 |
| 读取入口 | 实施 `recut.worlds.brief`（v1）：内联 `world.md` 与实体 body；Chat 上下文物料改指向 brief | 兑现 08-14 重构；一次调用获得可生产上下文 |
| 完整性 | Catalog 条目携带 manifest SHA-256；校验失败绝不物化。v1 = TLS + 目录哈希；发布者身份与签名随 P4 | 最低成本的可信链；篡改内容可被确定性拒绝 |
| 源格式 | 官方仓库 `worlds/<slug>/` 目录：`world.json` + `world.md`（固定约定）+ `references/` + 资源目录；相对引用在构建期解析 | 内聚、可审阅、可 diff；长 markdown 不嵌 JSON 字符串 |

## World 内容模型：每个 World 是一个垂直 Skill

```text
World
├── Identity        定位、受众、语气（worlds.identity_json）
├── Skill (world.md) ★ 世界核心技能：生产工作流、资源使用口径、交付标准（worlds.skill_md）
├── Entity[]        结构化事实与约束（character/location/story/style/rule；
│                   每种实体可携带 body 长文 markdown，如角色小传全文、风格指南全文）
├── Relation[]      实体关系
└── Evidence[]      资源证据（assetId | url；modality/purpose/status/collection/segment）
```

为什么 `world.md` 是字段而不是实体：

- **入口性**。SKILL.md 之于 skill 目录是入口契约：它定义"这个垂直能力怎么用、内部资源何时用"。`world.md` 同理——它索引并使用这个世界的所有实体与证据（"示例图仅作低频视觉校准，不进入默认生成路径"）。把它降级为 N 个 `guide` 实体，会丢失"一个世界一套工作流"的整体性。
- **消费方式**。Agent 对世界技能的需求是"一次性全部拿到"，不是"按需检索几条"。`world.md` 内联进 brief，配合实体 facts 与 evidence，一次调用构成完整生产上下文。
- **演进克制**。多套独立工作流（短片工作流 + 海报工作流）应表达为两个世界，而不是一个世界塞两套技能。这保持 World 的垂直性——它也是未来 World Store 里可发现、可安装的最小单元。

实体 `body`：所有实体类型的可选 markdown 字段（08-14 重构"notes 扩展区"的正名，进入 schema registry 注册字段）。它承载**事实性长文**（小黑 IP 完整形象文档、风格 DNA 全文）；**实践性内容**（怎么做）归 `world.md`。两者都进入 canonical（body 是 `content_json` 的注册键，canonical 规则不变）。

## 交付架构：一个 Catalog、一棵 CDN 树、三层

```text
┌─ 发布层（平台运营 + 未来 UGC 提报，人工/CI）──────────────────┐
│  源仓库（官方仓库 worlds/<slug>/ 目录；未来：发布者仓库）        │
│    → 构建脚本：校验 / $file 解析 / 资源镜像 / 确定性序列化        │
│    → 平台 CDN：cdn/worlds/<id>/<version>/world.json + 资源      │
│    → 平台 CDN：cdn/worlds/catalog.json（platform+published 全量）│
└──────────────────────────────────────────────────────────────┘
                     │ HTTPS（daemon / 用户触发的安装，均经校验）
┌─ 同步层（service，幂等单飞）───────────────────────────────────┐
│  目录来源：<dataRoot>/world-catalog.json（本地覆盖）            │
│          > 远端 catalog（启动 + 每 24h；安装/更新时即时拉取）    │
│          > 嵌入种子 service/worldcatalog/（仅 platform，首启兜底）│
│  原语：materialize(entry)  fetch→sha256→校验→事务物化→revision  │
│        archive(worldId, reason)                                │
│  策略 A（v1 实现）：kind=platform → 启动+24h 自动 materialize，  │
│                    delisted → 自动 archive                     │
│  策略 B（契约冻结，P4 实现）：kind=published → 用户触发           │
│                    install / update / uninstall（=archive）     │
└──────────────────────────────────────────────────────────────┘
                     │ 普通 SQLite 读写
┌─ 运行时层（既有 WorldStore，零特判）───────────────────────────┐
│  worlds / world_entities / world_asset_refs / world_revisions   │
│  → HTTP /v1/worlds、MCP recut.worlds.*、brief、binding、        │
│    Chat @ 引用、Worlds Tab、生产 App 全部同路径                  │
│  非 local World 仅多：origin 字段、写门禁、目录驱动的生命周期      │
└──────────────────────────────────────────────────────────────┘
```

### 为什么是"云端同步到本地"，而不是另外三种方式

| 方式 | 用户体验 | 本地一致性 | 离线 | 结论 |
| --- | --- | --- | --- | --- |
| A. 用户自行 Git 安装（App Store 模式） | 需理解安装、手动更新；发现路径长 | 一致 | 好 | 否——内置世界不应有安装过程；World 是内容不是 App。该模式的精神由"手动 install 操作"（P4）继承，但载体是 CDN manifest 而非 git |
| B. 纯服务端 World（resolve 走平台 API） | 无需安装 | 破坏——本地不再是事实源，离线失效，第二套 resolve 实现 | 差 | 否——违背 local-first |
| C. 云端目录 → daemon 同步 → 本地 store（**选定**） | 零动作（platform）/ 一次点击（published） | 完全一致——同一张表、同一套代码 | 好（种子兜底） | 是 |
| D. 仅嵌入二进制 | 零动作 | 一致 | 最好 | 更新绑定版本周期，无法独立迭代内容；作为 C 的种子层保留 |

"下载"对用户不可见（platform）或是一次明确的点击（published）：失败时降级到本地已有内容；已安装的 published 世界离线继续可用。

## World Catalog 与 Manifest

### Catalog v1（单一管理面）

`cdn/worlds/catalog.json`（与 fonts/effects/releases 同桶同上传链）：

```json
{
  "catalogVersion": 1,
  "updated": "2026-08-28T00:00:00Z",
  "worlds": [
    {
      "id": "pgc.xiaohei",
      "kind": "platform",
      "publisher": "recut",
      "version": "0.1.0",
      "manifestUrl": "https://cdn.recut.video/worlds/pgc.xiaohei/0.1.0/world.json",
      "sha256": "…",
      "bytes": 18432,
      "status": "active",
      "order": 1
    }
  ]
}
```

- `kind`：`platform`（自动同步；ID 前缀 `pgc.`；publisher 恒为 `recut`）/ `published`（手动安装；ID 前缀 `pub.`，目录分配；publisher 为发布者标识，签名机制 P4）。
- `status`：`active` / `delisted`（下架条目保留以驱动本地归档；published 已安装副本继续只读可用，停止更新）。
- `order`：仅 platform 使用（列表稳定排序）。
- 本地覆盖：`<dataRoot>/world-catalog.json` 整体替代远端目录（与 `appstore.json` 同惯例）。
- 嵌入种子：`service/worldcatalog/`（catalog + 各 `pgc.*` 发布格式 manifest，`//go:embed`）；由构建脚本 `--seed` 模式从最新发布产物生成，随二进制发布（与 `make builtin-apps` 同节奏）。
- 目录透传：`GET /v1/worlds/catalog` 返回服务缓存的完整目录（含 published 条目），供未来 World Store UI 与调试使用；v1 实现，成本极低。

### 源格式（官方仓库，authoring 形态）

```text
worlds/
  README.md
  xiaohei/
    world.json          # 元数据 + 实体 + 证据声明；长文本用 $file，资源用相对路径
    world.md            # ★ 世界核心技能（固定约定：与 world.json 同目录，可缺省=空技能）
    references/
      xiaohei-ip.md     # 小黑 IP 完整文档 → character 实体 body
      style-dna.md      # 风格 DNA 全文 → style 实体 body
    examples/
      01-two-breakpoints.png
      …                 # 14 张示例图（约 13MB，仅存在于仓库与 CDN，不进 manifest、不进用户设备）
```

源格式规则：

- `world.md` 是**目录约定**（同 SKILL.md 之于 skill 目录）：构建时读取并内联为发布 manifest 的 `world.skillMd`；不存在则为空。
- 实体长文本引用：`content.body: { "$file": "references/xiaohei-ip.md" }`。`$file` 路径必须位于该世界目录内（禁止 `..` 逃逸）；构建解析为内联字符串。
- 证据资源：`evidence[].url` 允许**相对路径**（如 `examples/01-two-breakpoints.png`，构建时镜像到 CDN 并改写为绝对 URL）或绝对 `http(s)` URL（构建期 HEAD 验证后保留，用于已在平台 CDN 的资源）。
- `world.json` 的其余字段与发布格式相同（见下）。

### 发布格式（CDN 上的单文件 manifest，daemon 的唯一输入）

**canonical-complete**：物化所需一切都在文件内；物化器零网络访问。构建脚本把源格式确定性转换为发布格式（键排序、稳定序列化 → 同一源产出逐字节相同的 manifest，catalog hash 在 CI 间稳定）。

```json
{
  "manifestVersion": 1,
  "world": {
    "id": "pgc.xiaohei",
    "name": "小黑怪诞正文配图",
    "type": "character_ip",
    "description": "为中文文章生成白底手绘、怪诞清爽的 16:9 正文配图：小黑 IP + 风格 DNA + 完整生产工作流。",
    "coverUrl": "https://cdn.recut.video/worlds/pgc.xiaohei/0.1.0/cover.png",
    "skillMd": "## 核心定位\n为中文文章设计和生成 16:9 横版正文配图……\n## 工作流\n### 1. 消化正文\n……\n### 3. 单张生成\n用户明确要求生成时不要停下等确认；用当前宿主的图片生成工具（在 Recut 中为 `recut.image.generate`）每张单独生成……\n## 生图提示词模板\n提示词必须包含：……\n## 生成后检查\n出现以下问题优先重生成：……\n## 资源口径\n「风格示例」证据集仅作低频视觉校准，不进入默认生成路径；角色外形以「小黑」角色设定（含 body）为准，风格以「风格 DNA」为准。\n<!--（全文内联，此处省略）-->",
    "identity": {
      "positioning": "中文知识型内容的正文配图体系",
      "audience": ["写中文文章/方法论/工作流内容的创作者"],
      "tone": "怪诞、克制、手绘、清爽"
    }
  },
  "entities": [
    {
      "id": "xiaohei", "kind": "character", "title": "小黑",
      "summary": "黑色实心、白点眼、细腿、空表情的荒诞工作者。",
      "content": {
        "appearance": "黑色实心小怪物；白色圆点眼睛；细腿；轮廓略不规则有手绘感；表情空、呆、冷静、认真",
        "personality": "很认真但做的事有点荒诞；低调系统操作员；冷幽默不卖萌",
        "voice": "无台词；以动作叙事",
        "body": "（references/xiaohei-ip.md 全文内联：外形 / 性格 / 常见职责 / 禁止）"
      }
    },
    {
      "id": "style-dna", "kind": "style", "title": "风格 DNA",
      "summary": "纯白背景、黑色手绘线稿、少量红橙蓝中文批注、大量留白。",
      "content": {
        "kind": "visual",
        "guidance": "纯白背景（无米色/纸纹/渐变/阴影）；细线轻微抖动；主体占 40%-60%，≥35% 留白；批注 5-8 处、每处 2-8 字；一图一核心结构",
        "body": "（references/style-dna.md 全文内联：必须 / 颜色 / 绝对不要 / 审美方向）"
      }
    },
    { "id": "rule-format", "kind": "rule", "title": "16:9 横版", "content": { "type": "always", "text": "16:9 横版中文正文配图" } },
    { "id": "rule-no-ppt", "kind": "rule", "title": "禁止 PPT 感", "content": { "type": "never", "text": "不要商业插画、PPT 信息图、正式流程图、可爱卡通、复杂架构图；不要左上角写类型标题" } }
  ],
  "evidence": [
    { "entityId": "xiaohei", "url": "https://cdn.recut.video/worlds/pgc.xiaohei/0.1.0/examples/01-two-breakpoints.png", "modality": "image", "purpose": "appearance", "status": "supporting", "collection": "风格示例", "label": "两个断点" },
    { "entityId": "xiaohei", "url": "https://cdn.recut.video/worlds/pgc.xiaohei/0.1.0/examples/05-handoff-path.png", "modality": "image", "purpose": "visual_style", "status": "supporting", "collection": "风格示例", "label": "承接路径" }
  ],
  "provenance": {
    "author": "helloianneo",
    "license": "MIT",
    "repository": "https://github.com/helloianneo/ian-xiaohei-illustrations",
    "sourceRevision": "cbf5ee2"
  }
}
```

### Manifest 规则（发布格式）

1. `world.id`：`pgc.` 前缀（platform）或 `pub.` 前缀（published）；本地 World 永不使用这两个前缀。
2. `entities[].id` 为 slug，**物化时直接用作本地 entity ID**（同步幂等基础，见同步协议）。
3. `world.skillMd`：markdown 字符串，可空。**预算 ≤ 16KB**；实体 `body` 合计 **≤ 16KB**（构建期硬校验，物化期复核）。
4. `evidence[]` 只允许 `url`（v1 manifest）；`modality/purpose/status/collection` 复用现有 closed 集合；条目 ≤ 200。
5. manifest 文件 ≤ 2MB；不携带 `assetId`（本地资产概念不进入平台内容）。
6. canonical 序列化**复用既有 `computeCanonicalTx` 规则**，canonical 结构增加 `skill` 字段（`worlds.skill_md`）：`{ world:{name,type,description}, skill, identity, entities, relations, references }`。平台/发布 World 与本地 World 的 revision 语义完全同构。

## 数据模型变更（layout v3 → v4）

沿用 `project.go` 版本门禁惯例（additive + duplicate column 容忍），含一次小表重建：

```sql
-- 1. worlds：来源维度 + 核心技能
alter table worlds add column origin text not null default 'local';
alter table worlds add column origin_meta_json text not null default '{}';
alter table worlds add column skill_md text not null default '';

-- 2. world_asset_refs：URL 资源源 + unique 键重建
--    旧键 unique(world_id, entity_id, asset_id, role) 无法容纳 asset_id 为空
--    （URL 行）的多个同 role 证据。SQLite 不能原地改约束，Ensure() 内一次性
--    重建（数据量小，迁移即复制，url 列补 ''）：
create table world_asset_refs_v2 (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  entity_id text references world_entities(id) on delete cascade,
  asset_id text not null default '',
  url text not null default '',
  asset_content_hash text not null default '',
  modality text not null default '',
  purpose text not null default '',
  evidence_status text not null default 'supporting',
  collection_name text not null default '',
  segment_json text not null default '',
  role text not null default '',
  label text not null default '',
  sort_order integer not null default 0,
  created_at text not null,
  archived_at text,
  unique(world_id, entity_id, asset_id, url, role)
);
-- 复制旧行（url=''）→ drop 旧表 → rename；索引重建
```

写入路径强制：

- `asset_id` 与 `url` **恰好一个**非空；URL 必须绝对 `http(s)`。
- 本地 asset 源沿用现有校验（存在、`completed`、modality 推导）；URL 源的 `modality` 必须属于 closed 集合（CDN 资源构建期已验证，不强制 HEAD）。
- `origin` 创建后不可变更。

`origin_meta_json`：

```json
{
  "kind": "platform",
  "publisher": "recut",
  "version": "0.1.0",
  "manifestHash": "sha256:…",
  "catalogOrder": 1,
  "publishedAt": "2026-08-28T00:00:00Z",
  "syncedAt": "2026-08-28T02:11:03Z",
  "installedAt": "2026-09-01T08:00:00Z",
  "uninstalled": false,
  "forkedFrom": { "worldId": "pgc.xiaohei", "revisionId": "…" }
}
```

`kind/publisher/version/manifestHash/syncedAt` 用于 platform；`installedAt/uninstalled` 用于 published（P4）；`forkedFrom` 仅出现在 Fork 出的 local World。

## 同步与安装协议

### 统一原语

```text
materialize(entry):
  local := worlds[id = entry.id, origin 对应 entry.kind]
  if local?.originMeta.manifestHash == entry.sha256: return no-op        # 幂等门
  manifest := GET entry.manifestUrl (≤2MB, 60s)
  if sha256(manifest) != entry.sha256: emit mismatch; return             # 绝不物化
  if !validate(manifest): emit invalid; return                           # schema/预算/ID 规则
  tx:
    upsert worlds(id, origin, skill_md, identity, origin_meta)
    delete 该 world 未归档的 entities / relations / evidence 行
    insert manifest 的 entities / relations / evidence（ID 直接用 manifest 值）
    commitRevision(tx, reason='platform.sync'|'store.install'|'store.update', createdBy='platform'|'publisher')
  commit; emit world.<origin>.materialized

archive(worldId, reason):  # reason = delisted | uninstalled
  set archived_at（经 commitRevision）; 行永不硬删（binding 解析依赖）
```

### 策略 A：platform 自动同步（v1 实现）

触发：daemon 启动（与 `BuiltinAppManager.Ensure()` 同级）+ 运行期每 24h 一次。仅处理 `kind=platform` 条目；`kind=published` 条目在自动同步中**一律跳过**（未安装即不存在，已安装的只停更不覆盖）。目录中 `delisted` 的 platform 世界 → `archive(delisted)`。性质：

- **幂等**：hash 门 + 确定性 ID + `commitRevision` 去重 → 重复同步零 revision；内容变化恰好一个新 revision。
- **可追溯**：平台更新 = 一次 canonical revision（`created_by='platform'`）；旧 binding 固定旧 revision 不受影响。
- **离线安全**：远端失败只影响更新；种子/上次同步的内容继续服务。
- **无合并问题**：非 local World 对用户只读，本地永不出现"用户改动 vs 上游更新"冲突——整事务替换的前提。

### 策略 B：published 手动安装（契约冻结，P4 实现）

```text
recut.worlds.install    { worldId }   # 从目录 materialize；未上架/下架 → 结构化错误
recut.worlds.update     { worldId }   # 已安装且目录版本更新 → materialize（= 同步单条目）
recut.worlds.uninstall  { worldId }   # archive(uninstalled)；UI 回到"可安装"
```

- 安装/更新复用 `materialize`（时机由用户触发，界面展示版本号与变更说明）；卸载 = `archive(uninstalled)`，与 delisted 同机制，binding 历史不受影响。
- 目录中 published 条目下架（`delisted`）：已安装副本保持只读可用、停止更新，UI 标注"已下架"。
- v1 行为：这些操作**不注册**为 MCP 工具（保持 v1 工具面最小）；数据模型、catalog kind、CDN 布局与语义已按上述冻结，P4 只加操作层与 Store UI，不动数据层。

## 写策略：只读 + Fork

### 只读门禁

`WorldStore` 所有变更入口（`UpdateWorld`、`UpsertEntity`、`AttachReference`、`ArchiveEvidence`、关系写入、`skill_md` 修改等）在事务首步检查：

```text
origin != 'local' → WORLD_READ_ONLY
  details: { origin, hint: "fork", forkOperation: "recut.worlds.fork" }
```

- 新增错误码 `WORLD_READ_ONLY`（HTTP/MCP/SDK 同形状结构化错误）。
- **不受限**：全部只读（list/get/entities/brief/resolve）、`bind_project` / `bindMediaJob`（引用 + 固定 revision，不修改 World）。
- Agent 策略（写入 `service/skills/recut/SKILL.md`）：用户要求修改平台/发布 World 时，说明只读并**提议 Fork**，确认后调用 `recut.worlds.fork`，在副本上继续。

### Fork

```text
recut.worlds.fork
  input:  { worldId, name? }
  output: WorldDetail（新 origin=local 的 World）
```

- 任意 World 可 Fork（平台/发布世界的主要出口；本地世界是"从现有世界起步"的便捷入口，v1 UI 只对非 local 世界暴露）。
- 在源 `current_revision_id` 快照上执行：复制 identity / `skill_md` / entities（新本地 ID，关系重映射，含 body）/ evidence（asset 或 url 原样）；`origin='local'`，`origin_meta.forkedFrom={worldId, revisionId}`。
- 副本与上游彻底独立（upstream sync 列为非目标）；Fork 是一次普通 revision（`reason='world.forked'`）。

## Evidence 双源与 `import_url`

`WorldAssetReference` / `WorldEvidence` 输出增加：

```ts
type EvidenceSource = "asset" | "url";
type WorldAssetReference = {
  source: EvidenceSource;
  assetId?: string;      // source === "asset"
  url?: string;          // source === "url"
  assetContentHash?: string;
  modality: string; purpose: string; status: string;
  collection?: string; segment?: { startSec: number; endSec: number };
  label?: string; entityId?: string;
};
```

`recut.worlds.references.attach` 接受 `assetId` 或 `url`（二选一）；`resolve` 与 `brief` 输出统一带 `source`。用户 World 因此也能引用外部 URL 资源而无需先入库。

**`recut.media.import_url`**（新增，Phase 1）：URL → 本地 Asset 的官方桥梁（provider 只接受本地路径、或用户想把世界示例图收进自己素材库时使用）：

```text
recut.media.import_url
  input:  { url, name?, projectId? }
  output: { assetId, name, kind, contentHash }
```

约束：绝对 http(s)、≤25MB、mime 白名单（image/video/audio）、内容寻址去重。canon 保持 URL 真相，本地化是按需的。

## `recut.worlds.brief`（v1）

兑现 08-14 重构的读取入口决策，范围收敛为只读投影（actionableInputs/adaptations/conflicts 仍归重构后续阶段）：

```text
recut.worlds.brief
  input:  { worldId, revisionId?, selection?: WorldSelection }
  output: WorldBrief
```

```ts
type WorldBrief = {
  world: {
    id: string; name: string;
    origin: "local" | "platform" | "published";
    originMeta?: { kind?: string; version?: string; publisher?: string; publishedAt?: string; forkedFrom?: { worldId: string; revisionId: string } };
    provenance?: { author?: string; license?: string; repository?: string };
    revisionId: string; canonicalHash: string;
  };
  identity: Record<string, unknown>;
  skill?: string;                       // world.md 全文内联（空则省略）
  facts: {
    characters: Array<Record<string, any>>;   // 含 body（如有）
    stories: Array<Record<string, any>>;
    locations: Array<Record<string, any>>;
    styles: Array<Record<string, any>>;
  };
  constraints: { always: string[]; never: string[]; prefer: string[] };
  evidence: WorldAssetReference[];      // ≤100 条；带 source/assetId|url
  missing: Array<{ kind: string; title: string }>;  // v1 可为空数组
};
```

- 与 `resolve` 从同一冻结 revision canonical 投影；`skill` 与实体 `body` **内联**（实践与长文事实是 PGC 的核心载荷，二次取回会毁掉"一次调用可生产"；预算构建期封顶）。
- `selection` 语义同 `resolve`（storyId/entityIds/assetRoles/purpose）。
- 尺寸预算：skill ≤16KB、实体 body 合计 ≤16KB（构建期保证）、evidence ≤100 条。
- `resolve` 保留为 App/运行时内部投影（输出同步增加 `source`/`url` 与 `skill`），不再是 Agent 首选入口。

### Chat 上下文物料

`creation_world` attachment 的服务端物料文本改为：

```text
[Creation World] worldId=… name=… origin=platform|published|local revisionId=…
—— 调用 recut.worlds.brief({ worldId, selection: { purpose: "…" } }) 一次获取
身份、世界技能（world.md）、事实、规则与证据。非 local 世界只读：用户要求修改时
提议 recut.worlds.fork。世界技能是该世界的生产工作流：按其执行（先策略后生成、
逐张生成、按质检口径复核后再交付）。
```

## 发布管线

### 构建脚本 `scripts/worlds-publish.mjs`

1. **校验**：schema、closed 集合、ID 前缀、预算（skillMd / body 合计 / evidence 数 / manifest 大小）；`$file` 与相对路径必须在世界目录内。
2. **解析与镜像**：`world.md` → `skillMd`；`$file` → 内联；相对证据路径 → 下载至 `cdn/buckets/worlds/<id>/<version>/…`（内容寻址文件名，R2，与 fonts/effects 同桶）→ 改写 manifest 为 CDN 绝对 URL；绝对 URL 资源仅 HEAD 验证。
3. **确定性输出**：键排序稳定序列化 → 发布 `world.json`（同一源逐字节可复现）→ SHA-256。
4. **catalog**：合并生成 `cdn/buckets/worlds/catalog.json`（platform + published 全量；platform 按 `order` 排序）。
5. **种子**：`--seed` 把最新 `pgc.*` 发布产物与 catalog 写入 `service/worldcatalog/`（构建期动作，随 `make service-build` 进入二进制）。
6. **`--check`**：只校验并打印 canonical hash 预览（CI 跑，防格式漂移）。

发布经既有 `make cd-upload` 上 R2；旧版本对象不可变保留（审计与 diff 用；可复现性由本地 revision 承担）。

### 小黑（xiaohei）的一次性适配

源仓库 `helloianneo/ian-xiaohei-illustrations`（MIT）为 Skill 形态；适配映射（人工一次、可审阅、可 diff；v1 不做 SKILL.md 自动解析）：

| 源（vendor 进 `worlds/xiaohei/`） | 目标 |
| --- | --- |
| `SKILL.md`（核心定位 + 工作流 + 输出口径） | `world.md`（宿主无关化改写，见下） |
| `references/prompt-template.md` | 折叠进 `world.md`「生图提示词模板」章节 |
| `references/qa-checklist.md` | 折叠进 `world.md`「生成后检查」章节 |
| `references/composition-patterns.md` | 折叠进 `world.md`「结构类型与隐喻方法」章节 |
| `references/xiaohei-ip.md` | entity `character/xiaohei`（typed 字段 + `body` = 该文件，`$file` 引用） |
| `references/style-dna.md` | entity `style/style-dna`（typed 字段 + `body`）+ `rule` 实体（"绝对不要"清单） |
| `assets/examples/*.png`（14 张，约 13MB） | `examples/` → evidence（相对路径，发布期镜像 CDN；collection=风格示例，status=supporting） |

**适配纪律**：

- `world.md` 中宿主相关表述改写为宿主无关 + Recut 映射："内置 `image_gen`" → "当前宿主的图片生成工具（在 Recut 中为 `recut.image.generate`）"；"保存到 `assets/<slug>-illustrations/`" → "生成结果入库 Recut 素材库"。
- `world.md` 必须含「资源口径」章节：声明证据集的使用边界（"风格示例仅作低频视觉校准，不进入默认生成路径；不复刻已有案例构图"）——这是 skill 索引其资源的契约。
- 13MB 示例图只存在于官方仓库与 CDN：manifest 仅 ~10KB URL 清单，daemon 同步不下载图片；图片在 UI 缩略图或 Agent 需要时经 CDN 按需加载。

### 授权与治理

- 源仓库必须允许再分发（小黑为 MIT）；`provenance.license` 必填，详情页来源卡片展示；vendor 的资源保留版权说明（`worlds/xiaohei/README.md` 记录来源与 sourceRevision）。
- v1 目录与 manifest 仅官方 CI 可写；`pub.*` 条目由 P4 的提报管线写入（发布者身份、审核、签名）。

## 产品与 UI 契约

1. **World 详情页 Tab 结构**（local / platform / published 一致，后者只读）：
   `概览 | 世界技能 | 角色 | 故事 | 场景 | 风格 | 规则 | 世界素材`
   —— **世界技能（world.md）是独立 Tab**（markdown 预览；local 世界可编辑，非 local 只读），不并入规则或任何实体区。
2. **Worlds Tab 列表**：`平台世界`（顶置，按 `order` 稳定排序，**平台**徽标）/ `我的世界`（现行为不变；含 Fork 副本与未来已安装的 published 世界）。P4 增加 `World Store` 段（可发现/安装/更新/卸载 published 世界）——本 RFC 冻结其数据契约，UI 范围留给 P4。
3. **WorldPicker**（Chat @ 引用与创作入口）：平台段固定置顶 + 徽标；type 筛选在段内生效；平台世界不随 updated_at 漂移。
4. **非 local World 详情页（只读）**：无编辑/删除/归档/移除证据入口（API 门禁 + UI 不渲染）；**来源卡片**（作者、许可证、源仓库链接、版本、最近同步/安装时间、`forkedFrom`）；主 CTA `开始创作`，次 CTA `Fork 为我的世界`（成功后跳转新 World）；evidence 图片以 `<img src={url}>` 直接渲染（CDN 远程图，复用 AssetPreview 降级占位）；delisted 世界在列表/picker 不显示，详情页显示"已下线/已下架"态。
5. **更新提示**：平台 World 新 revision 后，"开始创作"范围预览显示"设定已有更新，是否采用最新版"（复用 08-14 重构；不构建推送）。
6. **i18n**：平台世界 / 世界技能 / Fork 为我的世界 / 已下线 等词条进 zh/en 字典。

## Agent 契约（`service/skills/recut/SKILL.md` Worlds 章节增补）

- `recut.worlds.brief` 是读取 World 的默认单次入口；**世界技能（`skill`/world.md）是该世界的生产工作流**：按其执行（例如小黑：先出 shot list，再逐张生成，按质检口径复核后交付）；技能中的「资源口径」约束证据的使用方式。
- 非 local World 只读：`WORLD_READ_ONLY` 是边界不是失败——按 details 提议 Fork。
- `source: "url"` 的证据：provider 接受 URL 时直接引用；需要本地文件/入库时调用 `recut.media.import_url`。

## 非目标（v1）

- **UGC 发布的实现**：提报管线、发布者身份/签名、World Store UI、install/update/uninstall 操作——架构位已冻结（catalog kind、origin 值、ID 命名空间、CDN 布局、uninstall=archive 语义、materialize/archive 原语），P4 只加操作层。
- 用户 World 的跨设备/云端同步（平台内容仅平台→用户单向）。
- Fork 与上游的 sync/merge。
- Ed25519 manifest 签名（v1 = TLS + 目录 SHA-256 + CDN 只写权限）。
- brief 的 `actionableInputs`/`adaptations`/`conflicts`/模型能力降级（08-14 重构后续阶段）。
- SKILL.md / 任意 Skill 仓库的自动转换（v1 人工适配 + 显式目录布局）。
- 手动指定任意 manifest URL 安装（高级逃生舱；P4 随 Store 评估）。

## 分阶段交付

- **P0 契约冻结**：源/发布格式、Catalog v1（含 `kind`）、brief v1 输出（含 `skill`）、`WORLD_READ_ONLY`、`fork`、Evidence 双源、origin 三元、install/update/uninstall 语义。本 RFC 获批即完成。
- **P1 service**：
  1. schema v4（origin/origin_meta/skill_md、world_asset_refs 重建 + url 列、layout 4 与备份策略）；
  2. 只读门禁 + `fork`（HTTP `POST /v1/worlds/{id}/fork` + MCP）；
  3. `brief`（HTTP `POST /v1/worlds/{id}/brief` + MCP `recut.worlds.brief`）；
  4. worldcatalog（嵌入种子 + 远端目录 + 本地覆盖 + 同步器：仅 `kind=platform` + 事件）；
  5. `GET /v1/worlds/catalog` 透传；
  6. `recut.media.import_url`；
  7. Chat 上下文物料改指向 brief；
  8. 全量测试（见测试矩阵）。
- **P2 web**：世界技能独立 Tab（local 可编辑/非 local 只读）、平台段与徽标、只读详情 + 来源卡片 + Fork CTA、远程图渲染、picker 平台段、i18n。
- **P3 内容与 E2E**：官方仓库 `worlds/xiaohei`（vendor + 适配）+ `scripts/worlds-publish.mjs` + CDN 上传 + catalog + 种子；真实会话验收（见验收标准 2）。
- **P4 World Store（后续）**：UGC 提报管线（发布者身份/审核/签名）、install/update/uninstall MCP 操作与 Store UI、已安装 published 世界管理、"设定变更 diff"（随 08-14 重构变更历史）。

## 测试矩阵

| 层 | 必测 |
| --- | --- |
| 构建脚本 | `$file`/相对路径解析且禁止目录逃逸；`world.md` → `skillMd` 内联；相对资源镜像后改写为 CDN 绝对 URL；确定性：同一源两次构建逐字节相同；预算超限拒绝；`--seed` 产物与最新 catalog 一致 |
| Materializer | 同 manifest 两次同步 → 零新 revision（幂等）；内容变化 → 恰好一个新 revision；确定性：两个空 daemon 物化同 manifest → canonical hash 相同；hash 不符 → 拒物化 + 事件；schema/预算违规 → 拒物化 + 事件；**`kind=published` 条目在自动同步中一律跳过（不物化、不归档）**；delisted platform → 归档 + revision；恢复 active → 去归档 |
| 只读与 Fork | 非 local World 每个写入口（update/upsert/attach/archive/relations/skill_md）返回 `WORLD_READ_ONLY` 且 details 含 fork 指引；binding 允许；fork 产物 `origin=local`、`forkedFrom` 正确、skill_md/body/evidence 完整复制、可完整编辑；平台后续更新不传播到 fork |
| Evidence 双源 | asset 与 url 二选一强制；url 行 modality/purpose 校验；resolve/brief 输出 `source` 正确；表重建迁移后旧数据完整、唯一键行为正确；同一 entity 两条同 purpose 的 URL 证据可共存 |
| brief | `skill` 内联（空则省略）；实体 body 内联；evidence ≤100；revision 固定（后编辑不改旧 revision brief）；selection 过滤与 resolve 一致 |
| import_url | 白名单/大小/去重；失败（404/超限/非白名单）结构化错误；可选挂项目 |
| Web | 世界技能 Tab（local 编辑 / 非 local 只读）；picker 平台段置顶稳定序；非 local 详情无写入口；Fork 跳转；远程图占位降级；delisted 不出现 |
| Chat E2E | `@pgc.xiaohei` 物料文本指向 brief；Agent 一次 brief 获得 skill + character(style/body) + rules + evidence URL；按 world.md 工作流产出 shot list → `recut.image.generate` 逐张生成 → 按质检口径复核 → 交付素材深链；全程未调用任何 World 写工具 |
| 回归 | local World 创建/编辑/绑定/revision 冲突行为不变；无平台种子的干净安装 Worlds 功能正常；`make check` 全绿 |

## 可观测性

新增事件（仅 ID/版本/哈希，不含 canon 正文）：

```text
world.catalog.synced              { kind, added, updated, delisted, skipped }
world.catalog.sync_failed         { reason: network | hash_mismatch | invalid_manifest }
world.catalog.manifest_mismatch   { worldId, expectedHash, actualHash }
world.platform.materialized       { worldId, version, revisionId }
world.platform.archived           { worldId, reason: delisted }
world.published.materialized      { worldId, version, revisionId, op: install | update }   # P4
world.published.archived          { worldId, reason: uninstalled | delisted }               # P4
world.forked                      { fromWorldId, toWorldId, fromRevisionId }
```

## 开放问题

1. **Catalog 域名**：建议直接走 R2（`cdn.recut.video/worlds/…`，与 fonts/effects/releases 同链路）。
2. **coverUrl 是否必填**：建议可选；缺省时列表卡片用类型图标 + 首个 image evidence 缩略图。
3. **published 世界的 ID 分配**：目录分配 `pub.<publisher-slug>.<world-slug>` 还是纯目录序号？建议前者（可读、可猜、利于提报幂等），P4 定稿。
4. **平台更新对已绑定项目的提示时机**：沿用 08-14 重构"创作范围预览时提示"，不做主动推送。

## 验收标准

1. **首启即有**：全新安装（含离线，用种子）启动后，Worlds 列表与 Chat @ 引用中即出现带"平台"徽标的小黑世界；无需任何安装/更新动作。
2. **系列图闭环**：全局 Chat `@小黑怪诞正文配图` + 一篇中文文章 → Agent 一次 `brief` 获得 world.md（工作流 + 模板 + 质检 + 资源口径）、小黑角色（含 IP 文档 body）、风格 DNA、规则与示例图 URL → 输出 4–8 张 shot list → 逐张 `recut.image.generate` → 按质检口径复核 → 交付素材深链；全程未调用任何 World 写工具。
3. **只读是硬边界**：对非 local World 的任何写操作（UI、HTTP、MCP、App ctx，含 skill_md）都返回 `WORLD_READ_ONLY`；Agent 收到后提议 Fork；Fork 副本可完整编辑（含世界技能）且不再随平台更新。
4. **更新可追溯**：发布小黑 0.2.0 后，daemon 同步恰好产生一个新 revision；旧 Project binding 解析出的 brief 与更新前一致；新创作提示"设定已有更新"。
5. **篡改不可物化**：修改 CDN manifest 任意字节（目录 hash 不匹配）→ 本地内容不变，仅记录 mismatch 事件。
6. **一致性**：两个全新 daemon 物化同一 manifest 后 canonical hash 相同；`kind=published` 条目绝不被自动同步物化；local World 全部既有行为零回归。

## 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 平台单点：CDN 不可达时用户看不到平台世界 | 嵌入种子保证首启；更新失败静默降级；世界是本地行，离线可继续引用 |
| 整事务替换的写放大 | 预算约束世界规模（skill 16KB / body 16KB / evidence 200 / manifest 2MB）；hash 门使实际写入极少 |
| world.md 内联撑大 Agent 上下文 | 16KB 硬预算；一个世界一个技能的垂直性约束天然限流 |
| URL 资源失链（源仓库删除） | 发布期资源镜像到平台 CDN（不可变、长期保留）；manifest 只引用 CDN；构建期全量验证 |
| 用户期望"微调"平台世界 | 只读 + Fork 是唯一路径，错误文案直接给出 fork 操作 |
| P4 契约漂移 | install/update/uninstall 的语义、origin 值、catalog kind、CDN 布局在本 RFC 冻结；P4 实现前任何相关数据层变更需回改本 RFC |
| 与 08-14 重构的范围重叠 | 本 RFC 只实施重构已决策的 brief 读取入口（v1 收敛版）与 Evidence 的 URL 源；propose/apply、completeness 表单等不重复设计 |

## 结论

平台 World 内容层不需要第二套 World 架构：它需要的是给现有 WorldStore 补上四个维度——**来源**（origin 三元 + 单一 Catalog + CDN 分发，自动与手动只是同一组原语的两种策略）、**核心技能**（world.md 一等公民：每个世界是一个垂直 skill）、**资源**（URL 证据源）、**实践入口**（brief 单次可生产上下文）。每一项对 local World 同样成立（world.md 可写、body 可用、URL 证据可用），补的是模型缺口而非 PGC 特例。小黑是第一个实例，验证整条管线：源仓库目录（world.md + 内聚资源）→ 构建（解析/镜像/确定性序列化）→ CDN + Catalog → daemon 自动同步 → 本地 revision → Chat @ 引用 → world.md 驱动的系列图生产；同一目录与 catalog 也为 UGC 发布（P4）留好了通道。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
