<!--
 * [INPUT]: 依赖 service 的通用受限子 Agent runner（subagent.go）、AgentJob 生命周期（agent_jobs.go）、
 *          AgentManager 的事件账本与事件解析（agent.go 的 handleCodexEvent / handleOpencodeEvent / emit、
 *          runCodex 的 stdout 事件流扫描模式）、MCP 工具分发（mcp.go）、
 *          统一实时 WS（ws.go / eventbus.go / forwarders.go）、agent_sessions / agent_events schema（project.go），
 *          web 端的 Agent 事件渲染（agent-panel-views.tsx / agent-panel-types.ts）、实时通道单例（realtime-channel.ts），
 *          以及 apps/editor 的 component.create / component.revise subAgent op。
 * [OUTPUT]: 定义"子 Agent 任务卡片 + 全局预览弹框"的设计：子 Agent 会话与通用 Agent 会话同构（同一账本、
 *           同一事件解析、同一 WS 通道），仅工具面受限；执行一次性但记录持久化、可审计、可实时观察。
 *           工具事件携带 subagentId 判别字段 → 前端自动渲染任务卡片（状态 + 阶段 + 实时耗时）→
 *           点击卡片弹全局状态视图（本质就是 chat 的 Conversation 渲染子会话 + subagent Meta 头），
 *           统一经单条 WS（agent channel 子会话事件 + subagent channel job 生命周期）。
 *           并论证"用户向子 Agent 发消息"的交互边界（同会话续谈 Phase 2 可行；运行中插话不可行）。
 * [POS]: rfc 的实施蓝图；获批后作为 Go service、web 宿主、测试的共同落地契约，不改主 Agent 工具契约。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# Technical RFC: Subagent Task Card & Global Preview（子 Agent 任务卡片与全局预览）

- 状态：草案（未实施）
- 依赖：现有 `startAppSubAgentJob` / `runFocusedSubAgent`（subagent.go）、`AgentJob`（agent_jobs.go）、
  AgentManager 事件解析/账本（agent.go `handleCodexEvent` / `handleOpencodeEvent` / `emit` / `runCodex` 的
  stdout 事件流扫描）、`agent_sessions` / `agent_events`（project.go:409）、`mcpToolCall`（mcp.go）、
  `/v1/events` 单 WS + EventBus（ws.go / eventbus.go）、`realtime-channel.ts` 单例、
  `Conversation` / `ToolTimelineItem`（agent-panel-views.tsx）
- 日期：2026-08-18
- 目标版本：Phase 1（会话同构 + 事件落账本 + 卡片 + ws channel）→ Phase 2（全局预览弹框 + 同会话续谈）

## 1. 背景与动机

主 Agent（chat）调用 `recut.editor.component.create` / `component.revise` / `recut.agent.run` 等
`subAgent:true` 的 operation 时，平台返回一个受限子 Agent job（`kind:"sub-agent"`），主 Agent
随后用 `recut.job.status / wait / cancel / logs` 观察。**但 Chat UI 对用户是"黑盒"，且子 Agent 本身
无记录**：

- 工具调用只渲染成一行 `ToolTimelineItem`（label + 状态点 + 耗时），用户看不到"子 Agent 正在干活"
  的直观呈现；子 Agent 内部处于 authorize / run / finalize 哪个阶段完全不可见。
- job 状态变化只有主 Agent 主动 `recut.job.status` 查询才可见，没有实时推送；主 Agent 靠 wait 轮询，
  期间用户得不到任何进度反馈。
- 子 Agent 内部实际做了什么（调用了哪些受限工具、结果如何）只在 finalize 回传的 `subAgentTools`
  里折叠出现一次，过程不可见。
- **设计缺陷（本文档要修正）**：`runFocusedSubAgent` 把子 Agent CLI 的 stdout 丢进 `io.Discard`
  （subagent.go:126），child session 经 `bridge.CreateSession` 创建但不落 `agent_sessions` 账本。
  子 Agent 执行无任何持久化记录，**不可审计**。

**核心原则（本 RFC 的第一性设计）**：

> 子 Agent 与通用 Agent 的差异**只有工具面受限（AllowedTools）**，其他维度不应有任何差异：
> 同一会话账本、同一事件解析、同一 WS 通道、同一可观察性、同一审计链。执行形态可以是一次性的
> （受限只读 sandbox 短命进程），但**记录必须是持久的**——启动、消息、工具调用、错误、job 生命周期
> 全部落账本，可追溯、可回放。

**目标**：

1. 子 Agent 会话**落 `agent_sessions` / `agent_events` 账本**，事件解析与父会话完全同构
   （复用 `handleCodexEvent` / `handleOpencodeEvent`），提供完整审计。
2. 工具调用事件携带一个 `subagentId` 判别字段；chatagent 前端识别到该字段即自动渲染"子 Agent 任务卡片"。
3. 点击卡片弹出**全局状态视图**：job 状态、阶段、子 Agent 活动流、耗时、取消；该视图**本质就是
   chat 的 Conversation**（渲染子会话的 turns + 事件），只是多了子 Agent 的 Meta 头。
4. 卡片带实时时间 counter（做了多久）。
5. 全程走统一 WS 消息通道（现有 `/v1/events` 单连接）：子会话事件走既有 `agent` channel
   （key = childSessionId），job 生命周期走新增 `subagent` channel（key = jobId）。

## 2. 范围与不变量

1. 只对 `subAgent:true` 的 op 与 `recut.agent.run` 生效——共同入口是 `startAppSubAgentJob`，
   服务端只在这一处接线，无 App 专属代码。
2. **不改主 Agent 的工具契约**：工具仍返回 `{id, kind:"sub-agent", status, phase, ...}` job view，
   主 Agent 仍可用 `recut.job.*` 观察/轮询。任务卡片与预览弹框是纯 UI 叠加。
3. **子 Agent 会话与通用会话同构**：child session 落 `agent_sessions`，其事件落 `agent_events`，
   事件类型/载荷与父会话一致（tool.*、status、assistant.completed…），仅允许的工具面受限。
4. **执行一次性，记录持久化**：child 仍以受限只读 sandbox 的一次性 CLI 进程执行（workspace 用完即删），
   但其会话行、事件行、job 生命周期行持久化在账本中，daemon 重启后仍可查询/回放（审计）。
5. 复用统一 WS（`/v1/events`）+ EventBus；子会话事件复用既有 `agent` channel 与 forwarder，
   新增 `subagent` channel 只承载 job 生命周期（可经账本过滤回放），不新增长连接。
6. 不做跨 tab 同步（每 tab 一条 WS，行为与现状一致），不引入 SharedWorker。
7. 识别判别字段是 `payload.subagentId`（非空即渲染卡片）；`subagentAppId` / `subagentOperation`
   是配套展示 Meta，不作为判别条件。

## 3. 现状与问题（代码事实）

**数据流现状**：

- `mcp.go:467` `operationIsSubAgent(app.Manifest, operationName)` 命中 → `startAppSubAgentJob`
  （subagent.go:183）→ `bridge.startAgentJob` → `runAgentJob`（agent_jobs.go:46）只有
  `queued → running/authoring → completed|failed|cancelled` 三次状态写入，无中间阶段，且**不落任何账本**。
- 工具返回 `jobView`；主 Agent 的 codex / opencode 事件流把该 JSON 放进 `tool.completed` 的 `output`
  字段（agent.go:1794 / 1707），**事件 payload 没有结构化的 `subagentId`**。
- 子 Agent 执行：`runFocusedSubAgent` 用 `opencode run` / `codex exec` 批量执行（subagent.go:114-116），
  stdout **被 `io.Discard` 丢弃**（:126），workspace 用完即删（:97），进程跑完即退出；child session
  不落 `agent_sessions`、无 `agent_events`。**子 Agent 完全不可审计。**
- 对照：父会话（`runCodex`，agent.go:989-1002）用 scanner 逐行读 stdout JSON → `handleCodexEvent`
  → `emit` 落 `agent_events` 并 notify WS。子 Agent 用的**是同一个 CLI、同样的 `--json` 输出**，
  只是被丢弃了——补齐解析即可同构。
- Chat UI `toolCalls()`（agent-panel-views.tsx:517）只把 `tool.*` 事件聚合成 `ToolCall`，
  `ToolTimelineItem`（:555）统一渲染，没有子 Agent 专用视图。

**具体痛点**：

1. 用户看到的是"创建组件素材 · component.create · running · 12s"一行小字，不知道子 Agent 在做什么。
2. **子 Agent 执行无记录**：无法审计"谁启动了哪个子 Agent、它做了什么、结果如何、失败原因"。
3. 无法在 chat 里点开一个子 Agent 任务看详情、取消、读诊断。

## 4. 目标架构

```text
主 Agent session（chat，普通 agent channel）
   │  tool: recut_editor_component_create（subAgent op）
   ▼
service mcpToolCall ──► startAppSubAgentJob（唯一入口）
   │                       │
   │  + subagentId 注册    ▼
   │                  AgentJob (kind=sub-agent)
   │                       │  authorize → run(child session) → finalize
   │                       ▼                     │
   │                child AgentSession           │
   │                ┌────────────────────────────┴───────────┐
   │                │ 与通用会话同构：                        │
   │                │  - 落 agent_sessions（受限工具面标记）   │
   │                │  - stdout JSON 事件流 → handleCodexEvent │
   │                │    / handleOpencodeEvent → agent_events  │
   │                │  - 账本 forwarder → agent channel        │
   │                │  - job 生命周期 → subagent channel       │
   │                └──────────────────────────────────────────┘
   │  tool.completed 事件
   │  payload += subagentId◄──── 注册表注入
   ▼
Chat UI  ToolTimelineItem
   │  检测 payload.subagentId（判别字段）
   ▼
SubagentTaskCard（任务卡片）
   │  状态徽标 / 阶段 / 实时耗时 counter / 点击展开
   ▼
SubagentPreviewDialog（全局弹框，createPortal → document.body）
   │  Meta 头（jobId/app/operation/status/phase/elapsed/cancel）
   │  + 主体 = Conversation（复用，渲染 child session 的 turns + 事件）── 本质就是 chat UI
   ▼
订阅: ws agent channel(childSessionId) + subagent channel(jobId)，REST 取 child 会话详情
```

关键决策：

- **同构是第一性设计**：子 Agent 事件流解析、账本写入、WS 推送**复用父会话的整条链路**，不新造
  "子 Agent 专属事件格式"。唯一差异是 `AllowedTools` 受限 + 会话带 `parent_session_id` / `job_id`
  关联。
- **判别字段单一**：`subagentId` 是 chat 工具事件 payload 上的结构化字段；前端看到它才渲染卡片。
  服务端在 subagent job 创建时注册 `session → {subagentId, appId, operation}`，主 Agent 事件流在发
  `tool.completed` 时消费该注册并注入 payload（§6.3）。不靠解析 output 字符串判别。
- **两条 WS channel 各司其职**：
  - `agent`（key = childSessionId）：子 Agent 完整活动流（工具调用、消息、状态），复用账本 forwarder，
    天然支持历史回放（agent 是 cursor 型 channel）。
  - `subagent`（key = jobId）：job 生命周期（status/phase/error/result/elapsedMs），事件同时落
    child 会话账本（`subagent.job` 类型），订阅时按 job_id 从账本过滤回放。
- **状态实时性走 WS**：job 每次 status/phase 变化 `bus.Publish("subagent", jobId)`；前端卡片/弹框
  订阅即实时，不依赖主 Agent 轮询。

## 5. 数据契约

### 5.1 工具事件 payload 扩展（判别字段）

```ts
// ToolPayload（agent-panel-types.ts）
type ToolPayload = {
  // ... 现有字段
  subagentId?: string;        // 判别字段：非空 ⇒ 前端渲染 SubagentTaskCard
  subagentAppId?: string;     // 如 "recut.editor"（Meta 展示）
  subagentOperation?: string; // 如 "component.create"（Meta 展示）
};
```

服务端只在 subagent job 创建成功时注入这三个字段；普通工具调用无此字段。

### 5.2 `agent_sessions` / `agent_events` schema 扩展（子会话同构落账本）

`agent_sessions` 增加（迁移：`ALTER TABLE ... ADD COLUMN`，幂等）：

```sql
alter table agent_sessions add column parent_session_id text; -- 审计链：父会话
alter table agent_sessions add column job_id text;            -- 审计链：关联 subagent job
alter table agent_sessions add column allowed_tools text;     -- 受限工具面 JSON，续谈时恢复
```

- 子会话行：`runtime`（继承父会话）、`title`（如 "子 Agent · component.create"）、`status` 随 job
  更新为 `completed / failed / cancelled`、`parent_session_id` 指向父会话、`job_id` 指向 AgentJob。
- 普通会话列表（`scope=general` 等）**过滤掉** `parent_session_id is not null` 的子会话，避免污染
  用户会话历史；审计/预览视图按 `job_id` / `parent_session_id` 查询。
- `agent_events` 无需扩展：child session 用同一账本，事件类型与父会话一致；job 生命周期写成
  `type="subagent.job"`、`session_id=childSessionId`、`payload` 含 job view。

### 5.3 AgentJob view 扩展

```json
{
  "id": "subagent_<id>",
  "kind": "sub-agent",
  "status": "queued | running | completed | failed | cancelled",
  "phase": "queued | authorizing | running | finalizing | complete",
  "appId": "recut.editor",
  "operation": "component.create",
  "childSessionId": "<child session id>",
  "parentSessionId": "<parent session id>",
  "result": { },
  "error": "",
  "createdAt": "…",
  "updatedAt": "…",
  "elapsedMs": 1234
}
```

- `phase` 由现状的 `queued / authoring / complete` 细化为 5 值：`authorizing → running → finalizing`。
- `childSessionId` 是核心关联：预览弹框据此取 child 会话详情与事件流。
- `parentSessionId` 提供完整审计链：父会话 → job → 子会话。

### 5.4 WS 协议扩展（`/v1/events`）

**子会话活动流 = 既有 `agent` channel**（key = `childSessionId`），帧与普通会话完全一致：
```json
{ "type": "event", "channel": "agent", "sessionId": "<childSessionId>",
  "data": { "type": "tool.completed", "payload": { "toolName": "recut.editor.component.commit", … } } }
```
复用现有 cursor 型订阅 + 账本 forwarder，历史回放免费。

**job 生命周期 = 新增 `subagent` channel**（key = `jobId`，event-driven 模式）：
```json
{ "type": "subscribe", "channels": [ { "channel": "subagent", "jobId": "subagent_<id>" } ] }
```
推送帧：
```json
{ "type": "event", "channel": "subagent", "jobId": "subagent_<id>",
  "data": {
    "event": "job.updated" | "job.completed" | "job.failed" | "job.cancelled",
    "job": { "id": "…", "status": "running", "phase": "running", "childSessionId": "…", "elapsedMs": 1200 },
    "error": ""
  } }
```
`runSubagentForwarder` 先按 job_id 从 child 会话账本回放 `subagent.job` 事件，再实时转发；job 不存在
发 `available:false`（与 cli/terminal forwarder 一致）。

### 5.5 REST 补充

- `GET /v1/agent-sessions/{childSessionId}` —— **已有**，返回子会话 Detail（turns + events），
  预览弹框首屏复用。
- `POST /v1/agent-sessions/{childSessionId}/turns` —— **已有**，Phase 2 同会话续谈（见 §7.6）。
- `POST /v1/jobs/{id}/cancel` —— 新增，映射 `bridge.cancelAgentJob`。
- `GET /v1/jobs/{id}` —— 新增（排障用），返回 5.3 view。

## 6. 服务端实现要点（Go）

### 6.1 子会话持久化 + 事件流落账本（核心）

`runFocusedSubAgent` 从"丢弃 stdout"改为"事件流解析落账本"，**与 `runCodex` 同构**：

- 给 subagent 执行路径注入 `AgentManager` 引用（`startAppSubAgentJob` 已有 `session`，经 Server 接线
  把 `*AgentManager` 传给 runner；或把 child 会话注册进 AgentManager 的会话集合）。
- 子会话创建后，落 `agent_sessions` 行（`parent_session_id`、`job_id`、`allowed_tools`、`runtime`、
  `title`、`status=idle`）；`createChildSession` 由 AgentManager 提供（复用既有插入逻辑 + 新字段）。
- stdout 事件流解析：
  ```go
  scanner := bufio.NewScanner(stdout)
  for scanner.Scan() {
      var raw map[string]any
      if json.Unmarshal(scanner.Bytes(), &raw) != nil { continue }
      switch session.Runtime {
      case "codex":     _ = m.handleCodexEvent(childSessionID, "", raw)
      case "opencode":  m.handleOpencodeEvent(childSessionID, "", raw)
      }
  }
  ```
  与 `runCodex`（agent.go:989-1002）同一套 `handleCodexEvent`，事件自然落 `agent_events` 并 notify WS。
- `RecordAgentToolCall` 保留（结构化结果供 finalize）；其内容同时已作为 tool.completed 事件进账本，
  审计一致。
- job 生命周期事件 `m.emit(childSessionID, "", "subagent.job", {status, phase, error, result, ...})`
  落账本——job 状态变化也**持久化、可审计**。
- workspace 仍用完即删（执行一次性）；会话行/事件行持久化（记录审计）。

### 6.2 三阶段显式 phase + 关联写入

- `startAppSubAgentJob` 写入 `AppID` / `Operation` / `ParentSessionID`，并调用
  `bridge.registerSubagentToolCall(session.ID, job.ID, appID, operation)`（§6.3）。
- `runDeclaredSubAgent` 三阶段显式更新 phase：authorize 前 `authorizing`；`runFocusedSubAgent` 前
  `running`（child 创建后写 `ChildSessionID` 与 agent_sessions 行）；finalize 前 `finalizing`；
  终态 `complete`。
- 每个 phase/status 变化：内存更新 + `m.emit(childSessionID, ..., "subagent.job", view)` +
  `bus.Publish("subagent", jobID, frame)`。

### 6.3 `bridge.go`：subagent 关联注册表

- 新增 `subagentToolCalls map[string]subagentInfo`（key = parent session id）：
  ```go
  type subagentInfo struct {
      SubagentID string
      AppID      string
      Operation  string
  }
  func (b *AgentBridge) registerSubagentToolCall(sessionID, subagentID, appID, operation string)
  func (b *AgentBridge) consumeSubagentToolCall(sessionID string) (subagentInfo, bool)
  ```
- 语义：父 session 的一次 subagent 工具调用在运行期间只有它自己在执行，因此"注册 → 下一条
  `tool.completed` 消费"是 1:1 的；异常残留由下一 turn 开始时由 AgentManager 清除。

### 6.4 `agent.go`：tool.completed 注入判别字段

- `handleCodexEvent`（:1644）与 `handleOpencodeEvent`（:1736）在发 `tool.completed` 前调用
  `m.consumeSubagentToolCall(sessionID)`，命中则注入 `subagentId / subagentAppId / subagentOperation`。
- 两处抽一个 `m.subagentToolFields(sessionID) map[string]any` 复用。

### 6.5 `ws.go` + `server.go`：subagent channel + REST + schema 迁移

- `applySubscribe` 增加 `subagent` channel（event-driven，复用 cli/terminal 的 startStream 模式）：
  `runSubagentForwarder` 按 job_id 从账本回放 `subagent.job` 事件 → 实时转发 → `available:false` 结束。
- `applyUnsubscribe` 对应 `subs.stopStream("subagent:" + key)`。
- `Server` 接线：job 发布闭包注入 bridge：`bus.Publish("subagent", jobID, frame)`。
- 新增 schema 迁移（幂等 ALTER）与 `POST /v1/jobs/{id}/cancel`、`GET /v1/jobs/{id}`。
- 普通会话列表（scope）过滤 `parent_session_id is not null` 的子会话。

## 7. 前端实现要点（web）

### 7.1 类型扩展（agent-panel-types.ts）

- `ToolPayload` 增加 `subagentId? / subagentAppId? / subagentOperation?`（5.1）。
- 新增类型：
  ```ts
  export type SubagentJob = { id; status; phase; appId?; operation?; childSessionId?; parentSessionId?; createdAt; updatedAt; error? };
  export type SubagentFrame = { event: "job.updated"|"job.completed"|"job.failed"|"job.cancelled"; job?: SubagentJob; error?: string };
  ```
- 辅助：`subagentStatusLabel(status)`、`subagentPhaseLabel(phase)`（走 i18n 字典）。

### 7.2 事件识别与卡片分支（agent-panel-views.tsx）

- `toolCalls()` 聚合时保留 `payload.subagentId`（`ToolCall` 增加 `subagent?` 字段）。
- `ToolTimelineItem` 开头分支：
  ```tsx
  if (call.subagent?.id) return <SubagentTaskCard apiBase={apiBase} call={call} now={now} />;
  ```
- 卡片数据源（种子）：优先用 `tool.completed` payload 里的 job view（output JSON 已含），无需等待 WS。

### 7.3 新组件 `subagent-task-card.tsx`（任务卡片）

- **展示**：App 图标/名称 + 操作 label（`toolDisplayLabel` 复用）+ `toolName`；状态徽标
  （queued/running/completed/failed/cancelled 映射现有状态色）；阶段指示
  （authorize → run → finalize 三小段，当前 phase 高亮）；**实时耗时 counter**。
- **耗时 counter 自治**：卡片自持 `now` 状态，`job.status` 为 queued/running 时自己起 1s interval
  （不依赖父会话 `detail.status`），终态清除。父 turn 结束后子 Agent 仍在跑时卡片持续走时。
- **实时性**：挂载时 `getRealtimeChannel(apiBase).subscribe("subagent", jobId, handler)` 收
  job 生命周期；若已拿到 `childSessionId` 还可订阅 `agent` channel 拿活动流（供点击后弹框秒开）。
  卸载退订；同一 WS 单例多卡片订阅天然复用连接。
- **去重**：一个 `subagentId` 无论主 Agent 后续是否再调 `recut.job.status/wait`，只在时间线上渲染
  一张卡片（按 subagentId 在 timeline 里合并）。
- **点击** → 打开全局弹框（见 7.4）。

### 7.4 新组件 `subagent-preview-dialog.tsx`（全局弹框 = chat UI + Meta）

- `createPortal` 到 `document.body`，复用 `CLIDebugDialog` 布局（遮罩 + 居中卡片 + 关闭）。
- **Meta 头（subagent Meta 显示）**：
  - jobId、App、operation、状态徽标、当前 phase、parentSessionId、开始/更新时间、耗时、elapsedMs。
  - 操作按钮：**取消**（`POST /v1/jobs/{id}/cancel`）、**复制诊断**（job view + child 会话事件导出）。
- **主体 = 子 Agent 会话的 chat 视图**（**本质就是 chat 的 Conversation**）：
  - 数据：`GET /v1/agent-sessions/{childSessionId}` 取 Detail（turns + events），复用
    `<Conversation apiBase detail now />` 直接渲染——子会话的 turns、工具时间线、RunningStatus
    与普通会话完全一致，零新增渲染逻辑。
  - 实时：订阅 `agent` channel（childSessionId）增量应用 `applyAgentEvent`；job 状态订阅
    `subagent` channel 驱动 Meta 头。
  - 差异只在 Meta 头；弹框是全局的，任何 surface 都能打开（数据全走 child session REST + WS，
    不绑定父面板）。
- **数据/生命周期**：打开时订阅两条 channel，关闭时退订；`available:false` 显示"任务不可用"并保持
  最后快照。

### 7.5 i18n

在 `workspace-dict.ts` 增加 `agent.subagent.*` 键（zh/en）：
`status.queued/running/completed/failed/cancelled`、`phase.authorizing/running/finalizing`、
`card.open`、`dialog.title`、`dialog.cancel`、`dialog.cancelling`、`dialog.copyDiagnostic`、
`unavailable` 等，沿用现有字典/插值模式。

### 7.6 用户向子 Agent 发消息的可行性（交互边界）

**问题**：预览弹框本质是 chat UI，用户会自然想问"能不能像和主 Agent 一样直接给子 Agent 发消息"。
本 RFC 让子会话与通用会话同构（落 `agent_sessions`、事件进账本），因此这条链路的可行性随之提升：

| 形态 | 可行性 | 说明 |
|---|---|---|
| A. 运行中插话（interject） | 低 / 需大改 | 需 child 交互式 stdin + 常驻进程 + 可恢复会话，与"受限只读一次性进程"执行形态冲突；子任务通常 ≤90s，插话价值低。**不建议**。 |
| B. 完成后同会话续谈 | **高（同构后天然支持）** | 子会话已落 `agent_sessions` 并保存 `allowed_tools`；`POST /v1/agent-sessions/{childSessionId}/turns`（已有）在 Phase 2 恢复受限工具面后即可续谈——同一会话上下文追加消息，审计链完整。 |
| C. 转译为"新的动作" | 高 | 预览弹框输入框可把消息转译为 `component.revise`（同组件、新 job）或 `component.create` / `recut.agent.run`（新 job），完全复用现有 runner。 |

**结论**：

1. **Phase 1 不做直连发消息**，但子会话已同构持久化，为 B 打好了地基；Phase 2 提供弹框内的
   "继续对话"（B：同一 child 会话续谈，保持受限工具面）与"转译为新动作"（C：revise/create 新 job）
   两种入口，用户可自选。
2. A（运行中插话）在当前执行形态下不可行且不值得，保持"取消 + 重新启动"模型。
3. 无论哪种形态，`cancel` + `component.revise` 已覆盖"改方向"；本 RFC 的核心收益是**全程可见 +
   全程可审计**。

## 8. 兼容与迁移

- WS 协议向后兼容：`subagent` 是新 channel，旧客户端不订阅即无感知；子会话走既有 `agent` channel，
  只是多了一个合法 key。
- 工具契约不变：主 Agent 看到的 `recut.*.component.create` / `recut.agent.run` 返回值与行为不变；
  payload 增加的 `subagentId` 字段对旧前端是多余字段。
- `agent_sessions` 加列是幂等迁移，不影响既有会话；普通会话列表过滤子会话，不改变用户可见历史。
- `phase` 枚举细化为 5 值：检查 `recut.job.*` 的 phase 消费方后决定是否保留 `"authoring"` 兼容别名
  （建议直接迁移，phase 是新近引入的展示字段）。
- `POST /v1/jobs/{id}/cancel` 与既有 `recut.job.cancel` MCP 并存，语义一致。

## 9. 分阶段实施

- **Phase 1（同构 + 识别 + 卡片 + ws channel）**：
  - Go：schema 迁移；`createChildSession` 落账本；`runFocusedSubAgent` stdout 事件流解析落账本；
    `runDeclaredSubAgent` 三阶段 phase；job 生命周期 `subagent.job` 事件落账本 + publish；
    bridge 关联注册表 + consume；tool.completed 注入 `subagentId`；`subagent` channel forwarder；
    `POST /v1/jobs/{id}/cancel`；会话列表过滤子会话。
  - web：类型扩展；`ToolTimelineItem` 分支；`SubagentTaskCard`（状态/阶段/耗时/订阅/去重）。
  - 验收：chat 调 `component.create` → 事件流出现实时卡片；`agent_events` 账本可见子会话的
    tool.* 事件与 `subagent.job` 生命周期；断线重连后卡片状态经回放恢复。
- **Phase 2（全局预览弹框 + 同会话续谈）**：
  - web：`SubagentPreviewDialog`（Meta 头 + 复用 `Conversation` 渲染 child Detail + 取消/复制诊断）；
    输入框支持 B（同会话续谈）与 C（转译为新 job）。
  - Go：`/v1/agent-sessions/{childSessionId}/turns` 对受限子会话开放（恢复 `allowed_tools`）；
    job → child 会话双向追溯查询。
  - 验收：点击卡片弹出弹框看到子 Agent 完整对话与工具时间线；续谈新消息进入同一会话账本并落新 job
    或新 turn；审计链 parent → job → child 完整可查。

## 10. 测试与验证

- **Go（httptest）**：
  - 子会话同构：`runFocusedSubAgent` 后 child 会话行存在（parent_session_id/job_id/allowed_tools）；
    stdout 解析落 `agent_events`（tool.*、assistant.completed、subagent.job）；会话列表不含子会话。
  - bridge 关联注册表：register→consume 1:1；残留被清除。
  - phase 序列：queued→authorizing→running→finalizing→complete；失败走 failed。
  - subagent channel：按 job_id 账本回放、实时增量、`available:false`、取消订阅停流、job 不存在。
  - agent channel(childSessionId)：子会话事件 cursor 回放与实时（复用现有 agent forwarder 测试）。
  - tool.completed payload 注入：命中 subagent op 有 `subagentId`；普通工具无。
  - `POST /v1/jobs/{id}/cancel`：running 可取消，terminal 幂等，不存在 404。
  - 审计：daemon 重启后 `GET /v1/agent-sessions/{childSessionId}` 与 `GET /v1/jobs/{id}` 仍可读。
- **web（Playwright）**：
  - chat 调 `component.create` → 出现 SubagentTaskCard；耗时递增；点击打开弹框；弹框内是子会话
    Conversation（工具时间线可见）；关闭弹框退订。
  - Network 断言：页面 WS 连接数仍为 1（agent + subagent 走同一通道）；断线重连后卡片/弹框恢复。
  - 多卡片场景（同一会话多次 subagent 调用）去重正确。
- **回归**：编辑器组件创建/修订、`recut.agent.run`、既有 chat 工具时间线渲染、会话历史列表无子会话污染。

## 11. 风险与取舍

- **事件解析成本**：子会话 stdout 事件流解析 + 落账本增加少量 IO；与父会话同一条路径，无新格式、
  无新解析器，风险可控。stderr 仍作诊断 tail（失败时随 `subagent.job` failed 事件入账本）。
- **会话行膨胀**：每个子 Agent 一条 `agent_sessions` 行 + 若干 `agent_events`。可接受（审计价值）；
  会话列表按 parent_session_id 过滤，用户历史不受污染。
- **工作区/原生会话**：child 的 workspace 仍用完即删；`native_session_id` 不保留（一次性进程），
  续谈（Phase 2 B）时按 `allowed_tools` + 保存的 prompt 重建受限上下文，而非 resume 旧 CLI 进程。
- **多客户端 fanout**：agent + subagent 两条 channel 都按 key 广播，多个前端 tab 各自一条 WS 都收到
  ——与现有 channel 行为一致，无新增压力。
- **取消竞态**：cancel 与 job 进入 terminal 的竞态按现状处理（queued/running 才生效，terminal 幂等返回）。

## 12. 关键代码定位

| 关注点 | 位置 |
|---|---|
| 通用受限子 Agent 执行器（stdout 当前被丢弃） | `service/subagent.go` `runFocusedSubAgent`（:126 io.Discard / :97 os.RemoveAll） |
| subAgent op 统一入口 | `service/subagent.go:183` `startAppSubAgentJob` |
| AgentJob 生命周期（现状 3 状态，不落账本） | `service/agent_jobs.go` `runAgentJob` |
| subAgent op 分发 | `service/mcp.go:467` `operationIsSubAgent` → `startAppSubAgentJob` |
| `recut.agent.run` | `service/subagent.go:206` `agentRunMCPTool` |
| 子 Agent 工具观察（finalize 用） | `service/bridge.go:163` `RecordAgentToolCall` |
| 父会话事件流解析模板（复用） | `service/agent.go:989-1002` `runCodex` scanner + `handleCodexEvent`（:1615）/ `handleOpencodeEvent`（:1711） |
| 事件落账本 + WS notify | `service/agent.go:2071` `emit` |
| 会话/事件 schema | `service/project.go:409` `agent_sessions` / `:428` `agent_events` |
| 统一实时 WS 订阅 | `service/ws.go` `applySubscribe`（新增 subagent 分支） |
| ws 前端单例 | `web/lib/realtime-channel.ts` `getRealtimeChannel` |
| 工具时间线渲染 | `web/components/agent-panel-views.tsx` `ToolTimelineItem` / `toolCalls` |
| chat 会话渲染（弹框复用） | `web/components/agent-panel-views.tsx` `Conversation` / `applyAgentEvent` |
| 工具 payload 类型 | `web/components/agent-panel-types.ts` `ToolPayload` |
| 弹框范式（可复用） | `web/components/agent-panel-views.tsx` `CLIDebugDialog` / `ToolDetailDialog` |
| subAgent op（manifest / background） | `apps/editor/manifest.json:347` `component.create` / `components.js:261` |
