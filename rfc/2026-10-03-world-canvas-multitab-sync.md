<!--
 * [INPUT]: 以 rfc/2026-09-09-world-canvas-document-storage.md（文档粒度 + version 乐观锁）与
 *          rfc/2026-10-03-world-canvas-concurrent-merge.md（按字段合并）为基线；对照
 *          service/world_events.go（广播出口 worldMutatingTools）、service/worlds_mcp.go（MCP 写后广播）、
 *          service/worlds_http.go（HTTP 画布写无广播）、service/eventbus.go（扇出无发起方排除）、
 *          web/lib/realtime-channel.ts（单 WS + channels）、
 *          web/app/worlds/[worldID]/canvas/index.tsx（world.changed → scheduleWorldReload）与
 *          canvas-store.ts（load 的脏保留仅限 aiLocked，flushCanvasSave 冲突重发）现状
 * [OUTPUT]: 只定义一件事——让**用户写入**也进入实时通知（world.changed），并保证多标签页 reload 不吞本地未落盘编辑；
 *           含缺口清单、最小改动面、事件契约、竞态/echo/风暴对策、验收与「不做」
 * [POS]: rfc 的画布多标签页同步决策；不改「画布是表达层、不产 revision」不变式，不引入 CRDT/Yjs、不做 diff 补丁流
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
-->

# RFC: 画布多标签页同步——用户写入也广播（缩到最小）

- 状态：已实施（2026-10-03）
- 作者：Recut
- 日期：2026-10-03
- 关联：[文档粒度存储](./2026-09-09-world-canvas-document-storage.md)、[按字段合并](./2026-10-03-world-canvas-concurrent-merge.md)、[唯一写入面收口](./2026-09-15-world-canvas-sole-write-surface.md)、[实时通道单 WS](./2026-08-14-realtime-channel-ws.md)
- 决策范围：**只**解决「同一 world 的多个标签页，用户改动也要自动同步」；Agent 侧已通（不动）。其余相邻问题列入 §7「不做」

## 0. 一句话

现在**只有 Agent（MCP）写入会广播** `world.changed`；**用户写入（HTTP 画布保存）什么都不发**。所以两个标签页里，A 拖一张卡，B 不会动。按字段合并（RFC 2026-10-03）只解决了「并发写互相覆盖」，**没解决「谁去通知对方」**——本 RFC 补上通知，并让远端 reload 不吞本地未落盘编辑。

## 1. 现状（读码结论，非推断）

**通知来源（只有一处）**
- MCP 写工具成功后广播：`service/worlds_mcp.go`（工具分派末尾）对 `worldMutatingTools[name]`（`service/world_events.go`）调 `worlds.publishWorldChanged(name, input)`。
- `publishWorldChanged` → `WorldStore.publish` → 组合根注入的 `Server.publishWorldEvent`（`service/server.go`）→ `bus.Publish("world", worldId, frame)`，帧为 `{type:"event", channel:"world", data:{event,worldId,key,tool,source:"mcp",contextId?}}`。
- 画布锁另有 `world.canvas.lock/unlock`。

**HTTP 用户写（不通知）**
- `service/worlds_http.go` 的 `saveCanvasDocument` → `PatchCanvasDocument` / `SaveCanvasDocument`，写库、回 JSON，**不调用任何 publish**。
- 因此：用户在浏览器里的拖拽/文本/媒体改动，其它标签页**完全不知道**。

**客户端**
- `web/app/worlds/[worldID]/canvas/index.tsx` 订阅 `getRealtimeChannel(apiBase).subscribe("world", worldId, …)`；`world.changed` → `scheduleWorldReload()`（`canvas-store.ts`，250ms 去抖）→ `load()` 整份重拉当前 `contextId` 文档并 `set({elements,…})`。
- **脏保留只限 AI 锁**：`load()` 里仅当 `get().aiLocked && (dirty.size||removed.size)` 才用本地脏覆盖远端；非锁态远端直接覆盖本地 `elements`。
- 合并/锁：写入是**按字段补丁**（`canvasSaveState.dirty: Map<id,Set<group>>` → `canvasPatchElements`），version 乐观锁冲突时「重发同一补丁」（`flushCanvasSave`）。
- 本地丢写窗口已收窄（本 RFC 前序修复）：拖拽提交即落盘（`flushCanvasSaveNow`）、`pagehide` 兜底改用 `text/plain` 字符串发 beacon（跨源不再被 CORS 预检吞掉）。**但这两项只防「本页丢写」，不产生跨页通知。**

**实时总线**
- 单 WS + channels 订阅（`web/lib/realtime-channel.ts`）。
- `EventBus.Publish` 扇出给**所有**匹配订阅者（`service/eventbus.go`），**没有发起方排除**；WS 连接与 HTTP 写之间**没有身份关联**。
- 全仓**没有** client/tab id 概念。

## 2. 缺口清单

| # | 缺口 | 后果 |
|---|---|---|
| G1 | 用户写不广播 | 另一标签页不知道，永不自动同步 |
| G2 | 无发起方身份（clientId） | 一旦广播，发起标签页也会收到自己的事件 → 无谓 reload；无法 echo 抑制 |
| G3 | reload 不保留本地脏（仅 aiLocked） | 远端 reload 会**吞掉本地未落盘的编辑**（文本去抖窗口内、或保存仅提交尚未回） |
| G4 | `load()` 不等待在途 `flushCanvasSave` | `saving=true` 时 `flushCanvasSave` 直接返回；reload 取到**旧快照**覆盖本地 |
| G5 | 无 contextId 过滤 | 事件属别的 `contextId` 时也 reload（无效动作；多上下文下放大） |
| G6 | 派生写会不会引发 reload 风暴 | 每次加载都会测封面比例并 `persistGeometry(props.coverAspect)`；若这些也广播 → A reload 触发写 → 广播 → B reload → B 也写…（`measuredEntityCover` 仅内存缓存，首轮必写） |
| G7 | 事件无 version | 无法用版本短路「已是最新」的 reload（且不能替代 G2，事件可能先于本页 save 响应到达） |

## 3. 改法（最小面）

### 3.1 服务端

1. **HTTP 画布写成功后广播**（`service/worlds_http.go` 的 `saveCanvasDocument`，patch 与整包两条分支都接）：写入成功拿到 `doc` 后调 `s.publishWorldEvent(worldID, …)`，复用与 MCP 同一条出口、同一个 `"world"` channel（保持「一条通道 + 一套客户端处理」）。
2. **只有内容真变了才广播**（对策 G6）：`PatchCanvasDocument` 返回一个「是否有实质变化」信号，或在 handler 内比较写入前后的文档（元素数/被 patch 元素的字段）。**空补丁（无 elements 且无 removed）一律不广播**；纯派生字段（如仅 `props.coverAspect`）不构成广播理由——或对这类写不发事件。
3. **回填发起方身份**（对策 G2）：从请求头/体读一个每标签页随机 `clientId`，原样放进事件 `data.clientId`；未带则省略。

### 3.2 事件契约（`world.changed` 增量，向后兼容）

```jsonc
{
  "type": "event", "channel": "world",
  "data": {
    "event": "world.changed",
    "worldId": "07e6…",
    "contextId": "0bb7…",   // 必填（画布文档按 context 分档）；MCP 侧沿用可选
    "version": 131,         // 本次写后的 doc version（G7）
    "source": "web",        // "mcp" | "web"
    "clientId": "tab-3f9a"  // web 发起标签页；"mcp" 时省略
  }
}
```

- 复用 `world.changed`（不新增事件名），旧客户端忽略未知字段即可。
- 客户端语义仍是「去重拉取提示」，不是状态通道。

### 3.3 客户端

1. **每标签页稳定 `clientId`**：模块级生成一次、存 `sessionStorage`（同标签页刷新不变、跨标签页不同），随 `canvas.save` 发送（自定义头如 `X-Recut-Client` 或并入 body）。`recut-worlds-client.ts` 的 `canvas.save` 透传。
2. **`index.tsx` 事件处理增强**（对策 G2/G5）：
   - `data.clientId === 本页 clientId` → **跳过**（echo 自抑制）。
   - `data.contextId` 存在且 `!== store.elementsContextId` → **跳过**（不是当前层的文档，重拉无意义）。
   - 其余照旧 `scheduleWorldReload()`。
3. **`load()` 通用保留本地脏**（对策 G3）：把现在 `aiLocked` 专用的「用本地 dirty/removed 覆盖远端结果」分支**提为默认路径**（锁态与非锁态一致），即：远端拉回后，对 `canvasSaveState.dirty` 里的元素用本地版本覆盖、`removed` 里的剔除。这样任何远端 reload 都不会吞掉尚未落盘的本地编辑。
4. **reload 前等在途保存**（对策 G4，可选但建议）：`load()` 开头对在途 `flushCanvasSave` 复用同一 Promise（现在只判 `saving` 就返回），确保拉回的是「含本页已发起写」的快照；否则用 `version` 比对：`event.version <= 本地 docVersion` 时无需 reload。

## 4. 竞态与对策（逐条）

- **echo**：发起页最优是**完全不 reload 自己**（clientId 跳过）。即便跳过失败，G3 的脏保留也保证不丢编辑，只是多一次拉取。
- **事件先于本页 save 响应**：所以 echo 抑制不能用 `version` 单独判断（本页 docVersion 尚未更新）——以 `clientId` 为准，`version` 只作其它页的短路优化。
- **reload 撞上在途保存**：G4 的「等保存」或「保留本地脏」任一都能兜住；两者都做最稳。
- **reload 风暴**（G6）：靠 §3.1.2「实质变化才广播」+ 客户端对「无变化 reload」短路（版本相同则不 `set`）。派生测量（封面比例/媒体定尺）应继续用内存缓存，避免每次 load 都产生一次写。
- **与 AI 锁**：锁期内 `world.changed` 维持现状（只续期、不回拉）；用户写广播在锁期同样落入该分支，不引入新行为。

## 5. 与既有不变式的关系

- 不产 revision、画布仍是表达层：本 RFC 只加**通知**，不碰 revision/语义层。
- 不改 `world_canvases` 表结构、不加列、不加新表。
- 合并语义不变：不同字段互补、同字段 LWW（RFC 2026-10-03 已上线）。本 RFC 只补 G1–G7。

## 6. 改动面

| 文件 | 改什么 | 量级 |
|---|---|---|
| `service/worlds_http.go` | `saveCanvasDocument` 成功后 `publishWorldEvent`（带 contextId/version/source=web/clientId）；空补丁/无实质变化不发 | ~15 行 |
| `service/worlds_canvas_doc.go` | `PatchCanvasDocument` 返回「是否有变化」信号（或 handler 侧比较） | ~10 行 |
| `web/lib/recut-worlds-client.ts` | `canvas.save` 透传 `X-Recut-Client`（或 body `clientId`） | ~3 行 |
| `web/app/worlds/[worldID]/canvas/index.tsx` | 事件处理加 clientId/contextId 过滤 | ~10 行 |
| `web/app/worlds/[worldID]/canvas/canvas-store.ts` | `load()` 脏保留提为默认；`load()` 前等在途保存（或 version 短路）；导出/生成 clientId | ~20 行 |

## 7. 不做（明确划线）

- **CRDT / Yjs / 字符级文本合并 / 实时光标在线态**——本 RFC 是「粗粒度通知 + 整份 reload + 字段合并」，非实时协同编辑；同字段 LWW。
- **事件带 diff / 客户端「吃补丁不整份 reload」**——现在没到瓶颈，留待「以后可选」。
- **服务端内部投影写（attr 同步 / promote / 归档清理）单独广播**——它们最终经画布接口落库，一并被覆盖即可。
- **多标签页在线用户/占用提示**——非必要。
- 不改通知通道拓扑（仍 `"world"` channel + worldId 作 key）。

## 8. 以后可选

- 事件携带**被改元素与字段的最小 diff**，客户端**原地合并**（不整份 reload）→ 省一次全量拉取，且天然无 echo（只改自己那份）。
- **同字段冲突可见化**：本页正在编辑的字段收到远端同字段更新时提示「已被他处修改」，而不是静默 LWW。
- **每标签页 presence**（谁在看、谁在编辑）——若将来要真人实时协同，这是 CRDT 的前置。

## 9. 验收

- 两个标签页打开同一 world、同一 `contextId`：
  - A 拖卡 → 250ms 后 B 自动出现同位移；B 拖 → A 同步。
  - A 改文本、B 同时拖同一张卡 → **两者都保留**（不同字段互补）。
  - A 正在输入（未落盘）时 B 改别处 → **A 的编辑不丢**（脏保留生效）。
- **echo**：A 写入后 A **不因自己的事件额外 reload**。
- **Agent 写**仍触发所有标签页刷新；**用户写**也触发（回归用例）。
- **无风暴**：静置后不再有 `world.changed`；仅派生测量（coverAspect）不产生跨页 reload。
- `make check` / `go test ./service/...` / `web tsc` 通过；旧客户端（不带 clientId）行为不变（只是会多一次自 reload）。

## 10. 实施记录（2026-10-03）

已按本 RFC 实施：

- 服务端
  - `WorldCanvasDocument` 增 `Changed bool \`json:"-"\``；`PatchCanvasDocument`/`SaveCanvasDocument` 计算「本次写是否实质改变文档」（**两侧都 `normalizeCanvasElements` 后再比**——读回的 `doc_json` 里空 `props/style` 会解码成 `nil`，不归一会把同值重写误判为 changed）。
  - `worlds_http.go` 的 `saveCanvasDocument`：成功且 `doc.Changed` 时调 `publishCanvasChanged`（复用 `publishWorldEvent`，同一 `"world"` channel），事件带 `contextId/version/source:"web"/clientId`；请求体新增可选 `clientId`。
- 客户端
  - `canvas-store.ts` 导出每标签页稳定 `canvasClientId`（sessionStorage），随 `canvas.save` 与 `pagehide` beacon 发送；`load()` 的「本地脏覆盖远端」从 `aiLocked` 专用**提为默认**（限同一 `elementsContextId`，切层不串层）。
  - `index.tsx` 的 `world.changed` 分支加两道过滤：`clientId` 相等（self/echo）跳过、`contextId` 与本页归属层不同跳过。
- 测试
  - `service/worlds_multitab_sync_test.go`：HTTP 写成功广播（source/contextId/version/clientId）、**幂等写不广播**、`PatchCanvasDocument` 的 `Changed` 标志。
  - 真实双标签页（同一 world/同一 context）：A 移动 `#04` → B 自动同步到同一坐标（docVersion 一致）；还原也同步。
