<!--
 * [INPUT]: 依赖 service/media（MediaService、media_assets、capability 桥、material.go 的 attributes/content/attrPatch/provenance 属性层、media_assets 的 proposed 生命周期；新增 asset.create 占位）、
 *   rich-context-composer-protocol（素材正文的 @ 内联引用）、generation-reference-protocol（@ 引用 → 生成参考绑定）、media-generation-proposal（propose/confirm 门禁）、
 *   平台全局 Python venv（web/public/install.sh 创建 <dataDir>/python/platform/3.11，当前仅 imageio-ffmpeg；service/main.go activateManagedToolPath 前置 PATH）、service/python_runtime.go（manifest 驱动 Python venv 与异步准备）、
 *   service/mcp.go + service/agent.go（平台工具注册模式）、service/recut_skills.go（service/skills/<id> 自动发现）、rfc/2026-08-29-global-directing-skills（全局技能形态与唯一性原则）、
 *   rfc/2026-08-22-editor-captions-audio-studio-asr（能力桥 audio.transcribe）、rfc/2026-09-17-editor-native-migration（timeline 下沉 Go，工具与其解耦）、recut.editor.*（时间线落轨）、recut-director/references/remix（迁移决策）、
 *   外部对照物 /tmp/hypit（media probe/frames/tile/transcript 与 fetch 思路，只取判断）
 * [OUTPUT]: 一个自包含、可直接执行的「参考理解 + 克隆」RFC——① 全局媒体工具（纯函数与 ffmpeg adapter 分离、可单测、默认栈 = Go 编排 + 全局平台 Python venv）；
 *   ② 真实内容参考素材 + metadata.reference 观察证据 + content/attributes 参考分析（含 AI 写回规范与 content-first 占位素材/asset.create 契约）；
 *   ③ 端到端执行工作流（理解→决定→计划→生成→交付）与五道门禁；④ 全局 skill（recut-reference / recut-clone）；含里程碑、契约影响、风险与验收
 * [POS]: rfc 的「参考理解 + 克隆执行」单一决策与执行入口；取代原 2026-09-17-clone-skill（已并入本文件）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# 参考理解与克隆执行：全局工具 + 全局 skill（`recut-reference` / `recut-clone`）

- 状态：提案（待评审；可直接按 §8 里程碑执行）
- 日期：2026-09-17
- 关联：[全局导演技能库](./2026-08-29-global-directing-skills.md)、[字幕 × audio-studio ASR](./2026-08-22-editor-captions-audio-studio-asr.md)、
  [Editor 迁移](./2026-09-17-editor-native-migration.md)、[素材属性能力](./2026-09-17-asset-attributes.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)、
  [生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)、[富文本上下文输入协议](./2026-09-14-rich-context-composer-protocol.md)、[Editor AI 成片质量](./2026-08-19-editor-ai-video-authoring-quality.md)
- 合并说明：原 `2026-09-17-clone-skill.md` 已并入本文件（§4 content-first、§5 执行工作流、§6 全局 skill、§10 风险/验收）。
- 外部对照：Hypit（`/tmp/hypit`）。只借「参考真相与目标真相分离、先理解再生成、素材可复用、Done means watched」四条判断，不引入其语法与包生态。
- 非目标：不引入 SVML/SVS 或任何 XML/DSL 中间语言；不新增平台一等对象；不改时间线数据模型与素材生命周期；首版不做语义锚点与一变多。

## 0. 摘要

「读懂一支参考，然后把它变成我的新片」在 clone、remix 仿拍、World 参考、封面参考、AI 短片取材里都要用，今天却只活在聊天记忆里。本 RFC 把它做成**一条自包含、可执行的链路**：

```text
看：全局工具（recut.media.*）──────────────┐
                                        ▼
   参考素材（真实内容）：metadata.reference 观察 + content/attributes 参考分析
                                        ▼
想：写计划素材（content-first 占位）──────────┐  本 RFC §4
                                        ▼
做：读 content 生成 → 落轨 → 交付 ────────────┘  本 RFC §5
```

三个交付物：

1. **全局工具**（平台媒体能力，`recut.media.*`）：纯函数与 ffmpeg/Python IO 分离、可单测、不依赖 Editor / Runtime Profile / 生成模型；产出**只装观察**的证据。默认栈 = Go 编排 + 全局平台 Python venv（§2.3）。
2. **全局 skill `recut-reference`**：唯一决策问题「**怎么读懂一支参考并留下可复用证据 + 参考分析**」。
3. **全局 skill `recut-clone`**：唯一决策问题「**给定参考与目标，怎么把它跑成一条可交付的新片**」；串起理解 → 决定 → 计划 → 生成 → 交付与五道门禁。

一句话边界：**`recut-reference` 负责「看懂并留证据 + 参考分析」，`remix` 负责「迁移什么、选哪段」，`recut-clone` 负责「按门禁跑通」；观察与参考分析挂素材（`metadata.reference` + attrs/content），目标改造留项目。**

## 1. 定位

### 1.1 为什么是全局

| 复用点 | 用途 |
|---|---|
| clone（参考 → 新片） | 观察写入 `metadata.reference`、参考分析写入 attrs/content，作为新片的证据与分析底座；`recut-clone` 按门禁执行 |
| `recut-director/references/remix` | 长转短/爆款仿拍需要原片的结构化观察 |
| `recut-worlds` | 参考视频/来源的素材理解 |
| `apps/cover-studio` | 参考封面的画面与风格观察 |
| `apps/ai-short-film` | 资料研究阶段的影像证据 |

### 1.2 与 Editor 迁移解耦

工具与 skill 是**平台媒体能力**，与 [Editor 迁移](./2026-09-17-editor-native-migration.md)（timeline 下沉 Go、去 iframe）**无依赖**，可并行先行。`timeline-editor` 只是消费者，落轨部分的 `recut.editor.*` op 名不变。

### 1.3 全局 skill 的工具引用边界

遵循全局技能库纪律：全局 skill **可以**引用平台级工具（`recut.media.*` / `recut.editor.*`，与 `recut-worlds` 引用 `recut.worlds.*` 同理），**不得**引用任何 App 私有 op。

## 2. 工具契约

全部注册为平台 MCP 工具（`service/mcp.go` + `service/agent.go`），与既有 `recut.media.*` 并列。

### 2.1 清单

| 工具 | 输入 | 输出 | 成本 |
|---|---|---|---|
| `recut.media.probe` | `{ assetId }` | `{ durationSec, width, height, fps, hasAudio }` | 本地 |
| `recut.media.frames` | `{ assetId, atSec?: number[], intervalSec?, startSec?, endSec?, maxFrames? }` | `{ frames: [{ atSec, assetId }] }` | 本地 |
| `recut.media.contactSheet` | `{ assetId, startSec, endSec, intervalSec, columns?, cellPx?, transcriptAssetId? }` | `{ sheetAssetId, cells: [{ atSec, assetId }] }` | 本地 |
| `recut.media.boundaries` | `{ assetId, threshold?, minGapSec? }` | `{ boundaries: [{ atSec, kind: "hard-cut", score? }] }` | 本地 |
| `recut.media.clip` | `{ assetId, startSec, endSec }` | `{ clipAssetId }` | 本地 |
| `recut.media.words` | `{ assetId \| transcriptAssetId, language? }` | `{ transcriptAssetId, wordLevel: true }` | 视转写路由（本地免费/托管计费） |
| `recut.media.measure` | `{ text, language?, pace? }` | `{ estimatedDurationSec }` | 本地、纯计算 |

约定：

- **ingest 不新增 op**：直链复用 `recut.files.fetch`（本地路径、≤100MB、公网）与 `recut.media.import_url`（≤25MB 入库）；**平台页下载见 §2.5（默认由宿主 Agent 自理，不做启动依赖）**；`tools.md` 固化推荐路径。
- 所有产物一律是**稳定 `assetId`**，不返回内存字节；项目文件路径（`--to` 式）仅在调用方明确需要时返回。
- 本地工具不依赖 Runtime Profile、不建 Build、不产生生成费用。

### 2.2 关键行为

- `contactSheet`：带**时间码**；给 `transcriptAssetId` 时**叠词标签**（对齐 Hypit `tile --transcript`）。时间码用内置点阵/字体渲染（不依赖系统 drawtext）；词标签用平台字体服务（`/v1/fonts`）避免 CJK 缺字。
- `frames`：抽帧按「跳转 + 短解码」实现精确 seek（避免逐帧解码）；`maxFrames` 上限保护。
- `boundaries`：PySceneDetect（选型见 §2.3）做 scene/fade 检测；**如实返回 score/置信度并标注限制**（快摇、强运动、叠化仍可能误检），不冒充精确镜头切分。
- `measure`：纯本地朗读时长估算（对齐 `hypit measure` 思路），用于生成前估时，不调模型。

### 2.3 实现选型与环境准备（Go + 全局平台 Python venv）

**默认栈（M0–M2）：Go 负责编排与纯函数，图像/镜头感知用全局平台 Python venv。**

平台已有一个**全局、共享**的 Python venv：`<dataDir>/python/platform/<3.11>`，由安装脚本 `web/public/install.sh` 创建，当前只装了 `imageio-ffmpeg`（把 ffmpeg 软链进 `venv/bin`）。它是所有平台工具的公共地基——本 RFC **直接在其上迭代**，不新建 per-App / per-项目环境。

| 能力 | 实现 | 依赖（加入平台 venv） |
|---|---|---|
| `probe` | ffprobe | **ffprobe（当前缺失，需补）** |
| `clip` | ffmpeg | ffmpeg（已有） |
| `frames` / `contactSheet` | ffmpeg 抽帧 + Pillow 合成（时间码/词标签） | Pillow、numpy |
| `boundaries` | PySceneDetect（按 scene/fade 检测，优于裸 ffmpeg filter） | PySceneDetect（+ opencv） |
| `measure` | 纯 Go（字数 × 语速） | 无 |
| `words` | 能力桥委托 audio-studio（WhisperX） | 既有 App 环境（不复制重模型） |

**为什么加 Python 而不是只用 ffmpeg filter**：scene/fade 检测、图像合成、以及将来的镜头/人脸感知在 Python 生态更成熟；平台已有全局 venv 与 `uv` 安装机制，把这层做成**全局能力**比在每个工具里拼 ffmpeg filter 更可维护。

**环境准备时机（铁律）**：

1. **安装时**：`install.sh` 增装 understanding 锁定依赖（ffprobe + PySceneDetect + opencv-python-headless + Pillow + numpy），写入版本标记。
2. **升级时**：锁定集变化 → 版本标记不匹配 → 由服务侧 prepare op 重新准备（异步、可观测、可取消），**用户无需重装**。
3. **调用时**：**绝不安装**；缺环境返回「需要准备」结构化错误 + 可执行指引。
4. **全局共享**：平台 venv 只有一份；`words` 的重模型仍归 audio-studio，不复制到平台。

**已知缺口 / 维护点**：

- 当前安装只装 `imageio-ffmpeg`（**没有 ffprobe**）→ `probe` 需要它，必须补；建议改用同时提供 ffmpeg+ffprobe 的锁定方案（或用 `static-ffmpeg` 类包含两者的包）。
- `install.sh` 在 `web/public/install.sh`、`web/out/install.sh`、`service/ui/assets/install.sh` 有 **3 份相同副本**，改动需同步（否则安装路径与 `activateManagedToolPath` 的预期不符）。
- 服务侧读取：`service/main.go` 的 `activateManagedToolPath` 把平台 venv 的 `bin` 前置到 `PATH`；Python 模块用该 venv 的 python 显式调用。**平台启动只前置、不安装**。

### 2.4 词级时间（可选增强）

理解内容用**段落级转写**就够，词级**不是**内容理解的前提，也不是一套 XML 标记；它是 ASR / forced-alignment 的一种输出（Whisper token 时间 + whisperx 对齐），存成 `segments[].words[]` 数值数组即可。

唯一买的是**精度**（亚秒），用于把「画面/图形/音效/删词」钉到具体的词、把切点落在词边界。

| 对象 | 词级的作用 | 必需性 |
|---|---|---|
| **参考片** | 提高「某图形响应哪个词」的分析精度 | 可选 |
| **目标片（新配音/A-roll）** | 后续锚点：字幕/图形/删词绑定到词 | 后续 RFC |

因此 `recut.media.words` **默认不调用**；`contactSheet` 不传 `transcriptAssetId` 时只用段落时间码。

### 2.5 链接视频下载（可选、按需准备，**不做启动依赖**）

**现状**：Recut 没有 yt-dlp 类下载能力；`recut.files.fetch` / `import_url` 只处理**直链媒体**（≤100MB / ≤25MB、拒绝内网/回环）。平台页（YouTube/TikTok/B站/小红书…）需要 yt-dlp。外部对照：Hypit 把 yt-dlp **pin 在独立 uv 环境**、`media prepare-fetch` 显式准备、`fetch` 只调用已备可执行文件、用 ffmpeg 复用音视频、**永不自动安装**。

**结论：下载不作为安装/启动依赖，分两档：**

| 档 | 做法 | 适用 | 保障 |
|---|---|---|---|
| **A. 宿主 Agent 自理（默认，零平台工作）** | 宿主 coding agent 用自己的 shell 跑 `yt-dlp`（若已装）下到工作区 | 有 shell 的 Agent 环境 | **平台不保证**：SSRF/大小/版本不受控，风险自负 |
| **B. 平台托管下载器（未来可选，按需准备）** | 独立受管程序（pin `yt-dlp` + EJS solver），仅在被显式请求时异步准备（可观测、可取消），产物落素材并记 `sourceUrl` | 无 shell 的产品内流程（UI） | 复用 `files.fetch` 的 SSRF/大小规则；pin 版本 + `toolVersion` |

- **A 档的前置缺口（必须补）**：AI 自己下载的文件仍要**导入为真实素材**才能进入理解/复刻链路。目前 `recut.media.import_image` 只支持图片，**缺一个「本地视频/音频文件 → 资产」的 agent 入口**（平台已有流式导入 HTTP 端点，但未暴露为 MCP op）。不补这个，A 档等于白下。
- **B 档的时机**：**不写进 `install.sh`**；首次需要时由 prepare op 准备，缺环境返回「需要准备」而非静默安装。
- 两档都必须把原始 URL 记入 `metadata.reference.provenance.sourceUrl`（见 §3.2）。
- 下载本质是 **ingest**，不是 understanding；此处只定义「可选、可自理」的边界，若产品化（B 档）应另立 ingest 专项。

## 3. 参考资产与证据契约（承载在全局素材上）

### 3.1 承载：真实内容素材 + `metadata.reference`

**参考应基于真实内容，而不是公开链接。** 平台既有 `recut.media.create_reference` 面向**公开链接**（`kind=reference`、`origin=research`、URL 去重、服务不抓取内容），不适合复刻场景。因此：

- **真实视频/文件类参考**（复刻主路径）：复用其媒体素材（`kind` 仍是 `video`/`image`/`audio`，按 `contentHash` 去重），用**新接口** `recut.media.reference.create({ assetId, sourceUrl? })` 标记为参考——原始 URL 只作溯源保存，不参与去重、不抓取。该接口与 `metadata.reference` 的机制由 [素材属性能力](./2026-09-17-asset-attributes.md) 定义。
- **链接/文章类参考**（无内容可下载时）：保留既有 `recut.media.create_reference`（研究引用）。
- **不为参考新增字节目录**：参考是素材的一种**角色**，不是新的字节类型。

### 3.2 `metadata.reference`（只装观察）

理解工具产出的证据写为该素材的 **`metadata.reference`**（既有 `metadata` 键，由 owner op 写、只读展示），全部字段都是**指针**（指向派生资产）或**客观量**：

```jsonc
metadata.reference {
  source:    { assetId, url?, durationSec, width, height, fps, hasAudio },
  transcript:{ assetId, language, wordLevel: bool },
  frames:    [{ atSec, assetId }],
  sheets:    [{ range: [startSec, endSec], assetId, transcriptAssetId? }],
  boundaries:[{ atSec, kind, score? }],
  clips:     [{ startSec, endSec, assetId, label? }],
  provenance:{ sourceUrl?, createdAt },
  understoodAt, toolVersion
}
```

- **红线**：`metadata.reference` **只装观察**；`hook/beats/format/transferable` 这类参考分析写成素材的 `attributes`/`content`（§3.5），不塞进 `metadata.reference`。
- **派生证据仍是独立素材**（帧/接触表/片段都是普通 `image`/`video` asset），`metadata.reference` 只持引用，不复制字节、不把大图塞进素材 parts。
- 写入走显式 op（`recut.media.reference.attach`）：工具是纯生产者，`metadata.reference` 写入单独收口，便于幂等与审计。
- **幂等**：attach 按 `(referenceAssetId, evidenceKind, assetId/params)` 去重；重复理解同一参考复用已有派生资产，不重复下载/转码。

### 3.3 三层归属：观察 / 参考分析 / 目标改造

| 层 | 内容 | 归属 | 复用性 |
|---|---|---|---|
| **观察** | 时长/转写/边界/关键帧/接触表（指针） | 参考素材 `metadata.reference` | 跨目标复用 |
| **参考分析** | 这段片子是什么、hook/格式/节拍/系统/可迁移判据 | 参考素材 `attributes` + `content`（§3.5） | **跨目标复用**（它说的是「参考本身」，不是「某个目标」） |
| **目标改造** | 本目标保留/替换的决策、素材计划 | 目标项目（`analysis.md` / `clone-plan.md`） | 目标相关，不复用 |

关键区分：**「这段片子怎么运作」是参考的属性，可复用；「我要怎么改它」才是目标的属性。** 因此参考分析**写回素材**（§3.5），只有目标改造决策留在项目。同一支参考做广告看 hook、做教程看结构，读法不同，但各自产出的都是「这个目标要怎么写」，不污染参考本身。

### 3.4 前置条件：素材 attrs/content 已具备（含 MCP 写入口）

素材属性层**已经落地**，§3.5 的写回规范**可直接执行**：

- `service/media/material.go`：`attributes`（`MaterialAttr`，对齐 World Entity 的 typed key-value，字段级 `provenance`）、`content` + `contentMeta`、`attrPatch` 按 key 合并，与 Asset 同表事务。
- **MCP 已暴露** `recut.media.asset.get` / `recut.media.asset.update`（`service/mcp.go`），HTTP `PATCH /v1/media/assets/{id}` 与 `AssetPreviewDialog`（属性/正文编辑）同源；测试 `service/media_material_test.go`。

本 RFC 只需新增：`recut.media.reference.create` / `recut.media.reference.attach`（§3.1/§3.2）与 `recut.media.asset.create` 占位入口（§4.2）。

### 3.5 AI 写回规范（attrs + 富文本 @）

参考分析的结论按下面规范写回参考素材，机器可校验、人可读、可溯源。

**（1）受控 attrs（key 前缀 `ref.`，顺序持久化）**

| key | type | 含义 |
|---|---|---|
| `ref.summary` | textarea | 一句话事实摘要 |
| `ref.format` | select/text | 形态（口播 / 榜单 / 访谈 / 教程 / 种草 / 剧情…） |
| `ref.hook` | textarea | 前 3 秒钩子的**客观描述**（视觉/口播/文字三层各是什么） |
| `ref.beats` | textarea | 节拍与源时间简表（`0.0–2.4 开场断言` …） |
| `ref.systems` | textarea | 出现的视觉/声音系统（榜单板、卡拉OK字幕、SFX…） |
| `ref.transferable` | textarea | 可迁移 vs 不可复制（判据与边界） |

> 受控 key 集由 `recut-reference` skill 维护；可扩展，但不重命名既有 key。

**（2）`content` 富文本（可 @ 引用）**

- 详细读法（整片理解 + 带源时间的细节）写入素材 `content`；用平台的**内联引用标签**（`<media assetid>` 等，见 [富文本上下文输入协议](./2026-09-14-rich-context-composer-protocol.md)）@ 到证据资产（关键帧/接触表/片段）或相关 World 实体。
- 这样「结论 + 证据」在同一篇可点击的正文里，人和 AI 都能顺着引用下钻。
- **同一 `content` 约定也服务待生成素材**：参考素材的 content 是「这是什么」，计划素材的 content 是「我要它是什么」；AI 生成时读它作为规格（content-first 见 §4）。

**（3）溯源**

- 每个 AI 写入的 attr / content 带 `provenance { by: "agent", op, modelId?, assetIds: [证据资产], at }`（`content` 写 `contentMeta`）。
- `metadata.reference`（观察）与 `attributes/content`（分析）用 `assetIds` 互指，禁止复制字节。

**（4）红线**

- attrs/content 只写**参考本身**的分析；**目标改造决策（针对某目标的 keep/replace）不得写入素材**，留在目标项目（§3.3）。
- 不把主观判断写成 `metadata.reference` 字段；该键只装观察。

## 4. 计划素材：content-first 占位素材与生成契约

### 4.1 占位素材 = 空字节 + `content`

计划素材就是**一个尚无字节的全局素材 + 它的说明**：`content`（富文本，可 @ 引用证据/角色/产品/World）描述「我要它是什么」，必要时补 `attributes`（role / shotKind / transferable / `refSource` 等）。配方（capability/model/output）可留到生成时再定。

- 参考素材的 content 是「**这是什么**」；计划素材的 content 是「**我要它是什么**」。同一个字段、同一个预览编辑框，语义按字节有无区分。
- **`content` 就是生成时的规格**：AI 执行生成时读它作为提示词，把其中的 @ 引用解析为生成参考绑定（见 [生成提示词参考引用协议](./2026-09-15-generation-reference-protocol.md)），产物**原位填回同一 assetId**。
- 这满足 [素材属性能力](./2026-09-17-asset-attributes.md) 的核心用法（content 既是说明也是规格），也让「先计划（不花钱）后生成」不需要另一套计划对象。

### 4.2 需要的新接口：`recut.media.asset.create`（占位）

现状：`recut.media.propose` 的 required 是 `["capability","text"]`，**无法「只建空素材 + 写说明」**。因此新增：

```jsonc
recut.media.asset.create({
  name,
  kind,                    // video | image | audio（或 code，未来）
  content?,                // 说明/规格（富文本，可 @）
  attributes?,             // 可选结构化字段
  projectId?               // 可选：随建随关联
})
→ { assetId, status: "proposed" }     // 无字节、无 capability、不花钱
```

- 落为 `status = proposed`（既有「有意向、无字节、无 job、不花钱」状态，**不新增 draft 状态**）。
- 生成时：`asset.update` 补 `metadata.proposal`（capability/model/output）→ `confirm`（用户确认）→ 队列执行 → 产物原位填回同一 assetId；图形类走 `component.create`。
- 占位素材**不得**进入导出物化路径；导出前若仍有 `status=proposed` 的计划素材，视为未完成。

### 4.3 不变式

- 计划素材与参考素材都是**全局素材**，时间线元素只持引用（`assetId` / `componentId`）。
- `content`/`attributes` 变更不触碰时间线；落轨后只改引用目标。
- 生成产物复用 `recipeHash`（配方稳定哈希）避免重复计费；同 hash 视为同一请求。

## 5. 执行工作流：理解 → 决定 → 计划 → 生成 → 交付

```text
S1 理解 ──G1──> S2 决定 ──G2──> S3 计划 ──G3──> S4 生成与落轨 ──G4──> S5 交付 ──G5──>
```

### S1 理解（把证据与参考分析写到参考素材）

- 载入 `recut-reference` 与其 `tools.md`，调用 `recut.media.probe / frames / contactSheet / boundaries / clip`（`words` 默认关闭）。
- 参考是真实媒体素材，经 `recut.media.reference.create({ assetId, sourceUrl? })` 标记；证据经 `recut.media.reference.attach` 幂等写入 `metadata.reference`。
- 参考分析（hook/格式/节拍/系统/可迁移判据）按 §3.5 写入参考素材的 `attributes`（`ref.*`）与 `content`（带 @ 证据引用）。
- **G1 理解门**：`metadata.reference` 至少含 probe + 一组证据帧/接触表，且参考分析已按 §3.5 写入；未通过不进入 S2。

### S2 决定（保留/替换）

- 载入 `recut-director/references/remix`；参考的客观分析已在 S1 写进素材，本步只产出**本目标**的 `keep`/`replace` 决策（换主体/产品/语言/CTA、保留哪些机制与节拍）。
- **不**在此步写素材计划；结论只写「什么角色要留、什么表面要换」，属目标项目。
- **G2 计划门（前置）**：`keep/replace` 必须有可定位的结论（落在第几拍/哪个角色）；无定位视为未定义。

### S3 计划（先建占位素材 + 写说明，不花钱）

- 每个计划素材 = `recut.media.asset.create` 建一个占位素材（无字节）+ 富文本 `content`（规格，@ 锚定参考证据/角色/产品/World）+ 必要 `attributes`。
- 写 `clone-plan.md`（人读索引：每个占位素材的角色、理由、来源），供审阅。
- **G3 付费门**：计划经用户批准（账号/范围/预算）；未批准不触发任何生成。video 一律先提案（`recut.video.generate` 默认 propose）。

### S4 生成与落轨

- **AI 读 `content` 作为规格**：把占位素材的 `content`（+ attrs）作为生成提示词，**@ 引用解析为生成参考绑定**；补 `metadata.proposal`（capability/model/output）。
- 逐元素物化：图形走 `component.create`（免费）；媒体走 `recut.media.propose → confirm`（用户确认）；配音走 `recut.speech.generate`。
- 产物**原位填回同一 assetId**（引用无需重指），再落轨：`timeline.placeComponents` / `timeline.placeAudio` / `timeline.command insert`。
- 时间排布：首版按「源片段秒数 / 计划时长」顺序铺，支持多场景与来源对齐（复用 `film.package.import` 的 cursor 思路，但多场景）。
- **G4 落轨门**：`timeline.validate` 零违规 + 受影响 scene 的 settled frame 抽检通过。

### S5 交付

- `export.start` → `recut.job.wait` 到终态 → 取最终 video Asset；**实际观看/试听**后报告。
- **G5 交付门**：Done means watched。队列中/失败/`editor-not-open` 都不得声称已交付。
- 留档：`clone-plan.md` + 各元素 `recipeHash`，后续可只重生成改动的元素。

### 5.1 产物与存放

```text
参考素材（全局，已有字节）
  metadata.reference                   # 观察层：probe / transcript / frames / sheets / boundaries / clips（指针）
  attributes（ref.*）+ content        # 参考分析层：hook/格式/节拍/系统/可迁移判据 + 带 @ 证据的正文

计划素材（全局，空字节占位）
  content（+ attributes）              # 「我要它是什么」的规格，可 @ 引用证据/素材/World；S4 生成时读它

─ 目标项目 ─
  analysis.md                        # 本目标的 keep/replace 决策
  timeline.md                        # 目标相关的时序/落位说明
  clone-plan.md                      # 执行层：计划素材清单
```

- **观察 + 参考分析挂素材**（跨目标复用，理解一次服务多个目标）；**目标改造决策与执行留项目**。
- 项目中已有 `analysis.md` 时，只写「本目标要改什么」，不重复素材上的参考分析。
- 所有素材仍以 `assetId` 引用表达，不复制二进制与源码。

### 5.2 验收

| 场景 | 预期 |
|---|---|
| **零花费路径** | 一支含字幕/图形的参考，只做「换语言 + 换图形文案」，全程不触发生成，产出可导出成片。用于证明分层成立、clone 不必等于花钱 |
| **标准路径** | 30s 参考 + 「换主体/产品」→ 参考素材 `metadata.reference` + attrs/content + keep/replace + 计划（占位，零花费）→ 批准后物化 → validate 零违规 + settled frame 通过 → 导出并观看 |
| **门禁** | 未过 G1 不进 S2；未过 G3 不 confirm；未过 G4 不导出；未过 G5 不声称交付 |
| **复用** | 同一参考素材（`metadata.reference` + attrs/content）支撑 ≥2 个目标版本（不同主体），不重复理解参考 |
| **等价性** | 迁移后 `recut.editor.*` op 名与读模型不变；技能不因寄宿位置变化而改流程 |

## 6. 全局 skill

### 6.1 `recut-reference`（看懂）

```text
service/skills/recut-reference/
  SKILL.md            唯一决策问题：怎么读懂一支参考并留下可复用证据 + 参考分析
  references/
    reading.md        整片 ↔ 细节互证的读法；取样密度随问题变化
    evidence.md       metadata.reference 契约、参考分析写回规范（§3.5）、写入 op 与幂等
    tools.md          recut.media.* 用法、参数、失败诊断、ingest 路径
    transferable.md   可迁移 vs 不可复制的判据（交界处指向 recut-director/references/remix）
```

### 6.2 `recut-clone`（跑通）

```text
service/skills/recut-clone/
  SKILL.md            唯一决策问题：给定参考与目标，怎么跑成一条可交付的新片
  references/
    workflow.md       S1–S5 与 G1–G5（§5）；content-first 计划（§4）
    placement.md      时间线落轨的介质用法（指向时间线/编辑器技能；以 recut.editor.* op 契约为准）
```

**推荐**：全局 skill，与 `recut-reference`、`recut-director` 并列。理由：clone 编排跨域（理解/素材计划/生成提案/时间线落轨），不应绑在单个 App/模块；与 `recut-reference` 对称（一个「看懂」、一个「跑通」）。
**替代方案（未决）**：作为 `recut-director/references/clone/` 子技能（与 `remix` 同级）。若选此案，工作流与门禁不变，只改寄宿位置。
**依赖（与迁移同批）**：时间线组装依赖 editor 技能**全局化**（`apps/editor/skills/recut-editor/` → `service/skills/recut-editor/` + surface `requiredSkill` 解析到全局技能），见 [Editor 迁移 §4.6 / M2.5](./2026-09-17-editor-native-migration.md)。`recut-clone` 的 `placement.md` 以它作为权威。

### 6.3 与 remix / timeline 的分工

| 角色 | 负责 | 不负责 |
|---|---|---|
| `recut-reference` | 看懂、留证据、参考分析（写参考素材） | 不决定换什么 |
| `recut-director/references/remix` | 反推公式、保留/替换判断（写目标项目） | 不教工具用法、不落轨 |
| 时间线/编辑器技能 | 时间线 op 的介质用法 | 不决定 clone 流程 |
| `recut-clone` | 编排 S1–S5、门禁与交付 | 不重复上述三者内容 |

交界规则：remix 的输入证据来自参考素材的 `metadata.reference` 与 attrs/content；clone 的「换什么」判断来自 remix。各自 SKILL.md 用边界声明互相指向，不复制内容。

## 7. 解耦与可测试（硬要求）

1. **纯函数与 IO 分离**：时间换算、区间展开、网格布局、词标签选取、边界解析、时长估算为纯函数（无 ffmpeg、无文件系统），单测覆盖；ffmpeg/ffprobe 调用集中在 **单一 adapter**（Go interface），测试注入 fake runner。
2. **不依赖 Editor / Runtime / 生成**：命令式执行；除 `words` 走能力桥外不触达其他 App。
3. **产物是 assetId 或路径**，不返回内存图像。
4. **失败可诊断**：缺 ffmpeg / 缺文件 / 无音轨 / 区间越界 / 帧数超限，返回统一错误信封并带可操作 hint，不静默降级。

建议包结构（Go）：`service/media/understand/{plan,boundaries,sheet,measure}.go`（纯）+ `service/media/understand/ffmpeg.go`（adapter 实现）+ 单测 `*_test.go`。

## 8. 里程碑与验收

| 里程碑 | 交付 | 验收 |
|---|---|---|
| **M0 环境与证据核心** | 平台 venv 增装 understanding 锁定依赖（含 ffprobe）+ prepare/readiness；纯函数核心 + adapter + `probe` / `frames` / `contactSheet` | 给定 30s 视频资产，产出带时间码接触表与帧清单（稳定 assetId）；纯函数单测全绿；不依赖 Editor/Runtime；无生成费用；venv 缺失时返回「需要准备」而非静默安装 |
| **M1 结构证据** | `boundaries` + `clip` | 得到切点列表（带 score）与源片段资产；错误面可诊断 |
| **M2 文本与估时** | `words`（能力桥，可选）+ `measure` | 词级开启时返回 `words[]`，关闭时按段落；`measure` 纯本地 |
| **M3 参考素材与写回** | `reference.create` + `reference.attach` + `asset.create`（占位） | 真实视频标记为参考（`kind` 仍 video）；`metadata.reference` 幂等写入；AI 按 §3.5 把分析写入 attrs/content；占位素材可建（无字节、无花费） |
| **M4 全局 skill** | `recut-reference` + `recut-clone` | `recut.skills.list` 发现两者；Agent 按 skill 走完 S1–S3（零花费）并留下参考素材 + 计划 |
| **M5 生成与交付对接** | S4/S5 贯通 | 批准后物化、落轨、`timeline.validate` 零违规 + settled frame 通过、导出并观看；零花费路径可跑通；跨 2 个目标复用参考不重复理解 |
| **M6 组装依赖** | 时间线组装可用 | `recut-editor` 技能全局化 + surface `requiredSkill` 解析到全局技能（迁移 §4.6 / M2.5） | `recut.skills.list` 发现 `recut-editor`；`recut-clone` 能按其 references 完成落轨 |

依赖：M0→M1→M2 顺序推进；M3 可与 M1/M2 并行；M4 依赖 M3；M5 依赖 M4 与 Editor 落轨能力；**M6（recut-editor 技能全局化）与 Editor 迁移同批，是 S5 组装的前置**。
可先行的部分：**零花费路径**（S1→S2→S3→S4 仅字幕/图形）只依赖 M3，可在 Editor 迁移完成前先跑通，作为分层正确性的最早期验证。

### 8.1 实施状态（2026-09-17）

| 里程碑 | 状态 | 落点 |
|---|---|---|
| **M0** | **已实施** | `service/media/understand/{plan,probe,frames,sheet,scenes,python,runner,prepare}.go`（纯函数 + adapter + Python 脚本）；平台 venv 锁定依赖与 ffprobe 补齐、`understand.status` / `understand.prepare`（经 `ShellJobManager` 异步）；`install.sh` / `install.ps1` 三份副本同步增装 |
| **M1** | **已实施** | `boundaries`（PySceneDetect，如实返回 score 与限制）/ `clip`（重编码保证边界） |
| **M2** | **已实施** | `words`（能力桥委托 audio-studio，词级 + 平台侧探测 wordLevel）/ `measure`（纯 Go 估算） |
| **M3** | **已实施** | `service/media/reference.go`（`metadata.reference` 观察层 + `reference.create` / `reference.attach` 幂等）、`service/media/placeholder.go`（`asset.create` 无字节 proposed）；补 `recut.media.import_media`（本地文件 → 资产入口） |
| **M4** | **已实施** | `service/skills/recut-reference/`（SKILL + reading/evidence/tools/transferable）与 `service/skills/recut-clone/`（SKILL + workflow/placement） |
| **M6** | **已实施** | `recut-editor` 全局化：`apps/editor/skills/recut-editor` 移除、内置 App 包排除 `skills/`、surface `requiredSkill` 解析到平台技能、`core-agents.md.tmpl` 路由改指 `appId=recut.platform` |
| **M5** | **待验收** | 依赖 Editor 落轨能力；工具与技能已可供端到端跑通，按 §5.2 验收表在真实项目上跑「零花费路径」与「标准路径」 |

环境铁律落实：安装时增装、升级/缺失时 `understand.prepare` 异步重准备、调用时**绝不安装**（缺依赖返回结构化「需要准备」错误）。已在本机真实平台 venv 上验证 `PrepareScript` → 依赖 + ffprobe + 版本标记，以及 `probe/frames/contactSheet/boundaries/clip` 对真实视频的端到端产物。

## 9. 受影响契约

- **MCP / agent**：新增 `recut.media.probe / frames / contactSheet / boundaries / clip / words / measure`；`recut.media.reference.create` / `recut.media.reference.attach`；`recut.media.asset.create`（占位）。`recut.media.asset.get` / `asset.update`（attrs/content/attrPatch + provenance）**已实施**（§3.4）。
- **素材属性**：`metadata.reference`（观察层，owner op 写入）+ 复用已实施的 `attributes`/`content`/`provenance`（参考分析层，§3.5）；机制见 [素材属性能力](./2026-09-17-asset-attributes.md)。
- **素材生命周期**：占位素材用既有 `status='proposed'`，不新增状态；`propose/update_proposal/confirm` 不变。
- **素材产物**：接触表/抽帧/片段都是普通 `image` / `video` asset，不改 `media_assets` 生命周期与 parts 机制。
- **transcript 资产**：`segments[]` 增**可选** `words[]`（无则不出现，向后兼容）。
- **能力桥**：`audio.transcribe` 增 `wordTimestamps`（可选），不影响既有调用。
- **全局 skill**：新增 `service/skills/recut-reference/`、`service/skills/recut-clone/`（自动发现）；**`recut-editor` 全局化**（`service/skills/recut-editor/`，随迁移 §4.6/M2.5），`recut-clone` 的组装指向它。
- **环境**：在全局平台 venv（`<dataDir>/python/platform/<ver>`）追加 understanding 锁定依赖（ffprobe/PySceneDetect/opencv-headless/Pillow/numpy）；`install.sh`（3 份副本）与安装路径同步；新增服务侧 prepare/readiness（§2.3）。下载（§2.5）不在此列，不写进安装。
- **缺口**：需补一个「本地视频/音频文件 → 资产」的 agent 入口（MCP），否则宿主 Agent 自行下载的素材无法入库。

## 10. 风险与未决问题

1. **边界检测准确率**：PySceneDetect 优于裸 ffmpeg filter，但对快摇/强运动/叠化仍可能误检。如实标注 score/置信度与限制；是否引入更重模型（如镜头分类）留 M1 决策。
2. **接触表标签的字形**：CJK 词标签依赖平台字体服务与字体可用性。缓解：词标签可选，缺字时退化为时间码。
3. **ffmpeg/ffprobe 可用性**：平台 venv 目前只装 `imageio-ffmpeg`（**无 ffprobe**），且 `install.sh` 有 3 份副本；需补齐 ffprobe、统一安装路径，并在缺二进制时给明确 hint。
4. **大文件与成本**：抽帧/接触表对长视频的 IO 与存储压力。缓解：`maxFrames` 上限 + 复用「跳转 + 短解码」。
5. **词级产物膨胀**：只在卡拉OK/词级绑定/单词删除场景才开；默认关闭。
6. **观察 vs 参考分析的边界**：`metadata.reference` 只装观察；参考分析（主观但可复用）写 attrs/content，目标改造写项目。契约与 skill 都显式声明。
7. **平台 venv 迭代与升级**：锁定依赖变化后，老用户不会自动重装。缓解：版本标记 + 服务侧 prepare op 异步重准备（§2.3）；体量与网络下载是准备时间主要成本。
8. **全局素材可变性**：`metadata.reference` 与 attrs/content 都写在全局参考素材上，会被其他项目读到。缓解：只放客观观察与「参考本身」的分析；目标改造留项目；attach 幂等并记录 `toolVersion`。**未决**：`metadata.reference` 是「覆盖式」还是「追加多版本」，倾向覆盖 + `toolVersion`。
9. **占位入口缺失**：`propose` 要求 capability，无法「只建空素材 + 写说明」。缓解：新增 `recut.media.asset.create`（§4.2）；在它落地前只能用「propose 一个最可能能力 + `asset.update` 写 content」近似。
10. **寄宿位置未定**：`recut-clone` 全局独立 skill vs `recut-director/references/clone`。**推荐全局独立**，待确认。编辑器技能重寄宿（迁移 RFC）未定，`placement.md` 暂以 `recut.editor.*` op 契约为准。
11. **改一句重生成的粒度**：`recipeHash` 复用未变素材是目标，需配方稳定哈希；否则退化为全量重生成。
12. **排布语义**：首版「按源片段顺序铺」是妥协；真正的「按词/动作对齐」需要锚点（后续 RFC）。需向用户明示首版时间对齐能力边界。

## 11. 非目标

- 不做内容语义解释的**机器化**（hook/beat/公式等结论由 AI 产出，不写成 `metadata.reference` 字段）。
- 不做语义锚点、不做时间线编译（后续 RFC）。
- 不引入 SVML/SVS 或任何 XML/DSL 中间语言；不新造 App 或平台一等对象；不新增素材状态。
- 不新增「参考」字节目录；参考是素材角色，字节类型仍是 video/image/audio/text。
- 不新建 per-App / per-项目 Python 环境；不复制 audio-studio 的 WhisperX 重模型。
- 不在本 RFC 提供平台托管下载器（§2.5 B 档）与下载环境；下载默认由宿主 Agent 自理（A 档），且**不是安装/启动依赖**。
- 不定义 remix 的迁移方法（属 `recut-director/references/remix`）；不定义时间线 op 语法（属时间线/编辑器技能）。
- 不改时间线、素材生命周期与生成门禁；首版不做变体批量渲染与组件市场。
