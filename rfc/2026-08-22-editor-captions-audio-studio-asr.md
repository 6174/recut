<!--
 * [INPUT]: 依赖 apps/editor（manifest.json / background/subtitles.js / background/project-operations.js /
 *          background/script-model.js / ui/src/subtitles/from-recut.ts /
 *          ui/src/services/transcription/service.ts / ui/src/transcription/* / ui/src/recut/sdk.ts）、
 *          apps/audio-studio（manifest.json / background.js，audio.transcribe / audio.transcripts /
 *          audio.transcript / audio.save / audio.status + ensureNoActiveJob 单作业约束）、
 *          service（runtime.go 的 AppHost.InvokeMCP / invoke / ctx.platform.integrations 能力快照、
 *          requireApp 的 projectOwnedBy scope 规则、ctx.platform 与异步 async_ops/recut.job.*、
 *          shell_jobs.go 的 job 生命周期、mcp.go 的 recutIntegrationContext 与 __recutError 业务错误信封）、
 *          rfc/2026-08-16-canonical-assets-opfs-cache.md、rfc/2026-08-19-platform-communication-op-bus.md、
 *          rfc/2026-08-21-ai-narration-audio-asset-lifecycle.md 的代码与设计现状。
 * [OUTPUT]: 编辑器字幕「生成字幕」真实落地，且以**通用能力桥**（capability bridge）为地基：平台不内置业务能力，
 *           只提供能力发现/通用跨 App 调用/统一异步/授权传递，并给出完整的健壮性与容错契约（超时/重试/幂等/
 *           取消/级联/越权/单作业背压/孤儿回收/审计/部分失败）；转写是 audio-studio 的一个能力调用
 *           （audio.transcribe + saveToLibrary，一次调用完成），产物默认入库全局 assets、项目只持引用。
 * [POS]: rfc 的「跨 App 能力复用 + 通用层容错」设计稿；获批后约束 service runtime、apps/editor、apps/audio-studio。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

# RFC：编辑器字幕「生成」对接 audio-studio ASR——通用能力桥（含容错契约）与项目引用模型

- 状态：**实施完成（2026-08-22）**——P0/P1 全部落地：service `ctx.capabilities.invoke/inspect`（通用能力桥，复用 AppHost.invoke，含统一错误信封/同步超时/panic 兜底/审计/**HMAC 授权签名注入** `_authorization` + `ctx.platform.verifyCapabilityGrant` 供提供方校验）；audio-studio `audio.transcribe(saveToLibrary)` + capability 标记 + 懒终态入库/幂等去重，失败结算透出日志尾部真实原因，Qwen 时间戳对齐失败自动回退 Whisper，`audio.cancel`/`audio.synthesize`/`audio.save` 均标 capability；editor `subtitle.capabilities/generate/status/commit/cancel/retry-save` 一组 op（打点：模型只列已装、整轨/局部区间混音、无声守卫、取消与轮询错误不吞、**部分成功 repair**）＋字幕轨 `captionSource` 引用、未安装统一安装引导；`local_speech_bridge` 收敛为通用能力桥表达（synthesize/save 经 capability 判定、save 走带签名授权的能力调用）。**E2E**：`make transcribe-e2e`（`service/transcribe_e2e_test.go`，`RECUT_E2E_TRANSCRIBE=1`）不经 UI 直连 editor→能力桥→audio.transcribe→轮询完成，实测 qwen 转写通过（顺带定位并修复“一直 running”：audio.transcript 完成响应缺 status）。web tsc 零错、service go test 全绿、editor vite build 通过。P2 仅余 `transcribe_e2e` 之外的整轨混音已含；无需额外工作。
- 作者：Recut
- 日期：2026-08-22
- 决策范围：编辑器字幕 Tab「生成字幕」真实落地；**能力分层**（平台只做通用桥，不内置业务）；**通用层健壮性/容错契约**（超时、重试、幂等、取消、级联失败、scope 越权、单作业背压、孤儿作业回收、审计、部分成功修复）；一次跨 App 能力调用完成转写+入库；产物默认入库全局 assets、项目只持引用；既有业务执行桥（`wireLocalSpeechBridge`）的收敛方向。
- 关联：`rfc/2026-08-16-canonical-assets-opfs-cache.md`（Assets 唯一真相源 + part URL + 项目绑定 + 墓碑）、`rfc/2026-08-19-platform-communication-op-bus.md`（统一 Op 总线、async_ops 统一异步 Handle）、`rfc/2026-08-19-editor-component-create-resilience-and-compositing.md`（统一错误信封、超时/取消教训）、`rfc/2026-08-15-editor-chatcut-adoptions.md`（speech-track / script.* / 字幕轨模型）、`rfc/2026-08-21-ai-narration-audio-asset-lifecycle.md`（audio 一等公民 + 本地 TTS 桥演进基线）

## 1. 摘要

编辑器左侧素材导航的「字幕」Tab（captions）目前「生成字幕」是**本地 stub**：`apps/editor/ui/src/services/transcription/service.ts:34` 的 `transcribe()` 直接 `throw new Error("transcription.notSupported")`，从未真正落地。

本 RFC 把链路建立在**通用能力桥**上：平台不做具体业务能力，只做四件通用事情——能力发现、通用跨 App 调用、统一异步 Handle、授权/审计传递；audio-studio 的 ASR 作为可复用能力，编辑器作为消费方**一次调用**即完成「转写 + 入库」：

```text
aria 分层
  提供方 audio-studio：audio.transcribe(saveToLibrary) —— 业务（模型/语言/入库规则）只在这层
  平台 service：       ctx.capabilities.invoke / inspect + async_ops + 授权/审计 —— 只做通用桥
  消费方 editor：      subtitle.generate → 一次 invoke → job → status → commit —— 只做场景编排
```

落点两条资产规则：

1. **转写产物默认是全局 assets 库的 `transcript` 素材**（`ImportTranscript` bundle：audio + srt + json parts；`recut.assets.partURL(assetId, part:"srt"|"json")` 可读），由 audio-studio 的入库语义产出，非项目私有文件。
2. **项目只保存对它的引用**：字幕轨记录 `captionSource.{assetId,…}`，cue 由引用资产派生；同一 assetId 经 `script.attach` 挂到说话元素（若有），字幕与可编辑文稿同源。

平台侧为跨 App 能力复用做一次性通用投入（暴露已有 `AppHost.invoke`/`InvokeMCP` 到 App ctx，补齐容错契约）；**不新增任何转写专属代码**。`wireLocalSpeechBridge` 这类「为单业务手写的平台执行桥」是本 RFC 要收敛的反模式。

## 2. 现状与病灶

### 2.1 编辑器字幕 Tab 现状

| 入口 | 实现 | 状态 |
|---|---|---|
| Import file（.srt/.ass） | `parseSubtitleFile` → `insertCaptionChunksAsTextTrack` | ✅ |
| From Recut assets | `recut.media.pick(kinds:["transcript"])` → `recut.assets.partURL` srt/json → 解析 → 插轨 | ✅ |
| 生成字幕 | `extractTimelineAudio` → `decodeAudioToFloat32` → `transcriptionService.transcribe` | ❌ stub 抛错 |

### 2.2 病灶

病灶一：**「生成字幕」是死代码**。前端保留本地 ONNX-whisper 模型表（`transcription/models.ts`）、`TRANSCRIPTION_LANGUAGES`、`buildCaptionChunks`，只有后者在「From Recut assets」的 JSON 回退里用到；`transcribe()` 直接抛 notSupported，跨 App 无通道。

病灶二（架构）：**把业务能力揉进平台层**。直觉做法是镜像既有 `wireLocalSpeechBridge`，在 service 里再造 `wireLocalTranscriptionBridge` / `local-asr` 媒体路由。要拒绝：平台媒体层每为一种业务（TTS、ASR、图像…）手写执行器，就长成「平台变 App 大全」的上帝服务，每个新能力动平台、被平台 review、跟平台生命周期耦合。平台的价值不是"会做转写"，而是**让能力互相发现与调用，并在调用层做可靠**。

病灶三：**缺通用信任 + 通用容错**。就算把 `InvokeMCP` 暴露给 App 层，直接跨 App 裸调用也远达不到可用：无能力发现、无统一异步、无授权、无超时/重试/幂等/取消/级联/降级语义、无部分失败的修复路径。平台通用层的"Solid"正是本 RFC 的核心投入，而不是给转写写业务代码。

已有正确方向（代码里已写明）：`service/mcp.go:586` `recutIntegrationContext` 的只读能力快照让 Domain Apps「直接消费、不必猜配套 App 是否安装」；`service/mcp.go:662`（mediaContext）明示「本机 TTS 就绪时优先直接用 audio-studio 的 MCP」；`service/runtime.go:198` `AppHost.InvokeMCP` 已是通用执行原语，只是被包进具体 speech bridge，没对 App 层开放。本 RFC 补齐：暴露 + 容错 + 首个消费场景（字幕）。

## 3. 架构原则：平台只做通用桥接

| 层 | 责任 | 不含 |
|---|---|---|
| 能力提供方（audio-studio） | 声明能力（manifest）+ 实现 + 就绪门 + 业务校验 + 产物入库规则 + 单作业约束 | — |
| 平台（service） | 能力注册/发现、跨 App 通用调用、统一异步 Handle、授权/审计、生命周期（安装/升级）、以及§7 容错契约 | 任何具体业务能力（转写、TTS、字幕…） |
| 能力消费方（editor / 未来任何 App / Agent） | 按场景编排能力调用、落项目语义、UI，并对能力失败做场景化处置 | 复制提供方实现、向平台要业务 op |

约束：

1. 平台**禁止**新增业务类执行器/业务路由（`wireLocalTranscriptionBridge`、`local-asr` 媒体路由、`recut.media.transcribe` 平台 op 均否）。
2. 编辑器**禁止**复制 ASR 本体（不本地推理、不搬模型环境）；只消费能力。
3. 已存在的业务性平台代码（`local_speech_bridge.go` 等）是**待收敛技术债**：能力桥成熟后迁移为通用能力调用（§10），新需求一律不再生长。

## 4. 目标与非目标

### 4.1 目标

1. 「生成字幕」一键走通，编辑器侧**一次能力调用**完成转写 + 入库。
2. 转写产物默认入全局 assets 库的 `transcript` 素材；项目只存引用。
3. 平台通用层可靠：对 §7 所列每种故障有明确语义（超时/重试/幂等/取消/级联/越权/背压/孤儿/审计/部分成功），有测试覆盖。
4. 复用统一异步观察（async_ops + recut.job.*）；编辑器 UI 不新增推拉通道。
5. audio-studio 未装/未就绪时给可操作引导（复用 `ctx.platform.integrations.audioStudio`）。

### 4.2 非目标

1. 不做「全轨混音自动字幕」P0 路径，留 P2（§8.3）。
2. 不改 script.* 文稿语义；只保证「生成的字幕与可编辑文稿同源」。
3. 不做转录文本润色/翻译/说话人重识别。
4. 不改变 audio-studio「Agent 直连 `audio.transcribe`（不传 saveToLibrary）= 私有产物不自动入库」的既有行为。

## 5. 核心决策

| # | 决策 |
|---|---|
| D0 | **能力分层**：转写是 audio-studio 的能力，不是平台能力；平台只做通用桥（§3）。 |
| D1 | **通用调用原语**：App background 获 `ctx.capabilities.invoke({ appId, name, input, authorization? })`，内部复用现有 `AppHost.invoke`/`InvokeMCP`（runtime.go:198）+ `requireApp` scope 规则。 |
| D2 | **能力声明与发现**：manifest operation 加 `capability: true` 标记可跨 App 复用；`ctx.platform.integrations`（既有）为只读发现快照；`ctx.capabilities.inspect(appId)` 返回能力名/inputSchema/就绪态。 |
| D3 | **统一异步**：能力返回携带 shell/media job 时平台将其纳入 async_ops Handle（op-bus §5），调用方统一经 `recut.job.*` / 编辑器 `subtitle.status` 观察；不新造 job 协议。 |
| D4 | **授权与审计**：invoke 携带 provenance（发起项目 App + 用户动作）；平台做签名转发与事件账本记录，判定留在提供方；敏感能力需声明授权才能落库。 |
| D5 | **一次调用**：`audio.transcribe` 增加 `saveToLibrary?: boolean`（默认 false，Agent/私有语义不变）；true 时终态自动 `audio.save`（幂等 `saved_asset_id`），一次 invoke 即表达「转写+许可入库」。不做独立编排 op、不做服务端自动隐藏编排。 |
| D6 | **平台侧容错是通用层义务**：能力桥按 §7 对每种故障给出确定语义（不在调用方散落 try/catch 的随机处理）。 |
| D7 | **项目引用模型**：轨道 `track.captionSource` 引用全局 assetId，cue 由资产派生；说话元素 `script.attach` 同源；`timeline.assets` 登记纳入校验 proof。 |
| D8 | **收敛导向**：`wireLocalSpeechBridge` 等业务执行桥在能力桥落地后迁移为通用能力调用（§10），不扩张不新写。 |

## 6. 能力契约

### 6.1 audio-studio（提供方）能力面

```jsonc
// apps/audio-studio/manifest.json（改动最小）
{
  "name": "audio.transcribe",            // 既有 op，仅扩展输入
  "surfaces": ["mcp", "capability"],     // 增加 capability 标记
  "inputSchema": {
    "assetId": "string",
    "kind": {"enum": ["audio", "video"]},
    "model": {"enum": ["qwen3-asr-0.6b", "qwen3-asr-1.7b", "whisper-small", "whisper-medium", "whisper-large-v3"]},
    "language": {"enum": ["auto", "zh", "en"]},
    "saveToLibrary": {"type": "boolean", "description": "默认 false=私有产物不自动入库；true=终态后自动 importTranscript 入库并返回 transcriptAssetId"}
  }
}
// audio.transcripts / audio.transcript / audio.status → capability: true（供发现/就绪/补取）
```

- 实现：`transcribe` 收 `saveToLibrary`，终态逻辑里若 true 则复用既有 `audio.save(kind:"transcript")`（幂等 `saved_asset_id` 判空）→ 结果附 `transcriptAssetId`。业务规则（模型枚举、语言、入库条件）只存在于 audio-studio。
- 约束：沿用 `ensureNoActiveJob` 单作业；能力忙时返回确定「busy」语义（§7.7），平台负责传递，不排队后端。

### 6.2 平台（桥）契约

```ts
// App background 侧（runtime 注入）
ctx.capabilities.invoke({ appId, name, input, authorization? })
  → { ok: true, result } | { ok: false, error: ErrorEnvelope }     // 同步段
  → 携带 job 时：{ ok: true, job: { id }, ...}
ctx.capabilities.inspect(appId) → { ready, operations: [{name, capability, inputSchema}] , envHint? }
ctx.platform.integrations.audioStudio            // 既有：installed / mcpReady / status
```

- 实现 = 暴露既有 `h.invoke`（service/runtime.go:232）为 context 原语；invoke 返回 job 时关联 async_ops Handle（op-bus §5.1）；事件 `app.capability.completed`（既有）继续记录，失败也记录。
- 平台对业务零知识：不做业务 schema 语义校验以外的判断，不注入模型/语言枚举，不知道"字幕"是什么。

### 6.3 编辑器（消费方）op 面

`apps/editor/manifest.json` 新增 api op，`project-operations.js` `fullActions` 登记：

| op | 动作 | 返回 |
|---|---|---|
| `subtitle.capabilities` | 读 `ctx.platform.integrations.audioStudio` + `inspect("recut.audio-studio")` + `audio.status`（经桥） | `{ ready, asrModels[], languages[], envHint }` |
| `subtitle.generate` | 一次 `ctx.capabilities.invoke("recut.audio-studio","audio.transcribe",{assetId,kind,model,language,saveToLibrary:true})` → 落库追踪 jobId | `{ jobId }` |
| `subtitle.status` | 读平台 Handle / audio.status → 终态带 `transcriptAssetId` | `{ status, progress?, transcriptAssetId?, error? }` |
| `subtitle.commit` | `Attach + timeline.assets 登记 + (可选)script.attach + 铺 cue + 写 track.captionSource` | `{ trackId, cueCount }` |

编辑器不拥有 ASR 模型/语言枚举真值，全部来自 `subtitle.capabilities`（audio.status 派生）；死配置 `transcription/models.ts` 删除或改映射。

### 6.4 「默认入库」的授权语义

`audio.save` 现有规则是「用户明确选择才导入」；本地 TTS 已确立先例（`local_speech_bridge.go:66`「用户把本地 TTS 选为默认即视为允许保存」）。本例沿用：**用户在编辑器点击「生成字幕」= 明确入库授权来源**，经 invoke 的 `authorization` provenance 传递；`audio.transcribe(saveToLibrary:true)` 在能力面接受该项目 App 的授权并判定落库。授权策略归属提供方（§7.6 平台只保证 provenance 不可伪造）。

## 7. 平台通用层健壮性与容错（Hardening）

本节是能力桥**能否上线的门槛**：每种故障必须有确定语义，不得让调用方按运气处置。全部语义在 `docs/platform-comms-contract.md` 稳定契约固化，并用 §9 故障注入矩阵验证。

### 7.1 统一错误信封（复用既有）

所有 invoke 失败返回结构化 `ErrorEnvelope`：

```ts
{ kind: "business"|"transport"|"scope"|"authz"|"timeout"|"cancel"|"provider"|"schema",
  code: string,              // 例：audio.not-ready / app.not-installed / op.not-exposed / audio-busy / job.timeout
  message: string, hint?: string, retryable: boolean, phase?: "sync"|"wait"|"save", data? }
```

- 提供方业务错误沿用 `__recutError`（runtime.go:253）传到桥面不改装（`kind:"business"`，`retryable` 由提供方声明）。
- 平台/传输/生命周期错误由桥面生成；**错误不吞**，帐本照记。

### 7.2 超时（三档，都不得无限挂起）

| 档位 | 覆盖 | 策略 |
|---|---|---|
| 同步段 | invoke 返回（app 加载 vue + handler 跑完） | 默认 30s；超时 `kind:"transport", code:"invoke.timeout", retryable:true` |
| 观察段 | async_ops job 从提交到终态 | Handle `timeout_at`（op-bus）：ASR 类给足 30min；到点 `timed_out` 终态 + 通知提供方尽量取消 |
| 提供方 | audio-studio 自身 shell job | 沿用其 shell job 生命周期与日志；桥不超卖窗口 |

### 7.3 重试与幂等

- 只允许在 `error.retryable && 操作幂等` 时由调用方重试；文档给出每个 `code` 的重试边界。
- 幂等锚点：
  - `audio.transcribe` 同 `(source_asset_id, model, language, saveToLibrary)` 在提供方侧落 `audio_transcripts` 记录并按 jobId 复用已完成产物（**提供方负责**）——编辑器 UI 对同一目标连点生成自动去重（§8.1）。
  - `audio.save` 已幂等（`saved_asset_id` 判空）→ 任何「转写成功、入库失败」都可安全重放 save。
- 平台不做自动重试（业务性判断留给消费方），但提供统一 `error.retryable` 契约让消费方可靠决策。

### 7.4 取消与超时传播

- `ctx.capabilities.invoke` 返回的 Handle 支持 `cancel`：平台标记 `cancelled`（op-bus）+ 尽力向提供方下发取消（audio-studio 的 `audio.cancel` 语义）→ 若提供方已产出部分产物（如 srt 已写），按 §7.9 部分成功处置并告知。
- 取消/超时都是终态，均进入账本；UI「取消生成」走 `subtitle.status` 的 cancel 分支。

### 7.5 级联故障与提供方不可用

| 故障 | 桥面语义 |
|---|---|
| app 未安装 | `code:"app.not-installed"` + `hint` 指向 `recut.apps.install`（复用 platforms integrations.action 文案） |
| op 未声明/未暴露 | `code:"op.not-exposed"`；inspect 时已过滤，属升级后契约漂移 |
| 环境未就绪 / 模型未装 | provide 前就绪门拦住（§8.1），桥面兜底返回 `code:"audio.not-ready"` + 引导 |
| 提供方运行中崩溃 | 同步段 → `invoke.timeout`/`provider.crash`；作业中崩溃 → shell 终态（exit ≠0）→ `job.failed` + 日志尾巴 |
| 观察段 Handle 丢失/损坏 | `code:"job.not-found"`；调用方回退 `audio.status` 断言事实（产物/作业都不在 → 视为失败并清理 UI 状态） |
| 下行不一致 | 平台进程重启后 async_ops/账本重放，UI 重连后 `subtitle.status` 拿到终态而非冒充运行中 |

### 7.6 授权与 scope 完整性

- invoke 的 `authorization` 由平台签名注入（记录在账本），消费方不能自封任意授权；提供方按目标 App/操作校验。
- 跨项目调用被 `requireApp`/`projectOwnedBy` 拒绝（runtime.go:219 既有，复用）；platform 层再校验「目标 App 必须安装于同一 host 且被调用方 project 认可」——返回 `code:"scope.denied"`。
- 敏感能力（`saveToLibrary:true`）在提供方侧二次校验授权标签存在，避免误落库。

### 7.7 并发背压（单作业约束）

- audio-studio 自身只允许一个活跃 job（`ensureNoActiveJob`）。平台桥对 busy 返回 `code:"audio-busy", retryable:true`，**不排队、不覆盖**；消费方 UI 据此显示「已有任务进行中」并自动轮询（编辑器的 `subtitle.status` 已天然幂等）。
- 桥面不维护自己的并发队列（避免隐藏状态），背压信号直接来自提供方。

### 7.8 观察面一致性

- 状态机：`pending → running → completed|failed|cancelled|timed_out`，终态一旦写定不可回退（op-bus §5.1）。
- UI 轮询必须做到「幂等 + 短轮询 + 终态停心跳」（对齐 audio-studio `audio.job` trackedJob 模式），不重复提交作业。
- `capabilities.inspect` 与 `integrations` 缓存带 TTL，安装/升级后失效重取。

### 7.9 部分成功与修复路径

- **转写成功、save 失败**：作业终态 `failed` 但保留 `transcriptId`（提供方产物仍在 App 私有区）；桥面把「可 repair」写入 error.data（`repairable:true`）。编辑器 `subtitle.retry-save`（或再次 invoke 同目标，提供方复用已完成的 transcript）由提供方幂等补 save——**不产生重复全局资产，不丢用户产物**。
- **save 成功、Attach 失败**：全局 asset 已存在但未归口项目。编辑器 `subtitle.commit` 幂等重跑 Attach + 登记（canonical 模型：attach 是幂等绑定）即可修复，asset 不重复。
- 原则：**任何中间失败都不删用户已生成内容，也不生成孤儿重复资产**；每条记录留 `repairable` 标记与可执行动作。

### 7.10 审计与可观测性

- 每次 invoke（含失败/取消/超时）写事件账本：`app.capability.completed` / `app.capability.failed` / `app.capability.cancelled`，携带 `appId/name/jobId/code/provenance`。
- 提供方 shell job 日志 JSONL 留存（既有）；桥面在同步段与观察段分别记录耗时与阶段。

## 8. 编辑器实施

### 8.1 后台

- 新增 `background/subtitle-generate.js`：`subtitle.generate/status/commit/capabilities` 四注册；`subtitle_jobs` 小表 `(job_id, target_asset_id, model, language, save_req_id, created_at)`。
- `generate` 幂等/去重：同 `(target_asset_id, model, language)` 且未终态 → 返回既有的 `jobId`（UI 连点不重复提交）；终态已完成 → 返回 `{ reused: true, transcriptAssetId }`。
- `commit` 复用轨道语义：cue 由 `ImportTranscript` 的 srt part 解析（`from-recut` 同款 `recut.assets.partURL`，或 `audio.transcript` 分段）；目标素材为说话元素时随后 `script.attach` 同一 `transcriptAssetId`；`Attach + timeline.assets` 幂等登记。
- 目标定位：选区/播放头下元素 → `element.mediaId` → 全局 assetId + kind；cue 偏移 = 目标 clip 的 `startTime`（`insertCaptionChunksAsTextTrack` 的 `startOffsetTicks` 已支持）。

### 8.2 前端

- `subtitles/components/assets-view.tsx` `handleGenerateTranscript`：
  1. 就绪门 `subtitle.capabilities`（未就绪 → 禁用 + 去声音工坊引导，复用既有 `captions.*` 文案与 diagnostics）。
  2. 目标 Select（默认播放头下有声素材）+ 模型 Select + 语言 Select（既有）。
  3. `subtitle.generate` → `subtitle.status` 轮询（幂等短轮询，终态停心跳）→ `subtitle.commit`；`audio-busy` 显示「已有转写进行中」并继续轮询该 job。
  4. 失败分支按 §7 错误信封分类提示：可重试（网络/超时/忙）→ 给重试按钮；业务/不可重试 → 展示 hint。
- `transcription/service.ts` stub 删除；`transcription/models.ts` 改由 `subtitle.capabilities` 派生；「Import file / From Recut assets」不动；再导入遇同 `assetId` 轨道提示「复用引用刷新 cue」。

### 8.3 目标选择（两级）

- **P0：单素材**（`assetId+kind`，与 audio.transcribe 契约一致，对齐 speech-track）。
- **P2：整轨混音**：编辑器浏览器混音（`extractTimelineAudio` 既有）→ 导入全局 generated audio asset（合法全局素材）→ 走同一 `audio.transcribe(saveToLibrary:true)` → cue 按 timeline 时间同步。

## 9. 验收与测试矩阵

### 9.1 功能

| 层 | 场景 | 断言 |
|---|---|---|
| L0 · editor scripts | 抽象能力桥 stub A→B round-trip | 通用 invoke 不依赖任何业务走通 |
| L1 · service Go | editor(app) invoke audio-studio `audio.transcribe(saveToLibrary:true)`（stub 实现） | 一次调用返回 jobId；终态含 `transcriptAssetId`；全局 asset parts 可读；跨项目调用 `scope.denied` |
| L3 · MCP/Agent | 生成字幕全流程 | 轨道有 `captionSource.assetId`；`timeline.validate` 零违规；`script.read` 物化同一份文稿 |
| L3 · Playwright | Captions Tab 生成（mock 能力就绪 + stub job） | 点击 → 阶段文案 → 字幕轨 cue 可读；模型/语言生效；未就绪禁用+引导；连点去重 |
| 回归 | zh/en、From Recut assets、本机 TTS（local-audio + agent 直连 audio.synthesize） | 不回归 |

### 9.2 容错注入（§7 矩阵，L1 Go + L2 前端）

| 故障 | 注入 | 断言 |
|---|---|---|
| app 未安装 / op 未暴露 | 移除 manifest / 改名 | `app.not-installed` / `op.not-exposed` + hint |
| 同步段超时 | handler 睡眠超过阈值 | `invoke.timeout`，无孤儿 job |
| 作业超时 | job 不结束 | 观察段 `timed_out` 终态，sweeper 清理 |
| 转写成功 save 失败 | stub 在 save 抛错 | `failed` + `repairable:true` + transcriptId；重放补 save 幂等成功，无重复 asset |
| 取消 | 中段 cancel | `cancelled` 终态；若已产出 srt 按部分成功提示，不丢文件 |
| busy | 活跃作业时再 invoke | `audio-busy, retryable`，不排队不覆盖 |
| Handle 丢失 | 删除 async_ops 行 | `job.not-found`；回退 audio.status 判定 |
| 越权 | 其他项目 App 调本项目 target | `scope.denied`；账本可审计 |
| 进程重启 | 观察期间重启 host | 重连后 `subtitle.status` 返回真实终态，不冒充运行中 |

## 10. 技术债收敛：业务执行桥 → 通用能力桥

`service/local_speech_bridge.go` 的 `SetLocalSpeechExecutor` 是「为单个业务在平台写死脚本」的样板。能力桥 + §7 容错契约成熟后迁移：

```text
旧：platformMedia.SetLocalSpeechExecutor(...)          // 业务逻辑长在平台
新：speech.local 路由 executor 内部调 ctx.capabilities.invoke("recut.audio-studio","audio.synthesize",…,{authorization:"default-voice-route"})
    → 观察 handle → 幂等 save → 返回平台 asset
```

- 不改 `audio.synthesize`/`audio.save` 契约与 Agent 直连路径；平台从「执行者」退化为「桥」；`recut.media.generate_speech` 保持兼容。
- 归入 P1/P2，与字幕能力桥同一机制、同套容错矩阵。

## 11. 分阶段实施

| 阶段 | 内容 | 前置 |
|---|---|---|
| **P0** | service：`ctx.capabilities.invoke/inspect` + async_ops 关联 + §7 错误信封与超时/取消基础；audio-studio：`saveToLibrary` 扩展 + capability 标记；editor：`subtitle.generate/status/commit/capabilities` + UI 接线 + 去重 | 无 |
| **P1** | §7.3 重试/幂等契约文档化、§7.6 授权签名、§7.9 部分成功 repair 路径（`subtitle.retry-save`）；L1 容错注入矩阵补齐 | P0 |
| **P2** | 整轨混音字幕；`local_speech_bridge` 收敛为通用能力调用；`transcription/models.ts` 死配置清零 | P0/P1 |

## 12. 落地文件

- `service/runtime.go`（ctx.capabilities.invoke/inspect 暴露，复用既有 invoke/InvokeMCP/requireApp；async_ops 关联；错误信封/超时/取消）；`service/capabilities_test.go`（功能 + 容错注入）；`service/mcp.go`（整合快照/审计事件，如需）
- `docs/platform-comms-contract.md`（§6.2/§7 稳定性契约固化）
- `apps/audio-studio/manifest.json`（`saveToLibrary` + capability 标记）、`background.js`（终态入库 + 幂等 save）
- `apps/editor/manifest.json`（subtitle.generate/status/commit/capabilities）、`background/subtitle-generate.js`（新增）、`background/project-operations.js`（fullActions + 登记）、`background/subtitles.js`（captionSource 序列化）
- `apps/editor/ui/src/subtitles/components/assets-view.tsx`、`ui/src/services/transcription/service.ts`（删 stub）、`ui/src/transcription/models.ts`（改动态）
- `apps/editor/skills/recut-editor/references/captions.md`、`voice-assets.md`、`rfc/README.md`、`README.md`

## 13. 待确认 / 争议点

1. **`saveToLibrary` 开关 vs 独立编排能力**：已定一次性方案（§D5，`audio.transcribe` 扩展开关，不改 Agent 默认私有语义）。仍留一个子问题：开关名与默认值是否保持 `false`（推荐，向后兼容）。
2. **能力标记识别符**：operation 上 `capability: true` 还是 `surfaces:["capability"]`——建议 `capability: true`（与既有 surfaces 语义不冲突），P0 评审定。
3. **授权模型粒度**：P1 前用 `authorization` 字符串 provenance + 签名；长期是否要「跨 App 交错调用的用户可见授权清单」属平台权限通用问题，另行 RFC。
4. **§7.7 背压**：audio-studio 单作业约束是现状硬门；若未来多作业，需提供方可配置并发上限并由桥面透传，P2 评审。
5. **重试是否平台化**：倾向「平台只给 `retryable` 契约，决策归调用方」；若多消费方出现一致重试诉求再抽通用组件，本期不做。
6. **`local_speech_bridge` 迁移节奏**：P2 用新能力桥重写并跑原有 local TTS API 测试证明无回归；若评审认为风险高，冻结现状只做文档标注，不阻塞 P0。

P0 落地情况：`service/capability_bridge.go`（invoke/inspect + 错误信封 + 超时 + 审计）、`service/runtime.go`（ctx.capabilities 注入）、`service/capabilities_test.go`；`apps/audio-studio/background.js`（saveToLibrary + finalizeSaveToLibrary + 去重）与 manifest；`apps/editor/background/subtitle-generate.js` 与 manifest、`apps/editor/ui/src/subtitles/…`（assets-view 重写 + insert 支持 captionSource）；`web/components/app-install-guide.tsx` + `web/lib/app-install-guide-store.ts` + `web/lib/iframe-assets-bridge.ts`（apps.request-install）。
P1/P2 决策见 §10/§13。