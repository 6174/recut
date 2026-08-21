<!--
 * [INPUT]: 依赖 2026-08-21「制作 Qwen3.8-27B 本地安装介绍短片」的 agent-session-debug 快照（session
 *          c8678127180987d03b432cb7，project b914362e869b0b64e15764f4），以及
 *          apps/audio-studio（background.js / manifest.json / skills/audio-studio/SKILL.md）、
 *          apps/editor（background/model-base.js / op-engine.js / project-operations.js / assets.js /
 *          skills/recut-editor/SKILL.md 与 references/voiceover.md、directing.md）、
 *          apps/editor/ui/src（media/audio.ts、core/managers/audio-manager.ts、core/managers/media-manager.ts）、
 *          service（agent_jobs.go / mcp.go / media/jobs.go、config.go、types.go、assets.go）、
 *          web/lib/media-configuration-store.ts、rfc/2026-08-16-editor-component-asset-workflow.md、
 *          rfc/2026-08-18-editor-component-create-trace-issues.md、rfc/2026-08-19-platform-communication-op-bus.md
 *          的代码现状。
 * [OUTPUT]: 细化这四个问题的**落地方案**：区分「可直接实现的代码修复」与「需要架构设计的改动」；对后者给出
 *           明确的数据结构、op 契约、组件边界与迁移路径，供下一步单独出实施 RFC。
 * [POS]: rfc 的「AI 解说音频素材生命周期」设计细化稿；在 2026-08-21 梳理稿基础上的深化，不修改任何代码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
-->

# RFC：AI 解说音频素材生命周期——落地方案细化（含架构设计）

- 状态：**部分实施（2026-08-21）**——问题 1（服务端 `recut.job.wait`/`recut.media.wait_for_job` 单次阻塞封顶 15s + 文档/runbook 对齐）、问题 2（`timeline.placeAudio` + `audio-unresolvable` 校验 + 项目 attach 与 `project.assets.changed` 前端实时同步）、问题 3（voice-led 默认 + Visual-first sync map 硬前置 + 新增 `voice-assets.md` 声音资产总览，含 ASR/TTS 就绪门与本地环境缺失引导）、问题 4（`local-audio` 本机 TTS provider：catalog/无凭据路由/readiness/默认音与非缺失、`recut.speech.generate` 本地执行桥 `wireLocalSpeechBridge` + daemon 注入、云端/本地选择与 skill 引导）已落地并有 API 级端到端测试覆盖（`TestLocalAudioRouteConfiguredReadinessAndDefaultVoice` 等）。Settings 面板 UI（选择/默认本地 TTS 的具体控件）不在本仓库 web 内，配置/路由/就绪面已由后端与 skill 承接。
- 作者：Recut
- 日期：2026-08-21
- 决策范围：同上篇；本稿侧重「怎么改」，把改动分为 **A 类代码修复**（现状内可做）与 **B 类架构设计**（动数据/契约/组件边界，需单独评审）
- 关联：同上篇 + [Canonical Assets / OPFS 缓存](./2026-08-16-canonical-assets-opfs-cache.md)、[编辑器 Component 素材工作流](./2026-08-16-editor-component-asset-workflow.md)

## 0. 结论摘要

四个问题按「是否需要架构设计」分两类：

| 问题 | 类别 | 关键改动（一句话） |
|---|---|---|
| 1. `recut.job.wait` EOF | **A 类**（代码/契约/纪律） | 对齐契约文案 + 等待方事件化/短轮询 + 传输层改事件推送 |
| 2. AI 落轨配音不能播放 | **B 类**（架构：音频 asset 一等公民） | 新增「项目级音频 asset reference + 统一落轨 op + 可播放性校验」，并改造编辑器 media 供给面 |
| 3. AI 未主动规划解说/B-roll | **A 类**（skill/route 引导） | route 表加说明性输入→voice-led 默认 + Visual-first sync map 硬产出 |
| 4. 设置缺本地 TTS provider | **B 类**（架构：本地 provider 入路由） | Route/凭据模型允许「无凭据本地 provider」，本地 TTS 接入 `speech.default` + 回退 |

**尽量不动的现状**：`timeline.command` 仍是唯一写入口；`editor_assets` 表与 `audit log` 沿用；时间线元素仍以 `mediaId`/`sourceType` 承载来源——只是这些来源的**生产入口**收敛到一处，AI 不再手工拼字段。

---

## 1. 复现轨迹（时间线，来自 session 快照）

（同梳理稿 §1，简要重列关键点）

```
09:47  new-authoring → ollama 风格 5-beat 排版驱动；未规划解说/B-roll
09:53  5 组件落轨 + 目录 BGM（library+sourceUrl）；开始导出
09:58  recut.speech.generate → MiniMax 配额(2056) 全 failed → 转铺字幕，配音阻塞
10:02  改用 audio.synthesize（shell job）；单活跃任务，逐条合成
10:03  多条 recut.job.wait(timeout=120) → Post …/v1/mcp: EOF（靠 status 轮询自救）
10:08  audio.save 导入全局素材库（upload）；Narration 轨 insert（library + sourceUrl:null）
10:09  validate 零违规；用户发现无声 → 手动从全局素材库重拖 → 可播放
10:26  结尾只有音频无画面 → 延伸 CTA 组件到 41.32s
```

---

## 2. 问题 1（A 类）：`recut.job.wait` 传输 EOF

### 2.1 现状证据
- 传输：`mcp.go` 由常驻 Daemon 的 `/v1/mcp` 以 **Streamable HTTP** 监听；采用 opencode/OpenCode 这类第三方宿主时，Agent 经 host 的 MCP stdio/HTTP 适配器连接。
- 窗口：`service/agent_jobs.go:221-224` 明确「阻塞 HTTP 长轮询与 Streamable HTTP 传输不兼容」，单次 `waitAgentJob` 阻塞上限 `agentJobWaitWindow = 15s`。
- 描述：`mcp.go:94`（`recut.job.wait`）文案承诺「最长 300 秒；超时返回当前状态」，与 15s 实际窗口不一致，促使 Agent 传 `timeoutSeconds:120/300`。
- 表现：本会话每次 wait 传 120s → 服务端实际只阻塞 15s 就返回；但 Agent 把「返回」误当「还在跑」，立刻再 wait，形成 15s×N 的**连发长阻塞**。任务本身 30s+（模型加载+合成+ASR 回读），期间连接在收尾/空闲期被网络层/代理断开 → EOF。

### 2.2 细分修复

#### 2.2.1 契约对齐（立即，低风险）
- `mcp.go` `recut.job.wait` 描述改为：单次阻塞 ≤ **15s**（Streamable HTTP 兼容，防止连接被断开）；任务可能很快，也可能数十秒；**进入长任务请优先用事件订阅，或按 `recut.job.status` 短轮询**。删除「最长 300s」的误导。
- 同时 `recut.media.wait_for_job`（媒体专用）描述与实现统一到同一窗口语义（`jobs.go:WaitForTerminalJob` 目前可能差异，需对齐），避免两套等待语义让模型困惑。

#### 2.2.2 等待方健壮性（skill/runbook 纪律）
- 在 `recut-editor/references/errors.md` 增加一条硬规则（runbook 条目）：
  > `recut.job.wait` 一旦 `MCP error … EOF` / 传输异常 → **不要在同一 jobId 上无限连发 wait**；立即降级为 `recut.job.status` 短轮询（间隔 2–4s，最多目 10 次），或改用事件订阅。
- 在多段生成（如 5 条配音）时，skill 指示「**一次只维护一个活跃观察**：提交下一条前，上一条必须已到终态」；推荐模式是 `status` 轮询驱动，而不是逐条 `wait` 一次到位。

#### 2.2.3 长期：事件订阅替代轮询（架构层次，B 类但可后置）
- 参照 `2026-08-19-platform-communication-op-bus.md`：让 Agent 能「订阅 job 终态」而非轮询。新增 MCP 能力（如 `recut.job.subscribe(jobId)` 返回一个可 SELECT 一次/持续取的句柄 + 服务端事件账本回放），或复用在 `recut.job.*` 命名空间下的统一 async handle 观察。
- 好处：既根治 EOF（无长阻塞连接），也让「多段生成按事件驱动顺序推进」成为平台语义，而非模型运气。
- **架构要点**：这是平台通讯层改动，涉 Streamable HTTP 的 SSE/事件下发与会话身份绑定，需与通用 Agent 传输一起评审，**不与 #2/#4 绑死**。

---

## 3. 问题 2（B 类 · 核心架构设计）：音频 asset 一等公民化

### 3.1 问题再定位（为何现有「修字段」不足）

回放解析（`apps/editor/ui/src/media/audio.ts`）把所有 `sourceType !== "upload"` 的 audio 元素一律当 **library** 处理 → `fetch(element.sourceUrl)`：

```
collectAudioClips   :601-620  if sourceType==="upload" → mediaMap[mediaId].file
                               else（=library）→ fetch(sourceUrl)
collectAudioMixSources:536-547 同上
```

也就是说，browser 端判定「可播放」只看两个正交域：**upload（本地媒体资产）** 与 **library（目录/外部 URL）**。而 **「生成/导入的解说音频」本质是「已存在于平台媒体库的 upload 资产」**，应落 `sourceType:"upload"`+`mediaId`。AI 却只用 `sourceType:"library"`+`sourceUrl:null` 表达。

「修字段」只能靠提示词让模型永远猜对，不可靠。**正确方向 = 让 AI 不再需要猜**：把「项目音频素材」建成与组件对等的、可在时间线引用的**一等资产**，落轨由统一 op 完成，source 三件套由代码推导。

### 3.2 目标数据模型

沿用 `editor_assets` 表（不新建表），把目前只接纳 `component` 的 `projectAssetId(type, refId)` 扩展到 `type="audio"`：

```
editor_assets( asset_id  "audio:<refId>"  |  project_id  |  type="audio"  |  ref_id  |  status  )
```

`ref_id` 指向**平台媒体 assetId**（如 `57ab328c…`，即 `audio.save` 产物）。这里选择「复用平台媒体 assetId 作为 audio 资产引用目标」，而非像组件那样 `audio:<random>` 自造内容——因为音频字节由平台媒体库持有（`media_library` + 文件沙箱），编辑器回放本就要走 `mediaAsset.file`；项目资产只承担「项目作用域的引用投影 + 可放置校验」。

云图：

```
audio.synthesize ──ASR 验收──▶ audio.save ──▶ 平台媒体 asset(57ab…)  （全局，字节唯真）
                                                  │
        timeline.placeAudio(projectId, [{ assetId:"audio:…", startSec, durationSec, trackId? }])
                                                  │
            ┌─────────────────────────────────────┘
            ▼
   editor_assets 登记 audio:<refId>（项目作用域投影，指向媒体 assetId）
            ▼
   op-engine buildElement: type="audio" + sourceType="upload" + mediaId=媒体assetId
```

### 3.3 落地改动清单（分层）

#### 3.3.1 `editor_assets` 与校验（backend，B 类）
- `assets.js`：
  - `backfillComponentAssets` 泛化为 `backfillProjectAssets`，同时回填 `audio` 类型（从平台媒体 asset 表按 `project_ids` 或调用方登记）。
  - `listProjectAssets` 增加 `type==="audio"` 分支：返回 `mediaAssetId`（媒体引用）、`name`、`duration`（供放置）。
- `project-operations.js`：
  - 新增 `timeline.placeAudio`：入参 `{ items:[{ assetId, startSec, durationSec, trackId?, name? }], baseVersion }`，内部 `resolveAudioAsset` 把项目 `audio:<refId>` 解析为平台媒体 assetId，再走 `component-placement` 同款的原子批量放置（复用 `findOrCreateAvailableTrack(scene,"audio",…)` 避碰），一次 command log/version，杜绝逐条 insert。
  - 扩展 `timeline.assets`：允许登记 `audio:<refId>`；`normalizeAudioAssetOp` 在 `insert type:"audio"` 时若带 `assetId="audio:…"`，自动把 `element.mediaId` 填成媒体 assetId、`element.sourceType="upload"`——AI 落音频只需给 `assetId`，不碰三件套。
- `op-engine.js / validateTimeline`：
  - 新增 audio 可解析性校验：
    - `sourceType==="library"` → 必须 `sourceUrl` 非空；
    - `sourceType==="upload"` → 必须 `mediaId` 存在且在 `registeredAssets` 或项目 audio asset 投影内；
    - 两者皆空/非法组合 → violation `audio-unresolvable`，**让「可播放」进入结构 proof**。

#### 3.3.2 编辑器媒体供给面（ui，B 类·关键且最易被忽略）
- 现状：`collectAudioClips({ tracks, mediaAssets })` 的 `mediaAssets` 来自 `editor.media.getAssets()`，是**全局媒体库**（`media-manager.ts`）。若音频只是「项目投影」而未进全局媒体库，回放找不到 `File`。
- 因此**项目 audio asset 必须同时保证其在编辑器的 media store 里可被 `mediaId` 取到**：
  - 方案甲（推荐）：`timeline.placeAudio` / `timeline.assets` 登记后，由 backend 保证这些 `audio:<refId>` 引用的媒体 asset 已纳入该编辑器的媒体供给面（`media-manager` 拉取含该项目的媒体 asset，`project_ids` 匹配）。
  - 方案乙：把「项目音频字节」写入项目文件区，`mediaId` 解析落到项目级 File（涉及 $Canonical Assets / OPFS 缓存 的「项目私有资源」扩展）——工作量大，**仅当需要「项目私有、不进全局库」的音频时才需要**，本用例（已入全局库）不必。
- **建议**：本 RFC 先按方案甲（音频仍放全局媒体库，项目仅做引用投影），把「项目私有音频」留作后续独立 RFC。这样改动最小且能复现成功路径（用户手动拖入即为「媒体 asset + upload + mediaId」）。

#### 3.3.3 兼容与迁移（backend）
- 存量 `editor_assets` 里历史无效音频元素（AI 已落轨的 library+null）：
  - 提供 `asset.archive` 之外的一个**一次性迁移/修复 op**（或 `timeline.validate` 返回 `audio-unresolvable` 后，引导 `asset.repair-audio(assetId)` 把 library 元素改写成 upload+mediaId）。最小闭环：校验标记 → AI 按其提示自愈。
- 目录 BGM 保持 `library+sourceUrl` 不变（`library.browse` 路径）；只有「媒体素材音频」走新的 project audio asset。**两条语义在 skill 里显式区隔**。

### 3.4 交互/体验
- `timeline.placeAudio` 成功后可在 `asset.list`（`type:"audio"`）看到项目音频资产，与组件同区；编辑器素材库「音频」区展示同样的可播放条目，保证「AI 放的和用户拖的是同一件事」。
- 校验把「可播放」纳入 proof 后，`timeline.validate` 不再出现「零违规却无声」。

### 3.5 验收标准（#2）
- [ ] AI 只需 `assetId + start/duration` 即可把已保存的解说音频落轨，落成 `sourceType:"upload"`+`mediaId`，时间线播放有声。
- [ ] `timeline.validate` 对 library+null / upload 无 mediaId 的组合报 `audio-unresolvable`。
- [ ] 目录 BGM（library+sourceUrl）不受影响，仍可播放。
- [ ] `asset.list` type="audio" 显示项目音频资产，可回放。

---

## 4. 问题 3（A 类）：voice-led 路由默认化 + Visual-first sync map 硬产出

### 4.1 改动
- **route 表加一行**（`recut-editor/SKILL.md`）：
  > 输入是「介绍/讲解/价值/意义/为什么/是什么/教程」等**说明性 output 诉求** → 即使无口播/视频，也默认 **`voice-led`**：先写解说脚本并拆成 scene，再生产画面（B-roll/MG/生成媒体），BGM 仅作可选点缀。
- **voice-led 硬产出**（`references/voiceover.md`）：把「Visual-first sync map」从「建议」升为「每段解说的强制前置」：
  - 每条解说必须登记 `visual range + visual anchor`；**无画面锚点的解说不得单独落轨**。
  - 新增 B-roll 验收标准：一个解说 scene 若没有可见主体（B-roll/数据图/终端画面/MG 主体），视为 coverage gap；结尾的「纯音频空画面」即此类，须补视觉。
- **`new-authoring` 默认行为**：叙述型输入，先产出「解说脚本→scene 拆解→画面锚点」三件套，再谈动效/音乐。

### 4.2 归属
纯 skill/提示词与 route 判定，无数据模型改动；可独立先行。注意与 `2026-08-19-editor-ai-video-authoring-quality.md` 已有的「route + treatment 编排」保持一致，避免两套语义冲突——建议把这条说明性映射加进该 RFC 的 route 判定表而不是另造一套。

---

## 5. 问题 4（B 类 · 架构设计）：本地 TTS 纳入语音 Route

### 5.1 现状约束（为什么要动架构）
`resolveRoute`（`jobs.go:222-266`）对每条 route **必取 credential**（`route.CredentialID` → `m.credential`；且 `model.Provider == credential.Provider` 检查）；`execute` 的 speech 分派（`jobs.go:309`）硬性要求 `credential.Provider ∈ {minimax, elevenlabs}`。因此「本地无 API Key 的 CosyVoice」在现有 `MediaRoute`/`MediaCredential`/`MediaProvider` 模型里**无法表达**。

`MediaRoute`（`types.go:66-73`）的 `CredentialID string` 非空假定 + `resolveRoute` 的 credential 必得，是 #4 的核心架构障碍。

### 5.2 目标模型（最小侵入）

引入「本地 provider」概念，让 route 可以**无凭据**：

```
MediaRoute:
    CredentialID string   // 允许为空（本地/无凭据 provider）
MediaProvider(new 约定):
    ID="local-audio"  Protocol="local"  DefaultAPIBase=""   Models=[ {id:"local-audio/cosyvoice2", capability:"speech.generate", …} ]
```

分派改造：
- `execute` 在 `credential.Provider == ""`（或无 cred）时，进入**本地执行器**分支：接收 `MediaJob{ModelID:"local-audio/cosyvoice2", Output:{voiceId,…}, Prompt:text}`，转调 Audio Studio 的本地引擎（见 5.3 桥接），产出字节 → `saveGeneratedAsset`（与云端同路径）。
- `resolveRoute`：允许 `route.CredentialID == ""` 且 model.Provider 是本地 provider 时「无需凭据」通过。
- `MediaRoute` 相关 API/UI（`media-configuration-store.ts` `MediaRoute` 类型 + Settings）允许 credentialId 为空选项。

### 5.3 Audio Studio 桥接（关键架构决策）

本地 TTS 的执行主体是 audio-studio 的 `audio.synthesize`（CosyVoice2，含 ASR 回读验收），它目前是**独立 App 的 shell job 与私有产物**。接入平台 Route 有两种桥接方案：

- **方案 ①（推荐，演进）**：平台不直接内嵌 CosyVoice，而是定义「平台→Audio Studio」的执行契约：平台把 `MediaJob`（text/style/voiceId）作为一次「本地语声任务」派发给已安装的 audio-studio（经其已暴露的 MCP/`audio.synthesize` 或新增一个面向平台的异步 op，如 `audio.platform_synthesize`，复用同一 ShellJobManager 与验收）；audio-studio 完成验收后把 WAV `importFile` 成平台 media asset（`saveGeneratedAsset` 得到真实 assetId），平台把该 assetId 作为 job 产物返回。**Audio Studio 的「先验收再暴露」仍是硬门，平台复用其品质保证**。
  - 好处：CosyVoice/ASR 资产模型不变，只新增「平台↔audio-studio」的桥接 op；audio-studio 的 skill 从「供用户/AI 直接调用」扩展为「也作为平台语音路由的后端」。
  - 代价：需要把 audio-studio 的鉴权/归属与平台 `media_jobs` 生命周期打通（job 由平台创建，audio-studio 执行后回写）。
- **方案 ②（彻底）**：把 CosyVoice 执行提升为平台「本地 provider」直接拥有，audio-studio 降为纯 UI。侵入大、与现有 App 边界冲突，**不建议本 RFC 采用**。

**建议本 RFC 选方案①**，并在 audio-studio manifest 增加一个 `surfaces:["mcp"]`（或平台内部）的 op 承接平台派发，同时保持现有 `audio.synthesize/save` 不动。

### 5.4 回退策略
- `resolveRoute` 增加 fallback：当配置的 `speech.default` 是云端且不可用（`readiness.speech != ready` / job 提交即失败 / 配额错误 2056），允许平台级回退到本地 `speech.local` route（若已安装就绪）。
- `recut.context.media.readiness.speech` 同时反映「云端正 / 本地方就绪」，多个候选中给「可用且默认」的次序；AI 按 readiness 选择，而不是自己绕道。

### 5.5 验收标准（#4）
- [ ] Settings 的「语音用途模型」可看到并可默认「Audio Studio（本机 CosyVoice2）」；其 route `credentialId` 可为空。
- [ ] `recut.speech.generate` 在默认=本地时，走 audio-studio 桥接并落平台 media asset；`list_voices` 对本地 route 返回默认音 + 已验收角色。
- [ ] 云端回退本地在配额/未配置时自动生效，AI 无需绕道。

---

## 6. 实施顺序与依赖

```
P0（低风险，可先行，互不依赖）
  ├─ #1-A  契约文案对齐 + errors.md runbook（代码+skill）
  └─ #3    route 表 voice-led 默认 + Visual-first sync map（skill）

P1（核心，依赖 P0 的 skill 纪律）
  └─ #2    项目级 audio asset + placeAudio + validate 可播放性
            ├─ backend：editor_assets 扩 audio 类型 + placeAudio + normalizeAudioAssetOp + validate
            └─ ui：media store 供给面（方案甲：确保媒体 asset 在该项目可取到）

P2（平台能力，工作量最大）
  └─ #4    本地 TTS provider 入路由
            ├─ 平台：MediaRoute.CredentialID 允许空 + execute 本地分支 + fallback
            └─ audio-studio：新增平台桥接 op（platform_synthesize）
            └─ Settings UI：本地 provider 条目 + 空凭据 route + 默认项
```

依赖理由：
- #3 让 AI 先在 design 阶段就规划解说 → 触发 #2 的「项目音频 asset + placeAudio」被正确使用；所以 #2 的 skill（voiceover/落轨）依赖 #3 的默认 voice-led。
- #4 的 Audio Studio 桥接复用 #2 的「平台媒体 asset 落轨」链路（本地 TTS 产物也是 `audio.save` → media asset → placeAudio 落轨），故 #4 建议在 #2 之后。
- #1-B（事件订阅）是平台通讯层，可独立于 #2/#4，建议作为通用 async-handle 演进单独评审。

---

## 7. 待确认 / 争议点

1. **音频项目 asset 的引用对象**：`audio:<refId>` 指向平台媒体 assetId（方案甲，字节在全局库）vs 项目私有文件（方案乙，涉及 canonical-assets 扩展）。**建议甲**，乙留作后续。
2. **`timeline.placeAudio` 与 `timeline.placeComponents` 是否合并成一个 `timeline.placeAssets`**：横向统一更干净，但会动 `placeComponents` 既有契约与 skill 文案；本 RFC 倾向**先独立 `placeAudio`**，统一留作 v2。
3. **「可播放性」校验的强度**：`validateTimeline` 是纯结构校验（不查远端可达性）。对 `library+sourceUrl` 无法在无网/离线时判存活性，因此只能做「字段完备 + 媒体存在性」，不能查 URL 是否真可达；这一边界要在校验描述里写清，避免「仍可能无声但通过校验」的错觉。
4. **本地 TTS 归属**：选方案①（audio-studio 仍拥有引擎），平台只做路由/派发桥接。需确认 audio-studio 的 skill 是否允许「由平台 job 调其 `audio.synthesize` 并以平台 asset 回写」这一新用法边界（当前 `audio.save` 规则是「用户明确点击才允许」，平台派发应视为该 App 向平台 service 暴露的等价授权，需在 skill 写明）。
5. **`recut.job.wait` 的事件订阅**（#1-B）是否会改变 `recut.job.*` 的既有 JSON 契约与 OpenCode 等宿主对工具结果的解析——需在平台通讯层 RFC 一并评审，不因 #1-A 的短期修复而阻塞。

---

## 8. 一句话落地建议

把 #2（项目级音频 asset + `placeAudio` + 可播放性校验）当作与组件对等的一等公民能力来做，配套 #3 让 AI 默认先规划解说、#1-A 让生成过程不卡传输、#4 让本地 TTS 成为可默认的语音路由；四者合起来，把「AI 生成解说并落到可播放时间线」从「运气+手工接线」变为「平台语义」。

---

本 RFC 为方案细化稿，未修改任何代码；各项是否实施、实施顺序据此另行决策。
