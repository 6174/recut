---
name: recut-reference
appId: recut.platform
description: 读懂一支参考视频/素材，并把证据与参考分析写回素材：调用 recut.media.* 理解工具产出 metadata.reference 观察，按规范把 hook/格式/节拍/系统/可迁移判据写成 attributes（ref.*）与 content（可 @ 引用），供 clone / remix / World 复用。
---

# 参考理解技能（recut-reference）

本技能是 Recut 平台无关的全局技能，只回答一个问题：**怎么读懂一支参考（视频/音频/图片）并留下可复用的证据与参考分析？** 它不决定「换成什么」——那属于 `recut-director（references/remix）`；也不负责跑通新片——那属于 `recut-clone`。

规范与契约的权威来源：`rfc/2026-09-17-reference-understanding.md`（§2 工具、§3 证据与写回、§4 占位、§5 工作流、§9 契约）。

## 边界声明

- **本技能只管「看懂并留证据 + 参考分析」**；迁移判断（keep/replace）归 `recut-director（references/remix）`。
- **观察 → `metadata.reference`；参考分析 → `attributes` + `content`**。目标改造留目标项目，不写入素材。
- 不重复 `recut-clone` 的执行步骤；不写时间线 op 语法；不引入 XML/DSL。

## 能力就绪检查（先做，再动手）

调用前先确认工具在平台 MCP 工具列表中；缺依赖时工具会返回结构化的「需要准备」错误，**按指引让用户准备，绝不自行 pip/uv 安装**：

| 能力 | op | 当前状态 |
|---|---|---|
| 素材属性读写 | `recut.media.asset.get` / `recut.media.asset.update` | **已实施** |
| 参考标记 / 证据写入 | `recut.media.reference.create` / `recut.media.reference.attach` | **已实施** |
| 探测 / 抽帧 / 接触表 | `recut.media.probe` / `frames` / `contactSheet` | **已实施**（需平台理解环境） |
| 边界 / 片段 | `recut.media.boundaries` / `clip` | **已实施** |
| 词级 / 估时 | `recut.media.words` / `measure` | **已实施**（词级可选，默认关闭） |
| 本地文件入库 | `recut.media.import_media` | **已实施** |
| 直链入库 | `recut.files.fetch` / `recut.media.import_url` | 已有 |
| 环境就绪 / 准备 | `recut.media.understand.status` / `recut.media.understand.prepare` | **已实施** |

环境缺失时：先 `recut.media.understand.status` 看缺什么 → 调用 `recut.media.understand.prepare`（异步 job，用 `recut.job.wait` 观察）→ 让用户确认准备完成。**绝不静默降级或伪造抽帧/接触表结果**。

## 流程

1. **准备参考素材**（真实内容优先）
   - 用户提供视频/音频/图片文件：先入库为素材 —— 本地文件用 `recut.media.import_media`（会话工作区或目标项目内，流式，≤2GB）；直链用 `recut.files.fetch` / `recut.media.import_url`。
   - 用 `recut.media.reference.create({ assetId, sourceUrl? })` 标记为参考（`sourceUrl` 仅作溯源，不抓取、不去重）。
   - 只处理链接引用（无内容可下载）时才用既有 `recut.media.create_reference`。

2. **采集证据**（只装观察）
   - `probe` 取时长/尺寸/帧率/音轨 → `frames` / `contactSheet` 取画面证据（接触表带时间码；有转写时叠词标签）→ `boundaries` 取切点 → 需要动作/源片段时 `clip`。
   - 转写经能力桥（`audio.transcribe`）；`words` 词级**默认不开**（见 RFC §2.4）。
   - 用 `recut.media.reference.attach` 幂等写入 `metadata.reference`（字段见 `references/evidence.md`）。典型顺序：先 attach `source`/`transcript`，再 attach `frames`/`sheets`/`boundaries`/`clips`。

3. **读懂**：按 `references/reading.md` 在整片与细节之间反复互证；用带时间码的接触表与转写定位「哪个画面/图形/音效响应哪句话」。

4. **写回参考分析**（见 `references/evidence.md` 的写回规范）
   - `attributes`（key 前缀 `ref.`）：`ref.summary` / `ref.format` / `ref.hook` / `ref.beats` / `ref.systems` / `ref.transferable`。
   - `content`：详细读法（整片理解 + 带源时间的细节），用平台内联引用标签（`<media assetid>` 等）@ 到证据资产或 World 实体。
   - 每个 AI 写入字段带 `provenance { by:"agent", op, modelId?, assetIds:[证据], at }`。

## 硬规则

- `metadata.reference` **只装观察**（指针或客观量）；主观但可复用的分析写 `attributes`/`content`；目标相关判断不写素材。
- 所有产物是**稳定 `assetId`**；不复制字节、不臆造 id。
- **幂等**：重复理解同一参考复用已有派生资产（attach 去重），不重复下载/转码。
- 读回：`recut.media.asset.get` 拿 `attributes`/`content`/`metadata.reference`；`list_assets` 只回摘要。

## 参考文档

- `references/reading.md`：整片 ↔ 细节互证的读法、取样密度、证据命名。
- `references/evidence.md`：`metadata.reference` 契约、参考分析写回规范、幂等与溯源。
- `references/tools.md`：`recut.media.*` 用法、参数、失败诊断、ingest 路径。
- `references/transferable.md`：可迁移 vs 不可复制的判据（交界处指向 `recut-director（references/remix）`）。
