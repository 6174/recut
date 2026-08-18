<!--
 * [INPUT]: 依赖 2026-08-18 第二次「尝试创建 Hello React 组件」的 agent-session-debug 快照（session
 *          31dfdddaf279ddea385c7c2e，job fc486df0e61d225dae7228f6，component ai-fqorxd2a），
 *          以及 apps/editor（components.js / component-library.tsx / component-loader.ts）、
 *          service（mcp.go / agent_jobs.go / prompts/core-agents.md.tmpl）、web
 *          （agent-message-content.tsx / tool-result-assets.tsx / agent-panel-views.tsx）的代码现状。
 * [OUTPUT]: 如实梳理本次创建链路暴露的 4 个问题的症状、证据、根因与修复建议，供排障与产品决策使用。
 * [POS]: rfc 的"问题梳理报告"文档；对同一创建链路事故的第三次复盘（前两次见 2026-08-16-editor-component-asset-workflow.md
 *       与 2026-08-18-editor-component-workflow-review.md）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

# 复盘：第二次「Hello React 组件」创建链路事故（四问题梳理）

- 状态：Review（基于 2026-08-18 10:18 的 session-debug 快照 + 当时代码）
- 场景：主 Agent（opencode）创建全屏 react 组件 → 受限子 Agent commit → 构建/轻量验证 → verified 进素材库
- 结果：**job 成功（verified、asset 已建），但用户侧 4 个可感知问题并存**

## 0. 结论摘要

组件本身**创建成功**（`ai-fqorxd2a`，`component:ai-fqorxd2a`，status=verified，library.tab=media）。用户观察到的 4 个问题都不是"没创建"，而是**从创建到被用户看见这条链路**上的展示与通信缺陷：

| # | 问题 | 严重度 | 一句话根因 |
|---|---|---|---|
| 1 | 组件已 verified，素材库却不显示 | 高 | 素材库刷新是**事件驱动、无兜底**；事件通道同期正抖动（问题 3），事件一丢就永不刷新 |
| 2 | AI 回复里 `<app appid="recut.editor"/>` 被渲染成 app 卡片，打断句子 | 中 | Agent 误用了「App 引用标签」（它只该用于推荐/加载 App），渲染器对 prose 内标签无降级 |
| 3 | `recut.job.wait` 报 `Post …/v1/mcp: EOF` | 中 | job.wait 是**同步长轮询（最长 300s）占住 MCP HTTP 连接**，连接被服务端/网络层关闭 |
| 4 | `recut.job.status` 的 tool-result 预览永远 Loading | 高 | 工具结果提取器把 `component:` assetId 当**媒体资产**去拉取，拉不到 → 无限转圈 |

其中 1、3、4 共享一个更深的语义缺陷：**「组件素材」与「媒体素材」是两套资产体系，但事件驱动刷新和工具结果预览都没有把组件资产当一等公民对待**。

## 1. 复现轨迹（时间线，来自 session 快照）

```
10:15:56  user: 尝试创建一个 Hello React 组件
10:16:04  recut.context → 10:16:08 recut.skills.read → 10:16:09 workflow.context
10:16:12  recut.skills.reference component-authoring.md（返回内容已是修订后"形态 A/B"）
10:16:12  recut.skills.reference components.md
10:16:20  component.create({ items:[{brief: react/fullscreen/120px/…, mode:"fullscreen", nameHint:"Hello React"}] })
          → job fc486df0e61d225dae7228f6 queued（parent 3cc2446c…，child 65f75329…）
10:16:55.603  job 完成：phase=complete, status=completed, result={assetIds:[component:ai-fqorxd2a], components:[…verified], library:{tab:media, verification:"code-verified"}}
10:16:55.616  recut.job.wait（timeout=300）失败：Post "http://127.0.0.1:17373/v1/mcp": EOF（0.0s，正撞在 job 完成时刻）
10:16:57.649  recut.job.status → 返回完整 completed view（自救成功）
10:17:01      assistant 汇报成功，但回复里出现「组件 <app appid="recut.editor"/>：ai-fqorxd2a…」
```

父会话**没读 errors.md runbook**；遇到 wait EOF 后直接换 status 轮询，没有重试 wait。

## 2. 问题 1（高）：组件 verified 但素材库不显示

### 症状
用户打开 media（素材）tab，看不到刚创建的组件卡片。

### 证据（代码）
- 刷新链路全部是**事件驱动**：
  - `apps/editor/ui/src/recut/use-project-sync.ts:57-61`：收到 `project.components.changed`（经 `recut-project-event` CustomEvent）→ `syncTimelineComponents` + `setActiveTab("media")`。
  - `apps/editor/ui/src/components/editor/panels/assets/views/component-library.tsx:452`（`ComponentAssetLibraryView`）：只在**挂载**和 `recut:components-changed` 时 `refresh`。
  - `apps/editor/ui/src/recut/components.ts:107-115`：`syncTimelineComponents` 仅在"本次**成功**加载了组件"时才 dispatch `recut:components-changed`；全失败/全已存在则**不发事件**。
- 事件来源链：service 后台事件 → web host 的 WS/SSE 通道 → 宿主 iframe 派发 `recut-project-event` → 编辑器 `recut.events.subscribe`（`apps/editor/ui/src/recut/sdk.ts:184-190`）。

### 根因
1. **事件通道一旦抖动，素材库永远不刷新**。本次通道在同一窗口内就发生了问题 3 的 EOF，说明链路脆弱；`project.components.changed` 一旦丢失，已挂载的面板没有任何轮询/手动刷新兜底。
2. **即便事件送达，`syncTimelineComponents` 也只 dispatch 成功情况**；若组件 runtime 加载失败（如编辑器 UI 跑的是旧 build，旧 loader 仍把函数组件判为"模块未导出定义"），registry 记为 failed，素材库（旧代码只取 `getAll()` 的 loaded 定义）就**没有卡片**——这正是上一轮事故的原 bug。本次无法从快照确认子 Agent 提交的源码形态，故该路径仍可能是直接原因（需查 child session 的 commit source / 编辑器当前 build）。
3. 次要：media 面板空态判定（`assets.tsx:259-264`）只在 `ready && count===0` 时显示"空"，卡片缺失时用户看到的是"既非空、也无卡片"的空白区，无任何提示。

### 建议
- **P0 兜底刷新**：`ComponentAssetLibraryView` 增加低频率轮询（如 5–10s `asset.list` 对账）或"手动刷新"按钮；至少保证"打开面板即强制对账"（现已 `refresh on mount`）。
- **P0 确认运行时**：确认编辑器 UI 是 `vite dev`（热更新）还是 `vite preview`（需重建 dist）；确保 loader 归一化与 failed 卡片（本 repo 已改）在运行 UI 中生效。
- P1：`project.components.changed` 丢失时，至少留下可见的"数据可能过期"状态。

## 3. 问题 2（中）：`<app appid="recut.editor"/>` 被渲染成 app 卡片

### 症状
AI 最终回复：「- 组件 `<app appid="recut.editor"/>`：ai-fqorxd2a（component:ai-fqorxd2a）…」——句子中间插入了一张 App 卡片，看起来像 bug。

### 证据（代码）
- 引导语**主动教** Agent 用这个标签：`service/prompts/core-agents.md.tmpl:49`「`<app appid="APP_ID"/>` —— 当你加载某 App 的 skill 或推荐/使用某个已安装 App 时」；`:55`「…报告结果 App id 与 package，并用 `<app appid="..."/>` 引用」。
- 渲染器**无脑转换**：`web/components/agent-message-content.tsx:22` 的 `tagPattern = /<(media|project|app)\s+([^>]*?)\s*\/?>…/gi` 匹配到任何 `<app appid>` 就转成 `<AppReferenceCard/>`（`:31`，flex 布局 item），**不管它是否被正文包围**。
- 本次 Agent 把"引用组件所属 App"这一**未授权语义**塞进了 `app` 标签（既不是推荐 App，也不是加载 skill），于是句子被卡片切断。

### 根因
1. 语义授权过宽 + Agent 过度使用：guide 允许的 `app` 场景不覆盖"汇报组件归属"，但没写"禁止"，模型就把 `app` 当万能引用。
2. 渲染器对"标签嵌在 prose 中"无降级策略：任何位置命中都变成块级卡片。

### 建议
- **P1 guide 收紧**：明确 `<app>`/`<project>` 只允许独占一行/列表项使用；prose 中提到 App/项目一律用纯文本 `appId`，并给"组件汇报"一条明确措辞（用 `assetId` 文本，不引 App）。
- **P1 渲染器降级**：`parseMessage` 对"同一段文本内既有普通文字又有标签"的情况，把标签降级为纯文本 `recut.editor`（或代码样式），只在标签**独立成段/成列表项**时才渲染卡片。
- P2：为"组件素材"引入受控引用（如 `<media type="component" assetid="component:…"/>` 或 `component:` 前缀的 asset 卡），让 AI 汇报组件时渲染**真实的组件卡**而不是 App 卡。

## 4. 问题 3（中）：`recut.job.wait` 报 `Post …/v1/mcp: EOF`

### 症状
`recut.job.wait {jobId, timeoutSeconds:300}` 在 0.0s 即失败：`MCP error -32000: Post "http://127.0.0.1:17373/v1/mcp": EOF`。job 本身在 40ms 前已完成。

### 证据（代码）
- `service/mcp.go:965-969`：sub-agent job 的 wait 走 `bridge.waitAgentJob(jobID, timeout)`。
- `service/agent_jobs.go:183-195`：`waitAgentJob` **同步阻塞**在 `<-job.done`（或 `time.After(300s)`），期间**持有 MCP HTTP 连接**长达最多 300s。
- MCP transport 是无背压的同步 HTTP POST：长占用 + 连接空闲/代理保活上限（app.localhost:17373 可能有反代）→ 连接被关闭 → 客户端读到 `EOF`。
- 时序证据：wait 发起时刻（10:16:55.616）与 job 完成时刻（10:16:55.603）重合，说明该请求恰好落在 finalize 收尾期，连接被服务端/网络层断开。

### 根因
`recut.job.wait` 的"同步长轮询 + 一次 HTTP 连接占用"不适合子 Agent job 场景；300s 上限远超大多数连接保活窗口。**它不是业务失败，是传输层断裂**，但会以 tool error 呈现给 AI 与用户。

### 建议
- **P0 短超时 + 轮询**：`recut.job.wait` 对 sub-agent job 改为**轻量轮询**（每次请求内最多阻塞 10–20s 后返回当前状态；`agent_jobs.go` 的 `time.After` 缩小），连接不再长期占用；或改走 `subagent channel(jobId)` 的 SSE 推送。
- **P1 重试 runbook**：`skills/recut-editor/references/errors.md` 补一条：`recut.job.wait` 出现 EOF/超时 ≠ job 失败，应 `recut.job.status` 确认真实状态，必要时重试 wait。本次 Agent 已"误打误撞"用 status 自救，说明指引缺失但能力够。

## 5. 问题 4（高）：`recut.job.status` 的工具结果预览永远 Loading

### 症状
聊天里 `recut.job.status`（返回 completed view，含 `result.assetIds=["component:ai-fqorxd2a"]`）的 tool-result 预览区出现一张**永不结束的 Loading 卡片**。

### 证据（代码）
- `web/components/tool-result-assets.tsx:38-63` `resultAssetIDs(output)`：递归遍历工具输出 JSON，把任何 `assetIds[]` 收进预览集合。
- `recut.job.status` 的 view 含 `result.assetIds:["component:ai-fqorxd2a"]` → 命中。
- `web/components/tool-result-assets.tsx:116-132`：`ToolResultAsset` 用 `fetch /v1/media/assets/component:ai-fqorxd2a` 拉取**媒体资产**。`component:` 是编辑器项目内资产（editor sqlite），不是平台媒体资产，接口不会返回 → `loadedAsset` 永不 set → 渲染 `LoaderCircle` 无限转圈（`:151-156`），且 `disabled` 不可点。

### 根因
工具结果预览把「组件素材」当「媒体素材」处理：`component:` assetId 不该走 media 资产 API；失败后也没有"不可用"终态，只有无限 spinner。

### 建议
- **P0 过滤**：`resultAssetIDs` 排除 `component:` 前缀（或要求 assetId 属于媒体 kind），一行即可消灭永久 Loading。
- **P1 组件卡**：为 `component:` 前缀渲染"组件素材"卡片（点击打开编辑器组件预览/源码），把组件资产当一等公民，而不是过滤掉就完事。
- **P1 终态兜底**：`ToolResultAsset` 在 fetch 失败/超时后落到"不可用"态（`failed`/`unavailable` 文案），不再无限 spinner。

## 6. 系统性问题

1. **组件资产与媒体资产是两套体系，但展示层未对齐**：问题 4（预览拉媒体接口）、问题 1（卡片只认 loaded runtime 定义）都是这个边界的表现。需要一个统一的"组件 asset 引用"呈现通道（resolve + 封面 + 错误态），本 repo 上一轮已做的 loader 归一化 + failed 卡片是这层的一半，另一半在 web 预览侧。
2. **事件驱动无兜底**：问题 1、3 都指向"依赖一条不稳定的长连接事件/工具通道"。凡是"AI 改了东西、UI 要刷新"的场景都该有轮询/手动刷新兜底。
3. **AI 汇报纪律缺失**：问题 2 是"引用标签语义滥用"，本质是 guide 给了标签却没给"何时不该用"；建议把"受控引用只出现在列表项/独立行"写进 `core-agents.md.tmpl` 的硬规则。

## 7. 修复优先级

| 优先级 | 项 | 落点 |
|---|---|---|
| P0 | tool-result 预览过滤/降级 `component:` assetId，补 fetch 失败终态 | `web/components/tool-result-assets.tsx` |
| P0 | 素材库刷新加兜底（打开即对账 + 低频轮询），确认运行 UI 已含新 loader | `apps/editor/ui/src/components/editor/panels/assets/views/component-library.tsx` |
| P0 | `recut.job.wait` 缩短单次阻塞（≤15s）并轮询返回；errors.md 加 EOF→status 自救 runbook | `service/agent_jobs.go`、`apps/editor/skills/recut-editor/references/errors.md` |
| P1 | `<app>`/`<project>` 标签渲染降级（被正文包围时显示纯文本） | `web/components/agent-message-content.tsx` |
| P1 | `core-agents.md.tmpl` 收紧引用标签语义：只允许独立行/列表项，禁止在 prose 中引用 App | `service/prompts/core-agents.md.tmpl` |
| P2 | 组件资产受控引用卡（`component:` 前缀在聊天与素材库中一致渲染） | `web/components/*` + editor 组件预览 |

## 8. 附录：关键代码定位

| 关注点 | 位置 |
|---|---|
| 素材库刷新（事件驱动，无兜底） | `apps/editor/ui/src/recut/use-project-sync.ts:57`、`…/component-library.tsx:452` |
| 成功才 dispatch 事件（失败静默） | `apps/editor/ui/src/recut/components.ts:107-115` |
| job.wait 同步长轮询 | `service/agent_jobs.go:183`、`service/mcp.go:965` |
| `<app appid>` 标签引导 | `service/prompts/core-agents.md.tmpl:49,55` |
| 标签无脑转卡片 | `web/components/agent-message-content.tsx:22,31,54` |
| 工具结果把 `component:` 当媒体资产 | `web/components/tool-result-assets.tsx:38-63,116-132` |
| 组件创建成功但未出现（事件链） | `apps/editor/ui/src/recut/sdk.ts:184`（`recut-project-event`） |
