<!--
 * [INPUT]: 依赖 apps/editor 现有数据模型（TProject / SceneTracks / BaseTimelineElement / params / animations）、
 *          写引擎（TimelineManager / CommandManager / ScenesManager / update-pipeline / ripple / retime / animation/keyframes）、
 *          UI 存储与同步链路（storage/service.ts、recut-sdk 桥 events.subscribe、realtime WS project channel）、
 *          MCP 平台（manifest operations → recut.<appId>.<op>，__recut.target.projectId，background.js recut.operation.register）、
 *          rfc/2026-08-14-editor-data-model-selection.md（Model API / Ephemeral Layer / 渲染几何 bbox / Chromium 自测 Phase G）、
 *          rfc/2026-08-14-ai-temp-components.md（component.* 工具）、rfc/2026-08-14-realtime-channel-ws.md（project channel）
 * [OUTPUT]: 定义 recut.editor 面向 AI 的完整 MCP 工具面与 Skill 契约：操作驱动取代文档驱动、Headless 共享 Model API、
 *          统一 op 日志（undo/redo 单一权威）、aiLock 并发、版本号/op 广播双档前端同步、preview.frame 视觉验证闭环、
 *          headless 双模导出，以及 SKILL.md + references 分层技能与端到端验证方案
 * [POS]: rfc 的架构设计蓝图；获批实现后作为 apps/editor 共享 Model API 抽取、background 操作层、前端同步与 skill 重写的共同契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: AI 全权编辑 —— recut.editor 的 MCP 工具面与 Skill 契约

- 状态：提议
- 作者：Recut
- 日期：2026-08-14
- 决策范围：MCP 工具面、Headless Model API、统一 op 日志与 undo/redo、并发与冲突、前端同步、预览验证闭环、headless 导出、Skill 定义、端到端验证
- 关联：`rfc/2026-08-14-editor-data-model-selection.md`（Model API / Ephemeral / bbox / Playwright 基建）、`rfc/2026-08-14-ai-temp-components.md`（component.* 工具）、`rfc/2026-08-14-realtime-channel-ws.md`（project channel）、`rfc/2026-08-13-visual-runtime-component-system.md`（世界渲染 / Preview==Export）
- 实施进展：P1 已落地并全绿（`make check` + `make editor-e2e`）——共享 AI Model Core（background.js 内联纯 JS op 引擎）、统一 `editor_command_log`（snapshot undo/redo + baseVersion 冲突）、aiLock、13 个 mcp 只读/写/历史/会话工具、`component.*` 工具（AI 临时组件，另一进程实现）并入同一工具面、`ctx.project.emit` 平台能力 + iframe `useRecutProjectSync` 版本号同步；验证：`service/editor_agent_test.go`（后端数据层 + WS 同步链）、`scripts/test-model-api.js`（L0）、`tests/e2e/recut-sync.spec.ts`（前端同步）。P2/P3（op 增量广播、headless 导出、preview.frame）仍待办。

## 1. 背景与病灶

目标是让 AI **完全接管各种编辑体验**：不仅把 AI 短片/程序化视频铺进时间线，还要能像人类剪辑师一样逐条增删、裁剪、变速、打关键帧、加效果与蒙版、视觉验证、导出成片。当前 `recut.editor` 对 AI 的能力存在四道结构性硬伤：

1. **AI 实际无法编辑**。manifest 中 `project.create` / `workflow.context` / `timeline.assets` / `film.package.import` 是仅有的 mcp surface 操作；`project.load` / `project.save` / `export.*` 全是 `api` surface（iframe 专用）。MCP Host 只暴露含 `mcp` surface 的操作（`service/mcp.go` `appMCPToolDefinitions`），因此 Agent 对时间线既不能读也不能写。
2. **Skill 指引的路径不可达**。`skills/recut-editor/SKILL.md` 指导 AI 走 `project.load → 构造 TProject JSON → project.save` 的"文档驱动"流程，但这两个操作对 MCP 不可达；即使放行，AI 也要手写完整 TProject（tick 换算、params 键、关键帧结构、轨道类型约束），无校验、无 undo、无视觉反馈，token 成本极高且必然出错。
3. **写引擎全部困在 iframe**。真正可 undo 的变更逻辑（`TimelineManager` / `CommandManager` / 各 `Command`）在 React `EditorCore` 单例内，background.js 只是整份 JSON 的持久化层（`readProject`/`writeProject`）。不存在 headless 编辑或 headless 导出路径。
4. **验证闭环缺失**。AI 改完看不到画面，无法以"渲染某一帧"的形式自检；也没有不变式校验（重叠、悬空、越界）与结构化验收。

## 2. 数据层现状（本 RFC 的地基调研）

设计前先确认了数据层的四个事实，它们决定了"模式转换"的真实工作量：

**F1 · DocumentData 与持久化同形。** iframe 的 `ProjectManager.active`（一个 `TProject`）与后台 `editor_projects.project_json` 结构一致；序列化仅是 `stripAudioBuffers` + `Date → ISO` + JSON（`storage/service.ts` `serializeProject`）。状态真相链为：`TimelineManager.updateTracks → ScenesManager.updateSceneTracks → 替换 active.tracks + 镜像进 ProjectManager.active.scenes + notify`。**因此本 RFC 不需要发明新文档格式——DocumentData 就是现有 TProject。**

**F2 · 命令是 snapshot-undo、强耦合 EditorCore。** 以 `UpdateElementsCommand` 为例：`execute()` 里 `savedState = EditorCore.getInstance().scenes.getActiveScene().tracks`，`undo()` 恢复该快照（`commands/timeline/element/update-elements.ts`）。命令依赖 React 单例与管理器闭包，不可在后台直接复用；但"快照式 undo"本身是纯数据操作，可原样搬到后台。ripple（`ripple/{diff,apply,shift}.ts`）与更新管线（`timeline/update-pipeline.ts` `applyElementUpdate`）是**纯函数**（输入输出均为 `SceneTracks`），可抽离。

**F3 · goja 运行时无长驻 JS 状态。** 平台每次调用都全新执行 `background.js` 并建立新 VM（`service/runtime.go`）。因此后台的 undo 日志、op 日志、aiLock 等一切可变状态必须落 sqlite，不能放 JS 内存。

**F4 · 前端同步链路已就绪，缺事件与应用端。** realtime WS `project` channel 已实现（`rfc/2026-08-14-realtime-channel-ws.md`），宿主 `standalone-app-client.tsx` 订阅并转发 `recut.project.event`，iframe SDK `recut.events.subscribe` 已存在（`src/recut/sdk.ts:123`）。现状 iframe 只在启动时 `project.load` 一次、此后只往外推 save，**从不接收外部项目变更**——所以同步要做的是"事件协议 + 应用端重放"，传输不用重造。

## 3. 决策记录（已确认）

| # | 决策 |
|---|---|
| D1 | **操作驱动取代文档驱动**：MCP 工具 1:1 投影共享 Model API；AI 不再手写 TProject JSON |
| D2 | **Headless 共享 Model API 为唯一写入口**：抽取纯 `DocumentModelApi(doc, op)` 模块，UI 与 background 共用同一实现（含数据模型 RFC 的 D1 关键帧提交策略）。UI 的 `TimelineManager` 写方法收敛为对该模块的调用 |
| D3 | **AI 时间用秒**：MCP 输入一律秒（浮点），后台换算 120000 ticks/s；读取双返回（`startSec`/`startTicks`） |
| D4 | **统一 op 日志（本期实现）**：UI 的每次 commit 与 AI 的每个 op 都经 `timeline.command` 落同一 `editor_command_log`（快照式 undo，上限 200 条/项目）。`history.undo`/`redo` 是 AI 与 UI 共用的**单一 undo 权威** |
| D5 | **aiLock 锁**：AI 进入多步编辑会话时对 project 打 `aiLock`，iframe 收 `project:locked` 进入只读提示或自动 reload；AI 显式 unlock 或空闲超时解锁。确定性高，避免并发观感问题 |
| D6 | **同步双档**：P1 广播版本号（`project.document.changed {version}`）+ 前端整份 reload（REST `project.load` 兜底）；P2 升级为 op 描述符增量广播（前端平滑重放，无需 reload） |
| D7 | **双模导出**：`export.start({ mode: "ui" })`（现有 iframe 编码）与 `export.start({ mode: "headless" })`（Playwright 无头 Chromium 跑共享 Visual Runtime + ffmpeg，复用数据模型 RFC Phase G 基建）。返回平台 jobId，用 `recut.job.*` 观察终态 |
| D8 | **Skill 分层**：`SKILL.md` 骨架 + `references/` 按需子文档（对齐 remotion-studio/vox-broll 的 references 模式） |
| D9 | **冲突防护**：每条写（含 UI save 与 AI op）携带 `baseVersion`；后台 `update ... where version = base_version`（sqlite 条件更新保证原子）；不中返回 `{ conflict: true, currentVersion, opsSince }`，调用方 reload 或重放 |

### 3.1 决策间的联动

- D4 统一日志 + D5 aiLock：aiLock 是"AI 独占会话"的会话级栅栏；统一日志是"两者写入串行且可统一回退"的机制。unlock 后 UI 与 AI 都在同一日志上写。
- D6 的 P1/P2 与 D4 无关：无论日志是否统一，前端同步都先走版本号后升级 op 广播。P2 的 op 广播恰好复用 D4 的日志条目（op 描述符即广播载荷）。

## 4. 模式转换：四件事

> 结论先行：**不需要换数据格式，需要迁移写引擎并补齐 undo/redo、冲突、前端同步三件事。**

### 4.1 解耦：把写逻辑从 React/EditorCore 抽出（共享 Model API）

**可搬入共享核心的纯逻辑**（无 React/DOM 依赖，输入输出为纯数据）：

| 模块 | 职责 |
|---|---|
| `timeline/update-pipeline.ts` | `applyElementUpdate`（retime/trim/duration 联动） |
| `ripple/{diff,apply,shift}.ts` | 波纹编辑调整计算与应用 |
| `retime/*` | rate clamp、source-span ↔ timeline-duration 数学 |
| `animation/keyframes.ts` | D1 关键帧 upsert/remove/resolve、插值 |
| `timeline/creation.ts` | 元素工厂与 params 默认值 |
| `timeline/placement` | auto 轨道/插入位计算 |
| `masks`/`effects` 参数逻辑 | 蒙版与效果参数校验/默认值 |

**必须留在 UI**：React hooks、zustand（`timeline-store` 等）、`PlaybackManager`/`AudioManager`/`RendererManager`、ephemeral overlay（drag/hover 槽，数据模型 RFC D2）、`SelectionManager`、`ClipboardManager`、keybindings、渲染路径。

**前置风险核查**：
- `update-pipeline`/`retime` 依赖 `@/wasm` 的 `roundMediaTime` / `ZERO_MEDIA_TIME`——迁移时确认这些是纯 TS tick 数值函数（MediaTime 数学），若是真 wasm 边界则把共享核心编译为同时可被 node（后台）与浏览器（UI）加载的 bundle。
- `updateElementTrim` / `splitElements` / `duplicateElements` 等当前以 manager 方法 + command 双层实现，抽取时**只保留 command 层为唯一实现**，manager 方法退化为"构造 command 并交给 Model API"。
- 元素 ID 生成、track 能力约束（video/image/text/graphic/effect 各自轨道类型）、`sourceUrl`（library audio）等不变式，抽取时全部汇入 §6.3 的 `timeline.validate` 校验集（现状只有 UI 路径隐式保证）。

**共享模块的形态**：`apps/editor/model-api/`（纯 TS，无 `@/` 别名依赖，显式注入 time 数学与校验），同时被 `ui/src`（vite alias）与 `background.js`（bundled entry）引用。用 esbuild 打一个 `model-api.cjs` 供 goja `require`，UI 侧直接 import 源码。

### 4.2 undo/redo：统一 op 日志落 sqlite

goja 无长驻状态（F3），日志必须持久化：

```sql
create table if not exists editor_command_log (
  seq            integer not null,
  project_id     text    not null,
  op_json        text    not null,          -- op 描述符（可 JSON、可重放，§5.3）
  before_tracks_json text not null,         -- 受影响 scene 的 tracks 快照（F2 快照式 undo）
  base_version   integer not null,
  result_version integer not null,
  created_at     text    not null,
  primary key (project_id, seq)
);
-- 上限：每项目保留最近 200 条；超出时删最旧（seq 最小的）并维护 compact 基线。
```

- **写入**：任何 mutation（AI op 或 UI commit）→ 读 doc + baseVersion → `ModelAPI.apply(doc, op)` → 快照 before_tracks 与 doc 一起写回，version+1 → append 日志 → 广播。
- **undo**：取 `seq` 最大条目 → 恢复 `before_tracks_json`（覆盖该 scene tracks）→ 删除该日志条目 → version+1 → 广播。redo 反之重放 op。
- **快照体积**：`UpdateElementsCommand` 现只快照 active scene 的 tracks（百 KB 级），200 条上限可接受；必要时改存受影响 tracks 引用。
- **统一性（D4）**：本期 UI 的 commit 也经 `recut.background.call("timeline.command", { op })` 落同一日志。UI 保留本地快路径渲染（drag/hover 走 ephemeral），`pointerup`/离散动作才作为 command 出后台——离散操作的往返延迟可接受。后台为唯一 undo 权威，`history.undo` 对 AI 与 UI 一致。

### 4.3 冲突与并发：baseVersion 乐观锁 + aiLock 会话锁

**冲突矩阵**：

| 写者 × 写者 | 机制 | 结果 |
|---|---|---|
| 后台 × 后台（AI 并发 op） | 每项目串行队列 + `where version=base` | 无丢失，后到者 baseVersion 不中则重读重放 |
| 后台（AI）× 前台（UI commit/save） | aiLock（会话级）+ baseVersion | 会话内互斥；非会话时按日志顺序 + 版本冲突重试 |
| 多 iframe tab | 同一版本号 + op 广播 | 同单 tab 规则 |

- **原子性**：后台 mutation 用 `update editor_projects set project_json=?, version=?+1 where project_id=? and version=?` 条件更新；不中返回 `{ conflict: true, currentVersion, opsSince }`。
- **aiLock 协议**：
  - `project.lock`（AI 进入多步会话）→ `editor_projects.ai_lock = { owner, since, last_op_at }`，广播 `project:locked {version}`。
  - iframe 收 `project:locked` → 暂停本地写（`SaveManager.pause()`）→ 只读提示或自动 reload 到最新版本。
  - `project.unlock` → 清除锁并广播 `project:document.changed`。空闲超时（默认 5 分钟）自动解锁，锁期内 AI 心跳续期。
  - 锁只防"会话期 UI 写入"，**不阻止**非锁期双写——统一日志保证最终一致。
- **opsSince**：conflict 时返回 baseVersion 之后的 op 描述符列表（来自 `editor_command_log`），调用方据此重放合并而非整份 reload。

### 4.4 同步前端：版本号（P1）→ op 广播（P2）

传输复用 realtime WS `project` channel（F4）。新增事件协议：

```text
后台 append op / version bump 后：
  project.document.changed  { version, ops?: op[] }        -- ops 缺省 = P1（仅版本号）
                                                            -- P2 携带 baseVersion 之后 ops 增量
  project.document.reload   { version }                     -- ops 过大 / 客户端离线太久，走整份
  project:locked            { version, owner }              -- aiLock 会话开始（P1）

iframe 应用端（recut.events.subscribe）：
  P1：收 document.changed {version} 且 version > 本地 → project.reload（REST project.load）→ ScenesManager.initializeScenes + CommandManager.clear
  P2：收 document.changed {version, ops} → 逐条 CommandManager 重放（UI 的 CommandManager 本就是这些 op 的执行器）
      → notify → 渲染/预览/导出自动一致；本地 pending ops 先应用远端再重放本地（引用冲突则提示）
```

- **op 广播的确定性要求**：op 描述符必须可 JSON、可重放（不依赖墙钟/随机）；ephemeral（drag/hover 槽）不上日志不上广播。
- **AI staging 槽**：`preview.frame` 前的临时变更在后台 doc 上另开 ephemeral 槽（`ai-preview`），与 iframe 的 drag/hover 槽分离，绝不进入日志，直到 `preview.commit` 一次落地。
- **P1 reload 的观感代价**：AI 编辑期间前端整份 reload 可接受（配合 aiLock 只读提示）；P2 升级为 op 重放后前端平滑。

## 5. MCP 工具面设计

> 命名沿用平台约定 `recut.editor.<op>`（manifest operations + `recut.operation.register` + mcp surface）。`*` = 改造/升级现有操作。时间输入一律秒（D3）。每个 mutation 返回 `{ refs, version, delta }`（delta 为受影响元素 condensed 变更，非全量 doc）。

### 5.1 完整清单

**Context / Read（只读）**
| op | surfaces | 说明 |
|---|---|---|
| `workflow.context` * | api+mcp | 升级：返回 stage/settings/时间线 condensed 摘要/registeredAssets/allowedActions/paths + **version + aiLock 状态** |
| `timeline.read` | mcp | condensed 摘要：轨道 + clips（id/type/startSec/durationSec/trimSec + transform/opacity/volume/text 子集 + keyframe/effect/mask 计数）。token 高效，覆盖 workflow.context 的摘要详情 |
| `element.get` | mcp | 单元素全量 params/animations/effects/masks + 关键帧摘要 |
| `timeline.validate` | mcp | 不变式校验（见 §6.3），返回 violation 列表 |
| `project.get` | mcp | settings（fps/canvas/background）+ version + 锁定状态 |

**Project / Settings**
| op | surfaces | 说明 |
|---|---|---|
| `project.updateSettings` | mcp | fps/canvasSize/background（undoable command） |
| `project.rename` | mcp | 改名 |
| `project.lock` / `project.unlock` | mcp | aiLock 会话（D5） |
| `timeline.assets` * | api+mcp | 登记（现有） |

**Structure**
| op | 说明 |
|---|---|
| `track.add` / `track.remove` | 加/删轨道（type: video/text/audio/graphic/effect） |
| `track.mute` / `track.visible` | 静音/显隐 |
| `element.insert` | 建元素（7+1 种：video/image/text/graphic/component/audio/effect），placement 显式 trackId 或 auto trackType；返回 ElementRef |
| `element.delete` / `element.duplicate` / `element.move` | 删/复制/移动（跨轨道、排序） |
| `scene.create` / `scene.delete` / `scene.rename` / `scene.switch` | 场景管理 |
| `bookmark.add` / `bookmark.remove` | 书签 |

**Clip 编辑**
| op | 说明 |
|---|---|
| `element.trim` | trimStart/trimEnd/start/duration，支持 ripple 语义与 snap（到 playhead/边缘） |
| `element.split` | 在 t 处分割（retainSide: both/left/right） |
| `element.retime` | 0.01–5x，maintainPitch |
| `element.sourceAudio` | 分离/恢复源音频 |
| `element.mute` / `element.visible` | 元素级静音/显隐 |

**Params / Animation**
| op | 说明 |
|---|---|
| `element.param` | 设置 params（含 D1 关键帧提交策略：属性有关键帧 → 落关键帧；无 → 写基础值） |
| `element.transforms` | 批量 position/scale/rotate（D1） |
| `keyframe.upsert` / `keyframe.remove` / `keyframe.retime` / `keyframe.curve` | 关键帧增删改时/贝塞尔手柄与 tangent |
| `effect.add` / `effect.remove` / `effect.reorder` / `effect.toggle` / `effect.param` | 逐元素效果 |
| `mask.add` / `mask.param` / `mask.points` | 9 种蒙版 + freeform 点 |

**Preview / History（验证闭环）**
| op | 说明 |
|---|---|
| `preview.frame` | 在 t 处渲染当前 doc（+可选 staging 覆盖）为 PNG → 导入图片 Asset 返回 assetId（AI 读图自检） |
| `preview.commit` / `preview.discard` | ai-preview staging 槽一次性落地 / 丢弃（§4.4） |
| `history.undo` / `history.redo` | 统一 op 日志回退/重做（D4） |

**Export**
| op | 说明 |
|---|---|
| `export.start` * | 升级：`{ mode: "ui" \| "headless", width, height, fps }`；headless 返回平台 jobId（D7） |
| `export.status` | 轮询 headless 导出进度（经 `recut.job.status` 或独立 op） |
| `export.cancel` | 取消 |
| `export.list` * | 现有 api op 提升为 mcp |

**Components / Import**
| op | 说明 |
|---|---|
| `component.define` / `component.verify` / `component.list` / `component.source` | 来自 ai-temp-components RFC（head 跟随 + 验证闭环） |
| `film.package.import` * | 现有（AI 短片交接包铺稿） |

### 5.2 op 描述符（日志与广播的统一载荷，§4.2/§4.4）

```ts
type Op = {
  type: "insert" | "delete" | "duplicate" | "move" | "trim" | "split" | "retime"
      | "update" | "set-param" | "set-transform" | "keyframe-upsert" | "keyframe-remove"
      | "effect-add" | "effect-remove" | "effect-param" | "mask-add" | "mask-param"
      | "track-add" | "track-remove" | "track-mute" | "track-visible"
      | "scene-create" | "scene-delete" | "scene-rename" | "bookmark-add" | "bookmark-remove"
      | "settings" | "source-audio";
  payload: Record<string, unknown>;   // 具体字段由 Model API 定义；tick 由后台换算
  baseVersion: number;
};
```

- 约束：**可 JSON、可重放、确定性**（禁墙钟/随机）；ephemeral 不上日志。
- UI 的 CommandManager 逐步收敛为"构造 Op → `timeline.command` 落地"，使 UI 本身成为 op 执行器的同时对后台可见。

### 5.3 工具输入契约要点

- 时间：`element.trim({ ref, startSec?, durationSec?, trimStartSec?, trimEndSec?, ripple?, snapToPlayhead? })`。
- 引用：`ElementRef = { trackId, elementId }`；`timeline.read` 返回所有合法 ref 供引用。
- 位置：canvas 坐标（positionX/Y 相对画布中心，单位与 params 一致），scale 为倍率。
- 素材：一切 `mediaId`/`assetId` 必须是真实平台 assetId（`recut.media.list_assets` 发现），`timeline.validate` 强制校验。

## 6. 数据契约

### 6.1 ElementRef 与 condensed 摘要

```ts
type ElementRef = { trackId: string; elementId: string };
type CondensedClip = {
  ref: ElementRef; type: "video" | "image" | "text" | "graphic" | "component" | "audio" | "effect";
  name: string;
  startSec: number; durationSec: number; trimStartSec: number; trimEndSec: number;
  params: {                 // 只读子集，token 高效
    transform: { positionX; positionY; scaleX; scaleY; rotate };
    opacity; volume; blendMode;
    text?: { content; fontSize; color };     // text 元素
  };
  keyframeCount; effectCount; maskCount; muted; hidden;
};
```

### 6.2 秒 ↔ tick

- 内部一律 `tick = round(sec * 120000)`；读取双返回 `*Sec` 与 `*Ticks`。120000 整除秒为整数，浮点误差由 `roundMediaTime` 收敛。

### 6.3 timeline.validate 不变式

| 检查 | 说明 |
|---|---|
| `asset-exists` | 每个 `mediaId`/`sourceUrl` 是已登记真实资产（`timeline.assets`） |
| `track-type` | 元素 type 与轨道 type 匹配（video/image→video 轨，text→text 轨…） |
| `overlap` | 主轨同轨道元素不重叠（可接受，报告位置） |
| `out-of-range` | trim 不越 sourceDuration；元素不越项目边界 |
| `duration>0` | start/duration 合法 |
| `component-def` | `type:"component"` 的 `componentId` 存在于 `editor_components` |
| `param-valid` | params 键/值符合 `params/registry.ts` 定义（数值类型、blend 枚举、fontSize 范围） |

违反返回 `{ ok: false, violations: [{ code, ref?, detail }] }`；AI 在 `export.start` 前应自检为零违反。

## 7. 预览与验证闭环

AI 的"看见"闭环三件套（D1/D5 + ai-temp-components 复用）：

1. **`preview.frame`**：后台把当前 doc（或 staging 覆盖）交给 headless 渲染器（Playwright 无头 Chromium 页跑共享 Visual Runtime，见 §8），在 t 时刻渲一帧 PNG → `ctx.media.importFile` 为图片 Asset → 返回 `assetId`。AI 用平台读图能力自检画面（构图、文字、蒙版、关键帧插值）。
2. **`timeline.validate`**：结构化不变式校验，先于视觉、成本低。
3. **`history.undo`**：任何一步不满意的修改即时回退，不污染后续状态。

配合 ai-temp-components 的 `component.verify`（已知好/坏组件各出一份报告），AI 对"代码素材"与"摆布素材"两条线都有可读反馈。

## 8. Headless 导出（D7）

- 渲染器是 R3F + HtmlInCanvas，必须跑在浏览器。headless 路径 = Playwright 无头 Chromium 加载 `export-harness.html`：
  - 经 `?projectId=` + api op（`project.load` / `timeline.command` 重放）拿到 doc → 用共享 Visual Runtime 逐帧 offscreen 渲染 → WebCodecs 编码 或 逐帧 PNG 经 ffmpeg 合成（`ctx.shell.exec`）。
- `export.start({ mode: "headless", ... })` 提交后台 shell job，返回平台 jobId；`export.status`/`recut.job.status` 轮询；完成时走现有 `importFile → setCover` 流程（沿用 background `export.complete` 的资产落库逻辑）。
- **一致性**：headless 与 `mode:"ui"` 共用同一 Visual Runtime + 确定性契约（visual-runtime RFC §4.6/§9），Preview==Export 逐帧一致；headless 还需与 UI 导出做首帧/时长一致性回归（§11.4 E1）。
- **基建复用**：数据模型 RFC Phase G 的 Playwright chromium（swiftshader）+ `window.__recutTest` 桥直接支撑 headless 渲染 harness。

## 9. Skill 定义

```
skills/recut-editor/
├── SKILL.md          定位 / 心智模型（AI=导演，MCP=可 undo 的剪辑台）/
│                     工作流 loop（read→plan→preview→commit→verify→export）/
│                     工具矩阵（何时用哪个 op）/ 门禁（aiLock、validate 零违反、assetId 真实）/
│                     禁止（不手写 TProject JSON、不臆造 assetId、不引用 api-only 操作）/
│                     导演参考入口 + 与 Remotion（纯代码）的核心差异
└── references/
    ├── data-model.md         ElementRef、CondensedClip、秒↔tick、轨道与 7+1 元素、版本/锁语义
    ├── timeline-workflow.md  op 目录 + 粗剪→精修→验证→导出 编排模式（含 film.package.import 铺稿）
    ├── params.md             全 params 键 + 默认值 + 单位（visual/audio/text/graphic/effect）
    ├── keyframes.md          动画路径、linear/hold/bezier、D1 提交策略、关键帧工具
    ├── components.md         AI 临时组件 · 工具与 SDK 契约（define/verify/list/source + @recut/runtime）
    ├── component-authoring.md AI 临时组件 · 创作指南（surface 决策、inputs 设计、确定性动画、三 surface 示例、验证迭代）
    ├── directing.md          导演语言（品牌→参数预设、5s 节拍、镜头动词→transform 配方、自检清单）
    ├── shot-library.md       镜头配方库（开场/转场/运镜/节奏/注意力 10 个时间线 op 配方）
    ├── music-beat-sync.md    卡点方法论（BPM 拟合 → beatT(n) 拍号排片 → 切点/关键帧落拍 → 渲后回测）
    ├── captions.md           字幕实践（text 元素、≥40px、无底框、下三分之一）
    └── preview-export.md     preview.frame 视觉验收、headless/ui 双模导出、封面设置
```

- `SKILL.md` 只放骨架；数据字典/params/关键帧语义拆进 references 按需加载（`recut.skills.read`/`recut.skills.reference`），对齐 remotion-studio/vox-broll 模式（D8）。
- **同步删除 SKILL 中一切对 `project.load`/`project.save` 的手写 JSON 指引**——那是 mcp 不可达路径，替换为对 Model API 工具的调用。

## 10. 分阶段实施路线

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P1**（本期） | ① 共享 `model-api/` 抽取（update-pipeline/ripple/retime/keyframes/creation/placement 纯化 + `@/wasm` 数学核查）② `editor_command_log` + `timeline.command`/`history.undo/redo` + UI commit 走统一日志 ③ 核心读写工具：`timeline.read`/`element.get`/`element.insert/delete/trim/split/param`/`project.get/updateSettings` ④ aiLock（`project.lock/unlock` + iframe `project:locked` 只读）⑤ 版本号同步（`project.document.changed`→reload）⑥ `timeline.validate` ⑦ `preview.frame`（headless 渲染 harness 首版）⑧ skill 骨架 + data-model/params references | 见 §11 各层 |
| **P2** | op 描述符增量广播（前端平滑重放）；完整工具面（effects/masks/keyframes curves/scenes/bookmarks/retime/sourceAudio/track.*/element.move/duplicate）；`export.start(mode:headless)` 完整版 + ffmpeg | 双源一致性 e2e；op 重放幂等 |
| **P3** | preview.commit staging 槽全流程；headless 导出与 UI 导出首帧/时长一致性回归；export.status/cancel 平台 job 观察 | 一致性回归 |
| **P4** | references 全套 + component.* 工具整合 + 多 tab 并发 + 双源（UI/AI）回归 e2e + `ARCHITECTURE.md`/rfc 反向更新 | 完整回归 |

## 11. 端到端验证方案

> 分层原则：L0 纯逻辑单测（node）→ L1 后台集成（真实 goja + sqlite）→ L2 Playwright 双源/渲染一致性 → L3 MCP 全流程用户旅程 → L4 现有回归。基建复用：编辑器 UI 已有 `tests/e2e` + `window.__recutTest` 桥 + `?test=1` 确定性种子（数据模型 RFC Phase G），平台已有 `make service-test`（`go -C service test .`）与 `make editor-ui-build`。

### 11.1 L0 · Model API 单元测试（`ui/tests/model-api/*.spec.ts`，node + vitest 或裸 assert）

| 套件 | 断言 |
|---|---|
| `apply.spec` | 每个 op 在纯 doc 上正确：insert（auto 轨道/显式轨道）、delete（级联清理引用）、duplicate、move、trim（ripple 开关）、split（both/left/right）、retime（0.01–5x 与 source-span 换算） |
| `keyframe-d1.spec` | `set-param`/`set-transform`：属性有关键帧 → 在 atTime 落/更新关键帧；无 → 写基础值；缩放不再清关键帧（复刻数据模型 RFC D1 行为） |
| `undo-redo.spec` | 快照式 undo 跨命令正确：split→undo 恢复原元素；多元素移动→undo 恢复；redo 重放 op 幂等（同 doc 两次 apply 结果一致） |
| `ripple.spec` | 对 before/after tracks 的 compute+apply 波纹调整与 UI 现有 `ripple` 纯函数输出一致（golden 对照） |
| `validate.spec` | 7 类不变式全部命中对应 violation code |

### 11.2 L1 · 后台集成测试（Go service 测试 or node 直跑 background.js）

| 套件 | 断言 |
|---|---|
| `command_log` | `timeline.command` append 后 sqlite 有日志条目；version 递增；undo/redo 后 version 与 doc 正确 |
| `version_conflict` | baseVersion 过期写被拒，返回 `{conflict, currentVersion, opsSince}`；条件更新原子（并发两写仅一成功） |
| `ailock` | lock→后续 UI save 返回 locked；unlock→恢复；超时自动解锁 |
| `project_sync_event` | 每次 mutation 广播 `project.document.changed`，载荷 version/ops 正确（复用 service `eventbus`/`project` channel 测试基建） |
| `asset_registration` | 未登记 assetId 的 insert 被 `timeline.validate` 拦截；`timeline.assets` 覆盖式登记生效 |

### 11.3 L2 · Playwright 双源/渲染一致性（`ui/tests/e2e/`）

| spec | 场景 | 断言 |
|---|---|---|
| `model-api.spec` | 用同一确定性种子 doc：后台 Model API 逐 op 应用 vs UI CommandManager 逐命令应用 | 两种路径产出的 doc JSON 深度相等（`JSON.stringify` golden） |
| `op-replay.spec` | P2：iframe 收 `project.document.changed {ops}` 重放后 | `__recutTest.getNodeBounds`/`getResolvedTransform` 与后台 doc 解析结果一致（复用 bbox 基建） |
| `preview-frame.spec` | `preview.frame` 渲染 t=0/1s 关键帧时刻 | 返回图片 Asset 非空；两次同 t 渲染像素哈希一致（确定性） |
| `synced-edit.spec` | 打开 iframe → AI 经后台改 doc（版本号同步 P1 reload / P2 op 重放） | iframe 画面出现新元素且 bbox 正确；期间本地未提交编辑按 §4.4 处理不丢失 |
| `conflict-recovery.spec` | iframe 持有旧版本时 AI 写入 → iframe save 被拒 → reload 到新版本 | 无数据丢失；UI 提示可见 |

### 11.4 L3 · MCP 全流程用户旅程（真实 daemon，`make service-test` + 手动脚本）

**场景 A · AI 完整成片**（happy path，每步断言前置状态）：
```
project.create({fps, canvas, background, materialAssetIds})
timeline.read → element.get（素材可见）
element.insert（主轨视频，真实 assetId）→ element.insert（文字轨标题）
element.trim（裁剪）→ element.param（transform/opacity）→ keyframe.upsert（入场动画）
preview.frame(t=1s) → 读图断言非空
timeline.validate → violations 为空
history.undo ×1 → timeline.read 确认回退 → history.redo
export.start({mode:"headless"}) → recut.job.wait → export.status completed
导出 assetId 存在且被 setCover
```

**场景 B · 并发与冲突**：B1 后台-后台并发两 mutation → 版本连续无丢失；B2 AI lock → iframe `project:locked` 只读 → AI unlock → reload 可见；B3 baseVersion 过期写 → 收到 conflict + opsSince 后重放成功。

**场景 C · 前端同步**：C1 P1 版本号 reload 后 iframe 与后台一致；C2 P2 op 重放后渲染几何一致；C3 多 tab 全部收敛。

**场景 D · 统一 undo**：D1 AI op undo → UI 同步；D2 UI commit（经 `timeline.command`）→ 后台日志可见 → AI `history.undo` 生效；D3 snapshot undo 跨命令正确。

### 11.5 L4 · 导出与回归

| 检查 | 断言 |
|---|---|
| `E1 headless-vs-ui` | 同参数 `mode:"ui"` 与 `mode:"headless"` 导出的首帧截图、时长、帧数一致（含 text/effect/mask/关键帧动画） |
| `E2 回归` | 数据模型 RFC Phase G 四个 spec（click-select/bounds-geometry/drag-sync/keyframe-drag）在 Model API 抽取后不回归；`make check`（service-test + service-vet + web-build）通过 |
| `E3 skill 一致性` | `recut.skills.read` 的 references 与实现一致（data-model/params 与真实类型 diff 为零）；SKILL 不再引用 api-only 操作 |
| `E4 工具清单` | `tools/list` 断言全部 `recut.editor.*` mcp 操作存在且 schema 含 `__recut` 信封；UI 编辑全流程回归（放/拖/剪/关键帧/导出） |

### 11.6 验证运行命令

```bash
make editor-ui-build                 # UI bundle
cd apps/editor/ui && npm run test:e2e # L2/L4 Playwright（含 ai-component/model-api/op-replay 等）
make service-test                    # L1 后台集成 + L3 部分（service Go 测试）
node ui/tests/model-api/*.spec.ts    # L0 纯逻辑
```

## 12. 边界与未决

- **本期不含**：跨项目复用、多用户实时协作（多 tab 是"同一 doc 的同步"，不是 CRDT 协作）、17 种 PS 混合超集模式、服务端 inputSchema 校验（见 §13）。
- **aiLock 是会话级互斥**，非权限系统；UI 在非锁期仍可与 AI 并发写（统一日志保证最终一致），P1 观感以只读提示为主。
- **P1 reload 观感代价**：AI 编辑时前端整份 reload；若实测不可接受，提前切 P2 op 广播（工具面不变，仅应用端升级）。
- **snapshot 体积**：多元素 scene 的 tracks 快照可达数百 KB，200 条上限需在实现时基准（必要时降级为受影响引用 + compact 基线）。
- **`@/wasm` 数学函数**：`roundMediaTime`/`ZERO_MEDIA_TIME` 须核查为纯 TS 后才可进共享核心。

## 13. 平台依赖（后续 RFC，不展开设计）

- operation 级权限声明（如对 `timeline.command` 限 `shell`/`files` 无关的轻权限）；
- 服务端 inputSchema JSON Schema 校验与 inputSchema/payload 上限（现状 `service/mcp.go` 无校验、无 LimitReader）；
- 按需工具过滤（session/项目粒度，现状 tools/list 静态全量）。
