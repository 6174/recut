<!--
 * [INPUT]: 依赖 Creation Worlds 三份既有 RFC（2026-08-12 产品 / 2026-08-12 技术设计 / 2026-08-14 产品重构）的 WorldStore、revision、binding、Evidence 实现，以及 service 的 builtin_apps 种子、appstore 目录覆盖、CDN 分发与 layout version 门禁
 * [OUTPUT]: 定义平台内置（PGC）World 的交付架构（云端目录自动同步 + 嵌入种子）、World Manifest 与目录格式、origin/只读/Fork 写策略、Evidence 的 URL 资源源、guide 实体类型与 brief v1 读取入口、发布管线与小黑（xiaohei）首个实例
 * [POS]: rfc 的 Worlds 平台内容层决策；在 08-14 产品重构之上补充"平台提供、用户只读"这一 World 来源维度，获批后指导 service、web、官方仓库与发布脚本
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: PGC Platform Worlds——平台内置的只读创作设定

- 状态：提议
- 作者：Recut
- 日期：2026-08-28
- 关联：[Creation Worlds 初版 RFC](./2026-08-12-creation-worlds.md)、[技术设计](./2026-08-12-creation-worlds-technical-design.md)、[产品重构](./2026-08-14-creation-worlds-product-reframe.md)
- 决策范围：World 的来源与交付（平台 PGC 内容）、World Manifest/目录契约、Evidence 资源源扩展、guide 实体类型与 brief 读取入口、写策略（只读 + Fork）、发布管线
- 首个实例：`helloianneo/ian-xiaohei-illustrations`（小黑怪诞正文配图 Skill 仓库）转化为内置 World `pgc.xiaohei`

## 摘要

当前 Worlds 只有用户自建（UGC）这一种来源：每个 World 由用户在本地创建、维护，Evidence 必须指向本机素材库中已完成的 Asset。这使平台无法提供"开箱即用"的官方创作设定——例如一个完整的插画风格世界：角色 IP、风格 DNA、创作规则、生产工作流、提示词模板、质检清单和示例图，用户 @ 一下就能产出一组风格一致的系列图。

本 RFC 引入 **PGC World（平台内容 World）**：由平台发布、云端目录自动同步到本地 WorldStore、用户只读、资源以 URL 承载的内置 World。核心立场：

1. **PGC World 在本地就是真实的 World 行**。它进同一张 `worlds` 表、同一套 entities/evidence/revision，读取、resolve、brief、binding、Chat @ 引用、MCP 发现全部走既有单一路径，零特判。差异只体现在三个维度：**来源（origin）、写策略（只读 + Fork）、更新来源（云端目录）**。
2. **用户不下载、不安装、不更新**。"下载"发生在 daemon 内部：启动时与低频率后台把云端目录（catalog + manifest，带 SHA-256 校验）物化进本地 store，幂等、离线可用。Git 仓库是**发布源**，不是分发通道。
3. 借此次打通 PGC 暴露出的模型缺口，做两处架构修正：**Evidence 支持 URL 资源源**（assetId 与 url 二选一）、**新增 `guide` 实体类型**承载世界的"实践层"（生产工作流、提示词模板、质检清单），并把 08-14 重构承诺的 `recut.worlds.brief` 作为单一默认读取入口落地（v1 范围）。

产品主张：**平台的世界和我的世界，用起来是同一个 World；平台只多了"来自哪里、不能改、会自动更新"三件事。**

## 问题

1. **没有平台内容来源。** World 列表只可能来自用户手工创建。平台的 IP 风格、方法论类内容（如小黑配图体系）无法以一等公民身份出现在 Worlds 列表、Chat @ 引用和创作入口中。
2. **Evidence 只能是本地 Asset。** `AttachReference` 强制 `assetId` 存在且 `completed`（`validateEvidenceAsset`）。一个以 URL 资源为真相的官方世界（示例图、风格参考、音频样本）无处安放；把它们预导入每个用户素材库既浪费又破坏"资产库是用户事实源"的语义。
3. **模型缺"实践层"。** 现有实体 kinds（character/location/story/style/rule/reference）表达的是"这个世界里有什么事实与约束"。但 PGC 内容的价值主体是**怎么做**：工作流（先 shot list 再逐张生成）、提示词模板、质检清单。xiaohei 仓库中 `SKILL.md` 工作流 + `prompt-template.md` + `qa-checklist.md` 占了主要篇幅，现有模型没有承载位置，只能硬塞进 `style.content` 自由 JSON，Agent 无法结构化发现。
4. **读取入口仍是低层 resolve。** 08-14 重构 RFC 已决定 `worlds.brief` 为单一默认读取入口、`resolve` 降级为内部/高级 API，但尚未实施。PGC 的 Chat 体验（@ 一下 → 一次拿到可生产上下文）依赖 brief 落地。
5. **无更新与下架语义。** 平台内容必然迭代（新增示例、修订规则）并可能下架。本地 store 没有"平台世界如何变更、如何可追溯、如何下线"的定义。

## 核心决策

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 交付方式 | 云端目录（catalog + manifest）由 daemon 自动同步；嵌入二进制种子保证首启与离线 | 用户零动作（无安装/更新过程）；本地 store 是运行时唯一事实源，读取路径与用户 World 完全一致；Git 仅作发布源 |
| 运行时身份 | PGC World = `worlds` 表中 `origin='platform'` 的普通行；ID 使用平台命名空间 `pgc.` 前缀 | 所有既有能力（list/get/brief/bind/@引用/MCP）零改造可用；不需要第二套 world 子系统 |
| 物化确定性 | Manifest 自带稳定 ID（world 与 entity 的 slug），物化时直接用作本地 ID | 同一 manifest 永远产生同一 canonical 字节 → 同步幂等、不产生虚假 revision；跨设备天然一致 |
| 更新语义 | 新 manifest 的 canonical hash 变化 → 恰好一个新不可变 revision（reason `platform.sync`）；旧 Project binding 继续固定旧 revision | 复用既有 revision 机制，作品可追溯性不破坏；"设定已有更新"提示复用 08-14 重构设计 |
| 写策略 | 平台 World 只读：全部写操作返回 `WORLD_READ_ONLY`（错误携带 fork 指引）；`recut.worlds.fork` 生成用户可编辑副本 | "不能改"是硬边界而非 UI 隐藏；Fork 给出合法出口；binding（只引用不修改）始终允许 |
| 资源承载 | Evidence 扩展为 `assetId` **或** `url` 双源；PGC manifest 只用 `url`（平台 CDN） | URL 是世界自带的远程真相，不污染用户素材库；用户 World 同样受益（可引用外部指南/素材 URL） |
| 实践层 | 新实体 kind `guide`（创作指引），content 为 `{type, body(markdown), appliesTo?}`；body 内联进 brief 输出 | 补齐 canon = 事实 + 约束 + 证据 + **实践** 的完整模型；Agent 一次 brief 即获得可执行生产上下文 |
| 读取入口 | 实施 `recut.worlds.brief`（v1）为默认读取入口；Chat attachment 的上下文物料改指向 brief | 兑现 08-14 重构；PGC 的"一次调用获得全部生产上下文"依赖它 |
| 完整性 | Catalog 条目携带 manifest SHA-256；校验失败绝不物化。v1 用 TLS + 目录哈希，Ed25519 签名列入后续 | 成本最低的可信链；篡改/损坏内容可被确定性拒绝 |
| 发布 | 官方仓库 `worlds/<slug>/`（world.json + 资源）+ 构建脚本 → 平台 CDN + catalog；Skill 仓库的一次性人工适配 | 确定性、可审阅；不做"任意 SKILL.md 自动解析"的魔法 |

## 交付架构：三层，用户只看见一层

```text
┌─ 发布层（平台运营，人工 + CI）────────────────────────────────┐
│  源仓库（如 xiaohei skill repo）                                │
│    → 一次性人工适配为 world.json（Manifest v1）                │
│    → scripts/worlds-publish.mjs：校验 / 预算 / 资源镜像到 CDN   │
│    → cdn/worlds/<id>/<version>/ + cdn/worlds/catalog.json     │
└──────────────────────────────────────────────────────────────┘
                          │ HTTPS（daemon 内下载，用户无感知）
┌─ 同步层（service 后台，幂等单飞）──────────────────────────────┐
│  目录来源优先级：<dataRoot>/world-catalog.json（本地覆盖）       │
│            > 远端 catalog（启动 + 每 24h）                     │
│            > 嵌入种子 service/worldcatalog/（首启/离线兜底）     │
│  校验 SHA-256 → 校验 schema/预算 → 事务物化（ID 确定性）        │
│  → canonical hash 变化才产生新 revision                        │
└──────────────────────────────────────────────────────────────┘
                          │ 普通 SQLite 读写
┌─ 运行时层（既有 WorldStore，零特判）───────────────────────────┐
│  worlds / world_entities / world_asset_refs / world_revisions  │
│  → HTTP /v1/worlds、MCP recut.worlds.*、brief、binding、        │
│    Chat @ 引用、Worlds Tab、WorldPicker、生产 App 全部同路径     │
│  平台 World 仅多三处：origin 字段、写门禁、目录驱动更新          │
└──────────────────────────────────────────────────────────────┘
```

### 为什么是"云端同步到本地"，而不是另外三种方式

| 方式 | 用户体验 | 本地一致性 | 离线 | 完整性 | 结论 |
| --- | --- | --- | --- | --- | --- |
| A. 用户自行 Git 安装（App Store 模式） | 需要理解安装、手动更新；发现路径长 | 一致（本地仓库） | 好 | 依赖 Git 身份 | 否——安装/更新过程正是要避免的；World 是内容不是 App |
| B. 纯服务端 World（resolve 走平台 API） | 无需安装 | 破坏——本地不再是事实源，离线失效，每次读取依赖网络，且形成第二套 resolve 实现 | 差 | 强 | 否——违背 local-first；隐私上本地 canon 不应默认出机 |
| C. 云端目录自动同步 → 本地 store（**选定**） | 零动作；更新自动、可追溯 | 完全一致——同一张表、同一套代码 | 好（种子兜底） | TLS + SHA-256 | 是 |
| D. 仅嵌入二进制（builtin_apps 模式） | 零动作 | 一致 | 最好 | 最强 | 更新绑定版本发布周期，无法独立迭代内容；作为 C 的种子层保留 |

C 的"下载"对用户不可见：它是 daemon 启动例行的一部分（与 builtin app 的 `Ensure()` 同节奏），失败时静默降级到本地已有内容。用户侧效果 = "平台世界一直在，且悄悄保持最新"。

## World Manifest v1

`world.json` 是**canonical-complete** 声明式文档：物化它所需的一切都在文件内。发布构建负责校验、预算检查与资源镜像；物化器不做网络访问。

```json
{
  "manifestVersion": 1,
  "world": {
    "id": "pgc.xiaohei",
    "name": "小黑怪诞正文配图",
    "type": "character_ip",
    "description": "为中文文章生成白底手绘、怪诞清爽的 16:9 正文配图：小黑 IP + 风格 DNA + 完整生产工作流。",
    "coverUrl": "https://cdn.recut.video/worlds/pgc.xiaohei/0.1.0/cover.png",
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
        "voice": "无台词；以动作叙事"
      }
    },
    {
      "id": "style-dna", "kind": "style", "title": "风格 DNA",
      "summary": "纯白背景、黑色手绘线稿、少量红橙蓝中文批注、大量留白。",
      "content": { "kind": "visual", "guidance": "纯白背景（无米色/纸纹/渐变/阴影）；细线轻微抖动；主体占 40%-60%，≥35% 留白；批注 5-8 处、每处 2-8 字；一图一核心结构" }
    },
    { "id": "rule-format", "kind": "rule", "title": "16:9 横版", "summary": "", "content": { "type": "always", "text": "16:9 横版中文正文配图" } },
    { "id": "rule-no-ppt", "kind": "rule", "title": "禁止 PPT 感", "summary": "", "content": { "type": "never", "text": "不要商业插画、PPT 信息图、正式流程图、可爱卡通、复杂架构图；不要左上角写类型标题" } },
    {
      "id": "guide-workflow", "kind": "guide", "title": "配图工作流",
      "summary": "消化正文 → 出 shot list（4-8 张）→ 逐张生成 → 质检 → 交付。",
      "content": {
        "type": "workflow",
        "appliesTo": ["image", "chat"],
        "body": "## 1. 消化正文\n提炼核心观点与认知锚点……\n## 2. 先出配图策略\n每张图写清：放在哪段后 / 主题 / 核心意思 / 结构类型 / 小黑在做什么 / 建议元素 / 建议标注词。默认 4-8 张……\n## 3. 单张生成\n用户明确要求生成时不要停下等确认；用当前宿主的图片生成工具（在 Recut 中为 `recut.image.generate`）每张单独生成，提示词按「生图提示词模板」……\n## 4. 检查与迭代\n按「生成后检查」清单检查……\n## 5. 交付\n汇报张数、每张用途、入库位置；不长篇解释风格理论。"
      }
    },
    {
      "id": "guide-prompt-template", "kind": "guide", "title": "生图提示词模板",
      "summary": "单张生成必须包含的元素清单。",
      "content": { "type": "prompt_template", "appliesTo": ["image"], "body": "提示词必须包含：16:9 横版中文正文配图 / 纯白背景 / 黑色手绘线稿 / 少量红橙蓝中文手写批注 / 大量留白 / 小黑作为核心动作主体 / 禁止 PPT、商业插画、幼稚可爱、复杂架构、左上角类型标题。每次从当前文章重新发明一个奇怪但成立的隐喻，不复刻已有案例构图。" }
    },
    {
      "id": "guide-qa", "kind": "guide", "title": "生成后检查",
      "summary": "重生成判据。",
      "content": { "type": "checklist", "appliesTo": ["image"], "body": "出现以下问题优先重生成或局部编辑：小黑只是装饰 / 画面太满 / 太像流程图或 PPT / 中文太多或错字严重 / 左上角出现类型标题 / 画风太可爱幼稚 / 背景不是干净白底。" }
    }
  ],
  "evidence": [
    { "entityId": "xiaohei", "url": "https://cdn.recut.video/worlds/pgc.xiaohei/0.1.0/examples/01-two-breakpoints.png", "modality": "image", "purpose": "appearance", "status": "supporting", "collection": "风格示例", "label": "两个断点" },
    { "entityId": "xiaohei", "url": "https://cdn.recut.video/worlds/pgc.xiaohei/0.1.0/examples/05-handoff-path.png", "modality": "image", "purpose": "visual_style", "status": "supporting", "collection": "风格示例", "label": "承接路径" }
  ],
  "provenance": {
    "author": "helloianneo",
    "license": "MIT",
    "repository": "https://github.com/helloianneo/ian-xiaohei-illustrations",
    "sourceRevision": "cbf5ee2",
    "homepage": "https://github.com/helloianneo/ian-xiaohei-illustrations"
  }
}
```

### Manifest 规则

1. `world.id` 必须匹配 `^pgc\.[a-z0-9-]+$`（平台命名空间；用户 World 永不使用该前缀，避免冲突）。
2. `entities[].id` 为 slug（`[a-z0-9-]+`），**物化时直接用作本地 entity ID**。同一 manifest 在任何设备产生相同的行 ID 与 canonical 字节——这是同步幂等的基础。
3. `evidence[]` 只允许 `url`（v1）；`modality` 必须是 image/video/audio/text/research；`purpose`/`status`/`collection` 复用现有 closed 集合。
4. `kind='guide'` 的 `content` 契约：`{type: workflow|prompt_template|checklist|notes, body: string, appliesTo?: purpose[]}`；`body` 为 markdown。
5. 预算（构建期硬校验，物化期复核）：单 guide body ≤ 16KB；全 world guide body 合计 ≤ 48KB；evidence 条目 ≤ 200；manifest 文件 ≤ 2MB。
6. Manifest 不携带本地资产概念；不携带 `assetId`。资源真相 = 平台 CDN URL（构建期从源仓库镜像，见发布管线）。
7. 本地物化后的 canonical 序列化**复用既有 `computeCanonicalTx` 的同一套规则**（键排序、实体按 kind+id 排序、排除时间戳）——平台 World 与用户 World 的 revision 语义完全同构。

## 数据模型变更（layout v3 → v4）

沿用 `project.go` 的版本门禁与"additive + duplicate column 容忍"惯例，本次含一次小表重建：

```sql
-- 1. worlds：来源维度
alter table worlds add column origin text not null default 'user';
alter table worlds add column origin_meta_json text not null default '{}';

-- 2. world_asset_refs：URL 资源源 + unique 键重建
--    旧键 unique(world_id, entity_id, asset_id, role) 无法容纳
--    asset_id 为空（URL 行）的多个同 role 证据。SQLite 不能原地改约束，
--    在 Ensure() 内一次性重建（数据量小，迁移即复制，url 列补 ''）：
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

约束（`WorldStore` 写入路径强制）：

- `asset_id` 与 `url` **恰好一个**非空；URL 必须是绝对 `http(s)`。
- 本地 asset 源：沿用现有校验（存在、`completed`、modality 推导）。
- URL 源：`modality` 由 manifest/调用方声明，但必须属于 closed 集合；尝试性 HEAD 不强制（CDN 资源在构建期已验证）。
- `origin` 取值 `'user' | 'platform'`，创建后不可变更。

`origin_meta_json` 结构：

```json
{
  "version": "0.1.0",
  "manifestHash": "sha256:…",
  "catalogOrder": 1,
  "publishedAt": "2026-08-28T00:00:00Z",
  "syncedAt": "2026-08-28T02:11:03Z",
  "forkedFrom": { "worldId": "pgc.xiaohei", "revisionId": "…" }
}
```

`forkedFrom` 仅出现在 Fork 出来的用户 World 上（溯源展示用）；其余字段仅 `origin='platform'` 有。

## 同步协议

### Catalog v1

`cdn/worlds/catalog.json`（与 fonts/effects/releases 同桶同上传链）：

```json
{
  "catalogVersion": 1,
  "updated": "2026-08-28T00:00:00Z",
  "worlds": [
    {
      "id": "pgc.xiaohei",
      "version": "0.1.0",
      "manifestUrl": "https://cdn.recut.video/worlds/pgc.xiaohei/0.1.0/world.json",
      "sha256": "…",
      "bytes": 48213,
      "status": "active"
    }
  ]
}
```

- `status`：`active`（提供）/ `delisted`（下架，条目保留于目录以驱动本地归档）。
- 本地覆盖：`<dataRoot>/world-catalog.json` 存在时整体替代远端目录（与 `appstore.json` 同惯例），服务开发与企业私有化。
- 嵌入种子：`service/worldcatalog/catalog.json` + 各 manifest，经 `//go:embed` 进入二进制；首启或远端不可达时物化种子内容。

### 同步算法（daemon 内，单飞、幂等）

触发：daemon 启动（Catalog 读取前，与 `BuiltinAppManager.Ensure()` 同级）；运行期最多每 24h 一次后台同步。

```text
for entry in catalog.worlds (status == active):
  local := worlds[row where id = entry.id and origin = 'platform']
  if local?.originMeta.manifestHash == entry.sha256: continue        # 幂等门
  manifest := GET entry.manifestUrl (≤2MB, 60s timeout)
  if sha256(manifest) != entry.sha256: emit world.catalog.manifest_mismatch; continue   # 绝不物化
  if !validate(manifest): emit world.catalog.manifest_invalid; continue                 # schema/预算/ID 规则
  tx:
    upsert worlds(id=entry.id, origin='platform', origin_meta={version, manifestHash, catalogOrder, publishedAt, syncedAt})
    delete 该 world 当前未归档的 entities / relations / evidence 行
    insert manifest 的 entities / relations / evidence（ID 直接用 manifest 值）
    commitRevision(tx, reason='platform.sync', createdBy='platform')
  commit; emit world.platform.materialized {worldId, version, revisionId}
for entry in catalog.worlds (status == delisted):
  local active 平台 world → set archived_at（同样经 commitRevision）; emit world.platform.archived
# 目录中不存在的旧平台 world：不动（保守；由平台修订目录显式 delist）
```

性质：

- **幂等**：hash 门 + 确定性 ID + `commitRevision` 的 hash 去重 → 重复同步零 revision 变化；内容变化恰好一个 revision。
- **可追溯**：平台更新 = 一次 canonical revision，`created_by='platform'`、`reason='platform.sync'`；旧 Project binding 固定旧 revision，解析不受影响（既有 `validateSelectionCanonical` 语义）。
- **离线安全**：远端失败只影响更新；本地已有内容（种子或上次同步）继续服务。
- **无合并问题**：平台 World 对用户只读，本地永远不会出现"用户改动 vs 上游更新"的冲突——这是把同步做成"整事务替换"的前提。

## 写策略：只读 + Fork

### 只读门禁

`WorldStore` 所有变更入口（`UpdateWorld`、`UpsertEntity`、`AttachReference`、`ArchiveEvidence`、关系写入、覆盖等）在事务首步检查 `origin`：

```text
origin == 'platform' → 返回 WORLD_READ_ONLY
  details: { origin: "platform", hint: "fork", forkOperation: "recut.worlds.fork" }
```

- 新增错误码 `WORLD_READ_ONLY`（加入既有结构化错误集合；HTTP/MCP/SDK 同形状）。
- **不受限**：全部只读（list/get/entities/brief/resolve）、`bind_project` / `bindMediaJob`（引用 + 固定 revision，不修改 World）。
- Chat Agent 策略（写入 `service/skills/recut/SKILL.md` 的 Worlds 章节）：用户要求修改平台 World 时，Agent 说明只读并**提议 Fork**，经用户确认后调用 `recut.worlds.fork`，在副本上继续。

### Fork

```text
recut.worlds.fork
  input:  { worldId, name? }
  output: WorldDetail（新创建的用户 World）
```

- 平台 World 与用户 World 均可 Fork（后者是"从现有世界起步"的便捷入口；v1 UI 只对平台 World 暴露）。
- 在源 World 的 `current_revision_id` 快照上执行：复制 identity/entities（新本地 ID，关系重映射）/evidence（asset 或 url 原样）；`origin='user'`，`origin_meta.forkedFrom={worldId, revisionId}`。
- 副本与上游**彻底独立**：后续平台更新不传播（upstream sync/merge 列为非目标，见下）。
- Fork 是一次普通 revision（`reason='world.forked'`）；名称缺省沿用源 World。

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

`recut.worlds.references.attach` 接受 `assetId` 或 `url`（二选一）；`resolve` 与 `brief` 输出统一带 `source`。用户 World 因此也能引用外部 URL 资源（品牌指南、外部素材 lore），而无需先入库。

**`recut.media.import_url`**（新增，Phase 1）：把 URL 物化为本地 Asset 的官方桥梁——当生成 provider 只接受本地路径、或用户想把世界示例图收进自己素材库时使用：

```text
recut.media.import_url
  input:  { url, name?, projectId? }
  output: { assetId, name, kind, contentHash }   # 直接 completed；可选挂项目
```

约束：绝对 http(s)、≤25MB、mime 白名单（image/video/audio）、内容寻址去重。它让 URL 证据拥有"需要时本地化"的路径，同时**不强制**——canon 保持 URL 真相。

## guide 实体类型与 brief v1

### guide

`EntityKind` closed 集合增加 `guide`（用户界面名：**创作指引**；所有 World 类型的 `availableEntityKinds` 均包含）。content 契约与预算见 Manifest 规则 4/5。guide 是 Canon 的一部分（进入 revision），平台世界与用户世界同权。

### `recut.worlds.brief`（v1，本 RFC 范围内实施）

兑现 08-14 重构的读取入口决策，范围收敛为**只读投影**（actionableInputs/adaptations/conflicts 等高级能力仍归重构 RFC 后续阶段）：

```text
recut.worlds.brief
  input:  { worldId, revisionId?, selection?: WorldSelection }
  output: WorldBrief
```

```ts
type WorldBrief = {
  world: {
    id: string; name: string;
    origin: "user" | "platform";
    originMeta?: { version?: string; publishedAt?: string; forkedFrom?: { worldId: string; revisionId: string } };
    provenance?: { author?: string; license?: string; repository?: string; homepage?: string };
    revisionId: string; canonicalHash: string;
  };
  identity: Record<string, unknown>;
  facts: {
    characters: Array<Record<string, any>>;
    stories: Array<Record<string, any>>;
    locations: Array<Record<string, any>>;
    styles: Array<Record<string, any>>;
  };
  constraints: { always: string[]; never: string[]; prefer: string[] };
  guides: Array<{ id: string; title: string; type: string; body: string; appliesTo?: string[] }>;
  evidence: WorldAssetReference[];     // ≤100 条；带 source/assetId|url
  missing: Array<{ kind: string; title: string }>;  // v1 可为空数组
};
```

- 从与 `resolve` 相同的冻结 revision canonical 投影；guide body **内联**（实践层是 PGC 的核心载荷，二次取回会毁掉"一次调用可生产"的体验；预算在构建期封顶）。
- `selection` 语义同 `resolve`（storyId/entityIds/assetRoles/purpose）；`purpose` 命中 guide 的 `appliesTo` 时优先排序，不硬过滤。
- 尺寸预算：guide 合计 ≤48KB（构建期保证）、evidence ≤100 条、facts 字段截断规则沿用重构 RFC 的"按重要度排序"。
- `resolve` 保留为 App/运行时内部投影（输出同步增加 `source`/`url` 与 `guides`），不再是 Agent 首选入口。

### Chat 上下文物料

`creation_world` attachment 的服务端物料文本从"调用 get/list/resolve"改为：

```text
[Creation World] worldId=… name=… origin=platform|user revisionId=…
—— 调用 recut.worlds.brief({ worldId, selection: { purpose: "…" } }) 一次获取
身份、事实、规则、创作指引与证据。平台世界只读：用户要求修改时提议 recut.worlds.fork。
guides 是该世界的生产工作流：按其执行（先策略后生成、逐张生成、按质检清单复核）。
```

## 发布管线

### 仓库布局（官方仓库 `6174/recut`，新增顶层目录）

```text
worlds/
  README.md
  xiaohei/
    world.json          # Manifest v1（人工适配自 skill 仓库，可审阅、可 diff）
    README.md           # 来源、授权、适配说明、构建记录
```

### 构建脚本 `scripts/worlds-publish.mjs`

1. **校验**：schema、closed 集合、ID 规则、预算（guide body / evidence 数 / 文件大小）、`world.id` 前缀。
2. **资源镜像**：manifest 中每个 URL 资源下载至 `cdn/buckets/worlds/<id>/<version>/…`（内容寻址文件名；R2，与 fonts/effects 同桶；`make cd-upload` 发布）。manifest 内 URL 改写为 CDN 路径。
3. **哈希与 catalog**：计算 manifest SHA-256；合并生成 `cdn/buckets/worlds/catalog.json`（active + delisted 全量；`catalogOrder` 即数组下标）。
4. **本地预览**：`--check` 只校验并打印 canonical hash 预览（CI 可跑，防止格式漂移）。

版本规则：`worlds/<slug>/world.json` 任何语义变化 → `version` 递增（semver）；目录指向新版本；旧版本 CDN 对象保留不可变（已绑定 revision 的可复现性由本地 revision 承担，CDN 旧版保留仅为审计）。

### 小黑（xiaohei）的一次性适配

源仓库 `helloianneo/ian-xiaohei-illustrations`（MIT）是 **Skill 形态**（SKILL.md + references/ + assets/），适配为 Manifest v1 的映射：

| 源 | 目标 |
| --- | --- |
| `SKILL.md` 核心定位 | `world.identity` + description |
| `references/xiaohei-ip.md` | entity `character/xiaohei` + 若干 `rule`（禁止项） |
| `references/style-dna.md` | entity `style/style-dna` + `rule`（必须项/绝对不要项） |
| `SKILL.md` 工作流章节 | entity `guide/guide-workflow`（type=workflow） |
| `references/prompt-template.md` | entity `guide/guide-prompt-template`（type=prompt_template） |
| `references/qa-checklist.md` | entity `guide/guide-qa`（type=checklist） |
| `references/composition-patterns.md` | 并入 `guide-workflow` body 的"结构类型"小节（不单列，保持 guide 精简） |
| `assets/examples/*.png`（14 张） | evidence（url=CDN 镜像；entityId=xiaohei；collection=风格示例；status=supporting） |

**适配纪律**：guide body 中的宿主相关表述必须改写为宿主无关 + Recut 映射——"内置 `image_gen`" → "当前宿主的图片生成工具（在 Recut 中为 `recut.image.generate`）"；"保存到 `assets/<slug>-illustrations/`" → "生成结果入库 Recut 素材库（`recut.media.import_url` 或直接生成入库）"。v1 不做 SKILL.md 自动解析：人工适配一次性、可审阅，自动转换器是后续话题。

### 授权与治理

- 平台 World 源仓库必须允许再分发（小黑为 MIT，允许）；`provenance.license` 必填，World 详情页与来源卡片展示。
- 目录与 manifest 只能由官方 CI 写入；个人/第三方 PGC 投稿不在 v1 范围（World Store 列为后续）。

## 产品与 UI 契约

1. **Worlds Tab**：列表分两段——"平台世界"（顶置，按 `catalogOrder` 稳定排序，条目带 **平台** 徽标）与"我的世界"（现行为不变）。
2. **WorldPicker**（Chat @ 引用与创作入口）：平台段固定置顶 + 徽标 + 一句话描述；type 筛选在两段内各自生效；平台世界不随用户列表的 updated_at 漂移。
3. **平台 World 详情页（只读）**：
   - 无编辑/删除/归档/移除证据入口（不是视觉隐藏，是 API 门禁 + UI 不渲染）；
   - **来源卡片**：作者、许可证、源仓库链接、版本号、最近同步时间、`forkedFrom`（Fork 副本上）；
   - 主 CTA `开始创作`（既有绑定/创作流程）；次 CTA `Fork 为我的世界`（调用 `recut.worlds.fork`，成功后跳转到新 World）；
   - evidence 图片直接以 `<img src={url}>` 渲染（CDN 远程图，复用 AssetPreview 的降级占位）；
   - 已下线（delisted/archived）平台 World：列表与 picker 不显示，详情页展示"已下线"态。
4. **更新提示**：平台 World 产生新 revision 后，"开始创作"范围预览显示"设定已有更新，是否采用最新版"（复用 08-14 重构设计；不构建推送）。
5. **i18n**：平台世界 / 创作指引 / Fork 为我的世界 / 已下线 等词条进 zh/en 字典。

## Agent 契约（`service/skills/recut/SKILL.md` Worlds 章节增补）

- `recut.worlds.brief` 是读取 World 的默认单次入口；平台 World 的 `guides` 是生产工作流（playbook）：有 guide 的世界按其工作流执行（例如小黑：先出 shot list，再逐张生成，按质检清单复核后才交付）。
- 平台 World 只读：`WORLD_READ_ONLY` 不是失败，是边界——按错误 details 提议 Fork。
- `source: "url"` 的证据：provider 接受 URL 时直接引用；需要本地文件/入库时调用 `recut.media.import_url`。
- 示例类 evidence（`collection`/`label` 标注为案例）只作低频视觉校准，默认生成路径不依赖它们（小黑 guide 内已声明，Skill 层不重复）。

## 非目标

- 用户 World 的跨设备/云端同步与多端一致性（PGC 仅平台→用户单向）。
- Fork 与上游的 sync/merge（git 式更新采纳）。
- 第三方 PGC 投稿、World Store、World 间推荐位。
- Ed25519 manifest 签名（v1 = TLS + 目录 SHA-256 + CDN 只写权限）。
- brief 的 `actionableInputs`/`adaptations`/`conflicts`/模型能力降级（08-14 重构后续阶段，本 RFC 不扩大）。
- SKILL.md / 任意 Skill 仓库的自动转换（v1 人工适配 + 显式 world.json）。
- 平台 World 的本地"部分编辑覆盖"（要么只读，要么 Fork 整本）。

## 分阶段交付

- **P0 契约冻结**：Manifest v1、Catalog v1、brief v1 输出、`WORLD_READ_ONLY`、`fork`、Evidence 双源字段。本 RFC 获批即 P0 完成。
- **P1 service**：
  1. schema v4（origin/origin_meta、world_asset_refs 重建 + url 列、layout 4 与备份策略）；
  2. guide kind（closed 集合、canonical、`availableEntityKinds`）；
  3. 只读门禁 + `fork`（HTTP `POST /v1/worlds/{id}/fork` + MCP）；
  4. `brief`（HTTP `POST /v1/worlds/{id}/brief` + MCP `recut.worlds.brief`）；
  5. worldcatalog（嵌入种子 + 远端目录 + 本地覆盖 + 同步器 + 事件）；
  6. `recut.media.import_url`；
  7. Chat 上下文物料改指向 brief；
  8. 全量单测/集成（见测试矩阵）。
- **P2 web**：平台段与徽标、只读详情 + 来源卡片 + Fork CTA、远程图渲染、picker 平台段、i18n。
- **P3 内容与 E2E**：官方仓库 `worlds/xiaohei`（人工适配 world.json）+ `scripts/worlds-publish.mjs` + CDN 上传 + catalog 发布；真实会话验收（见验收标准 2）。
- **P4 后续**：签名、第三方投稿、Fork sync、brief 高级能力（随 08-14 重构）。

## 测试矩阵

| 层 | 必测 |
| --- | --- |
| Materializer | 同 manifest 两次同步 → 零新 revision（幂等）；内容变化 → 恰好一个新 revision（`reason=platform.sync`）；确定性：两个空 daemon 物化同 manifest → canonical hash 相同；hash 不符 → 拒物化 + 事件；schema/预算违规 → 拒物化 + 事件；delist → 归档 + revision；恢复 active → 去归档 |
| 只读与 Fork | 平台 World 的每个写入口（update/upsert/attach/archive/relations）返回 `WORLD_READ_ONLY` 且 details 含 fork 指引；binding 允许；fork 产物 `origin=user`、`forkedFrom` 正确、可完整编辑；平台后续更新不传播到 fork；fork 平台已下线世界仍可用 |
| Evidence 双源 | asset 与 url 二选一强制；url 行 modality/purpose 校验；resolve/brief 输出 `source` 正确；`world_asset_refs` 重建迁移后旧数据完整、唯一键行为正确；同一 entity 两条同 purpose 的 URL 证据可共存（旧键下不可能） |
| brief | guide 内联且按 `appliesTo` 排序；evidence ≤100；revision 固定（后编辑不改旧 revision brief）；selection 过滤与 resolve 一致；预算超限 manifest 被物化期拒绝 |
| import_url | 白名单/大小/去重（同 contentHash 不重复入库）；失败（404/超限/非白名单）结构化错误；可选挂项目 |
| Web | picker 平台段置顶稳定序；平台详情无写入口；Fork 跳转；远程图占位降级；delisted 不出现 |
| Chat E2E | `@pgc.xiaohei` 物料文本指向 brief；Agent 一次 brief 获得 character/style/rules/guides/evidence；按 guide 产出 shot list → `recut.image.generate` 逐张生成 → 交付 |
| 回归 | 用户 World 创建/编辑/绑定/revision 冲突行为不变；无平台 World 的干净安装（删除种子场景）Worlds 功能正常；`make check` 全绿 |

## 可观测性

新增事件（仅 ID/版本/哈希，不含 canon 正文）：

```text
world.catalog.synced            { worldIds, added, updated, delisted, skipped }
world.catalog.sync_failed       { reason: network | hash_mismatch | invalid_manifest }
world.catalog.manifest_mismatch { worldId, expectedHash, actualHash }
world.platform.materialized     { worldId, version, revisionId }
world.platform.archived         { worldId }
world.forked                    { fromWorldId, toWorldId, fromRevisionId }
```

## 开放问题

1. **Catalog 域名**：建议直接走 R2（`cdn.recut.video/worlds/…`，与 fonts/effects/releases 同链路）；若未来需要边缘逻辑再迁 Worker。
2. **coverUrl 是否必填**：建议可选；缺省时列表卡片用类型图标 + 首个 image evidence 缩略图。
3. **用户 World 的 Fork 入口**：能力上允许（模板化起步），v1 UI 只对平台 World 暴露入口。
4. **平台更新对已绑定项目的提示时机**：沿用 08-14 重构"创作范围预览时提示"，不做主动推送；是否需要"查看设定变更 diff"页面留待重构 Phase 2 的变更历史。

## 验收标准

1. **首启即有**：全新安装（含离线，用种子）启动后，Worlds 列表与 Chat @ 引用中即出现带"平台"徽标的小黑世界；无需任何安装/更新动作。
2. **系列图闭环**：全局 Chat `@小黑怪诞正文配图` + 一篇中文文章 → Agent 一次 `brief` 获得小黑 IP、风格 DNA、规则、三份 guide 与示例图 URL → 输出 4–8 张 shot list → 逐张 `recut.image.generate` → 按 qa 清单复核 → 交付素材深链；全程未调用任何 World 写工具。
3. **只读是硬边界**：对平台 World 的任何写操作（UI、HTTP、MCP、App ctx）都返回 `WORLD_READ_ONLY`；Agent 收到该错误后提议 Fork；Fork 后的副本可完整编辑且不再随平台更新。
4. **更新可追溯**：发布小黑 0.2.0 后，daemon 同步恰好产生一个新 revision；旧 Project binding 解析出的 brief 与更新前逐字节一致；新创作提示"设定已有更新"。
5. **篡改不可物化**：修改 CDN manifest 任意字节（目录 hash 不匹配）→ 本地内容保持不变，仅记录 mismatch 事件。
6. **一致性**：两个全新 daemon 物化同一 manifest 后，`pgc.xiaohei` 的 canonical hash 相同；用户 World 的全部既有行为（含 revision 冲突、binding、archive）零回归。

## 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 平台单点：CDN 不可达时用户看不到平台世界 | 嵌入种子保证首启；更新失败静默降级本地；世界本身是本地行，离线可继续引用 |
| 整事务替换对大 world 的写放大 | 平台 world 规模受预算约束（evidence ≤200、manifest ≤2MB）；事务在毫秒级；24h 频率 + hash 门使实际写入极少 |
| guide 内联撑大 Agent 上下文 | 构建期 48KB 硬预算 + `appliesTo` 排序；brief 是单次入口的代价由预算封顶控制 |
| URL 资源失链（源仓库删除） | 资源在发布期镜像到平台 CDN（CDN 对象不可变、长期保留）；manifest 只引用 CDN；构建期 HEAD 全量验证 |
| 用户期望"微调"平台世界 | 只读 + Fork 是唯一路径，错误文案直接给出 fork 操作；后续再评估"局部覆盖层" |
| 与 08-14 重构的范围重叠 | 本 RFC 只实施重构中已决策的 brief 读取入口（v1 收敛版）与 Evidence 生命周期中的 URL 源；重构的 propose/apply、completeness 表单等不受影响、不重复设计 |

## 结论

PGC World 不需要第二套 World 架构：它需要的是给现有 WorldStore 补上**来源维度**（origin + 云端目录同步）、**资源维度**（URL 证据源）与**实践维度**（guide + brief）。三者都是对既有模型的加法，且每一项对纯用户 World 同样成立——这正说明补的是模型缺口，不是 PGC 特例。小黑是第一个实例，验证的是整条管线：源仓库 → Manifest → CDN/目录 → daemon 同步 → 本地 revision → Chat @ 引用 → guide 驱动的系列图生产。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
