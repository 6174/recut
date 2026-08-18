<!--
 * [INPUT]: 依赖 apps/editor 的 AI 组件创建链（background/components.js、model-base.js、op-engine.js、
 *          project-store.js、scripts/component-build.js）、service 的 Component Author（component_author.go、
 *          component_author_jobs.go、mcp.go）、UI 组件素材库（component-library.tsx、component-cover.ts、
 *          components.ts、ai-components.ts、timeline/placement/resolve.ts），以及
 *          rfc/2026-08-16-editor-component-asset-workflow.md 的方案。
 * [OUTPUT]: 如实复盘 AI 创建组件的真实实现流程，与 RFC 逐条对照，标注已实施 / 偏差 / 未实施，
 *           并对架构合理性给出问题清单与可执行的修复建议。
 * [POS]: rfc 的"实现复盘与架构审查"文档；供实现逻辑与架构是否合理的 review 使用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# Review：Editor AI 组件创建工作流的真实实现 vs RFC 方案

- 状态：Review（基于 2026-08-18 代码现状）；§6 为已确认的后续方案修订方向
- 审查对象：`apps/editor`（background + ui）与 `service/` 的 Component Author
- 对照方案：`rfc/2026-08-16-editor-component-asset-workflow.md`（下文简称 RFC）
- 范围：AI 让"创建组件"的实际数据流、验证链、素材库、封面、时间线放置；不含页面上下文质量

> **后续修订（§6，已确认）**：工具面收敛为单一异步 `component.create`（移除 `component.author`），一律走
> 同模型受限子 Agent，模板作为 skeleton/起点而非直发成品。此修订已体现在本文档 §6，取代 RFC §7.3 旧设想。

## 1. 结论摘要

RFC 的核心目标大多已落地：**组件创建默认只进素材库、不碰时间线**；`component.create` 快路径单调用发布 verified；
`component.author` / `component.revise` 通过 service 层的**同模型受限子 Agent** 提交候选；主 Agent 无法直接调用
`component.define / component.verify / component.source / component.resolve`（manifest 均声明为 `api` 面而非 `mcp`），
能力按意图缩小这条边界**确实生效**；时间线放置只接受 verified 组件（`project-store.js` 的 verified 门禁）。

有两处与 RFC 方案存在**实质性偏差**，是本 review 最需要关注的点；此外工具面本身存在一个**易混淆设计**，
且**归位模型存在根本性需求分歧**（见下文与 §6 修订）：

1. **"verified" 由代码级构建自证，而非真实渲染。** service 的 `verifyComponentCode` 用硬编码
   `report:{ok:true}` 直接调用 `component.verify` 把 draft 提升为 verified head；浏览器 harness 渲染只是
   之后在素材库可见时"补封面"，不再重新证明 head。这与 RFC §6.2 生命周期图（custom 路径是
   `component.commit → draft → browser verify → verified`）不一致。
   **修订（§6.5 / R5）**：已确认 verify 只做轻量"能跑通"检查，视觉由人判断——因此**不需要**渲染级 verified，
   该"偏差"按 R5 收敛为合理行为。
2. **canonical placement resolver 未统一，仍有两份分叉实现。** RFC 的 P5 / D6 / §8.2 明确要求 UI 与 MCP
   使用同一份放置规则并移除分叉，但现状是 `model-base.findOrCreateAvailableTrack`（background）与
   `ui/src/timeline/placement/resolve.ts`（UI）各写一套。两者对同一场景的轨道归属可能不一致。（未修订）
3. **工具面易混淆（`component.create` vs `component.author` 语义重叠）。** 现状两条路径并存、快路径还硬编码
   feature-chip 直发自证，AI 常误解 create 而不用 author。已确认收敛为单一 `component.create`（见 §6）。
4. **归位模型分歧：AI 素材应进「素材库」而非独立「组件」tab。** RFC D1/§6.1 与现状（`components` tab）
   把组件单独分类，造成"用户以为没创建/不知道在哪"的歧义。**修订（§6.6 / R6）**：AI 生成的素材全部进入
   media（素材）素材库，不设第三个「组件」tab。

## 2. 真实实现流程（端到端）

### 2.1 两条创建路径（入口）

| 路径 | 工具 | 承载层 | 复杂度 | 是否真实渲染即 verified |
|---|---|---|---|---|
| 快路径 | `component.create({items})` | app background（`components.js`） | 仅 `feature-chip` 模板 | 否：构建即写 `trusted-template` 报告置 verified |
| 复杂路径 | `component.author({brief})` / `component.revise` | service（`mcp.go` 拦截 → 子 Agent） | 任意自定义视觉 | 否：代码级构建自证置 verified；浏览器渲染后补封面 |

### 2.2 快路径 `component.create`（app background）

```
Agent → component.create({items:[{template:"feature-chip",...}]})
  → 校验：template 必须 === "feature-chip"（否则 throw，整批不落）
  → 每项 defineComponent(featureChipDefinition(item))
      → buildComponentBundle：写 <versionId>.tsx → node scripts/component-build.js（esbuild+tsc+确定性扫描）
      → 成功则 insert editor_component_versions(status=draft)
  → 循环内把每项 update 成 status=verified + 硬编码 report {ok:true,checks:[trusted-template]}
  → 更新 head_version_id
  → 同步返回全部 verified；事件 project.components.changed{library.tab=components}
```

- 无浏览器渲染、无封面写入；封面由 UI 素材库打开时补（见 2.5）。
- 一次调用即全部 verified，符合 RFC"模板组件一次调用即 verified"的目标；但只支持一个模板。

### 2.3 复杂路径 `component.author` / `component.revise`（service 子 Agent）

这是 RFC §7.4 的"同模型受限 Author"真实落点，实现在 **service 层**而非 app background：

```
Agent → component.author({brief})  (mcp.go:452 拦截，未走 app background)
  → componentAuthorJobResponse → startComponentAuthorJob（异步 job，component_author_jobs.go）
  → runComponentAuthorJob → runComponentAuthorWithContext
      → 校验：父会话必须 Codex（session.Runtime=="codex" && CodexModel!="")
      → normalizeCodexConfiguration(父 model, effort)
      → bridge.CreateSession：Runtime=codex，继承 model/effort，
          AllowedTools=["recut.editor.component.commit"]，ComponentTarget=项目
      → 只读 workspace，codex exec：-s read-only + component_author MCP override
      → componentAuthorPrompt：提示子 Agent 只调 mcp__component_author__recut_editor_component_commit 一次
  → 子 Agent 调用 component.commit
      → mcp.go:357 拦截：session.ComponentTarget() 必须存在（focused session）
      → 注入 componentId / baseVersionId → host.InvokeAPILocale("recut.editor","component.define")
      → 要求返回 status=="draft"，RecordComponentCommit 记录结果
  → verifyComponentCode(host, target, committed)
      → host.InvokeAPILocale("recut.editor","component.verify",{
            report:{ok:true, checks:[component-build], frames:[], mode:"headless-code"},
            revealLibrary:true })
      → status=="verified" 才算成功 → 成为 verified head
  → job 完成，可通过 recut.job.status/wait/cancel/logs 观察；失败用 component.author.retry
```

`component.revise` 先 `component.source(head:true)` 读当前源码，把 instruction + 当前源码拼成 brief，
带 `baseVersionId`（当前 verified head 的 versionId）传给同一 Author job。`component.define` 侧
（`components.js:117-130`）用 baseVersionId 做乐观并发门，防止覆盖更新的 head。

关键点：**复杂路径的 verified 是"代码级"（构建 + tsc + 静态扫描通过即自证），没有真实渲染。**

### 2.4 验证 `component.verify`（app background）

```
component.verify(versionId, report?)   (components.js:264)
  有 report：report.ok===true → status=verified + 更新 head；
            report.cover.fileBase64 → 写 components/covers/<versionId>.png 存 cover_path
  无 report：仅回读当前状态（供 AI 轮询）
```

- 两个调用方都走这里：service 的代码级自证（headless-code）与 UI 浏览器 harness（browser-render + 封面）。
- 信任边界：主 Agent **无法**直接调用 `component.verify`（manifest `surfaces:["api"]`），只有受管路径
  （service 的 `host.InvokeAPILocale`、UI 通过 `recut.background.call`）能写。这一点 RFC 的能力缩小做到了。

### 2.5 UI 组件素材库 + 封面（app ui）

```
组件素材库面板挂载（component-library.tsx）
  → ensureVisibleComponentCovers()（component-cover.ts）
      → component.list 找 [draft 且无封面] 或 [verified 且无封面] 的版本
      → 对每个版本起隐藏 iframe（component-harness.html）
          → component.resolve(versionId) 取精确 bundle
          → harness.setComponent + render(0.45)（WebGL / HTML-in-Canvas）
          → 成功则 component.verify(versionId,{report:{ok:true,checks:[browser-render,html-in-canvas-cover],cover:...}})
              → 写 verified（若还 draft）+ 写 PNG 封面
  → syncTimelineComponents(project)：同步 verified 组件进 runtime 注册表，供预览/插入
```

- 封面只在**素材库可见**时生成，且失败被吞掉（`console.warn`，下次访问重试）。不是强保证。
- 素材库卡片：有 coverUrl 显示真实视觉，否则回退到纯色块 + 名称（RFC D8 的"真实视觉入口"部分达成）。

### 2.6 时间线放置（唯一落轨入口）

```
timeline.placeComponents({items, trackType, sceneId, baseVersion})   (project-operations.js:213)
  → executeCommand(scopeId, {type:"component-placement", ...})       (project-store.js)
      → baseVersion 乐观锁（冲突返回 conflict + opsSince）
      → 收集 items 的 componentId，逐一 headVersion，要求 status==="verified"（否则拒整批）
      → applyOp "component-placement"（op-engine.js:36）
          → 逐 item findOrCreateAvailableTrack（model-base.js:305）
              → 同类型轨内找首个与 [start,duration] 完全不重叠的轨；找不到则新建同类型轨
      → 一次写 project + command log（原子）
```

- 逐条 `timeline.command insert` 对 component 元素同样走 `findOrCreateAvailableTrack`（`op-engine.js:20-23`
  当 `element.type==="component" && !trackId` 时），也有 verified 门禁。
- **UI 的拖拽/添加走的是另一套** `ui/src/timeline/placement/resolve.ts`（见 §5-2）。

## 3. RFC 逐条对照

| RFC 项 | 方案 | 现状 | 结论 |
|---|---|---|---|
| §6.1 创建默认 library-only，不落轨 | 创建不改时间线 | 两条路径都不写时间线；verified 门禁兜底 | ✅ 已实施 |
| D2 主 Agent 一次调用，按复杂度分 `create`/`author` | 快/复杂两条路径 | 两条路径都存在 | ✅ 已实施 |
| D3 模板调用同步 verified；复杂调用 draft→verified | 模板构建即 verified | 模板 = 构建即 verified（`trusted-template`）；复杂 = 代码级自证即 verified | ⚠️ 达成，但 verified 语义弱化 |
| D4 受信 feature-chip 快速路径，批量 items | 一次调用多 items | 支持多 items（循环） | ✅ 已实施 |
| D7 同模型 General Author，仅唯一 commit 工具 | 子 Agent 只拥有 commit | service 子 Agent `AllowedTools=[component.commit]`，继承 model/effort | ✅ 已实施 |
| §7.6 验证只能由受信 verifier 从真实渲染写入 | 浏览器 verifier 才写 verified | verified 由代码级自证写入；浏览器只补封面 | ❌ 偏差 |
| D6/§8.2 canonical placement resolver 单一实现 | UI 与 MCP 同规则 | `model-base` 与 `ui/placement/resolve.ts` 两份分叉 | ❌ 未实施 |
| D8 真实渲染组件封面 | harness 导出 PNG | UI harness HTML-in-Canvas 封面，素材库可见时生成 | ✅ 已实施（非强保证） |
| §7 creation job（通用 job / cancel / 模板匹配 / Fast Author） | v2 候选，明确未实施 | 未实施（RFC 已声明） | ⏸ 已知后续 |
| §7.7 placeComponents 先查 verified 再原子放置 | 原子 + 前提校验 | 有 verified 门禁 + baseVersion 乐观锁 + 单次写入 | ✅ 已实施 |
| §6.3 完成反馈 "已保存到组件素材 · 已验证" | 库内定位 + toast | 事件带 `library:{tab:"components"}`；toast/定位由宿主消费 | ⚠️ 依赖宿主 |

## 4. 架构合理性评估

### 4.1 做得对的地方

1. **素材与实例分离、默认无副作用（P1/P2）。** 创建链绝不写时间线，落轨必须经过显式
   `timeline.placeComponents` 或带 verified 门禁的 insert。这是本次事故最关键的修复，且落实到位。
2. **能力按意图缩小（P7）真正生效。** `define/verify/source/resolve` 均为 `api` 面，主 Agent 的 MCP 面
   拿不到；复杂路径用受限子 Agent + 唯一 commit 工具，把"写源码 + 驱动 verifier + 入库"从主 Agent
   手里拿走。这与 RFC 的设计一致，是干净的能力边界。
3. **版本与并发安全。** `component.define` 的 `baseVersionId` 乐观门、`executeCommand` 的 baseVersion
   乐观锁 + verified 门禁 + 单次原子写入，防止半组 clip 与版本竞态（RFC §3.1-7 / §7.7）。
4. **确定性构建链。** `component-build.js` 的静态扫描（禁墙钟/随机/非白名单 import）+ tsc + 内容寻址 hash，
   为"可复现、可验证"的组件执行环境打底。
5. **架构分层合理。** app background 管"确定性命令内核 + 组件存储"，service 管"同模型子 Agent 编排 +
   可信 API 调用"，UI 管"可见性触发 + 渲染封面"。三层职责基本正交，没有把探索逻辑泄漏给主 Agent。

### 4.2 需要正视的问题

（详见 §5，这里先给架构层面的判断）

1. **"verified"语义被稀释为"能构建"。** 快路径与复杂路径的 verified 都不经过真实渲染，RFC 最强调的
   "可信验证"实际退化为"可信构建 + 自证"。这会让组件素材库出现"标为已验证但从未真实渲染过"的条目，
   落轨后用户才在预览/导出看到问题。
2. **放置规则没有单一真相（P5 未兑现）。** 这是 RFC 自己点名的核心决策，至今仍是两套实现。谁写入
   document 谁就应守同一布局法律——现在没做到。
3. **封面/浏览器验证是"可见性驱动 + 尽力而为"，非确定性交付。** 不打开素材库就没有封面；失败被静默
   吞掉。封面是组件素材库的可发现性入口，不应依赖用户偶然打开面板。

## 5. 问题清单与修复建议

### 问题 1（高）：verified 未经真实渲染即确立（RFC §7.6 / D8 偏差）

- 证据：`service/component_author.go:210` `verifyComponentCode` 硬编码 `report:{ok:true,...mode:"headless-code"}`；
  `apps/editor/background/components.js:241`（create 快路径）硬编码 `report:{ok:true,checks:[trusted-template]}`。
- 影响：组件库会出现"已验证但从未渲染"的条目；渲染/导出阶段才暴露视觉问题，违背"验证只改变素材状态"
   的可信语义。
- **修订（§6.5 / R5）**：已确认验证只做轻量"能跑通"，视觉质量由人判断——因此**不再要求**渲染级 verified，
   也不拆 code/rendered 两级强门禁。本问题降级为"确保 verified 仍由受信路径写入，且门槛语义明确为
   '可运行'"。
- 建议（在 R5 框架内保留的收敛点）：
  1. 明确 verified 的门槛语义 = "能构建、能跑"（轻量），并在 manifest/技能里写清，避免误当"像素已确认"。
  2. 收敛 `component.verify` 的写入面：为 report 增加 `mode` 字段校验（当前 schema 未强制），并由
     service/浏览器分别带 `capability`，阻止任意受信 API 调用者凭空声明 `ok:true`。

### 问题 2（高）：canonical placement resolver 未统一，两套实现并存（RFC §8.2 / P5 / D6 未实施）

- 证据：`apps/editor/background/model-base.js:305` `findOrCreateAvailableTrack` 与
  `apps/editor/ui/src/timeline/placement/resolve.ts:134` `resolveTrackPlacement` 各自实现 firstAvailable。
- 影响：同一 scene/items 在 UI 拖拽与 MCP 放置下可能得到不同轨道归属与层级；违反"谁写入 document 谁守
  同一布局法律"。
- 建议：按 RFC §8.2 把 resolver 提到**共享纯函数域**（如 background 导出 + UI 通过 bridge/API 调用同一结果），
  并以纯函数测试固定 firstAvailable 的稳定性；移除"UI 会避碰、MCP 不避碰"的分叉分支。至少先让
  `timeline.placeComponents` 与 UI 的 `insertElement` 走同一判定（可通过新增一个只读 `placement.resolve` API）。

### 问题 3（中）：封面与浏览器验证是可见性驱动 + 尽力而为，非确定性交付（RFC D8）

- 证据：`apps/editor/ui/src/recut/component-cover.ts:79` `ensureVisibleComponentCovers` 只在素材库面板
  挂载时触发；失败被 `console.warn` 吞掉，下轮重试。
- 影响：无活动编辑器 iframe / 不打开素材库时，组件无封面也无真实渲染确认；库卡片回退到纯色块。
- **修订（§6.5 / R5）**：已确认封面是**可选展示图**，不是验证的一部分。因此"封面缺失/尽力而为"不再是缺陷，
  无需后台强保证。
- 建议（保留）：封面缺失作为 `component.list` 的可读状态暴露，让 Agent/用户能按需补齐，而不是静默跳过。

### 问题 4（中）：快路径 `component.create` 只支持 `feature-chip` 一个模板（RFC §7.3 Fast Author 未实施）

- 证据：`components.js:225-231` template 校验硬编码 `"feature-chip"`，其它一律 throw。
- 影响：RFC 设想的 role 驱动的模板匹配 / Fast Author 分类并不存在；任何非 chip 的简单组件都要升到
  `component.author`（起一个 Codex 子 Agent），成本与延迟高于"模板实例化"。
- **修订（§6 / R1+R4）**：create/author 合并后，本问题被"模板 = skeleton、一律走子 Agent"取代，不再适用。

### 问题 5（低）：快路径与复杂路径分属 app background 与 service，信任与验证故事割裂

- 证据：`component.create` 在 app background 内自证 verified；`component.author` 由 service 自证 verified。
- 影响：同一 `verified` 状态语义不同、来源不同，审计与演进都更复杂。
- 建议：把"如何得到 verified"收敛为单一判定函数（问题 1 的状态细分即可覆盖），两路径都调用它。

### 问题 6（低）：遗留调试脚本游离于运行时流程

- 证据：`apps/editor/ui/recut-verify-feature-chips.mjs`（硬编码 APP_ROOT、版本 ID、临时 SRC_DIR）与
  `recut-harness-verify.mjs` 是离线调试产物，硬编码了当初事故的四块 chip。
- 建议：若不再使用应移出仓库或标注为临时调试脚本，避免被误认为运行时验证链的一部分。

## 6. 方案修订：统一创建与源码读写（已确认方向）

> 本修订来自用户对 review 的反馈，作为后续实施的方向性共识。它**取代** §5 问题 4 与 RFC §7.3"模板命中即
> 零模型实例化"的旧设想，并对 §5 问题 1/2 提供统一的收敛载体。

### 6.1 核心决策

| 决策 | 内容 |
|---|---|
| R1 | **工具面只保留 `component.create`（+ `component.revise`）。** 移除 `component.author` 与
  `component.author.retry` 两个 MCP 工具。AI 只需记住"创建组件 = create"，不给它两个语义相近、易混淆的入口。
  给 AI 的工具越少越好（减少误解与分支）。 |
| R2 | **`component.create` 一律走子 Agent 流程，内部自动路由。** 不再有"app background 直接自证 verified"
  的并行路径；所有创建都通过 service 的同模型受限子 Agent，唯一 `component.commit` 工具交付。 |
| R3 | **`component.create` 是异步 job。** 返回 `{creationJobId, components:[... authoring]}`，用
  `recut.job.status/wait/cancel/logs` 观察/控制；失败可 `cancel` / `retry`。与现有 author job 生命周期一致。 |
| R4 | **模板 = 子 Agent 的 skeleton/起点，不是拿来直接发布的成品。** 模板的目的是让 AI 有个骨架可以快速
  start，而不是"create 命中模板就零模型实例化"地直接产出。 |
| R5 | **`component.verify` 只做基础"代码能跑通"的验证，不增加复杂度。** 验证要快；最终视觉效果大概率由人来
  判断，不值得为"渲染级验证"付出复杂度和延迟。不再把浏览器渲染/封面作为 verified 的前置或强约束
  （§5 问题 1 的"拆 code/rendered 两级 verified"仅保留一个轻量占位，不作为核心）。 |
| R6 | **AI 生成的素材全部进入「素材库」（media tab），不设第三个「组件」tab。** 这是根本性的需求理解修正：
  AI 创建的东西对用户来说就是"素材"，应与普通媒体同处一个素材库，而非藏进单独的组件分类
  （取代 RFC D1/§6.1 的独立「组件素材」tab 与当前 `components` tab）。 |
| R7 | **AI 组件可双击预览，并能查看源码；多文件时可在文件间切换。** 素材卡片双击 → 预览 + 源码视图；
  组件可能含多文件源码（skeleton 展开后），提供文件切换。 |
| R8 | **主 Agent 也可拥有读取/编辑组件源码的工具。** 在"读源码、改源码"这类聚焦任务上，主 Agent 往往比
  受限子 Agent 效率更高（有完整上下文）；因此除 create/revise 的受限子 Agent 路径外，开放主 Agent 的
  `component.source`（读）+ 源码编辑（改）能力，但写仍须经受管路径（构建 + 轻量验证 + 进素材库）。 |
| R9 | **组件分两种形态：`mode:"fullscreen"` 与 `mode:"local"`。** 创建时由主 Agent 按意图选择；fullscreen 时
  平台向受限子 Agent **注入当前画布宽高上下文**（缺省 1920×1080），要求 `getBaseSize` 对齐画布并铺满
  edge-to-edge；local 为画布局部装饰件（chip/badge），按自身设计尺寸。`mode` 随组件存储，
  `component.list`/`resolve` 返回，供 UI/runtime 呈现。 |

### 6.2 模板作为 skeleton（取代 RFC §7.3）

- 旧的设想（RFC §7.3）：`component.create` 内部先做模板匹配，命中 feature-chip 就**直接实例化参数发布**，
  不调模型。这一路径被当前实现成"app background 里硬编码的 feature-chip 自证 verified"。
- 修订后：`feature-chip` 等模板**不直接产出**，而是作为**注入子 Agent 的 curated skeleton**——子 Agent
  拿到模板源码、inputs 结构、确定性动画范例后，基于它改写/扩展成目标组件。子 Agent 仍用唯一
  `component.commit` 交付自己的源码。
- 收益：
  - 消除"create 硬编码模板 + 自证 verified"这条绕过子 Agent、且 verified 语义被稀释的路径（对应 §5 问题 1/5）。
  - 模板的价值从"直接给成品"变为"给 AI 一个高质量起点"，既符合"给 AI 越少工具越好"，又保留 skeleton 的提速作用。
  - 模板库未来可扩展成 `role -> skeleton` 的映射，由 create 内部按 brief/role 选择注入，不再暴露成独立工具。

### 6.3 单一 create 的签名（草案）

```ts
component.create({
  items: [
    {
      nameHint: "Remotion Native Agent Chip",
      brief: "画布底部的小型横向提示牌：Remotion 图标、主标题…副标题…青色重点，克制的入场动画。",
      role: "bottom-feature-chip",          // 可选：用于选 skeleton
      template: "feature-chip",             // 可选：显式指定 skeleton；不指定则 create 内部按 role/brief 选
    },
    // 支持多 items：一个 job 内共享同一设计上下文，避免 N 次子 Agent 回合
  ],
  references: { componentIds: [], assetIds: [] },
  design: { canvas: { width, height }, locale: "zh-CN" },
});

// → 立即返回：
// { creationJobId, components: [{ componentId, status: "authoring", libraryItem }], status: "running" }
// 终态（recut.job.wait）：
// { creationJobId, components: [{ componentId, versionId, status: "verified", coverUrl }] }
```

- `items` 是批量而不是 N 次单调用；一个 Author 在同一设计上下文里决定"哪些是同模板不同 params、哪些是独立组件"。
- 不接受 `source`/`trackId`/`placement`：写源码、验证、入库、落轨都是工具内部或独立放置动作，不暴露给 AI。

### 6.4 内部路由（create 内部，非新工具）

```
component.create(brief/items)
  → 建 creationJob + authoring 占位（立即进素材库，用户可见进度）
  → 按 role/brief 选 skeleton 模板（命中 feature-chip / 未命中给通用骨架）
  → 启动同模型受限子 Agent（继承父 model/effort，AllowedTools=[component.commit]）
      → 子 Agent 以 skeleton 为起点，commit 源码
  → 构建（component-build.js：esbuild+tsc+确定性扫描）+ 轻量"能跑通"验证（R5）
  → 封面尽力而为生成（不影响 verified，R5）
  → 条目 → verified（成为 head，落轨门槛）；失败保留诊断 + retry 入口
```

- 验证（R5）只做"能构建、能跑"的轻量检查，快速通过即可 verified；不要求浏览器渲染，不为像素质量负责。
- 归位（R6）：verified 条目进入 **media（素材）素材库**，不单独开「组件」tab。

### 6.5 验证语义：只做"能跑通"的轻量验证（R5）

- 定位：`component.verify` 的价值是**快速确认"这代码能构建、能在 runtime 跑起来"**，仅此而已。
- **不增加复杂度**：
  - 不做/不要求浏览器渲染作为 verified 前置；不做"渲染级 vs 代码级"的强状态拆分。
  - 封面（若保留）作为**尽力而为的展示图**，失败不影响 verified 状态，也不阻塞创建。
  - 人工是视觉质量的最终裁判；系统不为"像素级好看"负责，只保证"可运行、可落轨"。
- 对 §5 问题 1 的影响：`verifyComponentCode` 的代码级自证（build 通过即 verified）**保持合理**，因为
  verify 本来就该是轻量"能跑通"检查。不需要 RFC §7.6"只能由真实渲染 verifier 写入"的强约束——那是为
  "像素正确性"设计的，与"快"的目标冲突。
- 边界：verified 的**门槛语义**下调为"可运行"，但仍必须是**受信路径**写入（主 Agent 仍不可直接调
  `component.verify`）；且落轨前仍要求 verified（`project-store.js` 门禁不变）。

### 6.6 素材归位：AI 素材进「素材库」，不设第三个「组件」tab（R6）

- 现状：`assets-panel-store.tsx` 有独立 `components` tab（label 组件），`component-library.tsx` 单独渲染；
  RFC D1/§6.1 也设计了独立的「组件素材」分类。这是**需求理解的分歧点**，本修订推翻它。
- 修订：AI 生成的组件作为**一种素材**，出现在 **media（素材）tab 的素材库**里，与图片/视频/音频同列，
  用户用统一入口看到"这个项目有什么"。
- 具体含义：
  1. 素材库条目的来源标记（如 `origin: component` / `type: component`）区分"这是 AI 代码素材"，
     但**归到同一 media 视图**，不另开 tab。
  2. 卡片在 media 视图内可用封面/名称渲染，可拖拽/点击预览/落轨，与媒体素材一致。
  3. 移除/停用独立 `components` tab（或将其并入 media 视图的子筛选，而不是单独导航入口）。
- 收益：
  - 消除"用户以为没创建/不知道在哪"的歧义——这正是当初事故（§RFC 2.1）的根源之一。
  - 减少一个顶层导航项，降低 UI 复杂度与用户理解成本。
- 影响面：`assets-panel-store.tsx`（tab 结构）、`component-library.tsx` / `effects`（渲染入口）、
  `component.list` / 事件的 `library:{tab:"components"}` 字段（改为指向 media）、技能文档措辞。

### 6.7 源码预览与多文件切换（R7）

- 需求：AI 组件在素材库中**双击可预览**，并能**查看源码**；组件含多文件源码时可**切换文件**。
- 现状：`ComponentPreviewDialog`（`component-library.tsx`）已支持双击打开实时预览，但**只预览、不显示源码**。
- 修订：素材卡片双击 → 弹窗分两个区：**预览**（沿用 `ComponentPreview`）+ **源码**（只读展示）。
  - 源码来自 `component.source`（当前 verified head 的单文件 source）；若将来组件为多文件，弹窗提供
    文件 Tab/列表切换。
  - 首期组件是单文件 TS/TSX（唯一外部 import `@recut/runtime`），故先呈现单文件；多文件切换作为
    skeleton 展开后的扩展点保留。
- 影响面：`component-library.tsx` 的 `ComponentPreviewDialog` 增加源码面板 + `component.source` 读取；
  UI 需要语法高亮/只读代码展示。

### 6.8 主 Agent 读取/编辑源码工具（R8）

- 需求：**主 Agent 也可读组件源码、编辑组件源码**；这种聚焦的读/改任务，主 Agent 有完整上下文，
  往往比受限子 Agent 更高效。
- 现状：`component.source` 是 `api` 面，主 Agent 的 MCP 拿不到；只有受限子 Agent 的 commit 工具能写。
- 修订：为**主 Agent** 开放两个工具：
  - `component.source`（读）：从 `api` 扩到 `api+mcp`，主 Agent 可读当前 verified head 源码，作为
    "看清楚再改"的输入。
  - `component.revise` 已存在（改入口）：主 Agent 传 `{componentId, instruction}` 即可让平台做定向修改。
    若需要**直接提交源码**（主 Agent 自己改完再落），可扩展一个主 Agent 可用的 `component.commit`（或
    `component.update`）受管入口：接受主 Agent 的源码，走同样的构建 + 轻量验证 + 进素材库，但**不经受限
    子 Agent**。
- 边界（与 R2 不冲突）：
  - 创建仍走受限子 Agent（`component.create`，一个 job 批量生成）。
  - 读/改是**聚焦任务**，放给主 Agent 更高效——这正是 R8 的动机。
  - 写仍须经受管验证（构建 + 轻量"能跑通" + verified 门禁），且**不直接落轨**（放素材库，落轨另走
    `timeline.placeComponents`）。
- 影响面：manifest 面（`component.source` → `api+mcp`；新增主 Agent 可用的受管提交入口）、service mcp.go
  路由、技能文档。

### 6.9 迁移与兼容（已实施）

**平台层（service）——通用受限子 Agent 执行器，无任何 App 专属 Go 代码：**
- `subagent.go`：通用 `runFocusedSubAgent`（App 无关）——以受限工具面在只读 sandbox 跑一个同模型 Codex 子 Agent，
  收集其受限工具调用的结构化结果。`SubAgentRequest{ allowedTools, prompt, componentId?, baseVersionId?, model?, effort? }`。
  通用入口 `recut.agent.run {app, operation, payload, target?}`；manifest 标记 `subAgent:true` 的 op 由平台自动走
  authorize → run → finalize（finalize 把工具调用结果回传同一 op）。
- `agent_jobs.go`：通用 `AgentJob` 生命周期（status/phase/result/cancel/wait），经统一 `recut.job.status/wait/logs/cancel` 观察。
- `mcp.go`：应用 op 分发不再有任何 `component.*` 专属分支；`operationIsSubAgent(manifest, op)` 命中即启动通用
  subAgent job（`startAppSubAgentJob`）。`component_author.go` / `component_author_test.go` 已删除。

**App 层（editor background）——上下文与工具范围完全由 background 动态声明：**
- `component.create` / `component.revise`（api+mcp，`subAgent:true`）：
  - authorize（无 `subAgentTools`）：返回 `{subAgent:{allowedTools:["recut.editor.component.commit"], prompt(含 skeleton), componentId?, baseVersionId?}}`；
  - finalize（带 `subAgentTools`）：提取 `component.commit` 结果，经共享 `applyComponentVerify` 轻量验证进素材库，返回 `{components, library:{tab:"media"}}`。
- `component.verify` 与 finalize 共用 `applyComponentVerify`（提取自原 verify 内联逻辑）。
- manifest：`component.author` / `component.author.retry` / `component.request` 移除；`component.source` 扩为 `api+mcp`；
  新增 `component.update`（主 Agent 直接提交源码新版本）。
- UI 归位（R6 修正）：**平台内置组件**留在独立「组件」tab（`ComponentLibraryView`，过滤 `ai-` 前缀）；
  **AI 用户创建的组件素材**（`ai-` 前缀）进入 media（素材）视图（`AiComponentLibraryView`），生命周期只在项目 assets。
- R7：`ComponentPreviewDialog` 增加源码面板（读 `component.source`）；多文件切换作为扩展点。
- 技能文档：`SKILL.md` / `components.md` / `component-authoring.md` 统一为"创建组件 = `component.create`/
  `component.revise`（异步 job，recut.job.* 轮询）；读源码 `component.source`；直接改源码 `component.update`"。
- 测试：`component_author_test.go` 删除；`e2e-component-chain.test.js` 用 define+verify（受管创建）+ `library.tab:"media"`。

### 6.10 对 §5 问题的影响

| §5 问题 | 修订后状态 |
|---|---|
| 问题 4（create 只支持 feature-chip 模板） | 由 R1/R4 直接消解：不再有"create 直发模板"，模板变 skeleton 由内部路由注入 |
| 问题 5（快/复杂两路径信任割裂） | 由 R2 消解：所有创建收敛到单一子 Agent 路径 |
| 问题 1（verified 未经渲染自证） | **由 R5 收敛**：verified 本来就是轻量"能跑通"检查，无需渲染自证；R2 消除了 background 自证路径 |
| 问题 3（封面可见性驱动、非强保证） | **由 R5 消解**：封面降级为可选展示，不强保证不再是缺陷 |
| （新增）独立「组件」tab 造成归位歧义 | **由 R6 修正**：AI 素材全部进 media 素材库，不设第三个 tab |

## 7. 核心实现问题（代码级，读码发现）

> 本节与 §5（"方案 vs 现状"的偏差）不同，是直接读实现发现的具体缺陷/风险，与 RFC 对照无关。

### C1（高）：`insert` 对 component/graphic 缺省 durationSec 时，避碰用 0 宽度 span，导致同轨静默叠放

- 位置：`apps/editor/background/op-engine.js:20-23`
  ```js
  var isImplicitComponentPlacement = payload.element.type === "component" && !payload.trackId;
  var track = isImplicitComponentPlacement
    ? findOrCreateAvailableTrack(scene, trackType, seq, undefined,
        tickOf(payload.element.startSec || 0), tickOf(payload.element.durationSec || 0))
    : findOrCreateTrack(scene, trackType, seq, payload.trackId);
  ```
- 问题：避碰传入的是 **`tickOf(durationSec || 0)`**，若 Agent 只给 `startSec` 没给 `durationSec`，则 span 宽度为 0。
  `spansOverlap`（`model-base.js:285`，`startA < endB && startB < endA`）对 `[start, start]` 与既有 `[start, end]`
  判定为**不重叠** → 所有缺 duration 的 graphic/component 全部复用第一条同类型轨。
  但 `buildElement`（`model-base.js:388`）实际把元素存为 `duration = max(tickOf(durationSec), 1)` ≥1 tick，
  **存储宽度与避碰宽度不一致**。于是多个 graphic clip 在时间上真实重叠，却落在同一条轨。
- 加重因素：`validateTimeline`（`op-engine.js:431-438`）**只校验 main 轨重叠**，graphic/component 轨的重叠
  不会被拦截，静默通过。这正是当初事故（四块 chip 叠成一条）会在**缺 duration 的单元素 insert** 上复现的路径。
- 对照：`component-placement`（`op-engine.js:43-45`）对 `durationSec<=0` 显式 throw，规避了此洞；但通用
  `insert` 没修。
- 建议：`insert` 的避碰 span 与 `buildElement` 的存储宽度统一（取 `max(durationSec, 最小 1 tick)`），
  或对 `durationSec<=0` 的 component insert 直接返回结构化错误；并把 validateTimeline 的 overlap 检查扩展到
  graphic/component 轨。

### C2（中）：video 放置 resolver 与 UI 行为分叉，且不复用既有 overlay video 轨

- 位置：`apps/editor/background/model-base.js:305-329` `findOrCreateAvailableTrack`
  ```js
  var arr = trackType === "audio" ? t.audio : (trackType === "video" ? [t.main] : t.overlay);
  for (var i = 0; i < arr.length; i++) { /* 只在 arr 里找 */ }
  ...
  else if (trackType === "video") t.overlay.push(created);
  ```
- 问题：video 类型只把 `[t.main]` 作为候选（`[t.main]`），**从不检查/复用既有的 overlay video 轨**；
  一旦 main 有重叠就新建 overlay 轨。而 UI 的 `resolveTrackPlacement`（`resolve.ts:138`）用
  `orderedTracks = [...overlay, main, ...audio]` 遍历**所有**同类型轨，会复用已有空档的 overlay video 轨。
- 影响：同一批 video 放置，UI 与 MCP 会得到不同轨道归属/层级；后端更"浪费"（多建轨），且与 RFC §8.2
  "同一布局法律"直接冲突（即 §5 问题 2 在 video 上的具体表现）。
- 建议：把 `findOrCreateAvailableTrack` 的候选从 `[t.main]` 改为"全部同类型轨（overlay + main）"，与 UI 对齐。

### C3（中）：`component.create` 构建失败留下"无 head 的 failed 组件"，永久污染 `component.list`

- 位置：`apps/editor/background/components.js:236-239`（create 循环）与 `:157-162`（failed 落库）
- 问题：`component.create` 每项先走 `defineComponent`；若 build 失败，`defineComponent` 已插入一条
  `status='failed'` 版本，但**不设 head**（`head_version_id` 保持 null），随后 create 因 `status!=='draft'` throw。
  该 failed 组件既未被归档，`component.list`（`components.js:310-340`，无 status 过滤）又持续返回它，
  以 `status:null` / `versionId:null` / `latestVersionId` 存在，永久留在素材库（无清理/重试闭环）。
- 影响：失败多次会产生一列永远无法渲染、无法落轨的"幽灵"组件条目；UI 封面同步（`component-cover.ts:83`
  只认 draft/verified）不会处理它们，但列表可见。
- 建议：`component.create` 失败时回滚组件行或自动归档；`component.list` 过滤掉"无 head 且无 verified 版本"
  的 failed-only 组件；或为 failed 组件提供显式删除/重试入口。

### C4（低）：`component.list` 的 status 类型不闭合，`status:null` 会漏给消费方

- 位置：`apps/editor/background/components.js:333` 返回 `status: r.status || "draft"`，但 `r.status` 来自
  `left join` 的 head 版本；无 head 时为 `null` → 回退 `"draft"`。
- 问题：TS 侧 `AiComponentStatus = "draft"|"verified"|"failed"`（`ai-components.ts:9`）没有 null/undefined 分支，
  但 failed-only 组件会被 `|| "draft"` 强标为 draft——而它其实没有可渲染 head。消费方（UI 封面同步、库卡片）
  会把一个无 head 的 failed 组件误当成"待验证 draft"去 `component.resolve(versionId)`，resolve 返回空 → 占位。
- 建议：让 status 显式区分 `failed` / `no-head`，并在 `component.list` 里给"无 head"组件一个明确状态，
  避免 `|| "draft"` 掩盖真实情况。

### C5（低）：显式 `trackId` 的 component insert 仍可同轨静默叠放（RFC 的例外未收敛为显式策略）

- 位置：`apps/editor/background/op-engine.js:23` —— 带 `trackId` 时走 `findOrCreateTrack`（`model-base.js:264`），
  该函数复用**第一条同类型轨**，不做 overlap 检查。
- 问题：RFC §8.1 说"显式 trackId 是唯一允许同轨覆盖的方式，重叠时返回结构化 conflict（除非声明 stack）"，
  但实现里显式 trackId 是**静默**叠放，既不报 conflict 也不要求 `strategy:"stack"` 显式声明。
- 建议：显式 trackId 且发生重叠时返回结构化 conflict；确需叠放时要求显式 `strategy:"stack"`（RFC §13-3），
  不要把它变成无言的副作用。

### C6（低）：代码级自证与浏览器渲染共用同一 `verified`，且 `component.verify` 的 report schema 未约束 `mode`

- 位置：`service/component_author.go:210`（`mode:"headless-code"`）与 `apps/editor/background/components.js:264`
  （`component.verify` 只读 `report.ok`）。
- 问题：`component.verify` 不校验 `report.mode` / 来源 capability，任何受信 API 调用方传 `ok:true` 即置
  verified。当前只有 service 与 UI 两个受信调用方，风险可控，但未来新增调用方时缺少强制区分"代码级 vs
  渲染级"的契约。
- 建议：在 `component.verify` 对 report 增加 `mode` 必填校验 + 白名单，并把 `verified` 拆分为
  `code-verified` / `rendered-verified`（即 §5 问题 1 的实现载体）。

## 8. 与 RFC 的阶段对照

| 阶段 | RFC 声明 | 现状 |
|---|---|---|
| Phase 0 语义止血 | 已实施 | ✅ 组件创建 library-only；禁止未显式 trackId 的静默叠放已由 `findOrCreateAvailableTrack` 承担 |
| Phase 1 v1 创建链 | 已实施 | ✅ `component.create` / `component.author` + commit / 浏览器补封面 / `component.resolve` coverUrl 均在 |
| Phase 2 canonical placement | 已实施 | ❌ **未完成**：UI 与 MCP 仍两份 resolver（§5 问题 2） |
| Phase 3 通用 creation job | 待实施 | ⏸ 未实施（RFC 已声明）；§6 的 create/author 合并正是该方向的收敛 |

## 9. 建议的下一步

0. **已确认方向（§6）**：`component.create`/`component.author` 合并为单一异步 `create`（一律走子 Agent，
   模板作为 skeleton，进素材库）；同时为**主 Agent 开放源码读写工具**（R8）、素材库卡片**双击预览 + 源码
   查看**（R7）。这是工具面与素材归位的收敛，建议作为首要方向推进。
1. 其次解决 **§5 问题 1（verified 语义）** 与 **§5 问题 2（resolver 单一真相）**——二者是 RFC 最核心的承诺，
   也是当前与方案偏差最大处；§7 C2 是问题 2 在 video 上的具体表现，C5 是问题 2 的显式 trackId 边界。
2. **先堵 §7 C1**：`insert` 缺 durationSec 时的零宽避碰会复现"多 clip 叠一条轨"，且 validateTimeline 不查
   graphic/component 轨重叠——这是最可能直接复现当初事故的实现缺陷，建议最先修。
3. 其余（§5 问题 6、§7 C6）可在 v2 creation job 一并收敛，不必单独返工。

## 10. 附录：关键代码定位

| 关注点 | 位置 |
|---|---|
| 快路径 `component.create` | `apps/editor/background/components.js:221` |
| `component.define`（构建 + baseVersion 门） | `apps/editor/background/components.js:97` |
| `component.verify`（report 写 verified/封面） | `apps/editor/background/components.js:264` |
| `component.resolve` / `component.list` | `apps/editor/background/components.js:378` / `:310` |
| 构建脚本（esbuild+tsc+静态扫描） | `apps/editor/scripts/component-build.js` |
| 复杂路径 service 拦截 | `service/mcp.go:452`（author/revise/retry） |
| 子 Agent 唯一 commit 工具 | `service/mcp.go:357` → `component.define` |
| 代码级自证 verified | `service/component_author.go:210` `verifyComponentCode` |
| Author job 生命周期 | `service/component_author_jobs.go` |
| 原子放置 + verified 门禁 + 乐观锁 | `apps/editor/background/project-store.js:194` |
| background 放置 resolver | `apps/editor/background/model-base.js:305` `findOrCreateAvailableTrack` |
| UI 放置 resolver（分叉） | `apps/editor/ui/src/timeline/placement/resolve.ts:134` |
| 组件素材库 + 封面触发 | `apps/editor/ui/src/components/editor/panels/assets/views/component-library.tsx` |
| 浏览器渲染 + 封面回写 | `apps/editor/ui/src/recut/component-cover.ts` |
| C1 insert 零宽避碰 | `apps/editor/background/op-engine.js:20-23` + `model-base.js:285` |
| C2 video 放置分叉 | `apps/editor/background/model-base.js:305-329` vs `ui/src/timeline/placement/resolve.ts:138` |
| C3/C4 failed 组件泄漏 | `apps/editor/background/components.js:157-162,310-340` |
| C5 显式 trackId 静默叠放 | `apps/editor/background/op-engine.js:23` + `model-base.js:264` |
| C6 report.mode 未约束 | `apps/editor/background/components.js:264` |
