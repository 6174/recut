<!--
 * [INPUT]: 依赖 rfc/2026-09-07-recursive-world-canvas.md 的目标模型与数据结构设计，以及现有
 *   service/worlds.go、service/worlds_http.go、service/worlds_mcp.go、service/project.go（schema）、
 *   web/app/worlds/[worldID]/（world-detail-client / world-detail-settings / world-detail-panels）、
 *   web/lib/recut-worlds-client.ts、web/lib/worlds-store.ts、web/lib/i18n/workspace-worlds-dict.ts
 * [OUTPUT]: Recut World 无限画布的详细执行计划：分步任务、触及文件、接口契约、验收点与 MVP 里程碑
 * [POS]: rfc 的执行计划 companion；实现时以本文件为任务清单，反向更新本文件与主 RFC 保持同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# 执行计划：Recut World 无限画布 MVP

- 状态：已批准执行
- 作者：Recut
- 日期：2026-09-07
- 关联：[Recursive World Canvas RFC](./2026-09-07-recursive-world-canvas.md)
- 目标：**约 6 天拿到一个可交互的无限画布 MVP**，数据全持久化、Agent 可读可写，在此骨架上迭代。
- 原则：数据结构按「基石」从零设计，不为早期用户做兼容约束；每步有可运行验收点，可独立交付。

## 里程碑总览

```text
Step 0 工作区骨架   (0.5 天)   tldraw 可用空白画布 + 「画布」Tab
Step 1 数据结构落地 (1.5 天)   schema + WorldStore 新能力 + 单测
Step 2 递归容器     (1 天)     create_child / promote / relations CRUD + 层级 UI
Step 3 画布 MVP     (2 天)     Entity 卡 + 关系边 + 自由元素 + 持久化 + 交互
Step 4 Promote 闭环 (1 天)     便签→实体、箭头→关系，产 revision
─────────────────────────────────────────────────────────────
MVP 里程碑 (~6 天)  可放实体、连语义关系、加自由便签/图片、进入递归容器、Promote 成 Canon
```

依赖链：Step 1 依赖 Step 0（tldraw 决定画布表是否走自定义 shape）；Step 2 依赖 Step 1 的 schema；Step 3 依赖 1+2；Step 4 依赖 3。

---

## Step 0 — 工作区骨架（0.5 天）

**目标**：详情页出现「画布」入口，tldraw 能 mount 一个可用空白画布。先验证 tldraw 与 Next 16 / React 19 的兼容性，若引入成本过高则用受约束 SVG 手绘投影兜底（决策点 D1）。

**任务**

1. `web/app/worlds/[worldID]/world-detail-client.tsx`：在 Tab 列表（skill / 各 kind / resource）增加 `canvas` 选项，渲染画布容器组件。
2. 新建 `web/app/worlds/[worldID]/world-canvas.tsx`：最小 tldraw 集成——`Tldraw` 组件 + 本地 store，验证拖拽/缩放/选择可用。
3. `web/package.json`：引入 `@tldraw/tldraw`（先评估 bundle 与 React 19 兼容；D1）。

**验收**

- [ ] 打开世界详情，能看到「画布」Tab，切进去是一个可拖拽、可缩放、可选择的空白画布。
- [ ] `web` typecheck 通过（`npx tsc --noEmit` 或仓库既有 lint 命令）。

**涉及文件**

- `web/package.json`（依赖）
- `web/app/worlds/[worldID]/world-detail-client.tsx`（Tab 入口）
- `web/app/worlds/[worldID]/world-canvas.tsx`（新，画布容器）

---

## Step 1 — 数据结构落地（1.5 天）

**目标**：schema 与 WorldStore 具备表达「递归容器 / 局部子图 / 类型目录 / 画布元素」的能力，单测绿。这是模型基石的落地，优先于任何 UI。

**任务**

1. **schema**（`service/project.go`）：
   - `world_entities` 加 `parent_id`（自引用外键）、`container_role`、`is_provisional`。
   - `world_relations` 加 `scope_entity_id`（外键到 entity）。
   - 新表 `world_entity_types`（预设 type 目录 + 自定义）。
   - 新表 `world_canvas`（画布元素，entity 骨干 + 自由元素）。
   - 提升 `currentLayoutVersion`（如 "4"→"5"）并按既有备份/兼容策略处理。
2. **WorldStore**（`service/worlds.go`）：
   - 新增 `worldRelationTypes` 受控词表常量（People/World/Video/Story 四组）。
   - 新增 type 目录读写：`EnsurePresetEntityTypes`（seed 预设）、`UpsertEntityType`、`ListEntityTypes`；`UpsertEntity` 对未知 type 自动创建极简默认 type（name+description）。
   - 新增 `world_canvas` 读写：`UpsertCanvasElement`、`ListCanvasElements`（按 context_id）。
   - `getEntity` / `computeCanonicalTx` 接入新规则：草稿跳过、携带 parentId、局部关系跳过、忽略 canvas/types。
3. **HTTP**（`service/worlds_http.go`）：新增 `/v1/worlds/{id}/entity-types`（GET/POST）、`/v1/worlds/{id}/canvas`（GET/POST）。
4. **MCP**（`service/worlds_mcp.go`）：注册 `entityTypes.upsert/list`、`canvas.upsert` 工具（写工具仍要求显式用户意图）。
5. **单测**：`service` 新增用例（type 自动创建、canvas 不产 revision、canonical 规则）。

**验收**

- [ ] `go test ./service` 全绿（新增用例覆盖 type/canvas/parent/provisional）。
- [ ] 通过 REST 能建自定义 type、建实体、写画布元素并读回。

**涉及文件**

- `service/project.go`（schema + layout version）
- `service/worlds.go`（WorldStore + 词表 + canonical）
- `service/worlds_http.go`（REST）
- `service/worlds_mcp.go`（MCP）
- `service/worlds_test.go` 等（测试）

---

## Step 2 — 递归容器（1 天）

**目标**：实体层级可建、可浏览、可返回；局部关系可建。

**任务**

1. **WorldStore**（`service/worlds.go`）：`CreateChildEntity`（带 parent_id）、`PromoteEntity`（is_provisional→0 产 revision）、`CreateRelation`/`ListRelations`（带 scope_entity_id）。
2. **HTTP**（`service/worlds_http.go`）：`POST /v1/worlds/{id}/entities/{entityID}/children`、`POST /v1/worlds/{id}/entities/{entityID}/promote`、`POST/PUT /v1/worlds/{id}/relations`。
3. **web client**（`web/lib/recut-worlds-client.ts`）：扩展 `WorldEntity` 类型（parentId/children/provisional），新增 client 方法。
4. **web UI**（`world-detail-client.tsx` / `world-detail-panels.tsx`）：在实体详情增加「子实体」区，支持进入子实体局部视图 + Breadcrumb 返回；表单增加「父实体」选择。

**验收**

- [ ] 在「梁启超」下建「家族」，在家族下建「梁思成」，层级可浏览、可返回。
- [ ] 能建一条局部关系（scope_entity_id），它不出现在全局 canonical。

**涉及文件**

- `service/worlds.go`、`service/worlds_http.go`、`service/worlds_mcp.go`
- `web/lib/recut-worlds-client.ts`、`web/lib/worlds-store.ts`
- `web/app/worlds/[worldID]/world-detail-client.tsx`、`world-detail-panels.tsx`

---

## Step 3 — 画布 MVP（2 天）

**目标**：画布承载实体卡 + 关系边 + 自由元素，`world_canvas ↔ tldraw` 双向同步，拖线建关系、拖图加证据。

**任务**

1. **自定义 shape/binding**（`world-canvas.tsx` 内）：`RecutEntityShape`（持 entityId，渲染时拉语义）、`RecutRelationBinding`（从 `world_relations` 派生，只读投影）。
2. **同步层**（新建 `web/lib/world-canvas-sync.ts`）：tldraw Store ↔ `world_canvas`（entity 骨干位置/自由元素 props 双向同步，防抖写、读时投影）。
3. **自由元素**：接入 tldraw 原生 text/shape/image/arrow，映射到 `world_canvas` 的 props_json/style_json；`image` 经 `recut.media.list_assets` 引用全局素材。
4. **交互**：
   - 从实体拖线 → 弹出受控关系类型选择 → 写 `world_relations`，画布边刷新（不新增 arrow 元素）。
   - 拖图片到实体 → 识别为 Evidence（`evidence.attach`），不自动建边。
   - 有子实体的容器卡显示可进入标记，双击进入容器画布。
5. **web client**（`recut-worlds-client.ts`）：`canvas.list/upsert`、`relations.create/list` 方法。

**验收**

- [ ] 画布上摆实体卡、拖线选关系建 `world_relations`、放便签/图片，刷新后全部保留。
- [ ] 语义边只在 `world_relations`，删除边删除关系，无孤儿画布边。
- [ ] 双击实体卡进入其容器画布并可返回。

**涉及文件**

- `web/app/worlds/[worldID]/world-canvas.tsx`（核心，扩展为完整画布）
- `web/lib/world-canvas-sync.ts`（新）
- `web/lib/recut-worlds-client.ts`、`web/lib/worlds-store.ts`
- `service/worlds.go`、`service/worlds_http.go`（如 canvas 读写需补齐）

---

## Step 4 — Promote 闭环（1 天）

**目标**：画布草稿可提升为正式语义对象，产 revision；Agent 写回走既有门禁。

**任务**

1. **WorldStore**：`PromoteCanvasElement`（便签→Entity 含默认 type；箭头连到两个 entity 元素→`world_relations`）。
2. **HTTP/MCP**：`POST /v1/worlds/{id}/canvas/{elementID}/promote`、`recut.worlds.canvas.promote`。
3. **web UI**：画布选中草稿 → `Promote to World` 按钮 → 置正式、原画布元素保留为投影、revision 递增。
4. **readiness**（`service/worlds_readiness.go`）：`entitySubstantive` 忽略 `is_provisional=1`。
5. **Agent**：MCP 工具描述补 Agent 引导（草稿 Promote 是显式用户确认动作）。

**验收**

- [ ] 便签 Promote 成实体、箭头 Promote 成关系，`current_revision_id` 递增。
- [ ] readiness 不计草稿。
- [ ] Agent 通过 `recut.worlds.canvas.promote` 可执行提升（用户确认后）。

**涉及文件**

- `service/worlds.go`、`service/worlds_http.go`、`service/worlds_mcp.go`
- `service/worlds_readiness.go`
- `web/app/worlds/[worldID]/world-canvas.tsx`

---

## 决策点（D1–D4）

| # | 决策 | 默认倾向 | 何时定 |
| --- | --- | --- | --- |
| D1 | tldraw 引入成本（bundle/React19） | 若 bundle >~500KB 或 React19 报错，先用受约束 SVG 手绘投影，tldraw 留 P1 | Step 0 结束 |
| D2 | type 目录作用域 | 全局预设模板 + World 内覆盖副本（scope=preset/builtin + builtin 标记） | Step 1 中 |
| D3 | parent 单父/多父 | MVP 单父（树状容器），多父 DAG 留 P2 | Step 2 前 |
| D4 | 自由元素 Promote 粒度 | 提升后原画布元素保留为投影，不删除 | Step 4 前 |

## 开放问题（自主 RFC 沿袭）

1. 局部子图进 `brief`/`resolve` 的携带深度：按 selection 显式选择，避免大世界观塞满请求。
2. 画布元素跨设备同步：本地单用户 MVP 存本地即可，协作再定。

## 完成定义（DoD）

MVP 达成 = Step 0–4 验收点全部打勾，且满足：

- [ ] 无限画布可用：实体卡 / 语义边 / 自由便签图片 / 递归进入 / Promote 全部可操作。
- [ ] 数据全持久化，刷新不丢；语义真相只在 `world_entities` + `world_relations`。
- [ ] `world_canvas` / `world_entity_types` 不产 revision。
- [ ] Agent（MCP）能读递归层级、type 目录、画布元素，并在用户确认后写与 Promote。
- [ ] `go test ./service` 与 web typecheck 全绿。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md