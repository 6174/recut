# 用 timeline-editor 组装

clone 的**组装、字幕/图形、预览、校验、导出**全部交给 `timeline-editor`（`recut.editor.*` op + 它的技能 references）。本页只说明「clone 怎么接进去」，不重复时间线 op 语法。

## 1. 先读 timeline-editor 的技能

开工前加载 `timeline-editor` 的技能，按其 references 执行（按需读取，不整包加载）：

| 需要解决 | 读它的 |
|---|---|
| 数据模型、element/track/scene、op 入口 | `timeline-workflow.md`、`data-model.md` |
| 落组件/媒体/音频、原子批量放置 | `components.md`、`timeline-workflow.md` |
| 图形/MG 的视觉与动效 | `motion-graphics.md`、`directing.md`、`keyframes.md`、`params.md` |
| 字幕（把文稿/文案上屏） | `captions.md` |
| 文稿（口播 A-roll 的留删） | `speech-editing.md` |
| 预览与证据 | `verification.md`、`preview-export.md` |
| 报错与排错 | `errors.md` |

> 迁移进行中：`recut-editor` 技能从 `apps/editor/skills/` **全局化到 `service/skills/recut-editor/`**，并让 surface `requiredSkill` 解析到全局技能（RFC Editor 迁移 §4.6 / M2.5）。其 op 名仍为 `recut.editor.*`，落轨读模型不变；在该项完成前，按其现有位置读取。

## 2. 会话与写入纪律（跟 timeline-editor 走）

- 进入连续编辑：`recut.editor.workflow_context`（读一次，复用快照）→ `timeline.read` 看现状。
- 多步写入：`project.lock` 拿 `owner/token` → `work.checkpoint` → 写入带最新 `baseVersion` → `project.unlock`。
- 冲突（`{conflict, currentVersion, opsSince}`）：重读后重放，不整份重载当正常同步。
- 每次落轨前 `timeline.assets` 登记引用素材，导出才能物化。

## 3. clone 的落点

| clone 产物 | 落到 timeline-editor |
|---|---|
| 计划素材（媒体，已 `completed`） | `timeline.command` insert（video/image element，`assetId`） |
| 计划素材（MG/图形，`verified`） | `timeline.placeComponents`（批量、避碰） |
| 配音/配乐/SFX | `timeline.placeAudio` |
| 字幕/文案 | 字幕能力（`subtitle.*` / captions 轨道；样式走 `caption-style`） |
| 封面 | `cover.*`（若用户要求） |

- **首版排布**：按「源片段秒数 / 计划时长」顺序铺，支持多场景与来源对齐（复用影片包的 cursor 思路，但多场景）。
- **不做**（首版）：语义锚点（按词/动作重排）。需向用户明示这是能力边界。

## 4. 校验与交付门

- **G4**：`timeline.validate` 零违规；对受影响的 settled frame 用 `preview.frame`/`preview.batch` 抽检构图/可读性。
- **G5**：`export.start` 返回 `jobId` → `recut.job.wait` 到 `completed` 取 video Asset → **实际观看**后报告。`editor-not-open` / headless 不可用时只能报告草稿。

## 5. 与 clone 计划的对应

`clone-plan.md` 里每个计划素材应能对上一条时间线放置：`assetId`（物化后）+ 起止（首版由源片段/计划时长决定）。若某素材无人落轨或时间线里出现未计划元素，回到 S3 修正计划，不要私下加料。
