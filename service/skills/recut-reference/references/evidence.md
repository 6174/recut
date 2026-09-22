# 理解写回规范（content + attributes）

权威：`rfc/2026-09-19-asset-model-simplification.md`。Asset 只有 `kind` / `status` / `content` / `attributes`（+ 只读系统事实）。**没有 `metadata.reference`，没有 evidence 流程。**

## 1. 归属

| 内容 | 写在哪 |
|---|---|
| 整片理解 + 带源时间的细节（叙述） | 素材 `content`（markdown，可 @ 引用证据素材） |
| 可枚举/可比较/被机器消费的判据 | 素材 `attributes`（key 前缀 `ref.`） |
| 「这是一支参考」 | 素材属性 `role: reference`（+ `url` 溯源） |
| 目标改造（keep/replace） | 目标项目（`TREATMENT.md` 等），不写素材 |

读取产物（帧/接触表/片段/转写）是**普通素材**；要用就在 `content` 里 `<media assetid>` 引用，或作为一条 `media` 属性，不做专门记账。

## 2. 受控 attrs（提交时用 `attrPatch` 按 key 合并）

| key | type | 含义 |
|---|---|---|
| `ref.summary` | textarea | 一句话事实摘要 |
| `ref.format` | select/text | 形态（口播 / 榜单 / 访谈 / 教程 / 种草 / 剧情…） |
| `ref.hook` | textarea | 前 3 秒钩子的客观描述（视觉/口播/文字各是什么） |
| `ref.beats` | textarea | 节拍与源时间简表（`0.0–2.4 开场断言` …） |
| `ref.systems` | textarea | 出现的视觉/声音系统（榜单板、卡拉OK字幕、SFX…） |
| `ref.transferable` | textarea | 可迁移 vs 不可复制（判据与边界） |

- key 稳定、可扩展、不重命名。
- 写入：`recut.media.asset.update({ assetId, attrPatch: [{ key:"ref.hook", value:"…" }] })`。

## 3. content（可 @）

- 详读（整片理解 + 带源时间的细节）写入素材 `content`；用平台内联引用标签 @ 到读取产物或 World 实体。
- 「结论 + 证据」在同一篇可点击正文里，人和 AI 都能顺着引用下钻。
- 写入：`recut.media.asset.update({ assetId, content })`。

## 4. 溯源

- AI 写入的 attr / content 由服务端自动带 `source=agent` 与 `provenance { op, at }`。
- 理解里引用的证据用真实 `assetId` 互指，禁止复制字节。

## 5. 读回

- `recut.media.asset.get({ assetId })` → `kind`/`status` + `content` + `attributes`。
- `recut.media.list_assets` 只回摘要；不要用它逐条拼完整理解。

## 6. 重理解

- 重新理解同一参考：`asset.update` 用 `attrPatch` 覆盖对应 key、`content` 整体替换。覆盖式（不追加多版本）是当前约定。
