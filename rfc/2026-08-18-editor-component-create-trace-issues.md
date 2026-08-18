<!--
 * [INPUT]: 依赖 2026-08-18 第二次「尝试创建 Hello React 组件」的 agent-session-debug 快照（session
 *          31dfdddaf279ddea385c7c2e，job fc486df0e61d225dae7228f6，component ai-fqorxd2a），
 *          以及 apps/editor（components.js / component-library.tsx / component-loader.ts / component-cover.ts /
 *          world-renderer.tsx / component-preview.tsx / html-surface.ts）、
 *          service（mcp.go / agent_jobs.go / prompts/core-agents.md.tmpl）、web
 *          （agent-message-content.tsx / tool-result-assets.tsx / agent-panel-views.tsx）的代码现状。
 * [OUTPUT]: 如实梳理本次创建链路暴露的 5 个问题（含组件预览/封面的根因、修复与复用编辑器渲染路径评估）的
 *           症状、证据、根因与修复建议，供排障与产品决策使用。
 * [POS]: rfc 的"问题梳理报告"文档；对同一创建链路事故的第三次复盘（前两次见 2026-08-16-editor-component-asset-workflow.md
 *       与 2026-08-18-editor-component-workflow-review.md）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

# 复盘：第二次「Hello React 组件」创建链路事故（问题梳理）

- 状态：Review（基于 2026-08-18 10:18 的 session-debug 快照 + 当时代码）
- 场景：主 Agent（opencode）创建全屏 react 组件 → 受限子 Agent commit → 构建/轻量验证 → verified 进素材库
- 结果：**job 成功（verified、asset 已建），但用户侧 5 个可感知问题并存**（其中 1 的"卡片无预览图"在 §9 深化为封面链路 bug）

## 0. 结论摘要

组件本身**创建成功**（`ai-fqorxd2a`，`component:ai-fqorxd2a`，status=verified，library.tab=media）。用户观察到的 5 个问题都不是"没创建"，而是**从创建到被用户看见这条链路**上的展示与通信缺陷：

| # | 问题 | 严重度 | 一句话根因 |
|---|---|---|---|
| 1 | 组件已 verified，素材库却不显示 | 高 | 原为"两区域排版 + 卡片无预览"；排版已合并为单一网格（§5.1 补充），无预览图的封面链路 bug 见 §9 |
| 2 | AI 回复里 `<app appid="recut.editor"/>` 被渲染成 app 卡片，打断句子 | 中 | Agent 误用了「App 引用标签」（它只该用于推荐/加载 App），渲染器对 prose 内标签无降级 |
| 3 | `recut.job.wait` 报 `Post …/v1/mcp: EOF` | 中 | job.wait 是**同步长轮询（最长 300s）占住 MCP HTTP 连接**，连接被服务端/网络层关闭 |
| 4 | `recut.job.status` 的 tool-result 预览永远 Loading | 高 | 工具结果提取器把 `component:` assetId 当**媒体资产**去拉取，拉不到 → 无限转圈 |
| 5 | 组件卡片没有预览图（全为占位色块） | 高 | 封面 harness 装在**离屏隐藏 iframe**，rAF 不触发 → render 挂死 → cover 从未写入（§9） |

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
用户打开 media（素材）tab，看不到刚创建的组件卡片（刷新后亦然）。

### 定位（Playwright 实测，2026-08-18 晚）
- **组件确实渲染在 DOM 里**：打开 `app.localhost:3000/projects/4a29d051f2971d5cad40efb6` 后，assets 面板的 body 文本含 `Hello` / `HelloReact` / `Feature Chip×4`，卡片 `<span>` 齐全。**不是"没创建"，也不是"没渲染"**。
- 实际问题是**排版**：媒体网格（7rem 空网格）占据上方整块，组件被挤在下方 `border-t` 分隔的 96px 小格子区；空网格没有空态文案（空态仅在 `ready && count===0` 时显示），看起来"空空如也"。
- 数据层复核（真实 sqlite）：`editor_components.ai-fqorxd2a` head 已设；`editor_assets.component:ai-fqorxd2a` 存在且 active；真实 bundle 经当前 loader 加载渲染成功。**asset 记录与运行时均正常**。

### 根因
1. **排版分两区（R6「同列」未兑现）**：`assets.tsx` 渲染"媒体 `MediaItemList` + `border-t` 组件区"两个独立网格；媒体为空时顶部留白，组件被压在最下，用户误以为没创建。
2. **卡片无预览图**：组件卡片全为占位色块（封面从未生成）→ 进一步强化"没出现"的观感。封面链路 bug 见 §9。
3. 次要：空态判定只在 `ready && count===0` 显示"空"，无媒体但有组件时顶部空白无任何提示。

### 修复（已实施并验证）
- **合并单一网格**：`MediaItemList` 增加 `extraItems`，`ComponentAssetLibraryView` 增加 `embedded` 模式 → 媒体与 AI 组件在**同一个 7rem 网格**渲染（R6 同列）；删除 `border-t` 分隔与空媒体网格。
- **空态文案**：全空显示新增 `assets.emptyLibrary`；`ComponentGrid` 独立空态用 `assets.emptyComponents`（i18n zh/en 已补）。
- 验证：Playwright 实测单一 `grid gap-4` + `repeat(auto-fill, 7rem)` 网格直接包含 6 张卡片。
- 封面：§9 的 iframe rAF 修复后，6 张卡片重载即显示真实 `<img>` 预览。

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

## 9. 组件预览/封面：实现复查、根因、修复与「复用编辑器自身渲染路径」评估

> 本节是问题 1 的深化复盘（卡片"看不到预览图"）。结论先行：**封面工作是"做了但有 bug"，不是没做**；根因是封面 harness 被放进"离屏 + opacity:0"的隐藏 iframe，Chromium 不触发其 rAF，`harness.render` 永久挂起。

### 9.1 现状：代码存在但从未生效

- 完整链路已在：`component-cover.ts` `ensureVisibleComponentCovers` → `verifyComponentVersion` → 隐藏 iframe harness → `harness.render(0.45)` → `capturePng()` → `component.verify` 写 `cover_path`。
- **实测数据**：项目内全部 verified 版本的 `cover_path` 均为空，`components/covers/` 目录不存在 → 封面从未生成成功。
- html-in-canvas 环境**确认可用**（本产品整体依赖该 flag）：带 `--enable-features=CanvasDrawElement` 的实测中 harness 顶层渲染 248ms 出 194KB 真实 PNG（230400 非背景像素）。

### 9.2 根因（Playwright 实测定位）

`verifyComponentVersion`（`component-cover.ts`）把 harness iframe 用 `left:-9999px; top:-9999px; opacity:0` 隐藏：

- Chromium 对**离屏/不可见（未被合成）的嵌套 iframe 不触发 `requestAnimationFrame`**。
- harness 的 `render()` 依赖 `waitFrames(3)`（3 次 rAF）才 resolve（`demo/component-harness.tsx:52-62,132`）→ **rAF 永不触发 → render 永久挂起**。
- 后果链：`component.verify`（含 cover 写入）永不执行 → 封面为空；iframe 永不回收（finally 在 await 之后）→ 泄漏；`running` 集合永不清除 → 会话内该版本无法重试；挂起不是异常，`catch/markGiveUp` 不触发 → 无 "deferred" 日志，静默失败。
- 对照实测（同一嵌套环境）：离屏 iframe rAF/1.5s=**-1**（不触发）、render 超时；**视口内** iframe rAF/1.5s=**110+**、render 1.7s 出图成功。根因确定。

### 9.3 修复（已实施并验证）

`apps/editor/ui/src/recut/component-cover.ts`：
1. iframe 改到**视口内**：`position:fixed; top:0; left:0; width:1px; height:1px; opacity:0.011; pointer-events:none; border:0; z-index:99999`（保持 opacity>0，1px 不可见，封面是一次性工作）。
2. `harness.render` 加 **10s 超时兜底**（`Promise.race`），极端环境不再永久阻塞。

验证：6 个版本 `cover_path` 全部写入 `components/covers/<versionId>.png`；重载后素材库 6 张卡片全部显示真实 `<img>` 封面。缓存语义正确：封面按 version 一次性写入、之后 `asset.list`/`component.resolve` 直接复用（满足"版本不变可缓存"）。

### 9.4 复用编辑器自身渲染/纹理提取路径（用户建议评估）

**参考点**：编辑器预览/导出早已有一套不依赖隐藏 iframe 的成熟渲染：

- `renderer-manager.ts` `createSnapshot` → `WorldRenderer.renderToCanvas({world, time, targetCanvas})` → `toBlob` PNG（整项目快照，`renderer-manager.ts:82-142`）。
- `WorldRenderer.render`（`world-renderer.tsx:130-155`）→ `WorldScene` → `HtmlObject`/`DomContentSurface`（**html-in-canvas 提取组件 DOM 纹理**）→ `waitForCapture` 等纹理就绪 → 主窗口 rAF → 画布出帧。导出即走此路径。
- 预览弹窗对 html/react 走 `ComponentDomPreview`（直接渲染 DOM，`component-preview.tsx:180-306`）；r3f 走 `WorldScene`。

**关键差异 = 复用价值的核心**：`WorldRenderer.render` 用**主窗口**的 `requestAnimationFrame`（主窗口永远有帧），而封面 harness 用的是**隐藏 iframe 窗口**的 rAF（离屏被节流到 0）。这就是"导出正常、封面挂死"的根本分野。

**复用方案**（建议 P1 重构，替代 iframe harness）：
```
verifyComponentVersion(versionId):
  resolve → ensureComponent(componentId)          # 主 frame registry 已加载定义
  构建仅含该组件的 world（baseSize、progress=0.45、默认 inputs）
  new WorldRenderer({width, height, fps})          # 与 createSnapshot 同构
  await renderer.renderToCanvas({world, time, targetCanvas})   # 主窗口 rAF + html-in-canvas 纹理提取 + waitForCapture
  targetCanvas.toBlob('image/png') → component.verify(cover)
```
收益：彻底移除 iframe（无泄漏/上下文隔离成本/窗口 rAF 依赖）；"组件封面渲染"与"编辑器预览/导出渲染"同源同实现；封面即"编辑器所见"。风险低（复用已验证的导出渲染路径），需注意 `renderToCanvas` 的 `waitForCapture` 会等 `activeContentSurfaces` 全部就绪（含实时编辑器表面，400ms 上限），成本可接受。

### 9.5 建议优先级

| 优先级 | 项 |
|---|---|
| P0（已完成） | 修复 iframe 离屏导致 rAF 挂起 + render 超时兜底 → 封面可生成并缓存 |
| P1（推荐） | 用 `WorldRenderer.renderToCanvas` 替代隐藏 iframe harness，复用编辑器自身 html-in-canvas 纹理提取路径 |
| P2 | 封面生成后立即刷新卡片（当前重载后显示；同会话内需等一次 refresh），并给素材库"手动补封面/重试"入口 |


