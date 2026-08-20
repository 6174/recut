<!--
 * [INPUT]: 依赖 2026-08-19「六组件产品介绍」会话的 agent-session-debug 快照（session 7a13e308…，
 *          project 4ea285e57a03dd546bd8a5b7），含两次被杀 job 的完整 payload：
 *          ① 6 项批 job 4e2f9bf458624408535db7f9（elapsedMs=90028，signal: killed，
 *           childSession.turns=[]，events 仅 job 生命周期）；
 *          ② 重试批 job c9e3c0f72cf497107f70b823（elapsedMs=90028，6 次 component.commit
 *           全部 TS7006 失败后被杀）；
 *          ③ 单件成功批 ba29c117… / 22119aaa…（46–79s，均自带类型注解）；④ recut.job.wait
 *          在 job 失败后 18ms 内 MCP EOF；⑤ component.update 业务错误以 MCP -32000 返回；
 *          ⑥「不要背景颜色」反馈回合触发全套重发现。
 *          代码现状：service/subagent.go（defaultSubAgentTimeout=90s、runAgentSubSession 超时即弃工具结果、
 *          scanSubagentEvents 账本）、service/agent_jobs.go（waitAgentJob 长轮询）、MCP handler
 *          （App 错误一律 JSON-RPC error）、apps/editor/background/components.js（component.create/commit/
 *          finalize 两段式、COMPONENT_AUTHOR_HEADER 散文契约、selectSkeletonSource 仅 feature-chip）、
 *          apps/editor/scripts/component-build.js（strict:true typecheck）、apps/editor/ui/src/recut/
 *          component-cover.ts（浏览器 harness）、rfc 既有结论
 *          （2026-08-18-editor-component-create-trace-issues.md / -workflow-review.md）。
 * [OUTPUT]: 按优先级复盘 6 个核心问题，并以"架构优先"给出统一方案：四堵墙——单一事实源（job 事件日志 +
 *           状态机投影）、边界分层（作者契约/错误面/验证权杖各归其位）、平台拥有框架模型只拥有内容
 *           （脚手架 + 结构化契约 + 运行安全闸）、证据驱动验证（信任阶梯 + 证据戳）。
 *           已决策：子 Agent 默认超时 90s → 30min。
 * [POS]: rfc 的"体验复盘 + 架构方案"文档；与既有 trace-issues（展示层 bug）、workflow-review（创建流程
 *        架构）互补。本文档只谈架构层修复，拒绝修补模式：凡"靠模型记住规则 / 靠调用者自律 / 靠时序碰运气 /
 *        靠长轮询硬等"的设计一律替换为平台强制的机制。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
!-->

# RFC: 组件创建链的架构修复——2026-08-19 六组件会话复盘与目标架构

- 状态：Proposal
- 作者：Recut
- 日期：2026-08-19
- 决策范围：`service` 的子 Agent job 生命周期（事件日志/状态机/等待机制/错误信封）、MCP 错误面、`recut.editor` 的作者契约（脚手架生成/构建闸/合成上下文/验证管线）、上下文层（会话摘要投影）
- 关联：[组件创建链路事故复盘（第三次）](./2026-08-18-editor-component-create-trace-issues.md)、[Editor AI 组件工作流 Review](./2026-08-18-editor-component-workflow-review.md)、[组件素材工作流](./2026-08-16-editor-component-asset-workflow.md)、[子 Agent 任务卡片 WS](./2026-08-18-subagent-task-card-ws.md)

## 1. 摘要

用户要求创建 6 个产品介绍全屏组件。会话从 01:11 持续到 01:27+，两次 job 被杀、用户打断两次、最终只有 3 个组件可用且视觉不达标。逐条复盘后确认：**组件源码不是瓶颈，是 5 处架构缺陷的合力**。六次提交失败（TS7006）、超时被杀、等待 EOF、业务错误当传输错误、失败不可见、反馈回合重新发现——表面是六个问题，底层只有几堵没建起来的墙：

| # | 核心问题 | 严重度 | 架构根因 | 方案形态 |
|---|---|---|---|---|
| 1 | 90s 硬超时 + create job 不抗杀 | **P0** | 超时即弃工具结果（内存态不落库）；finalize 只在"正常完成"路径跑 | 状态机 + 事件日志；终态（含 interrupted）一律执行 finalize；**已决策超时 90s→30min** + 可取消 |
| 2 | 作者契约与 strict typecheck 失配，整批产出失败 | **P0** | 契约是散文 prompt（模型可能不遵守），而门是硬代码（strict tsc）——两套机制靠模型猜 | 平台生成类型完整脚手架；模型只填视觉主体；构建闸=运行安全，类型护栏归受信库路径 |
| 3 | MCP 错误面脆弱：wait EOF、业务错误当传输错误 | **P0** | 三层错误（传输/任务/业务）压成一个 error 通道；阻塞 HTTP 长轮询等待 | 统一错误信封（kind/code/hint）；终态即结果非错误；等待=事件订阅，不做阻塞 HTTP |
| 4 | 子 Agent 失败账本不可见 | P1 | 工具结果内存收集、终态才落；账本与 job 状态两处手动同步 | job 事件日志=单一事实源，一切状态/摘要/卡片都是投影，无同步代码 |
| 5 | 上下文层偏离：反馈回合重新发现、合成上下文缺失 | P1 | 会话任务态无持久模型；合成事实靠主 Agent 猜 | 会话摘要（事件日志投影）+ 合成上下文平台推导并注入契约 |
| 6 | 快速路径验证是代码级自证 | P1 | verified 由调用者自证（硬编码 ok:true），无证据戳 | 信任阶梯（build→render→composite）+ 证据戳；统一验证管线，取消自证 |

## 2. 架构原则与目标形态

> 修补模式：给 prompt 加一句"要写类型"、给 wait 加个重试、给 update 返回 coverUrl……每一条都只堵住当次漏洞，下一个模型回合/下一条工具链还会以新形态漏出来。**架构 = 把规则从"让模型记住"变成"平台强制执行"**。

### P1 单一事实源：job 事件日志 + 状态机投影

一切子 Agent 活动（回合、工具调用、工具结果、状态变更）在**发生时**即以追加方式写入持久化 job 事件日志。job 状态、失败摘要、UI 任务卡、commit 账本、会话摘要**全部是同一日志的只读投影**。

- 禁止"内存中收集、终态时一次性落库"——这是问题一丢结果、问题四账本空白的共同根因，一律删除。
- 状态机：`queued → running → {complete | interrupted | cancelled | failed}`；**终态一律带结构化 result**（成功项、失败项、部分提交），由 finalize 投影生成。
- 一致性由构造保证：没有两处存储，就没有"忘了同步"。

### P2 边界分层：作者契约 / 错误面 / 验证权杖各归其位

三类边界各有独立机制，绝不借用对方：

| 边界 | 现状缺陷 | 架构形态 |
|---|---|---|
| 作者契约边界 | 散文 prompt 里埋规则，模型可能不遵守（问题二） | 平台生成脚手架 + 结构化上下文；安全规则代码化 |
| 错误面边界 | 业务/校验/传输错误压成一个 -32000（问题三） | MCP 出口统一错误信封，类型区分，一个中间件收口 |
| 验证权杖边界 | 谁都能把组件标 verified，无证据（问题六） | 信任阶梯 + 证据戳，只由验证管线签发 |

### P3 平台拥有框架，模型只拥有内容

凡"安全/正确性/类型/边界"一律平台代码保证；模型只负责创意内容（视觉主体、文案、动画）。**凡是要模型记住规则才能通过的门，都是契约缺陷**——下次它就会忘。本次 6 连发 TS7006 就是模型忘了"要写类型注解"。

### P4 证据驱动状态：无证据不交付

`verified` 不再是真值，而是**证据戳** `{ level, artifact, at, by }`：
- `level`：`build-passed`（shape+确定性+可编译）→ `render-proven`（浏览器 harness 出封面）→ `composite-checked`（preview.frame 于实际时间线）；
- `artifact`：构建报告 / coverUrl / frame 引用；
- 消费方（放置、素材库、Agent 汇报）按证据级别决定信任；Agent 向用户报"成功"必须有匹配证据，否则就是未交付。

### 目标形态（数据流）

```
主 Agent ──MCP──► MCP 边界（统一错误信封，收口所有 App 错误）
                        │
        ┌───────────────┴────────────────┐
        ▼                                ▼
   job 调度（状态机）              App operation（component.*）
        │ append（发生时即追加）           │ 工具结果即时追加
        ▼                                │
   Job Event Log（SSOT）◄─────────────────┘
        回合/工具调用/工具结果/终态
        │ 只读投影
        ├─ job.status（状态机投影）
        ├─ UI 任务卡 / 失败摘要
        ├─ commit 账本 → finalize（complete 与 interrupted 都跑）
        ├─ session digest（问题五：createdComponentIds/待决意图）
        └─ 验证证据（build/render/composite + cover/frame）
```

## 3. 会话复盘（证据）

### 3.1 事实链

```
01:11:21  user: 创建 6 个产品介绍组件（多类型项目/风格模板/Canvas 特效/React 组件/音乐库/中文字体库）
          → 主 Agent 一把提交 component.create(items:6, mode:"fullscreen")
01:12:17  job 4e2f9bf458624408535db7f9 启动 → 01:13:47 被杀（elapsedMs=90028）
          childSession.turns=[]，events 仅 job.updated/job.failed → 活动不可见（问题 4）
01:13:47  recut.job.wait 在 job 失败后 18ms 内报 MCP EOF，无法客观返回状态（问题 3）
01:14:06  重试 batch=6（job c9e3c0f72cf497107f70b823）→ 6 次 component.commit 全部
          TS7006 失败（render(ctx) 未标注 ctx/k/i）→ 90s 被杀，0 产出（问题 2）
01:15:46  主 Agent 尝试 component.update 提升 draft → 业务错误以 MCP -32000 返回（问题 3）
01:16:44  手动 archive 6 个 stale draft（问题 1 的直接后果）
01:18:32  单件批 ba29c117… 成功（elapsedMs=78847）ai-8nlz732x   ← 只有单件能活
01:19:56  单件批 22119aaa… 成功（elapsedMs=45699）ai-a1m8ss6e
01:20:45  单件批 f251c409… Feature-CanvasEffects → 用户打断
01:21:16  user: 不要背景颜色 → 主 Agent 重读 recut.context/skills/两篇 reference/源码 grep
          背景实现（问题 5），而非直接改已知组件
01:23:28  三个组件 v2 去背景（component.update，构建级验证，无像素证明）→ 白字保留
01:27:04  user: 背景白色为主，透明后白字尴尬，得调整元素色彩   ← 会话处于此轮，仍未收敛
```

### 3.2 关键旁证

- 成功的单件批**都带类型注解**（`render(ctx: RenderCtx)` / `render(ctx: any)`）；失败的 6 连发**全部未标注**（`render(ctx)` / `(k)=>` / `(i)=>`）→ 类型闸是稳定区分成败的那道门，而它靠模型自觉。
- 项目底层主轨是 240s `Google Chrome.mp4`（亮色录屏），组件叠于其上；brief 却要求"深色墨绿不透明满屏背景"。

## 4. 问题一（P0）：90s 硬超时 + create job 不抗杀

### 4.1 根因（架构层）

1. `runAgentSubSession`（`service/subagent.go:130-170`）把工具结果收集在**内存**（`bridge.AgentToolCalls`），`:156-165` 超时被杀时**提前 return、不落库**——发生过的 commit 随进程死亡。违反 P1。
2. `finalizeComponentCommits`（`components.js:303-345`）只在"子 Agent 正常完成回传 subAgentTools"的路径执行；没有"中断也 finalize"的状态。违反 P1/P4。
3. `defaultSubAgentTimeout=90s` 是跨所有 op 的普适常量，无法按任务规模声明；90s 只够 1–2 次模型生成+构建，6 项批注定被杀（单件实测 46–79s）。**已决策：90s → 30min**。

### 4.2 架构方案

1. **默认超时 90s → 30min（已决策，P0）**：`defaultSubAgentTimeout = 30 * time.Minute`，降级为兜底值；sub-agent op 可声明自己的 `timeout`（`component.create` 按 items 数 + brief 长度预估）。配合 `recut.job.cancel`：30min 不等于失控，用户随时可停、可停后可恢复。
2. **事件日志落库（P0，P1）**：`component.commit` 的结果（含 versionId/source/mode 与失败 buildError）**在工具完成时即追加**到 job 事件日志；`runAgentSubSession` 不再需要"终态回传"——它只是最后一个写日志的人。
3. **终态即 finalize（P0，P4）**：job 进入 `complete` 或 `interrupted` 终态时，调度器**一律**从事件日志投影 commit 账本并执行 `finalizeComponentCommits`。被杀 ≠ 丢弃：第一批的 6 个 draft 会被自动提升。
4. **`component.finalize({versionIds[]})`（P1 兜底，幂等）**：对任一 status=draft 版本执行 verify→head→asset。既是历史 orphan 的清理入口，也是取消/中断后的恢复入口，消灭"archive 再重跑"。
5. **分片降级为自适应（P1）**：30min 预算下不强制分片；仅单 job 预估超预算时内部拆分（每子 job 独立 finalize），返回 `{expectedJobs, perItemBudget}`。

## 5. 问题二（P0）：作者契约与 strict typecheck 失配

### 5.1 根因（架构层）

1. **契约是散文，门是代码——两套机制靠模型猜**。`COMPONENT_AUTHOR_HEADER`（`components.js:213`）通篇没提类型注解，而 `component-build.js:225` 以 `strict:true` 拒绝未标注参数。模型"忘了规则"= 必然失败。违反 P3。
2. **类型示范只存在于一个字符串 skeleton**（`FEATURE_CHIP_SKELETON`），且 `selectSkeletonSource` 只在 `template==="feature-chip"` 注入；`feature-title` 等常见模板无 scaffold → 模型自由发挥。违反 P3。
3. **构建闸把关错了东西**：AI 一次性组件需要的是"运行安全"（shape 合法、确定性、可编译），不是"类型卫生"。类型护栏应属于受信内置库路径，不是临时组件路径。违反 P2。

### 5.2 架构方案：作者脚手架 + 结构化契约 + 运行安全闸

1. **平台生成类型完整脚手架（P0，P3）**：`component.create` 在派发前由平台（background）按 `template/surface/canvas/compositing` 生成完整 `.tsx` 脚手架——含正确 `import type { ComponentRenderContext }`、`inputs`、`getBaseSize/getContentBounds`、`render(ctx: ComponentRenderContext)` 签名与 anim 管道。**类型正确性从模型职责中彻底移除**。`FEATURE_CHIP_SKELETON` 这类散落字符串收敛为"脚手架生成器"（按 template 路由，覆盖 feature-title / 通用 fullscreen / chip 等）。
2. **结构化契约取代散文（P0，P2）**：子 Agent 收到的 prompt 由三段组成——①平台脚手架（只读参考，含类型示范）；②`structuredContext` JSON（canvas、mode、compositing、params 默认值、视觉铁律）；③一句"只填充 render 主体，保持脚手架签名与安全约束不变"。不再把"记得写类型"交给模型。
3. **构建闸改判运行安全（P0，P2/P3）**：AI 作者路径的构建 = esbuild（可编译）+ shape 校验（default export 形状、surface、inputs 数组）+ 确定性扫描（禁墙钟/随机），**typecheck 关闭或降为 `strict:false`**。类型护栏只保留在受信内置库/发布模板路径。脚手架已带类型，模型破坏 scaffold 由 shape 校验兜住。
4. **失败反馈是结构化修订信号（P1）**：`component.commit` 失败返回 `{kind:"build", code, line, hint}`；同一 draft 允许子 Agent 在预算内迭代重提（脚手架版本号携带），超过 N 次同构失败则该 item 标记 failed 并继续下一项——**不再让整批静默烧光预算**。

## 6. 问题三（P0）：MCP 错误面脆弱

### 6.1 根因（架构层）

1. **三层错误压进一个 error 通道**：MCP handler 把 App operation 抛出的 Error 一律转成 JSON-RPC error（`MCP -32000: run App handler: Error: component.update: component has no verified head...`）——业务校验失败、传输失败、任务失败无法区分，还泄漏内部路径。违反 P2。
2. **阻塞 HTTP 长轮询等待**：`recut.job.wait`（`agent_jobs.go` waitAgentJob 阻塞 `<-job.done` 或 300s）占住一次 MCP 连接，连接在任务收尾/空闲期被断开 → EOF。**"等待"用错机制**（第三次复现，见 trace-issues §4）。
3. **任务失败与任务结果不分**：job 终态（含失败/中断）应作为**结果**返回，而不是异常。

### 6.2 架构方案：错误信封 + 终态即结果 + 事件等待

1. **统一错误信封（P0，P2）**：MCP 边界加一个收口中间件，把 App 错误翻译成类型化信封，只有传输/协议故障才用 JSON-RPC error：
   ```
   { ok: false, kind: "business"|"validation"|"not-found"|"conflict"|"terminal"|"transport",
     code: "no-verified-head"|"stale-base"|"component-build"|...,
     message, hint, retryable }
   ```
   `component.update` 的"无 verified head"返回 `{ok:false, kind:"business", code:"no-verified-head", hint:"version is a draft; use component.finalize or re-create to promote"}`。**所有工具一次收口**，不允许每个 op 各自发明错误形状。
2. **终态即结果（P0，P1）**：job 状态机终态（complete/interrupted/cancelled/failed）一律返回 `{ state, result, partials, diagnostics }` 作为正常结果；"任务失败"不再以 MCP error 形式出现。
3. **等待改为事件订阅（P0，P1）**：`recut.job.wait` 重写为**订阅 job 事件通道**（复用 subagent-task-card-ws 的 `subagent channel(jobId)`），收集事件直到终态或单次 ≤15s 超时即返回当前状态。**永不阻塞 HTTP 连接、永不因连接断而报错**；EOF 不再是一种可观测失败形态。
4. **runbook 同步（P1）**：`errors.md` 明确"wait 返回的一定是任务真值；业务错误看 `result.code`；看不到代码路径错误"。

## 7. 问题四（P1）：子 Agent 失败账本不可见

### 7.1 根因（架构层）

工具结果**内存收集、终态才落**（`runAgentSubSession` 返回后才有 `AgentToolCalls`）；`scanSubagentEvents` 流式解析与"终态落库"两条路径时序不保证 → 第一次被杀 `childSession.turns=[]` 只有 job 生命周期，stdout 有货账本空白。job 状态与 child 账本两处存储需手动同步。违反 P1。

### 7.2 架构方案：事件日志单一事实源

1. **发生时即追加（P0，P1）**：工具调用发起/完成/失败、回合文本、状态变更，全部在发生时刻追加写入 job 事件日志（一行一事件，含 toolName/status/error/result 摘要/时间戳）。`bridge.AgentToolCalls` 内存集合删除，改为"日志的最近一次读"。
2. **一切视图都是投影（P1，P1）**：`childSession` 查询、`job.status`、失败摘要、UI 任务卡全部投影同一日志——**一致性由构造保证，无同步代码可写错**。
3. **失败摘要结构化（P1）**：投影器在终态生成 `{attempts:[{itemIndex, result, error}], draftsCommitted:[...], verified:[...], budgetUsedMs}`，原始诊断放 `diagnostics` 展开；UI 任务卡第一眼看到"尝试 N 次、失败原因"，而非 60 行日志。

## 8. 问题五（P1）：上下文层偏离

### 8.1 根因（架构层）

1. **会话任务态无持久模型**：work_surface/focus 只带"当前选中元素"，不带"本会话创建过哪些组件、上一步做了什么、用户在改什么"；每个新回合从零重建，agent 只能重新发现（「不要背景颜色」→ 全套 skills/reference/源码 grep）。违反 P1/P4。
2. **合成事实靠主 Agent 猜**：组件叠于亮色视频上，brief 却写成"深色不透明满屏背景"——`buildCreatePrompt` 从不注入合成上下文，平台视觉铁律不下沉。违反 P3。

### 8.2 架构方案：会话摘要投影 + 合成上下文平台推导

1. **会话摘要（P0，P1）**：平台从 job 事件日志 + 组件库投影出 session digest——`{createdComponentIds, lastDesignDecision, pendingIntent, recentVerbs}`，注入每个回合的 work-surface 上下文。反馈回合（「去背景/改字色」）直接读 digest 命中 `createdComponentIds` → `component.source(已知ID)` 精准修改；**禁止**对会话内已知状态做全量重发现（skill 纪律随之删改：已知 ID 直接行动）。
2. **合成上下文平台推导（P0，P3）**：`component.create` 派发时，平台读取 timeline（目标时段底层是否有视频/图片）+ 采样 `preview.frame` 光度 → 生成 `compositing: { overMedia, defaultBackground:"transparent", luminanceHint }` 注入脚手架契约。**默认透明背景、按底层亮度选文字色、不透明满屏仅当 brief 明确要求**——由代码保证，不再由主 Agent 猜。
3. **视觉旋钮参数化（P1）**：脚手架为标准 inputs 预留 `background`/`textColor`/`accent`（默认 transparent + 自动对比文字色）；「去背景/改字色」收敛为 `param` + preview 秒级微调，而非源码重提（承接问题六）。

## 9. 问题六（P1）：快速路径验证是代码级自证

### 9.1 根因（架构层）

`component.update`（`components.js:502-506`）与 create finalize（`:326`）把 verified 写死为 `{ok:true}`——**验证权杖交给调用者自证**；浏览器 harness（`component-cover.ts`）只服务素材库封面，不参与"verified"判定。技能里的"验证纪律"是散文，无强制机制。违反 P2/P4。

### 9.2 架构方案：信任阶梯 + 统一验证管线 + 证据戳

1. **验证信任阶梯（P0，P4）**：所有把组件标成 verified 的路径（create finalize / update / revise）走**同一条验证管线**，产出证据戳：
   - L0 `build-passed`：shape + 确定性 + 可编译（总是要求）；
   - L1 `render-proven`：浏览器 harness 渲染该版本出透明封面（组件将叠于媒体上时强制）；
   - L2 `composite-checked`：`preview.frame` 于实际摆放时刻验证底层可读（组件已落轨且 Agent 要报成功时强制）。
   `editor_component_versions.verified` 携带 `{level, artifact(coverUrl/frame), at, by}`。**取消 `component.update` 的硬编码自证**——它走同一管线、同步执行。
2. **验证幂等 + 按版本缓存（P0，P4）**：证据按 versionId 一次性生成并缓存（版本不变不重复渲染）；验证异步可重试，不阻塞作者 job。无证据 → 素材库卡片显示证据级别徽标，Agent 报"成功"必须有匹配证据。
3. **放置与汇报的门禁（P1）**：`timeline.placeComponents` 对 `level < render-proven` 的组件给出警告（不硬拒）；skill 把"报成功=出示 composite-checked 证据"写成强制项。

## 10. 优先级与落点

| 优先级 | 架构项 | 落点 |
|---|---|---|
| P0 | 默认超时 90s→30min + 按 op 可配 + `recut.job.cancel` | `service/subagent.go`、job 调度 |
| P0 | **job 事件日志（SSOT）**：工具结果发生时即追加；终态（complete/interrupted）一律从日志投影 commit 账本执行 finalize | `service/subagent.go`、`service/agent_jobs.go`、`apps/editor/background/components.js` |
| P0 | **作者脚手架生成器**：按 template/surface 生成类型完整 scaffold + 结构化契约（canvas/mode/compositing/params）；构建闸=运行安全（esbuild+shape+确定性），typecheck 降级 | `apps/editor/background/components.js`、`scripts/component-build.js` |
| P0 | **统一错误信封**（MCP 收口中间件，kind/code/hint）；job 终态即结果；`recut.job.wait` 改事件订阅（≤15s/次） | MCP handler、`service/agent_jobs.go` |
| P0 | **合成上下文平台推导**（timeline + preview.frame 光度 → compositing 注入契约，默认透明） | `apps/editor/background/components.js`、editor preview |
| P0 | **统一验证管线 + 信任阶梯**（build/render/composite + 证据戳），取消 update 自证 | `components.js`、`component-cover.ts`、verify |
| P1 | `component.finalize({versionIds[]})` draft 幂等提升 op | `apps/editor/background/components.js` |
| P1 | session digest 投影注入 work-surface；反馈回合已知 ID 直接行动（skill 纪律） | service/web 上下文层、SKILL.md |
| P1 | 失败摘要结构化 + UI 任务卡投影 | service 投影器、web |
| P1 | 视觉旋钮标准 inputs（background/textColor/accent）进脚手架 | component-authoring.md、脚手架生成器 |
| P1 | 自适应分片（超预算时）+ `{expectedJobs, perItemBudget}` | job 调度 |

## 11. 验收标准

1. 一次 6 项 `component.create` 在 30min 预算内一个 job 跑完，全部 verified 进素材库；不再需要单件逐跑。
2. 中途被杀/取消：已提交组件**自动** finalize 为 verified，用户零清理；残留 draft 可 `component.finalize` 一键收敛。
3. 子 Agent 无需"记得写类型"：脚手架自带类型，零 TS7006 类整批失败；构建闸放行所有 shape/确定性合法的提交。
4. `recut.job.wait` 永不 EOF，返回的一定是任务真值；所有业务/校验失败是结构化信封（kind/code/hint），无内部堆栈。
5. 失败 job 的 UI 任务卡第一眼是"尝试 N 次 / 失败原因 / 已提交 M 个"，而非一坨日志。
6. 反馈回合（去背景/改字色）基于 digest 已知 componentId 直接 `param`+`preview`，秒级收敛；新建组件默认透明、亮色视频可读。
7. 任何被标为 verified 的组件都携带证据戳（build 至少 / render / composite）；Agent 报"成功"必须有证据。

## 12. 不采纳边界

- 不改变「子 Agent 限制为受限工具面 + 唯一 commit 入口」的授权模型（沿用 workflow-review §6 已确认的单 `component.create` 收敛）。
- 30min 是默认上限而非无限额度：必须有 `recut.job.cancel`，且取消/中断不弱化事件日志与杀后 finalize——"超时上调"与"抗杀"成对落地。
- 作者路径关闭 strict typecheck 不延伸到受信内置库/发布模板路径（类型护栏仍属于受信代码）。
- 不自动推断底层素材"应该是什么"，只注入透明度默认、亮度采样提示与深浅旋钮，最终颜色决策权保留给 brief 与参数。
