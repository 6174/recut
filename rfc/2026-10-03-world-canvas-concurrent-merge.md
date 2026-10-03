<!--
 * [INPUT]: 以 rfc/2026-09-09-world-canvas-document-storage.md 的文档粒度模型为基线；对照
 *          service/worlds_canvas_doc.go（SaveCanvasDocument / UpdateCanvasDocumentOps 的元素合并）与
 *          web/app/worlds/[worldID]/canvas/canvas-store.ts（flushCanvasSave 的脏集与冲突合并）现状
 * [OUTPUT]: 只定义一件事——把画布并发写的合并粒度从「整元素」缩到「元素内的字段」：写方只声明改了哪几个
 *          字段，服务端逐字段合并（不同字段互补，同字段后者胜）。含最小改动面、契约变化与验收
 * [POS]: rfc 的画布并发修复决策；不改「画布是表达层、不产 revision」不变式，不引入 CRDT/向量时钟/新表新列
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: 画布并发写——按字段合并（缩到最小）

- 状态：提议
- 作者：Recut
- 日期：2026-10-03
- 关联：[文档粒度存储](./2026-09-09-world-canvas-document-storage.md)、[唯一写入面收口](./2026-09-15-world-canvas-sole-write-surface.md)
- 决策范围：**只**解决「AI 与人同时编辑，互相覆盖」；其余相邻问题列入 §6「不做」，另案处理

## 一句话

写画布时，不要交一整张元素，只交**我改了哪几个字段**；服务端**逐字段合并**。这样人拖位置、AI 改文案，两边都留得住。

## 1. 现在为什么冲突（人话版）

现在两边都是「整份交、整块换」：

- 人：`flushCanvasSave` 把**整份 `elements`**（每个元素的所有字段）发给 `canvas.save`。
- AI：`doc.update` 的元素 ops 落到服务端后，`op=update` 也是**用新元素整块替换**旧元素（只有 `geometry` 做了按 key 合并，`props`/`style` 是整体替换）。

于是两个真实场景会丢东西：

1. **人在拖卡（只动 `geometry.x/y`），AI 同时改了这张卡的文案（`props.text`）。** 合并时整张元素只能取一边——要么位置退回去，要么文案被冲掉。
2. **人的一次落盘基于旧快照。** AI 刚插的卡或刚改的字段，被人随后到达的整块写覆盖。

冲突的根不在「同步太慢」（推送已经近实时），而在**合并单元太大**：一个字段的改动，被当成整张元素的改动。

## 2. 改法（一个规则）

> **写方只交改动过的字段组；服务端按 key 合并，不整块替换。不同字段天然互补；同一个字段被两人同时改，后到服务端的那个胜（LWW）。**

不需要 CRDT、不需要向量时钟、不需要时间戳排序——服务端本来就是串行处理每一笔写，「后到者胜」就是确定性的裁决。

## 3. 改动面（核心就这些）

**服务端**

| 文件 | 改什么 |
|---|---|
| `service/worlds_canvas_doc.go` | 新增一个 `mergeCanvasElement(existing, patch)`：把 `props` / `geometry` / `style` **按 key 合并**，标量字段（`name`/`layer`/`refId`…）**只在出现时覆盖**（照抄现有 `mergeCanvasGeometry` 的写法，扩到 props/style 即可） |
| 同上 | `UpdateCanvasDocumentOps` 的 `op=update` 分支、`SaveCanvasDocument` 的元素落库处，改成调用它（各 1 行） |
| `service/worlds_http.go` | 若沿用现有 `canvas.save` 路由，无需改；载荷形状见 §4 |

**前端**

| 文件 | 改什么 |
|---|---|
| `canvas-store.ts` | `canvasSaveState.dirty` 从 `Set<id>` 升级为 `Map<id, Set<分组>>`（分组只有四个：`geometry` / `props` / `style` / `meta`）；`markCanvasDirty` 多收一个分组 |
| `canvas-store.ts` | `flushCanvasSave` 只发**脏元素**，且每个元素**只带脏分组**（没改的组不发） |
| `canvas-store.ts` | `flushCanvasSave` 的 `CANVAS_VERSION_CONFLICT` 分支：不再「拉远端 + 本地整块覆盖」，直接**拿新 version 重发同一份补丁**（补丁只含自己改的字段，重发就是正确的合并） |
| `recut-worlds-client.ts` | `canvas.save` 的类型放宽：元素允许是部分对象（`props?`/`geometry?`/…） |

客户端脏分组的填法，就在现有的几处调用点顺手加上（都已知自己改了什么）：

| 调用点 | 脏分组 |
|---|---|
| `moveElement` | `geometry` |
| `persistGeometry(id, geomOverride, propsOverride)` | `geometry`、`props` |
| `upsertElement`（新建） | 全字段（等价于插入） |
| `removeElement` | 走 `removed` 列表 |
| `commitInlineEdit`（文本） | `props`（+ `geometry`，若随内容定高） |

## 4. 契约变化

**请求（`POST /v1/worlds/{id}/canvas/doc`）** —— 元素从「完整对象」放宽为「部分对象」，语义从「替换」变「按 key 合并」：

```jsonc
{
  "contextId": "",
  "version": 42,
  "elements": [
    { "id": "shape:ent_a", "geometry": { "x": 120, "y": 80 } },   // 只合并这两个 key
    { "id": "shape:note-1", "props": { "text": "新文案" }, "geometry": { "height": 40 } }
  ],
  "removed": ["shape:note-9"]      // 删除走独立列表（现由 removed 脏集承担）
}
```

- **响应不变**（仍是 `{ worldId, contextId, version, elements, createdAt, updatedAt }`）。
- **AI 侧 `doc.update` 输入形状不变**：`op=update` 的 `element` 本来就允许部分对象，只是服务端内部由「整体替换」改为「按 key 合并」。AI 要精确 rebase 可带 `baseSeq`、服务端在响应里回 `conflicts`（可选，见 §6）。
- **兼容**：现有调用方（import / fork）若一次性交**完整元素**，因为所有 key 都出现，按 key 合并不影响结果；唯一差异是「旧元素里有、这次没交的 key 不会被清掉」。真要整份覆盖的路径加一个 `"replace": true` 显式声明即可。

## 5. 冲突时怎么办

- **不同字段**：服务端各写各的，两人都保住。这是绝大多数情况（人动几何、AI 动文案/状态）。
- **同一字段**：后到者胜。确定、无需协商。人拖卡和 AI 拖同一张卡，最后落的是后落盘的那个；人看得见卡片跳回去，重拖即可。
- **元素不存在**：写到的元素已被删 → 该笔跳过（不复活）；删除用 `removed` 表达，语义清晰。
- **客户端**：冲突分支只做「重发补丁」，不再整份 re-read + 覆盖，逻辑反而比现在更短。

## 6. 不做（明确划线）

以下都不属于本 RFC，也不影响上面生效：

- `world.changed` 带 diff、客户端「吃补丁不整份 reload」——现状的 reload 已经会保留本地脏元素，够用。
- `aiLock` 去暂停化——体验优化，与正确性无关。
- 服务端内部投影写（实体删除清理 / attr 同步 / promote）接入同一合并——边角覆盖。
- 语义侧（实体字段）改用 `attrPatch`——是另一个独立的覆盖问题，单独修。
- 文档级 `meta` 区、tombstone、每字段时间戳——**现在没有使用者**，需要时再加。
- 每字段（子 key）粒度的客户端追踪——只需到「分组」粒度就能解决人机冲突。

## 7. 验收

- 人拖卡（`geometry`）时 AI 改同卡文案（`props.text`）→ 位置与文案**都保留**。
- 人 resize（`geometry.width/height`）时 AI 改 `name` → 都保留。
- 两人改同一字段 → 后到者胜，无半写、无报错。
- AI 插入的卡不被人随后到达的落盘覆盖。
- 单用户既有流程（建卡/连线/拖动/文本/删除/撤销/提案）行为不变；`make check` 通过。
- 旧客户端 + 新服务端（交完整元素）行为与现在一致。

## 8. 以后可选

- 若将来需要**真人多端实时**（不 reload）或**字符级文本合并**，那才是 Yjs/CRDT 的适用场景，另案评估；本 RFC 的「按字段合并」与之不冲突，可平滑演进。
- 若「同一字段后到者胜」在实测中不够（例如 AI 批量排版与人手拖反复打架），再加 `baseSeq` 冲突报告，让 AI 拿到 `conflicts` 后 rebase——输入形状不用变。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
