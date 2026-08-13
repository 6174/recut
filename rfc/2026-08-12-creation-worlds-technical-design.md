<!--
 * [INPUT]: 依赖 RFC 2026-08-12 Creation Worlds 的产品与公共契约，以及现有 service AppHost、workspace.sqlite、MCP Host、iframe SDK 和 Remotion workflow.context
 * [OUTPUT]: 定义 Creation Worlds 的实现模块、SQLite 迁移、全局 SDK/MCP facade、权限、HTTP 路由、UI 路由、Remotion 接入、测试与分阶段提交顺序
 * [POS]: rfc 的技术实施蓝图；在产品 RFC 获批后作为 Go service、web、内置 App 与测试的共同落地契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# Technical RFC: Creation Worlds Implementation Design

- 状态：提议
- 依赖：[Creation Worlds 产品 RFC](2026-08-12-creation-worlds.md)
- 日期：2026-08-12
- 目标版本：Phase 1–2

## 1. 范围与不变量

本 RFC 只定义如何把 Creation Worlds 接入当前 Recut 代码库；产品定义、用户语言和范围取舍以产品 RFC 为准。

实现必须保持下列不变量：

1. 一个用户可以创建多个 World。所有外部引用均使用显式 `worldId`；没有 global active world。
2. `World → Entity` 是强归属关系；`entityId` 必须与 `worldId` 一起验证。
3. Asset 的内容与媒体生命周期仍由 `workspace.sqlite` / MediaService 管理；World 仅保存语义引用。
4. World 业务记录归 owner；Project/Job/Artifact 到 World revision 的关联归平台。
5. App 不读取其他 App 的 SQLite 或文件。所有跨 App World 读取经过平台 facade。
6. 已有无 World Project、App 和 MCP 调用的行为零变化。

## 2. 组件与所有权

```text
web /worlds + Studio Worlds section + Chat attachments
             │ HTTP / iframe host message
             ▼
service WorldsFacade ── public SDK / HTTP / global MCP tools
  ├── WorldStore       ── workspace.sqlite: worlds, entities, revisions, refs
  ├── ContextBindingStore ── workspace.sqlite: project/job/artifact references
  ├── AppHost ctx.creationContext capability
  └── Agent attachment resolver
             │
             ▼
Production App (Remotion first)
  workflow.context → CreationContext or null
```

### 2.1 Final ownership decision

产品 RFC 用 standalone App 作为低风险切入方案；技术上不应让平台 facade 通过 `AppHost.InvokeMCP` 回调一个 owner App 来完成每次读取。这样会引入运行时注册依赖、二次 schema、错误边界不清和初始化循环。

**Phase 1 采用平台拥有的 `WorldStore`。**它仍不是一个可被任何 App 任意 SQL 查询的“全局业务库”：只有 service 内 `WorldsFacade` 能访问它。`recut.creation-worlds` 作为系统 UI bundle / manifest 身份存在，但其 `background.js` 写操作也调用同一 facade。

好处：

- `recut.worlds.*` 是真正全局 SDK/MCP API，不需要隐藏的 owner-App RPC。
- binding 与 revision 可在一个 SQLite transaction 中固化。
- 未来把系统 App 从 standalone 切为 manifest `type: system` 不搬迁数据。
- 依然保证 App 隔离：普通 `ctx.sqlite` 永远看不到 `world_*` 表。

这是对产品 RFC“业务表归 Creation Worlds owner”的实现性收敛：owner 是 **Recut system service**，不是第三方 App 的 appstate。

## 3. 数据库设计

### 3.1 workspace.sqlite schema

在 `Store.Ensure()` 的 schema 初始化中追加以下表及索引。当前 layout 采用版本门禁而非历史迁移；发布该变更时提高 `currentLayoutVersion` 并提供显式的数据备份/兼容策略，不能在用户启动时静默丢弃历史工作区。

```sql
create table if not exists worlds (
  id text primary key,
  name text not null,
  type text not null,
  description text not null default '',
  identity_json text not null default '{}',
  cover_asset_id text,
  current_revision_id text,
  created_at text not null,
  updated_at text not null,
  archived_at text
);
create index if not exists worlds_updated on worlds(updated_at desc);
create index if not exists worlds_type on worlds(type, updated_at desc);

create table if not exists world_entities (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  kind text not null,
  title text not null,
  summary text not null default '',
  content_json text not null,
  created_at text not null,
  updated_at text not null,
  archived_at text
);
create index if not exists world_entities_world_kind on world_entities(world_id, kind, updated_at desc);
create index if not exists world_entities_world_title on world_entities(world_id, title collate nocase);

create table if not exists world_relations (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  from_entity_id text not null references world_entities(id) on delete cascade,
  to_entity_id text not null references world_entities(id) on delete cascade,
  relation_type text not null,
  metadata_json text not null default '{}',
  created_at text not null,
  unique(world_id, from_entity_id, to_entity_id, relation_type)
);
create index if not exists world_relations_world_from on world_relations(world_id, from_entity_id);
create index if not exists world_relations_world_to on world_relations(world_id, to_entity_id);

create table if not exists world_asset_refs (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  entity_id text references world_entities(id) on delete cascade,
  asset_id text not null,
  role text not null,
  label text not null default '',
  sort_order integer not null default 0,
  created_at text not null,
  unique(world_id, entity_id, asset_id, role)
);
create index if not exists world_asset_refs_world on world_asset_refs(world_id, entity_id, sort_order);
create index if not exists world_asset_refs_asset on world_asset_refs(asset_id);

create table if not exists world_revisions (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  canonical_json text not null,
  canonical_hash text not null,
  reason text not null,
  created_by text not null,
  created_at text not null,
  unique(world_id, canonical_hash)
);
create index if not exists world_revisions_world on world_revisions(world_id, created_at desc);

create table if not exists creation_context_bindings (
  id text primary key,
  target_type text not null,
  target_id text not null,
  world_id text not null references worlds(id),
  revision_id text not null references world_revisions(id),
  selection_json text not null,
  role text not null,
  created_at text not null,
  unique(target_type, target_id, role)
);
create index if not exists creation_context_bindings_target on creation_context_bindings(target_type, target_id);
create index if not exists creation_context_bindings_world on creation_context_bindings(world_id, revision_id);
```

### 3.2 Referential validation

SQLite foreign keys are defense in depth, not the only validation. `WorldStore` must verify before every write:

- `world.type` and `entity.kind` belong to closed allowlists.
- Entity supplied in a relation, selection or reference belongs to the same `worldId`.
- `assetId` exists and is `completed` before `world_asset_refs` insert.
- `revisionId` belongs to the requested World.
- A `project` binding target exists and target app owns the request.

All mutating calls execute in one immediate transaction: mutate records → recompute Canon → insert revision if semantic hash differs → update `worlds.current_revision_id` → commit. No API response may expose an entity write without a committed revision.

### 3.3 Canonical serialization

`canonical_json` uses a private deterministic structure:

1. Map keys sorted recursively.
2. Entities sorted by `kind`, then ID.
3. Relations and references sorted by their stable IDs.
4. Timestamps, UI ordering and derived count fields excluded.
5. Serialize UTF-8 compact JSON; SHA-256 bytes produce `canonical_hash`.

The public `CreationContext` is projected from canonical data and selection. Never hash a natural-language prompt, browser state or model-specific formatting.

## 4. Go service modules

Add a narrowly scoped subsystem; do not make `project.go`, `mcp.go` or `runtime.go` each grow a private implementation.

```text
service/
  worlds.go               domain types + WorldStore read/write/query APIs
  worlds_context.go       canonical projection, selection validation, binding APIs
  worlds_http.go          /v1/worlds HTTP handlers
  worlds_mcp.go           global MCP definitions and dispatch helpers
  worlds_test.go          store/unit/transaction/revision tests
  worlds_mcp_test.go      MCP schemas, dispatch, errors, structuredContent tests
```

Every new Go source file starts with the L3 INPUT / OUTPUT / POS / PROTOCOL header; `service/README.md` must list these files.

### 4.1 Public service types

```go
type WorldKind string
const (
  WorldCharacterIP WorldKind = "character_ip"
  WorldCreatorBrand WorldKind = "creator_brand"
  WorldBrand WorldKind = "brand"
  WorldFiction WorldKind = "fiction_world"
  WorldCustom WorldKind = "custom"
)

type WorldEntityKind string
type WorldSelection struct {
  StoryID string `json:"storyId,omitempty"`
  EntityIDs []string `json:"entityIds,omitempty"`
  AssetRoles []string `json:"assetRoles,omitempty"`
  Purpose string `json:"purpose"`
}
type CreationContext struct {
  World WorldContextIdentity `json:"world"`
  Selection WorldSelection `json:"selection"`
  Identity map[string]any `json:"identity"`
  Entities ResolvedWorldEntities `json:"entities"`
  Constraints WorldConstraints `json:"constraints"`
  References []WorldAssetReference `json:"references"`
}
type CreationContextBinding struct { /* ID, target, world, revision, selection, role */ }
```

`WorldStore` accepts `*Store` and `*MediaService`; it never accepts an `AppHost`, raw HTTP Request or MCP session. This keeps it unit-testable and removes cyclic dependencies.

### 4.2 Error transport

Use a typed `WorldsError{Code, Message, Details}`. HTTP writes `{ "error": { "code", "message", "details" } }`; MCP returns a text/structured error result consistent with existing host behavior; SDK adapter rejects with the same shape. Do not use Go error strings as a compatibility surface.

## 5. Global SDK and HTTP facade

### 5.1 Service HTTP routes

Register routes before generic App routes in `NewServer`:

```text
GET    /v1/worlds?text=&type=&cursor=&limit=
POST   /v1/worlds
GET    /v1/worlds/{worldID}
PATCH  /v1/worlds/{worldID}
GET    /v1/worlds/{worldID}/entities?kind=&text=&cursor=&limit=
POST   /v1/worlds/{worldID}/entities
GET    /v1/worlds/{worldID}/entities/{entityID}
PATCH  /v1/worlds/{worldID}/entities/{entityID}
POST   /v1/worlds/{worldID}/references
POST   /v1/worlds/{worldID}/resolve
GET    /v1/projects/{projectID}/world-context
PUT    /v1/projects/{projectID}/world-context
```

The route resource spelling is RESTful (`/v1/worlds`); the SDK and MCP use namespaced capability spelling (`recut.worlds.*`). Each handler only decodes/encodes/authorizes; it calls `WorldStore` or `ContextBindingStore` and contains no canonical logic.

### 5.2 SDK exposure

There is no current browser-safe general Recut SDK. This RFC establishes **`recut.worlds`** as the stable global SDK namespace; implementation provides it through two controlled adapters, with identical request/response types:

1. **Host/global SDK:** `@recut/sdk` exports `recut.worlds`. Its service transport calls the HTTP facade and is available to Recut-native code and trusted host integrations.
2. **App background capability adapter:** `ctx.worlds` is the permission-scoped implementation of the same `recut.worlds` contract, injected by `AppHost.context` when the manifest declares `worlds.read` or `worlds.write`.
3. **Native web client:** `web/lib/recut-worlds-client.ts` is the browser transport adapter used only by native Recut pages (`/worlds`, Studio, Chat attachment picker), never by an App iframe.

```ts
// @recut/sdk — global contract; direct transport only in trusted host code.
import { recut } from "@recut/sdk";
const worlds = await recut.worlds.list({ type: "fiction_world", limit: 20 });
const mina = await recut.worlds.entities.get({ worldId: "cw_01", entityId: "ent_mina" });

// App background.js — same methods, narrowed by manifest permissions.
recut.operation.register("scene.prepare", (input, ctx) =>
  ctx.worlds.resolve({ worldId: input.worldId, selection: { purpose: "video" } }),
);
```

The root `recut` object inside `background.js` remains reserved for handler registration. Therefore App code uses `ctx.worlds`, not an unrestricted global `recut.worlds`; this distinction prevents a manifest-free backdoor to platform data while preserving the same method and schema contract.

```ts
// background.js, only after manifest permission check
ctx.worlds.list({ text, type, cursor, limit });
ctx.worlds.get({ worldId });
ctx.worlds.entities.list({ worldId, kind, text, cursor, limit });
ctx.worlds.entities.get({ worldId, entityId });
ctx.worlds.resolve({ worldId, revisionId, selection });

// only with worlds.write
ctx.worlds.create(input);
ctx.worlds.update(input);
ctx.worlds.entities.upsert(input);
ctx.worlds.references.attach(input);

// Project target + worlds.bind only
ctx.creationContext.get();
ctx.creationContext.bindProject(input);
```

`ctx.worlds` is the runtime form of `recut.worlds.*`; it does not expose `ctx.sqlite`. For UI-to-App calls, the iframe continues using its own manifest operation via the existing postMessage host router. No iframe receives a bearer token or raw global SDK.

### 5.3 Manifest permissions

Extend manifest validation with closed permissions:

```text
worlds.read   list / get / entity list-get / resolve
worlds.write  create / update / entity upsert / attach reference
worlds.bind   bind a World to the current owner Project
```

`worlds.write` implies `worlds.read`; `worlds.bind` implies `worlds.read`; the system Worlds UI receives all three. Production apps initially request `worlds.read` and `worlds.bind`; they do not get `worlds.write` by default.

## 6. Global MCP implementation

### 6.1 Registration

`platformMCPToolDefinitions()` adds Worlds tools unconditionally, alongside `recut.project.*` and `recut.media.*`. They must not appear in per-App tool groups because Chat and external agents need discovery before choosing an App.

```go
worldsMCPToolDefinitions() []map[string]any
worldsMCPTool(store *WorldStore, name string, args map[string]any) (any, error)
```

`mcpToolCall()` dispatches `strings.HasPrefix(name, "recut.worlds.")` before generic app-tool parsing. Return regular MCP `content` plus exact `structuredContent`; arrays are wrapped as `{items: [...]}` following the existing host rule.

### 6.2 Tool policy

| Tool | Availability | Agent policy |
| --- | --- | --- |
| list/get/entities.list/entities.get/resolve | Always global | Read freely when relevant; list before guessing IDs. |
| create/update/entities.upsert/references.attach | Always registered, mutating | Call only for explicit user request; tool description repeats this requirement. |
| bind_project | Always registered, mutating | Requires `projectId`; must be explicit or clearly user-confirmed. |

MCP schemas exactly mirror the product RFC. Enforce `limit: 1..50`, a closed enum for kind/purpose, required `worldId` on all non-list calls and required `projectId` on binding. Tool descriptions say that `entityId` is only valid inside `worldId`.

### 6.3 Chat attachment resolution

Add `creation_world` and `creation_entity` to Agent turn attachment context types:

```json
{ "type": "creation_world", "worldId": "...", "revisionId": "..." }
{ "type": "creation_entity", "worldId": "...", "entityId": "...", "revisionId": "..." }
```

On send, server validates the ID combination then persists it in `agent_turn_contexts`; it does not persist the full Canon. The rendered Agent guide includes attachment IDs and tells the agent to call `recut.worlds.get/entities.get/resolve`. The first UI version can use a picker; `@` autocompletion is a follow-up, not a backend dependency.

## 7. Context binding and production integration

### 7.1 Binding operations

`ContextBindingStore.BindProject(projectID, appID, request)`:

1. Load Project and check `project.AppID == appID` when called from `ctx.creationContext`.
2. Validate World, requested revision and every selected entity under one read transaction.
3. Default revision to `world.current_revision_id`.
4. Reject existing primary binding unless `replace == true`.
5. Upsert `creation_context_bindings` with fixed revision.
6. Append a project event `creation_context.bound` without leaking Canon body.

Project owners read `ctx.creationContext.get()`; it performs one binding lookup and one `WorldStore.Resolve()` with the stored revision + selection. No binding yields `null`.

### 7.2 Artifact and media linkage

Add nullable `creation_context_binding_id` to `artifacts` and `media_jobs`; store the binding ID, not copied JSON. `PublishArtifact` and `GenerateMediaInput` accept it only after target validation. A join query powers the World detail’s “Created from this world” section in Phase 3.

### 7.3 Remotion exact changes

| Location | Change |
| --- | --- |
| `apps/remotion-studio/manifest.json` | Add `worlds.read`, `worlds.bind`; add `creationContextBindingId` to `project.create` schema. |
| `apps/remotion-studio/background.js` | Persist optional binding ID in `briefs`; include resolved Context and binding metadata in `workflow.context`; pass binding ID to export Artifact. |
| `apps/remotion-studio/ui/` | Add a compact World / Story chip to Brief and workspace header; `Change context` calls app API, never direct World DB. |
| `apps/remotion-studio/skills/.../SKILL.md` | Require Agent to read `workflow.context`; when context exists, rules override ungrounded creative additions; register all reference asset IDs used in composition. |
| `service/prompts/core-agents.md.tmpl` | Document global `recut.worlds.*` discovery and context attachment semantics. |

Do not change `composition.assets`: it remains the only list of actual media referenced by code. Context references guide the Agent but only assets present in the composition are materialized for export.

## 8. Native web implementation

### 8.1 Routes and source layout

```text
web/app/
  worlds/page.tsx
  worlds/worlds-client.tsx
  worlds/[worldID]/page.tsx
  worlds/[worldID]/world-detail-client.tsx
  worlds/README.md
  worlds/[worldID]/README.md
web/components/
  world-card.tsx
  world-picker.tsx
  world-entity-picker.tsx
web/lib/
  worlds-store.ts
  recut-worlds-client.ts
```

`WorkspaceTab` expands to `"studio" | "worlds" | "projects" | "assets" | "apps"`. Update the header, `tabFromPath`, static routes, page context and the L2 docs. `/worlds` uses the global worlds client directly; World detail receives `worldID` from path, not query state.

### 8.2 Store and cache behavior

`worlds-store.ts` mirrors `workspace-store.ts`:

- page cache keyed by `{endpoint, text, type, cursor}`;
- detail cache keyed by `{endpoint, worldId}`;
- entity list/detail cache keyed by `{endpoint, worldId, kind, cursor}`;
- explicit invalidation after every successful write/bind;
- no polling; future World events can invalidate a matching key.

Studio requests only `GET /v1/worlds?limit=6`; it never loads entity bodies. It shows `Create new world` after cards and links to `/worlds/new` or an inline creation dialog.

### 8.3 System Worlds UI versus App catalog

Worlds is native React, like Assets. Do not put `recut.creation-worlds` in `web/lib/app-catalog.ts`, Apps listing or an iframe route. If a system manifest is packaged for skill/onboarding purposes, catalog must flag it `system` and omit it from user-installable App responses.

## 9. Execution plan

Each stage lands as a separate reviewable commit. Any new files/directories require their README and L3 headers in the same commit.

1. **Storage foundation:** schema + `WorldStore`; CRUD, pagination, revision hashing, asset validation and unit tests.
2. **Public facade:** HTTP routes, typed web client, global MCP read tools + tests; no UI yet.
3. **Worlds UI:** navigation Tab, list/detail/create/edit/entity/reference flows, Studio section, docs and frontend tests.
4. **App capability:** manifest permissions, `ctx.worlds`, `ctx.creationContext`, binding store, MCP write/bind tools.
5. **Remotion vertical slice:** World Story → new Remotion Project binding → workflow Context → export provenance.
6. **Chat references:** picker and persisted structured attachments; use MCP at run time.
7. **Other production Apps:** Audio, Cover, Image and AI Video one by one; each declares the least permission it needs.

## 10. Test matrix

| Layer | Mandatory tests |
| --- | --- |
| Store | multiple Worlds; same entity title across Worlds; entity-world mismatch; pagination; completed/missing/pending asset; revision hash stability; optimistic conflict; transaction rollback. |
| HTTP | request validation, status codes, error envelope, cursor limits, no entity leakage from `world.get`. |
| MCP | all global read tools listed regardless of installed Apps; exact schemas; structured content; write tool refuses implicit mutation according to tool policy. |
| Runtime | absent `worlds.*` permissions expose no ctx capability; read cannot write; bind cannot target another App’s Project; fixed revision remains resolved after later World edits. |
| Web | header routing, list empty/loading/error, World detail routes, cache invalidation, Studio limit six, picker emits structured IDs only. |
| Remotion | unbound workflow returns null; bound workflow returns fixed Context; reference assets only materialize when composition registers them; export stores binding ID. |
| Regression | existing `make check`; creation of ordinary Projects, media generation and external MCP clients without World input remains unchanged. |

## 11. Observability

Emit concise events with IDs only:

```text
world.created
world.updated
world.entity.upserted
world.reference.attached
world.context.resolved
creation_context.bound
creation_context.replaced
```

Do not put Canon JSON, prompt text, private Asset metadata or raw user content into service logs/events. Metrics may count resolve latency, error codes and binding coverage by App ID.

## 12. Migration and rollback

- Before schema change, back up `workspace.sqlite` using the current service backup convention; add one if none exists before release.
- New tables are additive; existing Projects are unbound and therefore receive `creationContext: null`.
- Server downgrade that encounters newer tables must ignore them safely; it must never delete World tables.
- Feature flag only gates UI exposure during development; it must not produce different persisted data formats.
- Rollback removes navigation/tools from the running binary but preserves all World and binding data for a later upgrade.

## 13. Acceptance checklist

- [ ] Two Worlds with same-named Character return separate IDs and never cross-resolve.
- [ ] Chat, App background and external MCP client can list, get and resolve Worlds without opening `/worlds`.
- [ ] Every entity read checks both `worldId` and `entityId`.
- [ ] Neither iframe UI nor App code can access World tables directly.
- [ ] Revision conflict returns structured `WORLD_REVISION_CONFLICT` rather than overwriting Canon.
- [ ] A bound Remotion Project keeps its original resolved Context after the user edits that World.
- [ ] An unbound Project remains fully functional.
- [ ] All new files and architectural maps obey the GEB documentation protocol.

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
