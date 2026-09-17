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

调用前先确认工具在平台 MCP 工具列表中；缺哪一个就**如实报告**它属于哪个里程碑（见 RFC §8），不要用别的手段冒充：

| 能力 | op | 当前状态 |
|---|---|---|
| 素材属性读写 | `recut.media.asset.get` / `recut.media.asset.update` | **已实施** |
| 参考标记 / 证据写入 | `recut.media.reference.create` / `recut.media.reference.attach` | M3（待实施） |
| 探测 / 抽帧 / 接触表 | `recut.media.probe` / `frames` / `contactSheet` | M0（待实施） |
| 边界 / 片段 | `recut.media.boundaries` / `clip` | M1（待实施） |
| 词级 / 估时 | `recut.media.words` / `measure` | M2（待实施） |
| 直链入库 | `recut.files.fetch` / `recut.media.import_url` | 已有 |

缺失时的标准话术：说明「理解工具尚未就绪（RFC M0–M3）」，并给出当前可做的替代（如仅用已有素材信息 + 人工描述），绝不虚构抽帧/接触表结果。

## 流程

1. **准备参考素材**（真实内容优先）
   - 用户提供视频/音频/图片文件：先入库为素材（直链用 `recut.files.fetch` / `import_url`；本地文件等待「本地文件→资产」入口）。
   - 用 `recut.media.reference.create({ assetId, sourceUrl? })` 标记为参考（`sourceUrl` 仅作溯源，不抓取、不去重）。
   - 只处理链接引用（无内容可下载）时才用既有 `recut.media.create_reference`。

2. **采集证据**（只装观察）
   - `probe` 取时长/尺寸/帧率/音轨 → `frames` / `contactSheet` 取画面证据（接触表带时间码；有转写时叠词标签）→ `boundaries` 取切点 → 需要动作/源片段时 `clip`。
   - 转写经能力桥（`audio.transcribe`）；`words` 词级**默认不开**（见 RFC §2.4）。
   - 用 `recut.media.reference.attach` 幂等写入 `metadata.reference`（字段见 `references/evidence.md`）。

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
