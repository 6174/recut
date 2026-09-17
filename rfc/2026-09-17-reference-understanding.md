<!--
 * [INPUT]: 依赖 service/media（MediaService、media_assets、capability 桥、ffmpeg/ffprobe 已在平台依赖内）、service/mcp.go + service/agent.go（平台工具注册模式）、
 *   service/recut_skills.go（service/skills/<id> 自动发现）、rfc/2026-08-29-global-directing-skills（全局技能形态与唯一性原则）、
 *   rfc/2026-08-22-editor-captions-audio-studio-asr（能力桥 audio.transcribe）、rfc/2026-09-17-editor-native-migration（timeline 下沉 Go，工具与其解耦）、
 *   外部对照物 /tmp/hypit（media probe/frames/tile/transcript 思路，只取判断）
 * [OUTPUT]: 定义「参考视频理解」的全局能力——平台媒体工具 `recut.media.probe/frames/contactSheet/boundaries/clip/words/measure`（纯函数与 ffmpeg adapter 分离、
 *   可单测、不依赖 Editor/Runtime/生成）与全局 skill `recut-reference`（唯一决策问题：怎么读懂一支参考并留下可复用证据），
 *   含 reference facet 证据契约、承载与幂等、里程碑、验收与风险
 * [POS]: rfc 的「参考理解」决策；作为 clone 与 remix 的共同上游，先于素材 attrs 协议层与 clone skill
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 * -->

# 参考视频理解：全局媒体工具 + 全局 skill `recut-reference`

- 状态：提案（待评审）
- 日期：2026-09-17
- 关联：[全局导演技能库](./2026-08-29-global-directing-skills.md)、[字幕 × audio-studio ASR](./2026-08-22-editor-captions-audio-studio-asr.md)、
  [Editor 迁移](./2026-09-17-editor-native-migration.md)、[媒体生成提案](./2026-09-16-media-generation-proposal.md)
- 外部对照：Hypit（`/tmp/hypit`）的 `hypit media probe/cut/frames/tile/tiles/boundaries/fetch` 与 `reference-video.md` 的「整片 ↔ 细节互证」读法。只取判断，不取语法与包生态。
- 非目标：不做内容解释（hook/beat/可迁移判断由 Agent 产出）；不引入新的媒体容器或素材体系；不改现有 `media_assets` 生命周期；不做语义锚点（后续 RFC）。

## 0. 摘要

「读懂一支参考视频」在 clone、remix 仿拍、World 参考、封面参考、AI 短片取材里都要用，今天却只活在聊天记忆里。本 RFC 把它做成**一块全局能力，两层交付**：

1. **全局工具**（平台媒体能力，`recut.media.*`）：纯函数与 ffmpeg IO 分离、可单测、不依赖 Editor / Runtime Profile / 生成模型；产出**只装观察**的证据。
2. **全局 skill `recut-reference`**（`service/skills/recut-reference/`）：唯一决策问题「**怎么读懂一支参考并留下可复用证据**」；教 Agent 在什么规模上取样、看什么、写什么，不重复 `recut-director/references/remix` 的迁移判断。

**承载基于真实内容素材**：复刻主路径用**真实视频素材**（不是公开链接），经新接口 `recut.media.reference.create({ assetId, sourceUrl? })` 标记为参考，证据写回其 `facets.reference`（机制见 [素材属性能力](./2026-09-17-asset-attributes.md)），不另造 `pack.json` 权威载体——同一支参考「理解一次，多个目标复用」。

一句话边界：**`recut-reference` 负责「看懂并留证据」，`remix` 负责「迁移什么、选哪段」；观察挂素材，解释留目标项目。**

## 1. 定位

### 1.1 为什么是全局

| 复用点 | 用途 |
|---|---|
| clone（参考 → 新片） | 把证据写入参考素材 facet，作为新片的证据底座 |
| `recut-director/references/remix` | 长转短/爆款仿拍需要原片的结构化观察 |
| `recut-worlds` | 参考视频/来源的素材理解 |
| `apps/cover-studio` | 参考封面的画面与风格观察 |
| `apps/ai-short-film` | 资料研究阶段的影像证据 |

### 1.2 与 Editor 迁移解耦

本能力是**平台媒体能力**，与 `rfc/2026-09-17-editor-native-migration`（timeline 下沉 Go、去 iframe）**无依赖**，可并行先行。Editor/`timeline-editor` 只是消费者。

### 1.3 全局 skill 的工具引用边界

遵循全局技能库纪律：全局 skill **可以**引用平台级工具（`recut.media.*`，与 `recut-worlds` 引用 `recut.worlds.*` 同理），**不得**引用任何 App 私有 op。

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

- **ingest 不新增 op**：链接/文件入库复用 `recut.files.fetch`（本地路径、≤100MB、公网）与 `recut.media.import_url`（≤25MB 入库）/ `recut.media.create_reference`（参考资料登记）；`tools.md` 固化推荐路径。
- 所有产物一律是**稳定 `assetId`**，不返回内存字节；`--to` 式项目文件路径仅在调用方明确需要时返回。
- 本地工具不依赖 Runtime Profile、不建 Build、不产生生成费用。

### 2.2 关键行为

- `contactSheet`：带**时间码**；给 `transcriptAssetId` 时**叠词标签**（对齐 Hypit `tile --transcript`）。时间码用内置点阵/字体渲染（不依赖系统 drawtext）；词标签用平台字体服务（`/v1/fonts`）避免 CJK 缺字。
- `frames`：抽帧按「跳转 + 短解码」实现精确 seek（避免逐帧解码）；`maxFrames` 上限保护。
- `boundaries`：ffmpeg scene detect；**如实返回 score，文档标注对渐变/手势转场不可靠**，不冒充镜头切分。
- `measure`：纯本地朗读时长估算（对齐 `hypit measure` 思路），用于生成前估时，不调模型。

### 2.3 词级时间（可选增强）

理解内容用**段落级转写**就够，词级**不是**内容理解的前提，也不是一套 XML 标记；它是 ASR / forced-alignment 的一种输出（Whisper token 时间 + whisperx 对齐），存成 `segments[].words[]` 数值数组即可。

唯一买的是**精度**（亚秒），用于把「画面/图形/音效/删词」钉到具体的词、把切点落在词边界。

| 对象 | 词级的作用 | 必需性 |
|---|---|---|
| **参考片** | 提高「某图形响应哪个词」的分析精度 | 可选 |
| **目标片（新配音/A-roll）** | 后续锚点：字幕/图形/删词绑定到词 | 后续 RFC |

因此 `recut.media.words` **默认不调用**；`contactSheet` 不传 `transcriptAssetId` 时只用段落时间码。

## 3. 参考资产与证据契约（承载在全局素材上）

### 3.1 承载：真实内容素材 + 参考 facet

**参考应基于真实内容，而不是公开链接。** 平台既有 `recut.media.create_reference` 面向**公开链接**（`kind=reference`、`origin=research`、URL 去重、服务不抓取内容），不适合复刻场景。因此：

- **真实视频/文件类参考**（复刻主路径）：复用其媒体素材（`kind` 仍是 `video`/`image`/`audio`，按 `contentHash` 去重），用**新接口** `recut.media.reference.create({ assetId, sourceUrl? })` 标记为参考——原始 URL 只作溯源保存，不参与去重、不抓取。该接口与 `facets.reference` 的机制由 [素材属性能力](./2026-09-17-asset-attributes.md) 定义。
- **链接/文章类参考**（无内容可下载时）：保留既有 `recut.media.create_reference`（研究引用）。
- **不为参考新增字节目录**：参考是素材的一种**角色/facet**，不是新的字节类型。

### 3.2 facet：`reference`（只装观察）

理解工具产出的证据写为该素材的 **`facets.reference`**（系统 facet，机制见 [素材属性能力](./2026-09-17-asset-attributes.md) §2.3），全部字段都是**指针**（指向派生资产）或**客观量**：

```jsonc
facets.reference.value {
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

- **红线**：facet 不含 `hook/beats/format/transferable` 等**解释**字段；解释写在目标项目（§3.3）。
- **派生证据仍是独立素材**（帧/接触表/片段都是普通 `image`/`video` asset），facet 只持引用，不复制字节、不把大图塞进素材 parts。
- 写入走显式 op（`recut.media.reference.attach`）：工具是纯生产者，facet 写入单独收口，便于幂等与审计。
- **幂等**：attach 按 `(referenceAssetId, evidenceKind, assetId/params)` 去重；重复理解同一参考复用已有派生资产，不重复下载/转码。

### 3.3 观察 vs 解释：目标项目持有解释

| 层 | 归属 | 例子 |
|---|---|---|
| **观察**（可复用，跨目标） | 参考素材 `facets.reference` | 时长/转写/边界/关键帧/接触表 |
| **解释**（目标相关，不可复用） | 目标项目文件 | `analysis.md`（keep/replace）、`timeline.md`、`clone-plan.md` |

同一支参考对不同目标可以有不同读法（做广告看 hook、做教程看结构），所以**解释不能挂全局素材**，否则会污染别的项目并伪装成客观事实。这与「参考真相 vs 目标真相」的分离一致。

### 3.4 与「素材 attrs 协议层」的关系（不阻塞）

`reference` 是**系统 facet**（由理解 op 写入，非用户任意编辑），机制与写入 op 由 [素材属性能力](./2026-09-17-asset-attributes.md) 定义。该 RFC 的 M0 属性模型是本 facet 的前置，但两者可并行设计；理解的工具层（§2）完全不依赖它，仍可先独立落地与单测。

Agent 读取路径：`recut.media.asset.get` 返回素材（含 `attributes` 与 `facets.reference`）；`list_assets` 只回摘要；项目文件里可保留一份 `pack.json` **投影**便于人读，但真相在素材。

## 4. 解耦与可测试（硬要求）

1. **纯函数与 IO 分离**：时间换算、区间展开、网格布局、词标签选取、边界解析、时长估算为纯函数（无 ffmpeg、无文件系统），单测覆盖；ffmpeg/ffprobe 调用集中在 **单一 adapter**（Go interface），测试注入 fake runner。
2. **不依赖 Editor / Runtime / 生成**：命令式执行；除 `words` 走能力桥外不触达其他 App。
3. **产物是 assetId 或路径**，不返回内存图像。
4. **失败可诊断**：缺 ffmpeg / 缺文件 / 无音轨 / 区间越界 / 帧数超限，返回统一错误信封并带可操作 hint，不静默降级。

建议包结构（Go）：`service/media/understand/{plan,boundaries,sheet,measure}.go`（纯）+ `service/media/understand/ffmpeg.go`（adapter 实现）+ 单测 `*_test.go`。

## 5. 全局 skill `recut-reference`

```text
service/skills/recut-reference/
  SKILL.md            唯一决策问题：怎么读懂一支参考并留下可复用证据
  references/
    reading.md        整片 ↔ 细节互证的读法；取样密度随问题变化
    evidence.md       reference facet 契约、写入 op 与幂等规则
    tools.md          recut.media.* 用法、参数、失败诊断、ingest 路径
    transferable.md   可迁移 vs 不可复制的判据（交界处指向 recut-director/references/remix）
```

- frontmatter：`name` / `appId: recut.platform` / `description`，与 `recut-design-system`、`recut-worlds` 同形；放入即被 `service/recut_skills.go` 自动发现（无需改 Go）。
- 内容只讲「怎么看、留什么」，**不**写 clone 的执行步骤、不写 op 语法、不写迁移判断。

## 6. 与 remix / 各消费方的分工

| 角色 | 负责 |
|---|---|
| `recut-reference`（本 RFC） | 看懂 + 留证据（观察层，写参考素材 facet） |
| `recut-director/references/remix` | 反推公式、选段/迁移（决策层，写目标项目） |
| clone skill（后续 RFC） | 证据 → 计划素材 → 生成 → 落轨（执行层） |

交界规则：remix 的输入证据来自参考素材的 facet；clone 的「换什么」判断来自 remix。三方各自 SKILL.md 用边界声明互相指向，不复制内容。

## 7. 里程碑与验收

| 里程碑 | 交付 | 验收 |
|---|---|---|
| **M0 证据核心** | 纯函数核心 + adapter + `probe` / `frames` / `contactSheet` | 给定 30s 视频资产，产出带时间码接触表与帧清单（稳定 assetId）；纯函数单测全绿；不依赖 Editor/Runtime；无生成费用 |
| **M1 结构证据** | `boundaries` + `clip` | 得到切点列表（带 score）与源片段资产；错误面可诊断 |
| **M2 文本与估时** | `words`（能力桥，可选）+ `measure` | 词级开启时返回 `words[]`，关闭时按段落；`measure` 纯本地 |
| **M3 全局 skill** | `service/skills/recut-reference/` | `recut.skills.list` 发现 `recut-reference`；Agent 能按 skill 独立走完一次参考理解并把证据写入参考素材的 `facets.reference` + 写 `analysis.md` |
| **M4 消费对接** | `reference.attach` + remix / clone 引用 | 参考素材可被第二个目标复用（不重复理解）；remix 用其证据产出选段/公式；clone 用其证据建计划 |

依赖：M0→M1→M2 顺序推进，M3 可与 M1/M2 并行；M4 依赖 clone skill（后续 RFC）。

## 8. 受影响契约

- **MCP / agent**：新增 `recut.media.probe / frames / contactSheet / boundaries / clip / words / measure`，以及 `recut.media.reference.create`（真实内容标记为参考）与 `recut.media.reference.attach`（写 facet）。
- **素材属性**：`facets.reference`（观察层；机制与写入契约见 [素材属性能力](./2026-09-17-asset-attributes.md) §2.3/§3）。
- **素材产物**：接触表/抽帧/片段都是普通 `image` / `video` asset，不改 `media_assets` 生命周期与 parts 机制。
- **transcript 资产**：`segments[]` 增**可选** `words[]`（无则不出现，向后兼容）。
- **能力桥**：`audio.transcribe` 增 `wordTimestamps`（可选），不影响既有调用。
- **全局 skill**：新增 `service/skills/recut-reference/`（自动发现）。

## 9. 风险与未决问题

1. **边界检测准确率**：ffmpeg scene detect 对渐变/手势转场不可靠。首版如实标注 score 与限制；是否引入更重模型留 M1 决策。
2. **接触表标签的字形**：CJK 词标签依赖平台字体服务与字体可用性。缓解：词标签可选，缺字时退化为时间码。
3. **ffmpeg 可用性**：平台已把 ffmpeg 作为依赖（`service/main.go`），但仍需在缺二进制时给明确 hint。
4. **大文件与成本**：抽帧/接触表对长视频的 IO 与存储压力。缓解：`maxFrames` 上限 + 复用「跳转 + 短解码」。
5. **词级产物膨胀**：只有在卡拉OK/词级绑定/单词删除场景才开；默认关闭。
6. **证据 vs 解释的边界**：容易把主观判断写进 facet。缓解：契约与 skill 都明确「facet 只装观察」，解释写目标项目。
7. **全局素材可变性**：facet 写在全局参考素材上，会被其他项目读到。缓解：只放客观观察；解释留目标项目；attach 幂等并记录 `toolVersion`，重理解可覆盖/追加。**未决**：facet 是「覆盖式」还是「追加多版本」，倾向覆盖 + `toolVersion` 标记。

## 10. 非目标

- 不做内容语义解释（hook/beat/公式/可迁移判断）。
- 不做语义锚点、不做时间线编译（后续 RFC）。
- 不新增「参考」字节目录；参考是素材角色/facet，字节类型仍是 video/image/audio/text。
- 不做下载器：链接抓取仍走 `recut.files.fetch`；若未来需要平台下载（yt-dlp 类），单独评估，不塞进本 RFC。
- 不改时间线、素材生命周期与生成门禁。
