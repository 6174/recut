<!--
 * [INPUT]: 以 rfc/2026-09-09-world-canvas-document-storage.md（一张画布 = 一个 Document，内层画布独立文档，实体/关系共享）与
 *   rfc/2026-10-03-world-canvas-concurrent-merge.md / 2026-10-03-world-canvas-multitab-sync.md（按字段补丁 + version 乐观锁 + clientId echo）为基线；
 *   对照 web/app/worlds/[worldID]/canvas/canvas-store.ts（load 的 parentId scope 过滤、changeLog/redoLog 闭包双栈、
 *   canvasSaveState 的全局 dirty/removed、pasteClipboard 的 isMove、setContext/exitContext 的异步 load）、
 *   canvas-clipboard.ts（fragment.sourceContextId 未被使用）、canvas-pomelo-plugin.ts（右键仅命中对象开菜单）、
 *   service/worlds.go（upsertEntityTx 的 update 分支不写 parent_id）、service/worlds_canvas_doc.go（文档粒度 save/patch）
 * [OUTPUT]: 定义「一个 World = 一个操作与历史单位；一张画布（context/层）= 该 World 内的持久化分片」的架构：
 *   跨画布移动是一等的世界级操作（实体重挂 parentId + 元素迁移 + 关系重建，单条可撤销）；历史是 world 级但每条记录携带
 *   其发生层，回放前先激活该层；右键菜单补「粘贴」与空白菜单；粘贴不再触发整层重载。含契约、迁移、验收与不做
 * [POS]: rfc 的画布跨层移动 + 世界级历史决策；不改「一张画布一个 Document」的存储不变式，不引入 CRDT/Yjs、不新增表
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# RFC: 画布跨层移动与世界级历史（Cross-Layer Move & World-Scoped History）

- 状态：已实施（2026-10-06）
- 作者：Recut
- 日期：2026-10-06
- 关联：[文档粒度存储](./2026-09-09-world-canvas-document-storage.md)、[按字段合并](./2026-10-03-world-canvas-concurrent-merge.md)、[多标签页同步](./2026-10-03-world-canvas-multitab-sync.md)、[递归世界画布](./2026-09-07-recursive-world-canvas.md)、[唯一写入面收口](./2026-09-15-world-canvas-sole-write-surface.md)

## 摘要

一个 World 里有多个画布层（根画布 + 每个容器实体的内层画布）。**在同一个 World 的多个画布之间搬运内容，是常态操作**；**撤销/重做也是针对整个 World 的一条历史**，而不是每个画布各一条。当前实现不满足这个模型：

1. **跨层剪切粘贴（move）不成立**：`pasteClipboard` 的同世界 `cut` 分支只重写元素、**不重挂实体 `parentId`、也不清理源层**；而 `load` 只装载 `parentId === 当前 contextId` 的实体，于是贴到别层后实体不在 scope、卡片不渲染——但左下角仍提示「已移动所选对象」。
2. **历史是 world 级，但回放不是 context-aware**：`changeLog` 在切层时不清（符合世界级），但元素级操作的落库走全局 `canvasSaveState.dirty/removed`，用「保存那一刻的 `elementsContextId`」决定写进哪份文档。切层后撤销上一层发生的元素操作会写错文档。
3. **粘贴只能靠 ⌘V**：右键菜单只在命中对象时打开、且没有「粘贴」项；空白右键直接关闭菜单。粘贴也没有「粘到光标处」，永远 +32 偏移。
4. **粘贴后整层重载 + 切层旧层残影**：`pasteClipboard` 末尾 `await load(false)`；`setContext/exitContext` 先同步切 `context` 再异步 `load`，await 期间 `elements` 仍是旧层 → 闪一帧旧内容。

本 RFC 的决策：

> **一个 World = 操作与历史的单位；一张画布（context/层）= 该 World 内的持久化分片。**
> 每个操作都发生在「某一层」，历史记录它属于哪一层；回放前先把该层激活。跨画布移动是**世界级一等操作**：迁投影 + 重挂实体归属 + 重建内部关系，一条撤销。所有画布元素写都必须落在「当前激活层」，由「切层前 flush + 回放前激活」这条不变式保证。

## 1. 现状（读码结论，非推断）

| # | 事实 | 位置 |
|---|---|---|
| 1 | 实体/关系是 world 级；画布元素按 `contextId` 分成独立文档 | `canvas-store.ts` 的 `load`（`client.canvas.get({worldId, contextId})`）、`service/worlds_canvas_doc.go` |
| 2 | 一层只装载 `parentId === contextId` 的直接子实体 + 容器自身 | `canvas-store.ts:1594`、`:1597` |
| 3 | 实体卡由 `state.entities` 驱动渲染（元素仅提供位置） | `canvas-pomelo.tsx:129` |
| 4 | 同世界 `cut` + 粘贴 = 「真移动」，走 `moveFragment`，只 upsert 元素、不碰实体、不清理源层 | `canvas-store.ts:3101-3156` |
| 5 | `moveFragment` 的 toast 是「已移动所选对象」 | `canvas-store.ts:3289` |
| 6 | 副本逻辑（`copy` / 跨 world `cut`）会重挂 `parentId = targetParentId`；move 分支没有——不对称 | `canvas-store.ts:3163-3164` |
| 7 | `fragment.sourceContextId` 已存但从未被用于决定 move/copy | `canvas-clipboard.ts:46`、`canvas-store.ts:3101` |
| 8 | 历史双栈 `changeLog/redoLog` 只在 `open()`（世界变化）重置；切层不清 | `canvas-store.ts:1570`、`index.tsx:78` |
| 9 | 元素落库用全局 `canvasSaveState.dirty/removed` + 保存时刻的 `elementsContextId` | `canvas-store.ts:934`、`:941` |
| 10 | 右键：空白/世界节点直接关菜单；菜单无「粘贴」 | `canvas-pomelo-plugin.ts:1230`、`canvas-context-menu.tsx:30-33` |
| 11 | 粘贴后 `await load(false)`（整层重拉） | `canvas-store.ts:3316` |
| 12 | `setContext/exitContext` 先 `set({context})` 再异步 `load(true)` | `canvas-store.ts:1712-1713`、`:1735-1736` |
| 13 | 服务端 upsert 的 update 分支不更新 `parent_id`（`parentId` 仅 create 生效） | `service/worlds.go:1292-1296` |

## 2. 决策

### 2.1 三条不变式

1. **世界是操作与历史的单位**：`changeLog/redoLog` 属于 World 会话（切层不重置，现状已符合）。每条 `CanvasChange` 额外携带 `contextId`（该次变更发生在哪一层；实体/关系等世界级操作携带其发生层）。
2. **每次画布元素写都落在「当前激活层」**：`elementsContextId` 即激活层。跨层写先通过「切层前 flush / 回放前激活」把目标层变为当前层。据此，现有单文档的 `canvasSaveState` / `docVersion` 仍然正确，无需改成 per-context 分桶。
3. **移动是一等世界级操作**：`cut → paste` 到不同层 = 一次原子、可撤销的迁移；到同层 = 层内移动（现状）。

### 2.2 移动语义

一次「剪切 → 粘贴」按来源/目标层与世界决定：

| 条件 | 语义 | 行为 |
|---|---|---|
| `copy`（任意） | 克隆 | 目标层插入新 id 副本，实体重挂到目标容器（现状 `cloneFragment` 已正确） |
| `cut` 且同世界 且 **同层** | 层内移动 | 现状 `moveFragment`（复用 id、+32 偏移、重建内部关系） |
| `cut` 且同世界 且 **跨层** | **跨画布移动（本 RFC 新增）** | **迁投影 + 重挂实体 + 重建内部关系**，单条撤销 |
| `cut` 且跨世界 | 跨世界移动 | 克隆新 id + 删除源实体（现状） |

跨层移动的组成（`migrateFragment`）：

- **实体投影卡**（`kind=entity`）：目标层 `upsertElement`（复用 `shape:<entityId>` id、`hidden:false`、+32 偏移）；**重挂实体** `parentId = 目标层容器`（根层 = 清空）；源层那份投影变为不可见（源层 scope 不再含该实体），无需在源层显式删除。
- **自由元素**（note/text/attr/media/group）：目标的 `upsertElement`；源层那份在 `cut` 时已被 `removeElement` 真删（现状），故无需再清。
- **关系**：同世界关系是 world 级，`cut` 时被删、粘贴时按原两端重建（复用 `moveFragment` 的选择）。
- **实体归属变更**：`entities.upsert`（PATCH）显式携带 `parentId`；见 §3.1。

**移动目标层不匹配的实体语义**：把容器 A 的子设定拖到根画布，等于「把它移出 A」——`parentId` 清空（根层）。把卡片移到容器 B 的画布，等于「把它放进 B」——`parentId = B`。这与「文件夹」心智一致。

### 2.3 历史回放（context-aware）

`pushChangeEntry` 记录当前 `elementsContextId` 到 `CanvasChange.contextId`。回放（`undoLastChange` / `redoLastChange` / `undoChange`）在调用条目闭包前，若 `entry.contextId` 与当前激活层不同，先**激活该层**（复用 §2.4 的 `activateContext`，await 完成）再回放。这样元素级撤销总是作用在它当初发生的文档上；实体/关系级撤销（world 级）即使激活层不同也不受影响。

用户可见语义：撤销会「带你回到那次改动发生的画布层」。这对多画布世界是符合直觉的（撤销会展示它撤销了什么），并保证正确性——比静默写错文档好。

### 2.4 切层原子化

`setContext` / `exitContext` / `restoreContext` 收敛到一个 `activateContext(context, trail)`：先 flush 当前层，再拉目标层的实体/文档，**一次性 `set`**（context + contextTrail + entities + elements + relations + docVersion + 清 selection），不再「先切 context 再异步覆盖」。消除旧层残影。

## 3. 契约变化

### 3.1 服务端：实体 update 支持显式重挂父级（reparent）

`UpsertEntityInput` 增加只读信号 `ParentIDSet bool json:"-"`；`upsertEntityTx` 的 update 分支在 `ParentIDSet` 时校验（存在性 + **防环**：新父不能是自己或自己的后代）并写 `parent_id = nullIfEmpty(ParentID)`。

- HTTP `PATCH /v1/worlds/{id}/entities/{entityId}`：请求体显式含 `parentId` 键即置 `ParentIDSet=true`（用二次 decode 探测键是否存在），使「移到根（`parentId:""`）」与「未提供」可区分。
- MCP `recut.worlds.entity` op=update：`input["parentId"]` 存在时置 `upd.ParentIDSet=true`（现在只赋值、被 store 忽略，属既有缺口）。
- 生产树关系（`has_scene`/`has_shot`）与 `scopeEntityId` 的重挂不作为本 RFC 范围（见 §8）。

### 3.2 前端：`CanvasChange` 增 `contextId`

```ts
export type CanvasChange = {
  id: number; label: string; at: string;
  contextId: string;              // 该次变更发生的画布层（''=根）
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
};
```

### 3.3 前端：`pasteClipboard` 决策与路径

```ts
const sameWorld = fragment.sourceWorldId === state.worldId;
const sameLayer = fragment.sourceContextId === targetContextId;
const isMove   = fragment.mode === "cut" && sameWorld && sameLayer;   // 层内移动
const isMigrate= fragment.mode === "cut" && sameWorld && !sameLayer;  // 跨层移动（新增）
// 否则 clone（copy，或跨世界 cut）
```

toast 随之区分：层内「已移动」、跨层「已移动到「<容器名>」」、克隆「已粘贴」。

### 3.4 前端：粘贴锚点

`pasteClipboard(anchor?: Point)`：给定锚点时，片段整体按「片段包围盒左上角 → 锚点」平移（而不是固定 +32）；未给锚点保持 +32。右键「粘贴到此处」与框选后粘贴使用锚点。

## 4. UI

- **空白/世界节点右键**：打开画布级菜单，至少 `粘贴`（剪贴板非空才启用）、`全选`、`适应视图`；不再直接关闭。实现上把 `contextMenu` 扩展一个 `kind:"canvas"` 分支。
- **对象右键**：菜单补一条 `粘贴`（与复制/剪切并列），锚点为右键世界坐标。
- **粘贴后不整层重载**：去掉 `pasteClipboard` 末尾的 `await load(false)`；迁移/移动已经把元素与实体增量并入本地状态（实体经 `upsertById`，元素经 `upsertElement`）。

## 5. 改动面

| 文件 | 变更 |
|---|---|
| `service/worlds.go` | `UpsertEntityInput.ParentIDSet`；`upsertEntityTx` update 分支写 `parent_id`（含防环） |
| `service/worlds_http.go` | `updateWorldEntity` 探测 `parentId` 键存在 → 置 `ParentIDSet` |
| `service/worlds_mcp.go` | `entity` op=update：`parentId` 存在时置 `ParentIDSet` |
| `web/app/worlds/[worldID]/canvas/canvas-store.ts` | `switchContext`（原子切层）；`pasteClipboard` 增加 `isMigrate` + `migrateFragment` + 锚点；`CanvasChange.contextId` + 回放前激活层；去掉粘贴后 `load(false)`；toast 区分 |
| `web/app/worlds/[worldID]/canvas/canvas-pomelo-plugin.ts` | 空白/世界节点右键 → 画布级菜单；右键世界坐标透传 |
| `web/app/worlds/[worldID]/canvas/canvas-context-menu.tsx` | 画布级菜单（粘贴/全选/适应视图）；对象菜单补「粘贴」 |
| `web/app/worlds/[worldID]/canvas/README.md` | 更新跨层移动/历史/右键说明 |

## 6. 不做（明确划线）

- **不把画布元素改成 world 级单文档 / 不改变「一张画布一个 Document」**：0909 的决策继续有效；跨层移动用「迁投影 + 重挂 + 关系重建」表达，不合并文档、不迁移元素 id。
- **不引入 CRDT/Yjs、不做实时协同**：沿用按字段补丁 + version 乐观锁 + clientId echo。
- **不新增表/列**：reparent 复用既有 `world_entities.parent_id`。
- **不重挂生产结构关系**（`has_scene`/`has_shot`）与 `scopeEntityId`：移动生产节点时结构关系不随动，作为后续「生产树重挂」单独设计。
- **不做服务端原子 move 端点**：跨层移动由客户端编排（源层在切层前 flush、目标层写入 + reparent），失败重试依赖既有错误处理；若实测出现半完成，再考虑服务端事务化。
- **不做剪贴板多片段栈**：单片段不变。

## 7. 验收

- **跨层移动**：容器 A 内剪切一张子设定卡 → 返回根画布 → ⌘V：卡片出现在根画布（+32 或锚点），实体 `parentId` 变为空；再进容器 A，该卡不再出现（scope 不含它）；进入其它容器 B 粘贴则 `parentId=B`、B 内可见。toast 为「已移动到…」，不是「已移动所选对象」。
- **undo/redo**：在根画布撤销「容器 A 内新增便签」→ 自动激活 A 并移除该便签（元素级 undo 落在正确文档）；重做同理。撤销不写错层。
- **右键**：空白右键出现菜单且「粘贴」可用（剪贴板非空）；对象右键含「粘贴」，粘贴落在右键处。
- **无整层重载**：粘贴后不出现整层重挂；切层不闪旧层内容。
- **回归**：层内移动、复制、跨世界剪切、编组、拖拽/resize 撤销行为不变；`make web-build` 与 `go test ./service/...` 通过。

## 8. 以后可选

- **服务端原子 `canvas.move`**（一次事务：源文档删除 + 目标文档写入 + reparent + 一次广播），消除客户端编排的半完成窗口。
- **生产树重挂**：移动 `scene`/`shot` 时同步 `has_scene`/`has_shot` 与 `scopeEntityId`。
- **历史面板按层分组**：世界级历史里标注每条属于哪一层，支持「只看本层」。

## 9. 实施记录

已按本 RFC 实施（2026-10-06）：

- **服务端**
  - `service/worlds.go`：`UpsertEntityInput.ParentIDSet bool json:"-"`；`upsertEntityTx` 在 `ParentIDSet` 时于 update 分支写 `parent_id`（`nullIfEmpty`），并加自环/后代环校验 `checkReparentCycle`（`service/worlds_canvas.go`）。
  - `service/worlds_http.go`：`updateWorldEntity` 读 body，探测原始 `parentId` 键存在即置 `ParentIDSet`（区分「移到根」与「不改」）。
  - `service/worlds_mcp.go`：`entity` op=update 在 `parentId` 存在时置 `upd.ParentIDSet=true`；工具描述更新（update 可 reparent）。
  - `service/worlds_test.go`：`TestEntityReparent`（跨容器移动 / 移到根 / 拒绝环 / 省略 parentId 保持不变）。
- **前端 store（`canvas-store.ts`）**
  - `CanvasChange` 增 `contextId/context/contextTrail`；`pushChangeEntry`/`withChangeGroup` 记录发生层。
  - 新增 `fetchContextData`（收敛原 `load` 的读取/归一/脏合并/反向投影）与 `activateContext`（原子切层）、`ensureChangeLayer`（回放前激活层）；`load` 复用 `fetchContextData`；`setContext/exitContext` 改走 `activateContext`。
  - `undoChange/undoLastChange/redoLastChange` 回放前 `ensureChangeLayer`。
  - `pasteClipboard(anchor?)`：`isMove`（同层）与 `isMigrate`（跨层）分流；`migrateFragment` 迁元素 + `setEntityParent` 重挂 + 重建关系，单条撤销；`pasteOffset` 支持锚点；移除末尾 `load(false)`；toast 区分。
- **前端 UI**
  - `canvas-pomelo-plugin.ts`：空白/世界节点右键开画布级菜单并透传世界坐标；对象菜单同样带世界坐标。
  - `canvas-context-menu.tsx`：对象菜单补「粘贴」；`kind="canvas"` = 粘贴到此处 / 全选 / 适应视图。

**验证**：`go test . -run 'World|Entity|Canvas|Relation|Production|Bundle|Readiness|Preset|MCP|Workspace|Brief|Resolve'` 全绿（`TestEntityReparent` 通过）；`web` 侧 `tsc --noEmit` 在本轮改动文件（canvas-store / canvas-context-menu / canvas-pomelo-plugin）零新增错误（`timeline-editor/` 的 40 条为既有历史错误）。

