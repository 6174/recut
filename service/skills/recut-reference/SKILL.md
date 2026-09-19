---
name: recut-reference
appId: recut.platform
description: 读懂一支参考素材并把理解写回该素材：用 recut.media.import 引入，用 probe/contactSheet/frames 读，把 hook/格式/节拍/系统/可迁移判据写成素材的 content 与 attributes（ref.*）。不引入 evidence 流程、不写 metadata.reference、不决定「换成什么」。
---

# 参考理解技能（recut-reference）

本技能只回答一个问题：**怎么读懂一支参考（视频/音频/图片/网页）并把它变成素材上可复用的理解？** 它不决定「换成什么」——那属于 `recut-director（references/remix）`；也不负责跑通新片——那属于 `recut-clone`。

规范与契约：`rfc/2026-09-19-asset-model-simplification.md`。**本技能已按新 Asset 模型重写**：没有 evidence 流程、没有 `metadata.reference`、没有 `reference.mark/attach`。

## 边界声明

- **Asset = kind + status + content + attributes**。理解只写 `content` 与 `attributes` 两个字段。
- 「这是一支参考」= 素材上的一条属性（`role: reference`，必要时 `url` 溯源），不是一种 kind、不是命名空间、不是专用工具。
- 读取产物（帧/接触表/片段）就是**普通素材**；要用就直接引用它的 `assetId`，不写回父素材、不建派生关系。
- 目标改造（keep/replace）留目标项目，不写素材。

## 流程

1. **引入素材**：`recut.media.import({ path|url|link, projectId? })`——本地文件用 `path`，直链媒体用 `url`，网页/文章用 `link`（落 `kind=document`）；外部下载（yt-dlp 等）后也必须经它入库。拿到稳定 `assetId`。
   - 标的为参考：`recut.media.asset.update({ assetId, attrPatch: [{ key:"role", value:"reference" }, { key:"url", value: sourceUrl }] })`（`url` 仅溯源）。
2. **读**：
   - `recut.media.probe` 取时长/尺寸/帧率/音轨；
   - `recut.media.contactSheet`（带时间码，可传 `transcriptAssetId` 叠词）看整片节奏；
   - 需要细节时 `recut.media.frames`；转写经 `recut.audio-studio.audio.transcribe`。
   - 这些产物需要留就留成普通素材，用 `assetId` 引用即可；不写回父素材。
3. **写回理解**（唯一落点）：
   - `content`：整片理解 + 带源时间的细节，用平台内联引用标签（`<media assetid>` 等）@ 到证据素材。
   - `attributes`（key 前缀 `ref.`）：`ref.summary` / `ref.format` / `ref.hook` / `ref.beats` / `ref.systems` / `ref.transferable`。
   - 写：`recut.media.asset.update({ assetId, content, attrPatch:[…] })`；服务端自动带 `source=agent` 与 `provenance`。
4. **复用**：同一参考被第二个目标复用，读它的 `content`/`attributes` 即可，不重复理解；目标相关判断写各自项目。

## 硬规则

- 只写 `content`/`attributes`；**不写 `metadata.reference`**，不做 evidence 记账，不建派生关系。
- 读取产物是普通素材；不复制字节、不臆造 `assetId`。
- 读出的**事实**与**解释**都进 `content`/`attributes`（可读、可复用）；目标相关判断不写素材。
- 外部下载必须入库（`recut.media.import`）；只落工作区文件不算完成。

## 参考文档

- `references/reading.md`：整片 ↔ 细节互证的读法、取样密度、理解落点。
- `references/evidence.md`：`content`/`attributes`（`ref.*`）写回规范与溯源（已无 metadata.reference）。
- `references/tools.md`：`recut.media.*` 用法、参数、失败诊断、ingest 路径。
- `references/transferable.md`：可迁移 vs 不可复制的判据（交界处指向 `recut-director（references/remix）`）。
