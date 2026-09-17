---
name: recut-clone
appId: recut.platform
description: 用一支参考跑出一条新片：理解走 recut-reference（证据+分析），迁移判断走 recut-director（remix），计划写成素材的 content/attrs（content-first 占位），生成用 recut.media.* / component，最后用 timeline-editor（recut.editor.*）组装、校验与交付。
---

# 克隆执行技能（recut-clone）

本技能是 Recut 平台无关的全局技能，只回答一个问题：**给定一支参考与一个目标（换主体/产品/语言/CTA），怎么把它跑成一条可编辑、可交付的新片？**

它不重复理解方法、不重复迁移判断、不定义素材协议、不教时间线 op 语法——它把这些**串起来并设门禁**。

规范与契约的权威来源：`rfc/2026-09-17-reference-understanding.md`（§4 content-first、§5 工作流 S1–S5、§6 skill、§8 里程碑）。

## 0. 串联图（谁负责哪一段）

```text
S1 理解   recut-reference          → 参考素材：metadata.reference（观察）+ content/attrs（分析）
S2 决定   recut-director/remix     → 目标项目：analysis.md（keep/replace）
S3 计划   本技能 + 素材属性层       → 占位素材（空字节）+ content 规格 + clone-plan.md
S4 生成   本技能 + recut.media.*    → 读 content 生成；media 走 propose/confirm、MG 走 component
S5 组装   本技能 + timeline-editor  → 落轨、字幕/图形、validate、export
S5 交付   本技能                    → Done means watched
```

**组装这一段直接用 `timeline-editor`**：时间线读写、落轨、字幕、校验、导出都走它的 op（`recut.editor.*`）与其技能 references，本技能不另造时间线机制。

## 1. 边界声明

| 谁 | 负责 | 不负责 |
|---|---|---|
| `recut-reference` | 看懂、留证据、参考分析（写参考素材） | 不决定换什么 |
| `recut-director（references/remix）` | 反推公式、保留/替换判断（写目标项目） | 不教工具用法、不落轨 |
| `timeline-editor`（`recut.editor.*`） | 时间线组装、字幕/图形、预览、校验、导出 | 不决定 clone 流程 |
| **`recut-clone`（本技能）** | 编排 S1–S5、门禁与交付、content-first 计划 | 不重复上述三者内容 |

## 2. 能力就绪检查

- 理解工具是否就绪：见 `recut-reference` 的「能力就绪检查」。
- 素材层：`recut.media.asset.get/update` 已实施；`recut.media.asset.create`（占位，M3 待实施）缺失时如实报告。
- 生成：`recut.media.propose/list_proposals/update_proposal/confirm_proposal`、`component.create`。
- 组装：`timeline-editor` 在线（`recut.editor.workflow_context` / `timeline.read`）；编辑器未打开时预览/导出不可用，只能报告草稿。
- ML 能力缺失时**如实报告**，不要用别的手段冒充；不要静默安装。

## 3. 工作流与门禁（摘要，细节见 `references/workflow.md`）

```text
S1 理解 ──G1──> S2 决定 ──G2──> S3 计划 ──G3──> S4 生成 ──G4──> S5 组装与交付 ──G5
```

- **G1 理解门**：参考素材有 `metadata.reference`（至少 probe + 一组证据帧/接触表）+ 按规范写入的 `content`/`attributes`（`ref.*`）。
- **G2 计划门**：`keep/replace` 可定位（落在第几拍/哪个角色）。
- **G3 付费门**：计划经用户批准（账号/范围/预算）；video 一律先提案。
- **G4 落轨门**：`timeline.validate` 零违规 + 受影响 scene 的 settled frame 抽检通过。
- **G5 交付门**：Done means watched；队列中/失败/`editor-not-open` 不得声称已交付。

## 4. content-first 计划（S3 的核心）

计划素材 = **一个空字节的全局素材 + 它的说明**：

1. `recut.media.asset.create` 建占位素材（无字节、`status=proposed`、不花钱）。
2. 写 `content`：这段素材**要是什么**（主体/动作/镜头/风格），用内联引用 @ 锚定参考证据、角色/产品素材、World 实体。
3. 必要处补 `attributes`（role / shotKind / transferable / `refSource`）；配方留到 S4。
4. 写 `clone-plan.md`（人读索引）供审阅。

`content` 就是生成规格；参考素材的 content 是「这是什么」，计划素材的 content 是「我要它是什么」。

## 5. 生成与组装

- **生成**：读占位素材 `content`（+ attrs）作提示词，把 @ 引用解析为生成参考绑定；补 `metadata.proposal` → `propose → confirm`（媒体）或 `component.create`（MG，免费）。产物**原位填回同一 assetId**。
- **组装**：交给 `timeline-editor` —— `recut.editor.timeline.read` 看现状、`timeline.placeComponents` / `timeline.placeAudio` / `timeline.command` 落轨、字幕走其 captions 能力；首版按「源片段秒数 / 计划时长」顺序铺（见 `references/placement.md`）。
- **校验/交付**：`timeline.validate` + settled frame 抽检（`preview.*`）；`export.start` → `recut.job.wait` 到终态 → 实际观看后报告。

## 6. 硬规则

- **不复制源台词/构图/肖像**（remix 红线）；只迁移可复用的结构。
- 计划阶段的素材**不得**进入导出物化路径；导出前若仍有 `status=proposed` 的计划素材，视为未完成。
- 所有素材以 `assetId` 引用；不臆造 id；不复制二进制。
- 目标改造决策写项目（`analysis.md`），参考分析写素材——不混。
- 首版**不做语义锚点与一变多**；排布是「按源片段顺序」的妥协，需向用户明示时间对齐能力边界。

## 参考文档

- `references/workflow.md`：S1–S5 的完整步骤、工具调用与门禁。
- `references/placement.md`：如何用 `timeline-editor` 组装（其技能 references + `recut.editor.*` op）。
