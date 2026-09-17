<!--
 * [INPUT]: 依赖 service/runtime.go（goja App background、op 注册、InvokeMCP）、service/builtin_apps.go（editor 已是内置 App）、service/project.go（平台项目存储）、
 *   docs/platform-comms-contract.md（Op 总线/async_ops/App→UI RPC/presence）、docs/app-contract.md（App 数据边界）、service/media（全局媒体资产）、
 *   apps/editor/background/*（11 个模块，~4.7K 行）、apps/editor/ui/src/*（~155K 行 TS，含时间线渲染模型）、apps/editor/scripts/component-build.js、
 *   web/app/projects/[id]（iframe 宿主与消息桥）、rfc/2026-08-13-visual-runtime-component-system、rfc/2026-08-14-ai-temp-components（@recut/runtime 单模块/服务端构建/iframe loader）
 * [OUTPUT]: 把「editor 并入 web 统一前端（模块 timeline-editor）」「timeline 逻辑下沉 Go（goja 退役）」「组件/素材平台化」「平台 Render Host」
 *   合并为一条迁移路线；含目标架构、模块级迁移映射、golden 一致性套件与 goja 兜底策略、通信契约适配、里程碑、风险与未决问题
 * [POS]: rfc 的「宿主与素材迁移」总路线；先于「视频理解」「素材 attrs 协议层」「clone skill」三步，是它们的地基
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# Editor 迁移：并入 web 统一前端 + timeline 逻辑下沉 Go + 平台 Render Host

- 状态：提案（待评审）
- 日期：2026-09-17
- 关联：[Visual Runtime 与 Component System](./2026-08-13-visual-runtime-component-system.md)、[AI 临时组件](./2026-08-14-ai-temp-components.md)、
  [平台通讯架构](./2026-08-19-platform-communication-op-bus.md)、[Editor AI Agent Surface](./2026-08-14-editor-ai-agent-surface.md)、
  [Editor 数据模型与选区](./2026-08-14-editor-data-model-selection.md)
- 稳定契约：[平台通讯契约](../docs/platform-comms-contract.md)、[App 契约](../docs/app-contract.md)
- 非目标：不在本 RFC 定义素材的属性/正文/配方协议（属下一份「素材 attrs 协议层」RFC）；不做组件市场/分发；不改时间线可观察语义（op 名与读模型）；不改 Op 总线契约版本。

## 0. 摘要

三件看似独立的事，其实是同一条迁移的三个面：

1. **Editor 去 iframe**：editor UI 现在是 `ui/dist/index.html`，由 web 宿主以 iframe 挂载，业务经 postMessage 桥与 `callUI` 通信。
2. **逻辑层形态**：时间线/项目/组件逻辑跑在 **goja App background**（无状态 VM，每次调用重载），持久化在 App 私有 SQLite，与平台能力之间隔一层 `ctx.*` 适配。
3. **渲染与组件的私有化**：组件（MG）存在 editor 私有表；构建依赖 editor 的 `scripts/component-build.js`；渲染依赖 editor UI bundle 产出的 `@recut/runtime` 共享实例 + import map。

**结论**：共同瓶颈是「**editor 把逻辑、渲染、素材都私有化在一个 iframe App 里**」。因此合并为一条迁移路线：

- **UI 并入 web 统一前端**，作为模块 **`timeline-editor`**（单 React 树，无 iframe）；
- **timeline 逻辑从 goja 下沉 Go**（平台服务），op 名与读模型不变；
- **组件/素材平台化**（`Material{backing: bytes|code}`），构建与渲染归平台；
- **平台 Render Host** 提供宿主无关的渲染执行，editor 从 runtime 所有者降为消费者。

本 RFC 的两条主线（评审重点）：

- **background.js 怎么办**：**下沉 Go**。理由与边界见 §4——一半模块本就是「持久化 + 平台适配」，Go 是它们的自然归属；goja 的 App 隔离理由随 editor 转为第一方模块而消失。
- **通信契约**：**契约本身不变**（信封/原语/async_ops/Handle/presence 全部沿用），只更换 **UI transport adapter**（iframe/postMessage → 原生直接调用）；timeline 写读不再过 `callUI`，`callUI` 只保留给渲染侧，并新增一份 **Render Host 契约**。

## 1. 现状与耦合点

### 1.1 三个平面

| 平面 | 现状 | 位置 |
|---|---|---|
| **逻辑平面** | 时间线/项目/素材引用/op 注册在 goja App background（每次调用全新 VM） | `service/runtime.go` + `apps/editor/background/*` |
| **UI 平面** | 编辑器界面与交互在 iframe（`ui/dist`，~155K 行 TS，自带时间线渲染模型） | `apps/editor/ui` + `web/app/projects/[id]` |
| **渲染平面** | R3F 场景、组件注册/执行、帧渲染、导出编码在编辑器 UI | editor UI bundle（`runtime.ts` 共享实例 + import map） |

### 1.2 耦合点清单（要拆的东西）

| # | 耦合 | 证据 |
|---|---|---|
| C1 | 组件**存储**是 editor 私有 | `editor_components` / `editor_component_versions`（editor SQLite） |
| C2 | 组件**构建**依赖 editor 仓脚本 | `components.js:62` `ctx.shell.exec(appRoot + "/scripts/component-build.js")` |
| C3 | 组件**渲染**依赖 editor UI 提供的 runtime 实例 | 08-14 D6/D7：`runtime.ts` 产出共享 chunk + import map，iframe 内 blob import |
| C4 | 帧渲染/导出经 `callUI` 打到 iframe | `preview.frame`、`export.start` 走 `frame.render` / `export.encode` + presence 心跳 |
| C5 | 逻辑层是**无类型 goja**，每次调用重建 VM，数据经 `ctx.*` 与 JSON 穿越边界 | `background/*.js` 无 tsc；持久化/文件/能力桥都经 ctx 注入 |
| C6 | UI 与 background **两份时间线模型**，靠文档约定同步 | `data-model.md` 头注「与 `ui/src/*/types.ts` 保持一致」 |

**C3 是根**：只要 runtime 实例由 editor UI 提供，任何其他宿主都无法执行同一份组件；去 iframe 也就没有东西提供渲染实例。**C5/C6 是第二根**：逻辑层无类型、双份模型，是长期维护成本与漂移源。

### 1.3 与既有契约的关系

- 通讯契约原文明确：**「传输层（WS / HTTP 桥 / MCP / 进程）是总线适配器，不属于本契约范围」**，且「不改 WS 单通道协议、HTTP 桥协议、MCP 协议、事件账本、goja 无状态 VM」。
- App 契约原文：**「App 数据属于 App；跨 App 协作只能使用公开 API 和不可变 Artifact 引用」**。

→ 本迁移**不修改通讯契约内容**；App 契约需要一次显式修订（editor 不再是可安装 App，见 §3 D1、§7.3）。

## 2. 目标架构

```text
UI 平面（web 统一前端，单 React 树）
  timeline-editor 模块
    ├── 渲染/交互：R3F 场景、关键帧求值、拖拽/吸附/选区、乐观投影、预览
    └── 只读投影 + op 派发（不做变更权威）
                 │  Op 总线（契约不变）
                 ▼
逻辑平面（Go / service，取代 goja）
  timeline 域
    ├── timeline model（tick/轨道/元素/关键帧/duck 包络，纯函数）
    ├── timeline ops（apply / validate / condensed 读模型）
    ├── timeline store（项目文档 / 版本 / 命令日志 / undo / 锁 / checkpoint）
    ├── script 域 + subtitle 域
    └── op 注册：recut.editor.*（名与 payload 不变）
                 │
                 ▼
素材平面（平台）
  Material：backing = "bytes" | "code"
    ├── bytes → media_assets（既有全局媒体资产）
    └── code  → component 素材（source/bundle/hash/version/surface；入平台库）
                 │
                 ▼
渲染平面（平台 Render Host）
  Render Host：@recut/runtime 共享实例 + import map + 组件执行契约
    ├── web 内的 timeline-editor（消费者，不再是所有者）
    ├── 导出 worker（Preview == Export）
    ├── world canvas / remotion-studio（未来消费者）
    └── 验证 harness（组件 verify 的 render/composite 证据）
```

三条纪律：

- **逻辑与渲染分离**：Go 永不渲染（无 DOM），渲染只发生在 Render Host；两者经 Op 总线通信。
- **写权威唯一**：时间线的变更/校验只发生在 Go；UI 只做乐观投影与回读。
- **素材标识统一、存储分 backing**：media 是字节，component 是代码；不强行塞进同一张字节表。

## 3. 决策

| # | 决策 | 理由 |
|---|---|---|
| **D1** | **Editor 从「内置 App」转为「平台内置模块」**：UI = web 的 `timeline-editor`，逻辑 = Go timeline 域；不再走 App runtime（manifest/background/goja） | goja 的隔离价值针对不可信第三方 App；editor 已是内置第一方。去掉一层 VM 与 `ctx.*` 适配 |
| **D2** | **background 领域逻辑下沉 Go**（逐模块，见 §4）；`recut.editor.*` op 名与 payload **冻结不变** | 持久化/能力桥/agent 路径本就落在 Go；无类型 JS + 双份模型是维护成本与漂移源 |
| **D3** | **通信契约版本不动**；只换 UI transport adapter，并新增 **Render Host 契约** | 契约原文已把传输层排除在范围外；timeline 读写改直连 Go，`callUI` 只留给渲染侧 |
| **D4** | UI **并入 web 统一前端单 React 树**（无 iframe）；模块名 `timeline-editor` | 单 React 树天然满足「单 runtime 实例」，也消除 postMessage 桥与跨域桥 |
| **D5** | 素材统一为 **Material（backing: bytes\|code）**，本 RFC 只定**标识与引用**；attrs/content/recipe 留给下一份 RFC | 迁移先解决归属；属性协议可后置且不阻塞 |
| **D6** | **组件构建上移平台**：构建工具链成为平台能力，editor 不再拥有 `component-build.js` 的权威 | 去掉 C2；任何宿主构建结果一致，`bundleHash` 可校验 |

## 4. background 下沉 Go：模块映射与迁移方法（评审重点一）

### 4.1 判断：一半是平台的活，一半是领域逻辑

| background 模块 | 行数 | 本质 | 去向 |
|---|---|---|---|
| `project-store.js` | 443 | SQLite schema / 版本 / 命令日志 / undo / 锁 / checkpoint | Go：timeline store |
| `op-engine.js` | 621 | applyOp / validate / condensed 读模型 / elementDetail | Go：timeline ops |
| `model-base.js` | 502 | tick 换算 / 轨道 / 元素 / 关键帧 / duck 包络（纯函数） | Go：timeline model（duck 见 §4.4） |
| `script-model.js` | 398 | 文稿物化 / parse / apply → op 批 | Go：script 域 |
| `subtitles.js` | 136 | SRT/ASS 解析 + caption 样式 | Go：subtitle 域 |
| `assets.js` | 130 | 素材引用索引 | Go：并入 Material 引用（§7） |
| `project-operations.js` | 824 | op 注册与适配 | Go：op 注册 |
| `catalog-export.js` | 426 | 导出 / 封面 / film.package / library | Go：导出与包 op（直调平台能力） |
| `subtitle-generate.js` | 291 | 能力桥调 audio-studio | Go：能力桥直调 |
| `frame-render.js` | 199 | `callUI` 打渲染侧 | Go：`callUI` → Render Host |
| `components.js` | 766 | 组件生命周期 / 子 Agent / 构建 / verify | 平台 MaterialService + Render Host（§7） |

真正需要「移植」的领域逻辑约 2.1K 行（`op-engine` + `model-base`），其余约 3K 行是把平台能力经 `ctx.*` 再包了一遍——在 Go 里就是直接函数调用。

### 4.2 迁移顺序（模块级，绿灯才切）

1. **store**：`project-store` → Go（决定项目数据落点，见 §4.5）。
2. **model + ops**：`model-base` + `op-engine` → Go（含 validate 与 condensed 读）。
3. **script / subtitle**：`script-model` + `subtitles` → Go。
4. **adapters**：`project-operations` / `catalog-export` / `subtitle-generate` / `frame-render` → Go op 注册。
5. **components**：`components.js` → 平台 MaterialService（与 §7 同一批）。

每步保持 `recut.editor.*` 的 op 名、入参、返回结构不变。

### 4.3 迁移方法（决定成败）

- **golden 一致性套件**：`service/editor_agent_test.go` 现在跑的就是「真实 background.js + goja + SQLite + InvokeMCP」全链路。把它固化为**冻结样本**：`op 序列 → 项目状态 → condensed 读 / validate 结果`。Go 实现逐模块对齐这些样本，作为唯一验收基准。
- **模块级双跑 + goja 兜底**：迁移期同一 op 可「读双份比对（一致才过）、写单份（Go 为准）」；未迁移模块仍走 goja。全部对齐后再删 `apps/editor/background` 与 App runtime 依赖。
- **schema 单一真相**：以 **Go 类型为源**，生成 TS 类型给 `timeline-editor`（替换 C6 的「人工保持一致」）。读模型 `CondensedClip` / `ElementRef` 等即此生成物。

### 4.4 边界：什么留在 TS

留在 `timeline-editor` 的只有**渲染与交互**：R3F 场景、关键帧求值（60fps）、拖拽/吸附/选区、乐观投影、预览渲染。

硬纪律：**Go 不做动画求值**（`op-engine` 本来也只落 key）。唯一要小心的是 `model-base.js` 的 `buildDuckEnvelope` 这类「校验与渲染都要用」的共享纯函数——定**一份 spec**，Go 为权威实现（可序列化给渲染端消费），禁止两边各写一份。

### 4.5 必须先定的三件事

1. **项目数据落哪**：现在是 App 私有 SQLite（`ctx.sqlite` + project DSN）。下沉 Go 后应落**平台 project 存储**（`service/project.go` 一线），不要新开平行表；需与后续素材/作品存储方向对齐。
2. **UI 整份 `project.save` 怎么办**：现在 UI 会整份保存项目，与 AI 的 op 日志并存（`data-model.md` 的「锁内 project.save 被拒」即是补丁）。建议改为**走 op**（单一写入口）；至少也要变成「带 version 校验的整份替换 op」。
3. **共享纯函数的单一 spec 归属**（§4.4）——duck 包络、tick 换算、关键帧求值边界。

### 4.6 技能全局化：`recut-editor` → `service/skills/recut-editor`

**背景**：editor 重构（UI 并入 web `timeline-editor`、逻辑下沉 Go）**遗漏了它的技能**——`apps/editor/skills/recut-editor/` 仍是 App 私有技能。editor 转为平台模块后，其技能应与 `recut-worlds`/`recut-director` 同形：**放进 `service/skills/recut-editor/`**，由 `recut_skills.go` 自动发现（无需改 Go 的发现逻辑）。

**迁移动作**：

1. `git mv apps/editor/skills/recut-editor service/skills/recut-editor`；frontmatter 对齐平台技能（`appId: recut.platform`）；references 仍按技能根相对路径——内容语义不改。
2. **宿主技能解析（必做）**：`agentSurface.requiredSkill`（`service/agent.go` 的 `materializeWorkSurfaceContext`）目前解析为 `{AppID: project.AppID, SkillID}` 的 **App 技能**。editor 不再持有该技能后，需让它解析到**全局技能**（如 `{appId:"recut.platform", skillId:"recut-editor"}`，或按 skillId 回退到全局技能目录）。否则工作台不再加载编辑契约。
3. **打包与测试**：`service/builtin_apps_test.go` 断言内置 editor tar 含 `skills/recut-editor/SKILL.md`、`apps/editor/scripts/test-authoring-quality.js` 读 `skills/recut-editor/*` —— 随技能外迁更新（tar 排除 skills；脚本改指 `service/skills/recut-editor`）。
4. **纪律**：全局技能只引用平台 op（`recut.editor.*` / `recut.media.*`），不引 App 私有 op；`service/skills/README.md` 增条目。

**不变式与依赖**：技能语义不变；[`recut-clone`](./2026-09-17-reference-understanding.md) 的 `references/placement.md` 以它作为时间线组装的权威。**本项是 clone 执行的依赖**，与 M0/M1 同批推进。

## 5. 通信契约迁移明细（评审重点二）

### 5.1 不变（契约原文直接沿用）

消息信封、对称原语 `on/call/publish/handle`、统一异步 Handle `async_ops`（shell/media/deferred）与 `recut.job.*`、错误信封、超时/取消、`rpc.reply` 校验与 `completeOp` 收尾、presence 语义（阈值 30s）——全部不动。

### 5.2 变（只换适配层）

| 项 | iframe（现状） | native（迁移后） |
|---|---|---|
| UI transport | iframe + postMessage + project WS channel | web 内原生模块，Op 总线直连 |
| 时间线读写 | UI `project.save` / background op 混用 | UI → Go op（单一写入口）；Agent → MCP → 同一 Go op |
| `callUI` 用途 | 帧渲染/导出/组件 resolve | **仅渲染侧**：目标为 Render Host（可能在同页或 worker） |
| presence 载体 | `editor_frame_sessions` 心跳 | Render Host 挂载信号（同语义，换实现） |

**关键**：`callUI` 只服务渲染；时间线的读写不再经 `callUI`，因此 Agent 与 UI 走**同一条 Go 路径**，headless 不再是死路。

### 5.3 新增：Render Host 契约

| op | 输入 | 输出 |
|---|---|---|
| `host.ready` | — | `{ surfaces, runtimeHash }` |
| `component.resolve` | `{ materialIds[] }` | `{ bundle, bundleHash, surface, inputs }[]` |
| `frame.render` | `{ docVersion, timeSec, size? }` | `{ imageUrl, width, height }` |
| `export.encode` | `{ docVersion, range?, size? }` | `{ filePath/assetId }` |
| `probe.render` | `{ materialId, frame }` | 组件验证证据（render/composite） |

约束：**确定性**（同 doc + 同 t 像素一致）、**单例 runtime**（防双 React）、**无墙钟/随机**。渲染文档按 `docVersion` 由调用方提供或只读拉取，Render Host 不持有项目真相。

## 6. 平台 Runtime Host（C3 的解法）

- 把 `@recut/runtime` 的**共享实例与 import map** 从 `apps/editor/ui` 的 `runtime.ts` 入口提到**平台构建的 host 产物**（一个可被任意宿主加载的模块/chunk）。
- 组件执行契约（沿用 08-14 并显式化）：`surface`（html/react/r3f）、`inputsSchema`（`ParamDefinition[]`）、`getBaseSize`/`getContentBounds`、`render(ctx)`、确定性 `seek(t)`（GSAP paused timeline）、资产解析、沙箱与导入白名单（唯一外部 import `@recut/runtime`）。
- **消费者**：`timeline-editor`、导出 worker、world canvas、remotion-studio、组件验证 harness。editor 从「runtime 所有者」降为「消费者」。
- **Preview == Export**：导出端必须加载**同一个** Render Host（同 `runtimeHash`），否则不得声称一致。

## 7. 素材平台化（标识统一，不含属性协议）

### 7.1 模型

```
Material {
  id, backing: "bytes" | "code",
  // bytes: media_assets 既有字段（contentHash/mime/dimensions/duration/status…）
  // code:  source, bundle, bundleHash, deps(pinned), version, surface, inputsSchema
  name, createdAt, updatedAt, archivedAt
}
MaterialRef = { backing:"media", assetId } | { backing:"component", componentId, versionId }
```

- `bytes` backing 即现有 `media_assets`，生命周期与门禁不变。
- `code` backing 是组件素材平台化：源码入库、版本与 `bundleHash` 固定（去 C1/C2）。
- 时间线元素继续用现有 `assetId` / `componentId` 引用，不引入新引用字段。

### 7.2 本 RFC 不做的

`attrs` / `content` / `recipe` 不在本 RFC，由「素材 attrs 协议层」RFC 定义。本 RFC 只保证：标识稳定、backing 可判别、引用不改。

### 7.3 与 App 契约的对齐

editor 不再是 App、组件升为平台素材，需要一次显式修订：

- 在 App 契约中登记**平台内置模块**（editor + timeline 域）与**平台素材类别**（媒体 + 组件）；
- App 契约的「App 数据属于 App」仍适用于其余安装型 App；editor 退出该条款；
- 组件的作者/归属保留 `origin.appId`，便于溯源与权限。

## 8. 迁移与兼容

| 阶段 | 动作 | 回退 |
|---|---|---|
| P0 UI 落位 | `timeline-editor` 模块进 web，UI 仍走旧 op（经桥）；只换宿主 | 保留 iframe 挂载 |
| P1 逻辑双跑 | Go 实现 timeline 域，与 goja 读双份比对、写 Go 为准；逐模块切 | 该模块切回 goja |
| P2 组件/素材 | 组件写平台 Material；Render Host 接管渲染 | 关闭平台读/切回 iframe 渲染 |
| P3 收口 | 删 `apps/editor/background`、goja 路径、iframe 桥；归档 `editor_components` | 保留只读归档 1 个版本周期 |

数据迁移：项目文档 → 平台 project 存储；`editor_components` → 平台 `code` material（保留 componentId，避免引用重指）。

## 9. 里程碑

| 里程碑 | 目标 | 交付 | 验收 |
|---|---|---|---|
| **M0 UI 并入 web** | 去 iframe | `timeline-editor` 模块 + 原生渲染挂载 + comms 直连；presence 换实现 | 无 iframe 完整编辑→预览链路通过；回退开关可用 |
| **M1 timeline 域下沉 Go** | 逻辑权威入 Go | timeline store/model/ops + script/subtitle → Go；op 名不变 | golden 一致性套件全绿；双跑无差异；goja 可关 |
| **M2 素材平台化** | 组件归平台 | 平台 `code` material + 平台构建工具链；`editor_components` 迁移 | 新组件写平台；`component.*` 结果不变；`bundleHash` 可校验 |
| **M3 Render Host** | 渲染脱离 editor UI | 平台 host 产物（单例 runtime + import map + §5.3 op 面） | 同 doc 同 t 像素一致；导出端加载同一 host |
| **M2.5 技能全局化** | 技能随 editor 一起平台化 | `recut-editor` → `service/skills/recut-editor`；surface `requiredSkill` 解析到全局技能；打包/测试同步 | `recut.skills.list` 发现 `recut-editor`；工作台仍加载编辑契约；技能内容零语义变化 |
| **M4 收口** | 删旧路径 | 删 background/goja/iframe 桥；App 契约修订 | 无残留旧依赖；`editor_agent_test` 迁为 Go 套件且全绿 |

依赖：M0 与 M1 可并行；M2 依赖 M1 的 store 落点；**M2.5 与 M0/M2 同批（clone 的依赖）**；M3 可与 M1/M2 并行；M4 最后。

## 10. 风险与未决问题

1. **移植漂移**：trim/split 的 tick 取整、duck 包络、script 按字符比例切源等细节易错。缓解：golden 套件 + 模块级双跑（§4.3）。**必须先建套件再动 Go。**
2. **项目数据落点未定**：App 私有 SQLite → 平台 project 存储的 schema 与迁移路径需与素材/作品方向对齐（§4.5.1）。
3. **UI 整份 `project.save`**：保留整份替换还是改走 op，影响单一写入口能否成立（§4.5.2）。
4. **共享纯函数单一 spec**：duck / tick / 关键帧求值边界若两边各写一份，Preview==Export 会出现隐蔽不一致（§4.4）。
5. **安全边界变化**：iframe 跨域隔离消失，需 in-process 隔离（worker / isolated realm）+ 导入白名单 + 构建签名。**未决：沙箱技术选型。**
6. **双 React 实例**：单 React 树天然规避；但 Render Host 若在 worker/独立产物，仍需 import map 指向同一实例。**未决：导出端执行位置。**
7. **editor 退出 App 契约的连锁**：文档、权限模型、`builtin_apps`/`apps/editor.tar.gz` 的打包与发布流程都要同步调整。
8. **社区扩展性**：editor 不再是安装型 App，社区无法像其他 App 那样 fork；这是有意取舍，需在文档中说明。

## 11. 非目标

- 不在本 RFC：素材 attrs/content/recipe 协议、视频理解工具、clone skill（各自独立 RFC，按序推进）。
- 不做组件市场 / 分发 / 版本发布体系。
- 不改时间线 op 语义与读模型字段（迁移必须对外等价）。
- 不改 WS/HTTP/MCP 协议与 Op 总线契约版本。
- 不做跨机 / 云端渲染农场。

## 12. 后续 RFC 排期（本 RFC 之后）

1. **视频理解**：全局 `recut.media.*` 理解工具 + 全局 skill `recut-reference`（可解耦、可单测）。
2. **素材 attrs 协议层**：在 Material 之上定义有序 attrs + content + 确定性 recipe；计划态与物化。
3. **clone skill**：全局 `recut-clone`（薄适配；决策指向 `recut-director/references/remix`，组装指向全局化的 `recut-editor`）。
