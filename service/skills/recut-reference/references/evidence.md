# 证据契约与参考分析写回规范

权威定义：`rfc/2026-09-17-reference-understanding.md` §3。本页是操作速查。

## 1. 三层归属

| 层 | 内容 | 写在哪 | 复用性 |
|---|---|---|---|
| 观察 | 时长/转写/边界/关键帧/接触表（指针/客观量） | 参考素材 `metadata.reference` | 跨目标复用 |
| 参考分析 | 这段片子是什么：hook/格式/节拍/系统/可迁移判据 | 参考素材 `attributes` + `content` | 跨目标复用 |
| 目标改造 | 本目标保留/替换的决策、计划 | 目标项目（`analysis.md` / `clone-plan.md`） | 目标相关 |

**红线**：`metadata.reference` 只装观察；主观但可复用的分析写 `attributes`/`content`；目标相关判断不写素材。

## 2. `metadata.reference`（只装观察）

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

- 只持**指针**（`assetId`）或**客观量**；派生证据（帧/接触表/片段）是独立 `image`/`video` 素材。
- 写入用 `recut.media.reference.attach`（**幂等**）：按 `(referenceAssetId, evidenceKind, assetId/params)` 去重，重复理解复用已有派生资产。
- 标记参考：`recut.media.reference.create({ assetId, sourceUrl? })`；`sourceUrl` 仅溯源。

## 3. 参考分析：受控 attrs（提交流）

| key | type | 含义 |
|---|---|---|
| `ref.summary` | textarea | 一句话事实摘要 |
| `ref.format` | select/text | 形态（口播 / 榜单 / 访谈 / 教程 / 种草 / 剧情…） |
| `ref.hook` | textarea | 前 3 秒钩子的客观描述（视觉 / 口播 / 文字各是什么） |
| `ref.beats` | textarea | 节拍与源时间简表（`0.0–2.4 开场断言` …） |
| `ref.systems` | textarea | 出现的视觉/声音系统（榜单板、卡拉OK字幕、SFX…） |
| `ref.transferable` | textarea | 可迁移 vs 不可复制（判据与边界，见 `transferable.md`） |

- 顺序持久化；key 稳定，可扩展、不重命名。
- 用 `recut.media.asset.update({ assetId, attrPatch: [...] })` 按 key 合并（避免整体覆盖）。

## 4. 参考分析：`content` 富文本（可 @）

- 详细读法（整片理解 + 带源时间的细节）写入素材 `content`。
- 用平台**内联引用标签** @ 到证据资产或相关对象：`<media assetid>`、`<creation_entity worldid entityid>` 等（见 rich-context-composer-protocol）。
- 「结论 + 证据」在同一篇可点击正文里，人/AI 都能顺着引用下钻。
- 写 `content` 用 `recut.media.asset.update({ assetId, content })`。

## 5. 溯源

- AI 写入的 attr / content 带 `provenance { by:"agent", op, modelId?, assetIds:[证据], at }`；`content` 写 `contentMeta`（服务端会补 `source`/provenance）。
- 观察（`metadata.reference`）与分析（`attributes`/`content`）用 `assetIds` 互指，禁止复制字节。

## 6. 读回

- `recut.media.asset.get({ assetId })` → 完整视图（`content` / `attributes` / `metadata.reference`）。
- `recut.media.list_assets` 只回摘要；不要用它逐条拼完整理解。

## 7. 重理解

- 重新理解同一参考时：`attach` 幂等复用已有证据；分析用 `attrPatch` 覆盖对应 key、`content` 整体替换，并更新 `understoodAt`/`toolVersion`。
- 覆盖式（不追加多版本）是当前约定；如需保留历史，先与用户确认。
